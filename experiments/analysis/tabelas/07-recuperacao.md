# Recuperação: uma linha por entrada do denominador, limiar 0,7

Regra: tabela individual e fração com absoluto, ADR-020; classes e agregação, ADR-025. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| entrada | alvo | mutação | score | decisão (entradas de log) | elemento certo (entradas de log) | teste passa (execuções) | sucesso | elemento certo, teste falha | cura incorreta | fail | não acionado | desfecho da entrada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1-T8 | T8 | M1 | 1,000 | replace 96/96 | sim 96/96 | 96/96 | 96/96 | 0/96 | 0/96 | 0/96 | 0/96 | recuperada |
| M1-T9 | T9 | M1 | 1,000 | replace 96/96 | sim 96/96 | 96/96 | 96/96 | 0/96 | 0/96 | 0/96 | 0/96 | recuperada |
| M1-T10 | T10 | M1 | 1,000 | replace 96/96 | sim 96/96 | 0/48 | 0/48 | 48/48 | 0/48 | 0/48 | 0/48 | não recuperada |
| M2-T1-travel_2-relabel | T1-travel_2 | M2 | 0,500 | fail 3/3 | sim 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 0/3 | não recuperada |
| M2-T1-sequential-art_5-append-token | T1-sequential-art_5 | M2 | 0,708 | replace 3/3 | sim 3/3 | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | recuperada |
| M2-T4-relabel | T4 | M2 | sem entrada de log | mecanismo não acionado |  | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | não recuperada |

Recuperadas: 3/6 entradas.

As cinco colunas de classe são a contagem bruta k/N das execuções da entrada (descritiva; não entra na taxa nem a recalcula). O desfecho exige sucesso em todas as execuções.

Score: valores distintos registrados no log da entrada. "Elemento certo" é o candidateIsOracle de cada entrada de log; uma execução pode ter mais de uma entrada de log.

"Não acionado" é a execução sem entrada de log. O log não registra se o locator resolveu: quando a ação não lança exceção (isVisible() devolve false, por exemplo), o locator pode não ter resolvido e mesmo assim não haver entrada. O detalhe por teste está em 12-divergencias-por-teste.
