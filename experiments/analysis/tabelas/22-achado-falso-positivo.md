# Achado: falso positivo e corroboração por texto indisponível

Regra: ADR-014; ADR-012; registrado como achado no ADR-032, decidido depois dos dados. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| entrada | entradas de log com replace | text vazio no fingerprint | corroboração indisponível | fator de texto 1 | score | siblingIndex do alvo (baseline) | siblingIndex do candidato | fingerprint de baseline na posição do candidato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M5-T10 | 96 | 96/96 | 96/96 | 96/96 | 0,925 | 3 | 2 | .product_main p.instock.availability 96/96 |

Fingerprints de baseline de `healing/fingerprints/`, conferidos como idênticos aos do commit da rodada. O siblingIndex do candidato vem do último `:nth-child` do seletor registrado (base 0). A última coluna é o fingerprint da mesma página com o mesmo pai, a mesma profundidade e o siblingIndex do candidato.
