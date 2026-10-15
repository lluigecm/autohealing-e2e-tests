import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildOverheadPlan,
  hashDir,
  listFiles,
  loadBaseline,
  prefill,
  verifyCapture,
} from '../../experiments/overheadRun.mts';
import type { Baseline } from '../../experiments/overheadRun.mts';

/**
 * Plano, preenchimento e verificação da medição do custo da captura, sobre
 * diretórios temporários. Nada toca no site. Mora sob `healing/` só por causa
 * do `testDir` da config unitária.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TESTS = ['tests/a.spec.ts › um', 'tests/b.spec.ts › dois'];

const BASELINE: Baseline = new Map([
  ['index.html/role-article.json', Buffer.from('{"a":1}\n')],
  ['catalogue-x/role-heading-level-1.json', Buffer.from('{"b":2}\n')],
]);

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'overhead-run-'));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Preenche e envelhece os arquivos, como se tivessem sido escritos antes da tentativa. */
function prefilledLongAgo(): number {
  prefill(dir, BASELINE);
  const past = new Date(Date.now() - 60_000);
  for (const name of BASELINE.keys()) {
    utimesSync(path.join(dir, name), past, past);
  }
  return Date.now() - 1_000;
}

/** A captura regravando um arquivo com os bytes dados. */
function rewrite(name: string, bytes: Buffer = BASELINE.get(name)!): void {
  writeFileSync(path.join(dir, name), bytes);
}

test.describe('plano', () => {
  test('aquecimento com a captura ligada e depois 10 pares, cada um com as duas condições', () => {
    const plan = buildOverheadPlan(TESTS);

    expect(plan).toHaveLength(21);
    expect(plan[0]).toMatchObject({ entryId: 'aquecimento', condition: 'captura-ligada', repeatEach: 1, tests: TESTS });
    for (let index = 1; index <= 10; index += 1) {
      const pair = plan.slice(2 * index - 1, 2 * index + 1);
      expect(new Set(pair.map((inv) => inv.entryId))).toEqual(new Set([`par-${String(index).padStart(2, '0')}`]));
      expect(new Set(pair.map((inv) => inv.condition))).toEqual(new Set(['captura-ligada', 'captura-desligada']));
    }
  });

  test('pares ímpares começam pela desligada e pares pares pela ligada', () => {
    const plan = buildOverheadPlan(TESTS);
    const first = Array.from({ length: 10 }, (_, i) => plan[1 + 2 * i].condition);

    expect(first).toEqual([
      'captura-desligada', 'captura-ligada', 'captura-desligada', 'captura-ligada', 'captura-desligada',
      'captura-ligada', 'captura-desligada', 'captura-ligada', 'captura-desligada', 'captura-ligada',
    ]);
  });
});

test.describe('verificação com a captura ligada', () => {
  test('todos os arquivos regravados e idênticos: ok', () => {
    const startMs = prefilledLongAgo();
    for (const name of BASELINE.keys()) {
      rewrite(name);
    }

    expect(verifyCapture(dir, 'captura-ligada', BASELINE, startMs)).toMatchObject({
      ok: true,
      files: 2,
      missing: [],
      extra: [],
      different: [],
      notRewritten: [],
    });
  });

  test('arquivo pré-carregado que a captura não regravou: falha, mesmo com bytes idênticos', () => {
    const startMs = prefilledLongAgo();
    rewrite('index.html/role-article.json');

    const result = verifyCapture(dir, 'captura-ligada', BASELINE, startMs);

    expect(result.ok).toBe(false);
    expect(result.notRewritten).toEqual(['catalogue-x/role-heading-level-1.json']);
    expect(result.different).toEqual([]);
  });

  test('bytes diferentes, arquivo faltando e arquivo sobrando: falha, com cada caso listado', () => {
    const startMs = prefilledLongAgo();
    rewrite('index.html/role-article.json', Buffer.from('{"a":2}\n'));
    rmSync(path.join(dir, 'catalogue-x/role-heading-level-1.json'));
    writeFileSync(path.join(dir, 'novo.json'), '{}\n');

    const result = verifyCapture(dir, 'captura-ligada', BASELINE, startMs);

    expect(result.ok).toBe(false);
    expect(result.different).toEqual(['index.html/role-article.json']);
    expect(result.missing).toEqual(['catalogue-x/role-heading-level-1.json']);
    expect(result.extra).toEqual(['novo.json']);
  });
});

test.describe('verificação com a captura desligada', () => {
  test('diretório vazio: ok', () => {
    expect(verifyCapture(dir, 'captura-desligada', BASELINE, Date.now())).toMatchObject({ ok: true, files: 0 });
  });

  test('qualquer arquivo no diretório: falha', () => {
    writeFileSync(path.join(dir, 'x.json'), '{}\n');

    expect(verifyCapture(dir, 'captura-desligada', BASELINE, Date.now())).toMatchObject({ ok: false, extra: ['x.json'] });
  });
});

test('hash do diretório muda com o conteúdo e não muda sem ele', () => {
  prefill(dir, BASELINE);
  const before = hashDir(dir);

  expect(hashDir(dir)).toBe(before);
  rewrite('index.html/role-article.json', Buffer.from('{"a":3}\n'));
  expect(hashDir(dir)).not.toBe(before);
});

test('baseline lida do git: os 134 fingerprints versionados, com os mesmos bytes da cópia de trabalho', () => {
  const baseline = loadBaseline(ROOT, 'HEAD');
  const working = path.join(ROOT, 'healing', 'fingerprints');

  expect(baseline.size).toBe(134);
  expect([...baseline.keys()].sort()).toEqual(listFiles(working));
  for (const [name, bytes] of baseline) {
    expect(readFileSync(path.join(working, name)).equals(bytes)).toBe(true);
  }
});
