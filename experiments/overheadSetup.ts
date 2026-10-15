import { BrowserContext, Page, test } from '@playwright/test';
import { configureCaptureTimings } from '../healing/withCapture';
import { BasePage } from '../pages/BasePage';
import { duringGoto, watchInfrastructure } from './infraSignals';
import { CAPTURE_TIMING_ANNOTATION, readOverheadEnv } from './overheadEnv';

/**
 * Instalação da medição do custo da captura em cada processo que carrega
 * `overhead.config.ts`.
 *
 * Os 66 specs rodam sem alteração, sem mutação e sem interceptar documentos.
 * O patch em `BasePage.prototype.goto` só observa os sinais de infraestrutura,
 * igual nas duas condições. Com a captura ligada, o coletor de `withCapture`
 * anexa a duração de cada extração e de cada gravação ao teste, em memória; o
 * reporter grava em disco no processo principal.
 */
export function installOverhead(): void {
  const env = readOverheadEnv();

  const watched = new WeakSet<BrowserContext>();
  const original = BasePage.prototype.goto;
  BasePage.prototype.goto = async function goto(this: BasePage, target?: string): Promise<void> {
    // `page` é protegido no Page Object; o patch é o único acesso externo a ele.
    const page = (this as unknown as { page: Page }).page;
    const context = page.context();
    if (!watched.has(context)) {
      watched.add(context);
      watchInfrastructure(context, test.info());
    }
    return duringGoto(page, () => original.call(this, target));
  };

  if (env.condition === 'captura-ligada') {
    configureCaptureTimings((timing) =>
      test.info().annotations.push({ type: CAPTURE_TIMING_ANNOTATION, description: JSON.stringify(timing) }),
    );
  }
}
