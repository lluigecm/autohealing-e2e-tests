# Análise de sensibilidade do limiar — SECUNDÁRIA E APROXIMADA

Regra: ADR-027 (adendo); limiar inclusivo, ADR-016. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| limiar |  | recuperadas | indeterminadas | entradas com cura incorreta | falso positivo bruto | falso positivo por alvo | T1 (categorias) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0,00 |  | 3/6 | 1 | 0 | 23/24 | 8/9 | 16 de 16 |
| 0,05 |  | 3/6 | 1 | 0 | 23/24 | 8/9 | 16 de 16 |
| 0,10 |  | 3/6 | 1 | 0 | 23/24 | 8/9 | 16 de 16 |
| 0,15 |  | 3/6 | 1 | 0 | 23/24 | 8/9 | 16 de 16 |
| 0,20 |  | 3/6 | 1 | 0 | 12/24 | 8/9 | 5 de 16 |
| 0,25 |  | 3/6 | 1 | 0 | 10/24 | 7/9 | 4 de 16 |
| 0,30 |  | 3/6 | 1 | 0 | 10/24 | 7/9 | 4 de 16 |
| 0,35 |  | 3/6 | 1 | 0 | 10/24 | 7/9 | 4 de 16 |
| 0,40 |  | 3/6 | 1 | 0 | 10/24 | 7/9 | 4 de 16 |
| 0,45 |  | 3/6 | 1 | 0 | 7/24 | 7/9 | 1 de 16 |
| 0,50 |  | 3/6 | 1 | 0 | 6/24 | 6/9 | 1 de 16 |
| 0,55 |  | 3/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,60 |  | 3/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,65 |  | 3/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,70 | principal | 3/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,75 |  | 2/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,80 |  | 2/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,85 |  | 2/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,90 |  | 2/6 | 0 | 0 | 1/24 | 1/9 | 0 de 16 |
| 0,95 |  | 2/6 | 0 | 0 | 0/24 | 0/9 | 0 de 16 |
| 1,00 |  | 2/6 | 0 | 0 | 0/24 | 0/9 | 0 de 16 |

Recalculada offline a partir do score registrado em cada entrada de log (rawScore × fatores), sem nenhuma execução nova. É aproximada: o log só tem o caminho que o limiar 0,7 produziu, e uma substituição diferente mudaria o resto do teste.

"Indeterminada": alguma execução passaria de fail para replace no elemento certo, e o desfecho do teste nesse caminho não foi observado. Nenhuma execução indeterminada conta como sucesso.

Grade fixa de 0,00 a 1,00, de 0,05 em 0,05, registrada depois dos dados (ADR-032, decidido depois dos dados). Os scores exatos de cada entrada estão em 20-scores-por-entrada.
