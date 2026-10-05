import { Locator } from '@playwright/test';
import { Fingerprint } from '../fingerprint';
import { AttributeMatchResult } from '../heuristics/attributeHeuristic';
import { StructuralMatchResult } from '../heuristics/structuralHeuristic';

/**
 * Combinação das duas heurísticas num score de confiança único (fecha a Camada 3).
 *
 * Os scores que as heurísticas devolvem são **locais**: cada um mede a qualidade
 * do casamento sob o seu próprio critério, e nenhum dos dois é suficiente para
 * decidir se o seletor pode ser substituído automaticamente. Esta função produz
 * o número que a camada de decisão (`decide.ts`) usa, aplicando as quatro
 * restrições a seguir:
 *
 * 1. `applicable: false` é excluída do cálculo, nunca contada como score 0.
 * 2. Ambiguidade não resolvida desconta o score combinado.
 * 3. O `text` do fingerprint corrobora o match **depois** de encontrá-lo — é
 *    modulador de confiança, nunca critério de busca nem portão binário.
 * 4. Nenhuma heurística aplicável é um caso explícito (`score: null`), não um
 *    número default que se confundiria com medição real.
 */

export type HeuristicName = 'stable-attributes' | 'structural-similarity';

export type ConfidenceFlag =
  /** Ambiguidade que nenhuma outra heurística resolveu — descontou o score. */
  | 'unresolved-ambiguity'
  /** Ambiguidade de uma heurística confirmada pela outra, sem desconto. */
  | 'ambiguity-resolved-by-agreement'
  /** As duas aplicáveis apontaram o mesmo elemento. */
  | 'heuristics-agree'
  /** As duas aplicáveis apontaram elementos diferentes — descontou o score. */
  | 'heuristics-disagree'
  /** Uma heurística aplicável rodou e não achou nada. */
  | 'searched-without-match'
  /** O texto do candidato divergiu do fingerprint — descontou o score. */
  | 'text-corroboration-divergent'
  /** Fingerprint sem texto: não havia o que corroborar. */
  | 'text-corroboration-unavailable';

export type NoConfidenceReason =
  /** Nenhuma das duas heurísticas tinha o que consultar no fingerprint. */
  | 'no-applicable-heuristic'
  /** Heurística aplicável rodou, mas nenhuma encontrou candidato. */
  | 'no-candidate-found';

/** Score individual de cada heurística que participou, para o log de auditoria. */
export interface HeuristicContribution {
  heuristic: HeuristicName;
  /** Score local da heurística, antes de qualquer desconto desta função. */
  score: number;
  matched: boolean;
  ambiguous: boolean;
  candidateCount: number;
}

export interface ConfidenceResult {
  /**
   * Confiança combinada em [0, 1], ou `null` para "sem confiança" (restrição 4).
   * `null` não é zero: zero seria a afirmação de que se mediu e não se achou
   * nada, e o compilador obriga todo chamador a tratar os dois casos à parte.
   */
  score: number | null;
  /** Candidato escolhido. `null` sempre que `score` é `null`. */
  locator: Locator | null;
  /** Só as heurísticas aplicáveis: a ausência de uma delas aqui é informação. */
  contributingHeuristics: HeuristicContribution[];
  /** Casos especiais que participaram do cálculo, na ordem em que foram aplicados. */
  flags: ConfidenceFlag[];
  /** Preenchido apenas quando `score` é `null`. */
  reason: NoConfidenceReason | null;
  /** Similaridade de texto medida, ou `null` quando não havia o que corroborar. */
  textSimilarity: number | null;
}

/**
 * Ambiguidade não resolvida: mesmo valor que a heurística de atributos já usa
 * para o caso análogo (`UNRESOLVED_AMBIGUITY_PENALTY`). Reaproveitar é
 * deliberado — um número a justificar no texto em vez de dois.
 */
export const AMBIGUITY_FACTOR = 0.5;

/**
 * Divergência entre as duas heurísticas. Diferente da ausência de match, apontar
 * elementos distintos é contra-evidência direta: uma das duas está errada e o
 * score não tem como saber qual.
 */
export const DISAGREEMENT_FACTOR = 0.5;

/** Piso do fator de corroboração por texto: desconto máximo, nunca zerar. */
export const TEXT_FLOOR_FACTOR = 0.5;
/** Abaixo desta similaridade o texto não corrobora nada — contradiz. */
export const TEXT_CONTRADICTION_SIMILARITY = 0.5;
/** A partir desta similaridade o texto corrobora plenamente (tolera edição de copy). */
export const TEXT_CORROBORATION_SIMILARITY = 0.9;

function noConfidence(
  reason: NoConfidenceReason,
  contributingHeuristics: HeuristicContribution[],
  flags: ConfidenceFlag[],
): ConfidenceResult {
  return {
    score: null,
    locator: null,
    contributingHeuristics,
    flags,
    reason,
    textSimilarity: null,
  };
}

interface Participant extends HeuristicContribution {
  locator: Locator | null;
}

function participants(
  attribute: AttributeMatchResult,
  structural: StructuralMatchResult,
): Participant[] {
  // Ordem não é cosmética: empate de score é resolvido pelo primeiro (o `sort`
  // é estável), e a hierarquia de evidência do trabalho põe atributo estável
  // acima de geometria.
  const applicable: Participant[] = [];

  if (attribute.applicable) {
    applicable.push({
      heuristic: 'stable-attributes',
      score: attribute.score,
      matched: attribute.matched,
      ambiguous: attribute.ambiguous,
      candidateCount: attribute.candidateCount,
      locator: attribute.locator,
    });
  }

  if (structural.applicable) {
    applicable.push({
      heuristic: 'structural-similarity',
      score: structural.score,
      matched: structural.matched,
      ambiguous: structural.ambiguous,
      candidateCount: structural.candidateCount,
      locator: structural.locator,
    });
  }

  return applicable;
}

