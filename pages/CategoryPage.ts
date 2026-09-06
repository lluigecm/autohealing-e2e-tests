import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class CategoryPage extends BasePage {
  readonly heading: Locator;
  readonly productCards: Locator;
  readonly nextPageLink: Locator;

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
    return (await this.heading.textContent())?.trim() ?? '';
  }

  async getProductCount(): Promise<number> {
    return this.productCards.count();
  }

  private productTitle(card: Locator): Locator {
    return card.getByRole('heading', { level: 3 });
  }

  async getProductTitles(): Promise<string[]> {
    return this.productTitle(this.productCards).allTextContents();
  }

  async openProductByIndex(index: number): Promise<void> {
    const card = this.productCards.nth(index);
    await this.productTitle(card).getByRole('link').click();
  }

  async hasNextPage(): Promise<boolean> {
    return this.nextPageLink.isVisible();
  }

  async goToNextPage(): Promise<void> {
    await this.nextPageLink.click();
  }
}
