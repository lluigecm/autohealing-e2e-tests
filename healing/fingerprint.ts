/**
 * Schema do fingerprint capturado para cada elemento localizado com sucesso.
 * Os campos aqui são o contrato consumido pelas heurísticas de recuperação
 * (similaridade estrutural e atributos estáveis) nas etapas seguintes.
 */

export interface FingerprintAttributes {
  /** `data-*` e `aria-*` — base da heurística de atributos estáveis. */
  stable: Record<string, string>;
  /** Voláteis: contexto/fallback, não base de decisão. */
  volatile: {
    class: string | null;
    id: string | null;
  };
}

export interface FingerprintPosition {
  parentTag: string | null;
  /** Índice do pai entre os filhos do avô. */
  parentSiblingIndex: number | null;
  /** Índice do próprio elemento entre os filhos do pai. */
  siblingIndex: number;
  /** Número de ancestrais entre o elemento e `<body>` (filho direto de body = 0). */
  depth: number;
}

export interface Fingerprint {
  /** Descrição do seletor original, fornecida manualmente em cada `withCapture`. */
  selector: string;
  /** Pathname da página onde o elemento foi capturado. */
  url: string;
  tag: string;
  /** Texto visível, com espaços em branco normalizados. */
  text: string;
  attributes: FingerprintAttributes;
  position: FingerprintPosition;
}
