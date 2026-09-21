# Camada 1 — Captura de Fingerprint · Camada 3 (parcial) — Heurísticas

Captura e persiste o estado "saudável" de cada elemento exercitado pela suíte baseline (Camada 1), e começa a consumir esse baseline nas heurísticas de recuperação (Camada 3). A detecção de falha (Camada 2) ainda não existe — a heurística é exercitada por chamada direta, não integrada ao fluxo dos testes.

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

## Testes

```bash
npm test        # 66 testes E2E (playwright.config.ts) — regressão funcional da suíte baseline
npm run test:unit  # 17 testes unitários (playwright.unit.config.ts) — lógica do mecanismo de healing
```

São dois números com propósitos distintos e não devem ser somados num total só: a suíte E2E mede regressão funcional contra o site real, os unitários validam a lógica do mecanismo. Os unitários não tocam a rede — os que precisam de DOM montam a página com `page.setContent()`.

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

O score é **local a esta heurística**, não o score de confiança combinado da Camada 3 completa (que também vai incluir similaridade estrutural, ainda não implementada).

### Limitação relevante para o experimento

`applicable: false` marca o fingerprint sem nenhum atributo estável — a heurística não chegou a rodar, o que é diferente de ter rodado e não achado nada. **Os 134 fingerprints do baseline caem todos nesse caso**: books.toscrape.com não usa `data-*` nem `aria-*` em elemento nenhum. Na prática, a recuperação no site alvo vai depender inteiramente da similaridade estrutural; esta heurística está validada por fixtures e fica pronta para alvos que tenham esses atributos. Isso é resultado a reportar no TCC, não defeito da implementação.

## Estado atual

Uma execução completa da suíte baseline (66 testes) gera **134 fingerprints** em 34 páginas.
