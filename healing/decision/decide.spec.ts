import { test, expect, Page } from '@playwright/test';
import { Fingerprint } from '../fingerprint';
import { ConfidenceResult } from './confidenceScore';
import {
  CONFIDENCE_THRESHOLD,
  HealingLogEntry,
  clearHealingLog,
  decide,
  formatHealingLogEntry,
  healingLog,
} from './decide';

/**
 * Testes unitários da camada de decisão. Alimentada com `ConfidenceResult`s
 * construídos à mão: a Camada 2 não existe, então não há falha real de locator
 * para disparar o fluxo, e a decisão é testável isoladamente.
 */

function fingerprint(): Fingerprint {
  return {
    selector: 'role=article',
    url: '/catalogue/category/books/art_25/index.html',
    tag: 'article',
    text: 'Wall and Piece',
    attributes: { stable: {}, volatile: { class: 'product_pod', id: null } },
    position: { parentTag: 'li', parentSiblingIndex: 0, siblingIndex: 0, depth: 3 },
  };
}

function confidence(overrides: Partial<ConfidenceResult> = {}): ConfidenceResult {
  return {
    score: 1,
    locator: null,
    contributingHeuristics: [
      {
        heuristic: 'structural-similarity',
        score: 1,
        matched: true,
        ambiguous: false,
        candidateCount: 1,
      },
    ],
    flags: [],
    reason: null,
    textSimilarity: 1,
    rawScore: 1,
    factors: { disagreement: 1, ambiguity: 1, text: 1 },
    heuristics: [
      {
        heuristic: 'stable-attributes',
        applicable: false,
        matched: false,
        score: 0,
        ambiguous: false,
        candidateCount: 0,
        candidate: null,
      },
      {
        heuristic: 'structural-similarity',
        applicable: true,
        matched: true,
        score: 1,
        ambiguous: false,
        candidateCount: 1,
        candidate: "locator('li:nth-child(1) article')",
      },
    ],
    ...overrides,
  };
}

/** Timestamp fixo: o log é asserção de teste, não pode depender do relógio. */
const AGORA = new Date('2026-10-02T12:00:00.000Z');
const options = { now: () => AGORA };

test.beforeEach(() => {
  clearHealingLog();
});

test.describe('limiar', () => {
  test('acima do limiar substitui e devolve o candidato', async ({ page }) => {
    const locator = await candidato(page);

    const result = decide(fingerprint(), confidence({ score: 0.95, locator }), options);

    expect(result.decision).toBe('replace');
    expect(result.locator).toBe(locator);
  });

  test('exatamente no limiar substitui', async ({ page }) => {
    const locator = await candidato(page);

    // O limiar é inclusivo. Fixado em teste porque é fronteira de decisão, e
    // mover a fronteira sem perceber é como um falso positivo entra na suíte.
    const result = decide(
      fingerprint(),
      confidence({ score: CONFIDENCE_THRESHOLD, locator }),
      options,
    );

    expect(result.decision).toBe('replace');
  });

  test('abaixo do limiar falha sem tentar recuperação', async ({ page }) => {
    const locator = await candidato(page);

    const result = decide(fingerprint(), confidence({ score: 0.5, locator }), options);

    expect(result.decision).toBe('fail');
    // Não devolve o candidato: o chamador não tem como usá-lo por engano.
    expect(result.locator).toBeNull();
  });

  test('o limiar é ajustável sem editar código', async ({ page }) => {
    const locator = await candidato(page);
    const baixa = confidence({ score: 0.5, locator });

    expect(decide(fingerprint(), baixa, options).decision).toBe('fail');
    // 0.7 é provisório, e a etapa de experimentos vai
    // varrer valores sem precisar de alteração de código.
    expect(decide(fingerprint(), baixa, { ...options, threshold: 0.4 }).decision).toBe('replace');
  });

  test('"sem confiança" força o caminho de falha', async () => {
    const result = decide(
      fingerprint(),
      confidence({ score: null, locator: null, reason: 'no-applicable-heuristic' }),
      options,
    );

    expect(result.decision).toBe('fail');
    expect(result.score).toBeNull();
    // Registrado à parte de "mediu e não bastou": somar os dois inflaria a taxa
    // de falha de recuperação com casos que a heurística não teve como tratar.
    expect(result.entry.reason).toBe('no-applicable-heuristic');
  });
});

