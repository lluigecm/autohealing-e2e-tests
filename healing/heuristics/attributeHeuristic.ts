import { Locator, Page } from '@playwright/test';
import { Fingerprint } from '../fingerprint';

/**
 * Heurística de recuperação por atributos estáveis (Camada 3, parte 1/2).
 *
 * Dado um fingerprint de um elemento que existia numa versão anterior da página,
 * procura o elemento correspondente no DOM atual priorizando os atributos que
 * não costumam mudar (`data-testid`, `aria-label`, demais `data-*`/`aria-*`) em
 * detrimento dos voláteis (`class`, `id`), que são justamente os que mudam e
 * motivam a heurística.
 *
 * O score devolvido é **local a esta heurística** — não é o score de confiança
 * combinado da Camada 3 completa, que ainda não existe.
 */

export type AttributeMatchStrategy =
  /** Prioridade 1: `data-testid` idêntico. */
  | 'data-testid'
  /** Prioridade 2: `aria-label` idêntico. */
  | 'aria-label'
  /** Prioridade 3: combinação dos demais `data-*`/`aria-*`. */
  | 'stable-attributes'
  /** Nenhum candidato encontrado (ou heurística inaplicável). */
  | 'none';

export interface AttributeMatchResult {
  /** `false` quando nenhum candidato foi encontrado — não é erro. */
  matched: boolean;
  /** Confiança desta heurística, normalizada em [0, 1]. Sem match, 0. */
  score: number;
  /** Qual regra de priorização produziu o resultado. */
  strategy: AttributeMatchStrategy;
  /** Candidato encontrado, para uso da futura camada de decisão. */
  locator: Locator | null;
  /** `true` quando mais de um elemento casou igualmente bem na estratégia vencedora. */
  ambiguous: boolean;
  /** Quantos elementos casaram igualmente bem antes do desempate. */
  candidateCount: number;
  /** Atributos estáveis que efetivamente casaram no candidato escolhido. */
  matchedAttributes: string[];
  /** `true` quando `class`/`id` foram usados para desempatar candidatos empatados. */
  tiebreakUsed: boolean;
  /**
   * `false` quando o fingerprint não tem nenhum atributo estável — a heurística
   * não chegou a rodar. Distinguir isso de "rodou e não achou" importa para a
   * camada de decisão e para a leitura dos experimentos.
   */
  applicable: boolean;
}

/**
 * Teto de confiança por estratégia. A escada é intencional: `data-testid` existe
 * para identificar elemento em teste, `aria-label` descreve função e pode se
 * repetir, e uma combinação de `data-*`/`aria-*` genéricos é o sinal mais fraco
 * dos três.
 */
const STRATEGY_WEIGHT = {
  'data-testid': 1,
  'aria-label': 0.9,
  'stable-attributes': 0.75,
} as const;

/** Empate resolvido por `class`/`id`: o sinal de desempate é volátil, então custa confiança. */
const TIEBREAK_PENALTY = 0.8;
/** Empate não resolvido nem pelos voláteis: a escolha do primeiro é quase arbitrária. */
const UNRESOLVED_AMBIGUITY_PENALTY = 0.5;

const TESTID_ATTRIBUTE = 'data-testid';
const ARIA_LABEL_ATTRIBUTE = 'aria-label';

