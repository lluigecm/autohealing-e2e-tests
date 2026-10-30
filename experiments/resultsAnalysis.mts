/**
 * Análise dos resultados oficiais: a rodada principal e a medição do custo da
 * captura.
 *
 *   node experiments/resultsAnalysis.mts           gera experiments/analysis/
 *   node experiments/resultsAnalysis.mts --check   regenera em memória e compara
 *                                                 byte a byte com os arquivos gerados
 *
 * Lê só `experiments/results/` (e a matriz e o mapa versionados no commit da
 * rodada). Nada é editado à mão: toda tabela, todo número e todo gráfico de
 * `experiments/analysis/` sai daqui, e a saída é determinística (sem horário,
 * ordem fixa, números com casas fixas). A primeira etapa confere os manifestos
 * SHA-256 das duas rodadas e para se algum arquivo divergir; a segunda confere
 * a coerência entre o log do mecanismo e os eventos dos testes e para se achar
 * um possível defeito na coleta, antes de qualquer tabela.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ABLATION_CONFIGS, ablateEntry, checkLog, reproductionProblems, summarizeConfig } from './ablationAnalysis.mts';
import type { AblationInput, AblationRules, EntryAblation } from './ablationAnalysis.mts';
import { analyze as analyzeCapture, quantile, summarize } from './overheadAnalysis.mts';
import type { Summary } from './overheadAnalysis.mts';
import { testEvents } from './runSupport.mts';
import { invocationKey, readJsonl } from './runState.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAIN_RUN = 'experiments/results/2026-10-12T16-32-03-131Z';
const CAPTURE_RUN = 'experiments/results/overhead-captura-2026-10-15T15-16-16-991Z';
const OUT_DIR = 'experiments/analysis';
/** Limiar da rodada principal (resultado principal). */
const MAIN_THRESHOLD = 0.7;
/** Grade da análise de sensibilidade: 0,00 a 1,00 de 0,05 em 0,05 (escolha registrada depois dos dados). */
const SENSITIVITY_GRID = Array.from({ length: 21 }, (_, i) => i / 20);

/** Onde está cada regra aplicada; aparece ao lado de cada número no resumo. */
const RULE = {
  manifest: 'ADR-027 (adendo: cópia sem edição) e ADR-031 (manifesto)',
  lastAttempt: 'ADR-028',
  parity: 'ADR-027',
  nondeterminism: 'ADR-026',
  denominators: 'ADR-020',
  applied: 'ADR-024',
  perTestDivergence: 'ADR-024',
  classes: 'ADR-025',
  report: 'ADR-020',
  inert: 'ADR-026',
  recoveryOverhead: 'ADR-027',
  interval: 'ADR-026',
  captureOverhead: 'ADR-031',
  sensitivity: 'ADR-027 (adendo)',
  threshold: 'ADR-016',
  textCorroboration: 'ADR-014',
  positionalFalsePositive: 'ADR-012',
  postData: 'ADR-032, decidido depois dos dados',
  ablation: 'ADR-033, especificação da monografia e script posteriores aos dados',
} as const;

// ---------------------------------------------------------------------------
// Tipos dos dados gravados

type Condition = 'healing-off' | 'healing-on';

interface PlanInvocation {
  entryId: string;
  group: string;
  locator: 'inerte' | 'quebra' | 'desvia';
  condition: Condition;
  repeatEach: number;
  tests: string[];
}

interface MatrixRow {
  id: string;
  code: string;
  target: string;
  class: 'cosmetic' | 'defect';
  locator: 'inerte' | 'quebra' | 'desvia';
  test: string;
  reproducedTest: string;
}

interface TestEvent {
  entryId: string;
  testId: string;
  repetition: number;
  condition: Condition;
  status: string;
  durationMs: number;
  mutation: Array<{ url: string; applied: boolean | null }>;
  invalid: boolean;
  error: string | null;
}

export interface LogEntry {
  decision: 'replace' | 'fail';
  url: string;
  originalSelector: string;
  score: number | null;
  threshold: number;
  flags: string[];
  reason: string | null;
  candidate: string | null;
  rawScore: number | null;
  factors: { disagreement: number; ambiguity: number; text: number } | null;
  heuristics: Array<{ heuristic: string; applicable: boolean; score: number }> | null;
  candidateIsOracle: boolean | null;
  run: { entryId: string; testId: string; repetition: number; condition: string } | null;
  timings: { detectionWaitMs: number; recoveryMs: number; actionMs: number | null };
}

