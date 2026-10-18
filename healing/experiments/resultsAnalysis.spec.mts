import { test, expect } from '@playwright/test';
import {
  aggregateFalsePositive,
  aggregateRecovery,
  aggregateRecoveryAt,
  candidateSiblingIndex,
  classifyCosmetic,
  classifyCosmeticAt,
  classifyDefect,
  decisionAt,
  reproducedTestId,
} from '../../experiments/resultsAnalysis.mts';

/**
 * Regras de classificação e agregação da análise dos resultados, sobre
 * entradas de log fictícias. Nada lê a rodada nem toca no site.
 */

const replace = (candidateIsOracle: boolean | null, score = 1) => ({ decision: 'replace' as const, candidateIsOracle, score });
const fail = (candidateIsOracle: boolean | null, score = 0.5) => ({ decision: 'fail' as const, candidateIsOracle, score });

test.describe('classe de uma execução cosmética', () => {
  test('verificada na ordem: sem log, fail, cura incorreta, elemento certo com teste falhando, sucesso', () => {
    expect(classifyCosmetic([], false)).toBe('não acionado');
    expect(classifyCosmetic([], true)).toBe('não acionado');
    expect(classifyCosmetic([replace(false), fail(true)], true)).toBe('fail');
    expect(classifyCosmetic([replace(true), replace(false)], true)).toBe('cura incorreta');
    expect(classifyCosmetic([replace(true), replace(null)], true)).toBe('cura incorreta');
    expect(classifyCosmetic([replace(true), replace(true)], false)).toBe('elemento certo, teste falha');
    expect(classifyCosmetic([replace(true)], true)).toBe('sucesso');
  });
});

test.describe('classe de uma execução M5', () => {
  test('qualquer replace conta, seja qual for o resto', () => {
    expect(classifyDefect([fail(false), replace(false)])).toBe('replace');
    expect(classifyDefect([fail(false)])).toBe('fail');
    expect(classifyDefect([])).toBe('não acionado');
  });
});

test.describe('agregação por entrada', () => {
  test('recuperação exige sucesso em todas as execuções', () => {
    expect(aggregateRecovery(['sucesso', 'sucesso'])).toBe('recuperada');
    expect(aggregateRecovery(['sucesso', 'sucesso', 'elemento certo, teste falha'])).toBe('não recuperada');
    expect(aggregateRecovery([])).toBe('não recuperada');
  });

  test('falso positivo com um replace; a favor só com fail em todas; sem log em todas, não acionado', () => {
    expect(aggregateFalsePositive(['fail', 'fail', 'replace'])).toBe('falso positivo');
    expect(aggregateFalsePositive(['não acionado', 'replace'])).toBe('falso positivo');
    expect(aggregateFalsePositive(['fail', 'fail'])).toBe('fail em todas');
    expect(aggregateFalsePositive(['não acionado', 'não acionado'])).toBe('não acionado');
    expect(aggregateFalsePositive(['fail', 'não acionado'])).toBe('fail e não acionado');
  });
});

test.describe('sensibilidade do limiar', () => {
  test('limiar inclusivo e score nulo sempre falha', () => {
    expect(decisionAt(0.7, 0.7)).toBe('replace');
    expect(decisionAt(0.6999, 0.7)).toBe('fail');
    expect(decisionAt(null, 0)).toBe('fail');
  });

  test('o mesmo caminho reproduz a classe observada', () => {
    expect(classifyCosmeticAt([replace(true, 0.708)], true, 0.7)).toBe('sucesso');
    expect(classifyCosmeticAt([fail(true, 0.5)], false, 0.7)).toBe('fail');
  });

  test('replace que vira fail com limiar maior: a execução vira fail', () => {
    expect(classifyCosmeticAt([replace(true, 0.708)], true, 0.75)).toBe('fail');
  });

  test('fail que vira replace no elemento certo: desfecho do teste não observado', () => {
    expect(classifyCosmeticAt([fail(true, 0.5)], false, 0.5)).toBe('indeterminado');
    expect(aggregateRecoveryAt(['sucesso', 'indeterminado'])).toBe('indeterminada');
    expect(aggregateRecoveryAt(['indeterminado', 'fail'])).toBe('não recuperada');
  });

  test('fail que vira replace no elemento errado: cura incorreta, sem depender do teste', () => {
    expect(classifyCosmeticAt([fail(false, 0.5)], false, 0.5)).toBe('cura incorreta');
  });
});

test.describe('posição do candidato', () => {
  test('índice base 0 pelo último :nth-child do seletor registrado', () => {
    expect(candidateSiblingIndex("locator('body > :nth-child(2) > :nth-child(1) > :nth-child(3)')")).toBe(2);
    expect(candidateSiblingIndex('body > :nth-child(1)')).toBe(0);
    expect(candidateSiblingIndex(null)).toBeNull();
    expect(candidateSiblingIndex("locator('h1')")).toBeNull();
  });
});

test.describe('teste reproduzido da matriz', () => {
  test('mapeia cada forma de nome para o id do harness', () => {
    expect(reproducedTestId('home')).toBe('tests/home.spec.ts › exibe a lista de categorias e o grid de produtos');
    expect(reproducedTestId('pagination')).toBe('tests/pagination.spec.ts › avança para a próxima página e exibe produtos diferentes');
    expect(reproducedTestId('category-navigation › Sequential Art')).toBe(
      'tests/category-navigation.spec.ts › navega da Home para a categoria "Sequential Art" e exibe a listagem correspondente',
    );
    expect(reproducedTestId('product-details #3 › Travel')).toBe(
      'tests/product-details.spec.ts › produto de "Travel" exibe uma classificação por estrelas válida (1 a 5)',
    );
    expect(() => reproducedTestId('product-details #4 › Travel')).toThrow();
  });
});
