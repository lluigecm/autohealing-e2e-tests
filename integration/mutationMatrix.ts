import { BrowserContext, Locator, Page, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CategoryPage } from '../pages/CategoryPage';
import { ProductPage } from '../pages/ProductPage';
import { categoriasAmostradas } from '../tests/fixtures/amostras';
import { applyMutation, pointsToOracle, readMutationState } from '../mutation/applyMutation';
import { MUTATION_STATE_KEY, MutationSpec, MutationTarget } from '../mutation/types';

/**
 * Matriz de efetividade: para cada entrada do catálogo, **sem
 * recuperação**, o estado do locator original do Page Object e a reprodução do
 * teste baseline que exercita o alvo.
 *
 * A coluna de teste é **reprodução, não execução real**: chama o mesmo método do
 * Page Object e aplica a mesma asserção do spec da suíte, na página de
 * referência. Rodar os 66 specs sob mutação depende do mecanismo de injeção,
 * que é decisão do harness (item 7).
 */

export type LocatorState = 'quebra' | 'desvia' | 'inerte';
export type TestOutcome = 'passa' | 'falha' | 'passa por engano';

/** Uma linha por entrada. Sem tempo, sem mensagem de erro: só valores estáveis entre rodadas. */
export interface MatrixRow {
  id: string;
  code: string;
  target: string;
  class: string;
  preservesOrder: boolean;
  expectedOutcome: string;
  /** A mutação transformou o DOM na página de referência. */
  applied: boolean;
  /** O efeito específico do tipo foi verificado no DOM (ver `verifyEffect`). */
  effect: boolean;
  locator: LocatorState;
  test: TestOutcome;
  reproducedTest: string;
}

/** Folga curta: o site é estático e já carregou — o que não aparece em 5 s não vai aparecer. */
const ACTION_TIMEOUT_MS = 5_000;

const TRAVEL = { nome: 'Travel', slug: 'travel_2' };

function categoryOf(target: MutationTarget): { nome: string; slug: string } {
  const categoria = categoriasAmostradas.find((c) => target.key === `T1-${c.slug}`);
  if (!categoria) {
    throw new Error(`alvo T1 sem categoria na amostra: ${target.key}`);
  }
  return categoria;
}

/**
 * O locator que o Page Object usa para o alvo. Campos privados são lidos por
 * colchete (o TypeScript permite) para usar exatamente o objeto do PO; os
 * montados dentro de métodos são reproduzidos com o método de origem indicado.
 */
function pageObjectLocator(page: Page, target: MutationTarget): Locator {
  switch (target.id) {
    case 'T1':
      // Reproduz HomePage.goToCategory(categoryName).
      return new HomePage(page)['categorySidebar'].getByRole('link', { name: categoryOf(target).nome, exact: true });
    case 'T2':
      // Reproduz HomePage.expectProductGridVisible() — `this.productCards.first()`.
      return new HomePage(page)['productCards'].first();
    case 'T3':
      // Reproduz CategoryPage.openProductByIndex(0).
      return new CategoryPage(page)['productCards'].nth(0).getByRole('heading', { level: 3 }).getByRole('link');
    case 'T4':
      return new HomePage(page)['nextPageLink'];
    case 'T5':
      return new CategoryPage(page)['heading'];
    case 'T6':
      return new HomePage(page)['categorySidebar'];
    case 'T7':
      return new ProductPage(page)['title'];
    case 'T8':
      return new ProductPage(page)['price'];
    case 'T9':
      return new ProductPage(page)['availability'];
    case 'T10':
      return new ProductPage(page)['starRating'];
  }
}

/** Reproduz `tests/category-navigation.spec.ts` para uma categoria. */
async function categoryNavigation(page: Page, nome: string): Promise<void> {
  const home = new HomePage(page);
  await home.goto();
  await home.goToCategory(nome);

  const category = new CategoryPage(page);
  expect(await category.getCategoryName()).toBe(nome);
  expect(await category.getProductCount()).toBeGreaterThan(0);
}

/** Reproduz `tests/home.spec.ts`. */
async function homeTest(page: Page): Promise<void> {
  const home = new HomePage(page);
  await home.goto();

  await home.expectCategorySidebarVisible();
  await home.expectProductGridVisible();
  expect(await home.getProductCount()).toBeGreaterThan(0);
}

