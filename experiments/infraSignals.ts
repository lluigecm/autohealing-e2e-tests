import { BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { INFRA_ANNOTATION, InfraSignal } from './harnessEnv';

/**
 * Sinais estruturados de falha de infraestrutura, comuns ao harness e à
 * medição do custo da captura: falha de navegação do documento principal e
 * status HTTP de erro no `goto` dos Page Objects. A classificação vem do
 * evento; o código de falha da requisição fica só como registro. A mensagem de
 * erro do teste não é lida.
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

/** Observa o contexto do teste e anota nele cada sinal. */
export function watchInfrastructure(context: BrowserContext, info: TestInfo): void {
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

/** Marca a página como dentro de um `goto` de Page Object enquanto `navigate` roda. */
export async function duringGoto<T>(page: Page, navigate: () => Promise<T>): Promise<T> {
  inGoto.add(page);
  try {
    return await navigate();
  } finally {
    inGoto.delete(page);
  }
}
