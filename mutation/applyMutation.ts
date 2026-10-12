import { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { MUTATION_STATE_KEY, MutationSpec, MutationType, TextChange } from './types';

/**
 * Parte serializável de um `MutationSpec`: é o que atravessa para o navegador.
 * Os metadados ficam do lado do Node — a página não precisa deles.
 */
export interface MutationPlan {
  id: string;
  type: MutationType;
  selector: string;
  stateKey: string;
  group?: string;
  text?: TextChange;
}

export function planOf(spec: MutationSpec): MutationPlan {
  return {
    id: spec.id,
    type: spec.type,
    selector: spec.target.selector,
    stateKey: MUTATION_STATE_KEY,
    group: spec.type === 'reorder-siblings' ? spec.group : undefined,
    text: spec.type === 'text-change' ? spec.text : undefined,
  };
}

/**
 * Transformação determinística, executada **no navegador**. Precisa ser
 * autocontida — é serializada por `toString()` para a página auxiliar e para o
 * `page.evaluate` dos unitários, então não pode referenciar nada do módulo.
 *
 * Sempre define `window[stateKey]`, mesmo quando não transforma nada: o harness
 * distingue "não aplicou" (`applied: false`) de "removeu o alvo" (`oracle: null`).
 * Nunca escreve `data-*`/`aria-*`.
 */
export function mutateDocument(plan: MutationPlan): void {
  const state: { id: string; applied: boolean; oracle: Element | null } = {
    id: plan.id,
    applied: false,
    oracle: null,
  };
  (window as unknown as Record<string, unknown>)[plan.stateKey] = state;

  const target = document.querySelector(plan.selector);
  if (!target) {
    return;
  }

  switch (plan.type) {
    case 'volatile-attributes': {
      const tokens = (target.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
      target.setAttribute('class', tokens.length > 0 ? tokens.map((token) => `m1-${token}`).join(' ') : 'm1');
      target.setAttribute('id', `m1-${plan.id}`);
      break;
    }

    case 'text-change': {
      const change = plan.text!;
      const words = (target.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
      let next: string;
      if (change.kind === 'relabel') {
        next = change.text;
      } else if (change.kind === 'append-token') {
        next = [...words, change.token].join(' ');
      } else {
        // Remover o único token apagaria o rótulo: deixaria de ser edição leve.
        if (words.length < 2) {
          return;
        }
        next = words.slice(0, -1).join(' ');
      }
      target.textContent = next;
      break;
    }

    case 'reorder-siblings': {
      const group = document.querySelector(plan.group!);
      if (!group || !group.contains(target)) {
        return;
      }
      Array.from(group.children)
        .reverse()
        .forEach((child) => group.appendChild(child));
      break;
    }

    case 'wrap-in-container': {
      const wrapper = document.createElement('div');
      target.replaceWith(wrapper);
      wrapper.appendChild(target);
      break;
    }

    case 'remove-element': {
      target.remove();
      state.applied = true;
      return;
    }
  }

  state.applied = true;
  state.oracle = target;
}


/** Caminho de índices de filho, do `documentElement` até o elemento. */
type ElementPath = number[];

/** Estado da mutação num documento entregue: o oráculo como caminho de índices, fora do DOM. */
interface DocumentState {
  id: string;
  applied: boolean;
  /** `null` quando nada foi aplicado ou quando o alvo foi removido (M5). */
  oraclePath: ElementPath | null;
}

/** O que a página auxiliar devolve depois de transformar um documento. */
interface Rewrite extends DocumentState {
  html: string;
}

/** Avisado a cada documento entregue, antes de a página do teste recebê-lo. */
export type DocumentListener = (document: { url: string; applied: boolean }) => void;

export interface ApplyOptions {
  onDocument?: DocumentListener;
}

/**
 * Estado por página e por carregamento de documento, lido por
 * `readMutationState` e `pointsToOracle`. Cada documento reescrito leva um
 * identificador de carregamento próprio no cabeçalho `Server-Timing`, que a
 * página expõe em `performance` sem nada no DOM. Assim, duas páginas do mesmo
 * contexto na mesma URL não se misturam, e uma nova navegação para a mesma URL
 * não herda o oráculo do carregamento anterior.
 */
const documentStates = new WeakMap<Page, Map<string, DocumentState>>();

/** Nome da métrica `Server-Timing` que carrega o identificador do carregamento. */
const LOAD_TIMING = 'mutation-load';
let loadCounter = 0;

/**
 * Executada na página auxiliar: aplica o plano (ou nada, com `plan: null`),
 * calcula o caminho do oráculo e serializa o documento inteiro, inclusive
 * doctype e comentários fora do `<html>`.
 */
function transformInHelper(arg: { plan: MutationPlan | null; mutate: string; stateKey: string }): Rewrite {
  const w = window as unknown as Record<string, { id: string; applied: boolean; oracle: Element | null } | undefined>;
  // `setContent` reaproveita o `window`: sem plano, o estado de um documento
  // anterior ainda estaria lá e não pode ser lido.
  let state = { id: '', applied: false, oracle: null as Element | null };
  if (arg.plan !== null) {
    new Function('plan', `(${arg.mutate})(plan);`)(arg.plan);
    state = w[arg.stateKey]!;
  }

  let oraclePath: number[] | null = null;
  if (state.oracle) {
    oraclePath = [];
    for (let el: Element = state.oracle; el !== document.documentElement; el = el.parentElement!) {
      oraclePath.unshift(Array.from(el.parentElement!.children).indexOf(el));
    }
  }

  const html = Array.from(document.childNodes)
    .map((node) => {
      if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
        const doctype = node as DocumentType;
        const ids = doctype.publicId
          ? ` PUBLIC "${doctype.publicId}"${doctype.systemId ? ` "${doctype.systemId}"` : ''}`
          : doctype.systemId
            ? ` SYSTEM "${doctype.systemId}"`
            : '';
        return `<!DOCTYPE ${doctype.name}${ids}>`;
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        return `<!--${(node as Comment).data}-->`;
      }
      return node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : '';
    })
    .join('\n');

  return { id: state.id, applied: state.applied, oraclePath, html };
}

/**
 * Página auxiliar no mesmo navegador, com JavaScript desligado e toda
 * requisição bloqueada: só serve para o parser e a serialização do Chromium.
 * Uma por contexto instalado, fechada junto com ele; o uso é serializado.
 */
function helperFor(context: BrowserContext): (html: string, plan: MutationPlan | null) => Promise<Rewrite> {
  let ready: Promise<Page> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const open = async (): Promise<Page> => {
    const browser = context.browser();
    if (!browser) {
      throw new Error('[mutation] contexto sem navegador: a página auxiliar não pode ser criada');
    }
    const helperContext = await browser.newContext({ javaScriptEnabled: false });
    context.on('close', () => {
      helperContext.close().catch(() => undefined);
    });
    await helperContext.route('**/*', (route) => route.abort());
    return helperContext.newPage();
  };

  return (html, plan) => {
    const run = queue.then(async () => {
      ready ??= open();
      const page = await ready;
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return page.evaluate(transformInHelper, { plan, mutate: mutateDocument.toString(), stateKey: MUTATION_STATE_KEY });
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

function contextOf(target: Page | BrowserContext): BrowserContext {
  return 'newPage' in target ? target : target.context();
}

/**
 * Reescreve os documentos do frame principal de `target` antes de eles chegarem
 * à página. A página do teste nunca vê o documento original, então não há
 * corrida entre a mutação e a primeira leitura do DOM pelo teste.
 *
 * Documento sem alvo (`applied: false`) é entregue com os **bytes originais**,
 * sem reserializar. Com `reserialize: true`, todo documento passa pela página
 * auxiliar, mesmo sem plano: é o que o teste de ida e volta usa.
 */
export async function installDocumentRewrite(
  target: Page | BrowserContext,
  plan: MutationPlan | null,
  options: ApplyOptions & { reserialize?: boolean } = {},
): Promise<void> {
  const transform = helperFor(contextOf(target));

  await target.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'document' || request.frame().parentFrame() !== null) {
      return route.fallback();
    }
    try {
      return await rewriteDocument(route);
    } catch {
      // Falha ao buscar ou reescrever: a navegação falha como falharia na rede,
      // e o `requestfailed` fica visível para quem observa a infraestrutura.
      return route.abort('failed').catch(() => undefined);
    }
  });

  async function rewriteDocument(route: Route): Promise<void> {
    const request = route.request();
    // Sem seguir redirecionamento: o navegador segue e a nova URL passa por aqui de novo.
    const response = await route.fetch({ maxRedirects: 0 });
    const isHtml = (response.headers()['content-type'] ?? '').includes('text/html');
    if (response.status() !== 200 || !isHtml) {
      return route.fulfill({ response });
    }

    const original = await response.body();
    const rewrite = await transform(original.toString('utf8'), plan);

    // O corpo vai já decodificado: tamanho e codificação da resposta original não valem mais.
    const headers = { ...response.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    if (plan !== null) {
      const page = request.frame().page();
      const load = `${(loadCounter += 1)}-${Math.random().toString(36).slice(2)}`;
      let states = documentStates.get(page);
      if (!states) {
        states = new Map();
        documentStates.set(page, states);
      }
      states.set(load, { id: rewrite.id, applied: rewrite.applied, oraclePath: rewrite.oraclePath });
      const timing = `${LOAD_TIMING};desc="${load}"`;
      headers['server-timing'] = headers['server-timing'] ? `${headers['server-timing']}, ${timing}` : timing;
      options.onDocument?.({ url: new URL(request.url()).pathname, applied: rewrite.applied });
    }

    // Sem alvo, os bytes originais: só os cabeçalhos mudam.
    const body = !rewrite.applied && !options.reserialize ? original : Buffer.from(rewrite.html, 'utf8');
    return route.fulfill({ response, headers, body });
  }
}

/**
 * Instala a mutação em toda navegação de `target`: o HTML de cada documento do
 * frame principal é transformado na página auxiliar antes de ser entregue. Só
 * atua nos documentos em que o alvo existe; nos demais, `applied: false` e os
 * bytes originais.
 */
export async function applyMutation(
  target: Page | BrowserContext,
  spec: MutationSpec,
  options: ApplyOptions = {},
): Promise<void> {
  await installDocumentRewrite(target, planOf(spec), options);
}

/** Estado do documento carregado agora em `page`, pelo identificador do carregamento. */
async function stateOf(page: Page): Promise<DocumentState | null> {
  const states = documentStates.get(page);
  if (!states) {
    return null;
  }
  const load = await page.evaluate((name) => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.serverTiming.find((timing) => timing.name === name)?.description ?? null;
  }, LOAD_TIMING);
  return load === null ? null : (states.get(load) ?? null);
}

/**
 * Caminho de índices do oráculo no documento atual, a partir do
 * `documentElement`; `null` sem mutação instalada, sem alvo ou no M5.
 */
export async function oraclePath(page: Page): Promise<number[] | null> {
  return (await stateOf(page))?.oraclePath ?? null;
}

/** Estado da mutação no documento atual, ou `null` se nenhuma foi instalada. */
export async function readMutationState(
  page: Page,
): Promise<{ id: string; applied: boolean; oracleIsNull: boolean } | null> {
  const state = await stateOf(page);
  return state ? { id: state.id, applied: state.applied, oracleIsNull: state.oraclePath === null } : null;
}

/**
 * Se o primeiro elemento resolvido por `locator` é o oráculo da mutação,
 * comparando caminhos de índices. Com `oracle: null` (M5), é sempre `false` —
 * toda resolução é incorreta. Espera o locator resolver: quem chama verifica
 * `count() > 0` antes.
 */
export async function pointsToOracle(locator: Locator): Promise<boolean> {
  const state = await stateOf(locator.page());
  if (!state || state.oraclePath === null) {
    return false;
  }
  return locator.first().evaluate((el, expected) => {
    const path: number[] = [];
    for (let node: Element = el; node !== document.documentElement; node = node.parentElement!) {
      if (!node.parentElement) {
        return false;
      }
      path.unshift(Array.from(node.parentElement.children).indexOf(node));
    }
    return path.length === expected.length && path.every((index, i) => index === expected[i]);
  }, state.oraclePath);
}
