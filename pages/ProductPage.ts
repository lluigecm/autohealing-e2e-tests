import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

const RATING_WORDS: Record<string, number> = {
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
};

export class ProductPage extends BasePage {
  readonly title: Locator;
  readonly price: Locator;
  readonly availability: Locator;
  readonly starRating: Locator;

  constructor(page: Page) {
    super(page);
    this.title = page.getByRole('heading', { level: 1 });
    this.price = page.locator('.product_main p.price_color');
    this.availability = page.locator('.product_main p.instock.availability');
    this.starRating = page.locator('.product_main p.star-rating');
  }

  async getTitleText(): Promise<string> {
    return (await this.title.textContent())?.trim() ?? '';
  }

  async getPriceText(): Promise<string> {
    return (await this.price.textContent())?.trim() ?? '';
  }

  async getAvailabilityText(): Promise<string> {
    return (await this.availability.textContent())?.trim() ?? '';
  }

  async getRatingValue(): Promise<number> {
    const classAttr = (await this.starRating.getAttribute('class')) ?? '';
    const ratingWord = classAttr.split(' ').find((word) => word !== 'star-rating');
    return ratingWord ? RATING_WORDS[ratingWord] ?? 0 : 0;
  }
}
