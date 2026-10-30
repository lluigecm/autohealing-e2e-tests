/**
 * Ablação do score de confiança, recalculada offline a partir do log da rodada
 * principal. São três configurações, todas com o limiar principal:
 *
 *   (i)   rawScore: a saída bruta da heurística estrutural;
 *   (ii)  rawScore × fator de ambiguidade;
 *   (iii) o score completo, que é o score registrado.
 *
 * O candidato é o mesmo nas três; só a decisão muda. As regras de classificação
 * e de agregação são as da análise principal, recebidas por parâmetro, para que
 * este módulo não importe `resultsAnalysis.mts`, que o chama. Nada aqui lê a
 * rodada nem toca no site.
 */
import type { CosmeticClass, CosmeticClassAt, DefectClass, FalsePositiveOutcome } from './resultsAnalysis.mts';

export type AblationConfig = 'i' | 'ii' | 'iii';

export const ABLATION_CONFIGS: ReadonlyArray<{ id: AblationConfig; label: string }> = [
  { id: 'i', label: '(i) rawScore: saída bruta da heurística estrutural' },
  { id: 'ii', label: '(ii) rawScore × fator de ambiguidade' },
  { id: 'iii', label: '(iii) score completo (registrado)' },
];

/** Tolerância absoluta das comparações numéricas entre score, rawScore e fatores. */
export const SCORE_TOLERANCE = 1e-9;

/** O que a ablação lê de cada entrada de log. */
export interface AblationLogEntry {
  decision: 'replace' | 'fail';
  score: number | null;
  rawScore: number | null;
  factors: { disagreement: number; ambiguity: number; text: number } | null;
  candidateIsOracle: boolean | null;
  heuristics: Array<{ heuristic: string; applicable: boolean; score: number }> | null;
  run: { entryId: string; testId: string; repetition: number } | null;
}

/** Score da entrada de log na configuração; sem score bruto, ou sem fatores em (ii), não há score. */
export function configScore(entry: AblationLogEntry, config: AblationConfig): number | null {
  if (config === 'iii') {
    return entry.score;
  }
  if (entry.rawScore === null) {
    return null;
  }
  if (config === 'i') {
    return entry.rawScore;
  }
  return entry.factors === null ? null : entry.rawScore * entry.factors.ambiguity;
}

// ---------------------------------------------------------------------------
// Verificações sobre o log

export interface LogCheck {
  name: string;
  checked: number;
  /** Uma linha por evento que não passou, com o motivo. */
  failures: string[];
}

const where = (entry: AblationLogEntry) =>
  entry.run ? `${entry.run.entryId} | ${entry.run.testId} | repetição ${entry.run.repetition}` : 'sem run';

const close = (a: number, b: number) => Math.abs(a - b) <= SCORE_TOLERANCE;

/**
 * As verificações 2 a 5 do registro da ablação, sobre todos os eventos do log.
 * Um campo ausente conta como exceção: nenhuma delas presume o valor que falta.
 */
export function checkLog(log: AblationLogEntry[]): LogCheck[] {
  const check = (name: string, problem: (entry: AblationLogEntry) => string | null): LogCheck => ({
    name,
    checked: log.length,
    failures: log.flatMap((entry) => {
      const reason = problem(entry);
      return reason === null ? [] : [`${where(entry)}: ${reason}`];
    }),
  });
  const structural = (entry: AblationLogEntry) => entry.heuristics?.find((h) => h.heuristic === 'structural-similarity');
  return [
    check('score = rawScore × disagreement × ambiguity × text', (entry) => {
      if (entry.score === null || entry.rawScore === null || entry.factors === null) {
        return `score ${entry.score}, rawScore ${entry.rawScore}, fatores ${JSON.stringify(entry.factors)}`;
      }
      const { disagreement, ambiguity, text } = entry.factors;
      const product = entry.rawScore * disagreement * ambiguity * text;
      return close(entry.score, product) ? null : `score ${entry.score}, produto ${product}`;
    }),
    check('factors.disagreement = 1', (entry) =>
      entry.factors?.disagreement === 1 ? null : `disagreement ${entry.factors === null ? 'ausente' : entry.factors.disagreement}`,
    ),
    check('heurística de atributos estáveis inaplicável', (entry) => {
      const stable = entry.heuristics?.find((h) => h.heuristic === 'stable-attributes');
      if (!stable) {
        return 'heurística de atributos estáveis ausente do log';
      }
      return stable.applicable ? 'atributos estáveis aplicável' : null;
    }),
    check('rawScore = score da heurística estrutural', (entry) => {
      const s = structural(entry);
      if (!s || entry.rawScore === null) {
        return `estrutural ${s ? 'presente' : 'ausente'}, rawScore ${entry.rawScore}`;
      }
      return s.applicable && close(entry.rawScore, s.score) ? null : `rawScore ${entry.rawScore}, estrutural ${s.score} (aplicável: ${s.applicable})`;
    }),
  ];
}

