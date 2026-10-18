# Custo da captura de fingerprint (medição complementar)

Regra: ADR-031, cálculo pela análise versionada antes dos dados (`experiments/overheadAnalysis.mts`). Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| métrica | n | mediana (ms) | Q1 (ms) | Q3 (ms) | razão (%) | regra de relato |
| --- | --- | --- | --- | --- | --- | --- |
| 1. extração, por chamada | 2310 | 28,540 | 5,500 | 32,112 | — | — |
| 1. gravação, por chamada | 2310 | 3,835 | 3,688 | 4,062 | — | — |
| 1. extração + gravação, por execução de teste | 660 | 85,629 | 78,996 | 96,693 | — | — |
| 2. duração por teste: diferença pareada das medianas (ligada − desligada) | 66 | 29,250 | -4,750 | 76,125 | 1,85 | diferença de ponta a ponta não distinguível do ruído da rede |
| 3. tempo total da execução da suíte: diferença por par (ligada − desligada) | 10 | 2894,000 | -422,250 | 6983,250 | 4,59 | diferença de ponta a ponta não distinguível do ruído da rede |

Pares completos: 10 (par-01, par-02, par-03, par-04, par-05, par-06, par-07, par-08, par-09, par-10). Pares excluídos por lado não medido: nenhum. Aquecimento fora de todas as métricas.

Extrações sem fingerprint: 0.

4. Fingerprints versionados: 134 arquivos, 52047 bytes no total; mínimo 311, mediana 387,5, máximo 855 bytes.

Quartis por interpolação linear (tipo 7 de Hyndman e Fan). Razão: mediana das diferenças dividida pela mediana sem captura.
