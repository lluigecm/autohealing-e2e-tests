import { test, expect } from '@playwright/test';
import { ablateEntry, checkLog, configScore, reproductionProblems, summarizeConfig } from '../../experiments/ablationAnalysis.mts';
import type { AblationInput, AblationLogEntry, AblationRules } from '../../experiments/ablationAnalysis.mts';
import {
  aggregateFalsePositive,
  aggregateRecovery,
  aggregateRecoveryAt,
  classifyCosmetic,
  classifyCosmeticAt,
  classifyDefect,
  decisionAt,
} from '../../experiments/resultsAnalysis.mts';

/**
 * Ablação do score sobre entradas de log fictícias, com as regras reais da
 * análise principal. Nada lê a rodada nem toca no site.
 */

const THRESHOLD = 0.7;
const rules: AblationRules = {
  decisionAt,
  classifyCosmetic,
  classifyCosmeticAt,
  aggregateRecovery,
  aggregateRecoveryAt,
  classifyDefect,
  aggregateFalsePositive,
};

/** Entrada de log coerente: score = bruto × fatores, decisão pelo limiar 0,7, estrutural com o score bruto. */
function entry(raw: number, { ambiguity = 1, text = 1, oracle = true as boolean | null } = {}): AblationLogEntry {
  const score = raw * ambiguity * text;
  return {
    decision: score >= THRESHOLD ? 'replace' : 'fail',
    score,
    rawScore: raw,
    factors: { disagreement: 1, ambiguity, text },
    candidateIsOracle: oracle,
    heuristics: [
      { heuristic: 'stable-attributes', applicable: false, score: 0 },
      { heuristic: 'structural-similarity', applicable: true, score: raw },
    ],
    run: { entryId: 'X', testId: 'tests/x.spec.ts › x', repetition: 1 },
  };
}

const recoveryInput = (id: string, executions: AblationInput['executions']): AblationInput => ({ id, target: 'T8', set: 'recuperação', executions });
const fpInput = (id: string, target: string, executions: AblationInput['executions']): AblationInput => ({ id, target, set: 'falso positivo', executions });

test.describe('score de cada configuração', () => {
  test('(i) bruto, (ii) bruto × ambiguidade, (iii) o registrado', () => {
    const e = entry(1, { ambiguity: 0.5, text: 0.8 });
    expect(configScore(e, 'i')).toBe(1);
    expect(configScore(e, 'ii')).toBe(0.5);
    expect(configScore(e, 'iii')).toBeCloseTo(0.4, 12);
  });

  test('sem score bruto não há score em (i) e (ii), e a decisão é falhar', () => {
    const e = { ...entry(1), rawScore: null, score: null, decision: 'fail' as const };
    expect(configScore(e, 'i')).toBeNull();
    expect(configScore(e, 'ii')).toBeNull();
    expect(decisionAt(configScore(e, 'i'), THRESHOLD)).toBe('fail');
  });
});

test.describe('verificações do log', () => {
  test('eventos coerentes passam nas quatro', () => {
    const checks = checkLog([entry(1), entry(1, { ambiguity: 0.5, text: 0.6 })]);
    expect(checks).toHaveLength(4);
    for (const c of checks) {
      expect(c.checked).toBe(2);
      expect(c.failures).toEqual([]);
    }
  });

  test('cada exceção é relatada na verificação correspondente, com o evento', () => {
    const product = { ...entry(1), score: 0.9 };
    const disagreement = { ...entry(1), factors: { disagreement: 0.5, ambiguity: 1, text: 1 }, score: 0.5, decision: 'fail' as const };
    const stable = { ...entry(1), heuristics: [{ heuristic: 'stable-attributes', applicable: true, score: 1 }, { heuristic: 'structural-similarity', applicable: true, score: 1 }] };
    const structural = { ...entry(1), heuristics: [{ heuristic: 'stable-attributes', applicable: false, score: 0 }, { heuristic: 'structural-similarity', applicable: true, score: 0.8 }] };
    const [p, d, s, r] = checkLog([product, disagreement, stable, structural]);
    expect(p.failures).toHaveLength(1);
    expect(p.failures[0]).toContain('tests/x.spec.ts › x');
    expect(d.failures).toHaveLength(1);
    expect(s.failures).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
  });

  test('campo ausente conta como exceção, sem presumir o valor', () => {
    const missing = { ...entry(1), factors: null, heuristics: null };
    const [p, d, s, r] = checkLog([missing]);
    expect([p, d, s].map((c) => c.failures.length)).toEqual([1, 1, 1]);
    expect(r.failures).toHaveLength(1);
  });
});

