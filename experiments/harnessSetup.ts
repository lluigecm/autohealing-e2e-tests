import { BrowserContext, Page, Request, TestInfo, test } from '@playwright/test';
import { configureHealing, HealingLogSink, jsonlSink } from '../healing/decision/recovery';
import { applyMutation, pointsToOracle } from '../mutation/applyMutation';
import { findMutation } from '../mutation/catalog';
import { MutationSpec } from '../mutation/types';
import { BasePage } from '../pages/BasePage';
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
 * Instalação do harness em cada processo que carrega `harness.config.ts`.
 *
 * Os 66 specs rodam sem alteração. A mutação entra por um patch em
 * `BasePage.prototype.goto`: todo teste começa por `HomePage.goto` ou
 * `CategoryPage.goto`, que chamam `super.goto`, e a mutação é instalada no
 * contexto antes da primeira navegação. Ela reescreve o HTML de cada documento
 * antes da entrega, inclusive nas páginas abertas por clique, então o teste
 * nunca lê o documento original. Isso é igual nas duas condições.
 *
 * A recuperação não é montada aqui: com `HEALING=on`, ela já está em
 * `withCapture`. O harness só injeta o oráculo (para registro), o sink por
 * worker e o contexto da execução.
 */

/** Páginas com um `goto` de Page Object em andamento: o status HTTP de erro só conta ali. */
const inGoto = new WeakSet<Page>();

function isMainFrameNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) {
    return false;
  }
  try {
    return request.frame().parentFrame() === null;
  } catch {
    // Requisição sem frame (ex.: service worker): não é o documento principal.
    return false;
  }
}

/**
 * Sinais estruturados de falha de infraestrutura, observados no contexto do
 * teste e anotados nele. A classificação vem do evento; o código de falha da
 * requisição fica só como registro. A mensagem de erro do teste não é lida.
 */
function watchInfrastructure(context: BrowserContext, info: TestInfo): void {
  const report = (signal: InfraSignal) =>
    info.annotations.push({ type: INFRA_ANNOTATION, description: JSON.stringify(signal) });

  context.on('requestfailed', (request) => {
    if (isMainFrameNavigation(request)) {
      report({ kind: 'navigation-failed', url: request.url(), failure: request.failure()?.errorText ?? null });
    }
  });
  context.on('response', (response) => {
    const request = response.request();
    if (response.status() >= 400 && isMainFrameNavigation(request) && inGoto.has(request.frame().page())) {
      report({ kind: 'http-error', url: response.url(), status: response.status() });
    }
  });
}

/** Repetição a partir de 1, como em `RunContext`. */
function repetitionOf(info: TestInfo): number {
  return info.repeatEachIndex + 1;
}

/**
 * Mutação mais o relato de `applied` em cada documento. A reescrita avisa cada
 * documento antes de entregá-lo à página, então o relato vira anotação do teste
 * sem depender de evento da página.
 */
async function installMutation(context: BrowserContext, spec: MutationSpec, info: TestInfo): Promise<void> {
  watchInfrastructure(context, info);
  await applyMutation(context, spec, {
    onDocument: (state) => info.annotations.push({ type: MUTATION_ANNOTATION, description: JSON.stringify(state) }),
  });
}

function patchGoto(spec: MutationSpec): void {
  const installed = new WeakSet<BrowserContext>();
  const original = BasePage.prototype.goto;
  BasePage.prototype.goto = async function goto(this: BasePage, target?: string): Promise<void> {
    // `page` é protegido no Page Object; o patch é o único acesso externo a ele.
    const page = (this as unknown as { page: Page }).page;
    const context = page.context();
    if (!installed.has(context)) {
      installed.add(context);
      await installMutation(context, spec, test.info());
    }
    inGoto.add(page);
    try {
      return await original.call(this, target);
    } finally {
      inGoto.delete(page);
    }
  };
}

/** Um arquivo por worker; o índice muda quando o Playwright reinicia um worker após falha. */
function perWorkerSink(env: HarnessEnv): HealingLogSink {
  const sinks = new Map<number, HealingLogSink>();
  return {
    filePath: workerFile(env, 'healing', 0),
    write(entry) {
      const index = test.info().workerIndex;
      let sink = sinks.get(index);
      if (!sink) {
        sink = jsonlSink(workerFile(env, 'healing', index));
        sinks.set(index, sink);
      }
      sink.write(entry);
    },
  };
}

export function installHarness(): void {
  const env = readHarnessEnv();
  // Sob DOM mutado, uma ação bem-sucedida regravaria o baseline versionado.
  process.env.HEALING_CAPTURE = 'off';
  patchGoto(findMutation(env.entryId));

  if (env.condition === 'healing-on') {
    configureHealing({
      oracle: pointsToOracle,
      sink: perWorkerSink(env),
      run: () => {
        const info = test.info();
        return {
          entryId: env.entryId,
          testId: harnessTestId(info.file, info.titlePath.slice(1)),
          repetition: repetitionOf(info),
          condition: env.condition,
        };
      },
    });
  }
}