function noMatch(applicable: boolean): AttributeMatchResult {
  return {
    matched: false,
    score: 0,
    strategy: 'none',
    locator: null,
    ambiguous: false,
    candidateCount: 0,
    matchedAttributes: [],
    tiebreakUsed: false,
    applicable,
  };
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function attributeSelector(name: string, value: string): string {
  return `[${name}="${escapeAttributeValue(value)}"]`;
}

interface VolatileSnapshot {
  class: string | null;
  id: string | null;
}

/**
 * Quão bem os voláteis de um candidato batem com os do fingerprint. Usado
 * **apenas** para desempatar candidatos que já casaram em atributos estáveis —
 * nunca como critério de busca isolado (regra 4 do documento de contexto).
 */
function volatileAffinity(fingerprint: VolatileSnapshot, candidate: VolatileSnapshot): number {
  let affinity = 0;

  if (fingerprint.id !== null && fingerprint.id === candidate.id) {
    affinity += 2;
  }

  if (fingerprint.class !== null && candidate.class !== null) {
    const expected = new Set(fingerprint.class.split(/\s+/).filter(Boolean));
    const actual = new Set(candidate.class.split(/\s+/).filter(Boolean));
    const shared = [...expected].filter((token) => actual.has(token)).length;
    const union = new Set([...expected, ...actual]).size;
    if (union > 0) {
      // Jaccard: classe idêntica vale 1, classe parcialmente reescrita vale menos.
      affinity += shared / union;
    }
  }

  return affinity;
}

interface CandidateSnapshot {
  index: number;
  volatile: VolatileSnapshot;
  /** Atributos estáveis do fingerprint presentes com o mesmo valor neste candidato. */
  matchedAttributes: string[];
}

/**
 * Lê, de uma vez só, os voláteis e os atributos estáveis casados de cada
 * elemento que o seletor retornou — uma chamada ao browser em vez de N.
 */
async function snapshotCandidates(
  locator: Locator,
  expectedStable: Record<string, string>,
): Promise<CandidateSnapshot[]> {
  return locator.evaluateAll(
    (elements, expected: Record<string, string>) =>
      elements.map((el, index) => ({
        index,
        volatile: {
          class: el.getAttribute('class'),
          id: el.getAttribute('id'),
        },
        matchedAttributes: Object.entries(expected)
          .filter(([name, value]) => el.getAttribute(name) === value)
          .map(([name]) => name),
      })),
    expectedStable,
  );
}

/**
 * Escolhe entre candidatos empatados e converte o resultado em score final.
 * `candidates` já chega aqui filtrado pelos que casaram igualmente bem.
 */
function resolve(
  fingerprint: Fingerprint,
  base: Locator,
  candidates: CandidateSnapshot[],
  strategy: Exclude<AttributeMatchStrategy, 'none'>,
  baseScore: number,
): AttributeMatchResult {
  if (candidates.length === 1) {
    const [only] = candidates;
    return {
      matched: true,
      score: baseScore,
      strategy,
      locator: base.nth(only.index),
      ambiguous: false,
      candidateCount: 1,
      matchedAttributes: only.matchedAttributes,
      tiebreakUsed: false,
      applicable: true,
    };
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    affinity: volatileAffinity(fingerprint.attributes.volatile, candidate.volatile),
  }));

  const bestAffinity = Math.max(...scored.map((entry) => entry.affinity));
  const leaders = scored.filter((entry) => entry.affinity === bestAffinity);
  // O desempate só conta se elegeu um vencedor único E esse vencedor tem algum
  // sinal volátil a favor — empate em afinidade 0 não desempatou nada.
  const tiebreakUsed = leaders.length === 1 && bestAffinity > 0;
  const winner = (tiebreakUsed ? leaders[0] : scored[0]).candidate;

  return {
    matched: true,
    score: baseScore * (tiebreakUsed ? TIEBREAK_PENALTY : UNRESOLVED_AMBIGUITY_PENALTY),
    strategy,
    locator: base.nth(winner.index),
    // A ambiguidade é sinalizada mesmo quando o desempate resolveu: quem decide
    // se confia no resultado é a camada de decisão, não esta função.
    ambiguous: true,
    candidateCount: candidates.length,
    matchedAttributes: winner.matchedAttributes,
    tiebreakUsed,
    applicable: true,
  };
}

/** Prioridades 1 e 2: um único atributo, valor idêntico. */
async function matchBySingleAttribute(
  page: Page,
  fingerprint: Fingerprint,
  attribute: typeof TESTID_ATTRIBUTE | typeof ARIA_LABEL_ATTRIBUTE,
): Promise<AttributeMatchResult | null> {
  const value = fingerprint.attributes.stable[attribute];
  if (value === undefined) {
    return null;
  }

  const base = page.locator(attributeSelector(attribute, value));
  const candidates = await snapshotCandidates(base, { [attribute]: value });
  if (candidates.length === 0) {
    return null;
  }

  return resolve(fingerprint, base, candidates, attribute, STRATEGY_WEIGHT[attribute]);
}

/**
 * Prioridade 3: demais `data-*`/`aria-*`. Busca quem tem *algum* deles e pontua
 * pela fração do conjunto que casou — um elemento que bate em 3 de 3 atributos
 * vale mais que outro que bate em 1 de 3.
 */
async function matchByRemainingAttributes(
  page: Page,
  fingerprint: Fingerprint,
): Promise<AttributeMatchResult | null> {
  const remaining = Object.entries(fingerprint.attributes.stable).filter(
    ([name]) => name !== TESTID_ATTRIBUTE && name !== ARIA_LABEL_ATTRIBUTE,
  );
  if (remaining.length === 0) {
    return null;
  }

  const expected = Object.fromEntries(remaining);
  const base = page.locator(
    remaining.map(([name, value]) => attributeSelector(name, value)).join(','),
  );
  const candidates = await snapshotCandidates(base, expected);

  const best = Math.max(0, ...candidates.map((candidate) => candidate.matchedAttributes.length));
  if (best === 0) {
    return null;
  }

  const leaders = candidates.filter((candidate) => candidate.matchedAttributes.length === best);
  const coverage = best / remaining.length;

  return resolve(
    fingerprint,
    base,
    leaders,
    'stable-attributes',
    STRATEGY_WEIGHT['stable-attributes'] * coverage,
  );
}

/**
 * Procura no DOM atual de `page` o elemento descrito por `fingerprint`.
 *
 * Nunca lança por ausência de candidato: "não encontrei" é resultado válido e
 * esperado desta função (`matched: false`, `score: 0`), não erro.
 */
export async function matchByStableAttributes(
  page: Page,
  fingerprint: Fingerprint,
): Promise<AttributeMatchResult> {
  const applicable = Object.keys(fingerprint.attributes.stable).length > 0;
  if (!applicable) {
    return noMatch(false);
  }

  return (
    (await matchBySingleAttribute(page, fingerprint, TESTID_ATTRIBUTE)) ??
    (await matchBySingleAttribute(page, fingerprint, ARIA_LABEL_ATTRIBUTE)) ??
    (await matchByRemainingAttributes(page, fingerprint)) ??
    noMatch(true)
  );
}
