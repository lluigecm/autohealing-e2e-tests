# Fora dos denominadores: passa por engano e defect despercebido

Regra: ADR-020; detalhe por teste em 12-divergencias-por-teste (ADR-024). Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| entrada | categoria | condição | execuções | teste passou | mecanismo acionado (execuções) | decisões |
| --- | --- | --- | --- | --- | --- | --- |
| M3-T2 | passa por engano | healing-off | 198 | 198/198 | não se aplica |  |
| M3-T2 | passa por engano | healing-on | 198 | 198/198 | 0/198 |  |
| M3-T3 | passa por engano | healing-off | 144 | 144/144 | não se aplica |  |
| M3-T3 | passa por engano | healing-on | 144 | 144/144 | 0/144 |  |
| M5-T2 | defect despercebido | healing-off | 198 | 186/198 | não se aplica |  |
| M5-T2 | defect despercebido | healing-on | 198 | 186/198 | 9/198 | fail 9/9 |
