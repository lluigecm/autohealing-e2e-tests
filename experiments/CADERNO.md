# Caderno de experimentos

Registro do que aconteceu em cada rodada do harness e em cada evento relevante para os experimentos, em ordem cronológica. O [`healing/DECISIONS.md`](../healing/DECISIONS.md) registra **o que foi decidido e por quê**. Este caderno registra **o que foi executado e o que se observou**. Quando uma anotação daqui gerar uma decisão, a entrada aponta para o ADR em vez de repetir o conteúdo.

Uma entrada por rodada ou evento, com:

- **Ambiente:** versões do Node e do Playwright, sistema operacional, workers e timeouts.
- **Commit** em que a execução rodou. Se havia mudança não commitada, isso é dito.
- **Comando exato** e parâmetros.
- **Duração real.**
- **Resultado resumido.**
- **Anomalias:** interrupção, falha de rede, rodada abortada e motivo, resultado inesperado. Uma anomalia é registrada mesmo quando a execução seguinte passa.

As entradas não são reescritas depois. Uma correção entra como anotação datada na própria entrada ou como entrada nova.

---

## 2026-10-11 — Verificação dos 66 E2E com `HEALING` desligado

**Objetivo.** Mostrar que as duas mudanças em `healing/withCapture.ts` não alteram a suíte baseline: a recuperação atrás de `HEALING`, desligada por padrão, e a extração do fingerprint pulada com `HEALING_CAPTURE=off`. O critério é 66/66 passando e `healing/fingerprints/` idêntico byte a byte depois da regravação.

**Ambiente.**
- Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200.
- Config `playwright.config.ts`: workers no padrão do Playwright, timeout de teste de 30 s, sem `actionTimeout`, `retries: 0` fora de CI.
- `HEALING` e `HEALING_CAPTURE` ausentes, ou seja, healing desligado e captura ligada.

**Commit.** Working tree sobre `b75f749`, com as mudanças de `withCapture` ainda não commitadas. Elas entram no commit seguinte a esta entrada.

**Comando.** `npx playwright test --reporter=list`, executado quatro vezes em sequência. É o `npm test` com outro reporter, para não abrir o relatório HTML.

**Duração e resultado.**

| Execução | Duração (Playwright) | Resultado |
|---|---|---|
| 1 | 27,5 s | **10 passaram**; os demais não (ver anomalia) |
| 2 | 17,0 s | 66/66 |
| 3 | 18,0 s | 66/66 |
| 4 | 17,4 s | 66/66 |

Depois das quatro execuções, `healing/fingerprints/` estava inalterado: 134 arquivos versionados e `git status` limpo no diretório.

**Anomalia.** Na execução 1, só 10 dos 66 testes passaram. A saída foi truncada no terminal e o motivo das falhas se perdeu. As execuções 2 a 4 rodaram logo depois, sem mudança de código nem de ambiente, e passaram inteiras. A execução 1 terminou em 27,5 s, o que não é compatível com 56 testes esperando o timeout de 30 s cada. A hipótese é falha de rede ou de acesso inicial ao site, mas ela **não pode ser verificada**. Desde então, a saída completa de toda execução é gravada em arquivo antes de ser resumida.

---

## 2026-10-11 — Simulação inicial do harness

**Objetivo.** Dimensionar a rodada principal antes de qualquer execução contra o site.

**Commit.** Working tree sobre `b75f749`, com o harness ainda não commitado.

**Comando.** `node experiments/harness.mts` (simulação, o modo padrão).

**Resultado.** 103 entradas, 206 invocações do Playwright e 4.040 execuções de teste (2.020 por condição). A estimativa usa custos padrão, sem calibração: 3 s por teste, +5 s com locator quebrado e 5 s de inicialização por invocação.

| Versão | Tempo estimado |
|---|---|
| Primeira simulação, com a extração do fingerprint ainda ativa (+10 s por locator quebrado) | 4h19min |
| Com a extração pulada sob `HEALING_CAPTURE=off` (+5 s) | **3h09min** |

A segunda linha reflete a mudança registrada no adendo do ADR-027.

---

## 2026-10-12 — Verificação offline dos sinais de infraestrutura

**Objetivo.** Confirmar, antes do piloto, que a proteção do ADR-028 dispara pelos sinais estruturados e só por eles.

**Ambiente.** O mesmo das entradas anteriores. O DOM vem de `page.route`, sem acesso ao site.

**Commit.** Working tree sobre `e4846cf`, com a proteção ainda não commitada. Ela entra no commit seguinte.

**Comando.** Spec descartável, carregando `installHarness()` com `HARNESS_ENTRY=M4-T5`, `HARNESS_CONDITION=healing-off` e um diretório de rodada temporário. O spec foi apagado depois e não é versionado.

**Resultado.** 3/3:

| Caso | Sinal registrado |
|---|---|
| `HomePage.goto()` recebendo status 500 | `http-error` |
| `HomePage.goto()` com a requisição abortada | `navigation-failed` |
| `goto` normal seguido de clique numa página que responde 404 | nenhum, porque o status só conta no `goto` |

**Anomalias.** Nenhuma.

---

## 2026-10-12 — Piloto do harness

**Objetivo.** Calibrar o tempo da rodada principal e exercitar o harness de ponta a ponta contra o site. **Os dados do piloto não entram nos resultados** (adendo do ADR-027), e as quatro entradas rodam de novo na rodada principal.

**Entradas.**
- M1-T8, do denominador de recuperação: 32 testes × 3 repetições.
- M2-T1-travel_2-relabel, M2 num alvo de um token só ("Travel"): 1 × 3.
- M5-T1-crime_51, M5 de T1 numa categoria: 1 × 3.
- M4-T5, inerte: 16 × 1.

São 8 invocações e 236 execuções, 118 por condição.

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200. `experiments/harness.config.ts`: 2 workers, `actionTimeout` de 5 s, timeout de teste de 30 s (padrão), `retries: 0`, `HEALING_CAPTURE=off`.

**Commit.** `7b8c55d`. O `plan.json` marca `dirty: true` só por causa da exclusão de `experiments/.gitkeep` e `mutation/.gitkeep`, que não fazem parte do commit. O código executado é o do commit.

**Comando.** `node experiments/harness.mts --run --entries M1-T8,M2-T1-travel_2-relabel,M5-T1-crime_51,M4-T5`, com a saída completa em `experiments/runs/piloto.log`. Rodada `experiments/runs/2026-10-12T09-31-12-224Z/`, não versionada.

**Duração real.** 13min00s (06:31:11 a 06:44:11, horário local).

**Estimativas de tempo.**

| | Antes do piloto (custos padrão) | Depois de `--calibrate-from` |
|---|---|---|
| Custos | 3 s por teste, +5 s com locator quebrado, 5 s por invocação | **1,5 s** por teste, **+5 s** com locator quebrado, **5,2 s** por invocação |
| Piloto | 15min04s | 12min09s (real: 13min00s) |
| Rodada principal (4.040 execuções, 206 invocações) | 3h09min | **2h18min** |

