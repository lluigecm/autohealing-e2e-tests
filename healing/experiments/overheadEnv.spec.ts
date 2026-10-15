import { test, expect } from '@playwright/test';
import path from 'path';
import { readOverheadEnv } from '../../experiments/overheadEnv';

/**
 * Proteções do ambiente da medição do custo da captura: a config recusa rodar
 * com o healing ligado, com a captura fora da condição ou gravando fora do
 * diretório da rodada.
 */

const VARIAVEIS = [
  'OVERHEAD_INVOCATION',
  'OVERHEAD_CONDITION',
  'OVERHEAD_RUN_DIR',
  'OVERHEAD_ATTEMPT',
  'HEALING',
  'HEALING_CAPTURE',
  'HEALING_FINGERPRINTS_DIR',
] as const;

const RUN_DIR = path.resolve('experiments', 'runs', 'overhead-captura-ficticia');

let saved: Record<string, string | undefined>;

test.beforeEach(() => {
  saved = Object.fromEntries(VARIAVEIS.map((name) => [name, process.env[name]]));
  for (const name of VARIAVEIS) {
    delete process.env[name];
  }
  process.env.OVERHEAD_INVOCATION = 'par-01';
  process.env.OVERHEAD_CONDITION = 'captura-ligada';
  process.env.OVERHEAD_RUN_DIR = RUN_DIR;
  process.env.HEALING_FINGERPRINTS_DIR = path.join(RUN_DIR, 'captura-ligada', 'par-01', 'attempt-1', 'fingerprints');
});

test.afterEach(() => {
  for (const name of VARIAVEIS) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

test('captura ligada com o ambiente correto: lido', () => {
  expect(readOverheadEnv()).toMatchObject({ invocation: 'par-01', condition: 'captura-ligada', attempt: 1 });
});

test('captura desligada exige HEALING_CAPTURE=off', () => {
  process.env.OVERHEAD_CONDITION = 'captura-desligada';
  expect(() => readOverheadEnv()).toThrow(/não corresponde/);

  process.env.HEALING_CAPTURE = 'off';
  expect(readOverheadEnv().condition).toBe('captura-desligada');
});

test('captura ligada recusa HEALING_CAPTURE definida', () => {
  process.env.HEALING_CAPTURE = 'off';
  expect(() => readOverheadEnv()).toThrow(/não corresponde/);

  process.env.HEALING_CAPTURE = 'on';
  expect(() => readOverheadEnv()).toThrow(/não corresponde/);
});

test('recusa HEALING definida, inclusive off', () => {
  process.env.HEALING = 'off';
  expect(() => readOverheadEnv()).toThrow(/HEALING tem de estar ausente/);
});

test('recusa gravar em healing/fingerprints/ ou fora da rodada', () => {
  process.env.HEALING_FINGERPRINTS_DIR = path.resolve(__dirname, '..', 'fingerprints');
  expect(() => readOverheadEnv()).toThrow(/dentro da rodada/);

  process.env.HEALING_FINGERPRINTS_DIR = path.resolve('outro-lugar');
  expect(() => readOverheadEnv()).toThrow(/dentro da rodada/);
});

test('recusa rodar sem os parâmetros do orquestrador', () => {
  delete process.env.OVERHEAD_RUN_DIR;
  expect(() => readOverheadEnv()).toThrow(/obrigatórios/);
});