/** Reproduz `tests/pagination.spec.ts`. */
async function pagination(page: Page): Promise<void> {
  const home = new HomePage(page);
  await home.goto();

  expect(await home.hasNextPage()).toBe(true);
  const firstPageTitles = await home.getProductTitles();

  await home.goToNextPage();

  const secondPageTitles = await home.getProductTitles();
  expect(secondPageTitles.length).toBeGreaterThan(0);
  expect(secondPageTitles).not.toEqual(firstPageTitles);
}

async function openFirstProduct(page: Page, slug: string): Promise<ProductPage> {
  const category = new CategoryPage(page);
  await category.goto(slug);
  await category.openProductByIndex(0);
  return new ProductPage(page);
}

/** Reproduz o 1º teste de `tests/product-details.spec.ts` (título, preço, disponibilidade). */
async function productDetailsVisible(page: Page, slug: string): Promise<void> {
  const product = await openFirstProduct(page, slug);
  await product.expectTitleVisible();
  await product.expectPriceVisible();
  await product.expectAvailabilityVisible();
  expect(await product.getTitleText()).not.toBe('');
}

/** Reproduz o 2º teste de `tests/product-details.spec.ts` (formato do preço, estoque). */
async function productDetailsPrice(page: Page, slug: string): Promise<void> {
  const product = await openFirstProduct(page, slug);
  expect(await product.getPriceText()).toMatch(/^£\d+\.\d{2}$/);
  expect(await product.getAvailabilityText()).toMatch(/in stock/i);
}

/** Reproduz o 3º teste de `tests/product-details.spec.ts` (rating de 1 a 5). */
async function productDetailsRating(page: Page, slug: string): Promise<void> {
  const product = await openFirstProduct(page, slug);
  await product.expectStarRatingVisible();
  const rating = await product.getRatingValue();
  expect(rating).toBeGreaterThanOrEqual(1);
  expect(rating).toBeLessThanOrEqual(5);
}

/** O teste baseline que exercita cada alvo, no fluxo em que o exercita. */
function reproduction(target: MutationTarget): { name: string; run: (page: Page) => Promise<void> } {
  switch (target.id) {
    case 'T1': {
      const { nome } = categoryOf(target);
      return { name: `category-navigation › ${nome}`, run: (page) => categoryNavigation(page, nome) };
    }
    case 'T2':
    case 'T6':
      return { name: 'home', run: homeTest };
    case 'T3':
    case 'T7':
      return { name: `product-details #1 › ${TRAVEL.nome}`, run: (page) => productDetailsVisible(page, TRAVEL.slug) };
    case 'T4':
      return { name: 'pagination', run: pagination };
    case 'T5':
      return { name: `category-navigation › ${TRAVEL.nome}`, run: (page) => categoryNavigation(page, TRAVEL.nome) };
    case 'T8':
    case 'T9':
      return { name: `product-details #2 › ${TRAVEL.nome}`, run: (page) => productDetailsPrice(page, TRAVEL.slug) };
    case 'T10':
      return { name: `product-details #3 › ${TRAVEL.nome}`, run: (page) => productDetailsRating(page, TRAVEL.slug) };
  }
}

/** Texto normalizado e posição no grupo do M3, lidos da página **sem** mutação. */
interface CleanSnapshot {
  text: string;
  groupIndex: number;
  groupSize: number;
}

async function cleanSnapshot(context: BrowserContext, spec: MutationSpec): Promise<CleanSnapshot> {
  const page = await context.newPage();
  try {
    await page.goto(spec.target.baseline.url);
    return await page.evaluate(
      ({ selector, group }) => {
        const el = document.querySelector(selector)!;
        const container = group ? document.querySelector(group) : null;
        const children = container ? Array.from(container.children) : [];
        return {
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          groupIndex: children.findIndex((child) => child.contains(el)),
          groupSize: children.length,
        };
      },
      { selector: spec.target.selector, group: spec.type === 'reorder-siblings' ? spec.group : null },
    );
  } finally {
    await page.close();
  }
}

