import { test, expect } from '@playwright/test';
import { categoriasAmostradas } from '../../tests/fixtures/amostras';
import { CATALOG, CATEGORY_LINKS, TARGETS, findMutation } from '../../mutation/catalog';
import { MUTATION_METADATA, MutationType } from '../../mutation/types';

/**
 * Unitários da ferramenta de mutação. Moram sob `healing/` só porque o
 * `testDir` de `playwright.unit.config.ts` é `./healing` e as configs não podem
 * mudar nesta etapa — o código testado fica em `/mutation`.
 */

function entriesOf(type: MutationType) {
  return CATALOG.filter((spec) => spec.type === type);
}

test('cada entrada carrega exatamente o rótulo do seu tipo', () => {
  for (const spec of CATALOG) {
    expect(spec.meta, spec.id).toEqual(MUTATION_METADATA[spec.type]);
  }
});

test('rótulos de verdade conforme a tabela do catálogo', () => {
  expect(MUTATION_METADATA).toEqual({
    'volatile-attributes': { code: 'M1', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' },
    'text-change': { code: 'M2', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' },
    'reorder-siblings': { code: 'M3', class: 'cosmetic', preservesOrder: false, expectedOutcome: 'recover' },
    'wrap-in-container': { code: 'M4', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' },
    'remove-element': { code: 'M5', class: 'defect', preservesOrder: true, expectedOutcome: 'fail' },
  });
});

test('M5 é a única mutação defect', () => {
  const defects = CATALOG.filter((spec) => spec.meta.class === 'defect');
  expect(new Set(defects.map((spec) => spec.type))).toEqual(new Set(['remove-element']));
});

test('M3 é a única mutação que altera a ordem', () => {
  const reordering = CATALOG.filter((spec) => !spec.meta.preservesOrder);
  expect(new Set(reordering.map((spec) => spec.type))).toEqual(new Set(['reorder-siblings']));
});

test('identificadores são únicos e estáveis', () => {
  const ids = CATALOG.map((spec) => spec.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(findMutation('M1-T1-travel_2').target.key).toBe('T1-travel_2');
  expect(() => findMutation('M9-T1')).toThrow();
});

test('T1 é instanciado a partir de amostras.ts', () => {
  expect(CATEGORY_LINKS.map((target) => target.key)).toEqual(
    categoriasAmostradas.map((categoria) => `T1-${categoria.slug}`),
  );
});

test('M1, M4 e M5 cobrem todos os alvos', () => {
  const keys = TARGETS.map((target) => target.key);
  for (const type of ['volatile-attributes', 'wrap-in-container', 'remove-element'] as const) {
    expect(entriesOf(type).map((spec) => spec.target.key), type).toEqual(keys);
  }
});

test('M3 cobre T1 por categoria e os alvos com grupo de irmãos, nunca T5/T6', () => {
  const ids = entriesOf('reorder-siblings').map((spec) => spec.target.id);
  expect(ids.filter((id) => id === 'T1')).toHaveLength(categoriasAmostradas.length);
  expect(new Set(ids)).toEqual(new Set(['T1', 'T2', 'T3', 'T4', 'T7', 'T8', 'T9', 'T10']));
});

test('M2 só em links: Travel, Sequential Art (edição leve), T3 (relabel e edição leve) e next', () => {
  expect(entriesOf('text-change').map((spec) => spec.id)).toEqual([
    'M2-T1-travel_2-relabel',
    'M2-T1-sequential-art_5-append-token',
    'M2-T3-relabel',
    'M2-T3-drop-last-token',
    'M2-T4-relabel',
  ]);
});

test('totais por tipo do catálogo', () => {
  const totals = Object.fromEntries(
    Object.entries(MUTATION_METADATA).map(([type, meta]) => [meta.code, entriesOf(type as MutationType).length]),
  );
  expect(totals).toEqual({ M1: 25, M2: 5, M3: 23, M4: 25, M5: 25 });
  expect(CATALOG).toHaveLength(103);
  expect(CATALOG.filter((spec) => spec.target.id === 'T1')).toHaveLength(66);
});

test('o catálogo é imutável', () => {
  expect(Object.isFrozen(CATALOG)).toBe(true);
  expect(Object.isFrozen(MUTATION_METADATA['remove-element'])).toBe(true);
});
