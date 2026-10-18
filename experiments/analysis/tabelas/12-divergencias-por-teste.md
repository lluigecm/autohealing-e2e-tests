# Testes cujo comportamento diverge da matriz (uma linha por teste)

Regra: ADR-024. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| entrada | matriz (locator / teste) | teste | applied | locator quebrou | mecanismo acionado | decisão | candidateIsOracle | passa (ligada) | passa (desligada) | causa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M2-T4-relabel | quebra / falha | tests/pagination.spec.ts › avança para a próxima página e exibe produtos diferentes | 6/6 | não registrado | 0/3 |  |  | 0/3 | 0/3 | mecanismo não acionado |
| M5-T2 | desvia / passa por engano | tests/category-navigation.spec.ts › navega da Home para a categoria "Crime" e exibe a listagem correspondente | 6/6 | não registrado | 0/3 |  |  | 0/3 | 0/3 | mecanismo não acionado |
| M5-T2 | desvia / passa por engano | tests/product-details.spec.ts › abre o primeiro produto de "Crime" a partir da listagem e exibe título, preço e disponibilidade | 6/6 | sim (3/3) | 3/3 | fail 3/3 | false 3/3 | 0/3 | 0/3 | mecanismo acionado com fail |
| M5-T2 | desvia / passa por engano | tests/product-details.spec.ts › produto de "Crime" exibe o preço no formato esperado e a informação de estoque | 6/6 | sim (3/3) | 3/3 | fail 3/3 | false 3/3 | 0/3 | 0/3 | mecanismo acionado com fail |
| M5-T2 | desvia / passa por engano | tests/product-details.spec.ts › produto de "Crime" exibe uma classificação por estrelas válida (1 a 5) | 6/6 | sim (3/3) | 3/3 | fail 3/3 | false 3/3 | 0/3 | 0/3 | mecanismo acionado com fail |
| M5-T4 | quebra / falha | tests/pagination.spec.ts › avança para a próxima página e exibe produtos diferentes | 6/6 | não registrado | 0/3 |  |  | 0/3 | 0/3 | mecanismo não acionado |

Diverge: entrada com locator "quebra" e alguma execução da condição ligada sem entrada de log; entrada "inerte" ou "desvia" com alguma entrada de log; ou resultado da condição desligada diferente do teste da matriz.

"Locator quebrou": o harness só registra a quebra quando a ação lança exceção e o mecanismo é acionado. Sem entrada de log, a quebra não é observável no log, e a coluna diz "não registrado".