**Resultado resumido** (só verificação do harness, não é resultado experimental):
- Pré-verificação, sinais de infraestrutura e tentativas: todas as 8 invocações passaram na primeira tentativa, com 0 execuções inválidas e 236/236 eventos gravados.
- `applied` registrado em todas as execuções. O log de recuperação tem 102 entradas, todas com `run`, `timings` e `candidateIsOracle` preenchidos.
- Medianas: `detectionWaitMs` de 5,0 s, que é o `actionTimeout`; `recoveryMs` de 18 ms (12 a 60 ms); `actionMs` de 2 ms.

**Anomalias.**

1. **Bug na injeção da mutação, uma corrida com o teste.** No M1-T8 da condição desligada, 3 das 96 execuções **passaram**: Music rep. 1, Sequential Art rep. 1 e Contemporary rep. 2, todas em testes de `product-details`. Nessas três, não há anotação de mutação para a página do produto, só para a da categoria. Nas 93 que falharam, a anotação do produto está lá, com `applied: true`.

   A mutação roda em `DOMContentLoaded`. Depois do clique que abre o produto, o Playwright pode ler o DOM **enquanto ele ainda está sendo montado** (`parsing`), antes desse evento. Nesse intervalo o elemento existe sem mutação, e o teste passa sobre ele.

   É um defeito da ferramenta de injeção, não do site nem do mecanismo. Ele afeta toda página aberta por clique, nas duas condições: na condição ligada, apareceria como "não acionado". **Correção pendente**, a ser aprovada antes da rodada principal. Pela regra, as três ocorrências não serão relatadas como não determinismo do site.

2. **Bug no modelo de calibração, já corrigido.** A primeira versão de `--calibrate-from` separava as durações por desfecho (passou/falhou). Assim, as 96 recuperações do M1-T8, que passaram mas pagaram os 5 s da detecção, inflavam o custo de um teste comum para 6,4 s, e a estimativa ia a 3h58min. Agora a separação é pelo estado do locator na matriz (intacto/quebrado). A correção afeta só a estimativa, não a medição.

---

## 2026-10-12 — Reverificação da matriz com a nova injeção: divergência

**Objetivo.** Conferir, contra o arquivo versionado `mutation/effectiveness-matrix.json`, a nova injeção da mutação (HTML reescrito via `context.route` numa página auxiliar, adotada por causa da corrida revelada no piloto). A comparação confirma de uma vez o DOM mutado e a reconstituição do oráculo pelo caminho de índices.

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200. `playwright.integration.config.ts`: 2 workers, `actionTimeout` de 15 s. A matriz roda com `retries: 0` e mede 2 entradas em paralelo, em páginas do mesmo contexto.

**Commit.** Working tree sobre `94c5ab7`, com a nova injeção ainda não commitada (`mutation/applyMutation.ts`, `integration/mutationMatrix.ts`, `experiments/harnessSetup.ts` e os unitários da mutação).

**Comando.** `npx playwright test --config=playwright.integration.config.ts -g "matriz"`, em modo de comparação. Log completo em `experiments/runs/matriz-2026-10-12.log`. O diretório é ignorado pelo git, então o log não é versionado.

**Duração real.** 3min50s (06:59:24 a 07:03:14, horário local).

**Resultado: divergiu em 27 das 103 entradas, todas no mesmo sentido.**

| Divergência | Entradas |
|---|---|
| `effect` true → false; `locator` inerte → desvia; teste passa → passa por engano | **26**: M1-T1 × 8 categorias (contemporary_38, health_47, christian-fiction_34, art_25, humor_30, music_14, mystery_3, default_15); M3-T1 × 8 (historical_42, health_47, christian-fiction_34, autobiography_27, humor_30, music_14, mystery_3, default_15); M3-T9; M4-T1 × 7 (health_47, christian-fiction_34, art_25, humor_30, music_14, mystery_3, default_15); M4-T3; M4-T8 |
| `locator` inerte → desvia; teste passa → passa por engano (`effect` continua true) | **1**: M4-T1-contemporary_38 |

**Denominadores do ADR-020 inalterados.** As 30 entradas que quebram o locator (6 de recuperação e 24 de falso positivo) e as 3 que desviam (M3-T2, M3-T3 e M5-T2) batem com o arquivo versionado. As 27 divergências são todas de entradas inertes.

**Diagnóstico (NÃO VERIFICADO).** Nas 27 entradas, o elemento é encontrado e o teste passa. O que falha é a comparação com o oráculo (`pointsToOracle` e a verificação de `effect`). A hipótese é que o estado do documento, com o caminho do oráculo, está guardado por contexto e por URL. Como a matriz mede 2 entradas em paralelo, em páginas do mesmo contexto e muitas vezes na mesma URL de referência, uma entrada sobrescreveria o oráculo da outra. A próxima entrada deste caderno diz se o diagnóstico se confirmou.

**Anomalia.** A própria divergência. Seguindo a regra fixada antes da reverificação, o trabalho parou aqui. Nenhuma correção foi feita antes deste registro.

---

## 2026-10-12 — Correção da injeção: diagnóstico verificado, matriz e ida e volta

**Objetivo.** Verificar o diagnóstico da entrada anterior, corrigir a reconstituição do oráculo e confirmar a nova injeção (ADR-029) contra a matriz versionada e contra os fingerprints da baseline.

**Ambiente.** O das entradas anteriores. Matriz em `playwright.integration.config.ts`. Ida e volta em `experiments/roundtrip.config.ts`, espelho de `playwright.config.ts` com captura ligada num diretório temporário.

**Commit.** Working tree sobre `94c5ab7`, com a correção ainda não commitada. Ela entra no commit seguinte a esta entrada.

**Sequência e resultados.**

1. **Diagnóstico verificado.** O unitário "duas páginas do mesmo contexto, mutações diferentes na mesma URL" foi escrito antes da correção e **falhou** com o código daquele momento: a página com M3-T3 leu o estado `M1-T3` da outra página. Log em `experiments/runs/unit-duas-paginas-antes.log`.
2. **Correção.** O estado passou a ser guardado por página e por carregamento de documento, identificado por `Server-Timing`. Entrou um segundo unitário: nova navegação para a mesma URL que responde 500 não herda o oráculo. A suíte de unitários passou com 109 testes. Eram 103; entraram 6 da nova injeção.
3. **Matriz.** Comando: `npx playwright test --config=playwright.integration.config.ts -g "matriz"`, sem mudar o uso do contexto (2 entradas em paralelo, mesmo contexto). Das 07:56:19 às 08:00:05 (3min46s). **Bateu nas 103 entradas** com `mutation/effectiveness-matrix.json`. Log em `experiments/runs/matriz-2026-10-12-b.log`.
4. **Ida e volta.** Comando: `node experiments/roundtrip.mts`, das 08:00:40 às 08:01:04. 66/66 testes passaram, e dos 134 fingerprints, **134 saíram idênticos**: 0 faltando, 0 sobrando, 0 diferentes. Log em `experiments/runs/idavolta-2026-10-12.log`.
5. **Controle negativo da ida e volta** (descartável, não versionado). O mesmo caminho, com a M1-T8 aplicada em vez de mutação vazia: 32 testes falharam, que são os que leem o preço, e 32 fingerprints não foram capturados. Isso mostra que a reescrita estava ativa na execução do item 4. A configuração voltou ao original e `healing/fingerprints/` ficou inalterado. Log em `experiments/runs/idavolta-controle.log`.

