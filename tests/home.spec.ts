import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test('exibe a lista de categorias e o grid de produtos', async ({ page }) => {
  const home = new HomePage(page);
  await home.goto();

  await home.expectCategorySidebarVisible();
  await home.expectProductGridVisible();
  expect(await home.getProductCount()).toBeGreaterThan(0);
});
