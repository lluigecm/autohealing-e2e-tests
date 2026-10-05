import { writeFileSync } from 'fs';
import { resolve } from 'path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { categoriasAmostradas } from '../tests/fixtures/amostras';
import { ATTACHMENT_NAME, CallRecord, Relation } from './targetTestMap';

/**
 * Agrega os registros de `targetTestMap.ts` em `mutation/target-test-map.json`.
 *
 * Duas definições de "o teste exercita o alvo":
 * - **A**: algum locator do teste resolve o alvo ou passa por ele (qualquer relação);
 * - **B**: algum locator do teste resolve exatamente o alvo, e só ele (`resolve`) —
 *   a asserção ou ação do método recai sobre o próprio alvo.
 * Também sai **A sem coleção** (`resolve` ou `ancestral`), para mostrar quanto de A
 * vem de locators de coleção.
 *
 * Só grava se os 66 testes passaram, todos geraram registro e cada um exercita
 * ao menos um alvo nas duas definições; senão, falha sem tocar no arquivo.
 */

const EXPECTED_TESTS = 66;
const DEFAULT_OUT = resolve(__dirname, 'target-test-map.json');
const TARGET_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

type Definition = 'A' | 'A_semColecao' | 'B';

const IN_DEFINITION: Record<Definition, (r: Relation) => boolean> = {
  A: () => true,
  A_semColecao: (r) => r === 'resolve' || r === 'ancestral',
  B: (r) => r === 'resolve',
};

interface TestEntry {
  id: string;
  fluxo: string;
  categoria: string | null;
  chamadas: CallRecord[];
}

/** O fluxo é o título com o nome da categoria trocado por `<categoria>`. */
function flowOf(file: string, title: string): { fluxo: string; categoria: string | null } {
  // As aspas evitam que "Art" case dentro de "Sequential Art".
  const categoria = categoriasAmostradas.find((c) => title.includes(`"${c.nome}"`))?.nome ?? null;
  const template = categoria ? title.replace(`"${categoria}"`, '"<categoria>"') : title;
  return { fluxo: `${file} › ${template}`, categoria };
}

function targetsOf(entry: TestEntry, definition: Definition): Set<string> {
  const ids = new Set<string>();
  for (const call of entry.chamadas) {
    for (const hit of call.alvos) {
      if (IN_DEFINITION[definition](hit.relacao)) {
        ids.add(hit.alvo);
      }
    }
  }
  return ids;
}

function instancesOf(entry: TestEntry, definition: Definition): Set<string> {
  const keys = new Set<string>();
  for (const call of entry.chamadas) {
    for (const hit of call.alvos) {
      if (IN_DEFINITION[definition](hit.relacao)) {
        keys.add(hit.instancia);
      }
    }
  }
  return keys;
}

class TargetTestMapReporter implements Reporter {
  private order: TestCase[] = [];
  private results = new Map<TestCase, TestResult>();

  onBegin(_config: unknown, suite: Suite): void {
    this.order = suite.allTests();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.set(test, result);
  }