// ---------------------------------------------------------------------------
// Ablação por entrada

/** Regras da análise principal, recebidas de `resultsAnalysis.mts`. */
export interface AblationRules {
  decisionAt(score: number | null, threshold: number): 'replace' | 'fail';
  classifyCosmetic(log: Array<Pick<AblationLogEntry, 'decision' | 'candidateIsOracle'>>, passed: boolean): CosmeticClass;
  classifyCosmeticAt(log: Array<Pick<AblationLogEntry, 'decision' | 'candidateIsOracle' | 'score'>>, passed: boolean, threshold: number): CosmeticClassAt;
  aggregateRecovery(classes: CosmeticClass[]): 'recuperada' | 'não recuperada';
  aggregateRecoveryAt(classes: CosmeticClassAt[]): 'recuperada' | 'não recuperada' | 'indeterminada';
  classifyDefect(log: Array<Pick<AblationLogEntry, 'decision' | 'candidateIsOracle'>>): DefectClass;
  aggregateFalsePositive(classes: DefectClass[]): FalsePositiveOutcome;
}

export interface AblationExecution {
  passed: boolean;
  log: AblationLogEntry[];
}

/** Uma entrada de um dos denominadores, com as execuções que entram na agregação. */
export interface AblationInput {
  id: string;
  /** Alvo da matriz (`T1-crime_51`, `T8`...); o alvo distinto é o prefixo antes do hífen. */
  target: string;
  set: 'recuperação' | 'falso positivo';
  executions: AblationExecution[];
}

export interface EntryAblation {
  id: string;
  target: string;
  set: AblationInput['set'];
  config: AblationConfig;
  /** Scores distintos da configuração, em ordem crescente (`null` primeiro). */
  scores: Array<number | null>;
  decisions: Array<'replace' | 'fail'>;
  classes: Array<CosmeticClassAt | DefectClass>;
  outcome: 'recuperada' | 'não recuperada' | 'indeterminada' | FalsePositiveOutcome;
  /** Nenhuma execução com entrada de log: não depende da configuração. */
  notTriggered: boolean;
}

export function ablateEntry(input: AblationInput, config: AblationConfig, threshold: number, rules: AblationRules): EntryAblation {
  const log = input.executions.flatMap((e) => e.log);
  const withScore = (entries: AblationLogEntry[]) =>
    entries.map((entry) => ({ decision: entry.decision, candidateIsOracle: entry.candidateIsOracle, score: configScore(entry, config) }));
  const base = {
    id: input.id,
    target: input.target,
    set: input.set,
    config,
    scores: [...new Set(log.map((entry) => configScore(entry, config)))].sort((a, b) => (a ?? -1) - (b ?? -1)),
    decisions: log.map((entry) => rules.decisionAt(configScore(entry, config), threshold)),
    notTriggered: input.executions.every((e) => e.log.length === 0),
  };
  if (input.set === 'recuperação') {
    // Mesmo código da sensibilidade do limiar: fail que vira replace no oráculo fica indeterminado.
    const classes = input.executions.map((e) => rules.classifyCosmeticAt(withScore(e.log), e.passed, threshold));
    return { ...base, classes, outcome: rules.aggregateRecoveryAt(classes) };
  }
  const classes = input.executions.map((e) =>
    rules.classifyDefect(withScore(e.log).map((entry) => ({ decision: rules.decisionAt(entry.score, threshold), candidateIsOracle: entry.candidateIsOracle }))),
  );
  return { ...base, classes, outcome: rules.aggregateFalsePositive(classes) };
}

