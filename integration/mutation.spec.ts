// Antes de qualquer import que alcance `withCapture`: sob DOM mutado, nenhuma
// ação pode regravar o baseline versionado (ADR-017).
process.env.HEALING_CAPTURE = 'off';

import { test, expect } from '@playwright/test';
import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { findMutation } from '../mutation/catalog';
import { applyMutation, readMutationState } from '../mutation/applyMutation';

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

test.beforeAll(async () => {
  hashBefore = await baselineHash();
});

test.afterAll(async () => {
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
