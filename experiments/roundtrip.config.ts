import { BrowserContext, Page, defineConfig, devices } from '@playwright/test';
import { installDocumentRewrite } from '../mutation/applyMutation';
import { BasePage } from '../pages/BasePage';

/**
 * Teste de ida e volta da reescrita de documentos: roda os 66 testes de
 * `tests/` com todo documento passando pela página auxiliar **sem mutação** e
 * reserializado, com a captura de fingerprints ligada. Os fingerprints
 * capturados têm de ser idênticos byte a byte aos 134 da baseline.
 *
 * Chamado por `node experiments/roundtrip.mts`, que fornece o diretório
 * temporário de captura. Sem ele, recusa rodar: a captura gravaria por cima da
 * baseline versionada. Espelha `playwright.config.ts`, como o `npm test` que
 * produziu a baseline.
 */
if (!process.env.HEALING_FINGERPRINTS_DIR) {
  throw new Error('[roundtrip] HEALING_FINGERPRINTS_DIR é obrigatório; rode por node experiments/roundtrip.mts');
}

const installed = new WeakSet<BrowserContext>();
const original = BasePage.prototype.goto;
BasePage.prototype.goto = async function goto(this: BasePage, target?: string): Promise<void> {
  const context = (this as unknown as { page: Page }).page.context();
  if (!installed.has(context)) {
    installed.add(context);
    await installDocumentRewrite(context, null, { reserialize: true });
  }
  return original.call(this, target);
};

export default defineConfig({
  testDir: '../tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'https://books.toscrape.com',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