test.describe('log estruturado', () => {
  test('a substituição é registrada com o que a revisão humana precisa', async ({ page }) => {
    const locator = await candidato(page);

    const { entry } = decide(
      fingerprint(),
      confidence({ score: 0.95, locator, flags: ['heuristics-agree'] }),
      options,
    );

    expect(entry.decision).toBe('replace');
    expect(entry.url).toBe('/catalogue/category/books/art_25/index.html');
    expect(entry.originalSelector).toBe('role=article');
    expect(entry.candidate).toContain('article');
    expect(entry.score).toBeCloseTo(0.95);
    expect(entry.threshold).toBe(CONFIDENCE_THRESHOLD);
    expect(entry.contributingHeuristics).toHaveLength(1);
    expect(entry.flags).toEqual(['heuristics-agree']);
    // Timestamp da decisão, não do fingerprint.
    expect(entry.decidedAt).toBe('2026-10-02T12:00:00.000Z');
  });

  test('a entrada carrega o que a ablação offline precisa', async ({ page }) => {
    const locator = await candidato(page);

    const { entry } = decide(
      fingerprint(),
      confidence({
        score: 0.25,
        locator,
        rawScore: 1,
        factors: { disagreement: 1, ambiguity: 0.5, text: 0.5 },
        textSimilarity: 0.3,
      }),
      options,
    );

    expect(entry.rawScore).toBe(1);
    expect(entry.factors).toEqual({ disagreement: 1, ambiguity: 0.5, text: 0.5 });
    expect(entry.textSimilarity).toBe(0.3);
    expect(entry.heuristics.map((h) => [h.heuristic, h.applicable])).toEqual([
      ['stable-attributes', false],
      ['structural-similarity', true],
    ]);
    // Só o harness de experimentos preenche estes: `decide` sozinho não mede nem tem oráculo.
    expect(entry.candidateIsOracle).toBeNull();
    expect(entry.run).toBeNull();
    expect(entry.timings).toBeNull();
  });

  test('a falha também é registrada, porque sem ela não há denominador', async ({ page }) => {
    const locator = await candidato(page);

    decide(fingerprint(), confidence({ score: 0.95, locator }), options);
    decide(fingerprint(), confidence({ score: 0.3, locator }), options);
    decide(fingerprint(), confidence({ score: null, locator: null }), options);

    expect(healingLog().map((entry) => entry.decision)).toEqual(['replace', 'fail', 'fail']);
  });

  test('o sink do log é injetável', async ({ page }) => {
    const locator = await candidato(page);
    const registradas: HealingLogEntry[] = [];

    decide(fingerprint(), confidence({ score: 0.95, locator }), { ...options, record: (entry) => registradas.push(entry) });

    expect(registradas).toHaveLength(1);
    // Não vazou para o log global: cada teste e cada experimento isola o seu.
    expect(healingLog()).toHaveLength(0);
  });

  test('a formatação de uma linha mostra decisão, score e heurísticas', async ({ page }) => {
    const locator = await candidato(page);

    const { entry } = decide(
      fingerprint(),
      confidence({ score: 0.5, locator, flags: ['unresolved-ambiguity'] }),
      options,
    );
    const linha = formatHealingLogEntry(entry);

    expect(linha).toContain('FALHOU');
    expect(linha).toContain('role=article');
    expect(linha).toContain('score=0.500');
    expect(linha).toContain('structural-similarity=1.000');
    expect(linha).toContain('unresolved-ambiguity');
  });

  test('"sem confiança" aparece como tal na linha, não como zero', async () => {
    const { entry } = decide(
      fingerprint(),
      confidence({
        score: null,
        locator: null,
        contributingHeuristics: [],
        reason: 'no-applicable-heuristic',
      }),
      options,
    );

    const linha = formatHealingLogEntry(entry);

    expect(linha).toContain('sem confiança');
    expect(linha).toContain('nenhuma aplicável');
    expect(linha).not.toContain('score=0.000');
  });
});

/** Um locator real: `String(locator)` é o que vai para o log, e precisa ser o de verdade. */
async function candidato(page: Page) {
  await page.setContent('<main><ol><li><article>Wall and Piece</article></li></ol></main>');
  return page.locator('li:nth-child(1) article');
}
