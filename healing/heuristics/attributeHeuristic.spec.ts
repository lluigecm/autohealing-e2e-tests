import { test, expect, Page } from '@playwright/test';
import { readFile } from 'fs/promises';
import path from 'path';
import { Fingerprint } from '../fingerprint';
import { matchByStableAttributes } from './attributeHeuristic';

/**
 * Os fixtures são montados com `setContent` em vez de carregados do site real:
 * books.toscrape.com não expõe um único `data-*`/`aria-*` (os 134 fingerprints
 * do baseline têm `stable: {}`), então não há como exercitar as prioridades 1 a
 * 3 contra ele. O documento de contexto (§5) permite fixture construído a partir
 * do schema exatamente por isso.
 *
 * O HTML representa a página **depois** da mutação: as classes foram reescritas
 * (`product_pod` → `card--v2`), que é o cenário que a heurística existe para
 * cobrir.
 */

function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    selector: 'role=article',
    url: '/catalogue/category/books/art_25/index.html',
    tag: 'article',
    text: 'Wall and Piece',
    attributes: {
      stable: {},
      volatile: { class: 'product_pod', id: null },
    },
    position: { parentTag: 'li', parentSiblingIndex: 0, siblingIndex: 0, depth: 8 },
    ...overrides,
  };
}

function withStable(stable: Record<string, string>, volatile?: { class: string | null; id: string | null }) {
  return fingerprint({
    attributes: {
      stable,
      volatile: volatile ?? { class: 'product_pod', id: null },
    },
  });
}

const CATALOGUE = `
  <ul>
    <li>
      <article data-testid="product-card" data-product-id="42" aria-label="Wall and Piece"
               aria-rowindex="1" class="card--v2">Wall and Piece</article>
    </li>
    <li>
      <article data-testid="promo-card" data-product-id="77" aria-label="Sharp Objects"
               aria-rowindex="2" class="card--v2">Sharp Objects</article>
    </li>
    <li>
      <section class="product_pod" id="legacy-pod">Sem atributos estáveis</section>
    </li>
  </ul>
`;

async function load(page: Page, html: string): Promise<void> {
  await page.setContent(html);
}

test.describe('prioridade 1 — data-testid', () => {
  test('casa exatamente e devolve confiança máxima', async ({ page }) => {
    await load(page, CATALOGUE);

    const result = await matchByStableAttributes(page, withStable({ 'data-testid': 'product-card' }));

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('data-testid');
    expect(result.score).toBe(1);
    expect(result.ambiguous).toBe(false);
    expect(result.candidateCount).toBe(1);
    expect(result.matchedAttributes).toEqual(['data-testid']);
    await expect(result.locator!).toHaveText('Wall and Piece');
  });

  test('tem precedência sobre aria-label quando os dois estão no fingerprint', async ({ page }) => {
    await load(page, CATALOGUE);

    // O aria-label aponta para outro card: se a prioridade fosse invertida, o
    // resultado seria "Sharp Objects".
    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'product-card', 'aria-label': 'Sharp Objects' }),
    );

    expect(result.strategy).toBe('data-testid');
    await expect(result.locator!).toHaveText('Wall and Piece');
  });
});

test.describe('prioridade 2 — aria-label', () => {
  test('usado quando o fingerprint não tem data-testid', async ({ page }) => {
    await load(page, CATALOGUE);

    const result = await matchByStableAttributes(page, withStable({ 'aria-label': 'Sharp Objects' }));

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('aria-label');
    expect(result.score).toBe(0.9);
    expect(result.ambiguous).toBe(false);
    await expect(result.locator!).toHaveText('Sharp Objects');
  });

  test('usado quando o data-testid do fingerprint sumiu do DOM atual', async ({ page }) => {
    // Mutação que removeu o data-testid mas preservou o aria-label.
    await load(page, '<article aria-label="Wall and Piece" class="card--v2">Wall and Piece</article>');

    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'product-card', 'aria-label': 'Wall and Piece' }),
    );

    expect(result.strategy).toBe('aria-label');
    expect(result.score).toBe(0.9);
    await expect(result.locator!).toHaveText('Wall and Piece');
  });

  test('valor com aspas não quebra o seletor', async ({ page }) => {
    await load(page, '<button aria-label=\'Adicionar "Wall and Piece"\'>Add</button>');

    const result = await matchByStableAttributes(
      page,
      withStable({ 'aria-label': 'Adicionar "Wall and Piece"' }),
    );

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('aria-label');
  });
});

