import { test, expect, Locator } from '@playwright/test';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { Fingerprint } from '../healing/fingerprint';
import { fingerprintPath } from '../healing/fingerprintStore';
import { matchByStructuralSimilarity } from '../healing/heuristics/structuralHeuristic';

/**
 * Validação da heurística estrutural contra o alvo real do TCC.
 *
 * Diferente dos unitários em `healing/`, estes testes carregam um fingerprint
 * gravado por uma execução real da suíte baseline, abrem a página de verdade e
 * exigem que a busca estrutural reencontre o elemento. É o que separa "a lógica
 * está correta" de "funciona no site avaliado".
 *
 * O oráculo é `tag` + `text` do próprio fingerprint: o campo `selector` é
 * descrição textual escrita à mão (`role=article`), não seletor resolvível, e
 * reconstruí-lo acoplaria este teste aos Page Objects sem necessidade.
 */

const FINGERPRINTS_DIR = path.resolve(__dirname, '..', 'healing', 'fingerprints');

/**
 * Amostra com geometria **discriminante**: o elemento é o único da página com
 * aquela posição estrutural. Inclui os três tipos de página da suíte — listagem
 * por categoria, detalhe de produto e listagem paginada.
 *
 * O `article` entra aqui porque seu pai é o `<li>` do card, e o índice do `<li>`
 * entre os irmãos é justamente o que separa um produto do outro.
 */
const AMOSTRA_DISCRIMINANTE = [
  { url: '/catalogue/category/books/art_25/index.html', selector: 'role=article' },
  { url: '/catalogue/category/books/art_25/index.html', selector: 'role=heading[level=1]' },
  { url: '/catalogue/its-only-the-himalayas_981/index.html', selector: 'role=heading[level=1]' },
  { url: '/catalogue/its-only-the-himalayas_981/index.html', selector: '.product_main p.price_color' },
];

/**
 * Amostra **estruturalmente ambígua**: elementos a dois ou mais níveis abaixo do
 * container que se repete. Dentro de um card de produto a geometria é idêntica
 * em todos os cards (o `h3` de todos os 20 produtos de uma listagem tem pai
 * `article` no índice 0, irmão 2, profundidade 9) — o índice que distingue os
 * cards está no `<li>`, que é o avô, e o fingerprint da Camada 1 guarda só um
 * nível de ancestral.
 *
 * O match continua **correto** (ver asserções abaixo), mas a heurística sinaliza
 * a ambiguidade em vez de escondê-la.
 */
const AMOSTRA_AMBIGUA = [
  {
    url: '/catalogue/category/books/art_25/index.html',
    selector: 'role=article[0] >> role=heading[level=3] >> role=link',
  },
  { url: '/catalogue/page-2.html', selector: 'role=article >> role=heading[level=3]' },
];

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function loadFingerprint(key: { url: string; selector: string }): Promise<Fingerprint> {
  return JSON.parse(await readFile(fingerprintPath(key), 'utf8')) as Fingerprint;
}

/** Oráculo: o candidato tem de ser o elemento que a Camada 1 gravou. */
async function expectMatchesFingerprint(
  locator: Locator,
  fingerprint: Fingerprint,
): Promise<void> {
  expect(await locator.evaluate((el) => el.tagName.toLowerCase())).toBe(fingerprint.tag);
  expect(normalize(await locator.innerText())).toBe(fingerprint.text);
}

for (const key of AMOSTRA_DISCRIMINANTE) {
  test(`reencontra "${key.selector}" em ${key.url}`, async ({ page }) => {
    const fingerprint = await loadFingerprint(key);
    await page.goto(fingerprint.url);

    const result = await matchByStructuralSimilarity(page, fingerprint);

    expect(result.applicable).toBe(true);
    expect(result.matched).toBe(true);
    // Página sem mutação: a geometria tem de bater em cheio nos quatro sinais.
    expect(result.strategy).toBe('parent+siblingPosition');
    expect(result.score).toBeCloseTo(1);
    expect(result.ambiguous).toBe(false);
    await expectMatchesFingerprint(result.locator!, fingerprint);
  });
}

