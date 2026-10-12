import { BrowserContext, Page, TestInfo, test } from '@playwright/test';
import { configureHealing, HealingLogSink, jsonlSink } from '../healing/decision/recovery';
import { applyMutation, pointsToOracle } from '../mutation/applyMutation';
import { findMutation } from '../mutation/catalog';
import { MutationSpec, MUTATION_STATE_KEY } from '../mutation/types';
import { BasePage } from '../pages/BasePage';
import { harnessTestId, HarnessEnv, MUTATION_ANNOTATION, readHarnessEnv, workerFile } from './harnessEnv';

/**
 * Instalação do harness em cada processo que carrega `harness.config.ts`.
 *
 * Os 66 specs rodam sem alteração. A mutação entra por um patch em
 * `BasePage.prototype.goto`: todo teste começa por `HomePage.goto` ou
 * `CategoryPage.goto`, que chamam `super.goto`, e a mutação vai para o
 * contexto via `addInitScript` antes da primeira navegação, valendo também nas
 * páginas abertas por clique. Isso é igual nas duas condições.
 *
 * A recuperação não é montada aqui: com `HEALING=on`, ela já está em
 * `withCapture`. O harness só injeta o oráculo (para registro), o sink por
 * worker e o contexto da execução.
 */

const BINDING = '__harnessMutationState';

/** Repetição a partir de 1, como em `RunContext`. */
function repetitionOf(info: TestInfo): number {
  return info.repeatEachIndex + 1;
}

/**
 * Mutação mais o relato de `applied` em cada página. O relato roda em
 * `DOMContentLoaded` depois da mutação (os init scripts executam na ordem de
 * registro) e vira anotação do teste, que o reporter grava junto do resultado.
 */
async function installMutation(context: BrowserContext, spec: MutationSpec, info: TestInfo): Promise<void> {
  await applyMutation(context, spec);
  await context.exposeBinding(BINDING, (_source, state: { url: string; applied: boolean | null }) => {
    info.annotations.push({ type: MUTATION_ANNOTATION, description: JSON.stringify(state) });
  });
  await context.addInitScript({
    content: `(() => {
      const report = () => {
        const state = window[${JSON.stringify(MUTATION_STATE_KEY)}];
        window[${JSON.stringify(BINDING)}]({ url: location.pathname, applied: state ? state.applied : null });
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', report, { once: true });
      } else {
        report();
      }
    })();`,
  });
}

function patchGoto(spec: MutationSpec): void {
  const installed = new WeakSet<BrowserContext>();
  const original = BasePage.prototype.goto;
  BasePage.prototype.goto = async function goto(this: BasePage, target?: string): Promise<void> {
    // `page` é protegido no Page Object; o patch é o único acesso externo a ele.
    const context = (this as unknown as { page: Page }).page.context();
    if (!installed.has(context)) {
      installed.add(context);
      await installMutation(context, spec, test.info());
    }
    return original.call(this, target);
  };
}

/** Um arquivo por worker; o índice muda quando o Playwright reinicia um worker após falha. */
function perWorkerSink(env: HarnessEnv): HealingLogSink {
  const sinks = new Map<number, HealingLogSink>();
  return {
    filePath: workerFile(env, 'healing', 0),
    write(entry) {
      const index = test.info().workerIndex;
      let sink = sinks.get(index);
      if (!sink) {
        sink = jsonlSink(workerFile(env, 'healing', index));
        sinks.set(index, sink);
      }
      sink.write(entry);
    },
  };
}

export function installHarness(): void {
  const env = readHarnessEnv();
  // Sob DOM mutado, uma ação bem-sucedida regravaria o baseline versionado.
  process.env.HEALING_CAPTURE = 'off';
  patchGoto(findMutation(env.entryId));

  if (env.condition === 'healing-on') {
    configureHealing({
      oracle: pointsToOracle,
      sink: perWorkerSink(env),
      run: () => {
        const info = test.info();
        return {
          entryId: env.entryId,
          testId: harnessTestId(info.file, info.titlePath.slice(1)),
          repetition: repetitionOf(info),
          condition: env.condition,
        };
      },
    });
  }
}