Os logs estão em `experiments/runs/`, que é ignorado pelo git.

**Anomalias.** Nenhuma além das que motivaram esta correção.

---

## 2026-10-12 — Segundo piloto, com a injeção do ADR-029

**Objetivo.** Confirmar que a nova injeção eliminou a corrida revelada no primeiro piloto (critério: **0/96 passando no M1-T8 com healing desligado**) e recalibrar o tempo da rodada principal. **Os dados deste piloto não entram nos resultados** (adendo do ADR-027), e as quatro entradas rodam de novo na rodada principal.

**Entradas.** As mesmas do primeiro piloto: M1-T8 (32 × 3), M2-T1-travel_2-relabel (1 × 3), M5-T1-crime_51 (1 × 3) e M4-T5 (16 × 1). São 8 invocações e 236 execuções.

**Ambiente.** O do primeiro piloto: Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200, `experiments/harness.config.ts` com 2 workers, `actionTimeout` de 5 s e `retries: 0`.

**Commit.** `54af588`. O `plan.json` marca `dirty: true` só por causa da exclusão de `experiments/.gitkeep` e `mutation/.gitkeep`, fora do commit.

**Comando.** `node experiments/harness.mts --run --entries M1-T8,M2-T1-travel_2-relabel,M5-T1-crime_51,M4-T5`. Saída completa em `experiments/runs/piloto2.log`. Rodada `experiments/runs/2026-10-12T11-34-21-965Z/`, não versionada.

**Duração real.** 14min47s (08:34:21 a 08:49:08, horário local).

**Resultado resumido** (verificação do harness, não é resultado experimental):

| Entrada | Healing desligado | Healing ligado |
|---|---|---|
| M1-T8 | **0/96 passando** (no primeiro piloto: 3/96) | 96/96 sucesso: `replace`, oráculo certo, teste passa |
| M2-T1-travel_2-relabel | 0/3 passando | 3/3 `fail`, score 0,50 |
| M5-T1-crime_51 | 0/3 passando | 3/3 `fail`, score 0,194 (sem falso positivo) |
| M4-T5 (inerte) | 16/16 passando | 16/16 passando, mecanismo não acionado |

- `applied: true` em todas as 236 execuções, 0 execuções inválidas por infraestrutura, todas as invocações medidas na primeira tentativa.
- Nenhuma divergência entre repetições.
- Medianas: `detectionWaitMs` de 5,0 s, `recoveryMs` de 19 ms (13 a 60 ms), `actionMs` de 3 ms.

**Estimativa de tempo.**

| | Custos | Piloto | Rodada principal |
|---|---|---|---|
| Padrão, sem calibração | 3 s por teste, +5 s quebrado, 5 s por invocação | 15min04s | 3h09min |
| Calibrada no primeiro piloto (injeção antiga) | 1,5 s, +5 s, 5,2 s | 12min09s | 2h18min |
| **Calibrada neste piloto** | **2,6 s**, **+4,6 s**, **5,6 s** | 13min41s (real: 14min47s) | **2h52min** |

**Anomalias.** Nenhuma falha. Um custo novo: a duração mediana de um teste com locator intacto subiu de 1,5 s para 2,6 s (M4-T5, nas duas condições). O aumento corresponde à interceptação dos documentos (`route.fetch` e reescrita na página auxiliar), que é igual nas duas condições e não entra na medida de overhead. O modelo subestimou este piloto em 7%, a mesma margem do primeiro.

---

## 2026-10-12 — Rodada iniciada sem registro às 09:23, e preparação da rodada principal

**Rodada inesperada.** Durante a preparação apareceu o diretório `experiments/runs/2026-10-12T12-23-06-353Z/`, criado às 09:23:06 (horário local). O que se sabe:
- foi uma rodada completa (`--run` sem `--entries`, 206 invocações no plano), no commit `025ce82`, com a árvore limpa e a ordem **antiga**, sempre com a desligada antes;
- parou na **primeira invocação** (M1-T1-crime_51, healing desligado): o Playwright saiu com código 1 em 606 ms e **0 de 1 execução**. A pré-verificação fez um GET na home, e nenhum teste rodou contra o site;
- o orquestrador gravou essa invocação como **"medida"**. Era um bug: o desfecho só olhava os sinais de infraestrutura e não conferia o número de execuções;
- às 09:25 não havia processo do harness rodando.

A **origem não foi determinada**. Na hora, eu estava editando `experiments/harness.mts` e um dos meus comandos de shell falhou com erro de sintaxe. Não dá para afirmar se foi esse comando ou uma execução manual. A rodada **não é oficial** e não será retomada. O diretório fica em `experiments/runs/`, que é ignorado pelo git.

**Mudanças antes da rodada principal** (ADR-030):
- condições alternando qual vai primeiro em cada entrada: 52 entradas começam pela desligada e 51 pela ligada;
- `--run` e `--resume` exigem a árvore limpa. Verificado com a árvore suja: os dois recusaram, com código 3;
- regra de interrupção: retomada no mesmo commit, só das invocações sem desfecho;
- invocação incompleta (Playwright interrompido ou com menos execuções que as previstas) aborta a rodada sem gravar desfecho. Essa é a correção do bug acima.

**Confirmações pedidas antes da rodada principal**, todas com registro nas entradas anteriores:

| Item | Resultado |
|---|---|
| Unitário da corrida, antes e depois da correção | Falhou antes (`unit-duas-paginas-antes.log`: página com M3-T3 leu `M1-T3`) e passou depois (`unit-pos-correcao.log`, 109/109) |
| Matriz depois da correção | Bateu nas 103 entradas (`matriz-2026-10-12-b.log`) |
| Ida e volta | 134/134 fingerprints idênticos, 0 faltando, 0 sobrando, 0 diferentes. Bytes originais com `applied: false` cobertos por unitário |
| ADR da troca de mecanismo | ADR-029, commitado em `54af588` |

**Anotação (2026-10-12).** O usuário também não sabe quem iniciou a rodada das 09:23. A **origem fica indeterminada**: nenhum dos dois reconhece a autoria. A partir de agora, `--run` e `--resume` contra o site só rodam com autorização explícita do usuário na mensagem imediatamente anterior, nunca por iniciativa própria, nem para teste.

---

## 2026-10-12 — Retomada e invocação incompleta testadas offline

**Objetivo.** Antes da rodada principal, verificar sem tocar no site: (1) a retomada de uma rodada interrompida (ADR-030); (2) que uma invocação incompleta aborta a rodada sem desfecho e nunca é gravada como "medida", o bug da rodada das 09:23.

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200, `playwright.unit.config.ts`. Sem rede.

**Commit.** Working tree sobre `e538ed3`, com as mudanças ainda não commitadas.

