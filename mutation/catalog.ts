import { AmostraCategoria, categoriasAmostradas } from '../tests/fixtures/amostras';
import { MUTATION_METADATA, MutationSpec, MutationTarget, MutationType, TextChange } from './types';

/**
 * Catálogo fixo de mutações do experimento: 5 tipos aplicados aos alvos que a
 * suíte baseline localiza. Os seletores CSS conhecem o DOM do books.toscrape.com
 * (verificado em 2026-10-03 no site real) e são escritos só para ele.
 *
 * As páginas de referência são as dos fingerprints de baseline: a home para o
 * que `HomePage` toca, Travel para o que `CategoryPage` toca e o primeiro
 * produto de Travel para `ProductPage`.
 */

const HOME = '/index.html';
const CATEGORIA = '/catalogue/category/books/travel_2/index.html';
const PRODUTO = '/catalogue/its-only-the-himalayas_981/index.html';

const SIDEBAR_CATEGORIES = '.side_categories > ul > li > ul';
const CARDS = 'ol.row';
const PAGER = 'ul.pager';
const PRODUCT_MAIN = '.product_main';

/**
 * T1 é instanciado por categoria a partir de `amostras.ts`, como a suíte que o
 * usa. O `href` termina em `/<slug>/index.html` em todas as páginas exceto na da
 * própria categoria, onde o link vira `index.html` — lá a mutação não se aplica,
 * o que não importa: o fingerprint de T1 é capturado na home.
 */
function categoryLink(categoria: AmostraCategoria): MutationTarget {
  return {
    id: 'T1',
    key: `T1-${categoria.slug}`,
    description: `link da categoria "${categoria.nome}" na sidebar`,
    selector: `${SIDEBAR_CATEGORIES} > li > a[href$="/${categoria.slug}/index.html"]`,
    baseline: { url: HOME, selector: `role=complementary >> role=link[name=${categoria.nome}]` },
  };
}

export const CATEGORY_LINKS: readonly MutationTarget[] = categoriasAmostradas.map(categoryLink);

const TRAVEL_LINK = CATEGORY_LINKS.find((target) => target.key === 'T1-travel_2')!;
const SEQUENTIAL_ART_LINK = CATEGORY_LINKS.find((target) => target.key === 'T1-sequential-art_5')!;

export const FIRST_CARD: MutationTarget = {
  id: 'T2',
  key: 'T2',
  description: 'primeiro card de produto da listagem',
  selector: `${CARDS} > li:first-child > article.product_pod`,
  baseline: { url: HOME, selector: 'role=article[0]' },
};

export const FIRST_CARD_LINK: MutationTarget = {
  id: 'T3',
  key: 'T3',
  description: 'link do título do primeiro card',
  selector: `${CARDS} > li:first-child > article.product_pod > h3 > a`,
  baseline: { url: CATEGORIA, selector: 'role=article[0] >> role=heading[level=3] >> role=link' },
};

export const NEXT_LINK: MutationTarget = {
  id: 'T4',
  key: 'T4',
  description: 'link "next" da paginação',
  selector: `${PAGER} > li.next > a`,
  baseline: { url: HOME, selector: 'role=link[name=next]' },
};

export const CATEGORY_HEADING: MutationTarget = {
  id: 'T5',
  key: 'T5',
  description: 'título (h1) da página de categoria',
  selector: '.page-header > h1',
  baseline: { url: CATEGORIA, selector: 'role=heading[level=1]' },
};

export const SIDEBAR: MutationTarget = {
  id: 'T6',
  key: 'T6',
  description: 'sidebar de categorias',
  selector: 'aside.sidebar',
  baseline: { url: HOME, selector: 'role=complementary' },
};

export const PRODUCT_TITLE: MutationTarget = {
  id: 'T7',
  key: 'T7',
  description: 'título (h1) do produto',
  selector: `${PRODUCT_MAIN} > h1`,
  baseline: { url: PRODUTO, selector: 'role=heading[level=1]' },
};

export const PRODUCT_PRICE: MutationTarget = {
  id: 'T8',
  key: 'T8',
  description: 'preço do produto',
  selector: `${PRODUCT_MAIN} > p.price_color`,
  baseline: { url: PRODUTO, selector: '.product_main p.price_color' },
};

