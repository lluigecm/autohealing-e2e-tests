/**
 * Orquestrador do harness dos experimentos.
 *
 *   node experiments/harness.mts                  simulação (padrão): não toca no site
 *   node experiments/harness.mts --run            executa contra o site
 *   node experiments/harness.mts --resume experiments/runs/<rodada>
 *                                                 retoma uma rodada interrompida
 *
 * Opções: --entries M1-T8,M5-T2 (subconjunto), --per-test-s 3, --broken-extra-s 5,
 * --startup-s 5, --calibrate-from experiments/runs/<rodada>.
 *
 * Roda com o Node puro (que executa TypeScript sem dependência nova) e chama o
 * CLI do Playwright por `process.execPath`, sem shell: funciona igual no
 * PowerShell e no bash. Não importa módulos do projeto, só lê os JSON gerados.
 *
 * O plano sai da matriz versionada e do mapa teste → alvo:
 * - testes de cada entrada: definição A do mapa (o locator resolve o alvo ou passa por ele);
 * - repetições: 3 por teste e condição para as entradas que quebram ou desviam
 *   o locator, 1 para as inertes;
 * - condições intercaladas por entrada, alternando qual vai primeiro (entrada
 *   de posição par: desligada antes; ímpar: ligada antes), para que a deriva do
 *   site ao longo da rodada não caia numa condição só.
 *
 * `--run` e `--resume` exigem a árvore do git limpa, e `--resume` exige o mesmo
 * commit da rodada interrompida: só as invocações sem desfecho registrado rodam,
 * e as concluídas nunca rodam de novo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { executeRun, prepareResume, readJsonl } from './runState.mts';
import type { AttemptResult, Condition, Invocation } from './runState.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG = 'experiments/harness.config.ts';
/** Igual ao `workers` de `harness.config.ts`. */
const WORKERS = 2;
const CONDITIONS: readonly Condition[] = ['healing-off', 'healing-on'];

interface MatrixRow {
  id: string;
  code: string;
  target: string;
  class: 'cosmetic' | 'defect';
  locator: 'inerte' | 'quebra' | 'desvia';
  test: string;
  reproducedTest: string;
}

interface TargetMap {
  testes: Array<{ id: string; chamadas: Array<{ alvos?: Array<{ instancia: string }> }> }>;
}

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8')) as T;
}

function args(): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed.set(name, next);
      i += 1;
    } else {
      parsed.set(name, true);
    }
  }
  return parsed;
}

/** Definição A: qualquer relação do locator com o alvo, inclusive por coleção ou ancestral. */
function testsByInstance(map: TargetMap): Map<string, string[]> {
  const byInstance = new Map<string, Set<string>>();
  for (const test of map.testes) {
    for (const call of test.chamadas) {
      for (const hit of call.alvos ?? []) {
        if (!byInstance.has(hit.instancia)) {
          byInstance.set(hit.instancia, new Set());
        }
        byInstance.get(hit.instancia)!.add(test.id);
      }
    }
  }
  // Ordem do mapa, que é estável: a mesma rodada sempre gera as mesmas listas.
  const order = new Map(map.testes.map((test, index) => [test.id, index]));
  return new Map(
    [...byInstance].map(([instance, ids]) => [instance, [...ids].sort((a, b) => order.get(a)! - order.get(b)!)]),
  );
}

function groupOf(row: MatrixRow): string {
  if (row.locator === 'desvia') {
    return 'desvia';
  }
  if (row.locator === 'inerte') {
    return 'inerte';
  }
  return row.class === 'cosmetic' ? 'denominador recuperação' : 'denominador falso positivo';
}

