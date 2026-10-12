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

/** Durações medidas numa rodada anterior: medianas de passou/falhou e da inicialização por invocação. */
function calibrate(runDir: string, fallback: Costs): Costs {
  const passed: number[] = [];
  const failed: number[] = [];
  for (const condition of CONDITIONS) {
    const dir = path.join(runDir, condition);
    if (!existsSync(dir)) {
      continue;
    }
    for (const file of readdirSync(dir).filter((name) => name.startsWith('tests-'))) {
      for (const event of readJsonl(path.join(dir, file))) {
        (event.status === 'passed' ? passed : failed).push(Number(event.durationMs) / 1000);
      }
    }
  }
  const startups: number[] = [];
  const invocationsFile = path.join(runDir, 'invocations.jsonl');
  if (existsSync(invocationsFile)) {
    for (const inv of readJsonl(invocationsFile)) {
      if (typeof inv.wallMs === 'number' && typeof inv.testsMs === 'number') {
        startups.push((inv.wallMs - inv.testsMs / WORKERS) / 1000);
      }
    }
  }
  const perTest = median(passed) ?? fallback.perTestS;
  const failedMedian = median(failed);
  return {
    perTestS: perTest,
    brokenExtraS: failedMedian === null ? fallback.brokenExtraS : Math.max(0, failedMedian - perTest),
    startupS: median(startups) ?? fallback.startupS,
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

function execute(plan: Invocation[], costs: Costs): void {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(ROOT, 'experiments', 'runs', runId);
  const listsDir = path.join(runDir, 'lists');
  mkdirSync(listsDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'plan.json'),
    `${JSON.stringify({ runId, git: gitState(), workers: WORKERS, costs, plan }, null, 2)}\n`,
  );

  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  plan.forEach((inv, index) => {
    // O `--test-list` é relativo ao `testDir`: os ids do mapa vêm com o prefixo `tests/`.
    const listFile = path.join(listsDir, `${inv.entryId}.txt`);
    writeFileSync(listFile, `${inv.tests.map((id) => id.replace(/^tests\//, '')).join('\n')}\n`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HARNESS_ENTRY: inv.entryId,
      HARNESS_CONDITION: inv.condition,
      HARNESS_RUN_DIR: runDir,
    };
    // Condição desligada = baseline intocada: `HEALING` fica ausente, não `off`.
    delete env.HEALING;
    if (inv.condition === 'healing-on') {
      env.HEALING = 'on';
    }

    console.log(`[${index + 1}/${plan.length}] ${inv.entryId} ${inv.condition} × ${inv.tests.length} testes × ${inv.repeatEach}`);
    const start = Date.now();
    const result = spawnSync(
      process.execPath,
      [cli, 'test', '--config', CONFIG, '--test-list', listFile, '--repeat-each', String(inv.repeatEach)],
      { cwd: ROOT, env, stdio: 'inherit' },
    );
    const wallMs = Date.now() - start;

    const testsMs = sumDurations(runDir, inv);
    appendFileSync(
      path.join(runDir, 'invocations.jsonl'),
      `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, exitCode: result.status, wallMs, testsMs })}\n`,
    );
  });
  console.log(`Rodada em ${path.relative(ROOT, runDir)}`);
}

/** Soma das durações que o reporter gravou para esta invocação. */
function sumDurations(runDir: string, inv: Invocation): number {
  const dir = path.join(runDir, inv.condition);
  if (!existsSync(dir)) {
    return 0;
  }
  let sum = 0;
  for (const file of readdirSync(dir).filter((name) => name.startsWith('tests-'))) {
    for (const event of readJsonl(path.join(dir, file))) {
      if (event.entryId === inv.entryId) {
        sum += Number(event.durationMs);
      }
    }
  }
  return sum;
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
  execute(plan, costs);
} else {
  simulate(plan, costs);
}
