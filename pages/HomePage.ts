import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  readonly categorySidebar: Locator;
  readonly productCards: Locator;
  readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.categorySidebar = page.getByRole('complementary');
    this.productCards = page.getByRole('article');
    this.nextPageLink = page.getByRole('link', { name: 'next' });
  }

  async goto(): Promise<void> {
    await super.goto('/index.html');
  }

  categoryLink(categoryName: string): Locator {
    return this.categorySidebar.getByRole('link', { name: categoryName, exact: true });
  }

  async goToCategory(categoryName: string): Promise<void> {
    await this.categoryLink(categoryName).click();
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