/**
 * Verificação 1: a configuração (iii) tem de dar, execução por execução e
 * entrada por entrada, as classes e os desfechos da análise principal, que usa
 * as decisões registradas.
 */
export function reproductionProblems(inputs: AblationInput[], threshold: number, rules: AblationRules): string[] {
  const problems: string[] = [];
  for (const input of inputs) {
    const ablated = ablateEntry(input, 'iii', threshold, rules);
    const observed =
      input.set === 'recuperação'
        ? input.executions.map((e) => rules.classifyCosmetic(e.log, e.passed))
        : input.executions.map((e) => rules.classifyDefect(e.log));
    const outcome =
      input.set === 'recuperação'
        ? rules.aggregateRecovery(observed as CosmeticClass[])
        : rules.aggregateFalsePositive(observed as DefectClass[]);
    observed.forEach((cls, i) => {
      if (ablated.classes[i] !== cls) {
        problems.push(`${input.id}, execução ${i + 1}: (iii) dá "${ablated.classes[i]}", a análise principal dá "${cls}"`);
      }
    });
    if (ablated.outcome !== outcome) {
      problems.push(`${input.id}: (iii) dá "${ablated.outcome}", a análise principal dá "${outcome}"`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Agregado por configuração

export interface ConfigSummary {
  config: AblationConfig;
  recovery: { total: number; recovered: number; indeterminate: number; wrongCure: number; notTriggered: string[] };
  falsePositive: { total: number; count: number; ids: string[]; notTriggered: string[] };
  /** Alvo distinto, como na regra de relato: T1 conta uma vez. */
  byTarget: { total: number; fp: number; idle: number; t1: { total: number; fp: number } };
}

export function summarizeConfig(config: AblationConfig, results: EntryAblation[]): ConfigSummary {
  const recovery = results.filter((r) => r.set === 'recuperação' && r.config === config);
  const fp = results.filter((r) => r.set === 'falso positivo' && r.config === config);
  const isFp = (r: EntryAblation) => r.outcome === 'falso positivo';
  const targets = new Map<string, EntryAblation[]>();
  for (const r of fp) {
    const target = r.target.split('-')[0];
    targets.set(target, [...(targets.get(target) ?? []), r]);
  }
  const groups = [...targets.values()];
  const t1 = targets.get('T1') ?? [];
  return {
    config,
    recovery: {
      total: recovery.length,
      recovered: recovery.filter((r) => r.outcome === 'recuperada').length,
      indeterminate: recovery.filter((r) => r.outcome === 'indeterminada').length,
      wrongCure: recovery.filter((r) => r.classes.includes('cura incorreta')).length,
      notTriggered: recovery.filter((r) => r.notTriggered).map((r) => r.id),
    },
    falsePositive: {
      total: fp.length,
      count: fp.filter(isFp).length,
      ids: fp.filter(isFp).map((r) => r.id),
      notTriggered: fp.filter((r) => r.outcome === 'não acionado').map((r) => r.id),
    },
    byTarget: {
      total: groups.length,
      fp: groups.filter((g) => g.some(isFp)).length,
      // Mesmo critério da tabela por alvo: sem falso positivo e com alguma entrada fora de "fail em todas".
      idle: groups.filter((g) => !g.some(isFp) && g.some((r) => r.outcome !== 'fail em todas')).length,
      t1: { total: t1.length, fp: t1.filter(isFp).length },
    },
  };
}
