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
