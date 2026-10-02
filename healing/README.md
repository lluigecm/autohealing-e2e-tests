# Camada 1 — Captura de Fingerprint · Camada 3 — Heurísticas e Score · Camada 4 — Decisão

Captura e persiste o estado "saudável" de cada elemento exercitado pela suíte baseline (Camada 1), consome esse baseline em duas heurísticas de recuperação e combina as duas num score de confiança (Camada 3), e converte esse score em decisão — substituir o seletor ou falhar (Camada 4). A detecção de falha (Camada 2) ainda não existe: o mecanismo é exercitado por chamada direta, não integrado ao fluxo dos testes.

> Este arquivo descreve **como o mecanismo funciona**. O **porquê** de cada decisão, com as alternativas descartadas, está em [`DECISIONS.md`](DECISIONS.md).

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `fingerprint.ts` | Schema (`Fingerprint`) — contrato consumido pelas heurísticas |
| `withCapture.ts` | Ponto de extensão único entre Page Objects e `Locator`; extrai os dados do DOM |
| `fingerprintStore.ts` | Persistência em `fingerprints/`, um arquivo JSON por elemento |
| `withCapture.spec.ts` | Testes unitários da lógica de captura (sem navegador) |
| `heuristics/attributeHeuristic.ts` | Heurística de atributos estáveis (Camada 3, parte 1/2) |
| `heuristics/attributeHeuristic.spec.ts` | Testes unitários da heurística (DOM via `setContent`) |
| `heuristics/structuralHeuristic.ts` | Heurística de similaridade estrutural (Camada 3, parte 2/2) |
| `heuristics/structuralHeuristic.spec.ts` | Testes unitários da heurística (DOM via `setContent`) |
| `decision/confidenceScore.ts` | Combinação das duas heurísticas num score de confiança (fecha a Camada 3) |
| `decision/confidenceScore.spec.ts` | Testes unitários da combinação (resultados sintéticos, locators reais) |
| `decision/decide.ts` | Limiar, decisão (substituir/falhar) e log estruturado (Camada 4) |
| `decision/decide.spec.ts` | Testes unitários da decisão e do formato do log |
| `../integration/` | Testes de integração das heurísticas e do score contra o alvo real |

## Testes

```bash
npm test               # 66 testes E2E (playwright.config.ts) — regressão funcional da suíte baseline
npm run test:unit      # 53 testes unitários (playwright.unit.config.ts) — lógica do mecanismo, zero rede
npm run test:integration  # 15 testes de integração (playwright.integration.config.ts) — mecanismo contra o alvo real
```

São **três números com propósitos distintos e não devem ser somados num total só**: a suíte E2E mede regressão funcional, os unitários validam a lógica do mecanismo sem tocar a rede (DOM via `page.setContent()`), e os de integração provam que o mecanismo funciona no site avaliado. Só a terceira categoria depende de rede, e é a única com `retries` — uma instabilidade de rede não deve ser lida como falha de heurística (ADR-009).

Os unitários gravam num diretório temporário via `HEALING_FINGERPRINTS_DIR` — o baseline versionado em `fingerprints/` só recebe arquivos de execuções reais da suíte.

## Schema

```jsonc
{
  "selector": "role=article[0] >> role=heading[level=3] >> role=link", // descrição do seletor original
  "url": "/catalogue/category/books/travel_2/index.html",              // pathname da página
  "tag": "a",
  "text": "It's Only the Himalayas",                                   // texto visível, espaços normalizados
  "attributes": {
    "stable":   {},                                                    // data-* e aria-* (chaves ordenadas)
    "volatile": { "class": null, "id": null }                          // contexto/fallback
  },
  "position": {
    "parentTag": "h3",
    "parentSiblingIndex": 2,   // índice do pai entre os filhos do avô
    "siblingIndex": 0,         // índice do elemento entre os filhos do pai
    "depth": 10                // ancestrais entre o elemento e <body>
  }
}
```

## Uso nos Page Objects

Nenhum Page Object chama ações do `Locator` diretamente — tudo passa por `this.withCapture(...)`, herdado de `BasePage`:

```typescript
async goToNextPage(): Promise<void> {
  await this.withCapture('role=link[name=next]', this.nextPageLink, (l) => l.click());
}
```

