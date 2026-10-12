import { defineConfig, devices } from '@playwright/test';
import { installHarness } from './harnessSetup';

/**
 * Config do harness dos experimentos. Roda os 66 testes de `tests/` sem
 * alteração, com uma entrada do catálogo de mutações injetada e o healing
 * ligado ou desligado. É sempre chamada pelo orquestrador
 * (`node experiments/harness.mts`), que passa entrada, condição e rodada por
 * variável de ambiente; sem elas, `installHarness` recusa rodar.
 *
 * Espelha `playwright.config.ts`. A única diferença que altera o comportamento
 * dos testes é o `actionTimeout` de 5 s, igual nas duas condições: sem ele, uma
 * ação sobre locator ausente espera o timeout do teste inteiro e o teste morre
 * antes de a detecção rodar. Reporter e workers também diferem, sem mudar o
 * desfecho de nenhum teste. `retries: 0` para que uma divergência entre
 * repetições apareça em vez de ser absorvida.
 *
 * O config é carregado também em cada worker, então instalar o harness aqui faz
 * com que ele valha onde os testes rodam.
 */
installHarness();

export default defineConfig({
  testDir: '../tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  /* Fixo nas duas condições: tempo comparável e carga contida num site de terceiros. */
  workers: 2,
  reporter: [['dot'], ['./harnessReporter.ts']],
  use: {
    baseURL: 'https://books.toscrape.com',
    trace: 'on-first-retry',
    actionTimeout: 5_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
