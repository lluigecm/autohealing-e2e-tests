import { test, expect, Page } from '@playwright/test';
import { Fingerprint } from '../fingerprint';
import { AttributeMatchResult } from '../heuristics/attributeHeuristic';
import { StructuralMatchResult } from '../heuristics/structuralHeuristic';
import {
  AMBIGUITY_FACTOR,
  DISAGREEMENT_FACTOR,
  TEXT_CONTRADICTION_SIMILARITY,
  TEXT_FLOOR_FACTOR,
  combineConfidence,
  textCorroborationFactor,
  textSimilarity,
} from './confidenceScore';

/**
 * Testes unitários da combinação: DOM montado com `setContent`, zero rede.
 * Os resultados das heurísticas são construídos à mão de propósito — o que
 * está sob teste é a aritmética da combinação e as quatro restrições, não as
 * heurísticas, que têm testes próprios.
 *
 * Os locators, porém, são reais: a comparação de divergência e a corroboração de
 * texto consultam o DOM, e um mock de `Locator` validaria o mock.
 */

/**
 * Dois cards com o mesmo boilerplate dos cards do alvo real ("in stock", "add to
 * basket"), porque é esse texto compartilhado que define a similaridade mínima
 * entre dois produtos **diferentes** — o número que a rampa de corroboração tem
 * de conseguir separar de uma edição legítima de conteúdo.
 */
const LISTAGEM = `
  <main>
    <ol>
      <li><article>Wall and Piece £44.18 In stock Add to basket</article></li>
      <li><article>Ways of Seeing £16.21 In stock Add to basket</article></li>
    </ol>
  </main>
`;

const TEXTO_PRIMEIRO_CARD = 'Wall and Piece £44.18 In stock Add to basket';

function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    selector: 'role=article',
    url: '/catalogue/category/books/art_25/index.html',
    tag: 'article',
    text: TEXTO_PRIMEIRO_CARD,
    attributes: { stable: {}, volatile: { class: 'product_pod', id: null } },
    position: { parentTag: 'li', parentSiblingIndex: 0, siblingIndex: 0, depth: 3 },
    ...overrides,
  };
}

function attributeResult(overrides: Partial<AttributeMatchResult> = {}): AttributeMatchResult {
  return {
    matched: false,
    score: 0,
    strategy: 'none',
    locator: null,
    ambiguous: false,
    candidateCount: 0,
    matchedAttributes: [],
    tiebreakUsed: false,
    applicable: false,
    ...overrides,
  };
}

function structuralResult(overrides: Partial<StructuralMatchResult> = {}): StructuralMatchResult {
  return {
    matched: false,
    score: 0,
    strategy: 'none',
    locator: null,
    ambiguous: false,
    candidateCount: 0,
    consideredCount: 0,
    matchedSignals: [],
    applicable: true,
    ...overrides,
  };
}

/** Candidato correto: o article do primeiro `<li>`. */
function primeiroCard(page: Page) {
  return page.locator('li:nth-child(1) article');
}

/** Candidato errado: mesma geometria, outro conteúdo — o caso da reordenação. */
function segundoCard(page: Page) {
  return page.locator('li:nth-child(2) article');
}

test.describe('restrição 1 e 4 — aplicabilidade', () => {
  test('nenhuma heurística aplicável devolve "sem confiança", não zero', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ applicable: false }),
      fingerprint(),
    );

    // O ponto da restrição 4: `null` e `0` são afirmações diferentes.
    expect(result.score).toBeNull();
    expect(result.reason).toBe('no-applicable-heuristic');
    expect(result.locator).toBeNull();
    expect(result.contributingHeuristics).toEqual([]);
  });

  test('heurística inaplicável sai do cálculo em vez de puxar o score para baixo', async ({
    page,
  }) => {
    await page.setContent(LISTAGEM);

    // Caso do alvo real: atributos inaplicável, estrutural sozinha.
    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ applicable: true, matched: true, score: 1, locator: primeiroCard(page) }),
      fingerprint(),
    );

    expect(result.score).toBeCloseTo(1);
    expect(result.contributingHeuristics).toHaveLength(1);
    expect(result.contributingHeuristics[0].heuristic).toBe('structural-similarity');
  });

  test('aplicável sem match registra a flag sem descontar o score', async ({ page }) => {
    await page.setContent(LISTAGEM);

    // Sinais disjuntos: não achar por atributo nada afirma sobre a geometria.
    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: false, score: 0 }),
      structuralResult({ matched: true, score: 1, locator: primeiroCard(page) }),
      fingerprint(),
    );

    expect(result.flags).toContain('searched-without-match');
    expect(result.score).toBeCloseTo(1);
    expect(result.contributingHeuristics).toHaveLength(2);
  });

  test('aplicáveis sem nenhum candidato é "sem confiança" por outro motivo', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: false }),
      structuralResult({ matched: false }),
      fingerprint(),
    );

    expect(result.score).toBeNull();
    // Distinguir de `no-applicable-heuristic`: aqui se mediu, lá não havia o que medir.
    expect(result.reason).toBe('no-candidate-found');
  });
});