A `description` (1º argumento) é escrita manualmente porque `getByRole`/`getByText` não expõem string de seletor publicamente. Ela é a chave do fingerprint dentro da página, então precisa ser estável entre execuções.

Assertions também passam por aqui — um locator usado só em asserção é igualmente vulnerável a mutações, e deixá-lo de fora criaria ponto cego no experimento:

```typescript
async expectTitleVisible(): Promise<void> {
  await this.withCapture('role=heading[level=1]', this.title, async (l) => {
    await expect(l).toBeVisible();
  });
}
```

## Decisões de implementação

- **Extrair → agir → persistir.** A *extração* acontece antes da ação, porque ações de navegação (clicar num link) destroem o elemento e lê-lo depois encontraria a página seguinte. A *gravação em disco* só acontece se `action` não lançou erro, preservando a semântica de "fingerprint de interação bem-sucedida", não apenas de elemento localizado.
- **Um arquivo por (página, seletor)**, em `fingerprints/<página>/<seletor>.json`. Com 8 workers em paralelo, um arquivo único por página sofreria *lost update* no ciclo read-modify-write; um arquivo por elemento não tem esse problema, e escritas concorrentes da mesma chave produzem bytes idênticos. A escrita é atômica (arquivo temporário + `rename`).
- **Sem timestamp e sem histórico.** Duas execuções seguidas sobre um site inalterado precisam gerar bytes idênticos (critério de determinismo); qualquer campo de data quebraria isso. Cada execução sobrescreve com o estado saudável mais recente.
- **Chave por URL completa, não por padrão de URL.** As 16 categorias amostradas compartilham o mesmo template, mas colapsá-las numa chave só tornaria o conteúdo gravado dependente de qual worker escreveu por último — não determinístico.
- **Falha de captura nunca quebra o teste.** Se o elemento não puder ser lido, a extração retorna `null` e a falha real aparece na ação seguinte.
- **`fingerprints/` é versionado**, não tratado como artefato gerado: é o baseline reprodutível contra o qual os experimentos de mutação vão comparar, e a fonte dos números citados no texto do TCC.

## Limitações conhecidas

- **Locators de coleção geram fingerprint apenas do primeiro match.** `role=article` casa os 20 cards de uma listagem, mas `evaluate` em locator múltiplo violaria o strict mode do Playwright, então só o primeiro elemento é fingerprintado, como representante da coleção.

  Consequência para o experimento: uma mutação que atinja somente um card que não é o primeiro não terá fingerprint de referência próprio — a recuperação teria que se apoiar no representante. Ao interpretar taxa de recuperação por elemento, considerar que a amostra cobre 1 elemento por coleção, não os N da listagem.

  Elementos acessados por índice (ex: `role=article[0] >> role=heading[level=3] >> role=link`, usado em `openProductByIndex`) **não** sofrem dessa limitação: cada índice é uma chave distinta e gera seu próprio fingerprint.

## Heurística de atributos estáveis (`heuristics/attributeHeuristic.ts`)

`matchByStableAttributes(page, fingerprint)` procura, no DOM atual, o elemento descrito por um fingerprint salvo. Devolve sempre um resultado — ausência de match é `{ matched: false, score: 0 }`, nunca exceção.

Ordem de priorização, com o teto de confiança de cada uma:

| # | Critério | Teto do score |
|---|---|---|
| 1 | `data-testid` idêntico | 1.00 |
| 2 | `aria-label` idêntico | 0.90 |
| 3 | Combinação dos demais `data-*`/`aria-*`, proporcional à fração que casou | 0.75 |
| — | Sem candidato | 0.00 |

A queda para o critério seguinte acontece tanto quando o atributo falta no fingerprint quanto quando ele não casa com nada no DOM atual.

`class` e `id` **nunca** são critério de busca — só desempatam candidatos que já casaram em atributos estáveis. Um empate resolvido por volátil custa 20% do score (`×0.8`); um empate que nem os voláteis resolvem custa 50% (`×0.5`), porque aí a escolha é quase arbitrária. `ambiguous` é sinalizado sempre que houve mais de um candidato, mesmo quando o desempate elegeu um vencedor — quem decide se confia nisso é a camada de decisão, não a heurística.

