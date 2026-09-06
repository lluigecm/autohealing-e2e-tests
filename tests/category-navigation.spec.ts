import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CategoryPage } from '../pages/CategoryPage';
import { categoriasAmostradas } from './fixtures/amostras';

for (const { nome } of categoriasAmostradas) {
  test(`navega da Home para a categoria "${nome}" e exibe a listagem correspondente`, async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.goToCategory(nome);

    const category = new CategoryPage(page);
    expect(await category.getCategoryName()).toBe(nome);
    expect(await category.getProductCount()).toBeGreaterThan(0);
  });
}
