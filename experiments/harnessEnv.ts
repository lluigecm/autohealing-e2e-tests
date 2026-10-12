import path from 'path';
import { HealingCondition } from '../healing/decision/decide';

/**
 * Parâmetros de uma invocação do harness, passados pelo orquestrador
 * (`experiments/harness.mts`) por variável de ambiente. Lidos no config, nos
 * workers e no reporter, que rodam em processos distintos.
 */
export interface HarnessEnv {
  entryId: string;
  condition: HealingCondition;
  runDir: string;
  /** Tentativa da invocação, a partir de 1: há uma segunda só após falha de infraestrutura. */
  attempt: number;
}

const CONDITIONS: readonly HealingCondition[] = ['healing-on', 'healing-off'];

/**
 * Falha alto quando falta algum parâmetro: rodar `harness.config.ts` direto
 * executaria a suíte sem mutação e produziria dados que parecem de uma rodada.
 * Também confere que `HEALING` corresponde à condição.
 */
export function readHarnessEnv(): HarnessEnv {
  const entryId = process.env.HARNESS_ENTRY;
  const condition = process.env.HARNESS_CONDITION as HealingCondition | undefined;
  const runDir = process.env.HARNESS_RUN_DIR;

  if (!entryId || !runDir || !condition || !CONDITIONS.includes(condition)) {
    throw new Error(
      '[harness] HARNESS_ENTRY, HARNESS_CONDITION (healing-on|healing-off) e HARNESS_RUN_DIR são obrigatórios; ' +
        'rode pelo orquestrador: node experiments/harness.mts',
    );
  }
  const healingOn = process.env.HEALING === 'on';
  if (healingOn !== (condition === 'healing-on')) {
    throw new Error(`[harness] HEALING=${process.env.HEALING ?? '(ausente)'} não corresponde à condição ${condition}`);
  }
  const attempt = Number(process.env.HARNESS_ATTEMPT ?? '1');
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`[harness] HARNESS_ATTEMPT inválido: ${process.env.HARNESS_ATTEMPT}`);
  }
  return { entryId, condition, runDir: path.resolve(runDir), attempt };
}

/** Raiz do repositório: os ids de teste do mapa são relativos a ela (`tests/...`). */
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Id de teste no formato de `mutation/target-test-map.json`:
 * `tests/<arquivo> › <describe…> › <título>`.
 */
export function harnessTestId(file: string, titles: readonly string[]): string {
  const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  return [relative, ...titles].join(' › ');
}

/** Diretório de uma tentativa de invocação: `<rodada>/<condição>/<entrada>/attempt-<n>/`. */
export function attemptDir(runDir: string, condition: HealingCondition, entryId: string, attempt: number): string {
  return path.join(runDir, condition, entryId, `attempt-${attempt}`);
}

/** Arquivo de um worker dentro da tentativa. */
export function workerFile(env: HarnessEnv, kind: 'healing' | 'tests', workerIndex: number): string {
  return path.join(attemptDir(env.runDir, env.condition, env.entryId, env.attempt), `${kind}-w${workerIndex}.jsonl`);
}

/** Tipo da anotação com o estado da mutação em cada página visitada pelo teste. */
export const MUTATION_ANNOTATION = 'harness-mutation';

/**
 * Tipo da anotação com um sinal estruturado de falha de infraestrutura: falha
 * de navegação do documento principal ou status HTTP de erro no `goto`.
 */
export const INFRA_ANNOTATION = 'harness-infra';

export interface InfraSignal {
  kind: 'navigation-failed' | 'http-error';
  url: string;
  /** Status HTTP, quando `http-error`. */
  status?: number;
  /** Código de falha da requisição, quando `navigation-failed`; só registro, não classifica. */
  failure?: string | null;
}
