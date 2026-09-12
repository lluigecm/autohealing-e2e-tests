import { Locator, Page } from '@playwright/test';
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

/**
 * Grava o fingerprint extraído. Um `null` (extração falhou) é reportado via
 * `console.warn` em vez de ignorado: na Camada 2, "não capturou porque o
 * elemento genuinamente não existia" e "não capturou por bug na extração"
 * seriam indistinguíveis sem esse log.
 */
export async function persistFingerprint(
  fingerprint: Fingerprint | null,
  context: CaptureContext,
): Promise<void> {
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
 * Ponto de extensão único entre os Page Objects e o `Locator` do Playwright.
 *
 * A ordem é extrair → agir → persistir:
 * 1. A **extração** acontece antes da ação porque ações de navegação (clicar num
 *    link) destroem o elemento — lê-lo depois encontraria a página seguinte.
 * 2. A **persistência** só acontece se `action` não lançou erro, preservando a
 *    semântica de "fingerprint de interação bem-sucedida", não apenas de
 *    elemento localizado.
 *
 * Na Camada 2, `action(locator)` passa a ser envolvido num try/catch: falhou,
 * aciona a recuperação; funcionou, persiste como hoje.
 */
export async function withCapture<T>(
  page: Page,
  description: string,
  locator: Locator,
  action: (l: Locator) => Promise<T>,
): Promise<T> {
  // A URL é lida antes da ação: um clique de navegação já teria trocado a página.
  const context: CaptureContext = { selector: description, url: new URL(page.url()).pathname };

  const fingerprint = await extractFingerprint(context, locator);
  const result = await action(locator);
  await persistFingerprint(fingerprint, context);

  return result;
}
