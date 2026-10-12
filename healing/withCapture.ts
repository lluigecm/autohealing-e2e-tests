import { Locator, Page } from '@playwright/test';
import { performance } from 'perf_hooks';
import { recoverAndAct } from './decision/recovery';
import { Fingerprint } from './fingerprint';
import { saveFingerprint } from './fingerprintStore';

const CAPTURE_TIMEOUT_MS = 5_000;

export interface CaptureContext {
  selector: string;
  url: string;
}

interface RawCapture {
  tag: string;
  text: string;
  stable: Record<string, string>;
  class: string | null;
  id: string | null;
  parentTag: string | null;
  parentSiblingIndex: number | null;
  siblingIndex: number;
  depth: number;
}

function extractFromDom(el: Element): RawCapture {
  const stable: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
      stable[attr.name] = attr.value;
    }
  }

  const parent = el.parentElement;
  const grandparent = parent ? parent.parentElement : null;

  let depth = 0;
  let cursor = el.parentElement;
  while (cursor && cursor.tagName !== 'BODY') {
    depth += 1;
    cursor = cursor.parentElement;
  }

  const rendered = (el as HTMLElement).innerText;
  const text = (rendered !== undefined ? rendered : el.textContent) ?? '';

  return {
    tag: el.tagName.toLowerCase(),
    text: text.replace(/\s+/g, ' ').trim(),
    stable,
    class: el.getAttribute('class'),
    id: el.getAttribute('id'),
    parentTag: parent ? parent.tagName.toLowerCase() : null,
    parentSiblingIndex: parent && grandparent ? Array.from(grandparent.children).indexOf(parent) : null,
    siblingIndex: parent ? Array.from(parent.children).indexOf(el) : -1,
    depth,
  };
}

function sortKeys(attributes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));
}

async function extractFingerprint(
  context: CaptureContext,
  locator: Locator,
): Promise<Fingerprint | null> {
  try {
    // `first()` porque locators de coleção (ex: os 20 cards de produto) violariam
    // o strict mode em `evaluate`; o primeiro match serve de representante.
    const raw = await locator.first().evaluate(extractFromDom, undefined, { timeout: CAPTURE_TIMEOUT_MS });

    return {
      selector: context.selector,
      url: context.url,
      tag: raw.tag,
      text: raw.text,
      attributes: {
        stable: sortKeys(raw.stable),
        volatile: { class: raw.class, id: raw.id },
      },
      position: {
        parentTag: raw.parentTag,
        parentSiblingIndex: raw.parentSiblingIndex,
        siblingIndex: raw.siblingIndex,
        depth: raw.depth,
      },
    };
  } catch {
    return null;
  }
}

/** `HEALING_CAPTURE=off` desliga a captura. Lida a cada chamada para que os testes possam alterná-la. */
function captureEnabled(): boolean {
  return process.env.HEALING_CAPTURE !== 'off';
}

/**
 * Grava o fingerprint extraído. Um `null` (extração falhou) é reportado via
 * `console.warn` em vez de ignorado: na Camada 2, "não capturou porque o
 * elemento genuinamente não existia" e "não capturou por bug na extração"
 * seriam indistinguíveis sem esse log.
 *
 * Com `HEALING_CAPTURE=off` não grava nada: sob DOM mutado, uma ação que ainda
 * funcione sobrescreveria o baseline versionado em `healing/fingerprints/` com
 * dados mutados.
 */
export async function persistFingerprint(
  fingerprint: Fingerprint | null,
  context: CaptureContext,
): Promise<void> {
  if (!captureEnabled()) {
    return;
  }

  if (!fingerprint) {
    console.warn(`[healing] extração falhou, gravação pulada: ${context.selector} em ${context.url}`);
    return;
  }

  try {
    await saveFingerprint(fingerprint);
  } catch (error) {
    console.warn(
      `[healing] falha ao gravar fingerprint: ${context.selector} em ${context.url} — ${String(error)}`,
    );
  }
}

/**
 * `HEALING=on` liga a recuperação; qualquer outro valor, inclusive ausente,
 * mantém o comportamento sem healing. Desligado por padrão: ligado, a suíte
 * baseline curaria em silêncio uma regressão real. Lida a cada chamada, no
 * mesmo padrão de `HEALING_CAPTURE`.
 */
function healingEnabled(): boolean {
  return process.env.HEALING === 'on';
}

/**
 * Ponto de extensão único entre os Page Objects e o `Locator` do Playwright.
 *
 * A ordem é extrair → agir → persistir:
 * 1. A **extração** acontece antes da ação porque ações de navegação (clicar num
 *    link) destroem o elemento — lê-lo depois encontraria a página seguinte.
 * 2. A **persistência** só acontece se `action` não lançou erro, preservando a
 *    semântica de "fingerprint de interação bem-sucedida", não apenas de
 *    elemento localizado.
 *
 * Com `HEALING=on`, a falha da ação passa pela detecção: só conta como locator
 * quebrado se, depois da exceção, o locator não resolve nenhum elemento. Com o
 * elemento presente (um ou vários), a falha não é de localização e o erro
 * original segue. A detecção é por exceção, sem checagem prévia: `isVisible()`
 * sobre um elemento que legitimamente não existe devolve `false` e nunca
 * aciona a recuperação. Uma ação recuperada não persiste fingerprint: o
 * elemento achado pela heurística não é o que o seletor original descreve.
 */
export async function withCapture<T>(
  page: Page,
  description: string,
  locator: Locator,
  action: (l: Locator) => Promise<T>,
): Promise<T> {
  // A URL é lida antes da ação: um clique de navegação já teria trocado a página.
  const context: CaptureContext = { selector: description, url: new URL(page.url()).pathname };

  // A extração só serve à persistência. Com a captura desligada ela seria custo
  // puro: sobre um locator quebrado, espera até CAPTURE_TIMEOUT_MS antes da ação.
  const fingerprint = captureEnabled() ? await extractFingerprint(context, locator) : null;

  if (!healingEnabled()) {
    const result = await action(locator);
    await persistFingerprint(fingerprint, context);
    return result;
  }

  const start = performance.now();
  let result: T;
  try {
    result = await action(locator);
  } catch (error) {
    const detectionWaitMs = performance.now() - start;
    const resolved = await locator.count().catch(() => null);
    if (resolved !== 0) {
      throw error;
    }
    return recoverAndAct(page, { key: context, error, detectionWaitMs }, action);
  }
  await persistFingerprint(fingerprint, context);
  return result;
}
