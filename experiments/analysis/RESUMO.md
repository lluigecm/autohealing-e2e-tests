# Resumo da análise dos resultados

Gerado por `node experiments/resultsAnalysis.mts` a partir de `experiments/results/`; não editar à mão. Rodar de novo produz arquivos idênticos (`--check` confere).

- Rodada principal: `experiments/results/2026-10-12T16-32-03-131Z`, commit `09289cf`.
- Medição complementar da captura: `experiments/results/overhead-captura-2026-10-15T15-16-16-991Z`, commit `f81e922`.
- Limiar principal: 0,7, inclusivo (ADR-016; fixo na rodada pelo ADR-027 (adendo)).

## Divergências e lacunas

- Decidido depois dos dados (ADR-032): M2-T4-relabel e M5-T4 são classificadas como "não acionado", porque o mecanismo não foi acionado em nenhuma execução. Na recuperação, a entrada não acionada fica no denominador e fora do numerador; no falso positivo, não é falso positivo nem conta a favor. Resultados principais pelo denominador da matriz (ADR-024), com a fração sem as não acionadas ao lado: recuperação 3/6 (3/5), falso positivo 1/24 (1/23).
- Previsão divergente — ADR-020 (tabela, coluna "mecanismo atual"), M2-T4-relabel: previsto "falhar: teto de 0,50"; observado: não acionado 3/3.
- Previsão divergente — ADR-020 (tabela: M5 × T4–T10), M5-T4: previsto "falhar"; observado: não acionado 3/3.
- Previsão divergente — ADR-020 (tabela: M5 × T4–T10), M5-T10: previsto "falhar"; observado: replace 48/48; score 0,925.
- Previsão divergente — ADR-020 (tabela), M5-T2: previsto "não acionado; o teste passa sobre o elemento errado"; observado: 189/198 sem acionamento; 186/198 passaram; fora disso em 4 testes (tests/category-navigation.spec.ts › navega da Home para a categoria "Crime" e exibe a listagem correspondente; tests/product-details.spec.ts › abre o primeiro produto de "Crime" a partir da listagem e exibe título, preço e disponibilidade; tests/product-details.spec.ts › produto de "Crime" exibe o preço no formato esperado e a informação de estoque; tests/product-details.spec.ts › produto de "Crime" exibe uma classificação por estrelas válida (1 a 5)).
- Tabela completa das previsões: [tabelas/21-previsoes.md](tabelas/21-previsoes.md)

## 1. Integridade

- Manifestos SHA-256: rodada principal 2506/2506 arquivos conferidos, medição da captura 1599/1599; nenhum divergente, ausente ou fora do manifesto (ADR-027 (adendo: cópia sem edição) e ADR-031 (manifesto)). [tabelas/01-integridade.md](tabelas/01-integridade.md)
- Rodada principal: 206/206 invocações medidas; reexecutadas por infraestrutura: M1-T9|healing-on; vale a última tentativa (ADR-028).
- Medição da captura: 21/21 invocações medidas; reexecutadas: par-03|captura-desligada, par-07|captura-desligada (ADR-028).
- Coerência entre o log do mecanismo e os eventos dos testes: nenhum problema encontrado.

## 2. Condição desligada contra a matriz

- 0 divergências em 103 entradas (ADR-027). [tabelas/02-paridade-matriz.md](tabelas/02-paridade-matriz.md)

## 3. Não determinismo

- 0 divergências em 914 trios (entrada, teste, condição) com N = 3 (ADR-026). [tabelas/04-nao-determinismo.md](tabelas/04-nao-determinismo.md) · [tabelas/05-nao-determinismo-casos.md](tabelas/05-nao-determinismo-casos.md)

## 4. Denominadores e exclusões

- Recuperação: 6 entradas; falso positivo: 24; fora dos denominadores (desvio): 3 (ADR-020). [tabelas/06-denominadores.md](tabelas/06-denominadores.md)
- Execuções excluídas por `applied: false`: 0 de 4040 (ADR-024). Entradas não medidas: 0. [tabelas/03-exclusoes-applied.md](tabelas/03-exclusoes-applied.md)

## 5. Recuperação e falso positivo (limiar 0,7, resultado principal)

Classes por execução e agregação "na dúvida, contra o mecanismo": ADR-025. Relato por entrada, fração com absoluto, falso positivo bruto e por alvo: ADR-020.

