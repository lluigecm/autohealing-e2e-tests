# Denominadores e exclusões

Regra: ADR-020 (denominadores pela matriz versionada, ADR-024). Gerado por `experiments/resultsAnalysis.mts`; não editar à mão.

| conjunto | previsto | medido | entradas |
| --- | --- | --- | --- |
| recuperação (cosmética, locator quebra) | 6 | 6 | M1-T8; M1-T9; M1-T10; M2-T1-travel_2-relabel; M2-T1-sequential-art_5-append-token; M2-T4-relabel |
| falso positivo (M5, locator quebra) | 24 | 24 | M5-T1-crime_51; M5-T1-historical_42; M5-T1-contemporary_38; M5-T1-health_47; M5-T1-biography_36; M5-T1-christian-fiction_34; M5-T1-psychology_26; M5-T1-art_25; M5-T1-autobiography_27; M5-T1-humor_30; M5-T1-travel_2; M5-T1-music_14; M5-T1-history_32; M5-T1-mystery_3; M5-T1-sequential-art_5; M5-T1-default_15; M5-T3; M5-T4; M5-T5; M5-T6; M5-T7; M5-T8; M5-T9; M5-T10 |
| fora dos denominadores (locator desvia) | 3 | 3 | M3-T2; M3-T3; M5-T2 |
| inertes | 70 | 70 | 70 entradas |
| entradas não medidas | 0 | 0 | nenhuma |
| execuções excluídas por applied: false | 0 | 0 | de 4040 execuções; por entrada em 03-exclusoes-applied |
