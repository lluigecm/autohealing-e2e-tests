import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AttemptResult, executeRun, Invocation, invocationKey, prepareResume, readJsonl } from '../../experiments/runState.mts';

/**
 * Laço de execução e retomada do harness sobre um diretório de rodada
 * fictício. A pré-verificação e o Playwright são falsos: nada toca no site.
 * Mora sob `healing/` só por causa do `testDir` da config unitária.
 */

const COMMIT = 'a'.repeat(40);

function invocation(entryId: string, condition: Invocation['condition'], tests = 1): Invocation {
  return {
    entryId,
    group: 'inerte',
    locator: 'inerte',
    condition,
    repeatEach: 1,
    tests: Array.from({ length: tests }, (_, i) => `tests/x.spec.ts › teste ${i}`),
  };
}

const PLAN: Invocation[] = [
  invocation('M1-T1-crime_51', 'healing-off'),
  invocation('M1-T1-crime_51', 'healing-on'),
  invocation('M1-T2', 'healing-on', 2),
  invocation('M1-T2', 'healing-off', 2),
];

/** Runner falso: registra cada chamada e devolve o resultado pedido. */
function fakeRunner(result: (inv: Invocation, attempt: number) => Partial<AttemptResult> = () => ({})) {
  const calls: string[] = [];
  const runAttempt = (_runDir: string, _list: string, inv: Invocation, attempt: number): AttemptResult => {
    calls.push(`${invocationKey(inv)}#${attempt}`);
    const expected = inv.tests.length * inv.repeatEach;
    return { exitCode: 0, wallMs: 10, testsMs: 10, executions: expected, expectedExecutions: expected, invalidExecutions: 0, ...result(inv, attempt) };
  };
  return { calls, runAttempt };
}

const healthy = async () => null;

let runDir: string;

test.beforeEach(() => {
  runDir = mkdtempSync(path.join(tmpdir(), 'harness-run-'));
  writeFileSync(path.join(runDir, 'plan.json'), JSON.stringify({ runId: 'ficticia', git: { commit: COMMIT, dirty: false }, plan: PLAN }));
});

test.afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

const outcomes = () => (existsSync(path.join(runDir, 'outcomes.jsonl')) ? readJsonl(path.join(runDir, 'outcomes.jsonl')) : []);
const invocations = () => (existsSync(path.join(runDir, 'invocations.jsonl')) ? readJsonl(path.join(runDir, 'invocations.jsonl')) : []);

test.describe('invocação incompleta', () => {
  test('0 de 1 execução aborta a rodada sem desfecho e nunca é gravada como medida', async () => {
    const { calls, runAttempt } = fakeRunner(() => ({ exitCode: 1, executions: 0 }));

    const result = await executeRun({ runDir, plan: PLAN, done: new Set() }, { precheck: healthy, runAttempt });

    expect(result).toMatchObject({ status: 'aborted', exitCode: 4 });
    expect(outcomes()).toEqual([]);
    expect(invocations()).toEqual([expect.objectContaining({ entryId: 'M1-T1-crime_51', incomplete: true, valid: false })]);
    expect(JSON.parse(readFileSync(path.join(runDir, 'aborted.json'), 'utf8')).problems[0]).toContain('0 de 1');
    // Nada depois dela roda, e não há segunda tentativa.
    expect(calls).toEqual(['M1-T1-crime_51|healing-off#1']);
  });

  test('Playwright interrompido (sem código de saída) também aborta sem desfecho', async () => {
    const { runAttempt } = fakeRunner(() => ({ exitCode: null }));

    const result = await executeRun({ runDir, plan: PLAN, done: new Set() }, { precheck: healthy, runAttempt });

    expect(result).toMatchObject({ status: 'aborted', exitCode: 4 });
    expect(outcomes()).toEqual([]);
  });

  test('incompleta na segunda tentativa: a primeira, inválida por infraestrutura, não vira desfecho', async () => {
    const { runAttempt } = fakeRunner((_inv, attempt) => (attempt === 1 ? { invalidExecutions: 1 } : { executions: 0 }));

    const result = await executeRun({ runDir, plan: PLAN, done: new Set() }, { precheck: healthy, runAttempt });

    expect(result).toMatchObject({ status: 'aborted', exitCode: 4 });
    expect(outcomes()).toEqual([]);
  });
});

test('pré-verificação falhando aborta antes de rodar, sem desfecho', async () => {
  const { calls, runAttempt } = fakeRunner();

  const result = await executeRun({ runDir, plan: PLAN, done: new Set() }, { precheck: async () => ['status 503'], runAttempt });

  expect(result).toMatchObject({ status: 'aborted', exitCode: 2 });
  expect(calls).toEqual([]);
  expect(outcomes()).toEqual([]);
});

