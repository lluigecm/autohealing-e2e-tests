import { Locator, Page } from '@playwright/test';
import { withCapture } from '../healing/withCapture';

export class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path: string = '/'): Promise<void> {
    await this.page.goto(path);
  }

  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  async getPageTitle(): Promise<string> {
    return this.page.title();
  }

  /**
   * Todo acesso ao DOM nas Page Objects passa por aqui — é o ponto único onde a
   * Camada 1 captura o fingerprint e onde as camadas seguintes vão interceptar
   * falhas de localização.
   */
  protected withCapture<T>(
    description: string,
    locator: Locator,
    action: (l: Locator) => Promise<T>,
  ): Promise<T> {
    return withCapture(this.page, description, locator, action);
  }
}
