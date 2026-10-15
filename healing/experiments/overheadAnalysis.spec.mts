import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze, quantile, summarize, verdict } from '../../experiments/overheadAnalysis.mts';
import { buildOverheadPlan } from '../../experiments/overheadRun.mts';

/**
 * Estatísticas da medição do custo da captura sobre uma rodada fictícia, com
 * números escolhidos para que cada regra apareça no resultado. Nada toca no site.
 */

test.describe('quantil tipo 7', () => {
  test('mesmos valores do R e do NumPy', () => {
    expect(quantile([4, 1, 3, 2], 0.25)).toBeCloseTo(1.75);
    expect(quantile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5);
    expect(quantile([4, 1, 3, 2], 0.75)).toBeCloseTo(3.25);
    expect(quantile([7], 0.75)).toBe(7);
  });

  test('regra de relato: intervalo interquartil com o zero, inclusive na borda', () => {
    expect(verdict(summarize([-2, -1, 1, 2]))).toMatch(/não distinguível/);
    expect(verdict(summarize([0, 0, 1, 1]))).toMatch(/não distinguível/);
    expect(verdict(summarize([1, 2, 3, 4]))).toBeNull();
  });
});

test.describe('rodada fictícia', () => {
  const TESTS = ['tests/a.spec.ts › um', 'tests/b.spec.ts › dois'];
  let runDir: string;

  const jsonl = (file: string, lines: object[]) =>
    writeFileSync(path.join(runDir, file), lines.map((line) => `${JSON.stringify(line)}\n`).join(''));

  function events(condition: string, id: string, attempt: number, durations: number[], timingMs: number[] = []) {
    const dir = path.join(runDir, condition, id, `attempt-${attempt}`);
    mkdirSync(path.join(dir, 'fingerprints'), { recursive: true });
    const lines = TESTS.map((testId, i) => ({
      testId,
      status: 'passed',
      durationMs: durations[i],
      captureTimings: timingMs.map((ms, j) => ({ phase: j % 2 === 0 ? 'extract' : 'persist', fingerprint: true, ms })),
    }));
    writeFileSync(path.join(dir, 'tests-w0.jsonl'), lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  }

  test.beforeAll(() => {
    runDir = mkdtempSync(path.join(tmpdir(), 'overhead-analysis-'));
    const plan = buildOverheadPlan(TESTS, 3);
    writeFileSync(path.join(runDir, 'plan.json'), JSON.stringify({ plan }));
    writeFileSync(path.join(runDir, 'baseline-fingerprints.json'), JSON.stringify([{ bytes: 100 }, { bytes: 300 }, { bytes: 200 }]));

    // Aquecimento com números absurdos: se entrasse em algo, apareceria.
    events('captura-ligada', 'aquecimento', 1, [99_999, 99_999], [9_999, 9_999]);
    // par-01: a tentativa 1 da ligada foi inválida; vale a tentativa 2.
    events('captura-ligada', 'par-01', 1, [99_999, 99_999], [9_999, 9_999]);
    events('captura-ligada', 'par-01', 2, [1_100, 2_300], [4, 2]);
    events('captura-desligada', 'par-01', 1, [1_000, 2_000]);
    events('captura-ligada', 'par-02', 1, [1_300, 2_100], [6, 2]);
    events('captura-desligada', 'par-02', 1, [1_000, 2_000]);
    // par-03: o lado ligado ficou não medido, então o par sai de tudo.
    events('captura-ligada', 'par-03', 2, [99_999, 99_999], [9_999, 9_999]);
    events('captura-desligada', 'par-03', 1, [99_999, 99_999]);

    jsonl('outcomes.jsonl', [
      { entryId: 'aquecimento', condition: 'captura-ligada', outcome: 'medida' },
      { entryId: 'par-01', condition: 'captura-desligada', outcome: 'medida' },
      { entryId: 'par-01', condition: 'captura-ligada', outcome: 'medida' },
      { entryId: 'par-02', condition: 'captura-ligada', outcome: 'medida' },
      { entryId: 'par-02', condition: 'captura-desligada', outcome: 'medida' },
      { entryId: 'par-03', condition: 'captura-desligada', outcome: 'medida' },
      { entryId: 'par-03', condition: 'captura-ligada', outcome: 'nao-medida' },
    ]);
    jsonl('invocations.jsonl', [
      { entryId: 'aquecimento', condition: 'captura-ligada', attempt: 1, wallMs: 999_999 },
      { entryId: 'par-01', condition: 'captura-desligada', attempt: 1, wallMs: 50_000 },
      { entryId: 'par-01', condition: 'captura-ligada', attempt: 1, wallMs: 999_999, details: { verification: { ok: false } } },
      { entryId: 'par-01', condition: 'captura-ligada', attempt: 2, wallMs: 51_000, details: { verification: { ok: true }, baselineUnchanged: true } },
      { entryId: 'par-02', condition: 'captura-ligada', attempt: 1, wallMs: 53_000, details: { verification: { ok: true }, baselineUnchanged: true } },
      { entryId: 'par-02', condition: 'captura-desligada', attempt: 1, wallMs: 52_000 },
      { entryId: 'par-03', condition: 'captura-desligada', attempt: 1, wallMs: 999_999 },
      { entryId: 'par-03', condition: 'captura-ligada', attempt: 1, wallMs: 999_999 },
      { entryId: 'par-03', condition: 'captura-ligada', attempt: 2, wallMs: 999_999 },
    ]);
  });

  test.afterAll(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  test('par com um lado não medido sai; aquecimento e tentativas anteriores não entram', () => {
    expect(analyze(runDir).pairs).toEqual({ complete: ['par-01', 'par-02'], excluded: ['par-03'] });
  });

  test('custo direto: extração e gravação separadas, e o total por execução de teste', () => {
    const { directCost } = analyze(runDir);

    expect(directCost.extractMs).toMatchObject({ n: 4, median: 5 });
    expect(directCost.persistMs).toMatchObject({ n: 4, median: 2 });
    expect(directCost.perTestExecutionMs).toMatchObject({ n: 4, median: 7 });
  });

  test('duração por teste: mediana por teste e condição, depois a diferença pareada', () => {
    const { perTest } = analyze(runDir);

    // um: medianas 1.200 e 1.000 → +200; dois: 2.200 e 2.000 → +200.
    expect(perTest).toMatchObject({ tests: 2, diffMs: { median: 200, q1: 200, q3: 200 }, verdict: null });
    expect(perTest!.ratio).toBeCloseTo(200 / 1_500);
  });

  test('tempo total por execução: diferença em cada par', () => {
    const { perExecution } = analyze(runDir);

    // par-01: 51.000 − 50.000; par-02: 53.000 − 52.000.
    expect(perExecution).toMatchObject({ diffMs: { n: 2, median: 1_000 }, verdict: null });
    expect(perExecution!.ratio).toBeCloseTo(1_000 / 51_000);
  });

  test('tamanho dos fingerprints versionados', () => {
    expect(analyze(runDir).fingerprintBytes).toEqual({ files: 3, total: 600, min: 100, median: 200, max: 300 });
  });
});