**Mudança de código.** O laço de execução e a preparação da retomada saíram de `experiments/harness.mts` para `experiments/runState.mts`, com a pré-verificação e o Playwright injetados. O comportamento não mudou. O orquestrador liga as versões reais, e os unitários, versões falsas. No `tsconfig.json` entraram `allowImportingTsExtensions` (para o Node puro importar o `.mts`) e `healing/**/*.mts` no `include`.

**Comando.** `npx playwright test --config=playwright.unit.config.ts`, com a saída em `experiments/runs/unit-completo.log`, não versionado.

**Resultado.** 117/117 unitários: os 109 anteriores mais 8 novos em `healing/experiments/runState.spec.mts`, todos sobre um diretório de rodada fictício:

| Caso | Resultado |
|---|---|
| 0 de 1 execução | Aborta com código 4, sem desfecho em `outcomes.jsonl`, tentativa gravada como `incomplete: true` e nada depois dela roda |
| Playwright sem código de saída | Aborta, sem desfecho |
| Inválida por infraestrutura na 1ª tentativa e incompleta na 2ª | Aborta, sem desfecho |
| Pré-verificação falhando | Aborta com código 2 antes de rodar, sem desfecho |
| Infraestrutura inválida nas duas tentativas | Exatamente 2 tentativas, desfecho "nao-medida" |
| Retomada depois de interrupção na 3ª de 4 invocações | Rodam só a 3ª e a 4ª; cada invocação do plano fica com exatamente um desfecho; tentativa parcial movida para `interrompidas/<momento>/`; `aborted.json` renomeado; `resumes.jsonl` registrado |
| Retomada com commit diferente | Recusada, sem mexer em nenhum arquivo |
| Retomada de rodada já completa | Não roda nada e não chama a pré-verificação |

**Anomalias.** Nenhuma.

---

## 2026-10-12 — Rodada principal

**Autorização.** Dada pelo usuário na mensagem imediatamente anterior ao início, junto com o teste da CLI de `--resume`.

**Teste da CLI de `--resume`, antes da rodada.** Comando: `node experiments/harness.mts --resume experiments/runs/ficticia-completa`, sobre uma rodada fictícia no commit `09289cf`, com 2 invocações e as duas já com desfecho. Resultado: "2 concluídas, 0 pendentes", código de saída 0, nenhuma invocação executada, nenhuma pré-verificação e `resumes.jsonl` registrado. Não houve acesso ao site.

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200. `experiments/harness.config.ts`: 2 workers, `actionTimeout` de 5 s, timeout de teste de 30 s, `retries: 0`, `HEALING_CAPTURE=off`.

**Commit.** `09289cf`, com a árvore limpa (`plan.json`: `dirty: false`).

**Comando.** `node experiments/harness.mts --run`, com a saída completa em `experiments/runs/principal.log`. Rodada `experiments/runs/2026-10-12T16-32-03-131Z/`.

**Início.** 13:32:02 (horário local).

**Conferência das duas primeiras invocações** (M1-T1-crime_51, desligada e depois ligada):
- teste `category-navigation › Crime` passou nas duas condições, como na matriz (`inerte`, `passa`);
- `applied: true` na home, onde está o alvo. Na página da categoria Crime, `applied: false`, porque lá o link da própria categoria não tem o seletor do alvo, como no caso de Travel;
- nenhum `healing-*.jsonl` em nenhuma condição. Era o esperado: entrada inerte, sem quebra, e a condição desligada nunca registra o mecanismo;
- 0 execuções inválidas. A primeira execução levou 5,1 s e a segunda 2,2 s; a diferença é o aquecimento inicial.

Nada destoou, e a rodada seguiu.

**Fim.** 16:37:11 (horário local). **Duração real: 3h05min09s.** A estimativa calibrada no segundo piloto era 2h52min, ou cerca de 3h05min contando a margem de 7% observada nos pilotos.

**Resultado resumido** (conferência operacional, não análise):
- 206/206 invocações com desfecho, todas **medidas**; nenhuma não medida e nenhuma retomada.
- 4.040/4.040 execuções gravadas na última tentativa de cada invocação; 0 execuções inválidas nessas tentativas.
- `applied: true` em ao menos uma página de **todas** as 4.040 execuções. Nenhum teste fica fora pelo critério de `applied: false` (ADR-024).
- **Condição desligada contra a matriz** (ADR-027), no teste reproduzido de cada entrada: **0 divergências em 103 entradas**.
- Log do mecanismo: 0 entradas na condição desligada e 930 na ligada.
- Arquivos: 1.739 `tests-w*.jsonl` e 660 `healing-w*.jsonl`. São muitos porque o Playwright troca o worker depois de cada teste que falha, e cada worker novo recebe um índice novo. A junção na análise lê todos os arquivos de cada tentativa (ADR-026), então isso não muda nada.

**Anomalias.**
1. **Uma reexecução por infraestrutura (ADR-028).** Invocação 47/206, M1-T9 com healing ligado, tentativa 1: 15 das 96 execuções tiveram o sinal `navigation-failed`, todas com `net::ERR_FAILED` no `goto` de uma página de categoria (8 categorias diferentes). A invocação rodou de novo inteira: tentativa 2 com 96/96 válidas. A análise usa só a tentativa 2, e a tentativa 1 fica no diretório para auditoria.
2. **A causa de fundo do `net::ERR_FAILED` não foi registrada.** Esse código é o que a reescrita do documento (ADR-029) produz quando cai no próprio `catch` e aborta a navegação com `route.abort('failed')`. A falha pode ter vindo do fetch ao site ou da página auxiliar, e o `catch` não guarda o erro original. A classificação como infraestrutura seguiu o desenho do ADR-029. A lacuna é só de diagnóstico, e registrar o erro original no `catch` fica como melhoria para rodadas futuras, sem mudar esta.

**Cópia oficial.** O diretório da rodada foi copiado sem edição para `experiments/results/2026-10-12T16-32-03-131Z/`: 2.505 arquivos, 8,9 MB, `diff -r` sem diferenças. O log do console (`experiments/runs/principal.log`, 2,2 MB) fica fora da cópia, em `experiments/runs/`, que é ignorado pelo git.

**Preservação dos resultados (2026-10-12, depois da rodada).**
- `.gitattributes` com `experiments/results/** -text`, commitado em `0a3c31c` **antes** dos resultados. Sem ele, o `core.autocrlf=true` do repositório converteria o fim de linha da cópia de trabalho em checkouts futuros, e a cópia deixaria de ser idêntica à rodada.
- **Manifesto:** `experiments/results/2026-10-12T16-32-03-131Z/MANIFEST.sha256`, no formato do `sha256sum`, com 2.506 linhas. Os hashes foram calculados **a partir dos originais**: os 2.505 arquivos da rodada em `experiments/runs/2026-10-12T16-32-03-131Z/` e o log do console em `experiments/runs/principal.log`, que na cópia se chama `console.log`.
- **Conferência:** `sha256sum -c MANIFEST.sha256` dentro do diretório dos resultados confere os 2.506 arquivos, e `cmp` confirma o log idêntico. Para verificar no futuro, basta rodar o mesmo comando ali.

---

## 2026-10-14 — Levantamento a posteriori do ambiente da rodada principal