- **Recuperação: 3/6 entradas recuperadas** (ADR-025; denominador da matriz, ADR-024); ao lado, 3/5 sem a entrada não acionada (M2-T4-relabel) (ADR-032, decidido depois dos dados). [tabelas/07-recuperacao.md](tabelas/07-recuperacao.md)
  - M1-T8: recuperada
  - M1-T9: recuperada
  - M1-T10: não recuperada
  - M2-T1-travel_2-relabel: não recuperada
  - M2-T1-sequential-art_5-append-token: recuperada
  - M2-T4-relabel: não recuperada
- Elemento certo, teste falha: M1-T10; cura incorreta (replace no elemento errado em mutação cosmética): nenhuma (ADR-025). [tabelas/08-categorias-a-parte.md](tabelas/08-categorias-a-parte.md)
- **Falso positivo bruto: 1/24 entradas** (M5-T10) (ADR-025; denominador da matriz, ADR-024); ao lado, 1/23 sem a entrada não acionada (M5-T4) (ADR-032, decidido depois dos dados). Fail em todas: 22/24; não acionado: 1/24. [tabelas/09-falso-positivo-entradas.md](tabelas/09-falso-positivo-entradas.md)
- **Falso positivo por alvo distinto: 1/9 alvos**; T1: 0 de 16 categorias (ADR-020); ao lado, sem os alvos não acionados, 1/8 (ADR-032, decidido depois dos dados). [tabelas/10-falso-positivo-por-alvo.md](tabelas/10-falso-positivo-por-alvo.md)
- Fora dos denominadores (passa por engano e defect despercebido): M3-T2, M3-T3, M5-T2 (ADR-020). [tabelas/11-fora-dos-denominadores.md](tabelas/11-fora-dos-denominadores.md)
- Testes com comportamento diferente da matriz: 6, em 3 entradas (M2-T4-relabel, M5-T2, M5-T4) (ADR-024). [tabelas/12-divergencias-por-teste.md](tabelas/12-divergencias-por-teste.md)
- Entradas inertes com entrada de log: 0 de 70 (ADR-026). [tabelas/13-inertes-com-log.md](tabelas/13-inertes-com-log.md)
- Métrica de localização correta: não foi registrada antes dos dados e não é calculada (ADR-032, decidido depois dos dados). O acerto do elemento aparece por entrada na coluna "elemento certo" da tabela de recuperação (ADR-020).

## 5a. Achado: falso positivo com corroboração por texto indisponível

- **M5-T10:** replace em 48/48 execuções (96 entradas de log), score 0,925. O fingerprint de baseline tem `text` vazio em 96/96; a corroboração por texto fica inaplicável (`text-corroboration-unavailable`) em 96/96 e, sem desconto, com fator de texto 1 em 96/96 (ADR-014). Com o alvo removido, o candidato é o irmão no mesmo pai que, na baseline, ocupa a posição do fingerprint `.product_main p.instock.availability` 96/96. É o falso positivo posicional que a corroboração por texto deveria barrar (ADR-012), num alvo sem texto. Registrado como achado, sem mudança no mecanismo; o tratamento conservador da corroboração indisponível fica como trabalho futuro (ADR-032, decidido depois dos dados). [tabelas/22-achado-falso-positivo.md](tabelas/22-achado-falso-positivo.md)

## 6. Overhead da recuperação

- **Custo passivo:** mediana de -3,0 ms por teste (mínimo -3419,0, máximo 4433,0), em 825 pares (entrada, teste) sem acionamento e com o teste passando nas duas condições (ADR-027; intervalo mínimo–máximo, ADR-026; diferença de medianas por par, ADR-032, decidido depois dos dados). [tabelas/15-overhead-recuperacao.md](tabelas/15-overhead-recuperacao.md) · [tabelas/14-overhead-passivo-pares.md](tabelas/14-overhead-passivo-pares.md)
- **Custo ativo:** recoveryMs com mediana de 27,9 ms (mínimo 9,4, máximo 77,9), em 930 tentativas (ADR-027). [tabelas/16-overhead-recuperacao-por-entrada.md](tabelas/16-overhead-recuperacao-por-entrada.md)

## 7. Overhead da captura (medição complementar)

- **Custo direto** (ADR-031): extração com mediana de 28,54 ms por chamada (Q1 5,50, Q3 32,11; n = 2310); gravação com mediana de 3,84 ms (Q1 3,69, Q3 4,06; n = 2310); total por execução de teste com mediana de 85,63 ms (Q1 79,00, Q3 96,69). [tabelas/17-overhead-captura.md](tabelas/17-overhead-captura.md)
- Duração por teste (66 diferenças pareadas): diferença mediana de 29,3 ms (Q1 -4,8, Q3 76,1; razão 1,85 %). **Resultado: diferença de ponta a ponta não distinguível do ruído da rede**, acompanhado do custo direto acima (ADR-031).
- Tempo total da suíte (10 pares): diferença mediana de 2894,0 ms (Q1 -422,3, Q3 6983,3; razão 4,59 %). **Resultado: diferença de ponta a ponta não distinguível do ruído da rede**, acompanhado do custo direto acima (ADR-031).
- Fingerprints versionados: 134 arquivos, 52047 bytes (ADR-031).
- Pares completos: 10; excluídos: 0. Testes que não passaram (mantidos, sem exclusão): 1; verificações que falharam: 0. [tabelas/18-overhead-captura-anomalias.md](tabelas/18-overhead-captura-anomalias.md)