function buildPlan(only: Set<string> | null): Invocation[] {
  const rows = readJson<{ linhas: MatrixRow[] }>('mutation/effectiveness-matrix.json').linhas;
  const byInstance = testsByInstance(readJson<TargetMap>('mutation/target-test-map.json'));

  const unknown = only ? [...only].filter((id) => !rows.some((row) => row.id === id)) : [];
  if (unknown.length > 0) {
    throw new Error(`entradas fora da matriz: ${unknown.join(', ')}`);
  }

  const plan: Invocation[] = [];
  const selected = rows.filter((row) => !only || only.has(row.id));
  for (const [position, row] of selected.entries()) {
    const tests = byInstance.get(row.target);
    if (!tests || tests.length === 0) {
      throw new Error(`${row.id}: alvo ${row.target} sem testes no mapa (definição A)`);
    }
    // Alterna qual condição abre a entrada: a deriva ao longo da rodada se divide entre as duas.
    const order = position % 2 === 0 ? CONDITIONS : [...CONDITIONS].reverse();
    for (const condition of order) {
      plan.push({
        entryId: row.id,
        group: groupOf(row),
        locator: row.locator,
        condition,
        repeatEach: row.locator === 'inerte' ? 1 : 3,
        tests,
      });
    }
  }
  return plan;
}

interface Costs {
  perTestS: number;
  brokenExtraS: number;
  startupS: number;
  source: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Todos os eventos `tests-*.jsonl` sob um diretório, recursivamente. */
function testEvents(dir: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => path.basename(name).startsWith('tests-') && name.endsWith('.jsonl'))
    .flatMap((name) => readJsonl(path.join(dir, name)));
}

/**
 * Durações medidas numa rodada anterior: medianas por estado do locator na
 * matriz (intacto ou quebrado) e da inicialização por invocação. O estado da
 * matriz, e não o desfecho, separa os custos: um teste que passou por
 * recuperação também pagou a espera da detecção. Execuções inválidas por
 * infraestrutura ficam fora.
 */
function calibrate(runDir: string, fallback: Costs): Costs {
  const locatorOf = new Map(
    readJson<{ linhas: MatrixRow[] }>('mutation/effectiveness-matrix.json').linhas.map((row) => [row.id, row.locator]),
  );
  const intact: number[] = [];
  const broken: number[] = [];
  for (const event of testEvents(runDir)) {
    if (event.invalid !== true) {
      (locatorOf.get(String(event.entryId)) === 'quebra' ? broken : intact).push(Number(event.durationMs) / 1000);
    }
  }
  const startups: number[] = [];
  const invocationsFile = path.join(runDir, 'invocations.jsonl');
  if (existsSync(invocationsFile)) {
    for (const inv of readJsonl(invocationsFile)) {
      if (inv.valid === true && typeof inv.wallMs === 'number' && typeof inv.testsMs === 'number') {
        startups.push((inv.wallMs - inv.testsMs / WORKERS) / 1000);
      }
    }
  }
  const perTest = median(intact) ?? fallback.perTestS;
  const brokenMedian = median(broken);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    perTestS: round(perTest),
    brokenExtraS: round(brokenMedian === null ? fallback.brokenExtraS : Math.max(0, brokenMedian - perTest)),
    startupS: round(median(startups) ?? fallback.startupS),
    source:
      `calibrado em ${path.relative(ROOT, runDir)} ` +
      `(${intact.length} execuções com locator intacto, ${broken.length} com locator quebrado, ${startups.length} invocações)`,
  };
}

/**
 * Estimativa por invocação: inicialização + soma das execuções dividida pelos
 * workers, com piso na execução mais longa. Supõe que, numa entrada que quebra
 * o locator, todos os testes mapeados quebram, o que é uma aproximação: a matriz
 * só mediu o teste reproduzido.
 */
function estimateS(inv: Invocation, costs: Costs): number {
  const executions = inv.tests.length * inv.repeatEach;
  const each = costs.perTestS + (inv.locator === 'quebra' ? costs.brokenExtraS : 0);
  return costs.startupS + Math.max(each, (executions * each) / WORKERS);
}