**Objetivo.** Completar o registro do ambiente da rodada principal. A entrada da rodada não traz CPU, RAM, versão do Chromium nem estado da máquina, porque o modelo de entrada deste caderno não os pedia. **Nada aqui foi registrado durante a rodada.** Tudo foi coletado em 2026-10-14, sem acesso ao site.

**Máquina.** A rodada foi gerada nesta máquina: o diretório `experiments/runs/2026-10-12T16-32-03-131Z/`, ignorado pelo git, está nela.
- Desktop, sem bateria. Placa-mãe Gigabyte B550M K.
- AMD Ryzen 7 5700G: 8 núcleos, 16 threads, 3,8 GHz base.
- 16 GB de RAM: 2 × 8 GB DDR4-3200.
- Windows 11 Home 25H2, build 26200.9457.

**Por que esses dados valem para a rodada.** O último boot foi em 2026-10-12 às 05:52:30, antes do início da rodada (13:32:02), e a máquina não reiniciou desde então. Trocar hardware exige desligar, e uma atualização cumulativa do Windows só se aplica no reinício. Isso é inferência a partir do horário do boot.

**Chromium: 153.0.8010.12 (revisão 1243), headless.**
- O `package-lock.json` fixa o `playwright-core` 1.63.0, e o `browsers.json` dele aponta para a revisão 1243.
- O Playwright do `node_modules` foi instalado em 2026-09-05 e não mudou desde então, assim como o `chromium-1243`.
- Abrindo o navegador pelo `playwright-core` do projeto, a versão foi 153.0.8010.12.
- O `experiments/harness.config.ts` não define `headless` nem `channel`.

**Energia.** Rede elétrica, sem bateria. O plano de energia atual é "Equilibrado". O plano vigente durante a rodada não é verificável.

**Log System do Windows, de 13:30 a 16:40 de 2026-10-12.** Nenhum evento de suspensão, retomada, reinício ou Windows Update. Só dois avisos do Tcpip:
- 14:54:37, evento 4266: as portas efêmeras UDP se esgotaram. Sem carimbo de horário por invocação, ela fica entre a 55ª e a 157ª.
- 15:29:00, evento 4231: as portas efêmeras TCP se esgotaram. Nesse momento rodava a invocação 191 (M5-T3, healing ligado, das 15:20:05 às 15:29:30 pelo `decidedAt`), que teve 0 execuções inválidas.

**Os avisos não explicam o `net::ERR_FAILED` da invocação 47.** Pelo `decidedAt`, a tentativa 1 do M1-T9 com healing ligado rodou das 13:54:25 às 13:59:40, uma hora antes do primeiro aviso. A causa segue indeterminada.

**Programas em execução.** Segundo declaração do usuário em 2026-10-14, nada rodava no computador além da rodada e do editor que a disparou (VS Code com o Claude Code). Isso não foi registrado durante a rodada, e o sistema não guarda prova disso. A declaração não cobre os serviços em segundo plano do Windows.

**Lacuna encontrada.** O `invocations.jsonl` não grava o horário de cada invocação. Só as invocações com healing ligado em que o mecanismo foi acionado têm horário, pelo `decidedAt`. Gravar o horário fica como melhoria para rodadas futuras, junto com o erro original no `catch` da reescrita e o ambiente completo no `plan.json`.

**Anomalias.** Os dois avisos de esgotamento de portas acima.

---

## 2026-10-15 — Medição do custo da captura: código verificado offline

**Objetivo.** Antes de qualquer execução contra o site, verificar sem rede o código da medição complementar do custo da captura (ADR-031, commit `fe7d254`).

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200, `playwright.unit.config.ts`. Sem rede.

**Commit.** Working tree sobre `fe7d254`, com o código ainda não commitado. Ele entra no commit seguinte a esta entrada.

**Mudanças de código.**
- **Instrumentação.** `withCapture` ganhou um coletor opcional da duração de cada extração e de cada gravação. Sem coletor, nada é medido.
- **Peças comuns, sem mudança de comportamento do harness:**
  - os sinais de infraestrutura saíram de `experiments/harnessSetup.ts` para `experiments/infraSignals.ts`;
  - a pré-verificação e o estado do git saíram de `experiments/harness.mts` para `experiments/runSupport.mts`;
  - o laço de `experiments/runState.mts` ficou genérico no tipo da invocação e aceita um registro extra por tentativa.
- **Novos:** o orquestrador `experiments/overhead.mts`, a config, o reporter e a instalação da medição, e a análise `experiments/overheadAnalysis.mts`. A análise foi escrita e testada antes de existir qualquer dado.

**Comandos e resultados.**

| Comando | Resultado |
|---|---|
| `npx tsc -p .` | Sem erros |
| `npx playwright test --config=playwright.unit.config.ts` | 143/143. Eram 117; entraram 26 |
| `node experiments/harness.mts` (simulação) | Igual à de antes: 103 entradas, 206 invocações, 4.040 execuções, ordem 52/51 |
| `node experiments/overhead.mts` (simulação) | 21 invocações (aquecimento + 10 pares), 1.386 execuções, 5 pares abrindo por cada condição, cerca de 19 min estimados |
| `npx playwright test --config experiments/overhead.config.ts --list` | Sem as variáveis do orquestrador, recusa rodar. Com elas, lista os 66 testes nas duas condições. Nenhum teste executado |

Os 26 unitários novos cobrem:
- os mesmos bytes gravados e o mesmo resultado da ação, com e sem coletor;
- nada medido com a captura desligada;
- `healing/fingerprints/` como diretório padrão;
- o plano e a alternância dos pares;
- a verificação da captura, inclusive o arquivo pré-carregado que não foi regravado;
- a leitura dos 134 fingerprints a partir do git;
- as proteções do ambiente;
- o quantil tipo 7, a regra de relato e as quatro métricas sobre uma rodada fictícia.

**Não verificado offline.** O caminho completo coletor → anotação → reporter só roda com os testes navegando no site. Ele será conferido nas primeiras invocações da rodada.

**Anomalias.** Nenhuma.

---

## 2026-10-15 — Medição do custo da captura

**Autorização.** Dada pelo usuário na mensagem imediatamente anterior ao início.

**Programas abertos.** Segundo o usuário, nenhum. A declaração não cobre os serviços do Windows. O VS Code com o Claude Code, que disparou a rodada, estava aberto. A lista de processos de cada tentativa, no início e no fim, está em `processos-inicio.csv` e `processos-fim.csv`, no diretório da tentativa.

**Ambiente.** Gravado no `plan.json` pelo orquestrador.
- Máquina: AMD Ryzen 7 5700G (16 threads), 16 GB de RAM.
- Windows 11 Home, build **26200.9711**.
- Node v24.14.0, Playwright 1.63.0, Chromium 153.0.8010.12.
- `experiments/overhead.config.ts`: 2 workers, `retries: 0`, sem `actionTimeout`, healing desligado.
- Plano de energia: "Equilibrado" no início e no fim de todas as 23 tentativas.
- Último boot da máquina: 2026-10-15 às 07:27.

