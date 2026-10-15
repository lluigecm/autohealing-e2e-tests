import { test, expect, Page } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fingerprintPath } from './fingerprintStore';
import { CaptureTiming, configureCaptureTimings, withCapture } from './withCapture';

/**
 * Medição da duração da extração e da gravação em `withCapture`. A medição só
 * lê o relógio: com ou sem coletor, a ação devolve o mesmo valor e o
 * fingerprint gravado tem os mesmos bytes.
 */

const DOM = '<ul><li><a href="#">next</a></li></ul>';
const DESCRIPTION = 'role=link[name=next]';
/** Caminho de `about:blank`, que é o que `withCapture` registra como URL. */
const PAGE_URL = new URL('about:blank').pathname;
const VARIAVEIS = ['HEALING', 'HEALING_CAPTURE', 'HEALING_FINGERPRINTS_DIR'] as const;

let saved: Record<string, string | undefined>;
let dirs: string[];

test.beforeEach(() => {
  saved = Object.fromEntries(VARIAVEIS.map((name) => [name, process.env[name]]));
  for (const name of VARIAVEIS) {
    delete process.env[name];
  }
  dirs = [];
});

test.afterEach(async () => {
  configureCaptureTimings(null);
  for (const name of VARIAVEIS) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function captureInto(page: Page): Promise<{ dir: string; result: string | null }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'capture-timings-'));
  dirs.push(dir);
  process.env.HEALING_FINGERPRINTS_DIR = dir;
  const result = await withCapture(page, DESCRIPTION, page.getByRole('link', { name: 'next' }), (l) => l.textContent());
  return { dir, result };
}

async function written(dir: string): Promise<Buffer> {
  process.env.HEALING_FINGERPRINTS_DIR = dir;
  return readFile(fingerprintPath({ url: PAGE_URL, selector: DESCRIPTION }));
}

test('sem coletor e com coletor: mesmo resultado e mesmos bytes gravados', async ({ page }) => {
  await page.setContent(DOM);

  const semColetor = await captureInto(page);

  const timings: CaptureTiming[] = [];
  configureCaptureTimings((timing) => timings.push(timing));
  const comColetor = await captureInto(page);

  expect(comColetor.result).toBe(semColetor.result);
  expect((await written(comColetor.dir)).equals(await written(semColetor.dir))).toBe(true);
});

test('com coletor: uma extração e depois uma gravação, com fingerprint e duração', async ({ page }) => {
  await page.setContent(DOM);
  const timings: CaptureTiming[] = [];
  configureCaptureTimings((timing) => timings.push(timing));

  await captureInto(page);

  expect(timings.map((timing) => timing.phase)).toEqual(['extract', 'persist']);
  for (const timing of timings) {
    expect(timing).toMatchObject({ selector: DESCRIPTION, url: PAGE_URL, fingerprint: true });
    expect(timing.ms).toBeGreaterThanOrEqual(0);
  }
});

test('com a captura desligada, o coletor não recebe nada e nada é gravado', async ({ page }) => {
  await page.setContent(DOM);
  process.env.HEALING_CAPTURE = 'off';
  const timings: CaptureTiming[] = [];
  configureCaptureTimings((timing) => timings.push(timing));

  const { dir, result } = await captureInto(page);

  expect(result).toBe('next');
  expect(timings).toEqual([]);
  expect(await readdir(dir)).toEqual([]);
});

test('sem HEALING_FINGERPRINTS_DIR, a gravação vai para healing/fingerprints/', () => {
  const target = fingerprintPath({ url: '/index.html', selector: DESCRIPTION });

  expect(path.dirname(path.dirname(target))).toBe(path.resolve(__dirname, 'fingerprints'));
});