O score é **local a esta heurística**, não o score de confiança combinado da Camada 3 completa — que vai fundir esta com a similaridade estrutural, numa etapa ainda por vir.

### Limitação relevante para o experimento

`applicable: false` marca o fingerprint sem nenhum atributo estável — a heurística não chegou a rodar, o que é diferente de ter rodado e não achado nada. **Os 134 fingerprints do baseline caem todos nesse caso**: books.toscrape.com não usa `data-*` nem `aria-*` em elemento nenhum. Na prática, a recuperação no site alvo vai depender inteiramente da similaridade estrutural; esta heurística está validada por fixtures e fica pronta para alvos que tenham esses atributos. Isso é resultado a reportar no TCC, não defeito da implementação.

⚠️ **Consequência para a etapa de score combinado:** `applicable: false` deve ser **excluído do cálculo**, nunca contado como match de confiança 0 — ver [ADR-007](DECISIONS.md). Contar como 0 rebaixaria pela metade a confiança de toda recuperação no alvo atual, medindo a falta de instrumentação do site em vez da qualidade do healing.

## Heurística de similaridade estrutural (`heuristics/structuralHeuristic.ts`)

`matchByStructuralSimilarity(page, fingerprint)` procura o elemento pela **posição na árvore**, sem olhar atributo nenhum. É a contraparte da heurística acima: aquela depende de instrumentação que o alvo não tem, esta depende de estrutura, que todo elemento tem.

O score é a soma de quatro sinais, e não uma cascata de critérios — sinais estruturais se degradam por grau, não por presença:

| Sinal | Peso | Como pontua |
|---|---|---|
| Pai (`parentTag` + índice do pai) | 0.45 | Cheio se tag e índice batem; metade se só a tag bate |
| Índice entre irmãos | 0.30 | Decai com a distância, zera a 4 posições |
| Profundidade | 0.15 | Decai com a distância, zera a 2 níveis |
| Tag | 0.10 | Tudo ou nada |

Candidatos abaixo de **0.25** são descartados como ruído — 0.25 é exatamente `profundidade + tag`, o critério mais fraco que ainda conta. `strategy` (`parent+siblingPosition`, `depth+tag`, `partial`) é rótulo descritivo de qual critério dominou; quem decide é o score.

### O que a validação contra o alvo real mostrou

- **`applicable` é `true` nos 134 fingerprints** — o inverso exato da heurística de atributos. No alvo atual é esta heurística que sustenta toda a recuperação.
- **Sobrevive à reescrita de `class` e `id`** em página real, que é a tese central do trabalho nesta heurística.
- **A discriminação morre dentro de containers repetidos.** Elementos a dois ou mais níveis abaixo do container que se repete são estruturalmente idênticos entre si: os 20 `h3` de uma listagem têm todos pai `article` no índice 0, irmão 2, profundidade 9 — o índice que separa os cards está no `<li>`, que é o **avô**, e o fingerprint guarda só um nível de ancestral. Nesses casos o resultado vem com `ambiguous: true` e o `candidateCount` real. O elemento devolvido é o correto, mas por convenção (captura usa `.first()`, desempate é ordem do documento), não por evidência estrutural. Ver [ADR-010](DECISIONS.md).

O `article` em si não sofre desse problema: o pai dele *é* o `<li>` cujo índice varia.

### Limite de identificabilidade posicional

Duas classes de caso em que a similaridade estrutural é insuficiente **por princípio**, não por implementação:

1. **Geometria idêntica.** Elementos dentro de containers repetidos são estruturalmente indistinguíveis por definição. Resultado: `ambiguous: true` com score alto.
2. **Reordenação.** Medido no alvo real: invertendo a ordem dos cards, o fingerprint de `role=article` devolve o livro errado com **score 1.0 e `ambiguous: false`** — o `<li>` de índice 0 continua existindo, só que contém outro produto. Não há ambiguidade a sinalizar porque o match é único; está apenas errado. Nenhum sinal posicional distingue "o elemento se moveu" de "outro ocupou o lugar dele".