test.describe('ablação por entrada', () => {
  test('fail que vira replace no elemento certo fica indeterminado, nunca sucesso', () => {
    // Ambiguidade derruba 1,0 para 0,5: falha no registrado e em (ii), substitui em (i).
    const input = recoveryInput('M-amb', [{ passed: false, log: [entry(1, { ambiguity: 0.5 })] }]);
    expect(ablateEntry(input, 'iii', THRESHOLD, rules)).toMatchObject({ classes: ['fail'], outcome: 'não recuperada', decisions: ['fail'] });
    expect(ablateEntry(input, 'ii', THRESHOLD, rules)).toMatchObject({ classes: ['fail'], outcome: 'não recuperada' });
    expect(ablateEntry(input, 'i', THRESHOLD, rules)).toMatchObject({ classes: ['indeterminado'], outcome: 'indeterminada', decisions: ['replace'] });
  });

  test('fail que vira replace no elemento errado é cura incorreta, sem depender do teste', () => {
    const input = recoveryInput('M-txt', [{ passed: false, log: [entry(1, { text: 0.5, oracle: false })] }]);
    expect(ablateEntry(input, 'ii', THRESHOLD, rules)).toMatchObject({ classes: ['cura incorreta'], outcome: 'não recuperada' });
  });

  test('no M5, qualquer replace numa configuração é falso positivo', () => {
    const input = fpInput('M5-X', 'T3', [{ passed: false, log: [entry(1, { text: 0.5, oracle: null })] }]);
    expect(ablateEntry(input, 'iii', THRESHOLD, rules).outcome).toBe('fail em todas');
    expect(ablateEntry(input, 'ii', THRESHOLD, rules).outcome).toBe('falso positivo');
  });

  test('entrada sem nenhuma entrada de log é não acionada em todas as configurações', () => {
    const rec = recoveryInput('M-idle', [{ passed: false, log: [] }]);
    const fp = fpInput('M5-idle', 'T4', [{ passed: false, log: [] }]);
    for (const config of ['i', 'ii', 'iii'] as const) {
      expect(ablateEntry(rec, config, THRESHOLD, rules)).toMatchObject({ notTriggered: true, outcome: 'não recuperada', classes: ['não acionado'] });
      expect(ablateEntry(fp, config, THRESHOLD, rules)).toMatchObject({ notTriggered: true, outcome: 'não acionado' });
    }
  });
});

test.describe('a configuração (iii) reproduz o resultado principal', () => {
  const inputs: AblationInput[] = [
    recoveryInput('R-ok', [{ passed: true, log: [entry(1)] }, { passed: true, log: [entry(1)] }]),
    recoveryInput('R-borda', [{ passed: true, log: [entry(1, { text: 0.708 })] }]),
    recoveryInput('R-teste-falha', [{ passed: false, log: [entry(1)] }]),
    recoveryInput('R-fail', [{ passed: false, log: [entry(1, { text: 0.5 })] }]),
    recoveryInput('R-idle', [{ passed: false, log: [] }]),
    fpInput('F-fp', 'T10', [{ passed: false, log: [entry(0.925, { oracle: null })] }]),
    fpInput('F-fail-a', 'T1-a', [{ passed: false, log: [entry(1, { text: 0.5, oracle: null })] }]),
    fpInput('F-fail-b', 'T1-b', [{ passed: false, log: [entry(0.4, { oracle: null })] }]),
    fpInput('F-idle', 'T4', [{ passed: false, log: [] }]),
  ];

  test('classe de cada execução e desfecho de cada entrada iguais aos da análise principal', () => {
    expect(reproductionProblems(inputs, THRESHOLD, rules)).toEqual([]);
  });

  test('as frações agregadas são as do resultado principal', () => {
    const results = inputs.map((input) => ablateEntry(input, 'iii', THRESHOLD, rules));
    const recovery = inputs.filter((i) => i.set === 'recuperação');
    const fp = inputs.filter((i) => i.set === 'falso positivo');
    const mainRecovered = recovery.filter((i) => aggregateRecovery(i.executions.map((e) => classifyCosmetic(e.log, e.passed))) === 'recuperada').length;
    const mainFp = fp.filter((i) => aggregateFalsePositive(i.executions.map((e) => classifyDefect(e.log))) === 'falso positivo').length;
    const s = summarizeConfig('iii', results);
    expect(s.recovery).toEqual({ total: 5, recovered: mainRecovered, indeterminate: 0, wrongCure: 0, notTriggered: ['R-idle'] });
    expect(mainRecovered).toBe(2);
    expect(s.falsePositive).toEqual({ total: 4, count: mainFp, ids: ['F-fp'], notTriggered: ['F-idle'] });
    expect(s.byTarget).toEqual({ total: 3, fp: 1, idle: 1, t1: { total: 2, fp: 0 } });
  });

  test('uma decisão registrada que não bate com o score é acusada', () => {
    const broken = recoveryInput('R-incoerente', [{ passed: true, log: [{ ...entry(1, { text: 0.5 }), decision: 'replace' }] }]);
    expect(reproductionProblems([broken], THRESHOLD, rules)).toHaveLength(2);
  });

  test('nas outras configurações, o mesmo conjunto muda só pela decisão', () => {
    const results = inputs.map((input) => ablateEntry(input, 'i', THRESHOLD, rules));
    const s = summarizeConfig('i', results);
    // R-fail passa a replace no oráculo sem teste observado; F-fail-a passa a replace.
    expect(s.recovery).toMatchObject({ recovered: 2, indeterminate: 1 });
    expect(s.falsePositive.ids).toEqual(['F-fp', 'F-fail-a']);
    expect(s.byTarget.t1).toEqual({ total: 2, fp: 1 });
  });
});
