import { BrowserContext, Locator, Page } from '@playwright/test';
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
 * autocontida — é serializada por `toString()` para o `addInitScript` e para o
 * `page.evaluate` dos unitários, então não pode referenciar nada do módulo.
 *
 * Sempre define `window[stateKey]`, mesmo quando não transforma nada: o harness
 * distingue "não aplicou" (`applied: false`) de "removeu o alvo" (`oracle: null`).
 * Nunca escreve `data-*`/`aria-*` (ADR-018).
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

/**
 * Instala a mutação em toda navegação de `target`: roda em `DOMContentLoaded`,
 * ou imediatamente se o documento já passou dessa fase. Só atua nas páginas em
 * que o alvo existe — nas demais, deixa `applied: false`.
 */
export async function applyMutation(target: Page | BrowserContext, spec: MutationSpec): Promise<void> {
  const plan = JSON.stringify(planOf(spec));
  const content = `(() => {
    const mutate = ${mutateDocument.toString()};
    const run = () => mutate(${plan});
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  })();`;
  await target.addInitScript({ content });
}

/** Estado da mutação na página atual, ou `null` se nenhuma foi instalada. */
export async function readMutationState(
  page: Page,
): Promise<{ id: string; applied: boolean; oracleIsNull: boolean } | null> {
  return page.evaluate((key) => {
    const state = (window as unknown as Record<string, { id: string; applied: boolean; oracle: Element | null }>)[key];
    return state ? { id: state.id, applied: state.applied, oracleIsNull: state.oracle === null } : null;
  }, MUTATION_STATE_KEY);
}

/**
 * Se o primeiro elemento resolvido por `locator` é o oráculo da mutação. Com
 * `oracle: null` (M5), é sempre `false` — toda resolução é incorreta.
 * Espera o locator resolver: quem chama verifica `count() > 0` antes.
 */
export async function pointsToOracle(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((el, key) => {
    const state = (window as unknown as Record<string, { oracle: Element | null }>)[key];
    return state !== undefined && state.oracle !== null && el === state.oracle;
  }, MUTATION_STATE_KEY);
}
