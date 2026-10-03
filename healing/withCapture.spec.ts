import { test, expect } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Fingerprint } from './fingerprint';
import { fingerprintPath } from './fingerprintStore';
import { persistFingerprint } from './withCapture';

const CONTEXT = { selector: 'role=link[name=next]', url: '/index.html' };

const FINGERPRINT: Fingerprint = {
  selector: CONTEXT.selector,
  url: CONTEXT.url,
  tag: 'a',
  text: 'next',
  attributes: {
    stable: {},
    volatile: { class: null, id: null },
  },
  position: {
    parentTag: 'li',
    parentSiblingIndex: 1,
    siblingIndex: 0,
    depth: 6,
  },
};

let capturedDir: string;
let warnings: string[];
let originalWarn: typeof console.warn;

test.beforeEach(async () => {
  capturedDir = await mkdtemp(path.join(tmpdir(), 'healing-fingerprints-'));
  process.env.HEALING_FINGERPRINTS_DIR = capturedDir;

  warnings = [];
  originalWarn = console.warn;
  console.warn = (message: unknown) => {
    warnings.push(String(message));
  };
});

test.afterEach(async () => {
  console.warn = originalWarn;
  delete process.env.HEALING_FINGERPRINTS_DIR;
  await rm(capturedDir, { recursive: true, force: true });
});

test('não grava nada quando a extração falhou (null)', async () => {
  await persistFingerprint(null, CONTEXT);

  expect(await readdir(capturedDir)).toEqual([]);
});

test('avisa no console quando pula a gravação por extração nula', async () => {
  await persistFingerprint(null, CONTEXT);

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(CONTEXT.selector);
  expect(warnings[0]).toContain(CONTEXT.url);
});

test('grava JSON completo quando há fingerprint', async () => {
  await persistFingerprint(FINGERPRINT, CONTEXT);

  const gravado = await readFile(fingerprintPath(FINGERPRINT), 'utf8');
  expect(JSON.parse(gravado)).toEqual(FINGERPRINT);
  expect(warnings).toEqual([]);
});

test.describe('interruptor HEALING_CAPTURE=off', () => {
  test.afterEach(() => {
    delete process.env.HEALING_CAPTURE;
  });

  test('não grava fingerprint válido nem avisa', async () => {
    process.env.HEALING_CAPTURE = 'off';

    await persistFingerprint(FINGERPRINT, CONTEXT);
    await persistFingerprint(null, CONTEXT);

    expect(await readdir(capturedDir)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('qualquer outro valor mantém a captura ligada', async () => {
    process.env.HEALING_CAPTURE = 'on';

    await persistFingerprint(FINGERPRINT, CONTEXT);

    expect(JSON.parse(await readFile(fingerprintPath(FINGERPRINT), 'utf8'))).toEqual(FINGERPRINT);
  });
});
