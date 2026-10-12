/**
 * Teste de ida e volta da reescrita de documentos.
 *
 *   node experiments/roundtrip.mts
 *
 * Roda os 66 testes de `tests/` com `experiments/roundtrip.config.ts` (todo
 * documento reserializado pela página auxiliar, sem mutação), capturando os
 * fingerprints num diretório temporário, e compara byte a byte com os
 * fingerprints versionados em `healing/fingerprints/`. Sai com código 1 se algum
 * arquivo faltar, sobrar ou diferir, ou se algum teste falhar.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE = path.join(ROOT, 'healing', 'fingerprints');

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\\/g, '/'))
    .sort();
}

const captured = mkdtempSync(path.join(tmpdir(), 'roundtrip-fingerprints-'));
try {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const env: NodeJS.ProcessEnv = { ...process.env, HEALING_FINGERPRINTS_DIR: captured };
  delete env.HEALING;
  delete env.HEALING_CAPTURE;
  const run = spawnSync(process.execPath, [cli, 'test', '--config', 'experiments/roundtrip.config.ts'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  const expected = files(BASELINE);
  const actual = new Set(files(captured));
  const missing = expected.filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.includes(name));
  const different = expected.filter(
    (name) => actual.has(name) && !readFileSync(path.join(BASELINE, name)).equals(readFileSync(path.join(captured, name))),
  );

  console.log(`\nTestes: ${run.status === 0 ? 'todos passaram' : `falhas (código ${run.status})`}`);
  console.log(`Fingerprints: baseline ${expected.length}, capturados ${actual.size}`);
  console.log(`Idênticos: ${expected.length - missing.length - different.length}`);
  console.log(`Faltando: ${missing.length}${missing.length ? `\n  ${missing.join('\n  ')}` : ''}`);
  console.log(`Sobrando: ${extra.length}${extra.length ? `\n  ${extra.join('\n  ')}` : ''}`);
  console.log(`Diferentes: ${different.length}${different.length ? `\n  ${different.join('\n  ')}` : ''}`);

  const ok = run.status === 0 && missing.length === 0 && extra.length === 0 && different.length === 0;
  console.log(ok ? '\nIDA E VOLTA OK' : '\nIDA E VOLTA FALHOU');
  process.exitCode = ok ? 0 : 1;
} finally {
  rmSync(captured, { recursive: true, force: true });
}
