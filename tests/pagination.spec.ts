import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test('avança para a próxima página e exibe produtos diferentes', async ({ page }) => {
  const home = new HomePage(page);
  await home.goto();

  expect(await home.hasNextPage()).toBe(true);
  const firstPageTitles = await home.getProductTitles();

  await home.goToNextPage();

  const secondPageTitles = await home.getProductTitles();
  expect(secondPageTitles.length).toBeGreaterThan(0);
  expect(secondPageTitles).not.toEqual(firstPageTitles);
});
