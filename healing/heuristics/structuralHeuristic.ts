import { Locator, Page } from '@playwright/test';
import { Fingerprint } from '../fingerprint';

/**
 * Heurística de recuperação por similaridade estrutural (Camada 3, parte 2/2).
 *
 * Dado um fingerprint de um elemento que existia numa versão anterior da página,
 * procura o elemento correspondente no DOM atual comparando **posição na árvore**
 * — pai, índice entre irmãos, profundidade e tag — sem olhar atributo nenhum.
 *
 * É a contraparte da heurística de atributos estáveis: aquela depende de
 * instrumentação que o alvo do TCC não tem, esta depende só de estrutura, que
 * todo elemento tem. O score devolvido é **local a esta heurística**, não o
 * score de confiança combinado (etapa seguinte).
 */

export type StructuralMatchStrategy =
  /** Critério 1: mesmo pai (tag + posição do pai) e mesmo índice entre irmãos. */
  | 'parent+siblingPosition'
  /** Critério 2: mesma profundidade e mesma tag, pontuado por proximidade de irmão. */
  | 'depth+tag'
  /** Critério 3: só um dos sinais bateu — candidato devolvido com score reduzido. */
  | 'partial'
  /** Nenhum candidato acima do piso de plausibilidade. */
  | 'none';

/** Sinais estruturais avaliados, na ordem em que aparecem em `matchedSignals`. */
export type StructuralSignal = 'parent' | 'sibling' | 'depth' | 'tag';

export interface StructuralMatchResult {
  /** `false` quando nenhum candidato passou do piso — não é erro. */
  matched: boolean;
  /** Confiança desta heurística, normalizada em [0, 1]. Sem match, 0. */
  score: number;
  /** Qual critério estrutural decidiu o match. */
  strategy: StructuralMatchStrategy;
  /** Candidato encontrado, para uso da futura camada de decisão. */
  locator: Locator | null;
  /** `true` quando mais de um elemento empatou no melhor score. */
  ambiguous: boolean;
  /**
   * Quantos elementos empataram no melhor score — mesma semântica do
   * `candidateCount` da heurística de atributos, para a etapa de combinação
   * poder ler os dois resultados da mesma forma.
   */
  candidateCount: number;
  /** Quantos elementos passaram do piso e chegaram a ser pontuados. */
  consideredCount: number;
  /** Sinais estruturais que bateram no candidato escolhido. */
  matchedSignals: StructuralSignal[];
  /**
   * `false` só quando o fingerprint não tem posição estrutural utilizável
   * (elemento sem pai capturado). Esperado ser `true` na prática — ver
   * ADR-010: é `true` nos 134 fingerprints do baseline.
   */
  applicable: boolean;
}

/**
 * Pesos dos quatro sinais, somando 1.0. A hierarquia é a da seção 4 do contexto:
 * o par (pai, índice entre irmãos) é o critério forte, profundidade e tag são
 * corroboração — sozinhas não sustentam um match confiável.
 */
const WEIGHT = {
  parent: 0.45,
  sibling: 0.3,
  depth: 0.15,
  tag: 0.1,
} as const;

/** Pai com a tag certa mas em outra posição vale metade: é o mesmo tipo de container, não o mesmo container. */
const PARENT_TAG_ONLY_FACTOR = 0.5;
/** Distância de índice a partir da qual a vizinhança entre irmãos deixa de ser evidência. */
const SIBLING_DECAY_SPAN = 4;
/** Idem para profundidade: um nível de diferença ainda conta, dois já não. */
const DEPTH_DECAY_SPAN = 2;
/**
 * Piso de plausibilidade. Abaixo disso o candidato é ruído — `depth` + `tag`
 * (0.25) é o critério 2 no seu mínimo, então é exatamente onde o corte fica.
 */
const MIN_SCORE = 0.25;
/** Tolerância para comparar scores em ponto flutuante ao detectar empate. */
const SCORE_EPSILON = 1e-9;

function noMatch(applicable: boolean): StructuralMatchResult {
  return {
    matched: false,
    score: 0,
    strategy: 'none',
    locator: null,
    ambiguous: false,
    candidateCount: 0,
    consideredCount: 0,
    matchedSignals: [],
    applicable,
  };
}

/** Geometria de um elemento do DOM atual, nos mesmos termos que a Camada 1 capturou. */
interface CandidateGeometry {
  tag: string;
  depth: number;
  siblingIndex: number;
  parentTag: string | null;
  parentSiblingIndex: number | null;
  /** Caminho CSS por `:nth-child` a partir de `body`, para reconstruir o `Locator`. */
  path: string;
}

/**
 * Lê a geometria de todo o subtree de `<body>` numa única ida ao browser.
 *
 * As definições precisam casar com as de `withCapture.ts`, senão fingerprint e
 * candidato falariam línguas diferentes: `depth` conta ancestrais até `<body>`
 * exclusive (filho direto de body = 0), `siblingIndex` é o índice entre os
 * filhos do pai e `parentSiblingIndex` o índice do pai entre os filhos do avô.
 */
