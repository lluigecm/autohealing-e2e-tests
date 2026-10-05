import { test, expect } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { CATALOG, findMutation } from '../mutation/catalog';
import { applyMutation, readMutationState } from '../mutation/applyMutation';
import { measureMatrix } from './mutationMatrix';

/**
 * Ferramenta de mutação contra o alvo real. A checagem de hash do baseline é a
 * verificação do critério de conclusão da etapa — nenhum arquivo de
 * `healing/fingerprints/` muda — e não confia só na convenção do interruptor.
 */

const FINGERPRINTS_DIR = path.resolve(__dirname, '..', 'healing', 'fingerprints');

async function baselineHash(): Promise<string> {
  const hash = createHash('sha256');
  const files = (await readdir(FINGERPRINTS_DIR, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) {
    hash.update(path.relative(FINGERPRINTS_DIR, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

let hashBefore: string;
let previousCapture: string | undefined;

/**
 * Sob DOM mutado, nenhuma ação pode regravar o baseline versionado.
 * Definido e restaurado nos hooks, não no nível do módulo: o worker é
 * reaproveitado entre arquivos, e a captura desligada não pode vazar para eles.
 * `persistFingerprint` lê a variável a cada chamada, então basta estar definida
 * antes dos testes.
 */
test.beforeAll(async () => {
  previousCapture = process.env.HEALING_CAPTURE;
  process.env.HEALING_CAPTURE = 'off';
  hashBefore = await baselineHash();
});

test.afterAll(async () => {
  if (previousCapture === undefined) {
    delete process.env.HEALING_CAPTURE;
  } else {
    process.env.HEALING_CAPTURE = previousCapture;
  }
  expect(await baselineHash(), 'healing/fingerprints/ mudou durante a execução').toBe(hashBefore);
});

test('alvo ausente: o link "Travel" não existe na própria página Travel (applied: false)', async ({ context }) => {
  for (const id of ['M1-T1-travel_2', 'M2-T1-travel_2-relabel', 'M5-T1-travel_2']) {
    const fresh = await context.newPage();
    await applyMutation(fresh, findMutation(id));

    await fresh.goto('/index.html');
    expect(await readMutationState(fresh), `${id} na home`).toMatchObject({ id, applied: true });

    await fresh.goto('/catalogue/category/books/travel_2/index.html');
    expect(await readMutationState(fresh), `${id} na página Travel`).toEqual({
      id,
      applied: false,
      oracleIsNull: true,
    });
    await fresh.close();
  }
});

const MATRIX_PATH = path.resolve(__dirname, '..', 'mutation', 'effectiveness-matrix.json');

/**
 * Matriz de efetividade. Sem `MUTATION_MATRIX_OUT`, compara a medição
 * com a matriz versionada em `mutation/` — caracterização: uma divergência é um
 * achado a investigar, não um teste a reexecutar. Com a variável, grava a
 * medição no caminho indicado (o arquivo versionado nunca é editado à mão).
 */
test.describe('matriz de efetividade', () => {
  // Retry repetiria a medição até concordar e esconderia divergência entre rodadas.
  test.describe.configure({ retries: 0 });

  test('estado do locator e reprodução do teste baseline, sem recuperação', async ({ context }) => {
    test.setTimeout(30 * 60_000);

    const rows = await measureMatrix(context, CATALOG);
    for (const row of rows) {
      expect.soft(row.applied, `${row.id} aplicada na página de referência`).toBe(true);
      expect.soft(row.effect, `${row.id} efeito verificado`).toBe(true);
    }

    const content = `${JSON.stringify(
      { geradoPor: 'integration/mutation.spec.ts — não editar à mão', linhas: rows },
      null,
      2,
    )}\n`;

    const out = process.env.MUTATION_MATRIX_OUT;
    if (out) {
      await writeFile(path.resolve(out), content, 'utf8');
    } else {
      expect(content).toBe(await readFile(MATRIX_PATH, 'utf8'));
    }
  });
});
