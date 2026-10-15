/**
 * Plano, preparação e verificação da medição do custo da captura, sem rede nem
 * Playwright. O orquestrador (`overhead.mts`) usa estas funções; os unitários
 * as exercitam sobre diretórios temporários.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunInvocation } from './runState.mts';

export type CaptureCondition = 'captura-ligada' | 'captura-desligada';

export interface OverheadInvocation extends RunInvocation {
  condition: CaptureCondition;
}

export const PAIRS = 10;
export const WARMUP = 'aquecimento';

export function pairId(index: number): string {
  return `par-${String(index).padStart(2, '0')}`;
}

/**
 * Aquecimento com a captura ligada, descartado, e depois os pares. Os pares
 * 1, 3, 5, 7 e 9 começam pela captura desligada; os pares 2, 4, 6, 8 e 10,
 * pela ligada.
 */
export function buildOverheadPlan(tests: string[], pairs = PAIRS): OverheadInvocation[] {
  const invocation = (entryId: string, condition: CaptureCondition): OverheadInvocation => ({
    entryId,
    condition,
    repeatEach: 1,
    tests,
  });
  const plan = [invocation(WARMUP, 'captura-ligada')];
  for (let index = 1; index <= pairs; index += 1) {
    const order: CaptureCondition[] =
      index % 2 === 1 ? ['captura-desligada', 'captura-ligada'] : ['captura-ligada', 'captura-desligada'];
    plan.push(...order.map((condition) => invocation(pairId(index), condition)));
  }
  return plan;
}

/** Fingerprints versionados: caminho relativo a `healing/fingerprints/` (com `/`) → bytes. */
export type Baseline = Map<string, Buffer>;

const BASELINE_PREFIX = 'healing/fingerprints/';

/** Bytes dos fingerprints como estão no objeto do git do commit, não na cópia de trabalho. */
export function loadBaseline(root: string, commit: string): Baseline {
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', commit, '--', BASELINE_PREFIX], {
    cwd: root,
    encoding: 'utf8',
  });
  const names = listed.stdout.split('\n').filter((name) => name.endsWith('.json'));
  // Um processo só: cada objeto sai como "<sha> blob <tamanho>\n<bytes>\n".
  const batch = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: names.map((name) => `${commit}:${name}\n`).join(''),
    maxBuffer: 1 << 26,
  });
  if (batch.status !== 0) {
    throw new Error(`git cat-file falhou no commit ${commit}`);
  }
  const out = batch.stdout;
  const baseline: Baseline = new Map();
  let offset = 0;
  for (const name of names) {
    const headerEnd = out.indexOf(0x0a, offset);
    const header = out.subarray(offset, headerEnd).toString('utf8').split(' ');
    if (header[1] !== 'blob') {
      throw new Error(`não leu ${name} do commit ${commit}: ${header.join(' ')}`);
    }
    const size = Number(header[2]);
    baseline.set(name.slice(BASELINE_PREFIX.length), Buffer.from(out.subarray(headerEnd + 1, headerEnd + 1 + size)));
    offset = headerEnd + 1 + size + 1;
  }
  return baseline;
}

/** Arquivos sob um diretório, com caminho relativo e separador `/`, em ordem. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .map((name) => name.replace(/\\/g, '/'))
    .sort();
}

/** Preenche o diretório de captura com os fingerprints versionados. */
export function prefill(dir: string, baseline: Baseline): void {
  for (const [name, bytes] of baseline) {
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

export interface CaptureVerification {
  ok: boolean;
  files: number;
  missing: string[];
  extra: string[];
  different: string[];
  /** Arquivos com data de modificação anterior ao início da tentativa: a captura não os regravou. */
  notRewritten: string[];
}

/**
 * Captura ligada: exatamente os arquivos versionados, idênticos byte a byte e
 * todos regravados depois de `startMs`. Captura desligada: diretório vazio.
 */
export function verifyCapture(dir: string, condition: CaptureCondition, baseline: Baseline, startMs: number): CaptureVerification {
  const actual = listFiles(dir);
  if (condition === 'captura-desligada') {
    return { ok: actual.length === 0, files: actual.length, missing: [], extra: actual, different: [], notRewritten: [] };
  }
  const present = new Set(actual);
  const missing = [...baseline.keys()].filter((name) => !present.has(name)).sort();
  const extra = actual.filter((name) => !baseline.has(name));
  const kept = actual.filter((name) => baseline.has(name));
  const different = kept.filter((name) => !readFileSync(path.join(dir, name)).equals(baseline.get(name)!));
  const notRewritten = kept.filter((name) => statSync(path.join(dir, name)).mtimeMs < startMs);
  return {
    ok: missing.length === 0 && extra.length === 0 && different.length === 0 && notRewritten.length === 0,
    files: actual.length,
    missing,
    extra,
    different,
    notRewritten,
  };
}

/** SHA-256 de um diretório: caminhos relativos e conteúdo de cada arquivo, em ordem. */
export function hashDir(dir: string): string {
  const hash = createHash('sha256');
  for (const name of listFiles(dir)) {
    hash.update(name).update('\0').update(readFileSync(path.join(dir, name))).update('\0');
  }
  return hash.digest('hex');
}
