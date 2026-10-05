import { defineConfig, devices } from '@playwright/test';

/**
 * Config separada dos testes E2E: valida a lógica do mecanismo de auto-healing
 * (extração, persistência e heurísticas de recuperação) sem tocar no site alvo.
 *
 * Mantida à parte de `playwright.config.ts` de propósito — são dois números com
 * propósitos distintos: a suíte baseline mede regressão funcional (66 testes
 * E2E), esta aqui valida lógica de heurística. Misturar os dois num total só
 * distorceria a métrica citada nos experimentos.
 *
 * As heurísticas precisam de um DOM real para consultar, então há um projeto
 * chromium aqui. O DOM vem de `page.setContent()` com fixtures locais, nunca da
 * rede: nenhum elemento que a suíte exercita no books.toscrape.com tem
 * `data-*`/`aria-*`, e um teste unitário
 * que dependesse de site externo deixaria de ser determinístico.
 * Sem `baseURL` de propósito — nenhum teste daqui deve navegar para fora.
 */
export default defineConfig({
  testDir: './healing',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // `list` em vez de `html`: não sobrescreve o relatório da suíte E2E.
  reporter: 'list',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