  async onEnd(_result: FullResult): Promise<{ status: FullResult['status'] } | void> {
    const problems: string[] = [];
    if (this.order.length !== EXPECTED_TESTS) {
      problems.push(`esperados ${EXPECTED_TESTS} testes, encontrados ${this.order.length}`);
    }

    const entries: TestEntry[] = this.order.map((test) => {
      const file = test.location.file.replace(/\\/g, '/').replace(/^.*\/tests\//, 'tests/');
      const result = this.results.get(test);
      if (result?.status !== 'passed') {
        problems.push(`não passou (${result?.status ?? 'não executou'}): ${test.title}`);
      }
      const chamadas = (result?.attachments ?? [])
        .filter((a) => a.name === ATTACHMENT_NAME && a.body)
        .map((a) => JSON.parse(a.body!.toString('utf8')) as CallRecord);
      if (chamadas.length === 0) {
        problems.push(`nenhuma chamada registrada (hook não instalado?): ${test.title}`);
      }
      return { id: `${file} › ${test.title}`, ...flowOf(file, test.title), chamadas };
    });

    // Ser de coleção é propriedade do locator, não do tamanho da página: o
    // `role=article` de `getProductCount` resolve 1 elemento em Crime (1 livro)
    // e 20 em Mystery. Um par (método, locator) que resolve N > 1 em alguma
    // chamada da execução é de coleção em todas.
    const collectionKey = (c: CallRecord) => `${c.metodo}|${c.locator}`;
    const collections = new Set(entries.flatMap((e) => e.chamadas.filter((c) => c.resolvidos > 1).map(collectionKey)));
    for (const entry of entries) {
      for (const call of entry.chamadas) {
        call.colecao = collections.has(collectionKey(call));
        if (call.colecao) {
          for (const hit of call.alvos) {
            hit.relacao = hit.relacao === 'resolve' ? 'resolve-colecao' : hit.relacao === 'ancestral' ? 'ancestral-colecao' : hit.relacao;
          }
        }
      }
    }

    const flows = [...new Set(entries.map((e) => e.fluxo))];
    const fluxos = flows.map((fluxo) => {
      const inFlow = entries.filter((e) => e.fluxo === fluxo);
      const union = (d: Definition) =>
        TARGET_IDS.filter((t) => inFlow.some((e) => targetsOf(e, d).has(t)));
      return { fluxo, testes: inFlow.length, alvosA: union('A'), alvosB: union('B') };
    });

    const alvos = Object.fromEntries(
      TARGET_IDS.map((id) => {
        const tests = (d: Definition) => entries.filter((e) => targetsOf(e, d).has(id)).map((e) => e.id);
        const porFluxo = flows
          .map((fluxo) => {
            const inFlow = entries.filter((e) => e.fluxo === fluxo);
            const count = (d: Definition) => inFlow.filter((e) => targetsOf(e, d).has(id)).length;
            const relacoes = [
              ...new Set(
                inFlow.flatMap((e) => e.chamadas.flatMap((c) => c.alvos.filter((h) => h.alvo === id).map((h) => h.relacao))),
              ),
            ].sort();
            return { fluxo, testesNoFluxo: inFlow.length, A: count('A'), A_semColecao: count('A_semColecao'), B: count('B'), relacoes };
          })
          .filter((row) => row.A > 0);
        const summary: Record<string, unknown> = {
          A: tests('A').length,
          A_semColecao: tests('A_semColecao').length,
          B: tests('B').length,
          porFluxo,
        };
        if (id === 'T1') {
          const instances = [...new Set(entries.flatMap((e) => [...instancesOf(e, 'A')]))].filter((k) => k.startsWith('T1-'));
          summary.porInstancia = Object.fromEntries(
            instances.sort().map((key) => [
              key,
              {
                A: entries.filter((e) => instancesOf(e, 'A').has(key)).length,
                B: entries.filter((e) => instancesOf(e, 'B').has(key)).length,
              },
            ]),
          );
        }
        summary.testesA = tests('A');
        summary.testesB = tests('B');
        return [id, summary];
      }),
    );

    const semAlvo = (d: Definition) => entries.filter((e) => targetsOf(e, d).size === 0).map((e) => e.id);
    const verificacao = {
      totalTestes: entries.length,
      somaDosFluxos: fluxos.reduce((sum, f) => sum + f.testes, 0),
      testesComChamadas: entries.filter((e) => e.chamadas.length > 0).length,
      semAlvoA: semAlvo('A'),
      semAlvoB: semAlvo('B'),
    };
    if (verificacao.somaDosFluxos !== EXPECTED_TESTS) {
      problems.push(`soma dos fluxos = ${verificacao.somaDosFluxos}`);
    }
    if (verificacao.semAlvoA.length > 0 || verificacao.semAlvoB.length > 0) {
      problems.push(`testes sem alvo: A=${verificacao.semAlvoA.length}, B=${verificacao.semAlvoB.length}`);
    }

    if (problems.length > 0) {
      console.error(`[target-map] mapa NÃO gravado:\n  ${problems.join('\n  ')}`);
      return { status: 'failed' };
    }

    const map = {
      geradoPor: 'mutation/targetTestMap.config.ts (execução dos 66 testes de tests/) — não editar à mão',
      definicoes: {
        A: 'algum locator do teste resolve o alvo ou passa por ele (relações resolve, resolve-colecao, ancestral, ancestral-colecao)',
        A_semColecao: 'como A, excluindo locators de coleção (só resolve e ancestral)',
        B: 'algum locator do teste resolve exatamente o alvo e só ele (relação resolve): a asserção ou ação recai sobre o alvo',
        relacoes: {
          resolve: 'o locator resolve um único elemento, que é o alvo',
          'resolve-colecao': 'o locator é de coleção e o alvo é um dos elementos resolvidos',
          ancestral: 'o alvo é ancestral do único elemento resolvido',
          'ancestral-colecao': 'o locator é de coleção e o alvo é ancestral de algum dos elementos resolvidos',
        },
        colecao: 'um par (método, locator) é de coleção se resolve N > 1 elementos em alguma chamada da execução; vale para todas as suas chamadas, inclusive onde a página tem 1 elemento só',
        identificacaoDoAlvo: 'seletor CSS do catálogo (mutation/catalog.ts), avaliado na página em que a chamada acontece',
      },
      verificacao,
      fluxos,
      alvos,
      testes: entries,
    };
    const out = process.env.TARGET_MAP_OUT ? resolve(process.env.TARGET_MAP_OUT) : DEFAULT_OUT;
    writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
    console.log(`[target-map] gravado: ${out}`);
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default TargetTestMapReporter;
