# Previsões registradas contra o observado na rodada principal

Regra: ADR-016, ADR-018, ADR-019, ADR-020, ADR-026 e ADR-027; classes do observado pelo ADR-025. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| fonte | entradas | previsto | observado (condição ligada) | situação |
| --- | --- | --- | --- | --- |
| ADR-020 (tabela); ADR-016 (1,00 sob reescrita de class/id) | M1-T8 | recuperar, score 1,00 | sucesso 96/96; score 1,000 | confirmada |
| ADR-020 (tabela); ADR-016 (1,00 sob reescrita de class/id) | M1-T9 | recuperar, score 1,00 | sucesso 96/96; score 1,000 | confirmada |
| ADR-019; ADR-020 (tabela) | M1-T10 | recupera o elemento, mas o teste falha (elemento certo, teste falha) | elemento certo, teste falha 48/48; score 1,000 | confirmada |
| ADR-018; ADR-020 (tabela) | M2-T1-travel_2-relabel | falhar: teto de 0,50 (falso negativo por construção) | fail 3/3; score 0,500 | confirmada |
| ADR-018; ADR-020 (tabela) | M2-T1-sequential-art_5-append-token | recuperar por ~0,008 acima do limiar, se a estrutural der ≥ ~0,988 | sucesso 3/3; score 0,708 | confirmada |
| ADR-020 (tabela, coluna "mecanismo atual") | M2-T4-relabel | falhar: teto de 0,50 | não acionado 3/3 | DIVERGENTE |
| ADR-020 (observação de previsão); ADR-027 (detecção por exceção) | M2-T4-relabel; M5-T4 | hasNextPage() usa isVisible(), que não lança exceção: a detecção por exceção não é acionada | M2-T4-relabel: não acionado 3/3; M5-T4: não acionado 3/3 | confirmada |
| ADR-020 (tabela) | M5 × T1 (16) | falhar | 16 de 16 entradas com fail em todas | confirmada |
| ADR-020 (tabela) | M5-T3 | risco de falso positivo; depende da corroboração por texto | fail 144/144; score 0,250; 0,275; 0,500 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T4 | falhar | não acionado 3/3 | DIVERGENTE |
| ADR-020 (tabela: M5 × T4–T10) | M5-T5 | falhar | fail 48/48; score 0,206 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T6 | falhar | fail 51/51; score 0,388; 0,412; 0,425; 0,450; 0,500 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T7 | falhar | fail 48/48; score 0,450 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T8 | falhar | fail 96/96; score 0,500 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T9 | falhar | fail 96/96; score 0,500 | confirmada |
| ADR-020 (tabela: M5 × T4–T10) | M5-T10 | falhar | replace 48/48; score 0,925 | DIVERGENTE |
| ADR-020 (tabela) | M3-T2 | não acionado; o teste passa sobre o elemento errado | 198/198 sem acionamento; 198/198 passaram | confirmada |
| ADR-020 (tabela) | M3-T3 | não acionado; o teste passa sobre o elemento errado | 144/144 sem acionamento; 144/144 passaram | confirmada |
| ADR-020 (tabela) | M5-T2 | não acionado; o teste passa sobre o elemento errado | 189/198 sem acionamento; 186/198 passaram; fora disso em 4 testes (tests/category-navigation.spec.ts › navega da Home para a categoria "Crime" e exibe a listagem correspondente; tests/product-details.spec.ts › abre o primeiro produto de "Crime" a partir da listagem e exibe título, preço e disponibilidade; tests/product-details.spec.ts › produto de "Crime" exibe o preço no formato esperado e a informação de estoque; tests/product-details.spec.ts › produto de "Crime" exibe uma classificação por estrelas válida (1 a 5)) | DIVERGENTE |
| ADR-020 (observação de previsão) | M5-T2, navegação para Crime | a mutação zera a listagem de Crime e getProductCount() > 0 falha nesse teste | teste falhou em 3/3 (desligada) e 3/3 (ligada) | confirmada |
| ADR-020 (tabela: M1 × T1–T7, M2 × T3, M3 inertes, M4); ADR-026 | 70 entradas inertes | não acionado e teste passando | 70 de 70 entradas sem acionamento e com todos os testes passando | confirmada |
| ADR-020 (denominadores) | matriz | 6 de recuperação e 24 de falso positivo | 6 e 24 | confirmada |

O observado usa as classes por execução: sucesso, elemento certo, teste falha, cura incorreta, fail e não acionado nas cosméticas; replace, fail e não acionado no M5.

A tabela de previsão do ADR-020 e a observação de previsão do mesmo ADR dizem coisas diferentes sobre o T4; as duas aparecem aqui, cada uma com a sua situação.
