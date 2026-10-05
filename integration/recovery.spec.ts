import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Fingerprint } from '../healing/fingerprint';
import { fingerprintPath } from '../healing/fingerprintStore';
import { HealingLogEntry } from '../healing/decision/decide';
import { attemptRecovery, completeEntry, jsonlSink } from '../healing/decision/recovery';
import { findMutation } from '../mutation/catalog';
import { applyMutation, pointsToOracle } from '../mutation/applyMutation';

/**
 * Tentativa de recuperação instrumentada no alvo real, com mutação do catálogo
 * e o oráculo de verdade. Não é a rodada de experimentos: só mostra que o log
 * gravado tem o que a ablação precisa, inclusive `candidateIsOracle` sobre um
 * candidato recusado.
 */

async function loadFingerprint(key: { url: string; selector: string }): Promise<Fingerprint> {
  return JSON.parse(await readFile(fingerprintPath(key), 'utf8')) as Fingerprint;
}

let dir: string;

test.beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'healing-log-'));
});

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('M1 e M3 no primeiro card: log JSONL com bruto, fatores e oráculo', async ({ context }) => {
  const sink = jsonlSink(path.join(dir, 'log.jsonl'));

  for (const id of ['M1-T2', 'M3-T2']) {
    const spec = findMutation(id);
    const fingerprint = await loadFingerprint(spec.target.baseline);
    const page = await context.newPage();
    await applyMutation(page, spec);
    await page.goto(fingerprint.url);

    const attempt = await attemptRecovery(page, fingerprint, { oracle: pointsToOracle });
    sink.write(
      completeEntry(
        attempt,
        { entryId: id, testId: 'home', repetition: 1, condition: 'healing-on' },
        { detectionWaitMs: 0, actionMs: null },
      ),
    );
    await page.close();
  }

  // Lido só depois de todas as tentativas, fora de qualquer janela medida.
  const [m1, m3] = (await readFile(sink.filePath, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as HealingLogEntry);

  // M1 reescreve class e id: a geometria e o texto continuam valendo.
  expect(m1.decision).toBe('replace');
  expect(m1.candidateIsOracle).toBe(true);

  // M3 inverte os cards: o bruto é perfeito, o candidato está errado, e só o
  // fator de texto o separa. Sem esse fator, a configuração teria substituído.
  expect(m3.decision).toBe('fail');
  expect(m3.rawScore).toBeCloseTo(1);
  expect(m3.factors!.text).toBeLessThan(1);
  expect(m3.candidateIsOracle).toBe(false);
  expect(m3.heuristics.find((h) => h.heuristic === 'stable-attributes')!.applicable).toBe(false);
});
