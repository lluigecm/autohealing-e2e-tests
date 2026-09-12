import { defineConfig } from '@playwright/test';

/**
 * Config separada dos testes E2E: valida a lógica do mecanismo de auto-healing
 * (extração, persistência e, nas próximas etapas, as heurísticas) sem abrir
 * navegador nem tocar no site alvo.
 *
 * Mantida à parte de `playwright.config.ts` de propósito — são dois números com
 * propósitos distintos: a suíte baseline mede regressão funcional (66 testes
 * E2E), esta aqui valida lógica de heurística. Misturar os dois num total só
 * distorceria a métrica citada nos experimentos.
 */
export default defineConfig({
  testDir: './healing',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // `list` em vez de `html`: não sobrescreve o relatório da suíte E2E.
  reporter: 'list',
});