export const PRODUCT_AVAILABILITY: MutationTarget = {
  id: 'T9',
  key: 'T9',
  description: 'disponibilidade do produto',
  selector: `${PRODUCT_MAIN} > p.instock.availability`,
  baseline: { url: PRODUTO, selector: '.product_main p.instock.availability' },
};

export const PRODUCT_RATING: MutationTarget = {
  id: 'T10',
  key: 'T10',
  description: 'rating do produto',
  selector: `${PRODUCT_MAIN} > p.star-rating`,
  baseline: { url: PRODUTO, selector: '.product_main p.star-rating' },
};

/** Todos os alvos, T1 já expandido por categoria. */
export const TARGETS: readonly MutationTarget[] = [
  ...CATEGORY_LINKS,
  FIRST_CARD,
  FIRST_CARD_LINK,
  NEXT_LINK,
  CATEGORY_HEADING,
  SIDEBAR,
  PRODUCT_TITLE,
  PRODUCT_PRICE,
  PRODUCT_AVAILABILITY,
  PRODUCT_RATING,
];

/** Grupo de irmãos que o M3 inverte para cada alvo que tem um (T5 e T6 não têm). */
const REORDER_GROUPS: ReadonlyArray<[readonly MutationTarget[], string]> = [
  [CATEGORY_LINKS, SIDEBAR_CATEGORIES],
  [[FIRST_CARD, FIRST_CARD_LINK], CARDS],
  [[NEXT_LINK], PAGER],
  [[PRODUCT_TITLE, PRODUCT_PRICE, PRODUCT_AVAILABILITY, PRODUCT_RATING], PRODUCT_MAIN],
];

/**
 * Textos do M2, só em links (rótulos clicáveis). O relabel total simula
 * localização para o português. As edições leves existem para que o M2 tenha
 * casos em que a recuperação é alcançável: `drop-last-token` em T3
 * (inerte previsto — o locator de T3 é por índice) e `append-token` em
 * "Sequential Art", a categoria de mais tokens da amostra (dois; não há de três).
 */
const TEXT_CHANGES: ReadonlyArray<[MutationTarget, string, TextChange]> = [
  [TRAVEL_LINK, 'relabel', { kind: 'relabel', text: 'Viagem' }],
  [SEQUENTIAL_ART_LINK, 'append-token', { kind: 'append-token', token: 'Comics' }],
  [FIRST_CARD_LINK, 'relabel', { kind: 'relabel', text: 'É Só o Himalaia' }],
  [FIRST_CARD_LINK, 'drop-last-token', { kind: 'drop-last-token' }],
  [NEXT_LINK, 'relabel', { kind: 'relabel', text: 'próxima' }],
];

function base(type: MutationType, target: MutationTarget, variant?: string) {
  const meta = MUTATION_METADATA[type];
  const id = [meta.code, target.key, variant].filter(Boolean).join('-');
  return { id, target, meta };
}

function buildCatalog(): MutationSpec[] {
  const catalog: MutationSpec[] = [];

  for (const target of TARGETS) {
    catalog.push({ ...base('volatile-attributes', target), type: 'volatile-attributes' });
  }
  for (const [target, variant, text] of TEXT_CHANGES) {
    catalog.push({ ...base('text-change', target, variant), type: 'text-change', text });
  }
  for (const [targets, group] of REORDER_GROUPS) {
    for (const target of targets) {
      catalog.push({ ...base('reorder-siblings', target), type: 'reorder-siblings', group });
    }
  }
  for (const target of TARGETS) {
    catalog.push({ ...base('wrap-in-container', target), type: 'wrap-in-container' });
  }
  for (const target of TARGETS) {
    catalog.push({ ...base('remove-element', target), type: 'remove-element' });
  }

  return catalog;
}

export const CATALOG: readonly MutationSpec[] = Object.freeze(buildCatalog());

export function findMutation(id: string): MutationSpec {
  const spec = CATALOG.find((entry) => entry.id === id);
  if (!spec) {
    throw new Error(`mutação desconhecida no catálogo: ${id}`);
  }
  return spec;
}
