import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import {
  harnessTestId,
  HarnessEnv,
  INFRA_ANNOTATION,
  InfraSignal,
  MUTATION_ANNOTATION,
  readHarnessEnv,
  workerFile,
} from './harnessEnv';

/**
 * Grava, por worker e condição, o resultado e a duração de cada teste vindos do
 * Playwright, com o estado da mutação em cada página visitada. Roda no processo
 * principal, então escreve em arquivo próprio (`tests-w<N>.jsonl`), separado do
 * log de recuperação que os workers escrevem (`healing-w<N>.jsonl`).
 */
class HarnessReporter implements Reporter {
  private env!: HarnessEnv;

  onBegin(): void {
    this.env = readHarnessEnv();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = result.annotations.length > 0 ? result.annotations : test.annotations;
    const parsed = <T>(type: string) =>
      annotations.filter((annotation) => annotation.type === type).map((annotation) => JSON.parse(annotation.description ?? 'null') as T);
    const mutation = parsed<{ url: string; applied: boolean | null }>(MUTATION_ANNOTATION);
    const infra = parsed<InfraSignal>(INFRA_ANNOTATION);

    const event = {
      entryId: this.env.entryId,
      // titlePath(): ['', projeto, arquivo, ...describes, título]
      testId: harnessTestId(test.location.file, test.titlePath().slice(3)),
      repetition: test.repeatEachIndex + 1,
      condition: this.env.condition,
      attempt: this.env.attempt,
      status: result.status,
      durationMs: result.duration,
      workerIndex: result.workerIndex,
      mutation,
      infra,
      /** Inválida por infraestrutura: só por sinal estruturado, nunca pela mensagem de erro. */
      invalid: infra.length > 0,
      error: result.error?.message?.split('\n')[0] ?? null,
    };

    const file = workerFile(this.env, 'tests', result.workerIndex);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default HarnessReporter;
