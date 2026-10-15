import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { CaptureTiming } from '../healing/withCapture';
import { harnessTestId, INFRA_ANNOTATION, InfraSignal } from './harnessEnv';
import { CAPTURE_TIMING_ANNOTATION, OverheadEnv, overheadAttemptDir, readOverheadEnv } from './overheadEnv';

/**
 * Grava, por worker, o resultado e a duração de cada teste vindos do
 * Playwright, com os sinais de infraestrutura e, com a captura ligada, a
 * duração de cada extração e de cada gravação. Roda no processo principal: a
 * escrita em disco fica fora do tempo dos testes.
 */
class OverheadReporter implements Reporter {
  private env!: OverheadEnv;

  onBegin(): void {
    this.env = readOverheadEnv();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = result.annotations.length > 0 ? result.annotations : test.annotations;
    const parsed = <T>(type: string) =>
      annotations.filter((annotation) => annotation.type === type).map((annotation) => JSON.parse(annotation.description ?? 'null') as T);
    const infra = parsed<InfraSignal>(INFRA_ANNOTATION);

    const event = {
      invocation: this.env.invocation,
      condition: this.env.condition,
      attempt: this.env.attempt,
      // titlePath(): ['', projeto, arquivo, ...describes, título]
      testId: harnessTestId(test.location.file, test.titlePath().slice(3)),
      status: result.status,
      durationMs: result.duration,
      workerIndex: result.workerIndex,
      infra,
      /** Inválida por infraestrutura: só por sinal estruturado, nunca pela mensagem de erro. */
      invalid: infra.length > 0,
      error: result.error?.message?.split('\n')[0] ?? null,
      captureTimings: parsed<CaptureTiming>(CAPTURE_TIMING_ANNOTATION),
    };

    const dir = overheadAttemptDir(this.env.runDir, this.env.condition, this.env.invocation, this.env.attempt);
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `tests-w${result.workerIndex}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default OverheadReporter;
