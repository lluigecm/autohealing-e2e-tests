# Contexto — Implementação da Heurística de Atributos Estáveis (Camada 3, parte 1/2)

> Este documento orienta o Claude Code na implementação da **primeira das duas heurísticas de recuperação** do mecanismo de auto-healing: atributos estáveis. A Camada 1 (captura de fingerprint) já está implementada e fechada — 134 fingerprints persistidos em `/healing/fingerprints/`, um por (página, seletor), com extração antes da ação e persistência só após sucesso confirmado. Este documento trata exclusivamente da heurística de atributos estáveis, implementada e testável de forma **isolada**, sem ainda estar conectada a um mecanismo de detecção de falha (Camada 2 — ainda não implementada).

## 1. Onde isso se encaixa na arquitetura

No desenho de 4 camadas do projeto, atributos estáveis e similaridade estrutural são **partes da mesma Camada 3 (heurísticas de recuperação)** — não são camadas separadas. Elas estão sendo implementadas em etapas distintas por conveniência de desenvolvimento incremental (cada heurística testável isoladamente antes de combiná-las), mas arquiteturalmente formam um único componente, que depois será combinado num score de confiança (etapa futura, fora deste documento).

## 2. Objetivo desta etapa

Implementar uma função de **matching por atributos estáveis**: dado um fingerprint salvo (de um elemento que existia numa versão anterior da página) e o DOM atual da página, tentar encontrar o elemento correspondente priorizando atributos estáveis (`data-testid`, `aria-label`, outros `data-*`/`aria-*`) em detrimento de atributos voláteis (`class`, `id` gerado dinamicamente).

Esta etapa **não** implementa:
- A heurística de similaridade estrutural (próxima etapa, documento separado).
- O score de confiança que combina as duas heurísticas.
- A camada de decisão (substituir seletor automaticamente vs. falhar).
- A detecção de falha (Camada 2) que aciona essa função em tempo de execução real.

## 3. Entrada e saída da função

- **Entrada**: um `Fingerprint` salvo (schema já definido em `/healing/fingerprint.ts`) e uma referência à página atual (`Page` do Playwright) onde a busca deve ocorrer.
- **Saída**: um resultado que informe, no mínimo:
  - Se um elemento candidato foi encontrado ou não.
  - Um **score de confiança específico desta heurística** (não confundir com o score de confiança combinado da Camada 3 completa, que ainda não existe) — um valor numérico normalizado (ex: 0 a 1) representando o quão bem os atributos do candidato batem com os do fingerprint salvo.
  - O `Locator` do elemento candidato encontrado, para uso posterior pela camada de decisão (etapa futura).

## 4. Lógica de matching (regras de priorização)

1. **Prioridade 1 — `data-testid`**: se o fingerprint salvo tem `data-testid`, buscar primeiro por elementos com o mesmo valor de `data-testid` no DOM atual. Se exatamente um elemento corresponder, esse é o candidato com confiança máxima desta heurística.
2. **Prioridade 2 — `aria-label`**: se não houver `data-testid` (no fingerprint ou no DOM atual), tentar por `aria-label` idêntico.
3. **Prioridade 3 — outros atributos `data-*`/`aria-*`**: se as prioridades acima não derem resultado único, tentar combinações dos demais atributos `data-*`/`aria-*` capturados no fingerprint.
4. **Atributos voláteis como desempate fraco, nunca como critério primário**: `class` e `id` podem ser usados apenas para desempatar entre múltiplos candidatos que já bateram em atributos estáveis — nunca como critério de busca isolado, já que são explicitamente os atributos que mudam e motivam a heurística.
5. **Múltiplos candidatos**: se mais de um elemento no DOM atual corresponder igualmente bem, retornar o de maior score, mas sinalizar explicitamente (campo booleano ou similar) que houve ambiguidade — informação relevante para a futura camada de decisão avaliar se deve confiar no resultado.
6. **Nenhum candidato**: retornar resultado indicando ausência de match, com score 0 — não lançar exceção (a ausência de match é um resultado válido e esperado desta função, não um erro).

## 5. Testabilidade isolada (sem Camada 2)

Como a detecção de falha ainda não existe, esta heurística deve ser testável via **testes unitários diretos**, sem depender de rodar a suíte E2E completa nem de simular uma falha real de locator.

**Configuração de execução — não usar `playwright.config.ts` existente.** A suíte E2E fixa em 66 testes (baseline, seção de critério de conclusão da Camada 1) é um número citado no texto do TCC — testes unitários de heurística não devem ser descobertos pelo mesmo `testDir` e inflar/alterar esse total. Criar uma configuração separada:
- `playwright.unit.config.ts`, com `testDir` apontando exclusivamente para os testes unitários de heurística (ex: `healing/**/*.spec.ts`), sem tocar em `playwright.config.ts`.
- Script `npm run test:unit` separado de `npm run test` (E2E).
- Reportar como dois números distintos no texto do TCC: "66 testes E2E (regressão funcional) + N testes unitários (validação de heurística)" — propósitos diferentes, não devem ser somados num total único.
- Esse mesmo padrão de configuração serve para os testes unitários das heurísticas futuras (similaridade estrutural, score de confiança), não precisa ser recriado a cada etapa.

Formato esperado para os testes em si:

- Carregar um fingerprint salvo de `/healing/fingerprints/` (ou um fixture de teste construído manualmente a partir do schema).
- Abrir a página correspondente (via Playwright, mas fora do fluxo dos specs E2E existentes — pode ser um teste separado, ex: `healing/heuristics/attributeMatching.spec.ts` ou equivalente).
- Chamar a função de matching diretamente e validar o resultado contra o elemento esperado.
- Cenários mínimos a cobrir nos testes:
  - Match exato por `data-testid` (caso feliz).
  - Fallback para `aria-label` quando `data-testid` não está presente no fingerprint.
  - Ausência de match retorna resultado vazio, não exceção.
  - Ambiguidade (mais de um candidato) é sinalizada corretamente.

## 6. O que NÃO fazer nesta etapa

- Não implementar a heurística de similaridade estrutural.
- Não implementar o score de confiança combinado nem a camada de decisão.
- Não implementar a detecção de falha (Camada 2) — esta heurística é testada isoladamente, não integrada ainda.
- Não modificar o schema do `Fingerprint` definido na Camada 1, a menos que um campo esteja genuinamente faltando para esta heurística funcionar (se isso acontecer, sinalizar antes de alterar).
- Não tocar na suíte baseline (`tests/`), no `withCapture`, no `fingerprintStore.ts` nem em `amostras.ts` — todos fechados em etapas anteriores.

## 7. Critério de conclusão desta etapa

- Função de matching por atributos estáveis implementada em `/healing/heuristics/` (ex: `attributeHeuristic.ts`), com as regras de priorização da seção 4.
- Testes unitários cobrindo os cenários da seção 5, todos passando.
- `tsc --noEmit` limpo.
- A suíte baseline (66 testes) continua passando 100% sem nenhuma alteração de comportamento.

## 8. Como usar este documento

Cole este arquivo (ou seu conteúdo) como instrução para o Claude Code, junto com um pedido do tipo: *"Implemente a heurística de atributos estáveis conforme este documento, começando pelo schema de entrada/saída e pela lógica de priorização."*
