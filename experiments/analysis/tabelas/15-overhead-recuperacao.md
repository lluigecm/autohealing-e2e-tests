# Overhead da recuperação: custo passivo e custo ativo (recoveryMs)

Regra: ADR-027; mediana e intervalo mínimo–máximo, ADR-026. Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| medida | tipo | n | mediana (ms) | mínimo (ms) | máximo (ms) |
| --- | --- | --- | --- | --- | --- |
| custo passivo: diferença de duração por par (ligada − desligada) | principal | 825 | -3,0 | -3419,0 | 4433,0 |
| custo ativo: recoveryMs, todas as tentativas | principal | 930 | 27,9 | 9,4 | 77,9 |
| recoveryMs, decisão replace | descritivo | 387 | 18,2 | 9,4 | 58,1 |
| recoveryMs, decisão fail | descritivo | 543 | 34,8 | 20,7 | 77,9 |
| detectionWaitMs (início da ação até a exceção) | descritivo | 930 | 5011,4 | 4999,8 | 5027,9 |
| actionMs (ação com o candidato, só replace) | descritivo | 387 | 2,7 | 2,0 | 374,2 |

Pares elegíveis para o custo passivo: 825. A diferença de duração nos testes quebrados não entra, porque mede o timeout e não o mecanismo.

As linhas "descritivo" não são medidas definidas na regra; vêm do mesmo log e ficam como contexto.
