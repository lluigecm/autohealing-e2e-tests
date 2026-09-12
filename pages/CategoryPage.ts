import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class CategoryPage extends BasePage {
  private readonly heading: Locator;
  private readonly productCards: Locator;
  private readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.productCards = page.getByRole('article');
    this.nextPageLink = page.getByRole('link', { name: 'next' });
  }

  async goto(categorySlug: string): Promise<void> {
    await super.goto(`/catalogue/category/books/${categorySlug}/index.html`);
  }

  async getCategoryName(): Promise<string> {
    const text = await this.withCapture('role=heading[level=1]', this.heading, (l) => l.textContent());
    return text?.trim() ?? '';
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
