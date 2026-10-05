import { Locator, Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { Fingerprint } from '../fingerprint';
import { matchByStableAttributes } from '../heuristics/attributeHeuristic';
import { matchByStructuralSimilarity } from '../heuristics/structuralHeuristic';
import { combineConfidence } from './confidenceScore';
import { HealingDecision, HealingLogEntry, RunContext, decide } from './decide';

/**
 * Uma tentativa de recuperação instrumentada para o harness de experimentos:
 * mede t_rec, consulta o oráculo e monta a entrada completa do log.
 *
 * A ordem é o que mantém as medidas limpas. A janela de t_rec cobre só
 * heurísticas, combinação e decisão. O oráculo é consultado depois dela e
 * antes da ação, porque a ação pode navegar e descartar o DOM mutado. O log é
 * escrito só no fim, depois da ação, e nunca é lido durante a execução.
 *
 * A detecção (Camada 2) não existe ainda: quem chama informa a espera da
 * detecção e decide qual ação executar com o candidato.
 */

export interface RecoveryOptions {
  threshold?: number;
  now?: () => Date;
  /**
   * Diz se o candidato é o elemento-oráculo da mutação. Injetado pelo harness
   * (`pointsToOracle`, de `mutation/applyMutation.ts`): a camada de healing não
   * conhece a ferramenta de mutação.
   */
  oracle?: (candidate: Locator) => Promise<boolean>;
}

export interface RecoveryAttempt {
  decision: HealingDecision;
  /** Candidato do `ConfidenceResult`, inclusive quando a decisão é `fail`. */
  candidate: Locator | null;
  recoveryMs: number;
  /** `null` quando não houve candidato ou oráculo. */
  candidateIsOracle: boolean | null;
}

export async function attemptRecovery(
  page: Page,
  fingerprint: Fingerprint,
  options: RecoveryOptions = {},
): Promise<RecoveryAttempt> {
  const start = performance.now();
  const confidence = await combineConfidence(
    await matchByStableAttributes(page, fingerprint),
    await matchByStructuralSimilarity(page, fingerprint),
    fingerprint,
  );
  // O sink em memória de `decide` fica de fora: a entrada só vai para o log
  // depois de completada com tempos e oráculo (`completeEntry`).
  const decision = decide(fingerprint, confidence, {
    threshold: options.threshold,
    now: options.now,
    record: () => {},
  });
  const recoveryMs = performance.now() - start;

  // Avaliado sobre o candidato mesmo quando a decisão é `fail`: é isso que diz,
  // na ablação, se uma configuração sem algum fator teria substituído pelo
  // elemento certo ou pelo errado.
  const candidateIsOracle =
    confidence.locator === null || options.oracle === undefined
      ? null
      : await options.oracle(confidence.locator);

  return { decision, candidate: confidence.locator, recoveryMs, candidateIsOracle };
}

export interface ActionTiming {
  /** `null` quando a decisão foi `fail` e não houve ação recuperada. */
  actionMs: number | null;
  /** Erro da ação recuperada, devolvido em vez de lançado para que a entrada seja gravada mesmo assim. */
  error: unknown;
}

/** Executa e cronometra a ação com o candidato, só quando a decisão foi `replace`. */
export async function timeRecoveredAction(
  attempt: RecoveryAttempt,
  action: (locator: Locator) => Promise<unknown>,
): Promise<ActionTiming> {
  const locator = attempt.decision.locator;
  if (locator === null) {
    return { actionMs: null, error: null };
  }

  const start = performance.now();
  try {
    await action(locator);
    return { actionMs: performance.now() - start, error: null };
  } catch (error) {
    return { actionMs: performance.now() - start, error };
  }
}

export function completeEntry(
  attempt: RecoveryAttempt,
  run: RunContext,
  measured: { detectionWaitMs: number; actionMs: number | null },
): HealingLogEntry {
  return {
    ...attempt.decision.entry,
    candidateIsOracle: attempt.candidateIsOracle,
    run,
    timings: {
      detectionWaitMs: measured.detectionWaitMs,
      recoveryMs: attempt.recoveryMs,
      actionMs: measured.actionMs,
    },
  };
}

export interface HealingLogSink {
  readonly filePath: string;
  write(entry: HealingLogEntry): void;
}

/**
 * Sink JSONL, uma entrada por linha. Só acrescenta, nunca lê o arquivo. Cada
 * linha sai numa única chamada de escrita, para que workers paralelos não
 * intercalem linhas pela metade. Mesmo assim, um arquivo por worker é o mais
 * seguro.
 */
export function jsonlSink(filePath: string): HealingLogSink {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return {
    filePath: resolved,
    write(entry) {
      appendFileSync(resolved, `${JSON.stringify(entry)}\n`, 'utf8');
    },
  };
}
