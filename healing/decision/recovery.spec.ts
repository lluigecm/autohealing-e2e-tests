import { test, expect, Locator } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Fingerprint } from '../fingerprint';
import { HealingLogEntry, RunContext } from './decide';
import {
  attemptRecovery,
  completeEntry,
  jsonlSink,
  timeRecoveredAction,
} from './recovery';

/**
 * Tentativa de recuperação instrumentada, com as heurísticas reais sobre DOM
 * local. O oráculo é um stub: o de verdade (`pointsToOracle`) depende da
 * mutação instalada e é exercitado nos testes de integração.
 */

const LISTAGEM = `
  <main>
    <ol>
      <li><article>Wall and Piece £44.18 In stock Add to basket</article></li>
      <li><article>Ways of Seeing £16.21 In stock Add to basket</article></li>
    </ol>
  </main>
`;

/** Mesma listagem com os cards invertidos: geometria idêntica, conteúdo trocado. */
const LISTAGEM_REORDENADA = `
  <main>
    <ol>
      <li><article>Ways of Seeing £16.21 In stock Add to basket</article></li>
      <li><article>Wall and Piece £44.18 In stock Add to basket</article></li>
    </ol>
  </main>
`;

function fingerprint(): Fingerprint {
  return {
    selector: 'role=article',
    url: '/catalogue/category/books/art_25/index.html',
    tag: 'article',
    text: 'Wall and Piece £44.18 In stock Add to basket',
    attributes: { stable: {}, volatile: { class: 'product_pod', id: null } },
    position: { parentTag: 'li', parentSiblingIndex: 0, siblingIndex: 0, depth: 3 },
  };
}

/** Stub de oráculo: o elemento certo é o card de "Wall and Piece". */
async function oracle(candidate: Locator): Promise<boolean> {
  return candidate.evaluate((el) => (el.textContent ?? '').startsWith('Wall and Piece'));
}

const RUN: RunContext = {
  entryId: 'M3-T2',
  testId: 'home',
  repetition: 1,
  condition: 'healing-on',
};

const AGORA = new Date('2026-10-05T12:00:00.000Z');

test('recuperação correta: substitui, candidato é o oráculo, ação cronometrada', async ({ page }) => {
  await page.setContent(LISTAGEM);

  const attempt = await attemptRecovery(page, fingerprint(), { oracle, now: () => AGORA });
  const { actionMs, error } = await timeRecoveredAction(attempt, (locator) => locator.click());
  const entry = completeEntry(attempt, RUN, { detectionWaitMs: 5000, actionMs });

  expect(entry.decision).toBe('replace');
  expect(entry.candidateIsOracle).toBe(true);
  expect(error).toBeNull();
  expect(entry.run).toEqual(RUN);
  expect(entry.timings!.detectionWaitMs).toBe(5000);
  expect(entry.timings!.recoveryMs).toBeGreaterThan(0);
  expect(entry.timings!.actionMs).toBeGreaterThan(0);
});

test('recusa: oráculo avaliado sobre o candidato mesmo sem substituição', async ({ page }) => {
  await page.setContent(LISTAGEM_REORDENADA);

  const attempt = await attemptRecovery(page, fingerprint(), { oracle });
  const { actionMs } = await timeRecoveredAction(attempt, (locator) => locator.click());
  const entry = completeEntry(attempt, RUN, { detectionWaitMs: 5000, actionMs });

  expect(entry.decision).toBe('fail');
  // A configuração sem corroboração textual teria substituído (bruto 1.0) pelo
  // elemento errado: é esse o dado que a ablação precisa e que só existe aqui.
  expect(entry.rawScore).toBeCloseTo(1);
  expect(entry.candidateIsOracle).toBe(false);
  expect(entry.candidate).not.toBeNull();
  // Sem ação recuperada, não há o que cronometrar.
  expect(entry.timings!.actionMs).toBeNull();
});

test('sem oráculo injetado, candidateIsOracle fica null em vez de inventar valor', async ({ page }) => {
  await page.setContent(LISTAGEM);

  const attempt = await attemptRecovery(page, fingerprint());

  expect(attempt.candidateIsOracle).toBeNull();
});

test('erro na ação recuperada não impede a gravação da entrada', async ({ page }) => {
  await page.setContent(LISTAGEM);

  const attempt = await attemptRecovery(page, fingerprint(), { oracle });
  const { actionMs, error } = await timeRecoveredAction(attempt, async () => {
    throw new Error('asserção falhou');
  });

  expect(error).toBeInstanceOf(Error);
  expect(actionMs).not.toBeNull();
});

test.describe('sink JSONL', () => {
  let dir: string;

  test.beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'healing-log-'));
  });

  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('grava uma entrada por linha, em arquivo, na ordem de escrita', async ({ page }) => {
    await page.setContent(LISTAGEM);
    const sink = jsonlSink(path.join(dir, 'sub', 'log.jsonl'));

    for (const repetition of [1, 2]) {
      const attempt = await attemptRecovery(page, fingerprint(), { oracle });
      sink.write(completeEntry(attempt, { ...RUN, repetition }, { detectionWaitMs: 0, actionMs: null }));
    }

    const lines = (await readFile(sink.filePath, 'utf8')).trimEnd().split('\n');
    const entries = lines.map((line) => JSON.parse(line) as HealingLogEntry);
    expect(entries.map((entry) => entry.run!.repetition)).toEqual([1, 2]);
    expect(Object.keys(entries[0])).toEqual(
      expect.arrayContaining([
        'rawScore',
        'factors',
        'textSimilarity',
        'heuristics',
        'candidateIsOracle',
        'run',
        'timings',
      ]),
    );
  });
});
