import { test, expect } from '@playwright/test';
import { CategoryPage } from '../pages/CategoryPage';
import { ProductPage } from '../pages/ProductPage';
import { categoriasAmostradas } from './fixtures/amostras';

for (const { nome, slug } of categoriasAmostradas) {
  test(`abre o primeiro produto de "${nome}" a partir da listagem e exibe título, preço e disponibilidade`, async ({ page }) => {
    const category = new CategoryPage(page);
    await category.goto(slug);
    await category.openProductByIndex(0);

    const product = new ProductPage(page);
    await product.expectTitleVisible();
    await product.expectPriceVisible();
    await product.expectAvailabilityVisible();
    expect(await product.getTitleText()).not.toBe('');
  });

  test(`produto de "${nome}" exibe o preço no formato esperado e a informação de estoque`, async ({ page }) => {
    const category = new CategoryPage(page);
    await category.goto(slug);
    await category.openProductByIndex(0);

    const product = new ProductPage(page);
    const priceText = await product.getPriceText();
    expect(priceText).toMatch(/^£\d+\.\d{2}$/);

    const availabilityText = await product.getAvailabilityText();
    expect(availabilityText).toMatch(/in stock/i);
  });

  test(`produto de "${nome}" exibe uma classificação por estrelas válida (1 a 5)`, async ({ page }) => {
    const category = new CategoryPage(page);
    await category.goto(slug);
    await category.openProductByIndex(0);

    const product = new ProductPage(page);
    await product.expectStarRatingVisible();

    const rating = await product.getRatingValue();
    expect(rating).toBeGreaterThanOrEqual(1);
    expect(rating).toBeLessThanOrEqual(5);
  });
}