Os dois casos continuam travados em testes de caracterização em `integration/structuralHeuristic.spec.ts`: eles fixam o comportamento da heurística **isolada**, que não mudou e não deve mudar — o limite é dela. O que a combinação acrescenta é a segunda metade da evidência: o mesmo cenário de reordenação, atravessando `decision/confidenceScore.ts`, agora é rebaixado e recusado em `integration/confidenceScore.spec.ts`. Ver [ADR-011](DECISIONS.md), [ADR-012](DECISIONS.md) e, para como as restrições foram implementadas, [ADR-014](DECISIONS.md).

## Score de confiança (`decision/confidenceScore.ts`)

`combineConfidence(atributos, estrutural, fingerprint)` funde os dois resultados num `ConfidenceResult`. Os scores das heurísticas são **locais** — cada um mede a qualidade do casamento sob o seu próprio critério — e nenhum dos dois decide nada sozinho.

Quatro passos, nesta ordem:

| Passo | Regra | Efeito |
|---|---|---|
| 1 · Aplicabilidade | `applicable: false` sai do cálculo; nenhuma aplicável → `score: null` | ADR-007 |
| 2 · Combinação | Maior score entre as que acharam candidato; elementos divergentes aplicam ×0.5 | ADR-013 |
| 3 · Ambiguidade | `ambiguous: true` não resolvido aplica ×0.5 sobre o combinado | ADR-011, ADR-015 |
| 4 · Corroboração por texto | Fator em [0.5, 1.0] pela similaridade de token entre `fingerprint.text` e o texto do candidato | ADR-012, ADR-014 |

`score: null` é **"sem confiança"**, não zero: zero afirmaria que se mediu e não se achou nada. O tipo obriga todo chamador a tratar os dois casos à parte. `reason` distingue `no-applicable-heuristic` de `no-candidate-found`, e `flags` registra cada caso especial que participou do cálculo — é o que o log de auditoria da Camada 4 carrega.

A corroboração por texto é o **único sinal do mecanismo independente de posição**, e por isso o único capaz de rebaixar um match geometricamente perfeito porém incorreto. Entra sempre **depois** do match, nunca como critério de busca, e desconta em vez de rejeitar: conteúdo muda legitimamente entre versões de uma página.

## Decisão (`decision/decide.ts`)

`decide(fingerprint, confidence, options?)` devolve `replace` ou `fail`, sempre registrando a decisão.

- **Limiar:** `CONFIDENCE_THRESHOLD = 0.7`, inclusivo, sobrescrevível por chamada. **Valor provisório** — a etapa de experimentos vai calibrá-lo, e ele não deve ser citado como validado (ADR-016).
- **Acima:** substitui e devolve o candidato; a entrada de log tem página, seletor original, descrição do candidato, score, limiar vigente, heurísticas contribuintes, flags e o timestamp da **decisão**.
- **Abaixo, incluindo "sem confiança":** falha sem recuperação e **não** devolve o candidato. Falhar visivelmente é melhor que mascarar defeito real com um falso positivo silencioso.
- O log registra as **duas** decisões: sem as falhas não há denominador para calcular taxa de recuperação nos experimentos.

### O que o score mostrou no alvo real

| Cenário (medido) | Score | Decisão |
|---|---|---|
| Geometria discriminante, página íntegra | 1.00 | substitui |
| `class` e `id` reescritos em página real | 1.00 | substitui |
| Edição leve de conteúdo (1 token distinto em 9) | 0.875 | substitui |
| Elemento em estrutura repetida (20 candidatos) | 0.50 | **falha** |
| Reordenação de cards (ADR-012) | 0.50 | **falha** |
| Reordenação + estrutura repetida | 0.25 | **falha** |

Duas leituras que valem para o texto do trabalho: no alvo avaliado **só elementos de geometria discriminante são curáveis sem revisão humana** — acertar por ordem do documento não conta como evidência (ADR-015) — e, como a heurística de atributos é inaplicável aqui (ADR-006), **o caminho de divergência entre heurísticas nunca é exercitado sob dados reais** (ADR-013).

## Estado atual

Uma execução completa da suíte baseline (66 testes) gera **134 fingerprints** em 34 páginas. Com a combinação e a decisão implementadas, o mecanismo está funcionalmente completo exceto pela Camada 2: nada ainda **detecta** a falha de locator e chama `combineConfidence` automaticamente.
