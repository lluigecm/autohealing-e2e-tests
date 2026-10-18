# Falso positivo bruto, por entrada (k/24), limiar 0,7

Regra: relato bruto e por alvo, ADR-020; agregação, ADR-025; entrada não acionada, ADR-032, decidido depois dos dados. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| entrada | alvo | instância | replace (execuções) | fail (execuções) | não acionado (execuções) | score | desfecho da entrada |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M5-T1-crime_51 | T1 | T1-crime_51 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-historical_42 | T1 | T1-historical_42 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-contemporary_38 | T1 | T1-contemporary_38 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-health_47 | T1 | T1-health_47 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-biography_36 | T1 | T1-biography_36 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-christian-fiction_34 | T1 | T1-christian-fiction_34 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-psychology_26 | T1 | T1-psychology_26 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-art_25 | T1 | T1-art_25 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-autobiography_27 | T1 | T1-autobiography_27 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-humor_30 | T1 | T1-humor_30 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-travel_2 | T1 | T1-travel_2 | 0/3 | 3/3 | 0/3 | 0,212 | fail em todas |
| M5-T1-music_14 | T1 | T1-music_14 | 0/3 | 3/3 | 0/3 | 0,412 | fail em todas |
| M5-T1-history_32 | T1 | T1-history_32 | 0/3 | 3/3 | 0/3 | 0,194 | fail em todas |
| M5-T1-mystery_3 | T1 | T1-mystery_3 | 0/3 | 3/3 | 0/3 | 0,500 | fail em todas |
| M5-T1-sequential-art_5 | T1 | T1-sequential-art_5 | 0/3 | 3/3 | 0/3 | 0,412 | fail em todas |
| M5-T1-default_15 | T1 | T1-default_15 | 0/3 | 3/3 | 0/3 | 0,412 | fail em todas |
| M5-T3 | T3 | T3 | 0/144 | 144/144 | 0/144 | 0,250; 0,275; 0,500 | fail em todas |
| M5-T4 | T4 | T4 | 0/3 | 0/3 | 3/3 | sem entrada de log | não acionado |
| M5-T5 | T5 | T5 | 0/48 | 48/48 | 0/48 | 0,206 | fail em todas |
| M5-T6 | T6 | T6 | 0/51 | 51/51 | 0/51 | 0,388; 0,412; 0,425; 0,450; 0,500 | fail em todas |
| M5-T7 | T7 | T7 | 0/48 | 48/48 | 0/48 | 0,450 | fail em todas |
| M5-T8 | T8 | T8 | 0/96 | 96/96 | 0/96 | 0,500 | fail em todas |
| M5-T9 | T9 | T9 | 0/96 | 96/96 | 0/96 | 0,500 | fail em todas |
| M5-T10 | T10 | T10 | 48/48 | 0/48 | 0/48 | 0,925 | falso positivo |

Falso positivo: 1/24 entradas, com o denominador da matriz (ADR-024). Ao lado: 1/23 sem a entrada não acionada (M5-T4) (ADR-032, decidido depois dos dados).

Fail em todas as execuções: 22/24. Não acionado: 1/24 (M5-T4). Fail e não acionado na mesma entrada: 0/24.

Uma entrada não acionada não é falso positivo, porque não houve replace, e não conta a favor, porque não houve fail (ADR-032, decidido depois dos dados).