async function readGeometry(page: Page): Promise<CandidateGeometry[]> {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) {
      return [];
    }

    return Array.from(body.querySelectorAll('*')).map((el) => {
      const parent = el.parentElement;
      const grandparent = parent ? parent.parentElement : null;

      let depth = 0;
      let cursor = el.parentElement;
      while (cursor && cursor.tagName !== 'BODY') {
        depth += 1;
        cursor = cursor.parentElement;
      }

      const segments: string[] = [];
      let node: Element | null = el;
      while (node && node !== body && node.parentElement) {
        segments.unshift(`:nth-child(${Array.from(node.parentElement.children).indexOf(node) + 1})`);
        node = node.parentElement;
      }

      return {
        tag: el.tagName.toLowerCase(),
        depth,
        siblingIndex: parent ? Array.from(parent.children).indexOf(el) : -1,
        parentTag: parent ? parent.tagName.toLowerCase() : null,
        parentSiblingIndex:
          parent && grandparent ? Array.from(grandparent.children).indexOf(parent) : null,
        path: ['body', ...segments].join(' > '),
      };
    });
  });
}

/** Decaimento linear: 1 quando a distância é 0, 0 a partir de `span`. */
function proximity(distance: number, span: number): number {
  return Math.max(0, 1 - distance / span);
}

interface ScoredCandidate {
  geometry: CandidateGeometry;
  score: number;
  strategy: Exclude<StructuralMatchStrategy, 'none'>;
  signals: StructuralSignal[];
}

/**
 * Pontua um candidato contra o fingerprint. Interno de propósito: a superfície
 * pública é a mesma da heurística de atributos — a função de match e os tipos do
 * resultado —, e os pesos são exercitados através do DOM pelos testes.
 */
function scoreCandidate(
  fingerprint: Fingerprint,
  candidate: CandidateGeometry,
): ScoredCandidate {
  const { position } = fingerprint;
  const signals: StructuralSignal[] = [];

  const parentTagMatches = position.parentTag !== null && position.parentTag === candidate.parentTag;
  const parentPositionMatches =
    parentTagMatches &&
    position.parentSiblingIndex !== null &&
    position.parentSiblingIndex === candidate.parentSiblingIndex;

  let parentScore = 0;
  if (parentPositionMatches) {
    parentScore = WEIGHT.parent;
    signals.push('parent');
  } else if (parentTagMatches) {
    parentScore = WEIGHT.parent * PARENT_TAG_ONLY_FACTOR;
  }

  const siblingExact = position.siblingIndex === candidate.siblingIndex;
  const siblingScore =
    WEIGHT.sibling *
    proximity(Math.abs(position.siblingIndex - candidate.siblingIndex), SIBLING_DECAY_SPAN);
  if (siblingExact) {
    signals.push('sibling');
  }

  const depthExact = position.depth === candidate.depth;
  const depthScore =
    WEIGHT.depth * proximity(Math.abs(position.depth - candidate.depth), DEPTH_DECAY_SPAN);
  if (depthExact) {
    signals.push('depth');
  }

  const tagExact = fingerprint.tag === candidate.tag;
  const tagScore = tagExact ? WEIGHT.tag : 0;
  if (tagExact) {
    signals.push('tag');
  }

  // O rótulo segue a ordem de prioridade da seção 4: o critério 1 nomeia o
  // resultado sempre que seus dois sinais bateram, mesmo que a tag tenha mudado.
  let strategy: Exclude<StructuralMatchStrategy, 'none'>;
  if (parentPositionMatches && siblingExact) {
    strategy = 'parent+siblingPosition';
  } else if (depthExact && tagExact) {
    strategy = 'depth+tag';
  } else {
    strategy = 'partial';
  }

  return {
    geometry: candidate,
    score: parentScore + siblingScore + depthScore + tagScore,
    strategy,
    signals,
  };
}

/**
 * Procura no DOM atual de `page` o elemento descrito por `fingerprint`, por
 * posição na árvore.
 *
 * Nunca lança por ausência de candidato: "não encontrei" é resultado válido
 * (`matched: false`, `score: 0`), não erro.
 */
export async function matchByStructuralSimilarity(
  page: Page,
  fingerprint: Fingerprint,
): Promise<StructuralMatchResult> {
  // Sem pai capturado não há de onde partir — caso raro e documentado (§5 do
  // contexto), não o comportamento esperado.
  const applicable = fingerprint.position.parentTag !== null || fingerprint.position.siblingIndex >= 0;
  if (!applicable) {
    return noMatch(false);
  }

  const scored = (await readGeometry(page))
    .map((candidate) => scoreCandidate(fingerprint, candidate))
    .filter((candidate) => candidate.score >= MIN_SCORE);

  if (scored.length === 0) {
    return noMatch(true);
  }

  const best = Math.max(...scored.map((candidate) => candidate.score));
  const leaders = scored.filter((candidate) => candidate.score >= best - SCORE_EPSILON);
  // Empate resolvido pela ordem do documento: qualquer outro critério aqui seria
  // desempate inventado. A camada de decisão é quem julga o risco, via `ambiguous`.
  const [winner] = leaders;

  return {
    matched: true,
    score: winner.score,
    strategy: winner.strategy,
    locator: page.locator(winner.geometry.path),
    ambiguous: leaders.length > 1,
    candidateCount: leaders.length,
    consideredCount: scored.length,
    matchedSignals: winner.signals,
    applicable: true,
  };
}