test.describe('passo 2 — combinação das duas aplicáveis', () => {
  test('concordando, prevalece a evidência mais forte sem diluir na mais fraca', async ({
    page,
  }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: true, score: 0.9, locator: primeiroCard(page) }),
      structuralResult({ matched: true, score: 0.6, locator: primeiroCard(page) }),
      fingerprint(),
    );

    // Média daria 0.75 e puniria um match que a outra heurística corrobora.
    expect(result.score).toBeCloseTo(0.9);
    expect(result.flags).toContain('heuristics-agree');
  });

  test('divergindo, o maior score é descontado e a divergência fica registrada', async ({
    page,
  }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: true, score: 0.9, locator: primeiroCard(page) }),
      structuralResult({ matched: true, score: 0.8, locator: segundoCard(page) }),
      fingerprint(),
    );

    // Uma das duas está errada e o score não tem como saber qual.
    expect(result.flags).toContain('heuristics-disagree');
    expect(result.score).toBeCloseTo(0.9 * DISAGREEMENT_FACTOR);
    expect(result.locator).not.toBeNull();
  });

  test('empate de score é resolvido a favor do atributo estável', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: true, score: 0.8, locator: primeiroCard(page) }),
      structuralResult({ matched: true, score: 0.8, locator: segundoCard(page) }),
      fingerprint(),
    );

    // A hierarquia de evidência do trabalho põe atributo acima de geometria.
    await expect(result.locator!).toHaveText(TEXTO_PRIMEIRO_CARD);
  });
});

test.describe('passo 3 — restrição 2', () => {
  test('ambiguidade não resolvida não cruza o limiar sozinha', async ({ page }) => {
    await page.setContent(LISTAGEM);

    // Geometria idêntica: 20 cards de geometria idêntica, score bruto 1.0.
    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({
        matched: true,
        score: 1,
        locator: primeiroCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      fingerprint(),
    );

    expect(result.flags).toContain('unresolved-ambiguity');
    expect(result.score).toBeCloseTo(AMBIGUITY_FACTOR);
    // É isto que a restrição 2 exige, e o número que a sustenta.
    expect(result.score!).toBeLessThan(0.7);
  });

  test('ambiguidade de uma heurística é resolvida pela concordância da outra', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: true, score: 1, locator: primeiroCard(page) }),
      structuralResult({
        matched: true,
        score: 1,
        locator: primeiroCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      fingerprint(),
    );

    // Evidência independente apontando o mesmo elemento é desambiguação real.
    expect(result.flags).toContain('ambiguity-resolved-by-agreement');
    expect(result.flags).not.toContain('unresolved-ambiguity');
    expect(result.score).toBeCloseTo(1);
  });

  test('ambiguidade das duas continua não resolvida mesmo concordando', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({
        applicable: true,
        matched: true,
        score: 1,
        locator: primeiroCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      structuralResult({
        matched: true,
        score: 1,
        locator: primeiroCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      fingerprint(),
    );

    // Duas heurísticas ambíguas que convergem pela ordem do documento não provam
    // nada que uma delas já não provasse.
    expect(result.flags).toContain('unresolved-ambiguity');
    expect(result.score).toBeCloseTo(AMBIGUITY_FACTOR);
  });
});

test.describe('passo 4 — restrição 3', () => {
  test('match geométrico perfeito no elemento errado é rebaixado pelo texto', async ({ page }) => {
    await page.setContent(LISTAGEM);

    // Reordenação: a geometria descreve com precisão um elemento *diferente*, e
    // não há ambiguidade a sinalizar — o match é único e está errado.
    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: segundoCard(page), ambiguous: false }),
      fingerprint(),
    );

    expect(result.flags).toContain('text-corroboration-divergent');
    expect(result.textSimilarity!).toBeLessThan(TEXT_CONTRADICTION_SIMILARITY);
    expect(result.score).toBeCloseTo(TEXT_FLOOR_FACTOR);
    expect(result.score!).toBeLessThan(0.7);
  });

  test('o texto desconta, nunca zera — pode ter mudado legitimamente', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: segundoCard(page) }),
      fingerprint({ text: 'texto completamente diferente do candidato' }),
    );

    // Portão binário rejeitaria; modulador desconta e deixa a decisão ao limiar.
    expect(result.score).toBeCloseTo(TEXT_FLOOR_FACTOR);
    expect(result.score!).toBeGreaterThan(0);
  });

  test('edição leve de conteúdo não impede a recuperação', async ({ page }) => {
    await page.setContent(LISTAGEM);

    // Mesmo card, preço reajustado: um token distinto em nove.
    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: primeiroCard(page) }),
      fingerprint({ text: 'Wall and Piece £41.18 In stock Add to basket' }),
    );

    expect(result.textSimilarity!).toBeGreaterThan(TEXT_CONTRADICTION_SIMILARITY);
    expect(result.score!).toBeGreaterThanOrEqual(0.7);
  });

  test('fingerprint sem texto não pode corroborar, e isso fica explícito', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: primeiroCard(page) }),
      fingerprint({ text: '' }),
    );

    expect(result.flags).toContain('text-corroboration-unavailable');
    expect(result.textSimilarity).toBeNull();
    // Sem desconto: ausência de corroboração não é contradição.
    expect(result.score).toBeCloseTo(1);
  });

  test('descontos se acumulam multiplicativamente', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({
        matched: true,
        score: 1,
        locator: segundoCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      fingerprint(),
    );

    expect(result.score).toBeCloseTo(AMBIGUITY_FACTOR * TEXT_FLOOR_FACTOR);
  });
});

