import { defineConfig, devices } from '@playwright/test';

/**
 * Terceira categoria de teste do projeto, ao lado da suíte E2E e dos unitários.
 *
 * Valida as heurísticas de recuperação contra o **alvo real** (books.toscrape.com),
 * usando os fingerprints versionados em `healing/fingerprints/` — é o que mostra
 * que a heurística funciona no site do TCC, e não só contra fixtures.
 *
 * Config própria, e não uma extensão da `playwright.unit.config.ts`, porque os
 * dois propósitos exigem garantias diferentes: os unitários provam lógica e por
 * isso não tocam a rede (ADR-005); estes provam comportamento no alvo e por isso
 * precisam dela. Misturá-los tiraria dos unitários a propriedade que os torna
 * confiáveis.
 *
 * Os três números são reportados separadamente no texto do TCC:
 * 66 E2E + N unitários + M integração.
 */
export default defineConfig({
  testDir: './integration',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  /**
   * Único ponto da suíte com dependência de rede real. Os retries existem para
   * que uma instabilidade de rede não seja lida como falha da heurística — se o
   * teste falhar de verdade, falha nas três tentativas. Não é sintoma de teste
   * flaky: books.toscrape.com foi escolhido justamente por ser estável.
   */
  retries: 2,
  /* Folga sobre os 30s padrão: a latência é de um site de terceiros, não nossa. */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // `list` em vez de `html`: não sobrescreve o relatório da suíte E2E.
  reporter: 'list',
  /* Poucos workers por cortesia com um site de terceiros que não é nosso. */
  workers: 2,

  use: {
    baseURL: 'https://books.toscrape.com',
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
