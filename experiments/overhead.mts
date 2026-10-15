/**
 * Orquestrador da medição complementar do custo da captura de fingerprint.
 *
 *   node experiments/overhead.mts                 simulação (padrão): não toca no site
 *   node experiments/overhead.mts --run           executa contra o site
 *   node experiments/overhead.mts --resume experiments/runs/<rodada>
 *                                                 retoma uma rodada interrompida
 *
 * Opções da simulação: --per-test-s 1.5, --startup-s 5.2.
 *
 * Roda os 66 testes sem mutação e com o healing desligado, com a captura
 * ligada ou desligada: 1 aquecimento com a captura ligada, descartado, e 10
 * pares com a ordem alternando entre eles. A captura grava num diretório por
 * tentativa dentro da rodada, preenchido antes com os fingerprints versionados
 * quando a captura está ligada e vazio quando está desligada.
 *
 * Valem as regras do harness: árvore limpa, pré-verificação da home antes de
 * cada tentativa, reexecução única da invocação com execução inválida por
 * infraestrutura, aborto sem desfecho de invocação incompleta e retomada no
 * mesmo commit.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  buildOverheadPlan,
  hashDir,
  loadBaseline,
  prefill,
  verifyCapture,
  WARMUP,
} from './overheadRun.mts';
import type { Baseline, OverheadInvocation } from './overheadRun.mts';
import { precheck, requireCleanTree, testEvents } from './runSupport.mts';
import { executeRun, prepareResume } from './runState.mts';
import type { AttemptResult } from './runState.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG = 'experiments/overhead.config.ts';
const BASELINE_DIR = path.join(ROOT, 'healing', 'fingerprints');
/** Igual ao `workers` de `overhead.config.ts`. */
const WORKERS = 2;
const TAG = 'overhead';
const require = createRequire(import.meta.url);

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

/** Os 66 testes da suíte, na ordem do mapa teste → alvo. */
function suiteTests(): string[] {
  const map = JSON.parse(readFileSync(path.join(ROOT, 'mutation', 'target-test-map.json'), 'utf8')) as {
    testes: Array<{ id: string }>;
  };
  const tests = map.testes.map((test) => test.id);
  if (tests.length !== 66) {
    throw new Error(`o mapa teste → alvo tem ${tests.length} testes, não 66`);
  }
  return tests;
}

/** Data com o fuso local, ex.: 2026-10-15T10:00:00.000-03:00. */
function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, '0');
  const local = new Date(date.getTime() + offset * 60_000).toISOString().replace('Z', '');
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

