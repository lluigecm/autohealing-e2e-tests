import { test, expect, Locator, Page } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { HealingLogEntry, RunContext } from './decision/decide';
import { configureHealing, HealingLogSink } from './decision/recovery';
import { withCapture } from './withCapture';

/**
 * Caminho de `withCapture` com `HEALING=on`: detecção por exceção seguida de
 * `count() === 0`, recuperação com as heurísticas reais e erro original quando
 * não recupera. O DOM vem de `page.route`, sem rede: a URL precisa ter pathname
 * para que o fingerprint de baseline tenha chave.
 */

const URL_PAGINA = 'http://fixture.test/listagem.html';
const DESCRICAO = 'css=#proxima';

function html(pager: string): string {
  return `<html><body><main>
    <h1>Listagem</h1>
    <ul class="pager"><li class="current">Page 1 of 50</li>${pager}</ul>
  </main></body></html>`;
}

const SAUDAVEL = html('<li class="next"><a id="proxima" href="#">next</a></li>');
/** Como o M1: o `id` que o locator usa foi reescrito, o resto do elemento continua. */
const ID_REESCRITO = html('<li class="next"><a id="m1-proxima" href="#">next</a></li>');
/** Como o M5: o elemento sumiu. */
const REMOVIDO = html('<li class="next"></li>');

/** Ação que falha rápido sobre locator ausente, como faria o `actionTimeout` do harness. */
const lerTexto = (l: Locator) => l.textContent({ timeout: 300 });

const RUN: RunContext = { entryId: 'M1-T4', testId: 'pagination', repetition: 1, condition: 'healing-on' };

async function abrir(page: Page, corpo: string): Promise<void> {
  await page.unroute('**/*');
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: corpo }));
  await page.goto(URL_PAGINA);
}

const VARIAVEIS = ['HEALING', 'HEALING_CAPTURE', 'HEALING_FINGERPRINTS_DIR'] as const;
let anteriores: Record<string, string | undefined>;
let dir: string;
let gravadas: HealingLogEntry[];

const sink: HealingLogSink = {
  filePath: '(memória)',
  write: (entry) => gravadas.push(entry),
};

test.beforeEach(async ({ page }) => {
  anteriores = Object.fromEntries(VARIAVEIS.map((name) => [name, process.env[name]]));
  dir = await mkdtemp(path.join(tmpdir(), 'healing-switch-'));
  process.env.HEALING_FINGERPRINTS_DIR = dir;
  gravadas = [];
  configureHealing({ sink, run: () => RUN });

  // Baseline: uma interação bem-sucedida com captura ligada grava o fingerprint.
  delete process.env.HEALING;
  delete process.env.HEALING_CAPTURE;
  await abrir(page, SAUDAVEL);
  await withCapture(page, DESCRICAO, page.locator('#proxima'), lerTexto);
  process.env.HEALING_CAPTURE = 'off';
});