test('infraestrutura: invocação inválida roda de novo uma única vez e, continuando inválida, fica não medida', async () => {
  const { calls, runAttempt } = fakeRunner((inv) => (inv.entryId === 'M1-T2' ? { invalidExecutions: 1 } : {}));

  const result = await executeRun({ runDir, plan: PLAN, done: new Set() }, { precheck: healthy, runAttempt });

  expect(result).toEqual({ status: 'completed', unmeasured: ['M1-T2 healing-on', 'M1-T2 healing-off'] });
  expect(calls.filter((call) => call.startsWith('M1-T2|healing-on'))).toEqual(['M1-T2|healing-on#1', 'M1-T2|healing-on#2']);
  expect(outcomes().map((o) => o.outcome)).toEqual(['medida', 'medida', 'nao-medida', 'nao-medida']);
});

test.describe('retomada de rodada fictícia', () => {
  /** Estado de uma rodada que abortou na terceira invocação, com tentativa parcial em disco. */
  function interrupt(): void {
    writeFileSync(
      path.join(runDir, 'outcomes.jsonl'),
      [PLAN[0], PLAN[1]].map((inv) => JSON.stringify({ entryId: inv.entryId, condition: inv.condition, outcome: 'medida' })).join('\n') + '\n',
    );
    const partial = path.join(runDir, 'healing-on', 'M1-T2', 'attempt-1');
    mkdirSync(partial, { recursive: true });
    writeFileSync(path.join(partial, 'tests-w0.jsonl'), '{"parcial":true}\n');
    writeFileSync(path.join(runDir, 'aborted.json'), '{"problems":["invocação incompleta"]}\n');
  }

  test('roda só as invocações sem desfecho; as concluídas nunca rodam de novo', async () => {
    interrupt();
    const momento = new Date('2026-10-12T15:00:00.000Z');

    const { plan, done, moved } = prepareResume(runDir, COMMIT, momento);
    const { calls, runAttempt } = fakeRunner();
    const result = await executeRun({ runDir, plan, done }, { precheck: healthy, runAttempt });

    expect(result).toEqual({ status: 'completed', unmeasured: [] });
    expect(calls).toEqual(['M1-T2|healing-on#1', 'M1-T2|healing-off#1']);
    // Cada invocação do plano tem exatamente um desfecho.
    expect(outcomes().map(invocationKey).sort()).toEqual(PLAN.map(invocationKey).sort());
    // Tentativa parcial preservada para auditoria, fora do caminho da análise.
    expect(moved).toEqual(['M1-T2|healing-on']);
    const stamp = '2026-10-12T15-00-00-000Z';
    expect(existsSync(path.join(runDir, 'interrompidas', stamp, 'healing-on', 'M1-T2', 'attempt-1', 'tests-w0.jsonl'))).toBe(true);
    expect(existsSync(path.join(runDir, 'aborted.json'))).toBe(false);
    expect(existsSync(path.join(runDir, `aborted-${stamp}.json`))).toBe(true);
    expect(readJsonl(path.join(runDir, 'resumes.jsonl'))).toEqual([
      expect.objectContaining({ commit: COMMIT, done: 2, pending: 2, moved: ['M1-T2|healing-on'] }),
    ]);
  });

  test('commit diferente: recusa sem mexer em nada', () => {
    interrupt();
    const antes = readdirSync(runDir).sort();

    expect(() => prepareResume(runDir, 'b'.repeat(40))).toThrow(/retomada recusada/);
    expect(readdirSync(runDir).sort()).toEqual(antes);
    expect(existsSync(path.join(runDir, 'healing-on', 'M1-T2', 'attempt-1'))).toBe(true);
    expect(existsSync(path.join(runDir, 'resumes.jsonl'))).toBe(false);
  });

  test('rodada já completa: a retomada não roda nada', async () => {
    writeFileSync(
      path.join(runDir, 'outcomes.jsonl'),
      PLAN.map((inv) => JSON.stringify({ entryId: inv.entryId, condition: inv.condition, outcome: 'medida' })).join('\n') + '\n',
    );

    const { plan, done } = prepareResume(runDir, COMMIT);
    const { calls, runAttempt } = fakeRunner();
    await executeRun({ runDir, plan, done }, { precheck: async () => ['não deveria ser chamada'], runAttempt });

    expect(calls).toEqual([]);
    expect(outcomes()).toHaveLength(PLAN.length);
  });
});
