import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  private readonly categorySidebar: Locator;
  private readonly productCards: Locator;
  private readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.categorySidebar = page.getByRole('complementary');
    this.productCards = page.getByRole('article');
    this.nextPageLink = page.getByRole('link', { name: 'next' });
  }

  async goto(): Promise<void> {
    await super.goto('/index.html');
  }

  async expectCategorySidebarVisible(): Promise<void> {
    await this.withCapture('role=complementary', this.categorySidebar, async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async expectProductGridVisible(): Promise<void> {
    await this.withCapture('role=article[0]', this.productCards.first(), async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async goToCategory(categoryName: string): Promise<void> {
    const link = this.categorySidebar.getByRole('link', { name: categoryName, exact: true });
    await this.withCapture(`role=complementary >> role=link[name=${categoryName}]`, link, (l) => l.click());
  }

  async getProductCount(): Promise<number> {
    return this.withCapture('role=article', this.productCards, (l) => l.count());
  }

  async getProductTitles(): Promise<string[]> {
    const titles = this.productCards.getByRole('heading', { level: 3 });
    return this.withCapture('role=article >> role=heading[level=3]', titles, (l) => l.allTextContents());
  }

  async openProductByIndex(index: number): Promise<void> {
    const link = this.productCards.nth(index).getByRole('heading', { level: 3 }).getByRole('link');
    await this.withCapture(
      `role=article[${index}] >> role=heading[level=3] >> role=link`,
      link,
      (l) => l.click(),
    );
  }

  async hasNextPage(): Promise<boolean> {
    return this.withCapture('role=link[name=next]', this.nextPageLink, (l) => l.isVisible());
  }

  async goToNextPage(): Promise<void> {
    await this.withCapture('role=link[name=next]', this.nextPageLink, (l) => l.click());
  }
}
