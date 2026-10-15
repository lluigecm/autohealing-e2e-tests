import { defineConfig, devices } from '@playwright/test';
import { installOverhead } from './overheadSetup';

/**
 * Config da medição do custo da captura de fingerprint. Roda os 66 testes de
 * `tests/` sem alteração, sem mutação e com o healing desligado, com a captura
 * ligada ou desligada. É sempre chamada pelo orquestrador
 * (`node experiments/overhead.mts`), que passa invocação, condição, rodada e o
 * diretório de captura por variável de ambiente; sem eles, `installOverhead`
 * recusa rodar.
 *
 * Espelha `playwright.config.ts`, o `npm test` que produziu a baseline, sem
 * `actionTimeout`. Diferem só os workers (2, como na rodada principal), o
 * `retries: 0` e o reporter, e nenhum deles muda o desfecho de um teste
 * saudável.
 */
installOverhead();

export default defineConfig({
  testDir: '../tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [['dot'], ['./overheadReporter.ts']],
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