interface Execution {
  entryId: string;
  condition: Condition;
  testId: string;
  repetition: number;
  passed: boolean;
  status: string;
  durationMs: number;
  /** A mutação foi aplicada em ao menos uma página visitada pelo teste. */
  applied: boolean;
  error: string | null;
  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Regras de classificação e agregação (exportadas para os unitários)

export type CosmeticClass = 'sucesso' | 'elemento certo, teste falha' | 'cura incorreta' | 'fail' | 'não acionado';
export const COSMETIC_CLASSES: readonly CosmeticClass[] = [
  'sucesso',
  'elemento certo, teste falha',
  'cura incorreta',
  'fail',
  'não acionado',
];

type Decided = Pick<LogEntry, 'decision' | 'candidateIsOracle'>;

/**
 * Classe de uma execução numa entrada cosmética, verificada nesta ordem: sem
 * entrada de log; alguma decisão `fail`; algum `replace` fora do oráculo;
 * todos os `replace` no oráculo, e então o desfecho do teste decide.
 */
export function classifyCosmetic(log: Decided[], passed: boolean): CosmeticClass {
  if (log.length === 0) {
    return 'não acionado';
  }
  if (log.some((entry) => entry.decision === 'fail')) {
    return 'fail';
  }
  if (log.some((entry) => entry.candidateIsOracle !== true)) {
    return 'cura incorreta';
  }
  return passed ? 'sucesso' : 'elemento certo, teste falha';
}

export type DefectClass = 'replace' | 'fail' | 'não acionado';

/** Numa entrada M5 o oráculo é `null`: qualquer `replace` é falso positivo, seja qual for o desfecho do teste. */
export function classifyDefect(log: Decided[]): DefectClass {
  if (log.some((entry) => entry.decision === 'replace')) {
    return 'replace';
  }
  return log.length > 0 ? 'fail' : 'não acionado';
}

/** Sucesso tem de ser unânime; basta uma execução em outra classe para a entrada não contar. */
export function aggregateRecovery(classes: CosmeticClass[]): 'recuperada' | 'não recuperada' {
  return classes.length > 0 && classes.every((c) => c === 'sucesso') ? 'recuperada' : 'não recuperada';
}

export type FalsePositiveOutcome = 'falso positivo' | 'fail em todas' | 'não acionado' | 'fail e não acionado';

/**
 * A favor do mecanismo: `fail` em todas as execuções. Contra: basta um
 * `replace`. Sem nenhum `replace` e sem nenhuma entrada de log, a entrada é
 * "não acionado": não é falso positivo nem conta a favor (decidido depois dos
 * dados). A mistura de `fail` com execuções não acionadas não foi decidida e
 * fica com rótulo próprio.
 */
export function aggregateFalsePositive(classes: DefectClass[]): FalsePositiveOutcome {
  if (classes.some((c) => c === 'replace')) {
    return 'falso positivo';
  }
  if (classes.length > 0 && classes.every((c) => c === 'fail')) {
    return 'fail em todas';
  }
  return classes.every((c) => c === 'não acionado') ? 'não acionado' : 'fail e não acionado';
}

/** Decisão que o mesmo score teria com outro limiar (inclusivo); sem score, sempre `fail`. */
export function decisionAt(score: number | null, threshold: number): 'replace' | 'fail' {
  return score !== null && score >= threshold ? 'replace' : 'fail';
}

export type CosmeticClassAt = CosmeticClass | 'indeterminado';

/**
 * Classe aproximada com outro limiar. Se alguma decisão passa de `fail` para
 * `replace` no oráculo e nenhuma outra regra decide antes, o desfecho do teste
 * não foi observado (a ação recuperada não rodou), e a execução fica
 * indeterminada. De `replace` para `fail`, o erro original é relançado e a
 * execução vira `fail`.
 */
export function classifyCosmeticAt(log: Array<Decided & { score: number | null }>, passed: boolean, threshold: number): CosmeticClassAt {
  const at = log.map((entry) => ({ decision: decisionAt(entry.score, threshold), candidateIsOracle: entry.candidateIsOracle }));
  const unchanged = log.every((entry, i) => entry.decision === at[i].decision);
  const cls = classifyCosmetic(at, passed);
  if (unchanged || cls === 'não acionado' || cls === 'fail' || cls === 'cura incorreta') {
    return cls;
  }
  return 'indeterminado';
}

export function aggregateRecoveryAt(classes: CosmeticClassAt[]): 'recuperada' | 'não recuperada' | 'indeterminada' {
  if (classes.length === 0 || classes.some((c) => c !== 'sucesso' && c !== 'indeterminado')) {
    return 'não recuperada';
  }
  return classes.some((c) => c === 'indeterminado') ? 'indeterminada' : 'recuperada';
}

const SPEC_TITLES: Record<string, (name: string) => string> = {
  'category-navigation': (name) =>
    `tests/category-navigation.spec.ts › navega da Home para a categoria "${name}" e exibe a listagem correspondente`,
  'product-details #1': (name) =>
    `tests/product-details.spec.ts › abre o primeiro produto de "${name}" a partir da listagem e exibe título, preço e disponibilidade`,
  'product-details #2': (name) =>
    `tests/product-details.spec.ts › produto de "${name}" exibe o preço no formato esperado e a informação de estoque`,
  'product-details #3': (name) =>
    `tests/product-details.spec.ts › produto de "${name}" exibe uma classificação por estrelas válida (1 a 5)`,
};

/** Id do teste do harness correspondente ao `reproducedTest` da matriz. */
export function reproducedTestId(name: string): string {
  if (name === 'home') {
    return 'tests/home.spec.ts › exibe a lista de categorias e o grid de produtos';
  }
  if (name === 'pagination') {
    return 'tests/pagination.spec.ts › avança para a próxima página e exibe produtos diferentes';
  }
  const match = name.match(/^(.+?) › (.+)$/);
  const title = match ? SPEC_TITLES[match[1]] : undefined;
  if (!match || !title) {
    throw new Error(`teste reproduzido sem correspondência: ${name}`);
  }
  return title(match[2]);
}

// ---------------------------------------------------------------------------
// Formatação: células, tabelas em CSV e Markdown

type Cell = string | { num: number; d: number } | { list: Array<number | null>; d: number } | null;

const n = (num: number, d = 0): Cell => ({ num, d });

function fixed(num: number, d: number): string {
  const text = num.toFixed(d);
  // Evita "-0", "-0.0": o sinal de um zero arredondado não é informação.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

function cellText(cell: Exclude<Cell, null | string>): string {
  if ('list' in cell) {
    return cell.list.map((v) => (v === null ? 'sem score' : fixed(v, cell.d))).join('; ');
  }
  return fixed(cell.num, cell.d);
}

function csvCell(cell: Cell): string {
  const text = cell === null ? '' : typeof cell === 'string' ? cell : cellText(cell);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function mdCell(cell: Cell): string {
  const text = cell === null ? '—' : typeof cell === 'string' ? cell : cellText(cell).replace(/\./g, ',');
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Número em pt-BR para o texto do resumo. */
const br = (num: number, d = 0) => fixed(num, d).replace('.', ',');

interface Table {
  name: string;
  title: string;
  /** Regra aplicada, citada no topo do Markdown. */
  rule: string;
  headers: string[];
  rows: Cell[][];
  notes?: string[];
  /** Texto quando não há linhas. */
  empty?: string;
}

function tableCsv(table: Table): string {
  return [table.headers, ...table.rows].map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n') + '\n';
}

function tableMd(table: Table): string {
  const lines = [`# ${table.title}`, '', `Regra: ${table.rule}. Gerado por \`experiments/resultsAnalysis.mts\`; não editar à mão.`, ''];
  if (table.rows.length === 0) {
    lines.push(table.empty ?? 'Nenhuma linha.');
  } else {
    lines.push(`| ${table.headers.map((h) => mdCell(h)).join(' | ')} |`);
    lines.push(`| ${table.headers.map(() => '---').join(' | ')} |`);
    for (const row of table.rows) {
      lines.push(`| ${row.map((cell) => mdCell(cell)).join(' | ')} |`);
    }
  }
  for (const note of table.notes ?? []) {
    lines.push('', note);
  }
  return lines.join('\n') + '\n';
}

const frac = (k: number, total: number) => `${k}/${total}`;

/** Contagem por valor, na ordem da primeira ocorrência ou de `order`. */
function counts<T extends string>(values: T[], order?: readonly T[]): string {
  const keys = order ? order.filter((key) => values.includes(key)) : [...new Set(values)];
  return keys.map((key) => `${key} ${frac(values.filter((v) => v === key).length, values.length)}`).join('; ');
}

function distinctScores(log: LogEntry[]): Array<number | null> {
  return [...new Set(log.map((entry) => entry.score))].sort((a, b) => (a ?? -1) - (b ?? -1));
}

/** Scores distintos do log como célula; texto quando não há entrada de log. */
function scoreCell(log: LogEntry[]): Cell {
  return log.length > 0 ? { list: distinctScores(log), d: 3 } : 'sem entrada de log';
}

/** Scores distintos em pt-BR, para o texto do resumo. */
function scoreText(log: LogEntry[]): string {
  return distinctScores(log)
    .map((s) => (s === null ? 'sem score' : br(s, 3)))
    .join('; ');
}

/** A primeira linha do erro como o reporter gravou, sem os códigos de cor do terminal. */
const plainError = (error: string | null) => (error === null ? 'sem erro' : error.replace(/\u001b\[[0-9;]*m/g, ''));

// ---------------------------------------------------------------------------
// Leitura

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function gitShow(commit: string, file: string): string {
  const result = spawnSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git show ${commit}:${file} falhou: ${result.stderr}`);
  }
  return result.stdout;
}

function logEntries(dir: string): LogEntry[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => path.basename(name).startsWith('healing-') && name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => readJsonl(path.join(dir, name)) as unknown as LogEntry[]);
}

interface BaselineFingerprint {
  selector: string;
  url: string;
  text: string;
  position: { parentTag: string | null; parentSiblingIndex: number | null; siblingIndex: number; depth: number };
}

/**
 * Fingerprints de baseline por `url|selector`, lidos de `healing/fingerprints/`
 * depois de conferir que o diretório é idêntico ao do commit da rodada.
 */
function loadBaselineFingerprints(commit: string): Map<string, BaselineFingerprint> {
  const diff = spawnSync('git', ['diff', '--quiet', commit, '--', 'healing/fingerprints'], { cwd: ROOT });
  if (diff.status !== 0) {
    throw new Error(`healing/fingerprints/ difere do commit da rodada ${commit}`);
  }
  const dir = path.join(ROOT, 'healing', 'fingerprints');
  const map = new Map<string, BaselineFingerprint>();
  for (const file of listFilesRecursive(dir).filter((name) => name.endsWith('.json'))) {
    const fp = readJson<BaselineFingerprint>(path.join(dir, file));
    map.set(`${fp.url}|${fp.selector}`, fp);
  }
  return map;
}

/** Índice (base 0) do candidato entre os irmãos, pelo último `:nth-child` do seletor registrado. */
export function candidateSiblingIndex(candidate: string | null): number | null {
  const match = candidate?.match(/:nth-child\((\d+)\)'?\)?$/);
  return match ? Number(match[1]) - 1 : null;
}

/** Seletor do fingerprint de baseline da mesma página que ocupa a posição do candidato. */
function occupantOf(entry: LogEntry, target: BaselineFingerprint, baseline: Map<string, BaselineFingerprint>): string {
  const index = candidateSiblingIndex(entry.candidate);
  const same = [...baseline.values()].filter(
    (fp) =>
      fp.url === target.url &&
      fp.position.parentTag === target.position.parentTag &&
      fp.position.parentSiblingIndex === target.position.parentSiblingIndex &&
      fp.position.depth === target.position.depth &&
      fp.position.siblingIndex === index,
  );
  return same.length === 1 ? same[0].selector : same.length === 0 ? 'nenhum fingerprint nessa posição' : 'posição ambígua';
}

interface ManifestCheck {
  run: string;
  listed: number;
  ok: number;
  mismatched: string[];
  missing: string[];
  unlisted: string[];
}

function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** Confere cada linha de `MANIFEST.sha256` contra os bytes do arquivo. */
function checkManifest(runRel: string): ManifestCheck {
  const dir = path.join(ROOT, runRel);
  const lines = readFileSync(path.join(dir, 'MANIFEST.sha256'), 'utf8').split('\n').filter((line) => line.length > 0);
  const listed = new Set<string>();
  const mismatched: string[] = [];
  const missing: string[] = [];
  let ok = 0;
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (!match) {
      throw new Error(`${runRel}: linha de manifesto ilegível: ${line}`);
    }
    const [, hash, file] = match;
    listed.add(file);
    const full = path.join(dir, file);
    if (!existsSync(full)) {
      missing.push(file);
      continue;
    }
    if (createHash('sha256').update(readFileSync(full)).digest('hex') === hash) {
      ok += 1;
    } else {
      mismatched.push(file);
    }
  }
  const unlisted = listFilesRecursive(dir).filter((file) => file !== 'MANIFEST.sha256' && !listed.has(file));
  return { run: path.basename(runRel), listed: listed.size, ok, mismatched, missing, unlisted };
}

interface MainRun {
  commit: string;
  dirty: boolean;
  plan: PlanInvocation[];
  matrix: MatrixRow[];
  outcomes: Map<string, string>;
  attempts: Map<string, number>;
  /** Execuções da última tentativa de cada invocação medida, na ordem do plano. */
  executions: Execution[];
  /** Entradas de log sem execução correspondente: possível defeito na coleta. */
  orphanLog: string[];
  collectionProblems: string[];
}

function loadMainRun(): MainRun {
  const runDir = path.join(ROOT, MAIN_RUN);
  const saved = readJson<{ git: { commit: string; dirty: boolean }; plan: PlanInvocation[] }>(path.join(runDir, 'plan.json'));
  const matrix = (JSON.parse(gitShow(saved.git.commit, 'mutation/effectiveness-matrix.json')) as { linhas: MatrixRow[] }).linhas;
  const outcomes = new Map(readJsonl(path.join(runDir, 'outcomes.jsonl')).map((line) => [invocationKey(line), String(line.outcome)]));
  const attempts = new Map<string, number>();
  for (const line of readJsonl(path.join(runDir, 'invocations.jsonl'))) {
    const key = invocationKey(line);
    if (Number(line.attempt) > (attempts.get(key) ?? 0)) {
      attempts.set(key, Number(line.attempt));
    }
  }

  const executions: Execution[] = [];
  const orphanLog: string[] = [];
  const collectionProblems: string[] = [];
  for (const inv of saved.plan) {
    const key = invocationKey(inv);
    if (outcomes.get(key) !== 'medida') {
      continue;
    }
    const dir = path.join(runDir, inv.condition, inv.entryId, `attempt-${attempts.get(key)}`);
    const events = testEvents(dir) as unknown as TestEvent[];
    const log = logEntries(dir);
    const expected = inv.tests.length * inv.repeatEach;
    if (events.length !== expected) {
      collectionProblems.push(`${key}: ${events.length} execuções gravadas, ${expected} previstas`);
    }
    if (events.some((event) => event.invalid)) {
      collectionProblems.push(`${key}: execução inválida na tentativa usada`);
    }
    if (inv.condition === 'healing-off' && log.length > 0) {
      collectionProblems.push(`${key}: ${log.length} entradas de log na condição desligada`);
    }
    const order = new Map(inv.tests.map((test, index) => [test, index]));
    const seen = new Set<string>();
    for (const event of events) {
      const execKey = `${event.testId}|${event.repetition}`;
      if (seen.has(execKey)) {
        collectionProblems.push(`${key}: execução duplicada ${execKey}`);
      }
      seen.add(execKey);
      if (!order.has(event.testId)) {
        collectionProblems.push(`${key}: teste fora do plano ${event.testId}`);
      }
      executions.push({
        entryId: inv.entryId,
        condition: inv.condition,
        testId: event.testId,
        repetition: event.repetition,
        passed: event.status === 'passed',
        status: event.status,
        durationMs: event.durationMs,
        applied: event.mutation.some((page) => page.applied === true),
        error: event.error,
        log: log.filter((entry) => entry.run?.testId === event.testId && entry.run?.repetition === event.repetition),
      });
    }
    for (const entry of log) {
      const r = entry.run;
      if (!r || r.entryId !== inv.entryId || r.condition !== inv.condition || !seen.has(`${r.testId}|${r.repetition}`)) {
        orphanLog.push(`${key}: ${JSON.stringify(r)}`);
      }
      if (entry.threshold !== MAIN_THRESHOLD || entry.decision !== decisionAt(entry.score, MAIN_THRESHOLD)) {
        collectionProblems.push(`${key}: decisão ${entry.decision} incoerente com score ${entry.score} e limiar ${entry.threshold}`);
      }
    }
  }
  // Ordem estável: plano, depois ordem dos testes na invocação, depois repetição.
  const planIndex = new Map(saved.plan.map((inv, index) => [invocationKey(inv), index]));
  const testIndex = new Map(saved.plan.map((inv) => [invocationKey(inv), new Map(inv.tests.map((t, i) => [t, i]))]));
  executions.sort((a, b) => {
    const ka = invocationKey(a);
    const kb = invocationKey(b);
    return (
      planIndex.get(ka)! - planIndex.get(kb)! ||
      testIndex.get(ka)!.get(a.testId)! - testIndex.get(kb)!.get(b.testId)! ||
      a.repetition - b.repetition
    );
  });
  return { commit: saved.git.commit, dirty: saved.git.dirty, plan: saved.plan, matrix, outcomes, attempts, executions, orphanLog, collectionProblems };
}

// ---------------------------------------------------------------------------
// Gráficos SVG simples, estáticos e determinísticos

const SVG_STYLE = `<style>
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --grid: #dedcd6; --s1: #2a78d6; --s2: #eb6834; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --grid: #3a3936; --s1: #3987e5; --s2: #d95926; } }
  .bg { fill: var(--surface); } .t { fill: var(--ink); font: 13px sans-serif; } .t2 { fill: var(--ink-2); font: 11px sans-serif; }
  .g { stroke: var(--grid); stroke-width: 1; } .ax { stroke: var(--ink-2); stroke-width: 1; }
  .s1 { stroke: var(--s1); fill: var(--s1); } .s2 { stroke: var(--s2); fill: var(--s2); } .ln { fill: none; stroke-width: 2; }
  .ref { stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 4 3; } .bar { fill: var(--s1); }
</style>`;

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (value: number) => fixed(value, 1);

function svgDoc(width: number, height: number, title: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    SVG_STYLE,
    `<rect class="bg" width="${width}" height="${height}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const sx = (p: Panel, v: number) => p.x + ((v - p.xMin) / (p.xMax - p.xMin)) * p.w;
const sy = (p: Panel, v: number) => p.y + p.h - ((v - p.yMin) / (p.yMax - p.yMin)) * p.h;

function axes(p: Panel, xTicks: number[], yTicks: number[], xFmt: (v: number) => string, yFmt: (v: number) => string): string[] {
  const out: string[] = [];
  for (const v of yTicks) {
    out.push(`<line class="g" x1="${px(p.x)}" x2="${px(p.x + p.w)}" y1="${px(sy(p, v))}" y2="${px(sy(p, v))}"/>`);
    out.push(`<text class="t2" x="${px(p.x - 6)}" y="${px(sy(p, v) + 4)}" text-anchor="end">${esc(yFmt(v))}</text>`);
  }
  out.push(`<line class="ax" x1="${px(p.x)}" x2="${px(p.x + p.w)}" y1="${px(p.y + p.h)}" y2="${px(p.y + p.h)}"/>`);
  for (const v of xTicks) {
    out.push(`<text class="t2" x="${px(sx(p, v))}" y="${px(p.y + p.h + 16)}" text-anchor="middle">${esc(xFmt(v))}</text>`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Análise

interface Output {
  files: Map<string, string>;
}

function addTable(out: Output, table: Table): void {
  out.files.set(`tabelas/${table.name}.csv`, tableCsv(table));
  out.files.set(`tabelas/${table.name}.md`, tableMd(table));
}

const link = (name: string) => `[tabelas/${name}.md](tabelas/${name}.md)`;

export function buildAnalysis(): Map<string, string> {
  const out: Output = { files: new Map() };
  const summary: string[] = [];
  const divergences: string[] = [];

  // 1. Integridade -----------------------------------------------------------
  const manifests = [checkManifest(MAIN_RUN), checkManifest(CAPTURE_RUN)];
  const broken = manifests.filter((m) => m.mismatched.length + m.missing.length + m.unlisted.length > 0);
  if (broken.length > 0) {
    throw new Error(
      `manifesto não confere, análise interrompida: ${broken
        .map((m) => `${m.run}: divergentes ${m.mismatched.join(', ')}; ausentes ${m.missing.join(', ')}; fora do manifesto ${m.unlisted.join(', ')}`)
        .join(' | ')}`,
    );
  }
  const main = loadMainRun();
  if (main.orphanLog.length > 0 || main.collectionProblems.length > 0) {
    throw new Error(
      `possível defeito na coleta, análise interrompida:\n${[...main.collectionProblems, ...main.orphanLog.map((o) => `log sem execução: ${o}`)].join('\n')}`,
    );
  }
  const capturePlan = readJson<{ git: { commit: string; dirty: boolean } }>(path.join(ROOT, CAPTURE_RUN, 'plan.json'));
  const captureOutcomes = readJsonl(path.join(ROOT, CAPTURE_RUN, 'outcomes.jsonl'));
  const captureInvocations = readJsonl(path.join(ROOT, CAPTURE_RUN, 'invocations.jsonl'));
  const mainInvocations = readJsonl(path.join(ROOT, MAIN_RUN, 'invocations.jsonl'));
  const reexec = (lines: Array<Record<string, unknown>>) =>
    [...new Set(lines.filter((line) => Number(line.attempt) > 1).map((line) => invocationKey(line)))];
  const mainMeasured = [...main.outcomes.values()].filter((o) => o === 'medida').length;
  const captureMeasured = captureOutcomes.filter((line) => line.outcome === 'medida').length;
  const matrixHead = readFileSync(path.join(ROOT, 'mutation/effectiveness-matrix.json'), 'utf8');
  const matrixAtRun = gitShow(main.commit, 'mutation/effectiveness-matrix.json');
  addTable(out, {
    name: '01-integridade',
    title: 'Integridade das rodadas',
    rule: `${RULE.manifest}; última tentativa de cada invocação, ${RULE.lastAttempt}`,
    headers: ['rodada', 'arquivos no manifesto', 'conferidos', 'divergentes', 'ausentes', 'fora do manifesto', 'commit', 'árvore limpa', 'invocações com desfecho', 'medidas', 'invocações reexecutadas'],
    rows: [
      [manifests[0].run, n(manifests[0].listed), n(manifests[0].ok), n(manifests[0].mismatched.length), n(manifests[0].missing.length), n(manifests[0].unlisted.length), main.commit.slice(0, 7), main.dirty ? 'não' : 'sim', n(main.outcomes.size), n(mainMeasured), reexec(mainInvocations).join('; ') || 'nenhuma'],
      [manifests[1].run, n(manifests[1].listed), n(manifests[1].ok), n(manifests[1].mismatched.length), n(manifests[1].missing.length), n(manifests[1].unlisted.length), capturePlan.git.commit.slice(0, 7), capturePlan.git.dirty ? 'não' : 'sim', n(captureOutcomes.length), n(captureMeasured), reexec(captureInvocations).join('; ') || 'nenhuma'],
    ],
    notes: [
      `Matriz de efetividade lida do commit da rodada (\`git show ${main.commit.slice(0, 7)}:mutation/effectiveness-matrix.json\`); idêntica à da árvore atual: ${matrixHead === matrixAtRun ? 'sim' : 'não'}.`,
      `Coerência do log com os eventos dos testes (execuções previstas, nenhuma inválida na tentativa usada, nenhuma entrada de log órfã ou na condição desligada, decisão coerente com score e limiar ${br(MAIN_THRESHOLD, 1)}): sem problemas.`,
    ],
  });
  summary.push(
    '## 1. Integridade',
    '',
    `- Manifestos SHA-256: rodada principal ${frac(manifests[0].ok, manifests[0].listed)} arquivos conferidos, medição da captura ${frac(manifests[1].ok, manifests[1].listed)}; nenhum divergente, ausente ou fora do manifesto (${RULE.manifest}). ${link('01-integridade')}`,
    `- Rodada principal: ${frac(mainMeasured, main.outcomes.size)} invocações medidas; reexecutadas por infraestrutura: ${reexec(mainInvocations).join(', ') || 'nenhuma'}; vale a última tentativa (${RULE.lastAttempt}).`,
    `- Medição da captura: ${frac(captureMeasured, captureOutcomes.length)} invocações medidas; reexecutadas: ${reexec(captureInvocations).join(', ') || 'nenhuma'} (${RULE.lastAttempt}).`,
    '- Coerência entre o log do mecanismo e os eventos dos testes: nenhum problema encontrado.',
    '',
  );

  const matrixById = new Map(main.matrix.map((row) => [row.id, row]));
  const entryOrder = main.matrix.map((row) => row.id);
  const execs = (entryId: string, condition: Condition) =>
    main.executions.filter((e) => e.entryId === entryId && e.condition === condition);
  const testsOf = (list: Execution[]) => [...new Set(list.map((e) => e.testId))];

  // 1b. Paridade da condição desligada com a matriz -------------------------
  const parityRows: Cell[][] = [];
  let parityDivergent = 0;
  for (const row of main.matrix) {
    const testId = reproducedTestId(row.reproducedTest);
    const off = execs(row.id, 'healing-off').filter((e) => e.testId === testId);
    if (off.length === 0) {
      throw new Error(`${row.id}: teste reproduzido ${testId} não rodou na condição desligada`);
    }
    const expectedPass = row.test !== 'falha';
    const agrees = off.every((e) => e.passed === expectedPass);
    parityDivergent += agrees ? 0 : 1;
    parityRows.push([row.id, row.reproducedTest, row.test, frac(off.filter((e) => e.passed).length, off.length), agrees ? 'sim' : 'não']);
  }
  addTable(out, {
    name: '02-paridade-matriz',
    title: 'Condição desligada contra a matriz versionada, no teste reproduzido de cada entrada',
    rule: RULE.parity,
    headers: ['entrada', 'teste reproduzido', 'matriz', 'passou (desligada)', 'concorda'],
    rows: parityRows,
    notes: ['"passa" e "passa por engano" na matriz correspondem a teste aprovado; "falha", a teste reprovado.'],
  });
  summary.push(
    '## 2. Condição desligada contra a matriz',
    '',
    `- ${parityDivergent} divergências em ${main.matrix.length} entradas (${RULE.parity}). ${link('02-paridade-matriz')}`,
    '',
  );
  if (parityDivergent > 0) {
    divergences.push(`Condição desligada diverge da matriz em ${parityDivergent} entradas (${RULE.parity}).`);
  }

  // 2. Exclusões por applied: false -----------------------------------------
  const appliedRows: Cell[][] = [];
  let excludedTotal = 0;
  for (const id of entryOrder) {
    const off = execs(id, 'healing-off');
    const on = execs(id, 'healing-on');
    const exOff = off.filter((e) => !e.applied).length;
    const exOn = on.filter((e) => !e.applied).length;
    excludedTotal += exOff + exOn;
    appliedRows.push([id, n(off.length), n(exOff), n(on.length), n(exOn)]);
  }
  addTable(out, {
    name: '03-exclusoes-applied',
    title: 'Execuções excluídas por mutação não aplicada (applied: false em todas as páginas visitadas)',
    rule: RULE.applied,
    headers: ['entrada', 'execuções desligada', 'excluídas desligada', 'execuções ligada', 'excluídas ligada'],
    rows: appliedRows,
    notes: ['Uma execução entra quando a mutação foi aplicada em ao menos uma das páginas que o teste visitou.'],
  });
  const kept = (list: Execution[]) => list.filter((e) => e.applied);

  // 3. Não determinismo -------------------------------------------------------
  const labelOf = (e: Execution): string => {
    if (e.condition === 'healing-off') {
      return e.status;
    }
    const row = matrixById.get(e.entryId)!;
    const cls = row.class === 'cosmetic' ? classifyCosmetic(e.log, e.passed) : classifyDefect(e.log);
    return `${cls} / ${e.status}`;
  };
  const ndSummary: Cell[][] = [];
  const ndCases: Cell[][] = [];
  let triosChecked = 0;
  for (const inv of main.plan.filter((i) => i.repeatEach > 1)) {
    const list = kept(execs(inv.entryId, inv.condition));
    let divergent = 0;
    const tests = testsOf(list);
    for (const testId of tests) {
      const reps = list.filter((e) => e.testId === testId);
      triosChecked += 1;
      const labels = reps.map(labelOf);
      if (new Set(labels).size > 1) {
        divergent += 1;
        ndCases.push([inv.entryId, inv.condition, testId, ...labels]);
      }
    }
    ndSummary.push([inv.entryId, inv.condition, n(tests.length), n(divergent)]);
  }
  addTable(out, {
    name: '04-nao-determinismo',
    title: 'Comparação das três repetições de cada (entrada, teste, condição)',
    rule: RULE.nondeterminism,
    headers: ['entrada', 'condição', 'testes comparados', 'com divergência'],
    rows: ndSummary,
    notes: [
      'Desligada: compara o resultado do Playwright. Ligada: compara a classe da execução e o resultado do Playwright, no formato "classe / resultado".',
    ],
  });
  addTable(out, {
    name: '05-nao-determinismo-casos',
    title: 'Casos de não determinismo: as três observações',
    rule: `${RULE.nondeterminism}; relatado, nunca resolvido por maioria`,
    headers: ['entrada', 'condição', 'teste', 'repetição 1', 'repetição 2', 'repetição 3'],
    rows: ndCases,
    empty: 'Nenhuma divergência entre repetições.',
  });
  summary.push(
    '## 3. Não determinismo',
    '',
    `- ${ndCases.length} divergências em ${triosChecked} trios (entrada, teste, condição) com N = 3 (${RULE.nondeterminism}). ${link('04-nao-determinismo')} · ${link('05-nao-determinismo-casos')}`,
    '',
  );
  if (ndCases.length > 0) {
    divergences.push(`${ndCases.length} casos de não determinismo entre repetições (${RULE.nondeterminism}); listados sem resolução por maioria.`);
  }

  // 4. Denominadores e exclusões ---------------------------------------------
  const notMeasuredEntries = entryOrder.filter((id) =>
    (['healing-off', 'healing-on'] as const).some((c) => main.outcomes.get(`${id}|${c}`) !== 'medida'),
  );
  const recoveryIds = main.matrix.filter((r) => r.class === 'cosmetic' && r.locator === 'quebra').map((r) => r.id);
  const fpIds = main.matrix.filter((r) => r.class === 'defect' && r.locator === 'quebra').map((r) => r.id);
  const deviateIds = main.matrix.filter((r) => r.locator === 'desvia').map((r) => r.id);
  const inertIds = main.matrix.filter((r) => r.locator === 'inerte').map((r) => r.id);
  addTable(out, {
    name: '06-denominadores',
    title: 'Denominadores e exclusões',
    rule: `${RULE.denominators} (denominadores pela matriz versionada, ${RULE.applied})`,
    headers: ['conjunto', 'previsto', 'medido', 'entradas'],
    rows: [
      ['recuperação (cosmética, locator quebra)', n(6), n(recoveryIds.length), recoveryIds.join('; ')],
      ['falso positivo (M5, locator quebra)', n(24), n(fpIds.length), fpIds.join('; ')],
      ['fora dos denominadores (locator desvia)', n(3), n(deviateIds.length), deviateIds.join('; ')],
      ['inertes', n(70), n(inertIds.length), `${inertIds.length} entradas`],
      ['entradas não medidas', n(0), n(notMeasuredEntries.length), notMeasuredEntries.join('; ') || 'nenhuma'],
      ['execuções excluídas por applied: false', n(0), n(excludedTotal), `de ${main.executions.length} execuções; por entrada em 03-exclusoes-applied`],
    ],
  });
  summary.push(
    '## 4. Denominadores e exclusões',
    '',
    `- Recuperação: ${recoveryIds.length} entradas; falso positivo: ${fpIds.length}; fora dos denominadores (desvio): ${deviateIds.length} (${RULE.denominators}). ${link('06-denominadores')}`,
    `- Execuções excluídas por \`applied: false\`: ${excludedTotal} de ${main.executions.length} (${RULE.applied}). Entradas não medidas: ${notMeasuredEntries.length}. ${link('03-exclusoes-applied')}`,
    '',
  );
  if (recoveryIds.length !== 6 || fpIds.length !== 24) {
    divergences.push(`Denominadores medidos (${recoveryIds.length} e ${fpIds.length}) diferentes dos previstos, 6 e 24 (${RULE.denominators}).`);
  }

  // 5. Recuperação --------------------------------------------------------------
  const onKept = (id: string) => kept(execs(id, 'healing-on'));
  const recoveryRows: Cell[][] = [];
  const recoveryMd: Array<{ id: string; outcome: string }> = [];
  const categoryRows: Cell[][] = [];
  for (const id of recoveryIds) {
    const row = matrixById.get(id)!;
    const list = onKept(id);
    const classes = list.map((e) => classifyCosmetic(e.log, e.passed));
    const log = list.flatMap((e) => e.log);
    const outcome = aggregateRecovery(classes);
    recoveryMd.push({ id, outcome });
    const count = (c: CosmeticClass) => frac(classes.filter((x) => x === c).length, classes.length);
    recoveryRows.push([
      id,
      row.target,
      row.code,
      scoreCell(log),
      log.length > 0 ? counts(log.map((e) => e.decision)) : 'mecanismo não acionado',
      log.length > 0 ? counts(log.map((e) => (e.candidateIsOracle === true ? 'sim' : e.candidateIsOracle === false ? 'não' : 'sem oráculo'))) : '',
      frac(list.filter((e) => e.passed).length, list.length),
      count('sucesso'),
      count('elemento certo, teste falha'),
      count('cura incorreta'),
      count('fail'),
      count('não acionado'),
      outcome,
    ]);
    for (const cat of ['elemento certo, teste falha', 'cura incorreta'] as const) {
      const hit = list.filter((e, i) => classes[i] === cat);
      if (hit.length > 0) {
        categoryRows.push([cat, id, frac(hit.length, list.length), [...new Set(hit.map((e) => plainError(e.error)))].join('; ')]);
      }
    }
  }
  const recovered = recoveryMd.filter((r) => r.outcome === 'recuperada').length;
  // Entradas sem nenhuma entrada de log em nenhuma execução: ficam no denominador; a fração sem elas vai ao lado.
  const notTriggered = (id: string) => onKept(id).every((e) => e.log.length === 0);
  const recoveryNotTriggered = recoveryIds.filter(notTriggered);
  const recoverySide = `${frac(recovered, recoveryIds.length - recoveryNotTriggered.length)} sem ${recoveryNotTriggered.length === 1 ? 'a entrada não acionada' : 'as entradas não acionadas'} (${recoveryNotTriggered.join(', ')})`;
  addTable(out, {
    name: '07-recuperacao',
    title: `Recuperação: uma linha por entrada do denominador, limiar ${br(MAIN_THRESHOLD, 1)}`,
    rule: `tabela individual e fração com absoluto, ${RULE.report}; classes e agregação, ${RULE.classes}`,
    headers: [
      'entrada', 'alvo', 'mutação', 'score', 'decisão (entradas de log)', 'elemento certo (entradas de log)', 'teste passa (execuções)',
      'sucesso', 'elemento certo, teste falha', 'cura incorreta', 'fail', 'não acionado', 'desfecho da entrada',
    ],
    rows: recoveryRows,
    notes: [
      `Recuperadas: ${frac(recovered, recoveryIds.length)} entradas, com o denominador da matriz (${RULE.applied}).` +
        (recoveryNotTriggered.length > 0 ? ` Ao lado: ${recoverySide}, ${RULE.postData}.` : ''),
      'As cinco colunas de classe são a contagem bruta k/N das execuções da entrada (descritiva; não entra na taxa nem a recalcula). O desfecho exige sucesso em todas as execuções.',
      'Score: valores distintos registrados no log da entrada. "Elemento certo" é o candidateIsOracle de cada entrada de log; uma execução pode ter mais de uma entrada de log.',
      `"Não acionado" é a execução sem entrada de log (${RULE.postData}). O log não registra se o locator resolveu: quando a ação não lança exceção (isVisible() devolve false, por exemplo), o locator pode não ter resolvido e mesmo assim não haver entrada. O detalhe por teste está em 12-divergencias-por-teste.`,
    ],
  });
  addTable(out, {
    name: '08-categorias-a-parte',
    title: 'Categorias à parte: "elemento certo, teste falha" e "replace no elemento errado em mutação cosmética" (cura incorreta)',
    rule: RULE.classes,
    headers: ['categoria', 'entrada', 'execuções na categoria', 'erro do teste (primeira linha, como gravado)'],
    rows: categoryRows,
    notes: [
      `Cura incorreta: ${categoryRows.filter((r) => r[0] === 'cura incorreta').length} entradas. Elemento certo, teste falha: ${categoryRows.filter((r) => r[0] === 'elemento certo, teste falha').length} entradas.`,
      'As entradas listadas aqui continuam no denominador e fora do numerador.',
    ],
  });

  // 6. Falso positivo -----------------------------------------------------------
  const fpRows: Cell[][] = [];
  const fpOutcome = new Map<string, FalsePositiveOutcome>();
  for (const id of fpIds) {
    const row = matrixById.get(id)!;
    const list = onKept(id);
    const classes = list.map((e) => classifyDefect(e.log));
    const outcome = aggregateFalsePositive(classes);
    fpOutcome.set(id, outcome);
    const count = (c: DefectClass) => frac(classes.filter((x) => x === c).length, classes.length);
    fpRows.push([id, row.target.split('-')[0], row.target, count('replace'), count('fail'), count('não acionado'), scoreCell(list.flatMap((e) => e.log)), outcome]);
  }
  const fpCount = [...fpOutcome.values()].filter((o) => o === 'falso positivo').length;
  const fpFavor = [...fpOutcome.values()].filter((o) => o === 'fail em todas').length;
  const fpNotTriggered = fpIds.filter((id) => fpOutcome.get(id) === 'não acionado');
  const fpMixed = fpIds.filter((id) => fpOutcome.get(id) === 'fail e não acionado');
  const fpSide = `${frac(fpCount, fpIds.length - fpNotTriggered.length)} sem ${fpNotTriggered.length === 1 ? 'a entrada não acionada' : 'as entradas não acionadas'} (${fpNotTriggered.join(', ')})`;
  addTable(out, {
    name: '09-falso-positivo-entradas',
    title: `Falso positivo bruto, por entrada (k/${fpIds.length}), limiar ${br(MAIN_THRESHOLD, 1)}`,
    rule: `relato bruto e por alvo, ${RULE.report}; agregação, ${RULE.classes}; entrada não acionada, ${RULE.postData}`,
    headers: ['entrada', 'alvo', 'instância', 'replace (execuções)', 'fail (execuções)', 'não acionado (execuções)', 'score', 'desfecho da entrada'],
    rows: fpRows,
    notes: [
      `Falso positivo: ${frac(fpCount, fpIds.length)} entradas, com o denominador da matriz (${RULE.applied}).` +
        (fpNotTriggered.length > 0 ? ` Ao lado: ${fpSide} (${RULE.postData}).` : ''),
      `Fail em todas as execuções: ${frac(fpFavor, fpIds.length)}. Não acionado: ${frac(fpNotTriggered.length, fpIds.length)}${fpNotTriggered.length > 0 ? ` (${fpNotTriggered.join(', ')})` : ''}. Fail e não acionado na mesma entrada: ${frac(fpMixed.length, fpIds.length)}.`,
      `Uma entrada não acionada não é falso positivo, porque não houve replace, e não conta a favor, porque não houve fail (${RULE.postData}).`,
    ],
  });
  const byTarget = new Map<string, string[]>();
  for (const id of fpIds) {
    const target = matrixById.get(id)!.target.split('-')[0];
    byTarget.set(target, [...(byTarget.get(target) ?? []), id]);
  }
  const targetRows: Cell[][] = [];
  for (const [target, ids] of byTarget) {
    const fp = ids.filter((id) => fpOutcome.get(id) === 'falso positivo').length;
    const idle = ids.filter((id) => fpOutcome.get(id) !== 'falso positivo' && fpOutcome.get(id) !== 'fail em todas').length;
    targetRows.push([target, n(ids.length), ids.length > 1 ? `${fp} de ${ids.length} categorias` : frac(fp, 1), idle > 0 ? `${idle} com execução não acionada` : '', fp > 0 ? 'falso positivo' : idle > 0 ? 'não acionado' : 'fail em todas']);
  }
  const fpTargets = targetRows.filter((r) => r[4] === 'falso positivo').length;
  const fpTargetsIdle = targetRows.filter((r) => r[4] === 'não acionado').length;
  const t1 = byTarget.get('T1') ?? [];
  const t1Fp = t1.filter((id) => fpOutcome.get(id) === 'falso positivo').length;
  addTable(out, {
    name: '10-falso-positivo-por-alvo',
    title: 'Falso positivo por alvo distinto (T1 conta uma vez)',
    rule: RULE.report,
    headers: ['alvo', 'entradas', 'com falso positivo', 'observação', 'desfecho do alvo'],
    rows: targetRows,
    notes: [
      `Alvos com falso positivo: ${frac(fpTargets, byTarget.size)}. T1: ${t1Fp} de ${t1.length} categorias.` +
        (fpTargetsIdle > 0 ? ` Ao lado, sem os alvos não acionados: ${frac(fpTargets, byTarget.size - fpTargetsIdle)} (${RULE.postData}).` : ''),
    ],
  });

  // Fora dos denominadores ------------------------------------------------------
  const outsideRows: Cell[][] = [];
  for (const id of deviateIds) {
    const row = matrixById.get(id)!;
    const kind = row.class === 'cosmetic' ? 'passa por engano' : 'defect despercebido';
    for (const condition of ['healing-off', 'healing-on'] as const) {
      const list = kept(execs(id, condition));
      const log = list.flatMap((e) => e.log);
      outsideRows.push([
        id, kind, condition, n(list.length), frac(list.filter((e) => e.passed).length, list.length),
        condition === 'healing-on' ? frac(list.filter((e) => e.log.length > 0).length, list.length) : 'não se aplica',
        log.length > 0 ? counts(log.map((e) => e.decision)) : '',
      ]);
    }
  }
  addTable(out, {
    name: '11-fora-dos-denominadores',
    title: 'Fora dos denominadores: passa por engano e defect despercebido',
    rule: `${RULE.report}; detalhe por teste em 12-divergencias-por-teste (${RULE.perTestDivergence})`,
    headers: ['entrada', 'categoria', 'condição', 'execuções', 'teste passou', 'mecanismo acionado (execuções)', 'decisões'],
    rows: outsideRows,
  });

  // Divergência por teste em relação à matriz ----------------------------------
  const divRows: Cell[][] = [];
  const divEntries = new Set<string>();
  for (const row of main.matrix) {
    const on = execs(row.id, 'healing-on');
    const off = execs(row.id, 'healing-off');
    for (const testId of testsOf(on)) {
      const tOn = on.filter((e) => e.testId === testId);
      const tOff = off.filter((e) => e.testId === testId);
      const triggered = tOn.filter((e) => e.log.length > 0).length;
      const expectTrigger = row.locator === 'quebra';
      const expectPassOff = row.test !== 'falha';
      const diverges =
        (expectTrigger ? triggered < tOn.length : triggered > 0) || tOff.some((e) => e.passed !== expectPassOff);
      if (!diverges) {
        continue;
      }
      divEntries.add(row.id);
      const log = tOn.flatMap((e) => e.log);
      const cause =
        triggered === 0
          ? 'mecanismo não acionado'
          : log.some((e) => e.decision === 'replace')
            ? 'mecanismo acionado com replace'
            : 'mecanismo acionado com fail';
      divRows.push([
        row.id, `${row.locator} / ${row.test}`, testId,
        frac([...tOn, ...tOff].filter((e) => e.applied).length, tOn.length + tOff.length),
        triggered > 0 ? `sim (${frac(triggered, tOn.length)})` : 'não registrado',
        frac(triggered, tOn.length),
        log.length > 0 ? counts(log.map((e) => e.decision)) : '',
        log.length > 0 ? counts(log.map((e) => String(e.candidateIsOracle))) : '',
        frac(tOn.filter((e) => e.passed).length, tOn.length),
        frac(tOff.filter((e) => e.passed).length, tOff.length),
        cause,
      ]);
    }
  }
  addTable(out, {
    name: '12-divergencias-por-teste',
    title: 'Testes cujo comportamento diverge da matriz (uma linha por teste)',
    rule: RULE.perTestDivergence,
    headers: ['entrada', 'matriz (locator / teste)', 'teste', 'applied', 'locator quebrou', 'mecanismo acionado', 'decisão', 'candidateIsOracle', 'passa (ligada)', 'passa (desligada)', 'causa'],
    rows: divRows,
    empty: 'Nenhum teste diverge da matriz.',
    notes: [
      'Diverge: entrada com locator "quebra" e alguma execução da condição ligada sem entrada de log; entrada "inerte" ou "desvia" com alguma entrada de log; ou resultado da condição desligada diferente do teste da matriz.',
      '"Locator quebrou": o harness só registra a quebra quando a ação lança exceção e o mecanismo é acionado. Sem entrada de log, a quebra não é observável no log, e a coluna diz "não registrado".',
    ],
  });
  const inertWithLog = inertIds.filter((id) => execs(id, 'healing-on').some((e) => e.log.length > 0));
  addTable(out, {
    name: '13-inertes-com-log',
    title: 'Entradas inertes com alguma entrada de log na condição ligada',
    rule: RULE.inert,
    headers: ['entrada', 'execuções com entrada de log'],
    rows: inertWithLog.map((id) => [id, frac(execs(id, 'healing-on').filter((e) => e.log.length > 0).length, execs(id, 'healing-on').length)]),
    empty: `Nenhuma: as ${inertIds.length} entradas inertes não tiveram nenhuma entrada de log.`,
  });

  summary.push(
    `## 5. Recuperação e falso positivo (limiar ${br(MAIN_THRESHOLD, 1)}, resultado principal)`,
    '',
    `Classes por execução e agregação "na dúvida, contra o mecanismo": ${RULE.classes}. Relato por entrada, fração com absoluto, falso positivo bruto e por alvo: ${RULE.report}.`,
    '',
    `- **Recuperação: ${frac(recovered, recoveryIds.length)} entradas recuperadas** (${RULE.classes}; denominador da matriz, ${RULE.applied})` +
      (recoveryNotTriggered.length > 0 ? `; ao lado, ${recoverySide} (${RULE.postData})` : '') +
      `. ${link('07-recuperacao')}`,
    ...recoveryMd.map((r) => `  - ${r.id}: ${r.outcome}`),
    `- Elemento certo, teste falha: ${categoryRows.filter((r) => r[0] === 'elemento certo, teste falha').map((r) => r[1]).join(', ') || 'nenhuma'}; cura incorreta (replace no elemento errado em mutação cosmética): ${categoryRows.filter((r) => r[0] === 'cura incorreta').map((r) => r[1]).join(', ') || 'nenhuma'} (${RULE.classes}). ${link('08-categorias-a-parte')}`,
    `- **Falso positivo bruto: ${frac(fpCount, fpIds.length)} entradas**${fpCount > 0 ? ` (${fpIds.filter((id) => fpOutcome.get(id) === 'falso positivo').join(', ')})` : ''} (${RULE.classes}; denominador da matriz, ${RULE.applied})` +
      (fpNotTriggered.length > 0 ? `; ao lado, ${fpSide} (${RULE.postData})` : '') +
      `. Fail em todas: ${frac(fpFavor, fpIds.length)}; não acionado: ${frac(fpNotTriggered.length, fpIds.length)}. ${link('09-falso-positivo-entradas')}`,
    `- **Falso positivo por alvo distinto: ${frac(fpTargets, byTarget.size)} alvos**; T1: ${t1Fp} de ${t1.length} categorias (${RULE.report})` +
      (fpTargetsIdle > 0 ? `; ao lado, sem os alvos não acionados, ${frac(fpTargets, byTarget.size - fpTargetsIdle)} (${RULE.postData})` : '') +
      `. ${link('10-falso-positivo-por-alvo')}`,
    `- Fora dos denominadores (passa por engano e defect despercebido): ${deviateIds.join(', ')} (${RULE.report}). ${link('11-fora-dos-denominadores')}`,
    `- Testes com comportamento diferente da matriz: ${divRows.length}, em ${divEntries.size} entradas (${[...divEntries].join(', ') || 'nenhuma'}) (${RULE.perTestDivergence}). ${link('12-divergencias-por-teste')}`,
    `- Entradas inertes com entrada de log: ${inertWithLog.length} de ${inertIds.length} (${RULE.inert}). ${link('13-inertes-com-log')}`,
    `- Métrica de localização correta: não foi registrada antes dos dados e não é calculada (${RULE.postData}). O acerto do elemento aparece por entrada na coluna "elemento certo" da tabela de recuperação (${RULE.report}).`,
    '',
  );
  if (fpNotTriggered.length + recoveryNotTriggered.length > 0) {
    divergences.push(
      `Decidido depois dos dados (ADR-032): ${[...recoveryNotTriggered, ...fpNotTriggered].join(' e ')} ${recoveryNotTriggered.length + fpNotTriggered.length === 1 ? 'é classificada' : 'são classificadas'} como "não acionado", porque o mecanismo não foi acionado em nenhuma execução. Na recuperação, a entrada não acionada fica no denominador e fora do numerador; no falso positivo, não é falso positivo nem conta a favor. Resultados principais pelo denominador da matriz (${RULE.applied}), com a fração sem as não acionadas ao lado: recuperação ${frac(recovered, recoveryIds.length)} (${frac(recovered, recoveryIds.length - recoveryNotTriggered.length)}), falso positivo ${frac(fpCount, fpIds.length)} (${frac(fpCount, fpIds.length - fpNotTriggered.length)}).`,
    );
  }
  if (fpMixed.length > 0) {
    divergences.push(`Entradas M5 com fail e execuções não acionadas ao mesmo tempo, sem regra registrada: ${fpMixed.join(', ')}.`);
  }

  // Achado: falsos positivos e a corroboração por texto -------------------------
  const baseline = loadBaselineFingerprints(main.commit);
  const findingRows: Cell[][] = [];
  const findingText: string[] = [];
  for (const id of fpIds.filter((x) => fpOutcome.get(x) === 'falso positivo')) {
    const log = onKept(id).flatMap((e) => e.log).filter((e) => e.decision === 'replace');
    const fps = log.map((e) => baseline.get(`${e.url}|${e.originalSelector}`));
    if (fps.some((fp) => fp === undefined)) {
      throw new Error(`${id}: entrada de log sem fingerprint de baseline correspondente`);
    }
    const emptyText = fps.filter((fp) => fp!.text.trim() === '').length;
    const unavailable = log.filter((e) => e.flags.includes('text-corroboration-unavailable')).length;
    const noDiscount = log.filter((e) => e.factors?.text === 1).length;
    const occupants = log.map((e, i) => occupantOf(e, fps[i]!, baseline));
    const occupantCounts = counts(occupants);
    findingRows.push([
      id, n(log.length), frac(emptyText, log.length), frac(unavailable, log.length), frac(noDiscount, log.length), scoreCell(log),
      [...new Set(fps.map((fp) => String(fp!.position.siblingIndex)))].join('; '),
      [...new Set(log.map((e) => String(candidateSiblingIndex(e.candidate))))].join('; '),
      occupantCounts,
    ]);
    findingText.push(
      `- **${id}:** replace em ${frac(onKept(id).filter((e) => classifyDefect(e.log) === 'replace').length, onKept(id).length)} execuções (${log.length} entradas de log), score ${scoreText(log)}. ` +
        `O fingerprint de baseline tem \`text\` vazio em ${frac(emptyText, log.length)}; a corroboração por texto fica inaplicável (\`text-corroboration-unavailable\`) em ${frac(unavailable, log.length)} e, sem desconto, com fator de texto 1 em ${frac(noDiscount, log.length)} (${RULE.textCorroboration}). ` +
        `Com o alvo removido, o candidato é o irmão no mesmo pai que, na baseline, ocupa a posição do fingerprint ${counts(occupants.map((o) => `\`${o}\``))}. ` +
        `É o falso positivo posicional que a corroboração por texto deveria barrar (${RULE.positionalFalsePositive}), num alvo sem texto. ` +
        `Registrado como achado, sem mudança no mecanismo; o tratamento conservador da corroboração indisponível fica como trabalho futuro (${RULE.postData}). ${link('22-achado-falso-positivo')}`,
    );
  }
  addTable(out, {
    name: '22-achado-falso-positivo',
    title: 'Achado: falso positivo e corroboração por texto indisponível',
    rule: `${RULE.textCorroboration}; ${RULE.positionalFalsePositive}; registrado como achado no ${RULE.postData}`,
    headers: [
      'entrada', 'entradas de log com replace', 'text vazio no fingerprint', 'corroboração indisponível', 'fator de texto 1', 'score',
      'siblingIndex do alvo (baseline)', 'siblingIndex do candidato', 'fingerprint de baseline na posição do candidato',
    ],
    rows: findingRows,
    empty: 'Nenhum falso positivo.',
    notes: [
      'Fingerprints de baseline de `healing/fingerprints/`, conferidos como idênticos aos do commit da rodada. O siblingIndex do candidato vem do último `:nth-child` do seletor registrado (base 0). A última coluna é o fingerprint da mesma página com o mesmo pai, a mesma profundidade e o siblingIndex do candidato.',
    ],
  });
  if (findingText.length > 0) {
    summary.push('## 5a. Achado: falso positivo com corroboração por texto indisponível', '', ...findingText, '');
  }

  // 7. Overhead da recuperação -------------------------------------------------
  const passiveRows: Cell[][] = [];
  const passiveDiffs: number[] = [];
  for (const id of entryOrder) {
    const on = kept(execs(id, 'healing-on'));
    const off = kept(execs(id, 'healing-off'));
    for (const testId of testsOf(on)) {
      const tOn = on.filter((e) => e.testId === testId);
      const tOff = off.filter((e) => e.testId === testId);
      if (tOff.length === 0 || tOn.some((e) => e.log.length > 0) || ![...tOn, ...tOff].every((e) => e.passed)) {
        continue;
      }
      const mOn = quantile(tOn.map((e) => e.durationMs), 0.5);
      const mOff = quantile(tOff.map((e) => e.durationMs), 0.5);
      passiveDiffs.push(mOn - mOff);
      passiveRows.push([id, testId, n(tOn.length), n(mOn, 1), n(tOff.length), n(mOff, 1), n(mOn - mOff, 1)]);
    }
  }
  const passive = summarize(passiveDiffs);
  const recoveryLog = main.executions.flatMap((e) => e.log);
  const stat = (values: number[]) => (values.length > 0 ? summarize(values) : null);
  const statRow = (label: string, s: Summary | null, kind: string): Cell[] =>
    s ? [label, kind, n(s.n), n(s.median, 1), n(s.min, 1), n(s.max, 1)] : [label, kind, n(0), null, null, null];
  addTable(out, {
    name: '14-overhead-passivo-pares',
    title: 'Custo passivo: pares (entrada, teste) sem acionamento do mecanismo e com o teste passando nas duas condições',
    rule: `${RULE.recoveryOverhead}; mediana e intervalo mínimo–máximo, ${RULE.interval}`,
    headers: ['entrada', 'teste', 'execuções ligada', 'mediana ligada (ms)', 'execuções desligada', 'mediana desligada (ms)', 'diferença (ms)'],
    rows: passiveRows,
    notes: [`Diferença de cada par: mediana das durações da condição ligada menos a da desligada (com N = 1, a própria duração). Escolha de cálculo registrada depois dos dados, ${RULE.postData}.`],
  });
  const perDecision = (d: 'replace' | 'fail') => stat(recoveryLog.filter((e) => e.decision === d).map((e) => e.timings.recoveryMs));
  addTable(out, {
    name: '15-overhead-recuperacao',
    title: 'Overhead da recuperação: custo passivo e custo ativo (recoveryMs)',
    rule: `${RULE.recoveryOverhead}; mediana e intervalo mínimo–máximo, ${RULE.interval}`,
    headers: ['medida', 'tipo', 'n', 'mediana (ms)', 'mínimo (ms)', 'máximo (ms)'],
    rows: [
      statRow('custo passivo: diferença de duração por par (ligada − desligada)', passive, 'principal'),
      statRow('custo ativo: recoveryMs, todas as tentativas', stat(recoveryLog.map((e) => e.timings.recoveryMs)), 'principal'),
      statRow('recoveryMs, decisão replace', perDecision('replace'), 'descritivo'),
      statRow('recoveryMs, decisão fail', perDecision('fail'), 'descritivo'),
      statRow('detectionWaitMs (início da ação até a exceção)', stat(recoveryLog.map((e) => e.timings.detectionWaitMs)), 'descritivo'),
      statRow('actionMs (ação com o candidato, só replace)', stat(recoveryLog.flatMap((e) => (e.timings.actionMs === null ? [] : [e.timings.actionMs]))), 'descritivo'),
    ],
    notes: [
      `Pares elegíveis para o custo passivo: ${passive.n}. A diferença de duração nos testes quebrados não entra, porque mede o timeout e não o mecanismo.`,
      'As linhas "descritivo" não são medidas definidas na regra; vêm do mesmo log e ficam como contexto.',
    ],
  });
  const activeByEntry: Cell[][] = [];
  for (const id of entryOrder) {
    const log = execs(id, 'healing-on').flatMap((e) => e.log);
    if (log.length > 0) {
      const s = summarize(log.map((e) => e.timings.recoveryMs));
      activeByEntry.push([id, n(s.n), n(s.median, 1), n(s.min, 1), n(s.max, 1)]);
    }
  }
  addTable(out, {
    name: '16-overhead-recuperacao-por-entrada',
    title: 'recoveryMs por entrada',
    rule: `${RULE.recoveryOverhead}; ${RULE.interval}`,
    headers: ['entrada', 'tentativas', 'mediana (ms)', 'mínimo (ms)', 'máximo (ms)'],
    rows: activeByEntry,
  });
  const active = summarize(recoveryLog.map((e) => e.timings.recoveryMs));
  summary.push(
    '## 6. Overhead da recuperação',
    '',
    `- **Custo passivo:** mediana de ${br(passive.median, 1)} ms por teste (mínimo ${br(passive.min, 1)}, máximo ${br(passive.max, 1)}), em ${passive.n} pares (entrada, teste) sem acionamento e com o teste passando nas duas condições (${RULE.recoveryOverhead}; intervalo mínimo–máximo, ${RULE.interval}; diferença de medianas por par, ${RULE.postData}). ${link('15-overhead-recuperacao')} · ${link('14-overhead-passivo-pares')}`,
    `- **Custo ativo:** recoveryMs com mediana de ${br(active.median, 1)} ms (mínimo ${br(active.min, 1)}, máximo ${br(active.max, 1)}), em ${active.n} tentativas (${RULE.recoveryOverhead}). ${link('16-overhead-recuperacao-por-entrada')}`,
    '',
  );

  // 8. Overhead da captura -------------------------------------------------------
  const capture = analyzeCapture(path.join(ROOT, CAPTURE_RUN));
  const capRow = (label: string, s: Summary | null, ratio: number | null, verdictText: string | null): Cell[] =>
    s ? [label, n(s.n), n(s.median, 3), n(s.q1, 3), n(s.q3, 3), ratio === null ? null : n(ratio * 100, 2), verdictText ?? (ratio === null ? null : 'intervalo interquartil não contém o zero')] : [label, n(0), null, null, null, null, null];
  addTable(out, {
    name: '17-overhead-captura',
    title: 'Custo da captura de fingerprint (medição complementar)',
    rule: `${RULE.captureOverhead}, cálculo pela análise versionada antes dos dados (\`experiments/overheadAnalysis.mts\`)`,
    headers: ['métrica', 'n', 'mediana (ms)', 'Q1 (ms)', 'Q3 (ms)', 'razão (%)', 'regra de relato'],
    rows: [
      capRow('1. extração, por chamada', capture.directCost.extractMs, null, null),
      capRow('1. gravação, por chamada', capture.directCost.persistMs, null, null),
      capRow('1. extração + gravação, por execução de teste', capture.directCost.perTestExecutionMs, null, null),
      capRow('2. duração por teste: diferença pareada das medianas (ligada − desligada)', capture.perTest?.diffMs ?? null, capture.perTest?.ratio ?? null, capture.perTest?.verdict ?? null),
      capRow('3. tempo total da execução da suíte: diferença por par (ligada − desligada)', capture.perExecution?.diffMs ?? null, capture.perExecution?.ratio ?? null, capture.perExecution?.verdict ?? null),
    ],
    notes: [
      `Pares completos: ${capture.pairs.complete.length} (${capture.pairs.complete.join(', ')}). Pares excluídos por lado não medido: ${capture.pairs.excluded.length > 0 ? capture.pairs.excluded.join(', ') : 'nenhum'}. Aquecimento fora de todas as métricas.`,
      `Extrações sem fingerprint: ${capture.directCost.extractionsWithoutFingerprint}.`,
      `4. Fingerprints versionados: ${capture.fingerprintBytes.files} arquivos, ${capture.fingerprintBytes.total} bytes no total; mínimo ${capture.fingerprintBytes.min}, mediana ${fixed(capture.fingerprintBytes.median, 1).replace('.', ',')}, máximo ${capture.fingerprintBytes.max} bytes.`,
      'Quartis por interpolação linear (tipo 7 de Hyndman e Fan). Razão: mediana das diferenças dividida pela mediana sem captura.',
    ],
  });
  addTable(out, {
    name: '18-overhead-captura-anomalias',
    title: 'Medição da captura: verificações que falharam e testes que não passaram (nenhum é excluído)',
    rule: RULE.captureOverhead,
    headers: ['tipo', 'detalhe'],
    rows: [
      ...capture.anomalies.failedVerifications.map((v): Cell[] => ['verificação da captura falhou', v]),
      ...capture.anomalies.testsNotPassed.map((t): Cell[] => ['teste não passou', t]),
    ],
    empty: 'Nenhuma verificação falhou e todos os testes passaram.',
  });
  const capVerdict = (label: string, verdictText: string | null | undefined, s: Summary | undefined, ratio: number | undefined) =>
    s
      ? `- ${label}: diferença mediana de ${br(s.median, 1)} ms (Q1 ${br(s.q1, 1)}, Q3 ${br(s.q3, 1)}; razão ${br((ratio ?? 0) * 100, 2)} %). ${verdictText ? `**Resultado: ${verdictText}**, acompanhado do custo direto acima` : 'O intervalo interquartil não contém o zero'} (${RULE.captureOverhead}).`
      : `- ${label}: sem pares completos.`;
  const d = capture.directCost;
  summary.push(
    '## 7. Overhead da captura (medição complementar)',
    '',
    `- **Custo direto** (${RULE.captureOverhead}): extração com mediana de ${br(d.extractMs!.median, 2)} ms por chamada (Q1 ${br(d.extractMs!.q1, 2)}, Q3 ${br(d.extractMs!.q3, 2)}; n = ${d.extractMs!.n}); gravação com mediana de ${br(d.persistMs!.median, 2)} ms (Q1 ${br(d.persistMs!.q1, 2)}, Q3 ${br(d.persistMs!.q3, 2)}; n = ${d.persistMs!.n}); total por execução de teste com mediana de ${br(d.perTestExecutionMs!.median, 2)} ms (Q1 ${br(d.perTestExecutionMs!.q1, 2)}, Q3 ${br(d.perTestExecutionMs!.q3, 2)}). ${link('17-overhead-captura')}`,
    capVerdict('Duração por teste (66 diferenças pareadas)', capture.perTest?.verdict, capture.perTest?.diffMs, capture.perTest?.ratio),
    capVerdict(`Tempo total da suíte (${capture.pairs.complete.length} pares)`, capture.perExecution?.verdict, capture.perExecution?.diffMs, capture.perExecution?.ratio),
    `- Fingerprints versionados: ${capture.fingerprintBytes.files} arquivos, ${capture.fingerprintBytes.total} bytes (${RULE.captureOverhead}).`,
    `- Pares completos: ${capture.pairs.complete.length}; excluídos: ${capture.pairs.excluded.length}. Testes que não passaram (mantidos, sem exclusão): ${capture.anomalies.testsNotPassed.length}; verificações que falharam: ${capture.anomalies.failedVerifications.length}. ${link('18-overhead-captura-anomalias')}`,
    '',
  );

  // 9. Sensibilidade do limiar (secundária e aproximada) --------------------------
  const sensRows: Cell[][] = [];
  const sensSeries: Array<{ t: number; rec: number; ind: number; fp: number }> = [];
  for (const t of SENSITIVITY_GRID) {
    let rec = 0;
    let ind = 0;
    let wrong = 0;
    for (const id of recoveryIds) {
      const classes = onKept(id).map((e) => classifyCosmeticAt(e.log, e.passed, t));
      const outcome = aggregateRecoveryAt(classes);
      rec += outcome === 'recuperada' ? 1 : 0;
      ind += outcome === 'indeterminada' ? 1 : 0;
      wrong += classes.includes('cura incorreta') ? 1 : 0;
    }
    const fpAt = fpIds.filter((id) => onKept(id).some((e) => e.log.some((entry) => decisionAt(entry.score, t) === 'replace')));
    const targetsAt = new Set(fpAt.map((id) => matrixById.get(id)!.target.split('-')[0]));
    const t1At = fpAt.filter((id) => t1.includes(id)).length;
    sensSeries.push({ t, rec, ind, fp: fpAt.length });
    sensRows.push([n(t, 2), t === MAIN_THRESHOLD ? 'principal' : '', frac(rec, recoveryIds.length), n(ind), n(wrong), frac(fpAt.length, fpIds.length), frac(targetsAt.size, byTarget.size), `${t1At} de ${t1.length}`]);
  }
  addTable(out, {
    name: '19-sensibilidade-limiar',
    title: 'Análise de sensibilidade do limiar — SECUNDÁRIA E APROXIMADA',
    rule: `${RULE.sensitivity}; limiar inclusivo, ${RULE.threshold}`,
    headers: ['limiar', '', 'recuperadas', 'indeterminadas', 'entradas com cura incorreta', 'falso positivo bruto', 'falso positivo por alvo', 'T1 (categorias)'],
    rows: sensRows,
    notes: [
      'Recalculada offline a partir do score registrado em cada entrada de log (rawScore × fatores), sem nenhuma execução nova. É aproximada: o log só tem o caminho que o limiar 0,7 produziu, e uma substituição diferente mudaria o resto do teste.',
      '"Indeterminada": alguma execução passaria de fail para replace no elemento certo, e o desfecho do teste nesse caminho não foi observado. Nenhuma execução indeterminada conta como sucesso.',
      `Grade fixa de 0,00 a 1,00, de 0,05 em 0,05, registrada depois dos dados (${RULE.postData}). Os scores exatos de cada entrada estão em 20-scores-por-entrada.`,
    ],
  });
  const scoreRows: Cell[][] = [];
  const scoreChart: Array<{ id: string; set: 'recuperação' | 'falso positivo'; scores: number[]; nulls: number }> = [];
  for (const id of [...recoveryIds, ...fpIds]) {
    const log = onKept(id).flatMap((e) => e.log);
    const set = recoveryIds.includes(id) ? 'recuperação' : 'falso positivo';
    const scores = log.flatMap((e) => (e.score === null ? [] : [e.score]));
    scoreChart.push({ id, set, scores: [...new Set(scores)].sort((a, b) => a - b), nulls: log.length - scores.length });
    scoreRows.push([
      id, set, n(log.length), scoreCell(log),
      scores.length > 0 ? n(Math.min(...scores), 3) : null, scores.length > 0 ? n(Math.max(...scores), 3) : null,
      [...new Set(log.flatMap((e) => e.flags))].sort().join('; '),
      [...new Set(log.flatMap((e) => (e.reason === null ? [] : [e.reason])))].sort().join('; '),
    ]);
  }
  addTable(out, {
    name: '20-scores-por-entrada',
    title: 'Scores registrados por entrada dos denominadores',
    rule: `${RULE.sensitivity}; limiar ${RULE.threshold}`,
    headers: ['entrada', 'conjunto', 'entradas de log', 'scores distintos', 'mínimo', 'máximo', 'flags', 'motivo sem score'],
    rows: scoreRows,
  });
  const at = (t: number) => sensSeries.find((s) => s.t === t)!;
  summary.push(
    '## 8. Sensibilidade do limiar (secundária e aproximada)',
    '',
    `- Recalculada offline a partir dos scores registrados; **secundária e aproximada** (${RULE.sensitivity}; grade de 0,05, ${RULE.postData}). No limiar principal, ${br(MAIN_THRESHOLD, 1)}: recuperadas ${frac(at(MAIN_THRESHOLD).rec, recoveryIds.length)}, falso positivo bruto ${frac(at(MAIN_THRESHOLD).fp, fpIds.length)}. ${link('19-sensibilidade-limiar')} · ${link('20-scores-por-entrada')}`,
    `- Em 0,65: recuperadas ${frac(at(0.65).rec, recoveryIds.length)} (indeterminadas ${at(0.65).ind}), falso positivo ${frac(at(0.65).fp, fpIds.length)}. Em 0,75: recuperadas ${frac(at(0.75).rec, recoveryIds.length)}, falso positivo ${frac(at(0.75).fp, fpIds.length)}.`,
    '',
  );

  // Ablação do score (secundária, aproximada e posterior aos dados) ---------------
  const ablationRules: AblationRules = {
    decisionAt,
    classifyCosmetic,
    classifyCosmeticAt,
    aggregateRecovery,
    aggregateRecoveryAt,
    classifyDefect,
    aggregateFalsePositive,
  };
  const ablationLog = main.executions.filter((e) => e.condition === 'healing-on').flatMap((e) => e.log);
  const logChecks = checkLog(ablationLog);
  const ablationInputs: AblationInput[] = [...recoveryIds, ...fpIds].map((id) => ({
    id,
    target: matrixById.get(id)!.target,
    set: recoveryIds.includes(id) ? 'recuperação' : 'falso positivo',
    executions: onKept(id),
  }));
  const reproduction = reproductionProblems(ablationInputs, MAIN_THRESHOLD, ablationRules);
  const ablated: EntryAblation[] = ABLATION_CONFIGS.flatMap((c) => ablationInputs.map((input) => ablateEntry(input, c.id, MAIN_THRESHOLD, ablationRules)));
  const configSummaries = ABLATION_CONFIGS.map((c) => summarizeConfig(c.id, ablated));
  const full = configSummaries.find((s) => s.config === 'iii')!;
  // [o que se compara, configuração (iii), resultado principal]
  const fractionMismatch = [
    ['recuperadas', full.recovery.recovered, recovered],
    ['indeterminadas', full.recovery.indeterminate, 0],
    ['entradas com cura incorreta', full.recovery.wrongCure, categoryRows.filter((r) => r[0] === 'cura incorreta').length],
    ['recuperação não acionada', full.recovery.notTriggered.join(', '), recoveryNotTriggered.join(', ')],
    ['falso positivo', full.falsePositive.count, fpCount],
    ['falso positivo não acionado', full.falsePositive.notTriggered.join(', '), fpNotTriggered.join(', ')],
    ['alvos com falso positivo', full.byTarget.fp, fpTargets],
    ['alvos não acionados', full.byTarget.idle, fpTargetsIdle],
    ['T1 com falso positivo', full.byTarget.t1.fp, t1Fp],
  ].filter(([, got, want]) => String(got) !== String(want));
  const failedChecks = logChecks.filter((c) => c.failures.length > 0);
  if (reproduction.length > 0 || failedChecks.length > 0 || fractionMismatch.length > 0) {
    throw new Error(
      `verificação da ablação falhou, análise interrompida (${RULE.ablation}):\n${[
        ...reproduction.map((p) => `(iii) não reproduz o resultado principal: ${p}`),
        ...fractionMismatch.map(([what, got, want]) => `(iii) não reproduz o resultado principal: ${what} ${got}, principal ${want}`),
        ...failedChecks.flatMap((c) => c.failures.map((f) => `${c.name}: ${f}`)),
      ].join('\n')}`,
    );
  }
  const sideFrac = (k: number, total: number, idle: number) => (idle > 0 ? frac(k, total - idle) : 'igual');
  addTable(out, {
    name: '23-ablacao-score',
    title: `Ablação do score de confiança, limiar ${br(MAIN_THRESHOLD, 1)} — SECUNDÁRIA, APROXIMADA E POSTERIOR AOS DADOS`,
    rule: `${RULE.ablation}; classes e agregação, ${RULE.classes}; denominador da matriz, ${RULE.applied}; não acionado, ${RULE.postData}; indeterminada como na sensibilidade, ${RULE.sensitivity}`,
    headers: [
      'configuração', 'recuperadas', 'ao lado, sem não acionadas', 'indeterminadas', 'entradas com cura incorreta',
      'falso positivo bruto', 'ao lado, sem não acionadas', 'falso positivo por alvo', 'ao lado, sem alvos não acionados', 'T1 (categorias)', 'entradas com falso positivo',
    ],
    rows: configSummaries.map((s) => [
      ABLATION_CONFIGS.find((c) => c.id === s.config)!.label,
      frac(s.recovery.recovered, s.recovery.total),
      sideFrac(s.recovery.recovered, s.recovery.total, s.recovery.notTriggered.length),
      n(s.recovery.indeterminate),
      n(s.recovery.wrongCure),
      frac(s.falsePositive.count, s.falsePositive.total),
      sideFrac(s.falsePositive.count, s.falsePositive.total, s.falsePositive.notTriggered.length),
      frac(s.byTarget.fp, s.byTarget.total),
      sideFrac(s.byTarget.fp, s.byTarget.total, s.byTarget.idle),
      `${s.byTarget.t1.fp} de ${s.byTarget.t1.total}`,
      s.falsePositive.ids.join('; ') || 'nenhuma',
    ]),
    notes: [
      'Recalculada offline a partir do log (rawScore e fatores), sem nenhuma execução nova. O candidato é o mesmo nas três configurações; só a decisão muda. É aproximada: o log só tem o caminho que o score completo produziu, e uma substituição diferente mudaria o resto do teste.',
      '"Indeterminada": alguma execução passaria de fail para replace no elemento certo, e o desfecho do teste nesse caminho não foi observado. Nenhuma execução indeterminada conta como sucesso, e uma entrada indeterminada não conta como recuperada.',
      `"Ao lado": a fração sem as entradas (ou alvos) não acionadas, que não dependem da configuração (${RULE.postData}).`,
      `Verificações, todas obrigatórias (${RULE.ablation}): (1) a configuração (iii) reproduz as classes de cada execução, o desfecho de cada uma das ${ablationInputs.length} entradas e as frações do resultado principal: sim. ` +
        logChecks.map((c, i) => `(${i + 2}) ${c.name}: ${frac(c.checked - c.failures.length, c.checked)} eventos do log`).join('; ') +
        '. Tolerância numérica absoluta de 1e-9.',
    ],
  });
  const decisionCell = (r: EntryAblation) => (r.decisions.length > 0 ? counts(r.decisions) : 'mecanismo não acionado');
  addTable(out, {
    name: '24-ablacao-por-entrada',
    title: `Ablação do score por entrada dos denominadores, limiar ${br(MAIN_THRESHOLD, 1)} — SECUNDÁRIA, APROXIMADA E POSTERIOR AOS DADOS`,
    rule: `${RULE.ablation}; classes e agregação, ${RULE.classes}`,
    headers: [
      'entrada', 'conjunto', 'entradas de log',
      ...ABLATION_CONFIGS.flatMap((c) => [`score (${c.id})`, `decisão (${c.id}, entradas de log)`, `desfecho (${c.id})`]),
    ],
    rows: ablationInputs.map((input) => {
      const per = ABLATION_CONFIGS.map((c) => ablated.find((r) => r.id === input.id && r.config === c.id)!);
      const logCount = input.executions.flatMap((e) => e.log).length;
      return [
        input.id, input.set, n(logCount),
        ...per.flatMap((r) => [logCount > 0 ? ({ list: r.scores, d: 3 } as Cell) : 'sem entrada de log', decisionCell(r), r.outcome]),
      ];
    }),
    notes: [
      'Configurações: (i) rawScore, a saída bruta da heurística estrutural; (ii) rawScore × fator de ambiguidade; (iii) score completo, o registrado.',
      'Score: valores distintos da configuração nas entradas de log da entrada. Decisão: contagem das decisões que a configuração dá às entradas de log, com o limiar inclusivo.',
    ],
  });
  const configLine = (s: (typeof configSummaries)[number]) => {
    const label = ABLATION_CONFIGS.find((c) => c.id === s.config)!.label;
    const recSide = s.recovery.notTriggered.length > 0 ? ` (${frac(s.recovery.recovered, s.recovery.total - s.recovery.notTriggered.length)} sem ${s.recovery.notTriggered.join(', ')})` : '';
    const fpSideText = s.falsePositive.notTriggered.length > 0 ? ` (${frac(s.falsePositive.count, s.falsePositive.total - s.falsePositive.notTriggered.length)} sem ${s.falsePositive.notTriggered.join(', ')})` : '';
    return (
      `- **${label}:** recuperadas ${frac(s.recovery.recovered, s.recovery.total)}${recSide}, indeterminadas ${s.recovery.indeterminate}, com cura incorreta ${s.recovery.wrongCure}; ` +
      `falso positivo bruto ${frac(s.falsePositive.count, s.falsePositive.total)}${fpSideText}${s.falsePositive.ids.length > 0 ? ` (${s.falsePositive.ids.join(', ')})` : ''}; ` +
      `por alvo ${frac(s.byTarget.fp, s.byTarget.total)}; T1: ${s.byTarget.t1.fp} de ${s.byTarget.t1.total} categorias.`
    );
  };
  summary.push(
    '## 9. Ablação do score (secundária, aproximada e posterior aos dados)',
    '',
    `- Recalculada offline a partir do log, com o limiar principal de ${br(MAIN_THRESHOLD, 1)}; o candidato é o mesmo nas três configurações e só a decisão muda. Especificação vinda do texto da monografia e script escritos depois dos dados (${RULE.ablation}); classes e agregação do ${RULE.classes}, denominador da matriz (${RULE.applied}) e "não acionado" (${RULE.postData}). Execução que passaria de fail para replace no elemento certo fica indeterminada, nunca sucesso (${RULE.sensitivity}). ${link('23-ablacao-score')} · ${link('24-ablacao-por-entrada')}`,
    ...configSummaries.map(configLine),
    `- Verificações: a configuração (iii) reproduz o resultado principal; ${logChecks.map((c) => `${c.name} em ${frac(c.checked - c.failures.length, c.checked)} eventos`).join('; ')}.`,
    '',
  );

  // 10. Previsões registradas contra o observado ----------------------------------
  const classesOf = (id: string) => {
    const row = matrixById.get(id)!;
    return onKept(id).map((e) => (row.class === 'cosmetic' ? classifyCosmetic(e.log, e.passed) : classifyDefect(e.log)));
  };
  const all = (id: string, cls: string) => classesOf(id).every((c) => c === cls);
  const maxScore = (id: string) => Math.max(...onKept(id).flatMap((e) => e.log.flatMap((x) => (x.score === null ? [] : [x.score]))));
  const observed = (id: string) => {
    const log = onKept(id).flatMap((e) => e.log);
    return `${counts(classesOf(id) as string[])}${log.length > 0 ? `; score ${scoreText(log)}` : ''}`;
  };
  interface Prediction {
    source: string;
    entries: string;
    predicted: string;
    observed: string;
    holds: boolean;
  }
  const predictions: Prediction[] = [];
  const predict = (source: string, entries: string, predicted: string, observedText: string, holds: boolean) =>
    predictions.push({ source, entries, predicted, observed: observedText, holds });
  for (const id of ['M1-T8', 'M1-T9']) {
    predict('ADR-020 (tabela); ADR-016 (1,00 sob reescrita de class/id)', id, 'recuperar, score 1,00', observed(id), all(id, 'sucesso') && maxScore(id) === 1);
  }
  predict('ADR-019; ADR-020 (tabela)', 'M1-T10', 'recupera o elemento, mas o teste falha (elemento certo, teste falha)', observed('M1-T10'), all('M1-T10', 'elemento certo, teste falha'));
  predict('ADR-018; ADR-020 (tabela)', 'M2-T1-travel_2-relabel', 'falhar: teto de 0,50 (falso negativo por construção)', observed('M2-T1-travel_2-relabel'), all('M2-T1-travel_2-relabel', 'fail') && maxScore('M2-T1-travel_2-relabel') <= 0.5);
  predict('ADR-018; ADR-020 (tabela)', 'M2-T1-sequential-art_5-append-token', 'recuperar por ~0,008 acima do limiar, se a estrutural der ≥ ~0,988', observed('M2-T1-sequential-art_5-append-token'), all('M2-T1-sequential-art_5-append-token', 'sucesso'));
  predict('ADR-020 (tabela, coluna "mecanismo atual")', 'M2-T4-relabel', 'falhar: teto de 0,50', observed('M2-T4-relabel'), all('M2-T4-relabel', 'fail'));
  predict('ADR-020 (observação de previsão); ADR-027 (detecção por exceção)', 'M2-T4-relabel; M5-T4', 'hasNextPage() usa isVisible(), que não lança exceção: a detecção por exceção não é acionada', `M2-T4-relabel: ${observed('M2-T4-relabel')}; M5-T4: ${observed('M5-T4')}`, all('M2-T4-relabel', 'não acionado') && all('M5-T4', 'não acionado'));
  const t1Ids = fpIds.filter((id) => t1.includes(id));
  predict('ADR-020 (tabela)', 'M5 × T1 (16)', 'falhar', `${t1Ids.filter((id) => all(id, 'fail')).length} de ${t1Ids.length} entradas com fail em todas`, t1Ids.every((id) => all(id, 'fail')));
  predict('ADR-020 (tabela)', 'M5-T3', 'risco de falso positivo; depende da corroboração por texto', observed('M5-T3'), !classesOf('M5-T3').includes('replace'));
  for (const id of ['M5-T4', 'M5-T5', 'M5-T6', 'M5-T7', 'M5-T8', 'M5-T9', 'M5-T10']) {
    predict('ADR-020 (tabela: M5 × T4–T10)', id, 'falhar', observed(id), all(id, 'fail'));
  }
  for (const id of deviateIds) {
    const on = onKept(id);
    const holds = on.every((e) => e.log.length === 0 && e.passed);
    const off = testsOf(on).filter((testId) => !on.filter((e) => e.testId === testId).every((e) => e.log.length === 0 && e.passed));
    predict(
      'ADR-020 (tabela)',
      id,
      'não acionado; o teste passa sobre o elemento errado',
      `${frac(on.filter((e) => e.log.length === 0).length, on.length)} sem acionamento; ${frac(on.filter((e) => e.passed).length, on.length)} passaram` +
        (off.length > 0 ? `; fora disso em ${off.length} testes (${off.join('; ')})` : ''),
      holds,
    );
  }
  const crimeNav = reproducedTestId('category-navigation › Crime');
  const m5t2Crime = onKept('M5-T2').filter((e) => e.testId === crimeNav);
  const m5t2CrimeOff = kept(execs('M5-T2', 'healing-off')).filter((e) => e.testId === crimeNav);
  predict(
    'ADR-020 (observação de previsão)',
    'M5-T2, navegação para Crime',
    'a mutação zera a listagem de Crime e getProductCount() > 0 falha nesse teste',
    `teste falhou em ${frac(m5t2CrimeOff.filter((e) => !e.passed).length, m5t2CrimeOff.length)} (desligada) e ${frac(m5t2Crime.filter((e) => !e.passed).length, m5t2Crime.length)} (ligada)`,
    [...m5t2Crime, ...m5t2CrimeOff].every((e) => !e.passed),
  );
  predict(
    'ADR-020 (tabela: M1 × T1–T7, M2 × T3, M3 inertes, M4); ADR-026',
    `${inertIds.length} entradas inertes`,
    'não acionado e teste passando',
    `${inertIds.filter((id) => onKept(id).every((e) => e.log.length === 0 && e.passed)).length} de ${inertIds.length} entradas sem acionamento e com todos os testes passando`,
    inertIds.every((id) => onKept(id).every((e) => e.log.length === 0 && e.passed)),
  );
  predict('ADR-020 (denominadores)', 'matriz', '6 de recuperação e 24 de falso positivo', `${recoveryIds.length} e ${fpIds.length}`, recoveryIds.length === 6 && fpIds.length === 24);
  addTable(out, {
    name: '21-previsoes',
    title: 'Previsões registradas contra o observado na rodada principal',
    rule: 'ADR-016, ADR-018, ADR-019, ADR-020, ADR-026 e ADR-027; classes do observado pelo ADR-025',
    headers: ['fonte', 'entradas', 'previsto', 'observado (condição ligada)', 'situação'],
    rows: predictions.map((p) => [p.source, p.entries, p.predicted, p.observed, p.holds ? 'confirmada' : 'DIVERGENTE']),
    notes: [
      'O observado usa as classes por execução: sucesso, elemento certo, teste falha, cura incorreta, fail e não acionado nas cosméticas; replace, fail e não acionado no M5.',
      'A tabela de previsão do ADR-020 e a observação de previsão do mesmo ADR dizem coisas diferentes sobre o T4; as duas aparecem aqui, cada uma com a sua situação.',
    ],
  });
  for (const p of predictions.filter((x) => !x.holds)) {
    divergences.push(`Previsão divergente — ${p.source}, ${p.entries}: previsto "${p.predicted}"; observado: ${p.observed}.`);
  }

  // Gráficos ------------------------------------------------------------------------
  out.files.set('graficos/sensibilidade-limiar.svg', sensitivityChart(sensSeries, recoveryIds.length, fpIds.length));
  out.files.set('graficos/scores-por-entrada.svg', scoresChart(scoreChart));
  out.files.set('graficos/overhead-passivo.svg', passiveChart(passiveDiffs, passive.median));
  out.files.set('graficos/overhead-captura-pares.svg', capturePairsChart(captureInvocations, capture.pairs.complete));

  // Resumo -----------------------------------------------------------------------------
  const head = [
    '# Resumo da análise dos resultados',
    '',
    'Gerado por `node experiments/resultsAnalysis.mts` a partir de `experiments/results/`; não editar à mão. Rodar de novo produz arquivos idênticos (`--check` confere).',
    '',
    `- Rodada principal: \`${MAIN_RUN}\`, commit \`${main.commit.slice(0, 7)}\`.`,
    `- Medição complementar da captura: \`${CAPTURE_RUN}\`, commit \`${capturePlan.git.commit.slice(0, 7)}\`.`,
    `- Limiar principal: ${br(MAIN_THRESHOLD, 1)}, inclusivo (${RULE.threshold}; fixo na rodada pelo ${RULE.sensitivity}).`,
    '',
    '## Divergências e lacunas',
    '',
    ...(divergences.length > 0 ? divergences.map((line) => `- ${line}`) : ['- Nenhuma.']),
    `- Tabela completa das previsões: ${link('21-previsoes')}`,
    '',
  ];
  const charts = [
    '## Gráficos',
    '',
    '- [graficos/scores-por-entrada.svg](graficos/scores-por-entrada.svg): scores registrados por entrada, com o limiar principal.',
    '- [graficos/sensibilidade-limiar.svg](graficos/sensibilidade-limiar.svg): recuperadas e falsos positivos por limiar (secundária e aproximada).',
    '- [graficos/overhead-passivo.svg](graficos/overhead-passivo.svg): distribuição do custo passivo por par.',
    '- [graficos/overhead-captura-pares.svg](graficos/overhead-captura-pares.svg): tempo total da suíte em cada par da medição da captura.',
    '',
  ];
  out.files.set('RESUMO.md', [...head, ...summary, ...charts].join('\n'));
  return out.files;
}

// ---------------------------------------------------------------------------
// Gráficos

function sensitivityChart(series: Array<{ t: number; rec: number; ind: number; fp: number }>, recN: number, fpN: number): string {
  const body: string[] = [`<text class="t" x="16" y="24">Sensibilidade do limiar (secundária e aproximada)</text>`];
  const panels: Array<{ title: string; key: 'rec' | 'fp'; max: number; cls: string; x: number }> = [
    { title: `Entradas recuperadas (de ${recN})`, key: 'rec', max: recN, cls: 's1', x: 56 },
    { title: `Falsos positivos brutos (de ${fpN})`, key: 'fp', max: fpN, cls: 's2', x: 396 },
  ];
  for (const panel of panels) {
    const p: Panel = { x: panel.x, y: 64, w: 260, h: 180, xMin: 0, xMax: 1, yMin: 0, yMax: panel.max };
    body.push(`<text class="t2" x="${panel.x}" y="52">${esc(panel.title)}</text>`);
    const yTicks = panel.max <= 6 ? Array.from({ length: panel.max + 1 }, (_, i) => i) : [0, 6, 12, 18, 24].filter((v) => v <= panel.max);
    body.push(...axes(p, [0, 0.25, 0.5, 0.75, 1], yTicks, (v) => br(v, 2), (v) => String(v)));
    body.push(`<line class="ref" x1="${px(sx(p, MAIN_THRESHOLD))}" x2="${px(sx(p, MAIN_THRESHOLD))}" y1="${px(p.y)}" y2="${px(p.y + p.h)}"/>`);
    body.push(`<text class="t2" x="${px(sx(p, MAIN_THRESHOLD) + 4)}" y="${px(p.y + 10)}">0,7</text>`);
    const points = series.map((s) => `${px(sx(p, s.t))},${px(sy(p, s[panel.key]))}`).join(' ');
    body.push(`<polyline class="${panel.cls} ln" points="${points}"/>`);
    for (const s of series) {
      body.push(`<circle class="${panel.cls}" cx="${px(sx(p, s.t))}" cy="${px(sy(p, s[panel.key]))}" r="3"><title>limiar ${br(s.t, 2)}: ${s[panel.key]}${panel.key === 'rec' && s.ind > 0 ? ` (+${s.ind} indeterminadas)` : ''}</title></circle>`);
    }
    body.push(`<text class="t2" x="${px(p.x + p.w / 2)}" y="${px(p.y + p.h + 34)}" text-anchor="middle">limiar</text>`);
  }
  body.push(`<text class="t2" x="16" y="${px(330)}">Indeterminadas não contam como recuperadas. Grade de 0,05.</text>`);
  return svgDoc(680, 344, 'Sensibilidade do limiar', body);
}

function scoresChart(rows: Array<{ id: string; set: string; scores: number[]; nulls: number }>): string {
  const rowH = 18;
  const top = 60;
  const p: Panel = { x: 250, y: top, w: 380, h: rows.length * rowH, xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const body: string[] = [
    `<text class="t" x="16" y="24">Scores registrados por entrada (condição ligada)</text>`,
    `<circle class="s1" cx="250" cy="42" r="5"/><text class="t2" x="260" y="46">recuperação (cosmética)</text>`,
    `<circle class="s2" cx="420" cy="42" r="5"/><text class="t2" x="430" y="46">falso positivo (M5)</text>`,
  ];
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    body.push(`<line class="g" x1="${px(sx(p, v))}" x2="${px(sx(p, v))}" y1="${px(p.y)}" y2="${px(p.y + p.h)}"/>`);
    body.push(`<text class="t2" x="${px(sx(p, v))}" y="${px(p.y + p.h + 16)}" text-anchor="middle">${br(v, 2)}</text>`);
  }
  body.push(`<line class="ref" x1="${px(sx(p, MAIN_THRESHOLD))}" x2="${px(sx(p, MAIN_THRESHOLD))}" y1="${px(p.y - 4)}" y2="${px(p.y + p.h)}"/>`);
  body.push(`<text class="t2" x="${px(sx(p, MAIN_THRESHOLD) + 4)}" y="${px(p.y + p.h + 30)}">limiar 0,7</text>`);
  rows.forEach((row, i) => {
    const cy = top + i * rowH + rowH / 2;
    const cls = row.set === 'recuperação' ? 's1' : 's2';
    body.push(`<text class="t2" x="${px(p.x - 8)}" y="${px(cy + 4)}" text-anchor="end">${esc(row.id)}</text>`);
    if (row.scores.length === 0) {
      body.push(`<text class="t2" x="${px(p.x + 4)}" y="${px(cy + 4)}">${row.nulls > 0 ? 'sem score' : 'sem entrada de log (não acionado)'}</text>`);
    }
    for (const s of row.scores) {
      body.push(`<circle class="${cls}" cx="${px(sx(p, s))}" cy="${px(cy)}" r="4"><title>${esc(row.id)}: ${br(s, 3)}</title></circle>`);
    }
  });
  return svgDoc(660, top + rows.length * rowH + 44, 'Scores por entrada', body);
}

function passiveChart(diffs: number[], median: number): string {
  const bin = 100;
  const lo = Math.floor(Math.min(...diffs) / bin) * bin;
  const hi = Math.max(lo + bin, Math.ceil((Math.max(...diffs) + 1) / bin) * bin);
  const bins = Array.from({ length: Math.round((hi - lo) / bin) }, (_, i) => lo + i * bin);
  const heights = bins.map((b) => diffs.filter((v) => v >= b && v < b + bin).length);
  const maxH = Math.max(...heights);
  const yMax = Math.max(10, Math.ceil(maxH / 10) * 10);
  const p: Panel = { x: 56, y: 56, w: 560, h: 200, xMin: lo, xMax: hi, yMin: 0, yMax };
  const body: string[] = [`<text class="t" x="16" y="24">Custo passivo: diferença de duração por par (ligada − desligada)</text>`, `<text class="t2" x="16" y="42">${diffs.length} pares (entrada, teste); classes de ${bin} ms</text>`];
  const step = Math.max(1, Math.round(bins.length / 8));
  const xTicks = [...bins.filter((_, i) => i % step === 0), hi];
  body.push(...axes(p, xTicks, [0, yMax / 2, yMax], (v) => `${v} ms`, (v) => String(v)));
  bins.forEach((b, i) => {
    if (heights[i] > 0) {
      const x = sx(p, b) + 1;
      const w = sx(p, b + bin) - sx(p, b) - 2;
      body.push(`<rect class="bar" x="${px(x)}" y="${px(sy(p, heights[i]))}" width="${px(w)}" height="${px(sy(p, 0) - sy(p, heights[i]))}" rx="2"><title>${b} a ${b + bin} ms: ${heights[i]} pares</title></rect>`);
    }
  });
  body.push(`<line class="ref" x1="${px(sx(p, median))}" x2="${px(sx(p, median))}" y1="${px(p.y)}" y2="${px(p.y + p.h)}"/>`);
  body.push(`<text class="t2" x="${px(sx(p, median) + 4)}" y="${px(p.y + 10)}">mediana ${br(median, 1)} ms</text>`);
  return svgDoc(660, 290, 'Custo passivo por par', body);
}

function capturePairsChart(invocations: Array<Record<string, unknown>>, pairs: string[]): string {
  const last = new Map<string, Record<string, unknown>>();
  for (const line of invocations) {
    const key = invocationKey(line);
    if (!last.has(key) || Number(last.get(key)!.attempt) < Number(line.attempt)) {
      last.set(key, line);
    }
  }
  const wall = (id: string, condition: string) => Number(last.get(`${id}|${condition}`)!.wallMs) / 1000;
  const values = pairs.flatMap((id) => [wall(id, 'captura-ligada'), wall(id, 'captura-desligada')]);
  const yMin = Math.floor(Math.min(...values) / 10) * 10;
  const yMax = Math.ceil(Math.max(...values) / 10) * 10;
  const p: Panel = { x: 56, y: 60, w: 560, h: 200, xMin: 0.5, xMax: pairs.length + 0.5, yMin, yMax: Math.max(yMax, yMin + 10) };
  const body: string[] = [
    `<text class="t" x="16" y="24">Medição da captura: tempo total da suíte por par (s)</text>`,
    `<circle class="s1" cx="56" cy="42" r="5"/><text class="t2" x="66" y="46">captura ligada</text>`,
    `<circle class="s2" cx="176" cy="42" r="5"/><text class="t2" x="186" y="46">captura desligada</text>`,
  ];
  const ticks = [p.yMin, (p.yMin + p.yMax) / 2, p.yMax];
  body.push(...axes(p, pairs.map((_, i) => i + 1), ticks, (v) => String(v), (v) => br(v, 0)));
  pairs.forEach((id, i) => {
    const x = sx(p, i + 1);
    const on = wall(id, 'captura-ligada');
    const off = wall(id, 'captura-desligada');
    body.push(`<line class="g" x1="${px(x)}" x2="${px(x)}" y1="${px(sy(p, on))}" y2="${px(sy(p, off))}"/>`);
    body.push(`<circle class="s1" cx="${px(x)}" cy="${px(sy(p, on))}" r="4"><title>${id} ligada: ${br(on, 1)} s</title></circle>`);
    body.push(`<circle class="s2" cx="${px(x)}" cy="${px(sy(p, off))}" r="4"><title>${id} desligada: ${br(off, 1)} s</title></circle>`);
  });
  body.push(`<text class="t2" x="${px(p.x + p.w / 2)}" y="${px(p.y + p.h + 34)}" text-anchor="middle">par</text>`);
  return svgDoc(660, 310, 'Tempo total da suíte por par', body);
}

// ---------------------------------------------------------------------------

function listOutput(dir: string): string[] {
  return existsSync(dir) ? listFilesRecursive(dir) : [];
}

if (import.meta.main) {
  const files = buildAnalysis();
  const outDir = path.join(ROOT, OUT_DIR);
  const names = [...files.keys()].sort();
  if (process.argv.includes('--check')) {
    const differing = names.filter((name) => {
      const file = path.join(outDir, name);
      return !existsSync(file) || readFileSync(file, 'utf8') !== files.get(name);
    });
    const extra = listOutput(outDir).filter((name) => !files.has(name));
    if (differing.length + extra.length > 0) {
      console.error(`Diferente do gerado: ${differing.join(', ') || 'nenhum'}; sobrando: ${extra.join(', ') || 'nenhum'}`);
      process.exit(1);
    }
    console.log(`${names.length} arquivos idênticos ao gerado.`);
  } else {
    for (const stale of listOutput(outDir).filter((name) => !files.has(name))) {
      rmSync(path.join(outDir, stale));
    }
    for (const name of names) {
      mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
      writeFileSync(path.join(outDir, name), files.get(name)!, 'utf8');
    }
    console.log(`${names.length} arquivos em ${OUT_DIR}/`);
  }
}
