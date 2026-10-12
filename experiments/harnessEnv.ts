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
  return { entryId, condition, runDir: path.resolve(runDir) };
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

/** Arquivo de uma condição e de um worker dentro do diretório da rodada. */
export function workerFile(env: HarnessEnv, kind: 'healing' | 'tests', workerIndex: number): string {
  return path.join(env.runDir, env.condition, `${kind}-w${workerIndex}.jsonl`);
}

/** Tipo da anotação com o estado da mutação em cada página visitada pelo teste. */
export const MUTATION_ANNOTATION = 'harness-mutation';
