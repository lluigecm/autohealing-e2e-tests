import { Locator } from '@playwright/test';
import { Fingerprint } from '../fingerprint';
import {
  ConfidenceFlag,
  ConfidenceResult,
  HeuristicContribution,
  NoConfidenceReason,
} from './confidenceScore';

/**
 * Camada de decisão (Camada 4): converte um score de confiança em uma de duas
 * ações — substituir o seletor automaticamente ou deixar o teste falhar.
 *
 * O princípio é o do desenho original: abaixo do limiar, falhar normalmente. Um
 * mecanismo que tenta recuperar a qualquer custo mascara defeito real, e um
 * falso positivo silencioso é pior que uma falha visível.
 *
 * Esta camada ainda **não** é acionada por uma falha real de locator: a detecção
 * (Camada 2) não está implementada. Aqui ela é alimentada diretamente com um
 * `ConfidenceResult` — da combinação real ou construído em teste.
 */

/**
 * Limiar de substituição automática.
 *
 * **Valor provisório, candidato a ajuste na etapa de experimentos.** 0.7 fica na
 * margem entre o pior caso de recuperação legítima e o melhor caso de falso
 * positivo conhecido: no alvo atual, um match geométrico perfeito sob
 * reordenação chega descontado a 0.50 pela corroboração de texto, e
 * ambiguidade não resolvida também a 0.50. Os experimentos podem mostrar que
 * a margem é larga ou estreita demais.
 */
export const CONFIDENCE_THRESHOLD = 0.7;

export type Decision =
  /** Confiança suficiente: o seletor é substituído pelo candidato. */
  | 'replace'
  /** Confiança insuficiente ou inexistente: o teste falha sem recuperação. */
  | 'fail';

/**
 * Entrada de log estruturado, uma por decisão. Existe para revisão humana da
 * substituição e para o harness de experimentos poder calcular taxas — por isso
 * registra também as decisões de falha, não só as substituições: sem o
 * denominador, nenhuma taxa de recuperação é calculável.
 */
export interface HealingLogEntry {
  decision: Decision;
  /** Página onde a recuperação foi tentada. */
  url: string;
  /** Descrição do seletor original, como consta no fingerprint. */
  originalSelector: string;
  /** Descrição do candidato escolhido, ou `null` quando não houve candidato. */
  candidate: string | null;
  /** `null` quando nenhuma heurística era aplicável (restrição 4 de `combineConfidence`). */
  score: number | null;
  /** Registrado junto porque é ajustável: um log antigo tem de ser relido com o limiar da época. */
  threshold: number;
  contributingHeuristics: HeuristicContribution[];
  flags: ConfidenceFlag[];
  reason: NoConfidenceReason | null;
  /** Momento da **decisão**, não da captura do fingerprint. */
  decidedAt: string;
}

export interface HealingDecision {
  decision: Decision;
  /** Candidato a usar quando `decision` é `replace`; `null` quando é `fail`. */
  locator: Locator | null;
  score: number | null;
  threshold: number;
  entry: HealingLogEntry;
}

export interface DecideOptions {
  /** Sobrescreve o limiar — é o que torna `CONFIDENCE_THRESHOLD` ajustável sem editar código. */
  threshold?: number;
  /** Sink do log. O default acumula em memória (`healingLog()`). */
  record?: (entry: HealingLogEntry) => void;
  /** Injetável para tornar o timestamp determinístico em teste. */
  now?: () => Date;
}

const entries: HealingLogEntry[] = [];

/** Log acumulado nesta execução, em ordem de decisão. */
export function healingLog(): readonly HealingLogEntry[] {
  return entries;
}

export function clearHealingLog(): void {
  entries.length = 0;
}

/** Uma linha por decisão, legível por humano sem deixar de ser rastreável. */
export function formatHealingLogEntry(entry: HealingLogEntry): string {
  const score = entry.score === null ? 'sem confiança' : entry.score.toFixed(3);
  const heuristics = entry.contributingHeuristics
    .map((contribution) => `${contribution.heuristic}=${contribution.score.toFixed(3)}`)
    .join(' ');

  return [
    `[${entry.decidedAt}]`,
    entry.decision === 'replace' ? 'SUBSTITUIU' : 'FALHOU',
    `${entry.url} "${entry.originalSelector}"`,
    `score=${score} (limiar ${entry.threshold})`,
    heuristics.length > 0 ? `heurísticas: ${heuristics}` : 'heurísticas: nenhuma aplicável',
    entry.candidate === null ? '' : `candidato: ${entry.candidate}`,
    entry.reason === null ? '' : `motivo: ${entry.reason}`,
    entry.flags.length === 0 ? '' : `flags: ${entry.flags.join(', ')}`,
  ]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/**
 * Decide entre substituir o seletor e falhar, registrando a decisão.
 *
 * `score: null` ("sem confiança", restrição 4) e score abaixo do limiar levam ao
 * mesmo desfecho — falhar — mas são registrados à parte: um diz que não havia o
 * que medir, o outro que se mediu e não bastou. Somar os dois nos experimentos
 * inflaria a taxa de falha de recuperação com casos que a heurística nunca teve
 * chance de tratar.
 */
export function decide(
  fingerprint: Fingerprint,
  confidence: ConfidenceResult,
  options: DecideOptions = {},
): HealingDecision {
  const threshold = options.threshold ?? CONFIDENCE_THRESHOLD;
  const record = options.record ?? ((entry: HealingLogEntry) => entries.push(entry));
  const now = options.now ?? (() => new Date());

  const confident =
    confidence.score !== null && confidence.score >= threshold && confidence.locator !== null;
  const decision: Decision = confident ? 'replace' : 'fail';

  const entry: HealingLogEntry = {
    decision,
    url: fingerprint.url,
    originalSelector: fingerprint.selector,
    candidate: confidence.locator === null ? null : String(confidence.locator),
    score: confidence.score,
    threshold,
    contributingHeuristics: confidence.contributingHeuristics,
    flags: confidence.flags,
    reason: confidence.reason,
    decidedAt: now().toISOString(),
  };
  record(entry);

  return {
    decision,
    locator: confident ? confidence.locator : null,
    score: confidence.score,
    threshold,
    entry,
  };
}