function expectedText(spec: MutationSpec, original: string): string | null {
  if (spec.type !== 'text-change') {
    return null;
  }
  const words = original.split(' ');
  switch (spec.text.kind) {
    case 'relabel':
      return spec.text.text;
    case 'append-token':
      return [...words, spec.text.token].join(' ');
    case 'drop-last-token':
      return words.slice(0, -1).join(' ');
  }
}

/** Verifica no DOM mutado o efeito específico do tipo — não só "algo mudou". */
async function verifyEffect(page: Page, spec: MutationSpec, clean: CleanSnapshot): Promise<boolean> {
  return page.evaluate(
    ({ key, type, id, selector, group, text, clean }) => {
      const oracle = (window as unknown as Record<string, { oracle: Element | null }>)[key]?.oracle ?? null;
      switch (type) {
        case 'volatile-attributes': {
          const tokens = (oracle?.getAttribute('class') ?? '').split(/\s+/).filter((t) => t.length > 0);
          return oracle?.id === `m1-${id}` && tokens.length > 0 && tokens.every((t) => t.startsWith('m1'));
        }
        case 'text-change':
          return (oracle?.textContent ?? '').replace(/\s+/g, ' ').trim() === text;
        case 'reorder-siblings': {
          const container = document.querySelector(group!);
          const children = container ? Array.from(container.children) : [];
          const index = children.findIndex((child) => oracle !== null && child.contains(oracle));
          return clean.groupSize > 1 && index === clean.groupSize - 1 - clean.groupIndex;
        }
        case 'wrap-in-container': {
          const parent = oracle?.parentElement;
          return parent?.tagName === 'DIV' && parent.attributes.length === 0 && parent.children.length === 1;
        }
        case 'remove-element':
          return oracle === null && document.querySelector(selector) === null;
      }
      return false;
    },
    {
      key: MUTATION_STATE_KEY,
      type: spec.type,
      id: spec.id,
      selector: spec.target.selector,
      group: spec.type === 'reorder-siblings' ? spec.group : null,
      text: expectedText(spec, clean.text),
      clean,
    },
  );
}

async function measureLocator(page: Page, target: MutationTarget): Promise<LocatorState> {
  const locator = pageObjectLocator(page, target);
  if ((await locator.count()) === 0) {
    return 'quebra';
  }
  return (await pointsToOracle(locator)) ? 'inerte' : 'desvia';
}

async function measureRow(context: BrowserContext, spec: MutationSpec): Promise<MatrixRow> {
  const clean = await cleanSnapshot(context, spec);

  // Página de referência mutada: aplicação, efeito e estado do locator.
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  let applied: boolean;
  let effect: boolean;
  let locator: LocatorState;
  try {
    await applyMutation(page, spec);
    await page.goto(spec.target.baseline.url);
    applied = (await readMutationState(page))?.applied ?? false;
    effect = applied && (await verifyEffect(page, spec, clean));
    locator = await measureLocator(page, spec.target);
  } finally {
    await page.close();
  }

  // Reprodução do teste baseline, em página nova com a mesma mutação.
  const { name, run } = reproduction(spec.target);
  const testPage = await context.newPage();
  testPage.setDefaultTimeout(ACTION_TIMEOUT_MS);
  let passed: boolean;
  try {
    await applyMutation(testPage, spec);
    await run(testPage);
    passed = true;
  } catch {
    passed = false;
  } finally {
    await testPage.close();
  }

  return {
    id: spec.id,
    code: spec.meta.code,
    target: spec.target.key,
    class: spec.meta.class,
    preservesOrder: spec.meta.preservesOrder,
    expectedOutcome: spec.meta.expectedOutcome,
    applied,
    effect,
    locator,
    // "Por engano" só quando o locator resolveu para outro elemento; um teste que
    // passa com o locator quebrado não o exercita e fica visível como divergência.
    test: !passed ? 'falha' : locator === 'desvia' ? 'passa por engano' : 'passa',
    reproducedTest: name,
  };
}

/**
 * Mede todas as entradas, com no máximo `concurrency` em paralelo (cortesia com
 * o site de terceiros). A ordem das linhas é a do catálogo, independente da
 * ordem de conclusão.
 */
export async function measureMatrix(
  context: BrowserContext,
  catalog: readonly MutationSpec[],
  concurrency = 2,
): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = new Array(catalog.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < catalog.length) {
      const index = next++;
      rows[index] = await measureRow(context, catalog[index]);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows;
}