for (const key of AMOSTRA_AMBIGUA) {
  test(`reencontra "${key.selector}" em ${key.url}, sinalizando ambiguidade`, async ({ page }) => {
    const fingerprint = await loadFingerprint(key);
    await page.goto(fingerprint.url);

    const result = await matchByStructuralSimilarity(page, fingerprint);

    expect(result.matched).toBe(true);
    expect(result.score).toBeCloseTo(1);
    // Vários cards com a mesma geometria: a heurística acerta o elemento, mas
    // não tem como provar que acertou — e diz isso.
    expect(result.ambiguous).toBe(true);
    expect(result.candidateCount).toBeGreaterThan(1);
    // Acerta porque a captura da Camada 1 usa `.first()` e o desempate é a ordem
    // do documento — coincidência de convenção, não discriminação estrutural.
    await expectMatchesFingerprint(result.locator!, fingerprint);
  });
}

test('reencontra o elemento na página real depois de class e id serem reescritos', async ({ page }) => {
  // Prova a tese central sobre HTML de produção, não sobre fixture: a mutação é
  // aplicada ao DOM já carregado do site (não é a ferramenta de mutação do TODO
  // item 6), e a heurística tem de devolver o mesmo elemento de antes.
  const fingerprint = await loadFingerprint({
    url: '/catalogue/category/books/art_25/index.html',
    selector: 'role=article',
  });
  await page.goto(fingerprint.url);

  const antes = await matchByStructuralSimilarity(page, fingerprint);
  expect(antes.matched).toBe(true);

  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el, index) => {
      el.setAttribute('class', `hash-${index}-${Math.random().toString(36).slice(2)}`);
      el.setAttribute('id', `gen-${index}`);
    });
  });

  const depois = await matchByStructuralSimilarity(page, fingerprint);

  expect(depois.matched).toBe(true);
  expect(depois.score).toBeCloseTo(antes.score);
  expect(depois.ambiguous).toBe(false);
  expect(normalize(await depois.locator!.innerText())).toBe(fingerprint.text);
});

test.describe('limite de identificabilidade posicional', () => {
  /**
   * Teste de caracterização: fixa um comportamento **indesejado mas inerente**,
   * para que ele não seja redescoberto tarde, no meio dos experimentos.
   *
   * Reordenar elementos é uma das mutações previstas no escopo do TCC, e é
   * exatamente a que inverte identidade-por-posição: a geometria do fingerprint
   * passa a descrever com precisão um elemento *diferente*. A heurística não tem
   * como perceber — e não percebe.
   *
   * Este teste **continua passando de propósito**: ele fixa o limite da
   * heurística isolada, que não mudou — nenhum sinal posicional poderia
   * distinguir "o elemento se moveu" de "outro ocupou o lugar dele". O que a
   * etapa de score acrescentou foi a outra metade da evidência: o mesmo cenário,
   * atravessando a combinação, é rebaixado pela corroboração de texto e recusado
   * pela camada de decisão — ver `confidenceScore.spec.ts`, "regressão —
   * reordenação". As duas asserções juntas são o argumento de por que a combinação
   * existe e por que uma heurística sozinha não basta.
   */
  test('reordenar cards produz match incorreto com confiança máxima', async ({ page }) => {
    const fingerprint = await loadFingerprint({
      url: '/catalogue/category/books/art_25/index.html',
      selector: 'role=article',
    });
    await page.goto(fingerprint.url);

    await page.evaluate(() => {
      const lista = document.querySelector('ol.row') ?? document.querySelector('ol');
      if (lista) [...lista.children].reverse().forEach((item) => lista.appendChild(item));
    });

    const result = await matchByStructuralSimilarity(page, fingerprint);

    // Geometria casa em cheio: o `<li>` de índice 0 continua existindo, só que
    // agora contém outro livro.
    expect(result.matched).toBe(true);
    expect(result.score).toBeCloseTo(1);
    // E não há ambiguidade para sinalizar o erro — o match é único e está errado.
    expect(result.ambiguous).toBe(false);
    expect(normalize(await result.locator!.innerText())).not.toBe(fingerprint.text);
  });
});

test.describe('baseline versionado', () => {
  test('a posição estrutural é utilizável nos 134 fingerprints do alvo', async () => {
    // Sem rede, mas pertence a esta categoria: é uma afirmação sobre os dados do
    // alvo real, não sobre a lógica da heurística.
    const arquivos: Fingerprint[] = [];
    for (const dir of await readdir(FINGERPRINTS_DIR)) {
      for (const file of await readdir(path.join(FINGERPRINTS_DIR, dir))) {
        arquivos.push(JSON.parse(await readFile(path.join(FINGERPRINTS_DIR, dir, file), 'utf8')));
      }
    }

    const semPosicao = arquivos.filter(
      (fp) => fp.position.parentTag === null && fp.position.siblingIndex < 0,
    );

    expect(arquivos).toHaveLength(134);
    expect(semPosicao).toEqual([]);
  });
});
