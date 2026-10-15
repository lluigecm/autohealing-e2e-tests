import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Estado e laço de execução de uma rodada, sem rede nem Playwright: a
 * pré-verificação e a execução de cada tentativa são injetadas. Os
 * orquestradores (`harness.mts` e `overhead.mts`) ligam as versões reais; os
 * unitários, versões falsas sobre um diretório de rodada fictício.
 */

/** O mínimo que o laço precisa de uma invocação: a chave (entrada, condição) e o tamanho. */
export interface RunInvocation {
  entryId: string;
  condition: string;
  repeatEach: number;
  tests: string[];
}

export type Condition = 'healing-off' | 'healing-on';

export interface Invocation extends RunInvocation {
  group: string;
  locator: 'inerte' | 'quebra' | 'desvia';
  condition: Condition;
}

export interface AttemptResult {
  /** `null` quando o Playwright terminou sem código de saída (interrompido). */
  exitCode: number | null;
  wallMs: number;
  testsMs: number;
  executions: number;
  expectedExecutions: number;
  invalidExecutions: number;
  /** Registro extra da tentativa, gravado como está em `invocations.jsonl`. */
  details?: Record<string, unknown>;
}

export function invocationKey(inv: { entryId?: unknown; condition?: unknown }): string {
  return `${String(inv.entryId)}|${String(inv.condition)}`;
}