**Diferença em relação à rodada principal.** A máquina é a mesma, mas o Windows foi atualizado entre as duas rodadas. A rodada principal rodou na build 26200.9457 (levantamento de 2026-10-14). As versões do Node, do Playwright e do Chromium são as mesmas.

**Commit.** `f81e922`, com a árvore limpa (`plan.json`: `dirty: false`).

**Comando.** `node experiments/overhead.mts --run`, com a saída completa em `experiments/runs/overhead.log`. Rodada `experiments/runs/overhead-captura-2026-10-15T15-16-16-991Z/`.

**Duração real.** 27min32s, de 12:16:16 a 12:43:48 (horário local). A simulação estimava 19min09s. A diferença inclui duas reexecuções e cinco esperas de 15 s da pré-verificação (anomalias abaixo).

**Conferência do aquecimento**, o caminho que não deu para verificar offline:
- 66/66 testes passaram;
- 231 extrações e 231 gravações registradas, todas com fingerprint;
- os 134 arquivos regravados e idênticos aos versionados;
- `healing/fingerprints/` inalterado.

**Resultado resumido** (conferência operacional, não análise):
- 21/21 invocações com desfecho "medida", nenhuma não medida e nenhum aborto. Os 10 pares estão completos.
- Verificação da captura correta nas 23 tentativas:
  - captura ligada: 134 arquivos, idênticos e regravados;
  - captura desligada: diretório vazio.
- `healing/fingerprints/` com o mesmo hash antes e depois de todas as tentativas.
- 1.518 eventos de teste gravados, dos quais 1.386 nas últimas tentativas.

**Anomalias.** As quatro primeiras caíram todas na condição desligada.

1. **Reexecução por infraestrutura no par 3, captura desligada (12:21:10).** A tentativa 1 teve 1 execução inválida: sinal `navigation-failed` com `net::ERR_TIMED_OUT`, e o teste terminou em `timedOut`. A tentativa 2 teve 66/66 válidas.
2. **Reexecução por infraestrutura no par 7, captura desligada (12:31:20).** A tentativa 1 teve 16 execuções inválidas, todas `navigation-failed` com `net::ERR_CERT_AUTHORITY_INVALID`: o navegador não reconheceu a autoridade do certificado do site nessas navegações. A tentativa 2, 16 s depois, teve 66/66 válidas. A causa não foi determinada: pode ter sido um problema no certificado servido naquele momento ou uma interceptação de TLS no caminho.
3. **Teste falhando sem sinal de infraestrutura no par 5, captura desligada (12:26:44).** `pagination.spec.ts › avança para a próxima página e exibe produtos diferentes` falhou em `expect(secondPageTitles.length).toBeGreaterThan(0)`: a segunda página veio com 0 títulos. Pela regra do ADR-028, um teste sem sinal estruturado não é reexecutado, e o desfecho dele é dado. Pelo ADR-031, nenhuma execução é excluída, então esta entra na análise. O `error-context` do Playwright se perdeu, porque `test-results/` é limpo a cada invocação. A primeira linha do erro está no evento do teste, e a mensagem completa, no log do console.
4. **Pré-verificação falhou cinco vezes**, sempre com `TypeError: fetch failed`:
   - antes da 2ª tentativa do par 3;
   - antes da 2ª tentativa do par 7;
   - antes do lado desligado do par 8;
   - antes do lado desligado do par 9;
   - antes do lado ligado do par 10.

   Em todas, a tentativa seguinte, 15 s depois, passou, então nenhuma levou a aborto. As esperas ficam fora do tempo medido de cada execução. O `catch` grava só a mensagem do `fetch`, não a causa interna, então o motivo não é conhecido.
5. **Log System do Windows de 12:16 a 12:44:** nenhum evento.

**Cópia oficial.** O diretório da rodada foi copiado sem edição para `experiments/results/overhead-captura-2026-10-15T15-16-16-991Z/`.
- O log do console foi copiado como `console.log`.
- `diff -r` não mostrou diferenças, e `cmp` confirmou o log idêntico.
- O manifesto `MANIFEST.sha256` tem 1.599 linhas, com os hashes calculados a partir dos originais: os 1.598 arquivos da rodada e o log.
- `sha256sum -c MANIFEST.sha256`, rodado dentro do diretório, confere os 1.599 arquivos.
- São 1.600 arquivos e 6,0 MB no total.
- **Caminhos longos.** As cópias dos fingerprints de cada tentativa chegam a 315 caracteres de caminho absoluto, acima do limite de 260 do Windows: o `git add` recusou 242 arquivos. Com `git config core.longpaths true`, ativado só neste repositório e com o aval do usuário, os 1.600 arquivos entraram. O hash de cada blob no índice confere com os bytes crus do arquivo correspondente. Quem clonar o repositório no Windows precisa da mesma configuração para fazer o checkout desse diretório.

---

## 2026-10-15 — Análise dos resultados

**Objetivo.** Gerar por script, a partir de `experiments/results/`, todas as tabelas, números e gráficos da rodada principal e da medição complementar da captura, com as regras já registradas (ADR-016, ADR-020, ADR-024 a ADR-027 e ADR-031). Nenhuma execução contra o site.

**Ambiente.** Node v24.14.0, Playwright 1.63.0, Windows 11 Home 10.0.26200. Sem rede (os gráficos foram conferidos renderizando os SVG locais).

**Commit.** Working tree sobre `21e2ec4`, branch `analysis/resultados`, com o código ainda não commitado.

**Comandos e resultados.**

| Comando | Resultado |
|---|---|
| `node experiments/resultsAnalysis.mts` | 47 arquivos em `experiments/analysis/` |
| A mesma geração, duas vezes, com `diff -r` entre elas | Nenhuma diferença |
| `node experiments/resultsAnalysis.mts --check` | 47 arquivos idênticos ao gerado |
| `npx tsc -p .` | Sem erros |
| `npx playwright test --config=playwright.unit.config.ts` | 153/153. Eram 143; entraram 10, das regras de classificação e agregação |

**Integridade, antes de qualquer dado.** O script confere os manifestos SHA-256 e para se algum arquivo divergir. Resultado: 2.506/2.506 arquivos na rodada principal e 1.599/1.599 na medição da captura, nenhum fora do manifesto. Também confere a coerência entre o log do mecanismo e os eventos dos testes: execuções previstas, nenhuma inválida na tentativa usada, nenhuma entrada de log órfã e nenhuma decisão incoerente com o score e o limiar. Nenhum problema.

**Resultado resumido.** O resumo completo, com o ADR de cada regra ao lado de cada número, está em `experiments/analysis/RESUMO.md`.
- Recuperação: 3/6 entradas (M1-T8, M1-T9 e M2-T1-sequential-art_5-append-token). M1-T10 cai em "elemento certo, teste falha" em 48/48 execuções.
- Falso positivo: 1/24 bruto (M5-T10, `replace` em 48/48 execuções, score 0,925) e 1/9 por alvo; T1 em 0 de 16 categorias.
- Não determinismo: nenhuma divergência em 914 trios. Exclusões por `applied: false`: 0 de 4.040 execuções.