test.describe('saída para o log de experimentos', () => {
  test('as duas heurísticas aparecem, com applicable explícito e o próprio candidato', async ({
    page,
  }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: true, matched: true, score: 0.9, locator: primeiroCard(page) }),
      structuralResult({ matched: true, score: 0.8, locator: segundoCard(page) }),
      fingerprint(),
    );

    expect(result.heuristics.map((h) => [h.heuristic, h.applicable, h.score])).toEqual([
      ['stable-attributes', true, 0.9],
      ['structural-similarity', true, 0.8],
    ]);
    // Candidatos distintos: é o que torna a divergência reconstituível a partir do log.
    expect(result.heuristics[0].candidate).toContain('nth-child(1)');
    expect(result.heuristics[1].candidate).toContain('nth-child(2)');
    expect(result.factors!.disagreement).toBe(DISAGREEMENT_FACTOR);
  });

  test('inaplicável aparece com applicable: false, sem entrar no cálculo', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: primeiroCard(page) }),
      fingerprint(),
    );

    expect(result.heuristics[0]).toMatchObject({ heuristic: 'stable-attributes', applicable: false, candidate: null });
    expect(result.contributingHeuristics).toHaveLength(1);
  });

  test('score final é o bruto vezes os fatores aplicados', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({
        matched: true,
        score: 0.9,
        locator: segundoCard(page),
        ambiguous: true,
        candidateCount: 20,
      }),
      fingerprint(),
    );

    // A identidade que permite recalcular offline cada configuração da ablação.
    const { disagreement, ambiguity, text } = result.factors!;
    expect(result.rawScore).toBeCloseTo(0.9);
    expect({ disagreement, ambiguity, text }).toEqual({
      disagreement: 1,
      ambiguity: AMBIGUITY_FACTOR,
      text: TEXT_FLOOR_FACTOR,
    });
    expect(result.score).toBeCloseTo(result.rawScore! * disagreement * ambiguity * text);
  });

  test('textSimilarity é a medida antes do piso, não o fator', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: true, score: 1, locator: segundoCard(page) }),
      fingerprint(),
    );

    expect(result.factors!.text).toBe(TEXT_FLOOR_FACTOR);
    expect(result.textSimilarity!).toBeLessThan(TEXT_FLOOR_FACTOR);
    expect(result.textSimilarity).toBeCloseTo(
      textSimilarity(TEXTO_PRIMEIRO_CARD, 'Ways of Seeing £16.21 In stock Add to basket'),
    );
  });

  test('sem candidato, bruto e fatores são null junto com o score', async ({ page }) => {
    await page.setContent(LISTAGEM);

    const result = await combineConfidence(
      attributeResult({ applicable: false }),
      structuralResult({ matched: false }),
      fingerprint(),
    );

    expect(result.rawScore).toBeNull();
    expect(result.factors).toBeNull();
    expect(result.heuristics).toHaveLength(2);
  });
});

test.describe('instrumentos de medida', () => {
  test('a similaridade de token é simétrica e normalizada', () => {
    expect(textSimilarity('In Her Wake', 'in her wake')).toBeCloseTo(1);
    expect(textSimilarity('In  Her\nWake ', 'In Her Wake')).toBeCloseTo(1);
    expect(textSimilarity('abc', 'xyz')).toBeCloseTo(0);
    expect(textSimilarity('a b', 'b a')).toBeCloseTo(1);
  });

  test('dois cards diferentes do alvo ficam abaixo do patamar de contradição', () => {
    // O boilerplate compartilhado é justamente o que torna a rampa de dois
    // patamares necessária: 0.385 ainda é "texto diferente", não "texto parecido".
    const similaridade = textSimilarity(
      TEXTO_PRIMEIRO_CARD,
      'Ways of Seeing £16.21 In stock Add to basket',
    );

    expect(similaridade).toBeLessThan(TEXT_CONTRADICTION_SIMILARITY);
    expect(textCorroborationFactor(similaridade)).toBeCloseTo(TEXT_FLOOR_FACTOR);
  });

  test('a rampa do fator de corroboração é contínua entre os patamares', () => {
    expect(textCorroborationFactor(1)).toBeCloseTo(1);
    expect(textCorroborationFactor(0.9)).toBeCloseTo(1);
    expect(textCorroborationFactor(0.7)).toBeCloseTo(0.75);
    expect(textCorroborationFactor(0.5)).toBeCloseTo(TEXT_FLOOR_FACTOR);
    expect(textCorroborationFactor(0)).toBeCloseTo(TEXT_FLOOR_FACTOR);
  });
});
