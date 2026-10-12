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