test.describe('prioridade 3 — demais data-*/aria-*', () => {
  test('combina os atributos restantes e pontua pela cobertura total', async ({ page }) => {
    await load(page, CATALOGUE);

    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-product-id': '77', 'aria-rowindex': '2' }),
    );

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('stable-attributes');
    expect(result.score).toBeCloseTo(0.75);
    expect(result.matchedAttributes).toEqual(['data-product-id', 'aria-rowindex']);
    await expect(result.locator!).toHaveText('Sharp Objects');
  });

  test('cobertura parcial reduz o score proporcionalmente', async ({ page }) => {
    await load(page, CATALOGUE);

    // `data-product-id` ainda bate; `aria-rowindex` foi reordenado pela mutação.
    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-product-id': '42', 'aria-rowindex': '9' }),
    );

    expect(result.matched).toBe(true);
    expect(result.score).toBeCloseTo(0.375); // 0.75 * (1 de 2 atributos)
    expect(result.matchedAttributes).toEqual(['data-product-id']);
    await expect(result.locator!).toHaveText('Wall and Piece');
  });
});

test.describe('ausência de match', () => {
  test('devolve resultado vazio em vez de lançar', async ({ page }) => {
    await load(page, CATALOGUE);

    const result = await matchByStableAttributes(page, withStable({ 'data-testid': 'inexistente' }));

    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
    expect(result.strategy).toBe('none');
    expect(result.locator).toBeNull();
    expect(result.ambiguous).toBe(false);
    expect(result.candidateCount).toBe(0);
    // Rodou e não achou — diferente de não ter tido o que procurar.
    expect(result.applicable).toBe(true);
  });

  test('não cai em class/id quando nenhum atributo estável casa', async ({ page }) => {
    await load(page, CATALOGUE);

    // A `class` e o `id` do fingerprint existem no DOM (o <section> legado), mas
    // voláteis não são critério de busca — só desempate (regra 4).
    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'inexistente' }, { class: 'product_pod', id: 'legacy-pod' }),
    );

    expect(result.matched).toBe(false);
    expect(result.locator).toBeNull();
  });

  test('fingerprint sem atributos estáveis é sinalizado como inaplicável', async ({ page }) => {
    await load(page, CATALOGUE);

    const result = await matchByStableAttributes(page, fingerprint());

    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
    expect(result.applicable).toBe(false);
  });

  test('fingerprint real do baseline cai no caso inaplicável', async ({ page }) => {
    // Prova que o schema gravado na Camada 1 é consumido sem adaptação — e
    // documenta que o site alvo não oferece nada para esta heurística morder.
    const saved = JSON.parse(
      await readFile(
        path.resolve(
          __dirname,
          '..',
          'fingerprints',
          'catalogue-category-books-art_25-index.html',
          'role-article.json',
        ),
        'utf8',
      ),
    ) as Fingerprint;

    await load(page, CATALOGUE);
    const result = await matchByStableAttributes(page, saved);

    expect(saved.attributes.stable).toEqual({});
    expect(result.applicable).toBe(false);
    expect(result.matched).toBe(false);
  });
});

test.describe('ambiguidade', () => {
  const DUPLICATES = `
    <article data-testid="product-card" class="card--v2">Primeiro</article>
    <article data-testid="product-card" class="card--v2">Segundo</article>
  `;

  test('é sinalizada e penaliza o score quando os voláteis não desempatam', async ({ page }) => {
    await load(page, DUPLICATES);

    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'product-card' }, { class: 'product_pod', id: null }),
    );

    expect(result.matched).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.candidateCount).toBe(2);
    expect(result.tiebreakUsed).toBe(false);
    expect(result.score).toBe(0.5); // 1 * penalidade de ambiguidade não resolvida
    await expect(result.locator!).toHaveText('Primeiro');
  });

  test('desempata por id preservado, mas continua sinalizando ambiguidade', async ({ page }) => {
    await load(
      page,
      `
        <article data-testid="product-card" class="card--v2">Primeiro</article>
        <article data-testid="product-card" id="pod-42" class="card--v2">Segundo</article>
      `,
    );

    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'product-card' }, { class: 'product_pod', id: 'pod-42' }),
    );

    expect(result.tiebreakUsed).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.score).toBeCloseTo(0.8); // 1 * penalidade de desempate volátil
    await expect(result.locator!).toHaveText('Segundo');
  });

  test('desempata por class sobrevivente entre candidatos empatados', async ({ page }) => {
    await load(
      page,
      `
        <article data-testid="product-card" class="card--v2">Primeiro</article>
        <article data-testid="product-card" class="product_pod">Segundo</article>
      `,
    );

    const result = await matchByStableAttributes(
      page,
      withStable({ 'data-testid': 'product-card' }, { class: 'product_pod', id: null }),
    );

    expect(result.tiebreakUsed).toBe(true);
    expect(result.ambiguous).toBe(true);
    await expect(result.locator!).toHaveText('Segundo');
  });
});
