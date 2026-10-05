import { Locator, Page, test } from '@playwright/test';
import * as capture from '../healing/withCapture';
import { TARGETS } from './catalog';

/**
 * Registro de rastreabilidade teste → método de Page Object → locator → alvo.
 *
 * Substitui `withCapture` em tempo de execução (só sob
 * `targetTestMap.config.ts`) por uma versão que, antes de delegar à original,
 * pergunta ao DOM quais alvos do catálogo o locator resolve ou atravessa. Os 66
 * testes rodam sem alteração: o mapa sai da execução real, não de leitura do
 * código nem de reprodução.
 *
 * O alvo é identificado pelo seletor CSS do catálogo (`target.selector`) na
 * página em que a chamada acontece — o mesmo elemento que a mutação
 * transformaria ali, já que `applyMutation` roda em toda navegação.
 */

/** Nome do anexo em que cada chamada é entregue ao reporter. */
export const ATTACHMENT_NAME = 'target-map-call';

/**
 * Como o locator se relaciona com o elemento do alvo.
 * `resolve`: o locator resolve para um único elemento, que é o alvo.
 * `resolve-colecao`: o alvo é um entre N > 1 elementos resolvidos.
 * `ancestral`: o alvo é ancestral do único elemento resolvido (o locator passa por ele).
 * `ancestral-colecao`: o alvo é ancestral de algum dos N > 1 elementos resolvidos.
 */
export type Relation = 'resolve' | 'resolve-colecao' | 'ancestral' | 'ancestral-colecao';

export interface TargetHit {
  /** `T1`..`T10`. */
  alvo: string;
  /** Igual a `alvo`, exceto no T1, instanciado por categoria (`T1-travel_2`). */
  instancia: string;
  relacao: Relation;
}

export interface CallRecord {
  /** Método do Page Object que chamou `withCapture`, ex.: `HomePage.goToCategory`. */
  metodo: string;
  /** Linha do spec que chamou o método, ex.: `tests/home.spec.ts:8`. */
  chamadoEm: string;
  /** Descrição do locator passada a `withCapture` (a mesma chave dos fingerprints). */
  locator: string;
  /** Caminho da página no momento da chamada. */
  url: string;
  /** Quantos elementos o locator resolve. */
  resolvidos: number;
  /** Preenchido pelo reporter, que só ele vê todas as chamadas do par (método, locator). */
  colecao?: boolean;
  alvos: TargetHit[];
}

const TARGET_SELECTORS = TARGETS.map((target) => ({ id: target.id, key: target.key, selector: target.selector }));

/** Executada no navegador: autocontida. */
function relate(
  elements: Element[],
  targets: Array<{ id: string; key: string; selector: string }>,
): { resolvidos: number; alvos: TargetHit[] } {
  const hits: TargetHit[] = [];
  const single = elements.length === 1;
  for (const target of targets) {
    const el = document.querySelector(target.selector);
    if (!el) {
      continue;
    }
    let relacao: Relation | null = null;
    if (elements.includes(el)) {
      relacao = single ? 'resolve' : 'resolve-colecao';
    } else if (elements.some((resolved) => resolved !== el && el.contains(resolved))) {
      relacao = single ? 'ancestral' : 'ancestral-colecao';
    }
    if (relacao) {
      hits.push({ alvo: target.id, instancia: target.key, relacao });
    }
  }
  return { resolvidos: elements.length, alvos: hits };
}

/** Caminho relativo à raiz do repositório, com `/`. */
function repoPath(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const match = normalized.match(/\/(pages|tests)\/.*$/);
  return match ? match[0].slice(1) : normalized;
}

/** Lê da pilha o método do Page Object e a linha do spec que o chamou. */
function callSite(): { metodo: string; chamadoEm: string } {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  let metodo = '?';
  let chamadoEm = '?';
  for (const frame of frames) {
    const match = frame.match(/at (?:async )?(?:(\S+) \()?(.*?):(\d+):\d+\)?$/);
    if (!match) {
      continue;
    }
    const [, fn, file, line] = match;
    const path = repoPath(file);
    if (metodo === '?' && path.startsWith('pages/') && !path.endsWith('BasePage.ts') && fn) {
      metodo = fn;
    }
    if (chamadoEm === '?' && path.startsWith('tests/')) {
      chamadoEm = `${path}:${line}`;
    }
  }
  return { metodo, chamadoEm };
}

const original = capture.withCapture;

async function tracedWithCapture<T>(
  page: Page,
  description: string,
  locator: Locator,
  action: (l: Locator) => Promise<T>,
): Promise<T> {
  const { metodo, chamadoEm } = callSite();
  const url = new URL(page.url()).pathname;
  // Depois de um clique de navegação o DOM seguinte pode ainda não existir;
  // `evaluateAll` não espera, então a espera vem antes. Só acrescenta espera:
  // a ação original roda igual em seguida.
  await page.waitForLoadState('domcontentloaded');
  await locator.first().waitFor({ state: 'attached' }).catch(() => undefined);
  const relation = await locator.evaluateAll(relate, TARGET_SELECTORS);

  const record: CallRecord = { metodo, chamadoEm, locator: description, url, ...relation };
  await test.info().attach(ATTACHMENT_NAME, { body: JSON.stringify(record), contentType: 'application/json' });

  return original(page, description, locator, action);
}

/**
 * Instala o registro. Os Page Objects chamam `withCapture` pela propriedade do
 * módulo (`(0, _withCapture.withCapture)(...)` no CommonJS gerado), então
 * trocar a propriedade basta. Se a troca não pegar, nenhum teste gera registro
 * e o reporter recusa o mapa.
 */
export function installTargetMapHook(): void {
  (capture as { withCapture: typeof capture.withCapture }).withCapture = tracedWithCapture;
}
