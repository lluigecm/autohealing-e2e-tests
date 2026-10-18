# Integridade das rodadas

Regra: ADR-027 (adendo: cópia sem edição) e ADR-031 (manifesto); última tentativa de cada invocação, ADR-028. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| rodada | arquivos no manifesto | conferidos | divergentes | ausentes | fora do manifesto | commit | árvore limpa | invocações com desfecho | medidas | invocações reexecutadas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-12T16-32-03-131Z | 2506 | 2506 | 0 | 0 | 0 | 09289cf | sim | 206 | 206 | M1-T9\|healing-on |
| overhead-captura-2026-10-15T15-16-16-991Z | 1599 | 1599 | 0 | 0 | 0 | f81e922 | sim | 21 | 21 | par-03\|captura-desligada; par-07\|captura-desligada |

Matriz de efetividade lida do commit da rodada (`git show 09289cf:mutation/effectiveness-matrix.json`); idêntica à da árvore atual: sim.

Coerência do log com os eventos dos testes (execuções previstas, nenhuma inválida na tentativa usada, nenhuma entrada de log órfã ou na condição desligada, decisão coerente com score e limiar 0,7): sem problemas.