**Divergências e lacunas** (relatadas, sem nenhuma correção):
1. **M5-T10 é falso positivo.** O ADR-020 previa `fail` para M5 × T4–T10. Com a nota removida, a heurística estrutural escolheu outro elemento na mesma posição, com score 0,925 e a flag `text-corroboration-unavailable`.
2. **M2-T4 e M5-T4 não acionaram o mecanismo.** A tabela do ADR-020 previa `fail` com score de no máximo 0,50. A observação de previsão do mesmo ADR e a detecção por exceção do ADR-027 já diziam que `hasNextPage()` não lança exceção.
3. **M5-T2 fora do previsto nos quatro testes de Crime.** O mecanismo foi acionado com `fail` nos três `product-details` de Crime, e o `category-navigation` de Crime falhou nas duas condições, como previa a observação do ADR-020.
4. **Lacuna da regra de agregação.** O M5-T4 não tem `replace` nem `fail` em todas as execuções. O ADR-025 não define o desfecho desse caso, e a análise o lista à parte, fora do numerador do falso positivo.

**Anomalias.** Nenhuma na análise.

---

## 2026-10-17 — Decisões posteriores à análise

**Objetivo.** Registrar o que a análise de 2026-10-15 deixou em aberto, depois da aprovação dela pelo usuário. Tudo foi decidido **depois de ver os dados** e está no ADR-032. Nenhuma execução contra o site.

**Commit.** Working tree sobre `5363080`, branch `analysis/resultados`.

**O que mudou na saída** (`experiments/analysis/`, regenerada pelo script):
- M5-T4 e M2-T4 classificados como "não acionado". Resultados principais pelo denominador da matriz, com a fração sem as não acionadas ao lado: falso positivo 1/24 (1/23) e recuperação 3/6 (3/5). A conclusão não muda.
- Achado do M5-T10, calculado a partir dos fingerprints de baseline: `text` vazio, corroboração inaplicável e sem desconto (ADR-014), e substituição pelo vizinho na posição do fingerprint de disponibilidade, com score 0,925. Nova tabela `22-achado-falso-positivo`. O mecanismo não muda, e o tratamento conservador da corroboração indisponível fica como trabalho futuro.
- As três escolhas de cálculo (diferença de medianas no custo passivo, grade de 0,05 e rótulo "não acionado") passam a citar o ADR-032.
- A métrica de localização correta continua sem cálculo, porque não foi registrada antes dos dados.

**Comandos e resultados.** `npx tsc -p .` sem erros; 154/154 unitários; duas gerações com `diff -r` sem diferenças; `--check` com 49 arquivos idênticos ao gerado.

**Anomalias.** Nenhuma.

---

## 2026-10-19 — Fechamento

**Objetivo.** Encerrar o caderno com o resumo de todas as execuções contra o site e as melhorias deixadas para trabalho futuro. Nenhuma execução contra o site. Nada aqui é dado novo: cada item aponta para a entrada ou o ADR de onde saiu.

**Execuções contra o site, em ordem.**

| Data | Execução | Commit | Duração real | Situação | Entrada |
|---|---|---|---|---|---|
| 2026-10-11 | Verificação dos 66 E2E com `HEALING` desligado, 4 execuções | sobre `b75f749` | 17,0 a 27,5 s cada | Execução 1 com 10/66 (causa perdida); 2 a 4 com 66/66 | 2026-10-11 |
| 2026-10-12 | Primeiro piloto: 4 entradas, 8 invocações, 236 execuções | `7b8c55d` | 13min00s | Fora dos resultados. Revelou a corrida da injeção (3/96 passando no M1-T8 desligado), que levou ao ADR-029 | 2026-10-12, piloto |
| 2026-10-12 | Reverificação da matriz com a nova injeção | sobre `94c5ab7` | 3min50s | Divergiu em 27 entradas inertes; diagnóstico e correção na entrada seguinte | 2026-10-12 |
| 2026-10-12 | Matriz e ida e volta depois da correção | sobre `94c5ab7` | 3min46s e 24 s | Matriz bateu nas 103 entradas; 134/134 fingerprints idênticos | 2026-10-12 |
| 2026-10-12 | Segundo piloto, mesmas 4 entradas | `54af588` | 14min47s | Fora dos resultados. 0/96 passando no M1-T8 desligado: corrida eliminada | 2026-10-12, segundo piloto |
| 2026-10-12 | Rodada iniciada às 09:23, sem autoria reconhecida | `025ce82` | parou na 1ª invocação | **Não oficial**, não retomada (ADR-030) | 2026-10-12, 09:23 |
| 2026-10-12 | **Rodada principal**: 103 entradas, 206 invocações, 4.040 execuções | `09289cf` | 3h05min09s | 206/206 invocações medidas; 1 reexecução por infraestrutura (M1-T9 ligada); resultados em `experiments/results/2026-10-12T16-32-03-131Z/` | 2026-10-12, rodada principal |
| 2026-10-15 | **Medição do custo da captura**: aquecimento + 10 pares, 21 invocações | `f81e922` | 27min32s | 21/21 medidas; 2 reexecuções por infraestrutura (pares 3 e 7, desligada); resultados em `experiments/results/overhead-captura-2026-10-15T15-16-16-991Z/` | 2026-10-15, medição |

Os resultados das duas rodadas oficiais estão em `experiments/analysis/RESUMO.md`, gerado por script e com a regra de cada número ao lado. Os números não são repetidos aqui, para não haver duas fontes.

**Melhorias deixadas para trabalho futuro**, só as que ficaram registradas:

1. **Causa do `net::ERR_FAILED`.** Registrar o erro original no `catch` da reescrita do documento. Hoje ela aborta a navegação com `route.abort('failed')` sem guardar a causa, e a reexecução da invocação 47 da rodada principal ficou sem diagnóstico (entradas de 2026-10-12, rodada principal, anomalia 2, e de 2026-10-14).
2. **Horário de cada invocação** no `invocations.jsonl` do harness e **ambiente completo** no `plan.json` dele (entrada de 2026-10-14). A medição da captura já grava o ambiente no `plan.json` (ADR-031).
3. **Tratamento conservador da corroboração indisponível.** Quando o fingerprint não tem texto, a corroboração não desconta nada, e foi isso que produziu o único falso positivo (M5-T10). Exemplos: um teto para o score nesses casos ou um sinal independente de posição para alvos sem texto. Registrado depois dos dados, sem mudança no mecanismo avaliado (ADR-032).
4. **Ponderar tokens por raridade** (TF-IDF ou similar) na corroboração por texto, para neutralizar o boilerplate dos cards no lugar da rampa de dois patamares (ADR-014, "melhoria possível").
5. **Cadeia completa de ancestrais no fingerprint**, para discriminar elementos dentro de containers repetidos. Exige mudar o schema da Camada 1 e regravar os 134 fingerprints (ADR-010, "candidato a etapa futura").

