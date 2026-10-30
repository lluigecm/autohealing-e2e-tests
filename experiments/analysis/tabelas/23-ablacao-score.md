# Ablação do score de confiança, limiar 0,7 — SECUNDÁRIA, APROXIMADA E POSTERIOR AOS DADOS

Regra: ADR-033, especificação da monografia e script posteriores aos dados; classes e agregação, ADR-025; denominador da matriz, ADR-024; não acionado, ADR-032, decidido depois dos dados; indeterminada como na sensibilidade, ADR-027 (adendo). Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| configuração | recuperadas | ao lado, sem não acionadas | indeterminadas | entradas com cura incorreta | falso positivo bruto | ao lado, sem não acionadas | falso positivo por alvo | ao lado, sem alvos não acionados | T1 (categorias) | entradas com falso positivo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (i) rawScore: saída bruta da heurística estrutural | 3/6 | 3/5 | 1 | 0 | 23/24 | 23/23 | 8/9 | 8/8 | 16 de 16 | M5-T1-crime_51; M5-T1-historical_42; M5-T1-contemporary_38; M5-T1-health_47; M5-T1-biography_36; M5-T1-christian-fiction_34; M5-T1-psychology_26; M5-T1-art_25; M5-T1-autobiography_27; M5-T1-humor_30; M5-T1-travel_2; M5-T1-music_14; M5-T1-history_32; M5-T1-mystery_3; M5-T1-sequential-art_5; M5-T1-default_15; M5-T3; M5-T5; M5-T6; M5-T7; M5-T8; M5-T9; M5-T10 |
| (ii) rawScore × fator de ambiguidade | 3/6 | 3/5 | 1 | 0 | 10/24 | 10/23 | 7/9 | 7/8 | 4 de 16 | M5-T1-music_14; M5-T1-mystery_3; M5-T1-sequential-art_5; M5-T1-default_15; M5-T3; M5-T6; M5-T7; M5-T8; M5-T9; M5-T10 |
| (iii) score completo (registrado) | 3/6 | 3/5 | 0 | 0 | 1/24 | 1/23 | 1/9 | 1/8 | 0 de 16 | M5-T10 |

Recalculada offline a partir do log (rawScore e fatores), sem nenhuma execução nova. O candidato é o mesmo nas três configurações; só a decisão muda. É aproximada: o log só tem o caminho que o score completo produziu, e uma substituição diferente mudaria o resto do teste.

"Indeterminada": alguma execução passaria de fail para replace no elemento certo, e o desfecho do teste nesse caminho não foi observado. Nenhuma execução indeterminada conta como sucesso, e uma entrada indeterminada não conta como recuperada.

"Ao lado": a fração sem as entradas (ou alvos) não acionadas, que não dependem da configuração (ADR-032, decidido depois dos dados).

Verificações, todas obrigatórias (ADR-033, especificação da monografia e script posteriores aos dados): (1) a configuração (iii) reproduz as classes de cada execução, o desfecho de cada uma das 30 entradas e as frações do resultado principal: sim. (2) score = rawScore × disagreement × ambiguity × text: 930/930 eventos do log; (3) factors.disagreement = 1: 930/930 eventos do log; (4) heurística de atributos estáveis inaplicável: 930/930 eventos do log; (5) rawScore = score da heurística estrutural: 930/930 eventos do log. Tolerância numérica absoluta de 1e-9.
