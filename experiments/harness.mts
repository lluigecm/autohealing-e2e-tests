/**
 * Orquestrador do harness dos experimentos.
 *
 *   node experiments/harness.mts                  simulação (padrão): não toca no site
 *   node experiments/harness.mts --run            executa contra o site
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
 * - condições intercaladas por entrada (desligada, depois ligada), para que uma
 *   variação de latência do site no tempo afete as duas igualmente.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG = 'experiments/harness.config.ts';
/** Igual ao `workers` de `harness.config.ts`. */
const WORKERS = 2;
const CONDITIONS = ['healing-off', 'healing-on'] as const;
type Condition = (typeof CONDITIONS)[number];

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

interface Invocation {
  entryId: string;
  group: string;
  locator: MatrixRow['locator'];
  condition: Condition;
  repeatEach: number;
  tests: string[];
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
  for (const row of rows) {
    if (only && !only.has(row.id)) {
      continue;
    }
    const tests = byInstance.get(row.target);
    if (!tests || tests.length === 0) {
      throw new Error(`${row.id}: alvo ${row.target} sem testes no mapa (definição A)`);
    }
    for (const condition of CONDITIONS) {
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

function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
 * Durações medidas numa rodada anterior: medianas de passou/falhou e da
 * inicialização por invocação. Execuções inválidas por infraestrutura ficam fora.
 */
function calibrate(runDir: string, fallback: Costs): Costs {
  const passed: number[] = [];
  const failed: number[] = [];
  for (const event of testEvents(runDir)) {
    if (event.invalid !== true) {
      (event.status === 'passed' ? passed : failed).push(Number(event.durationMs) / 1000);
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
  const perTest = median(passed) ?? fallback.perTestS;
  const failedMedian = median(failed);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    perTestS: round(perTest),
    brokenExtraS: round(failedMedian === null ? fallback.brokenExtraS : Math.max(0, failedMedian - perTest)),
    startupS: round(median(startups) ?? fallback.startupS),
    source: `calibrado em ${path.relative(ROOT, runDir)} (${passed.length} passaram, ${failed.length} falharam, ${startups.length} invocações)`,
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

function runAttempt(runDir: string, listFile: string, inv: Invocation, attempt: number) {
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

/**
 * Executa o plano. Antes de cada tentativa, pré-verifica a home; com três
 * falhas seguidas, aborta a rodada. Uma invocação com execução inválida por
 * infraestrutura roda de novo, inteira, uma única vez; continuando inválida,
 * fica não medida. Teste que falhou por outro motivo nunca é reexecutado.
 */
async function execute(plan: Invocation[], costs: Costs): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(ROOT, 'experiments', 'runs', runId);
  const listsDir = path.join(runDir, 'lists');
  mkdirSync(listsDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'plan.json'),
    `${JSON.stringify({ runId, git: gitState(), node: process.version, workers: WORKERS, costs, plan }, null, 2)}\n`,
  );
  console.log(`Rodada ${runId}`);

  const unmeasured: string[] = [];
  for (const [index, inv] of plan.entries()) {
    // O `--test-list` é relativo ao `testDir`: os ids do mapa vêm com o prefixo `tests/`.
    const listFile = path.join(listsDir, `${inv.entryId}.txt`);
    writeFileSync(listFile, `${inv.tests.map((id) => id.replace(/^tests\//, '')).join('\n')}\n`);

    let outcome: 'medida' | 'nao-medida' = 'nao-medida';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const problems = await precheck();
      if (problems !== null) {
        const aborted = {
          at: new Date().toISOString(),
          invocation: index + 1,
          entryId: inv.entryId,
          condition: inv.condition,
          attempt,
          problems,
        };
        writeFileSync(path.join(runDir, 'aborted.json'), `${JSON.stringify(aborted, null, 2)}\n`);
        console.log(`Rodada ABORTADA na invocação ${index + 1}: pré-verificação falhou 3 vezes (${path.relative(ROOT, runDir)}/aborted.json)`);
        process.exit(2);
      }

      console.log(
        `[${index + 1}/${plan.length}] ${inv.entryId} ${inv.condition} × ${inv.tests.length} testes × ${inv.repeatEach} (tentativa ${attempt})`,
      );
      const result = runAttempt(runDir, listFile, inv, attempt);
      const valid = result.invalidExecutions === 0;
      appendFileSync(
        path.join(runDir, 'invocations.jsonl'),
        `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, attempt, ...result, valid })}\n`,
      );
      if (valid) {
        outcome = 'medida';
        break;
      }
      console.log(`  ${result.invalidExecutions} execução(ões) inválida(s) por infraestrutura`);
    }

    appendFileSync(
      path.join(runDir, 'outcomes.jsonl'),
      `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, outcome })}\n`,
    );
    if (outcome === 'nao-medida') {
      unmeasured.push(`${inv.entryId} ${inv.condition}`);
    }
  }

  console.log(`Rodada concluída em ${path.relative(ROOT, runDir)}`);
  console.log(unmeasured.length === 0 ? 'Todas as invocações medidas.' : `Não medidas: ${unmeasured.join(', ')}`);
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

if (options.get('run') === true) {
  await execute(plan, costs);
} else {
  simulate(plan, costs);
}