function hms(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min${String(sec).padStart(2, '0')}s`;
}

function simulate(plan: Invocation[], costs: Costs): void {
  const groups = ['denominador recuperação', 'denominador falso positivo', 'desvia', 'inerte'];
  const rows = groups.map((group) => {
    const invs = plan.filter((inv) => inv.group === group);
    const executions = invs.reduce((sum, inv) => sum + inv.tests.length * inv.repeatEach, 0);
    const broken = invs.filter((inv) => inv.locator === 'quebra').reduce((s, inv) => s + inv.tests.length * inv.repeatEach, 0);
    return {
      grupo: group,
      entradas: new Set(invs.map((inv) => inv.entryId)).size,
      repeticoes: invs[0]?.repeatEach ?? 0,
      invocacoes: invs.length,
      execucoes: executions,
      'execuções com locator quebrado (est.)': broken,
      tempo: hms(invs.reduce((sum, inv) => sum + estimateS(inv, costs), 0)),
    };
  });

  console.log('Simulação — nenhuma execução contra o site.\n');
  console.table(rows);
  const executions = plan.reduce((sum, inv) => sum + inv.tests.length * inv.repeatEach, 0);
  const perCondition = Object.fromEntries(
    CONDITIONS.map((c) => [c, plan.filter((inv) => inv.condition === c).reduce((s, inv) => s + inv.tests.length * inv.repeatEach, 0)]),
  );
  const total = plan.reduce((sum, inv) => sum + estimateS(inv, costs), 0);
  console.log(`Entradas: ${new Set(plan.map((inv) => inv.entryId)).size}`);
  console.log(`Invocações do Playwright: ${plan.length}`);
  console.log(`Execuções de teste: ${executions} (${CONDITIONS.map((c) => `${c} ${perCondition[c]}`).join(', ')})`);
  console.log(`Tempo estimado: ${hms(total)} com ${WORKERS} workers`);
  const opensWith = (condition: Condition) =>
    plan.filter((inv, index) => index % 2 === 0 && inv.condition === condition).length;
  console.log(
    `Ordem: condições intercaladas por entrada; abre com healing-off em ${opensWith('healing-off')} entradas e com healing-on em ${opensWith('healing-on')}. ` +
      `Primeiras: ${plan.slice(0, 4).map((inv) => `${inv.entryId}/${inv.condition}`).join(', ')}`,
  );
  console.log(
    `Custos: ${costs.perTestS}s por teste, +${costs.brokenExtraS}s com locator quebrado, ` +
      `${costs.startupS}s de inicialização por invocação — ${costs.source}`,
  );
}

function gitState(): { commit: string; dirty: boolean } {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  return { commit, dirty: status.length > 0 };
}

const HOME_URL = 'https://books.toscrape.com/index.html';
const HOME_TITLE = 'All products | Books to Scrape - Sandbox';
/** Esperas entre as tentativas da pré-verificação: 3 tentativas no total. */
const PRECHECK_WAITS_MS = [15_000, 60_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Home com status 200 e o título esperado. Devolve o motivo da falha, ou `null`. */
async function homeProblem(): Promise<string | null> {
  try {
    const response = await fetch(HOME_URL, { signal: AbortSignal.timeout(15_000) });
    if (response.status !== 200) {
      return `status ${response.status}`;
    }
    const raw = (await response.text()).match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const title = raw.replace(/\s+/g, ' ').trim();
    return title === HOME_TITLE ? null : `título inesperado: ${JSON.stringify(title)}`;
  } catch (error) {
    return `requisição falhou: ${String(error)}`;
  }
}

/** Até 3 tentativas com espera. Devolve as falhas se todas falharem, ou `null`. */
async function precheck(): Promise<string[] | null> {
  const problems: string[] = [];
  for (let attempt = 0; attempt <= PRECHECK_WAITS_MS.length; attempt += 1) {
    const problem = await homeProblem();
    if (problem === null) {
      return null;
    }
    problems.push(`${new Date().toISOString()} ${problem}`);
    console.log(`[pré-verificação] falhou: ${problem}`);
    if (attempt < PRECHECK_WAITS_MS.length) {
      await sleep(PRECHECK_WAITS_MS[attempt]);
    }
  }
  return problems;
}

/** Diretório de uma tentativa; o mesmo de `attemptDir` em `harnessEnv.ts`. */
function attemptPath(runDir: string, inv: Invocation, attempt: number): string {
  return path.join(runDir, inv.condition, inv.entryId, `attempt-${attempt}`);
}

function runAttempt(runDir: string, listFile: string, inv: Invocation, attempt: number): AttemptResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_ENTRY: inv.entryId,
    HARNESS_CONDITION: inv.condition,
    HARNESS_RUN_DIR: runDir,
    HARNESS_ATTEMPT: String(attempt),
  };
  // Condição desligada = baseline intocada: `HEALING` fica ausente, não `off`.
  delete env.HEALING;
  if (inv.condition === 'healing-on') {
    env.HEALING = 'on';
  }

  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '--config', CONFIG, '--test-list', listFile, '--repeat-each', String(inv.repeatEach)],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
  const wallMs = Date.now() - start;

  const events = testEvents(attemptPath(runDir, inv, attempt));
  return {
    exitCode: result.status,
    wallMs,
    testsMs: events.reduce((sum, event) => sum + Number(event.durationMs), 0),
    executions: events.length,
    expectedExecutions: inv.tests.length * inv.repeatEach,
    invalidExecutions: events.filter((event) => event.invalid === true).length,
  };
}

interface RunState {
  runDir: string;
  plan: Invocation[];
  /** Invocações com desfecho registrado (`entrada|condição`): nunca rodam de novo. */
  done: Set<string>;
}

function requireCleanTree(): { commit: string; dirty: boolean } {
  const state = gitState();
  if (state.dirty) {
    console.error('[harness] árvore do git com mudanças: commite antes de rodar (`git status --porcelain` não está vazio).');
    process.exit(3);
  }
  return state;
}

function newRun(plan: Invocation[], costs: Costs): RunState {
  const git = requireCleanTree();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(ROOT, 'experiments', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'plan.json'),
    `${JSON.stringify({ runId, git, node: process.version, workers: WORKERS, costs, plan }, null, 2)}\n`,
  );
  console.log(`Rodada ${runId}`);
  return { runDir, plan, done: new Set() };
}

/** Retomada de uma rodada interrompida: as regras estão em `prepareResume`. */
function resumeRun(runDirArg: string): RunState {
  const runDir = path.resolve(ROOT, runDirArg);
  const git = requireCleanTree();
  try {
    const { plan: saved, done, moved } = prepareResume(runDir, git.commit);
    console.log(
      `Retomando ${path.relative(ROOT, runDir)}: ${done.size} concluídas, ${saved.length - done.size} pendentes` +
        (moved.length > 0 ? `; tentativas parciais movidas para interrompidas/: ${moved.join(', ')}` : '') +
        '.',
    );
    return { runDir, plan: saved, done };
  } catch (error) {
    console.error(`[harness] ${(error as Error).message}`);
    process.exit(3);
  }
}

/** Executa as invocações pendentes com a pré-verificação e o Playwright reais; regras em `executeRun`. */
async function execute(run: RunState): Promise<void> {
  const outcome = await executeRun(run, { precheck, runAttempt, log: (line) => console.log(line) });
  const where = path.relative(ROOT, run.runDir);
  if (outcome.status === 'aborted') {
    console.log(`Rodada ABORTADA: ${outcome.reason} (${where}/aborted.json)`);
    process.exit(outcome.exitCode);
  }
  console.log(`Rodada concluída em ${where}`);
  console.log(
    outcome.unmeasured.length === 0
      ? 'Todas as invocações desta execução medidas.'
      : `Não medidas: ${outcome.unmeasured.join(', ')}`,
  );
}

const options = args();
const only = typeof options.get('entries') === 'string' ? new Set(String(options.get('entries')).split(',')) : null;
const plan = buildPlan(only);
const defaults: Costs = {
  perTestS: Number(options.get('per-test-s') ?? 3),
  brokenExtraS: Number(options.get('broken-extra-s') ?? 5),
  startupS: Number(options.get('startup-s') ?? 5),
  source: 'parâmetros padrão, sem rodada anterior',
};
const calibrateFrom = options.get('calibrate-from');
const costs = typeof calibrateFrom === 'string' ? calibrate(path.resolve(ROOT, calibrateFrom), defaults) : defaults;

const resume = options.get('resume');
if (typeof resume === 'string') {
  await execute(resumeRun(resume));
} else if (options.get('run') === true) {
  await execute(newRun(plan, costs));
} else {
  simulate(plan, costs);
}