test.afterEach(async () => {
  configureHealing({});
  for (const name of VARIAVEIS) {
    if (anteriores[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = anteriores[name];
    }
  }
  await rm(dir, { recursive: true, force: true });
});

test('HEALING ausente: erro original, sem recuperação nem registro', async ({ page }) => {
  await abrir(page, ID_REESCRITO);

  const erro = await withCapture(page, DESCRICAO, page.locator('#proxima'), lerTexto).catch((e: unknown) => e);

  expect(erro).toBeInstanceOf(Error);
  expect((erro as Error & { cause?: unknown }).cause).toBeUndefined();
  expect(gravadas).toEqual([]);
});

test('HEALING=on, locator quebrado e elemento ainda presente: substitui e devolve o valor da ação', async ({ page }) => {
  process.env.HEALING = 'on';
  await abrir(page, ID_REESCRITO);

  const texto = await withCapture(page, DESCRICAO, page.locator('#proxima'), lerTexto);

  expect(texto).toBe('next');
  expect(gravadas).toHaveLength(1);
  expect(gravadas[0].decision).toBe('replace');
  expect(gravadas[0].run).toEqual(RUN);
  // A espera da detecção é a da ação até a exceção, não a da extração.
  expect(gravadas[0].timings!.detectionWaitMs).toBeGreaterThanOrEqual(250);
  expect(gravadas[0].timings!.actionMs).not.toBeNull();
});

test('HEALING=on, elemento removido: registra a falha e relança o erro original', async ({ page }) => {
  process.env.HEALING = 'on';
  await abrir(page, REMOVIDO);

  const erro = await withCapture(page, DESCRICAO, page.locator('#proxima'), lerTexto).catch((e: unknown) => e);

  expect(erro).toBeInstanceOf(Error);
  expect((erro as Error).name).toBe('TimeoutError');
  expect((erro as Error & { cause?: { healing?: string } }).cause?.healing).toBe('fail');
  expect(gravadas).toHaveLength(1);
  expect(gravadas[0].decision).toBe('fail');
});

test('HEALING=on, falha com o elemento presente: não é de localização, erro original sem tentativa', async ({ page }) => {
  process.env.HEALING = 'on';
  await abrir(page, SAUDAVEL);
  const original = new Error('asserção falhou');

  const erro = await withCapture(page, DESCRICAO, page.locator('#proxima'), async () => {
    throw original;
  }).catch((e: unknown) => e);

  expect(erro).toBe(original);
  expect(gravadas).toEqual([]);
});

test('HEALING=on, falha com vários elementos resolvidos: erro original sem tentativa', async ({ page }) => {
  process.env.HEALING = 'on';
  await abrir(page, SAUDAVEL);
  const original = new Error('strict mode');

  const erro = await withCapture(page, 'css=li', page.locator('li'), async () => {
    throw original;
  }).catch((e: unknown) => e);

  expect(erro).toBe(original);
  expect(gravadas).toEqual([]);
});

test('HEALING=on, locator sem fingerprint de baseline: erro original, sem registro', async ({ page }) => {
  process.env.HEALING = 'on';
  await abrir(page, SAUDAVEL);

  const erro = await withCapture(page, 'css=#nunca-capturado', page.locator('#nunca-capturado'), lerTexto).catch(
    (e: unknown) => e,
  );

  expect((erro as Error & { cause?: { healing?: string } }).cause?.healing).toBe('sem fingerprint de baseline');
  expect(gravadas).toEqual([]);
});

test('a decisão é idêntica com o oráculo indisponível: ele só preenche candidateIsOracle', async ({ page }) => {
  process.env.HEALING = 'on';
  const oraculo = async () => true;

  const decisoes = [];
  for (const corpo of [ID_REESCRITO, REMOVIDO]) {
    for (const runtime of [{ sink, oracle: oraculo }, { sink }]) {
      configureHealing(runtime);
      gravadas = [];
      await abrir(page, corpo);
      await withCapture(page, DESCRICAO, page.locator('#proxima'), lerTexto).catch(() => undefined);
      const { decision, score, rawScore, factors, candidate, reason, flags, candidateIsOracle } = gravadas[0];
      decisoes.push({ corpo, comOraculo: 'oracle' in runtime, decision, score, rawScore, factors, candidate, reason, flags, candidateIsOracle });
    }
  }

  const [m1Com, m1Sem, m5Com, m5Sem] = decisoes;
  for (const [com, sem] of [[m1Com, m1Sem], [m5Com, m5Sem]]) {
    const { comOraculo: _a, candidateIsOracle: oraculoCom, ...decisaoCom } = com;
    const { comOraculo: _b, candidateIsOracle: oraculoSem, ...decisaoSem } = sem;
    expect(decisaoSem).toEqual(decisaoCom);
    expect(oraculoSem).toBeNull();
    if (decisaoCom.candidate !== null) {
      expect(oraculoCom).toBe(true);
    }
  }
  expect(m1Com.decision).toBe('replace');
  expect(m5Com.decision).toBe('fail');
});