**Lacunas de diagnóstico que ficaram registradas** (não são melhorias decididas, só o que não se sabe):
- a causa da execução 1 da verificação de 2026-10-11 (saída truncada);
- a origem da rodada das 09:23 de 2026-10-12;
- a causa interna das cinco falhas `fetch failed` da pré-verificação e do `net::ERR_CERT_AUTHORITY_INVALID` do par 7, na medição da captura;
- o `error-context` do teste de paginação que falhou no par 5 da medição da captura, perdido porque `test-results/` é limpo a cada invocação.

**Anomalias.** Nenhuma.

---

## 2026-10-28 — Verificação de reprodutibilidade num clone limpo

**Objetivo.** Mostrar que um clone novo do repositório, sem nada da cópia de trabalho de desenvolvimento, reproduz a checagem de tipos, os unitários, a conferência dos manifestos e a análise. **Nada aqui acessa o site:** a config unitária não tem `baseURL` e monta o DOM por `setContent`/`route`, os manifestos e a análise só leem arquivos e o git, e o único acesso à rede é o `npm ci`, ao registro do npm. Os logs ficaram numa pasta temporária fora do repositório e não são versionados, então os números e as mensagens estão todos escritos abaixo.

**Ambiente.** Windows 11 Home, build 26200.9711. Git 2.53.0.windows.1 com a **configuração padrão do Git para Windows**: `core.autocrlf=true` na config de sistema e nenhum `core.autocrlf` na config global. Node v24.14.0, npm 11.9.0, Playwright 1.63.0.

**Comandos**, iguais nas duas tentativas, cada um com a saída completa gravada em arquivo:

1. `git clone -c core.longpaths=true --branch docs/fechamento <repositório local> <pasta vazia>`, clonado do repositório local e não do GitHub;
2. `npm ci`;
3. `npx tsc --noEmit`;
4. `npx playwright test --config=playwright.unit.config.ts`;
5. `sha256sum -c --quiet MANIFEST.sha256`, dentro de `experiments/results/2026-10-12T16-32-03-131Z/` e de `experiments/results/overhead-captura-2026-10-15T15-16-16-991Z/`;
6. `node experiments/resultsAnalysis.mts --check`.

### Tentativa 1 — commit `ed49ba0`: falhou

| Passo | Resultado |
|---|---|
| Clone | 4.368 arquivos |
| `npm ci` | 7 pacotes, 0 vulnerabilidades |
| `tsc --noEmit` | sem erros |
| Unitários | **153 passaram, 1 falhou** |
| Manifestos | 2.506/2.506 e 1.599/1.599, nenhuma saída do `--quiet` |
| `--check` | **falhou**, código de saída 1 |

- **Unitário que falhou:** `healing/experiments/overheadRun.spec.mts:142` › "baseline lida do git: os 134 fingerprints versionados, com os mesmos bytes da cópia de trabalho". A mensagem foi `Error: expect(received).toBe(expected) // Object.is equality`, com `Expected: true` e `Received: false`, na linha 149: `readFileSync(path.join(working, name)).equals(bytes)`.
- **Saída do `--check`:** `Diferente do gerado: tabelas/01-integridade.md; sobrando: nenhum`. Regerando a análise no clone, a única linha diferente foi "Matriz de efetividade lida do commit da rodada (`git show 09289cf:mutation/effectiveness-matrix.json`); idêntica à da árvore atual:", que saiu **não** no lugar de **sim**.

**Causa.** Fim de linha no checkout. `git ls-files --eol` no clone mostrou `i/lf w/crlf` nos 134 fingerprints de `healing/fingerprints/` e nos dois JSON de `mutation/`. Na cópia de trabalho de desenvolvimento, os mesmos arquivos estavam em `i/lf w/lf`. Com `core.autocrlf=true`, o Git converte LF em CRLF no checkout de todo arquivo sem atributo. O `.gitattributes` só marcava `experiments/results/**` e `experiments/analysis/**` como `-text`. As duas verificações comparam os bytes do git (LF) com os do disco (CRLF) e acusaram a diferença. Os dados não foram afetados, e os manifestos conferiram.

**Confirmação da causa**, no mesmo dia, sem acesso ao site:
- Num segundo clone do mesmo commit, com `-c core.autocrlf=false`, tudo passou: `tsc` sem erros, **154/154** unitários, os dois manifestos conferidos, `--check` com "49 arquivos idênticos ao gerado." e `git status` limpo.
- No clone da tentativa 1, com `-text` para os dois caminhos acrescentado ao `.gitattributes` e um novo checkout só desses arquivos, também deu 154/154 e `--check` com 49 arquivos idênticos.

### Correção — commit `9145d35`

Duas linhas no `.gitattributes`, no mesmo padrão das que já existiam:

```
healing/fingerprints/** -text
mutation/*.json -text
```

Os blobs não mudaram, porque já estavam em LF. Na cópia de trabalho de desenvolvimento também não mudou nada além do próprio `.gitattributes`.

**Inventário das comparações de bytes do código**, feito antes do commit para confirmar que não havia outro caso:

| Arquivos comparados | Onde | Cobertura |
|---|---|---|
| `healing/fingerprints/**` | git contra o disco no unitário de `overheadRun`; git contra a captura em `overheadRun.mts`; disco contra a captura em `roundtrip.mts`; hash antes/depois em `overhead.mts` e `integration/mutation.spec.ts` | **nova** |
| `mutation/effectiveness-matrix.json` | `git show` contra o disco em `resultsAnalysis.mts`; matriz medida contra o disco em `integration/mutation.spec.ts` | **nova** |
| `mutation/target-test-map.json` | nenhuma comparação de bytes no código (o harness só faz parse); coberto pelo mesmo glob por ser JSON gerado | nova |
| `experiments/results/**` | manifesto SHA-256 | já existia |
| `experiments/analysis/**` | `--check` | já existia |

O `git diff --quiet` dos fingerprints em `resultsAnalysis.mts` não depende do atributo, porque o próprio git normaliza o fim de linha.

### Tentativa 2 — commit `9145d35`: passou

Clone novo e a sequência completa, com a mesma configuração padrão, das 21:47:59 às 21:48:44 (horário local).

| Passo | Resultado |
|---|---|
| Clone | 4.368 arquivos. `git ls-files --eol`: os 136 arquivos dos dois caminhos em `w/lf attr/-text` |
| `npm ci` | 7 pacotes, 0 vulnerabilidades |
| `tsc --noEmit` | sem erros, saída vazia |
| Unitários | **154 passaram** (9,3 s), nenhum falhou |
| Manifesto da rodada principal | 2.506/2.506, nenhuma saída do `--quiet` |
| Manifesto da medição da captura | 1.599/1.599, nenhuma saída do `--quiet` |
| `--check` | "49 arquivos idênticos ao gerado.", código de saída 0 |
| `git status --porcelain` depois de tudo | vazio |

**Consequência para quem clonar.** No Windows, com a configuração padrão, basta `core.longpaths` no clone, como diz o README. Antes do `9145d35`, um clone novo falhava no unitário acima e no `--check` sem nenhum defeito nos dados. Pela leitura do código, a ida e volta (`roundtrip.mts`) também falharia, pelo mesmo motivo: ela compara a baseline do disco com a captura. Isso não foi executado, porque ela acessa o site.

**Anomalias.** A própria falha da tentativa 1, descrita acima.