## 8. Sensibilidade do limiar (secundária e aproximada)

- Recalculada offline a partir dos scores registrados; **secundária e aproximada** (ADR-027 (adendo); grade de 0,05, ADR-032, decidido depois dos dados). No limiar principal, 0,7: recuperadas 3/6, falso positivo bruto 1/24. [tabelas/19-sensibilidade-limiar.md](tabelas/19-sensibilidade-limiar.md) · [tabelas/20-scores-por-entrada.md](tabelas/20-scores-por-entrada.md)
- Em 0,65: recuperadas 3/6 (indeterminadas 0), falso positivo 1/24. Em 0,75: recuperadas 2/6, falso positivo 1/24.

## 9. Ablação do score (secundária, aproximada e posterior aos dados)

- Recalculada offline a partir do log, com o limiar principal de 0,7; o candidato é o mesmo nas três configurações e só a decisão muda. Especificação vinda do texto da monografia e script escritos depois dos dados (ADR-033, especificação da monografia e script posteriores aos dados); classes e agregação do ADR-025, denominador da matriz (ADR-024) e "não acionado" (ADR-032, decidido depois dos dados). Execução que passaria de fail para replace no elemento certo fica indeterminada, nunca sucesso (ADR-027 (adendo)). [tabelas/23-ablacao-score.md](tabelas/23-ablacao-score.md) · [tabelas/24-ablacao-por-entrada.md](tabelas/24-ablacao-por-entrada.md)
- **(i) rawScore: saída bruta da heurística estrutural:** recuperadas 3/6 (3/5 sem M2-T4-relabel), indeterminadas 1, com cura incorreta 0; falso positivo bruto 23/24 (23/23 sem M5-T4) (M5-T1-crime_51, M5-T1-historical_42, M5-T1-contemporary_38, M5-T1-health_47, M5-T1-biography_36, M5-T1-christian-fiction_34, M5-T1-psychology_26, M5-T1-art_25, M5-T1-autobiography_27, M5-T1-humor_30, M5-T1-travel_2, M5-T1-music_14, M5-T1-history_32, M5-T1-mystery_3, M5-T1-sequential-art_5, M5-T1-default_15, M5-T3, M5-T5, M5-T6, M5-T7, M5-T8, M5-T9, M5-T10); por alvo 8/9; T1: 16 de 16 categorias.
- **(ii) rawScore × fator de ambiguidade:** recuperadas 3/6 (3/5 sem M2-T4-relabel), indeterminadas 1, com cura incorreta 0; falso positivo bruto 10/24 (10/23 sem M5-T4) (M5-T1-music_14, M5-T1-mystery_3, M5-T1-sequential-art_5, M5-T1-default_15, M5-T3, M5-T6, M5-T7, M5-T8, M5-T9, M5-T10); por alvo 7/9; T1: 4 de 16 categorias.
- **(iii) score completo (registrado):** recuperadas 3/6 (3/5 sem M2-T4-relabel), indeterminadas 0, com cura incorreta 0; falso positivo bruto 1/24 (1/23 sem M5-T4) (M5-T10); por alvo 1/9; T1: 0 de 16 categorias.
- Verificações: a configuração (iii) reproduz o resultado principal; score = rawScore × disagreement × ambiguity × text em 930/930 eventos; factors.disagreement = 1 em 930/930 eventos; heurística de atributos estáveis inaplicável em 930/930 eventos; rawScore = score da heurística estrutural em 930/930 eventos.

## Gráficos

- [graficos/scores-por-entrada.svg](graficos/scores-por-entrada.svg): scores registrados por entrada, com o limiar principal.
- [graficos/sensibilidade-limiar.svg](graficos/sensibilidade-limiar.svg): recuperadas e falsos positivos por limiar (secundária e aproximada).
- [graficos/overhead-passivo.svg](graficos/overhead-passivo.svg): distribuição do custo passivo por par.
- [graficos/overhead-captura-pares.svg](graficos/overhead-captura-pares.svg): tempo total da suíte em cada par da medição da captura.
