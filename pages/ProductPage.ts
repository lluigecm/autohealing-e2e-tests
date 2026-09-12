import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

const RATING_WORDS: Record<string, number> = {
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
};

export class ProductPage extends BasePage {
  private readonly title: Locator;
  private readonly price: Locator;
  private readonly availability: Locator;
  private readonly starRating: Locator;

  constructor(page: Page) {
    super(page);
    this.title = page.getByRole('heading', { level: 1 });
    this.price = page.locator('.product_main p.price_color');
    this.availability = page.locator('.product_main p.instock.availability');
    this.starRating = page.locator('.product_main p.star-rating');
  }

  async expectTitleVisible(): Promise<void> {
    await this.withCapture('role=heading[level=1]', this.title, async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async expectPriceVisible(): Promise<void> {
    await this.withCapture('.product_main p.price_color', this.price, async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async expectAvailabilityVisible(): Promise<void> {
    await this.withCapture('.product_main p.instock.availability', this.availability, async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async expectStarRatingVisible(): Promise<void> {
    await this.withCapture('.product_main p.star-rating', this.starRating, async (l) => {
      await expect(l).toBeVisible();
    });
  }

  async getTitleText(): Promise<string> {
    const text = await this.withCapture('role=heading[level=1]', this.title, (l) => l.textContent());
    return text?.trim() ?? '';
  }

  async getPriceText(): Promise<string> {
    const text = await this.withCapture('.product_main p.price_color', this.price, (l) => l.textContent());
    return text?.trim() ?? '';
  }

  async getAvailabilityText(): Promise<string> {
    const text = await this.withCapture(
      '.product_main p.instock.availability',
      this.availability,
      (l) => l.textContent(),
    );
    return text?.trim() ?? '';
  }

  async getRatingValue(): Promise<number> {
    const classAttr = await this.withCapture(
      '.product_main p.star-rating',
      this.starRating,
      (l) => l.getAttribute('class'),
    );
    const ratingWord = (classAttr ?? '').split(' ').find((word) => word !== 'star-rating');
    return ratingWord ? RATING_WORDS[ratingWord] ?? 0 : 0;
  }
}
