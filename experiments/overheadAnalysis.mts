/**
 * Análise da medição do custo da captura, escrita e versionada antes dos dados.
 *
 *   node experiments/overheadAnalysis.mts experiments/results/<rodada>
 *
 * Imprime o resultado em JSON e não escreve nada no diretório da rodada, que é
 * uma cópia sem edição.
 *
 * Entram só os pares completos: os dois lados com desfecho "medida". O
 * aquecimento não entra em nada, e um par com um lado não medido sai de todas
 * as comparações e é listado pelo número. De cada invocação vale a última
 * tentativa. Quartis por interpolação linear entre os valores ordenados (tipo 7
 * de Hyndman e Fan, o padrão do R e do NumPy).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WARMUP } from './overheadRun.mts';
import type { CaptureCondition, OverheadInvocation } from './overheadRun.mts';
import { testEvents } from './runSupport.mts';
import { invocationKey, readJsonl } from './runState.mts';

/** Quantil por interpolação linear (tipo 7). `values` não precisa estar ordenado. */
export function quantile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error('quantil de lista vazia');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface Summary {
  n: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}

export function summarize(values: number[]): Summary {
  return {
    n: values.length,
    median: quantile(values, 0.5),
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const NOT_DISTINGUISHABLE = 'diferença de ponta a ponta não distinguível do ruído da rede';

/** Regra de relato: intervalo interquartil da diferença pareada contendo o zero. */
export function verdict(diff: Summary): string | null {
  return diff.q1 <= 0 && diff.q3 >= 0 ? NOT_DISTINGUISHABLE : null;
}

interface TestEvent {
  testId: string;
  status: string;
  durationMs: number;
  captureTimings: Array<{ phase: 'extract' | 'persist'; fingerprint: boolean; ms: number }>;
}

interface AttemptLine {
  entryId: string;
  condition: CaptureCondition;
  attempt: number;
  wallMs: number;
  details?: { verification?: { ok: boolean }; baselineUnchanged?: boolean };
}

export function analyze(runDir: string) {
  const plan = (JSON.parse(readFileSync(path.join(runDir, 'plan.json'), 'utf8')) as { plan: OverheadInvocation[] }).plan;
  const outcomes = new Map(readJsonl(path.join(runDir, 'outcomes.jsonl')).map((line) => [invocationKey(line), String(line.outcome)]));
  const lastAttempt = new Map<string, AttemptLine>();
  for (const line of readJsonl(path.join(runDir, 'invocations.jsonl')) as unknown as AttemptLine[]) {
    const key = invocationKey(line);
    if (!lastAttempt.has(key) || lastAttempt.get(key)!.attempt < line.attempt) {
      lastAttempt.set(key, line);
    }
  }

  const pairs = [...new Set(plan.map((inv) => inv.entryId).filter((id) => id !== WARMUP))];
  const measured = (id: string, condition: CaptureCondition) => outcomes.get(`${id}|${condition}`) === 'medida';
  const complete = pairs.filter((id) => measured(id, 'captura-ligada') && measured(id, 'captura-desligada'));
  const excluded = pairs.filter((id) => !complete.includes(id));

  const attempt = (id: string, condition: CaptureCondition) => lastAttempt.get(`${id}|${condition}`)!;
  const events = (id: string, condition: CaptureCondition) =>
    testEvents(path.join(runDir, condition, id, `attempt-${attempt(id, condition).attempt}`)) as unknown as TestEvent[];

  // 1. Custo direto.
  const on = complete.flatMap((id) => events(id, 'captura-ligada'));
  const timings = on.flatMap((event) => event.captureTimings);
  const extract = timings.filter((timing) => timing.phase === 'extract').map((timing) => timing.ms);
  const persist = timings.filter((timing) => timing.phase === 'persist').map((timing) => timing.ms);
  const perTest = on.map((event) => event.captureTimings.reduce((sum, timing) => sum + timing.ms, 0));

  // 2. Duração por teste: mediana por teste e condição, depois diferença pareada.
  const durations = new Map<string, Record<CaptureCondition, number[]>>();
  for (const condition of ['captura-ligada', 'captura-desligada'] as const) {
    for (const id of complete) {
      for (const event of events(id, condition)) {
        const entry = durations.get(event.testId) ?? { 'captura-ligada': [], 'captura-desligada': [] };
        entry[condition].push(event.durationMs);
        durations.set(event.testId, entry);
      }
    }
  }
  const perTestDiff: number[] = [];
  const offMedians: number[] = [];
  for (const entry of durations.values()) {
    if (entry['captura-ligada'].length > 0 && entry['captura-desligada'].length > 0) {
      const offMedian = quantile(entry['captura-desligada'], 0.5);
      perTestDiff.push(quantile(entry['captura-ligada'], 0.5) - offMedian);
      offMedians.push(offMedian);
    }
  }

  // 3. Tempo total de cada execução da suíte, pareado por par.
  const wallDiff = complete.map((id) => attempt(id, 'captura-ligada').wallMs - attempt(id, 'captura-desligada').wallMs);
  const wallOff = complete.map((id) => attempt(id, 'captura-desligada').wallMs);

  // 4. Tamanho dos fingerprints versionados.
  const bytes = (JSON.parse(readFileSync(path.join(runDir, 'baseline-fingerprints.json'), 'utf8')) as Array<{ bytes: number }>).map(
    (file) => file.bytes,
  );

  const perTestSummary = perTestDiff.length > 0 ? summarize(perTestDiff) : null;
  const wallSummary = wallDiff.length > 0 ? summarize(wallDiff) : null;

  return {
    pairs: { complete, excluded },
    directCost: {
      extractMs: extract.length > 0 ? summarize(extract) : null,
      persistMs: persist.length > 0 ? summarize(persist) : null,
      perTestExecutionMs: perTest.length > 0 ? summarize(perTest) : null,
      extractionsWithoutFingerprint: timings.filter((timing) => timing.phase === 'extract' && !timing.fingerprint).length,
    },
    perTest: perTestSummary && {
      tests: perTestDiff.length,
      diffMs: perTestSummary,
      ratio: perTestSummary.median / quantile(offMedians, 0.5),
      verdict: verdict(perTestSummary),
    },
    perExecution: wallSummary && {
      diffMs: wallSummary,
      ratio: wallSummary.median / quantile(wallOff, 0.5),
      verdict: verdict(wallSummary),
    },
    fingerprintBytes: { files: bytes.length, total: bytes.reduce((a, b) => a + b, 0), min: Math.min(...bytes), median: quantile(bytes, 0.5), max: Math.max(...bytes) },
    anomalies: {
      failedVerifications: [...lastAttempt.values()]
        .filter((line) => line.details?.verification?.ok === false || line.details?.baselineUnchanged === false)
        .map((line) => invocationKey(line)),
      testsNotPassed: complete.flatMap((id) =>
        (['captura-ligada', 'captura-desligada'] as const).flatMap((condition) =>
          events(id, condition)
            .filter((event) => event.status !== 'passed')
            .map((event) => `${id}|${condition}|${event.testId}|${event.status}`),
        ),
      ),
    },
  };
}

if (import.meta.main) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('uso: node experiments/overheadAnalysis.mts experiments/results/<rodada>');
    process.exit(1);
  }
  console.log(JSON.stringify(analyze(path.resolve(runDir)), null, 2));
}
