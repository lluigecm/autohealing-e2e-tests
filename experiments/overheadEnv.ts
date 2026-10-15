import path from 'path';

/**
 * Parâmetros de uma invocação da medição do custo da captura, passados pelo
 * orquestrador (`experiments/overhead.mts`) por variável de ambiente. Lidos no
 * config, nos workers e no reporter, que rodam em processos distintos.
 */

export type CaptureCondition = 'captura-ligada' | 'captura-desligada';

export const CAPTURE_CONDITIONS: readonly CaptureCondition[] = ['captura-desligada', 'captura-ligada'];

export interface OverheadEnv {
  /** `aquecimento` ou `par-NN`. */
  invocation: string;
  condition: CaptureCondition;
  runDir: string;
  attempt: number;
  fingerprintsDir: string;
}

const BASELINE_DIR = path.resolve(__dirname, '..', 'healing', 'fingerprints');

/**
 * Falha alto quando falta algum parâmetro ou quando o ambiente não corresponde
 * à condição: rodar `overhead.config.ts` direto poderia gravar a captura em
 * `healing/fingerprints/`, ou medir com o healing ligado.
 */
export function readOverheadEnv(): OverheadEnv {
  const invocation = process.env.OVERHEAD_INVOCATION;
  const condition = process.env.OVERHEAD_CONDITION as CaptureCondition | undefined;
  const runDir = process.env.OVERHEAD_RUN_DIR;
  const fingerprintsDir = process.env.HEALING_FINGERPRINTS_DIR;

  if (!invocation || !runDir || !fingerprintsDir || !condition || !CAPTURE_CONDITIONS.includes(condition)) {
    throw new Error(
      '[overhead] OVERHEAD_INVOCATION, OVERHEAD_CONDITION (captura-ligada|captura-desligada), OVERHEAD_RUN_DIR e ' +
        'HEALING_FINGERPRINTS_DIR são obrigatórios; rode pelo orquestrador: node experiments/overhead.mts',
    );
  }
  if (process.env.HEALING !== undefined) {
    throw new Error(`[overhead] HEALING tem de estar ausente; está ${process.env.HEALING}`);
  }
  const captureOff = process.env.HEALING_CAPTURE === 'off';
  if (captureOff !== (condition === 'captura-desligada') || (!captureOff && process.env.HEALING_CAPTURE !== undefined)) {
    throw new Error(`[overhead] HEALING_CAPTURE=${process.env.HEALING_CAPTURE ?? '(ausente)'} não corresponde à condição ${condition}`);
  }
  const resolvedRun = path.resolve(runDir);
  const resolvedFingerprints = path.resolve(fingerprintsDir);
  if (resolvedFingerprints === BASELINE_DIR || !resolvedFingerprints.startsWith(resolvedRun + path.sep)) {
    throw new Error(`[overhead] HEALING_FINGERPRINTS_DIR tem de ficar dentro da rodada, nunca na baseline: ${resolvedFingerprints}`);
  }
  const attempt = Number(process.env.OVERHEAD_ATTEMPT ?? '1');
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`[overhead] OVERHEAD_ATTEMPT inválido: ${process.env.OVERHEAD_ATTEMPT}`);
  }
  return { invocation, condition, runDir: resolvedRun, attempt, fingerprintsDir: resolvedFingerprints };
}

/** Diretório de uma tentativa: `<rodada>/<condição>/<invocação>/attempt-<n>/`. */
export function overheadAttemptDir(runDir: string, condition: string, invocation: string, attempt: number): string {
  return path.join(runDir, condition, invocation, `attempt-${attempt}`);
}

/** Tipo da anotação com a duração de uma extração ou de uma gravação. */
export const CAPTURE_TIMING_ANNOTATION = 'overhead-capture-timing';