function contribution(participant: Participant): HeuristicContribution {
  const { locator: _locator, ...rest } = participant;
  return rest;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokens(text: string): Set<string> {
  const normalized = normalize(text);
  return new Set(normalized.length === 0 ? [] : normalized.split(' '));
}

/**
 * Sobreposição de tokens (Jaccard) — o mesmo instrumento que a heurística de
 * atributos usa para comparar `class` no desempate, por consistência de método.
 */
export function textSimilarity(expected: string, actual: string): number {
  const a = tokens(expected);
  const b = tokens(actual);
  if (a.size === 0 && b.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Fator multiplicativo da corroboração por texto, em [`TEXT_FLOOR_FACTOR`, 1].
 *
 * A rampa tem dois patamares porque o texto do alvo real carrega boilerplate: os
 * cards de livros diferentes compartilham "in stock" e "add to basket", então
 * dois elementos completamente trocados ainda somam similaridade de token não
 * desprezível. Travar o fator no piso abaixo de `TEXT_CONTRADICTION_SIMILARITY`
 * garante margem contra o limiar de decisão; dar fator cheio acima de
 * `TEXT_CORROBORATION_SIMILARITY` evita punir edição legítima de conteúdo.
 */
export function textCorroborationFactor(similarity: number): number {
  if (similarity >= TEXT_CORROBORATION_SIMILARITY) {
    return 1;
  }
  if (similarity <= TEXT_CONTRADICTION_SIMILARITY) {
    return TEXT_FLOOR_FACTOR;
  }

  const span = TEXT_CORROBORATION_SIMILARITY - TEXT_CONTRADICTION_SIMILARITY;
  const progress = (similarity - TEXT_CONTRADICTION_SIMILARITY) / span;
  return TEXT_FLOOR_FACTOR + (1 - TEXT_FLOOR_FACTOR) * progress;
}

async function sameElement(a: Locator, b: Locator): Promise<boolean> {
  const [handleA, handleB] = [await a.elementHandle(), await b.elementHandle()];
  if (handleA === null || handleB === null) {
    return false;
  }
  return handleA.evaluate((element, other) => element === other, handleB);
}

/**
 * Combina os resultados das duas heurísticas num score de confiança único.
 *
 * Nunca lança: ausência de candidato e ausência de heurística aplicável são
 * desfechos previstos, devolvidos como `score: null` com `reason` preenchido.
 */
export async function combineConfidence(
  attribute: AttributeMatchResult,
  structural: StructuralMatchResult,
  fingerprint: Fingerprint,
): Promise<ConfidenceResult> {
  const applicable = participants(attribute, structural);
  const contributingHeuristics = applicable.map(contribution);
  const flags: ConfidenceFlag[] = [];

  // Passo 1 — restrição 1 e restrição 4.
  if (applicable.length === 0) {
    return noConfidence('no-applicable-heuristic', contributingHeuristics, flags);
  }

  const matched = applicable.filter(
    (participant): participant is Participant & { locator: Locator } =>
      participant.matched && participant.locator !== null,
  );
  if (matched.length === 0) {
    return noConfidence('no-candidate-found', contributingHeuristics, flags);
  }
  if (matched.length < applicable.length) {
    // Não é contra-evidência: as heurísticas olham sinais disjuntos, e não achar
    // por atributo nada afirma sobre geometria. Fica registrado, não descontado.
    flags.push('searched-without-match');
  }

  // Passo 2 — a evidência mais forte governa; a mais fraca não dilui.
  const [winner, runnerUp] = [...matched].sort((a, b) => b.score - a.score);
  let score = winner.score;
  let agreement = false;

  if (runnerUp !== undefined) {
    agreement = await sameElement(winner.locator, runnerUp.locator);
    if (agreement) {
      flags.push('heuristics-agree');
    } else {
      flags.push('heuristics-disagree');
      score *= DISAGREEMENT_FACTOR;
    }
  }

  // Passo 3 — restrição 2, sobre o score já combinado. Uma heurística
  // ambígua pode ser desambiguada pela outra, mas só se as duas concordarem no
  // elemento e ao menos uma delas não estiver ambígua.
  const anyAmbiguous = matched.some((participant) => participant.ambiguous);
  const resolvedByAgreement =
    agreement && matched.some((participant) => !participant.ambiguous);
  if (anyAmbiguous) {
    if (resolvedByAgreement) {
      flags.push('ambiguity-resolved-by-agreement');
    } else {
      flags.push('unresolved-ambiguity');
      score *= AMBIGUITY_FACTOR;
    }
  }

  // Passo 4 — restrição 3: o único sinal do mecanismo que não depende
  // de posição, e por isso o único capaz de rebaixar um match geometricamente
  // perfeito mas incorreto.
  let similarity: number | null = null;
  if (normalize(fingerprint.text).length === 0) {
    flags.push('text-corroboration-unavailable');
  } else {
    similarity = textSimilarity(fingerprint.text, await winner.locator.innerText());
    const factor = textCorroborationFactor(similarity);
    if (factor < 1) {
      flags.push('text-corroboration-divergent');
    }
    score *= factor;
  }

  return {
    score,
    locator: winner.locator,
    contributingHeuristics,
    flags,
    reason: null,
    textSimilarity: similarity,
  };
}
