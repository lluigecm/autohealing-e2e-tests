import { test, expect, Page } from '@playwright/test';
import { readFile } from 'fs/promises';
import { Fingerprint } from '../healing/fingerprint';
import { fingerprintPath } from '../healing/fingerprintStore';
import { matchByStableAttributes } from '../healing/heuristics/attributeHeuristic';
import { matchByStructuralSimilarity } from '../healing/heuristics/structuralHeuristic';
import {
  AMBIGUITY_FACTOR,
  ConfidenceResult,
  TEXT_CONTRADICTION_SIMILARITY,
  TEXT_FLOOR_FACTOR,
  combineConfidence,
} from '../healing/decision/confidenceScore';
import { CONFIDENCE_THRESHOLD, decide } from '../healing/decision/decide';

/**
 * Validação do score de confiança contra o alvo real, com os fingerprints
 * versionados da Camada 1 e as duas heurísticas de verdade — não resultados
 * construídos à mão como nos unitários.
 *
 * É aqui que a restrição 3 (corroboração por texto) deixa de ser documentação e passa a ser
 * comportamento verificado: o teste de reordenação abaixo é o critério de
 * conclusão desta etapa.
 */

const AMOSTRA_DISCRIMINANTE = {
  url: '/catalogue/category/books/art_25/index.html',
  selector: 'role=article',
};

const AMOSTRA_AMBIGUA = {
  url: '/catalogue/page-2.html',
  selector: 'role=article >> role=heading[level=3]',
};

async function loadFingerprint(key: { url: string; selector: string }): Promise<Fingerprint> {
  return JSON.parse(await readFile(fingerprintPath(key), 'utf8')) as Fingerprint;
}

/** Roda o mecanismo completo da Camada 3: duas heurísticas e a combinação. */
async function confidenceFor(page: Page, fingerprint: Fingerprint): Promise<ConfidenceResult> {
  return combineConfidence(
    await matchByStableAttributes(page, fingerprint),
    await matchByStructuralSimilarity(page, fingerprint),
    fingerprint,
  );
}

/** Reordena os cards de uma listagem — a mutação prevista no escopo do TCC. */
async function reordenarCards(page: Page): Promise<void> {
  await page.evaluate(() => {
    const lista = document.querySelector('ol.row') ?? document.querySelector('ol');
    if (lista) [...lista.children].reverse().forEach((item) => lista.appendChild(item));
  });
}

test.describe('página íntegra', () => {
  test('elemento de geometria discriminante é recuperado com confiança máxima', async ({
    page,
  }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_DISCRIMINANTE);
    await page.goto(fingerprint.url);

    const confidence = await confidenceFor(page, fingerprint);

    expect(confidence.score).toBeCloseTo(1);
    expect(confidence.textSimilarity).toBeCloseTo(1);
    expect(decide(fingerprint, confidence).decision).toBe('replace');
  });

  test('a combinação é de uma heurística só no alvo real', async ({ page }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_DISCRIMINANTE);
    await page.goto(fingerprint.url);

    const confidence = await confidenceFor(page, fingerprint);

    // Consequência direta da restrição 1: sem `data-*`/`aria-*` no alvo, a
    // heurística de atributos não entra no cálculo — e a estrutural sustenta
    // sozinha toda a recuperação.
    expect(confidence.contributingHeuristics.map((item) => item.heuristic)).toEqual([
      'structural-similarity',
    ]);
    expect(confidence.flags).not.toContain('heuristics-agree');
    expect(confidence.flags).not.toContain('heuristics-disagree');
  });

  test('elemento em estrutura repetida não é substituído automaticamente', async ({ page }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_AMBIGUA);
    await page.goto(fingerprint.url);

    const confidence = await confidenceFor(page, fingerprint);

    // O texto corrobora — o elemento devolvido *é* o certo — mas a
    // ambiguidade de 20 candidatos idênticos derruba o score abaixo do limiar.
    // No alvo atual, portanto, só geometria discriminante se cura: acertar por
    // ordem do documento não é evidência suficiente para substituir sem revisão.
    expect(confidence.textSimilarity).toBeCloseTo(1);
    expect(confidence.flags).toContain('unresolved-ambiguity');
    expect(confidence.score).toBeCloseTo(AMBIGUITY_FACTOR);
    expect(decide(fingerprint, confidence).decision).toBe('fail');
  });
});

test.describe('mutação de class e id', () => {
  test('a recuperação sobrevive à reescrita dos atributos voláteis', async ({ page }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_DISCRIMINANTE);
    await page.goto(fingerprint.url);

    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el, index) => {
        el.setAttribute('class', `hash-${index}-${Math.random().toString(36).slice(2)}`);
        el.setAttribute('id', `gen-${index}`);
      });
    });

    const confidence = await confidenceFor(page, fingerprint);

    // A tese central do trabalho, medida ponta a ponta sobre HTML de produção:
    // o seletor original dependia de `class`, o mecanismo não.
    expect(confidence.score).toBeCloseTo(1);
    expect(decide(fingerprint, confidence).decision).toBe('replace');
  });
});

test.describe('regressão — reordenação', () => {
  /**
   * Contraparte do teste de caracterização em `structuralHeuristic.spec.ts`:
   * lá a heurística isolada devolve score 1.0 e `ambiguous: false` para o
   * elemento errado, e continua devolvendo — é limite dela, não defeito.
   * Aqui, atravessando a combinação, a corroboração por texto rebaixa o mesmo
   * match e a camada de decisão recusa a substituição.
   */
  test('match geometricamente perfeito no elemento errado não é substituído', async ({ page }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_DISCRIMINANTE);
    await page.goto(fingerprint.url);
    await reordenarCards(page);

    const confidence = await confidenceFor(page, fingerprint);

    // O candidato continua errado — nenhum sinal posicional poderia perceber.
    expect(await confidence.locator!.innerText()).not.toContain(fingerprint.text);
    // Mas o texto é sinal independente de posição, e contradiz o match.
    expect(confidence.flags).toContain('text-corroboration-divergent');
    expect(confidence.textSimilarity!).toBeLessThan(TEXT_CONTRADICTION_SIMILARITY);
    // 1.0 na heurística, TEXT_FLOOR_FACTOR depois da corroboração.
    expect(confidence.score).toBeCloseTo(TEXT_FLOOR_FACTOR);
    expect(confidence.score!).toBeLessThan(CONFIDENCE_THRESHOLD);

    const decision = decide(fingerprint, confidence);
    expect(decision.decision).toBe('fail');
    expect(decision.locator).toBeNull();
    // Falha visível em vez de falso positivo silencioso: o princípio do desenho.
    expect(decision.entry.flags).toContain('text-corroboration-divergent');
  });

  test('reordenação dentro de estrutura repetida acumula os dois descontos', async ({ page }) => {
    const fingerprint = await loadFingerprint(AMOSTRA_AMBIGUA);
    await page.goto(fingerprint.url);
    await reordenarCards(page);

    const confidence = await confidenceFor(page, fingerprint);

    expect(confidence.flags).toContain('unresolved-ambiguity');
    expect(confidence.flags).toContain('text-corroboration-divergent');
    expect(confidence.score).toBeCloseTo(AMBIGUITY_FACTOR * TEXT_FLOOR_FACTOR);
    expect(decide(fingerprint, confidence).decision).toBe('fail');
  });
});
