/**
 * Tipos e metadados da ferramenta de mutação de DOM.
 *
 * Cada mutação carrega o próprio rótulo de verdade (ground truth), consumido
 * pelo harness dos experimentos para calcular taxa de recuperação e taxa de
 * falso positivo — o harness nunca infere o rótulo, só o lê daqui.
 */

export type MutationType =
  | 'volatile-attributes'
  | 'text-change'
  | 'reorder-siblings'
  | 'wrap-in-container'
  | 'remove-element';

export interface MutationMetadata {
  /** Código curto usado no texto do TCC e nos ADRs. */
  code: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
  /**
   * `cosmetic`: o alvo continua existindo e a recuperação deve relocalizá-lo.
   * `defect`: o alvo deixa de existir — qualquer "recuperação" é falso positivo.
   */
  class: 'cosmetic' | 'defect';
  /**
   * Exigido pelo ADR-012: a taxa de falso positivo é reportada separando as
   * mutações que alteram a ordem dos irmãos das que a preservam.
   */
  preservesOrder: boolean;
  /** O que um mecanismo correto deveria fazer sob esta mutação. */
  expectedOutcome: 'recover' | 'fail';
}

/** Fonte única dos rótulos — cada entrada do catálogo copia o do seu tipo. */
export const MUTATION_METADATA: Readonly<Record<MutationType, Readonly<MutationMetadata>>> = Object.freeze({
  'volatile-attributes': Object.freeze({ code: 'M1', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' }),
  'text-change': Object.freeze({ code: 'M2', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' }),
  'reorder-siblings': Object.freeze({ code: 'M3', class: 'cosmetic', preservesOrder: false, expectedOutcome: 'recover' }),
  'wrap-in-container': Object.freeze({ code: 'M4', class: 'cosmetic', preservesOrder: true, expectedOutcome: 'recover' }),
  'remove-element': Object.freeze({ code: 'M5', class: 'defect', preservesOrder: true, expectedOutcome: 'fail' }),
});

export type TargetId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10';

/** Elemento concreto da página real que a mutação transforma. */
export interface MutationTarget {
  id: TargetId;
  /** Identificador único — difere de `id` só no T1, instanciado por categoria. */
  key: string;
  description: string;
  /**
   * Seletor CSS do lado da mutação: conhece o DOM do books.toscrape.com e não
   * tem relação com os locators dos Page Objects. Resolve para o primeiro match.
   */
  selector: string;
  /**
   * Chave do fingerprint de baseline correspondente (mesmos campos de
   * `Fingerprint`, aceita direto por `fingerprintPath`): a página de referência
   * onde o alvo foi capturado e a descrição do locator no `withCapture`.
   */
  baseline: { url: string; selector: string };
}

/**
 * Como o M2 altera o texto visível.
 * `relabel`: troca o texto inteiro por um fixo (cenário de localização).
 * `drop-last-token`: edição leve — remove o último token separado por espaço.
 * `append-token`: edição leve — acrescenta um token ao fim do texto.
 */
export type TextChange =
  | { kind: 'relabel'; text: string }
  | { kind: 'drop-last-token' }
  | { kind: 'append-token'; token: string };

interface MutationSpecBase {
  /** Identificador estável da entrada, ex: `M1-T1-travel_2`. */
  id: string;
  target: MutationTarget;
  meta: Readonly<MutationMetadata>;
}

/**
 * Par (tipo, alvo) do catálogo. Os campos extras por tipo são os únicos
 * parâmetros da transformação — nada é sorteado.
 */
export type MutationSpec =
  /** Reescreve `class` e `id` do alvo, definindo-os mesmo quando ausentes. */
  | (MutationSpecBase & { type: 'volatile-attributes' })
  | (MutationSpecBase & { type: 'text-change'; text: TextChange })
  /** Inverte a ordem dos filhos de `group`, que deve conter o alvo. */
  | (MutationSpecBase & { type: 'reorder-siblings'; group: string })
  /** Envolve o alvo num `<div>` sem atributos. */
  | (MutationSpecBase & { type: 'wrap-in-container' })
  | (MutationSpecBase & { type: 'remove-element' });

/** Propriedade de `window` onde a mutação aplicada deixa o oráculo. */
export const MUTATION_STATE_KEY = '__mutation';

/**
 * Oráculo do alvo, guardado como propriedade JavaScript de `window` — nunca
 * como atributo: um `data-*`/`aria-*` no DOM contaminaria a heurística de
 * atributos estáveis (ADR-006/007).
 *
 * `applied: false` significa que nada foi transformado: o alvo não existe na
 * página (ex: o link "Travel" na própria página Travel), o grupo do M3 não o
 * contém, ou a edição leve `drop-last-token` caiu num texto de um token só.
 * `applied: true` com `oracle: null` é o M5: o alvo foi removido e toda
 * recuperação é incorreta por definição.
 */
export interface MutationState {
  id: string;
  applied: boolean;
  oracle: Element | null;
}