function hms(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min${String(sec).padStart(2, '0')}s`;
}

function simulate(plan: OverheadInvocation[], perTestS: number, startupS: number): void {
  console.log('Simulação — nenhuma execução contra o site.\n');
  const each = startupS + (plan[0].tests.length * perTestS) / WORKERS;
  for (const [index, inv] of plan.entries()) {
    console.log(`[${index + 1}/${plan.length}] ${inv.entryId} ${inv.condition} × ${inv.tests.length} testes`);
  }
  const pairs = plan.filter((inv) => inv.entryId !== WARMUP);
  const opens = (condition: string) =>
    pairs.filter((inv, index) => index % 2 === 0 && inv.condition === condition).length;
  console.log(`\nInvocações: ${plan.length} (1 aquecimento + ${pairs.length / 2} pares)`);
  console.log(`Execuções de teste: ${plan.length * plan[0].tests.length}`);
  console.log(`Pares que abrem pela captura desligada: ${opens('captura-desligada')}; pela ligada: ${opens('captura-ligada')}`);
  console.log(`Tempo estimado: ${hms(each * plan.length)} (${perTestS}s por teste, ${startupS}s de inicialização, ${WORKERS} workers)`);
}

/** Saída de um comando do Windows, ou `null` fora dele ou se falhar. */
function windows(command: string, commandArgs: string[]): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function windowsBuild(): string | null {
  const out = windows('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR']);
  const ubr = out?.match(/UBR\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1];
  return ubr ? `${os.release()}.${parseInt(ubr, 16)}` : null;
}

/** Versão do Chromium que o Playwright do projeto abre. Não navega para lugar nenhum. */
async function chromiumVersion(): Promise<string> {
  const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
  const browser = await chromium.launch();
  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function machine(): Promise<Record<string, unknown>> {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim() ?? null,
    logicalCpus: cpus.length,
    totalMemoryBytes: os.totalmem(),
    os: os.version(),
    osBuild: windowsBuild() ?? os.release(),
    node: process.version,
    playwright: (require('playwright-core/package.json') as { version: string }).version,
    chromium: await chromiumVersion(),
  };
}

/** Horário, plano de energia e lista de processos num momento da tentativa. */
function snapshot(dir: string, label: 'inicio' | 'fim'): { at: string; powerScheme: string | null } {
  const processes = windows('tasklist', ['/fo', 'csv']);
  if (processes !== null) {
    writeFileSync(path.join(dir, `processos-${label}.csv`), `${processes}\n`);
  }
  return { at: localIso(new Date()), powerScheme: windows('powercfg', ['/getactivescheme']) };
}

/** Diretório de uma tentativa; o mesmo de `overheadAttemptDir` em `overheadEnv.ts`. */
function attemptPath(runDir: string, inv: OverheadInvocation, attempt: number): string {
  return path.join(runDir, inv.condition, inv.entryId, `attempt-${attempt}`);
}

function runAttempt(baseline: Baseline) {
  return (runDir: string, _listFile: string, inv: OverheadInvocation, attempt: number): AttemptResult => {
    const dir = attemptPath(runDir, inv, attempt);
    const fingerprintsDir = path.join(dir, 'fingerprints');
    mkdirSync(fingerprintsDir, { recursive: true });
    if (inv.condition === 'captura-ligada') {
      prefill(fingerprintsDir, baseline);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OVERHEAD_INVOCATION: inv.entryId,
      OVERHEAD_CONDITION: inv.condition,
      OVERHEAD_RUN_DIR: runDir,
      OVERHEAD_ATTEMPT: String(attempt),
      HEALING_FINGERPRINTS_DIR: fingerprintsDir,
    };
    // Healing desligado = variável ausente; captura ligada = variável ausente, o padrão.
    delete env.HEALING;
    delete env.HEALING_CAPTURE;
    if (inv.condition === 'captura-desligada') {
      env.HEALING_CAPTURE = 'off';
    }

    const baselineBefore = hashDir(BASELINE_DIR);
    const start = snapshot(dir, 'inicio');
    const cli = require.resolve('@playwright/test/cli');
    const startMs = Date.now();
    const result = spawnSync(process.execPath, [cli, 'test', '--config', CONFIG], { cwd: ROOT, env, stdio: 'inherit' });
    const wallMs = Date.now() - startMs;
    const end = snapshot(dir, 'fim');
    const verification = verifyCapture(fingerprintsDir, inv.condition, baseline, startMs);
    const baselineAfter = hashDir(BASELINE_DIR);

    const events = testEvents(dir);
    if (!verification.ok || baselineBefore !== baselineAfter) {
      console.log(`  [verificação] FALHOU: ${JSON.stringify({ verification, baselineUnchanged: baselineBefore === baselineAfter })}`);
    }
    return {
      exitCode: result.status,
      wallMs,
      testsMs: events.reduce((sum, event) => sum + Number(event.durationMs), 0),
      executions: events.length,
      expectedExecutions: inv.tests.length * inv.repeatEach,
      invalidExecutions: events.filter((event) => event.invalid === true).length,
      details: {
        startedAt: start.at,
        endedAt: end.at,
        powerScheme: { start: start.powerScheme, end: end.powerScheme },
        verification,
        baselineUnchanged: baselineBefore === baselineAfter,
        baselineHash: baselineAfter,
      },
    };
  };
}

interface RunState {
  runDir: string;
  plan: OverheadInvocation[];
  done: Set<string>;
  commit: string;
}

async function newRun(plan: OverheadInvocation[]): Promise<RunState> {
  const git = requireCleanTree(ROOT, TAG);
  const runId = `overhead-captura-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(ROOT, 'experiments', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const baseline = loadBaseline(ROOT, git.commit);
  writeFileSync(
    path.join(runDir, 'baseline-fingerprints.json'),
    `${JSON.stringify(
      [...baseline].map(([name, bytes]) => ({ name, bytes: bytes.length })),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runDir, 'plan.json'),
    `${JSON.stringify({ runId, git, workers: WORKERS, machine: await machine(), baselineFiles: baseline.size, plan }, null, 2)}\n`,
  );
  console.log(`Rodada ${runId}`);
  return { runDir, plan, done: new Set(), commit: git.commit };
}

function resumeRun(runDirArg: string): RunState {
  const runDir = path.resolve(ROOT, runDirArg);
  const git = requireCleanTree(ROOT, TAG);
  try {
    const { plan, done, moved } = prepareResume<OverheadInvocation>(runDir, git.commit);
    console.log(
      `Retomando ${path.relative(ROOT, runDir)}: ${done.size} concluídas, ${plan.length - done.size} pendentes` +
        (moved.length > 0 ? `; tentativas parciais movidas para interrompidas/: ${moved.join(', ')}` : '') +
        '.',
    );
    return { runDir, plan, done, commit: git.commit };
  } catch (error) {
    console.error(`[${TAG}] ${(error as Error).message}`);
    process.exit(3);
  }
}

async function execute(run: RunState): Promise<void> {
  const baseline = loadBaseline(ROOT, run.commit);
  const outcome = await executeRun<OverheadInvocation>(run, {
    precheck,
    runAttempt: runAttempt(baseline),
    log: (line) => console.log(line),
  });
  const where = path.relative(ROOT, run.runDir);
  if (outcome.status === 'aborted') {
    console.log(`Rodada ABORTADA: ${outcome.reason} (${where}/aborted.json)`);
    process.exit(outcome.exitCode);
  }
  console.log(`Rodada concluída em ${where}`);
  console.log(
    outcome.unmeasured.length === 0 ? 'Todas as invocações desta execução medidas.' : `Não medidas: ${outcome.unmeasured.join(', ')}`,
  );
}

const options = args();
const resume = options.get('resume');
if (typeof resume === 'string') {
  await execute(resumeRun(resume));
} else if (options.get('run') === true) {
  await execute(await newRun(buildOverheadPlan(suiteTests())));
} else {
  simulate(buildOverheadPlan(suiteTests()), Number(options.get('per-test-s') ?? 1.5), Number(options.get('startup-s') ?? 5.2));
}
