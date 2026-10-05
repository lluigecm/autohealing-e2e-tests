import { defineConfig, devices } from '@playwright/test';
import { installTargetMapHook } from './targetTestMap';

/**
 * Gera `mutation/target-test-map.json`: roda os 66 testes de `tests/` sem
 * alteração, com `withCapture` instrumentado para registrar, em cada chamada,
 * o método do Page Object, o locator e os alvos T1..T10 que ele resolve ou
 * atravessa.
 *
 * O config é carregado também em cada worker, então instalar o hook aqui faz
 * com que ele valha onde os testes rodam. A captura de fingerprints fica
 * desligada: o objetivo é só observar.
 */
process.env.HEALING_CAPTURE = 'off';
installTargetMapHook();

export default defineConfig({
  testDir: '../tests',
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['./targetTestMapReporter.ts']],
  use: {
    baseURL: 'https://books.toscrape.com',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