export function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stampOf(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export interface ResumePlan<I extends RunInvocation = Invocation> {
  plan: I[];
  /** Invocações com desfecho em `outcomes.jsonl`: nunca rodam de novo. */
  done: Set<string>;
  /** Invocações sem desfecho cujas tentativas parciais foram para `interrompidas/`. */
  moved: string[];
}

/**
 * Prepara a retomada de uma rodada interrompida: mesmo commit e o plano gravado
 * em `plan.json`, não um recalculado. Uma invocação é concluída quando tem
 * desfecho em `outcomes.jsonl` (medida ou não medida). As tentativas parciais
 * das demais vão para `interrompidas/<momento>/`, para auditoria, e elas rodam
 * do início. Lança erro, sem mexer em nada, se o commit for outro.
 */
export function prepareResume<I extends RunInvocation = Invocation>(
  runDir: string,
  headCommit: string,
  now: Date = new Date(),
): ResumePlan<I> {
  const saved = JSON.parse(readFileSync(path.join(runDir, 'plan.json'), 'utf8')) as {
    git: { commit: string };
    plan: I[];
  };
  if (saved.git.commit !== headCommit) {
    throw new Error(`retomada recusada: a rodada é do commit ${saved.git.commit} e o HEAD é ${headCommit}`);
  }

  const outcomesFile = path.join(runDir, 'outcomes.jsonl');
  const done = new Set(existsSync(outcomesFile) ? readJsonl(outcomesFile).map(invocationKey) : []);
  const stamp = stampOf(now);
  const moved: string[] = [];
  for (const inv of saved.plan.filter((candidate) => !done.has(invocationKey(candidate)))) {
    const partial = path.join(runDir, inv.condition, inv.entryId);
    if (existsSync(partial)) {
      const target = path.join(runDir, 'interrompidas', stamp, inv.condition, inv.entryId);
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(partial, target);
      moved.push(invocationKey(inv));
    }
  }
  const aborted = path.join(runDir, 'aborted.json');
  if (existsSync(aborted)) {
    renameSync(aborted, path.join(runDir, `aborted-${stamp}.json`));
  }
  appendFileSync(
    path.join(runDir, 'resumes.jsonl'),
    `${JSON.stringify({ at: now.toISOString(), commit: headCommit, done: done.size, pending: saved.plan.length - done.size, moved })}\n`,
  );
  return { plan: saved.plan, done, moved };
}

export interface RunDeps<I extends RunInvocation = Invocation> {
  /** `null` quando a home está saudável; senão, as falhas observadas nas três tentativas. */
  precheck: () => Promise<string[] | null>;
  runAttempt: (runDir: string, listFile: string, inv: I, attempt: number) => AttemptResult;
  log?: (line: string) => void;
  now?: () => Date;
}

export type RunOutcome =
  | { status: 'completed'; unmeasured: string[] }
  /** 2: pré-verificação falhou três vezes; 4: invocação incompleta. */
  | { status: 'aborted'; exitCode: 2 | 4; reason: string };

/**
 * Executa as invocações pendentes do plano. Antes de cada tentativa,
 * pré-verifica a home; com três falhas seguidas, aborta a rodada. Uma
 * invocação com execução inválida por infraestrutura roda de novo, inteira,
 * uma única vez; continuando inválida, fica não medida. Teste que falhou por
 * outro motivo nunca é reexecutado.
 *
 * Invocação incompleta (Playwright interrompido, ou menos execuções que as
 * previstas) aborta a rodada **sem desfecho**: nunca é gravada como medida, e
 * a retomada a refaz.
 */
export async function executeRun<I extends RunInvocation = Invocation>(
  run: { runDir: string; plan: I[]; done: Set<string> },
  deps: RunDeps<I>,
): Promise<RunOutcome> {
  const { runDir, plan, done } = run;
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const listsDir = path.join(runDir, 'lists');
  mkdirSync(listsDir, { recursive: true });

  const abort = (exitCode: 2 | 4, index: number, inv: I, attempt: number, problems: string[]): RunOutcome => {
    const aborted = { at: now().toISOString(), invocation: index + 1, entryId: inv.entryId, condition: inv.condition, attempt, problems };
    writeFileSync(path.join(runDir, 'aborted.json'), `${JSON.stringify(aborted, null, 2)}\n`);
    return { status: 'aborted', exitCode, reason: problems.join('; ') };
  };

  const unmeasured: string[] = [];
  for (const [index, inv] of plan.entries()) {
    if (done.has(invocationKey(inv))) {
      continue;
    }
    // O `--test-list` é relativo ao `testDir`: os ids do mapa vêm com o prefixo `tests/`.
    const listFile = path.join(listsDir, `${inv.entryId}.txt`);
    writeFileSync(listFile, `${inv.tests.map((id) => id.replace(/^tests\//, '')).join('\n')}\n`);

    let outcome: 'medida' | 'nao-medida' = 'nao-medida';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const problems = await deps.precheck();
      if (problems !== null) {
        return abort(2, index, inv, attempt, problems);
      }

      log(`[${index + 1}/${plan.length}] ${inv.entryId} ${inv.condition} × ${inv.tests.length} testes × ${inv.repeatEach} (tentativa ${attempt})`);
      const result = deps.runAttempt(runDir, listFile, inv, attempt);
      if (result.exitCode === null || result.executions !== result.expectedExecutions) {
        appendFileSync(
          path.join(runDir, 'invocations.jsonl'),
          `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, attempt, ...result, valid: false, incomplete: true })}\n`,
        );
        return abort(4, index, inv, attempt, [
          `invocação incompleta: ${result.executions} de ${result.expectedExecutions} execuções, código de saída ${result.exitCode}`,
        ]);
      }
      const valid = result.invalidExecutions === 0;
      appendFileSync(
        path.join(runDir, 'invocations.jsonl'),
        `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, attempt, ...result, valid })}\n`,
      );
      if (valid) {
        outcome = 'medida';
        break;
      }
      log(`  ${result.invalidExecutions} execução(ões) inválida(s) por infraestrutura`);
    }

    appendFileSync(
      path.join(runDir, 'outcomes.jsonl'),
      `${JSON.stringify({ entryId: inv.entryId, condition: inv.condition, outcome })}\n`,
    );
    if (outcome === 'nao-medida') {
      unmeasured.push(`${inv.entryId} ${inv.condition}`);
    }
  }
  return { status: 'completed', unmeasured };
}
