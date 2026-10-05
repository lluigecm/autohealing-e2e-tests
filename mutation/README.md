# Ferramenta de mutação de DOM

Catálogo **pequeno, fixo e determinístico** de mutações aplicáveis ao books.toscrape.com, cada uma com rótulo de verdade (ground truth) consumido pelo harness dos experimentos para calcular taxa de recuperação e taxa de falso positivo. Não é uma ferramenta genérica: os seletores conhecem o DOM do site e são escritos só para ele. Sem aleatoriedade — mesma entrada, mesmo DOM de saída.

## Tipos

| # | Tipo | Efeito | class | preservesOrder | expectedOutcome |
|---|---|---|---|---|---|
| M1 | `volatile-attributes` | Reescreve `class` e `id` do alvo (define-os mesmo quando ausentes) | cosmetic | true | recover |
| M2 | `text-change` | Altera o texto visível do alvo (rótulos de links) | cosmetic | true | recover |
| M3 | `reorder-siblings` | Inverte a ordem dos filhos de um grupo declarado (ex: cards da listagem) | cosmetic | false | recover |
| M4 | `wrap-in-container` | Envolve o alvo num `<div>` sem atributos (muda pai e profundidade) | cosmetic | true | recover |
| M5 | `remove-element` | Remove o alvo do DOM | defect | true | fail |

`cosmetic`: o alvo continua existindo e a recuperação deve relocalizá-lo. `defect`: o alvo deixa de existir — qualquer "recuperação" é falso positivo por definição. `preservesOrder` existe porque o falso positivo é medido separando mutações que alteram a ordem das que a preservam.

## Alvos e catálogo

Dez alvos (T1–T10), um por elemento que a suíte baseline localiza, cada um ligado à chave do fingerprint de baseline correspondente (`target.baseline`, aceita direto por `fingerprintPath`):

| Alvo | Elemento | Página de referência |
|---|---|---|
| T1 | link da categoria na sidebar — instanciado pelas 16 categorias de `amostras.ts` | home |
| T2 | primeiro card de produto | home |
| T3 | link do título do primeiro card | categoria Travel |
| T4 | link "next" da paginação | home |
| T5 | h1 da página de categoria | categoria Travel |
| T6 | sidebar (`aside`) | home |
| T7–T10 | título, preço, disponibilidade e rating do produto | primeiro produto de Travel |

103 entradas: M1, M4 e M5 em todos os alvos (25 cada); M2 só em links (5, com relabel total e duas edições leves); M3 só onde há grupo de irmãos real (23).

## Uso

```ts
import { findMutation } from '../mutation/catalog';
import { applyMutation, pointsToOracle, readMutationState } from '../mutation/applyMutation';

await applyMutation(page, findMutation('M3-T2'));   // ou um BrowserContext
await page.goto('/index.html');                       // a mutação roda em DOMContentLoaded, em toda navegação

await readMutationState(page);                        // { id, applied, oracleIsNull }
await pointsToOracle(algumLocator);                   // o locator aponta para o elemento-alvo?
```

- **Oráculo fora do DOM.** A mutação guarda `{ id, applied, oracle }` em `window.__mutation` — nunca um `data-*`/`aria-*`, que contaminaria a heurística de atributos estáveis. `applied: false` = nada transformado (alvo ausente na página, por exemplo o link "Travel" na própria página Travel); `oracle: null` com `applied: true` = M5.
- **Captura desligada.** Toda execução sob mutação precisa de `HEALING_CAPTURE=off`, senão uma ação bem-sucedida regravaria `healing/fingerprints/` com dados mutados. Nos specs, defina e restaure a variável em `beforeAll`/`afterAll` — não no nível do módulo, porque o worker é reaproveitado entre arquivos.
- **Fora do escopo:** injetar uma mutação nos 66 testes E2E é decisão do harness (item 7).

## Arquivos

| Arquivo | Papel |
|---|---|
| `types.ts` | Tipos, rótulos de verdade (`MUTATION_METADATA`) e o formato do oráculo |
| `catalog.ts` | Alvos e as 103 entradas do catálogo |
| `applyMutation.ts` | Transformação (`mutateDocument`), instalação via `addInitScript` e leitura do oráculo |
| `effectiveness-matrix.json` | Matriz de efetividade medida no alvo real. **Gerado — não editar à mão** |
| `targetTestMap.ts`, `targetTestMapReporter.ts`, `targetTestMap.config.ts` | Geração do mapa teste → método de Page Object → locator → alvo |
| `target-test-map.json` | Mapa de rastreabilidade dos 66 testes aos alvos T1–T10. **Gerado — não editar à mão** |

## Mapa teste → alvo

`target-test-map.json` sai da **execução real** dos 66 testes de `tests/`, sem alterar nenhum deles. O config dedicado troca `withCapture` por uma versão que, antes de cada ação, registra o método do Page Object, a linha do spec e o locator. Também pergunta ao DOM quais alvos do catálogo esse locator resolve ou atravessa. O alvo é identificado pelo seletor CSS do catálogo, avaliado na página em que a chamada acontece. A captura de fingerprints fica desligada durante a execução.

Cada alvo é contado em três definições de "o teste exercita o alvo":

- **A**: algum locator do teste resolve o alvo ou passa por ele (o alvo é ancestral do elemento resolvido), inclusive por locator de coleção;
- **A sem coleção**: o mesmo que A, sem os locators de coleção (`role=article` para contagem, títulos dos cards);
- **B**: algum locator do teste resolve exatamente o alvo e só ele, ou seja, a asserção ou a ação recai sobre o próprio alvo.

Um par (método, locator) é de coleção quando resolve mais de um elemento em alguma chamada da execução. Isso vale para todas as suas chamadas, inclusive em Crime, a categoria de um livro só.

O reporter só grava o arquivo se os 66 testes passarem, todos gerarem registro e cada um exercitar ao menos um alvo em A e em B. Para regerar:

```bash
TARGET_MAP_OUT=a.json npx playwright test --config=mutation/targetTestMap.config.ts
TARGET_MAP_OUT=b.json npx playwright test --config=mutation/targetTestMap.config.ts
diff a.json b.json && cp a.json mutation/target-test-map.json
```

## Testes

- **Unitários** em [`healing/mutation/`](../healing/mutation/) (`npm run test:unit`), sem rede, com fixtures via `setContent` e `page.route`. Moram sob `healing/` e não aqui porque o `testDir` de `playwright.unit.config.ts` é `./healing` e as configs não podem mudar; o código testado continua em `/mutation`.
- **Integração** em [`integration/mutation.spec.ts`](../integration/mutation.spec.ts) (`npm run test:integration`), contra o site real, com `HEALING_CAPTURE=off` e verificação por hash de que `healing/fingerprints/` não mudou. Inclui a matriz de efetividade, que compara a medição com `effectiveness-matrix.json`.

Para regerar a matriz (só quando o catálogo ou os Page Objects mudarem):

```bash
MUTATION_MATRIX_OUT=a.json npx playwright test --config=playwright.integration.config.ts -g "matriz"
MUTATION_MATRIX_OUT=b.json npx playwright test --config=playwright.integration.config.ts -g "matriz"
diff a.json b.json && cp a.json mutation/effectiveness-matrix.json
```

Duas rodadas e diff zero antes de versionar: a matriz roda com `retries: 0` justamente para que uma divergência entre rodadas apareça em vez de ser absorvida.
