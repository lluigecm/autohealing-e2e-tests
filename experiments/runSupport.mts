/**
 * Peças comuns aos orquestradores de rodada (`harness.mts` e `overhead.mts`):
 * estado do git, pré-verificação da home e leitura dos eventos gravados pelos
 * reporters. Nada aqui roda ao ser importado.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonl } from './runState.mts';

export function gitState(root: string): { commit: string; dirty: boolean } {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  return { commit, dirty: status.length > 0 };
}

/** Encerra com código 3 se a árvore do git tiver mudanças: o commit gravado tem de ser o código executado. */
export function requireCleanTree(root: string, tag: string): { commit: string; dirty: boolean } {
  const state = gitState(root);
  if (state.dirty) {
    console.error(`[${tag}] árvore do git com mudanças: commite antes de rodar (\`git status --porcelain\` não está vazio).`);
    process.exit(3);
  }
  return state;
}

const HOME_URL = 'https://books.toscrape.com/index.html';
const HOME_TITLE = 'All products | Books to Scrape - Sandbox';
/** Esperas entre as tentativas da pré-verificação: 3 tentativas no total. */
const PRECHECK_WAITS_MS = [15_000, 60_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Home com status 200 e o título esperado. Devolve o motivo da falha, ou `null`. */
async function homeProblem(): Promise<string | null> {
  try {
    const response = await fetch(HOME_URL, { signal: AbortSignal.timeout(15_000) });
    if (response.status !== 200) {
      return `status ${response.status}`;
    }
    const raw = (await response.text()).match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const title = raw.replace(/\s+/g, ' ').trim();
    return title === HOME_TITLE ? null : `título inesperado: ${JSON.stringify(title)}`;
  } catch (error) {
    return `requisição falhou: ${String(error)}`;
  }
}

/** Até 3 tentativas com espera. Devolve as falhas se todas falharem, ou `null`. */
export async function precheck(): Promise<string[] | null> {
  const problems: string[] = [];
  for (let attempt = 0; attempt <= PRECHECK_WAITS_MS.length; attempt += 1) {
    const problem = await homeProblem();
    if (problem === null) {
      return null;
    }
    problems.push(`${new Date().toISOString()} ${problem}`);
    console.log(`[pré-verificação] falhou: ${problem}`);
    if (attempt < PRECHECK_WAITS_MS.length) {
      await sleep(PRECHECK_WAITS_MS[attempt]);
    }
  }
  return problems;
}

/** Todos os eventos `tests-*.jsonl` sob um diretório, recursivamente. */
export function testEvents(dir: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => path.basename(name).startsWith('tests-') && name.endsWith('.jsonl'))
    .flatMap((name) => readJsonl(path.join(dir, name)));
}
