import { test, expect, Page } from '@playwright/test';
import { Fingerprint } from '../fingerprint';
import { matchByStructuralSimilarity } from './structuralHeuristic';

/**
 * Testes unitários puros: DOM montado com `setContent`, zero rede (§6.1 do
 * contexto, ADR-005). A validação contra o site real fica nos testes de
 * integração, em `integration/`, sob outra config.
 *
 * As geometrias dos fixtures estão anotadas nos comentários porque são o que os
 * fingerprints abaixo afirmam — se o HTML mudar, os números mudam junto.
 */

function fingerprint(overrides: Partial<Fingerprint['position']> = {}, tag = 'article'): Fingerprint {
  return {
    selector: 'role=article',
    url: '/catalogue/category/books/art_25/index.html',
    tag,
    text: 'B',
    attributes: { stable: {}, volatile: { class: 'product_pod', id: null } },
    position: { parentTag: 'li', parentSiblingIndex: 1, siblingIndex: 0, depth: 3, ...overrides },
  };
}

/**
 * `<main>` depth 0 · `<ol>` depth 1 · `<li>` depth 2 · `<article>` depth 3.
 * O alvo é o article do segundo `<li>` (parentSiblingIndex 1).
 */
const LISTAGEM = `
  <main>
    <ol>
      <li><article class="card--v2">A</article></li>
      <li><article class="card--v2">B</article></li>
      <li><article class="card--v2">C</article></li>
    </ol>
  </main>
`;

async function load(page: Page, html: string): Promise<void> {
  await page.setContent(html);
}

test.describe('critério 1 — pai + posição entre irmãos', () => {
  test('casa exatamente e devolve confiança máxima', async ({ page }) => {
    await load(page, LISTAGEM);

    const result = await matchByStructuralSimilarity(page, fingerprint());

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('parent+siblingPosition');
    expect(result.score).toBeCloseTo(1); // 0.45 pai + 0.30 irmão + 0.15 profundidade + 0.10 tag
    expect(result.ambiguous).toBe(false);
    expect(result.candidateCount).toBe(1);
    expect(result.matchedSignals).toEqual(['parent', 'sibling', 'depth', 'tag']);
    expect(result.applicable).toBe(true);
    await expect(result.locator!).toHaveText('B');
  });

  test('distingue irmãos idênticos pela posição do pai', async ({ page }) => {
    await load(page, LISTAGEM);

    // Os três articles são indistinguíveis por atributo, tag e profundidade — só
    // o índice do pai separa um do outro.
    const primeiro = await matchByStructuralSimilarity(page, fingerprint({ parentSiblingIndex: 0 }));
    const terceiro = await matchByStructuralSimilarity(page, fingerprint({ parentSiblingIndex: 2 }));

    await expect(primeiro.locator!).toHaveText('A');
    await expect(terceiro.locator!).toHaveText('C');
  });
});

test.describe('critério 2 — profundidade + tag', () => {
  test('assume quando o pai exato não é identificável', async ({ page }) => {
    // O `<li>` do fingerprint virou `<div>`: o sinal de pai desaparece por
    // completo, sobram profundidade, tag e posição entre irmãos.
    await load(
      page,
      `
        <main>
          <ol>
            <div><article class="card--v2">Alvo</article></div>
            <div><p>outro</p></div>
          </ol>
        </main>
      `,
    );

    const result = await matchByStructuralSimilarity(page, fingerprint({ parentSiblingIndex: 0 }));

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('depth+tag');
    expect(result.score).toBeCloseTo(0.55); // 0 pai + 0.30 irmão + 0.15 profundidade + 0.10 tag
    expect(result.matchedSignals).toEqual(['sibling', 'depth', 'tag']);
    await expect(result.locator!).toHaveText('Alvo');
  });
});

test.describe('critério 3 — combinação parcial', () => {
  test('devolve candidato com score reduzido quando só parte dos sinais bate', async ({ page }) => {
    // Duas mutações ao mesmo tempo: a árvore ganhou um wrapper (profundidade +1)
    // e um badge entrou antes do article (índice entre irmãos +1). O pai continua
    // sendo o segundo `<li>`, e é só disso que a heurística se agarra.
    await load(
      page,
      `
        <main>
          <div class="wrapper-novo">
            <ol>
              <li><article class="card--v2">A</article></li>
              <li><span class="badge">novo</span><article class="card--v2">B</article></li>
            </ol>
          </div>
        </main>
      `,
    );

    const result = await matchByStructuralSimilarity(page, fingerprint());

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('partial');
    // 0.45 pai + 0.225 irmão (distância 1) + 0.075 profundidade (distância 1) + 0.10 tag
    expect(result.score).toBeCloseTo(0.85);
    expect(result.score).toBeLessThan(1);
    expect(result.matchedSignals).toEqual(['parent', 'tag']);
    await expect(result.locator!).toHaveText('B');
  });
});

test.describe('ausência de match', () => {
  test('devolve resultado vazio em vez de lançar', async ({ page }) => {
    // Página reconstruída do zero: nada perto da geometria registrada.
    await load(page, '<div><span>nada a ver</span></div>');

    const result = await matchByStructuralSimilarity(
      page,
      fingerprint({ parentTag: 'td', parentSiblingIndex: 3, siblingIndex: 5, depth: 9 }),
    );

    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
    expect(result.strategy).toBe('none');
    expect(result.locator).toBeNull();
    expect(result.candidateCount).toBe(0);
    expect(result.applicable).toBe(true);
  });

  test('fingerprint sem pai capturado é sinalizado como inaplicável', async ({ page }) => {
    await load(page, LISTAGEM);

    const result = await matchByStructuralSimilarity(
      page,
      fingerprint({ parentTag: null, parentSiblingIndex: null, siblingIndex: -1 }),
    );

    expect(result.applicable).toBe(false);
    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
  });
});

test.describe('ambiguidade', () => {
  test('é sinalizada quando dois elementos têm a mesma geometria', async ({ page }) => {
    // Duas listas irmãs e idênticas: a posição estrutural não distingue os dois
    // articles, e a heurística não deve fingir que distingue.
    await load(
      page,
      `
        <main>
          <ol><li><article>Primeiro</article></li></ol>
          <ol><li><article>Segundo</article></li></ol>
        </main>
      `,
    );

    const result = await matchByStructuralSimilarity(page, fingerprint({ parentSiblingIndex: 0 }));

    expect(result.matched).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.candidateCount).toBe(2);
    expect(result.score).toBeCloseTo(1);
    await expect(result.locator!).toHaveText('Primeiro');
  });
});

test.describe('resistência a mutação de atributos voláteis', () => {
  test('encontra o mesmo elemento depois de class e id serem reescritos', async ({ page }) => {
    await load(page, LISTAGEM);

    const antes = await matchByStructuralSimilarity(page, fingerprint());

    // Mutação simulada por fixture local — não é a ferramenta de mutação de DOM
    // do TODO item 6. Reescreve todo `class` e injeta `id` gerado, que é
    // exatamente o que quebra um seletor baseado em atributo volátil.
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el, index) => {
        el.setAttribute('class', `hash-${index}-${Math.random().toString(36).slice(2)}`);
        el.setAttribute('id', `gen-${index}`);
      });
    });

    const depois = await matchByStructuralSimilarity(page, fingerprint());

    expect(depois.matched).toBe(true);
    expect(depois.score).toBeCloseTo(antes.score);
    expect(depois.strategy).toBe(antes.strategy);
    expect(depois.ambiguous).toBe(false);
    await expect(depois.locator!).toHaveText('B');
  });
});
