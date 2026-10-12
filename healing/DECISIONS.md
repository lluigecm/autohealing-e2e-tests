# Registro de Decisões — Mecanismo de Auto-Healing

Architecture Decision Records do mecanismo de healing: uma entrada por decisão de design ou achado empírico relevante, em ordem cronológica. O `README.md` descreve **como o mecanismo funciona hoje**; este arquivo registra **por que ficou assim** e o que foi descartado no caminho — informação que o código não carrega e que sustenta a argumentação do TCC.

Atualizado a cada etapa, junto com o código da etapa. Entradas antigas não são reescritas: se uma decisão for revista, entra um ADR novo que a supersede e o antigo é marcado como tal.

Formato de cada entrada: **Contexto** · **Decisão** · **Alternativas consideradas** · **Consequência**.

**Sobre o histórico.** Até 2026-10-11 este arquivo era mantido só localmente. As datas das entradas anteriores a isso são as registradas na hora da escrita, e o histórico do git não as comprova. Algumas entradas comparam o resultado com a **especificação inicial da etapa**, um documento de planejamento que não é versionado. Nesses casos, o trecho relevante aparece parafraseado na própria entrada.

---

## ADR-001 — Escada de priorização com teto de confiança por estratégia

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 (atributos estáveis) · **Status:** aceito

**Contexto.** A heurística de atributos estáveis precisa devolver não só um candidato, mas o quanto confiar nele — a futura camada de decisão vai usar esse número para escolher entre substituir o seletor e falhar o teste. `data-testid`, `aria-label` e os demais `data-*`/`aria-*` não são evidências equivalentes.

**Decisão.** Cada critério tem um teto de score fixo: `data-testid` 1.00, `aria-label` 0.90, combinação dos demais `data-*`/`aria-*` 0.75 multiplicado pela fração dos atributos que casou. A queda para o critério seguinte acontece tanto quando o atributo falta no fingerprint quanto quando ele não casa com nada no DOM atual.

**Alternativas consideradas.** (a) Score binário 0/1 por match — descartado: perderia a distinção entre um `data-testid` único e um `aria-label` genérico repetido em vários elementos, que é exatamente o que a camada de decisão precisa saber. (b) Soma ponderada de todos os atributos sem ordem de prioridade — descartado: permitiria que vários atributos fracos somassem mais que um `data-testid`, invertendo a hierarquia de evidência que motiva a heurística.

**Consequência.** Os scores são comparáveis entre execuções e diretamente citáveis no texto. O custo é que os pesos são calibrados por argumento, não por dados — se os experimentos de mutação mostrarem que `aria-label` acerta tanto quanto `data-testid` no alvo, os números precisam ser revistos num ADR novo.

---

## ADR-002 — `class` e `id` como desempate, nunca como critério de busca

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 · **Status:** aceito

**Contexto.** `class` e `id` são os atributos mais discriminantes do DOM na prática, e também os que as mutações do experimento vão reescrever. Usá-los para buscar seria contaminar a heurística com o sinal que ela existe para substituir.

**Decisão.** Os voláteis só entram depois que dois ou mais candidatos já casaram igualmente bem em atributos estáveis, para escolher entre eles — por `id` idêntico (peso 2) e por sobreposição de tokens de `class` (Jaccard, 0 a 1). O uso custa score: empate resolvido por volátil aplica ×0.8, empate que nem os voláteis resolvem aplica ×0.5, porque aí a escolha do primeiro candidato é quase arbitrária.

**Alternativas consideradas.** (a) Ignorar voláteis por completo — descartado: joga fora informação útil em empates que de outro modo ficariam irresolúveis, sem ganho de rigor, já que o desempate nunca cria um match que não existia. (b) Incluir `class`/`id` na busca com peso baixo — descartado: um elemento errado com a classe antiga preservada venceria um elemento certo com a classe reescrita, que é precisamente o modo de falha que o mecanismo deveria evitar.

**Consequência.** A heurística é imune, por construção, a mutações de `class`/`id` — o que torna o resultado dos experimentos interpretável como mérito dos atributos estáveis. Em compensação, ela não recupera nada em páginas cujo único identificador seja `class` ou `id` (ver ADR-006).

---

## ADR-003 — Ambiguidade é sinalizada mesmo quando o desempate a resolve

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 · **Status:** aceito

**Contexto.** Quando vários elementos casam igualmente bem, o desempate por volátil frequentemente elege um vencedor único. Cabe perguntar se o resultado deve então ser reportado como não-ambíguo.

**Decisão.** `ambiguous` é `true` sempre que houve mais de um candidato, independentemente de o desempate ter resolvido. O campo `tiebreakUsed` informa, à parte, se os voláteis foram acionados, e `candidateCount` diz quantos concorriam.

**Alternativas consideradas.** Zerar `ambiguous` quando o desempate elege um vencedor único — descartado: esconderia da camada de decisão que a escolha se apoiou num sinal volátil, que é justamente o sinal que pode ter sido mutado. Quem decide o nível de risco aceitável é a camada de decisão, não a heurística.

**Consequência.** A camada de decisão recebe três campos independentes em vez de um veredito pronto, e precisa combiná-los. É mais verboso, mas mantém a heurística como fornecedora de evidência, não como juíza — separação que as etapas seguintes dependem para combinar as duas heurísticas num score único.

---

## ADR-004 — Ausência de match é resultado, e `applicable` separa "não rodou" de "não achou"

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 · **Status:** aceito

**Contexto.** Não encontrar o elemento é o desfecho esperado sempre que a mutação destruiu todos os atributos estáveis — é dado do experimento, não anomalia. Além disso, um fingerprint sem nenhum atributo estável faz a heurística não ter o que procurar, o que é um caso diferente de ter procurado e não achado.

**Decisão.** A função nunca lança por ausência de candidato: devolve `matched: false`, `score: 0`, `locator: null`. O campo `applicable` é `false` quando o fingerprint não tem atributo estável algum, e `true` quando a busca de fato ocorreu e não produziu candidato.

**Alternativas consideradas.** (a) Lançar exceção em caso de não-match — descartado: forçaria try/catch em todo chamador e tornaria indistinguível, nos experimentos, "heurística não recuperou" de "heurística quebrou". (b) Apenas `matched: false`, sem `applicable` — descartado: colapsaria os dois casos e inflaria artificialmente a taxa de "falha de recuperação" com elementos que a heurística nunca teve chance de tratar.

**Consequência.** A taxa de recuperação dos experimentos pode ser calculada sobre a base correta — só os casos aplicáveis — e a diferença entre as duas bases vira um número reportável por si só.

---

## ADR-005 — Testes unitários com DOM sintético via `setContent`, em config própria

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 · **Status:** aceito

**Contexto.** A heurística precisa de um DOM real para consultar, mas os testes dela não podem entrar no `testDir` da suíte E2E (o total de 66 testes é citado no texto) nem depender do site alvo, que além de externo não tem os atributos necessários (ADR-006).

**Decisão.** Os testes montam a página com `page.setContent()` a partir de fixtures que representam a página **já mutada** (classes reescritas), rodando sob o `playwright.unit.config.ts` que já existia da Camada 1 — ao qual foi adicionado um projeto `chromium`, mantido sem `baseURL` de propósito. Um dos testes carrega um fingerprint real de `fingerprints/` para provar que o schema da Camada 1 é consumido sem adaptação.

**Alternativas consideradas.** (a) Navegar até as páginas reais de books.toscrape.com — descartado: não exercitaria nenhuma das três prioridades, já que o site não tem `data-*`/`aria-*`, e tornaria o resultado dependente de rede. (b) Mockar o `Page` do Playwright — descartado: validaria o mock, não o comportamento dos seletores CSS contra um DOM de verdade.

**Consequência.** Os cenários previstos na especificação inicial da etapa ficam todos cobertos e determinísticos (17 testes unitários, sem rede). O custo é que a heurística ainda não foi exercitada contra HTML de produção — o que só vai acontecer quando o alvo dos experimentos oferecer atributos estáveis.

---

## ADR-006 — Achado empírico: o alvo não oferece atributos estáveis

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 · **Status:** aceito

**Contexto.** Ao implementar a heurística, a verificação dos fingerprints já capturados mostrou que **os 134 fingerprints do baseline têm `attributes.stable: {}`** — books.toscrape.com não usa `data-*` nem `aria-*` em elemento nenhum.

**Decisão.** Manter a heurística implementada e validada por fixtures, e tratar o achado como resultado a reportar no TCC, não como defeito de implementação nem como motivo para trocar o site alvo.

**Alternativas consideradas.** (a) Trocar o alvo por um site com `data-testid` — descartado: invalidaria a suíte baseline, os 134 fingerprints e os 66 testes E2E já fechados, por um ganho que é de conveniência da heurística, não da pergunta de pesquisa. (b) Injetar atributos estáveis no DOM antes de capturar — descartado: fabricaria a condição que a heurística deveria encontrar, tornando o experimento circular.

**Consequência.** No alvo atual, a recuperação vai depender inteiramente da similaridade estrutural (próxima etapa), e a taxa de recuperação por atributos estáveis será 0 por inaplicabilidade — número que precisa ser apresentado como característica do alvo, não como desempenho da heurística. Reforça que a similaridade estrutural é o componente crítico do mecanismo, e não o complemento que se imaginava no desenho inicial.

---

## ADR-007 — Heurística inaplicável é excluída do score combinado, não contada como zero

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 1/2 (restrição para a etapa de combinação) · **Status:** aceito, pendente de implementação

**Contexto.** Decorre do ADR-006: no alvo real, a heurística de atributos estáveis retorna `applicable: false` em 100% dos casos. A etapa de combinação vai fundir esta heurística e a de similaridade estrutural num score de confiança único, e precisa saber o que fazer com um componente que não teve como opinar.

**Decisão.** Quando uma heurística retorna `applicable: false`, o score combinado deve **excluí-la do cálculo** — recalculando sobre as heurísticas restantes — e não tratá-la como um match de confiança 0.

**Alternativas consideradas.** Contabilizar `applicable: false` como score 0 — descartado: numa média de duas heurísticas, rebaixaria pela metade a confiança de *toda* recuperação no alvo atual, mesmo quando a similaridade estrutural sozinha tivesse confiança alta. O número resultante mediria a ausência de instrumentação do site, não a qualidade da recuperação, e distorceria a camada de decisão para recusar healings corretos.

**Consequência.** Distinguir "não se aplica" de "aplicou-se e falhou" deixa de ser um detalhe de schema e vira requisito aritmético da combinação — é o que justifica o campo `applicable` do ADR-004 existir separado de `matched`. A restrição precisa constar explicitamente na especificação da etapa de score de confiança, e o cálculo tem de prever o caso-limite de *nenhuma* heurística aplicável (que é resultado sem confiança, não confiança zero).

---

## ADR-008 — Score estrutural por soma ponderada de quatro sinais

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 2/2 (similaridade estrutural) · **Status:** aceito

**Contexto.** A heurística estrutural compara posição na árvore: pai, índice entre irmãos, profundidade e tag. Diferente dos atributos, esses sinais raramente são tudo-ou-nada — uma mutação que insere um wrapper desloca a profundidade em 1 sem invalidar o resto, e a especificação inicial da etapa exige devolver candidato com score reduzido em vez de descartar.

**Decisão.** Score é a soma de quatro pesos que totalizam 1.0: pai 0.45, irmão 0.30, profundidade 0.15, tag 0.10. Irmão e profundidade decaem linearmente com a distância (zeram em 4 e 2 posições); pai com a tag certa mas em outro índice vale metade do peso, por ser o mesmo tipo de container e não o mesmo container. Abaixo de 0.25 o candidato é descartado como ruído — 0.25 é exatamente `profundidade + tag`, o critério 2 no seu mínimo.

**Alternativas consideradas.** (a) Cascata de critérios excludentes, como na heurística de atributos (tenta 1, senão 2, senão 3) — descartado: sinais estruturais se degradam por grau, não por presença, e a cascata teria de inventar um limiar arbitrário para decidir quando o critério 1 "falhou". (b) Igualdade estrita de toda a geometria — descartado: qualquer mutação estrutural, mesmo trivial, zeraria o match, o que contraria a razão de existir da heurística.

**Consequência.** `strategy` vira rótulo descritivo (qual critério dominou) e não mais o mecanismo de decisão, que é o score. Os pesos são calibrados por argumento, não por dados — os experimentos de mutação podem mostrar que o decaimento de profundidade é generoso ou apertado demais, e aí entra ADR novo.

---

## ADR-009 — Testes de integração como terceira categoria, sem tocar no ADR-005

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 2/2 · **Status:** aceito

**Contexto.** A heurística estrutural, ao contrário da de atributos, **pode** ser validada contra o alvo real — e precisa ser, porque é ela que vai carregar a recuperação nos experimentos. Só que o ADR-005 fixou que os unitários não tocam a rede, e essa propriedade é parte do argumento de determinismo.

**Decisão.** Criar uma terceira categoria: `playwright.integration.config.ts` + `npm run test:integration`, com `testDir` em `integration/` na raiz, `baseURL` do alvo, `retries: 2`, timeouts folgados e 2 workers. A `playwright.unit.config.ts` fica **intocada** — o ADR-005 não é superseded, continua valendo integralmente para a sua categoria. O TCC passa a reportar três números: 66 E2E + 25 unitários + 8 integração.

**Alternativas consideradas.** (a) Adicionar `baseURL` à config unit e marcar o teste de rede como exceção — descartado: tiraria dos unitários a garantia que os torna confiáveis, para beneficiar um punhado de testes. (b) Diretório `integration/` dentro de `healing/` com sufixo de arquivo que o `testMatch` padrão não casa — descartado: funciona, mas cria convenção de nomenclatura que só se entende sabendo da regra de descoberta do Playwright; diretório próprio é auto-explicativo. (c) Snapshot HTML local da página real — descartado: deixa de provar o que o teste existe para provar.

**Consequência.** Os `retries: 2` e os timeouts vivem só nesta config, e por um motivo específico: é o único ponto da suíte com dependência de rede real, e uma falha transitória de rede aqui não deve ser lida como bug da heurística — não é sintoma de teste flaky. Em troca, a suíte passa a ter três configs, e toda etapa futura precisa decidir conscientemente em qual das três seus testes entram.

---

## ADR-010 — Achados empíricos da similaridade estrutural no alvo real

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 2/2 · **Status:** aceito

**Contexto.** Os testes de integração rodaram a heurística contra páginas reais de books.toscrape.com usando os fingerprints versionados. Dois resultados merecem registro.

**Achado 1 — aplicabilidade universal, como previsto.** Os 134 fingerprints do baseline têm pai capturado e `siblingIndex` válido: `applicable` é `true` em 100% dos casos, o inverso exato da heurística de atributos (ADR-006). No alvo atual, é esta heurística que sustenta toda a recuperação. Há teste que trava essa propriedade contra o baseline versionado.

**Achado 2 — a discriminação estrutural morre dentro de containers repetidos.** Elementos a dois ou mais níveis abaixo do container que se repete são estruturalmente indistinguíveis: os 20 `h3` de uma listagem têm geometria idêntica (pai `article` no índice 0, irmão 2, profundidade 9), porque o índice que separa um card do outro está no `<li>`, que é o **avô**. O fingerprint da Camada 1 guarda só um nível de ancestral, então todos empatam com score 1.0. O `article` em si não sofre disso — o pai dele *é* o `<li>`.

**Decisão.** Aceitar e sinalizar, não contornar. A heurística devolve o candidato de maior score com `ambiguous: true` e `candidateCount` real; quem decide se confia é a camada de decisão. Nos casos medidos o elemento devolvido **é** o correto, mas por convenção, não por evidência: a captura da Camada 1 usa `.first()` e o desempate é a ordem do documento, então os dois convergem no primeiro card.

**Alternativas consideradas.** (a) Ampliar o fingerprint para guardar a cadeia completa de ancestrais — resolveria o achado 2, mas altera o schema da Camada 1 (proibido nesta etapa) e obrigaria a regravar os 134 fingerprints; fica registrado como candidato a etapa futura, não descartado por mérito. (b) Desempatar por texto do elemento — descartado aqui: o texto é o que a heurística deveria poder reencontrar, não um critério de busca, e usá-lo confundiria as duas coisas no experimento.

**Consequência.** Para o texto do TCC, a taxa de recuperação precisa ser lida em duas fatias: elementos com geometria discriminante e elementos dentro de estruturas repetidas, onde a recuperação é ambígua por natureza do alvo. Isso também reforça a limitação já conhecida da Camada 1 (locators de coleção fingerprintam só o primeiro match) — as duas têm a mesma raiz, que é quanta vizinhança o fingerprint carrega.

---

## ADR-011 — Ambiguidade desconta o score combinado e barra substituição automática

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 2/2 (restrição para a etapa de combinação) · **Status:** aceito, pendente de implementação

**Contexto.** As heurísticas devolvem `ambiguous: true` quando mais de um candidato empatou no melhor score, mas o `score` em si não é penalizado pela ambiguidade na heurística estrutural — um empate entre 20 cards idênticos sai com score 1.0. Se a etapa de combinação apenas propagar esse valor bruto, a Camada 4 vai substituir seletores automaticamente em casos que o próprio sistema já sabe, internamente, serem ambíguos.

**Decisão.** Quando uma heurística devolve `ambiguous: true`, o score combinado **não pode propagar o valor bruto**: precisa descontá-lo e, no mínimo, impedir que aquela heurística sozinha ultrapasse o limiar de substituição automática.

**Alternativas consideradas.** (a) Repassar o score e deixar a Camada 4 olhar `ambiguous` por conta própria — descartado: espalha a regra por duas camadas e depende de a camada de decisão lembrar de consultar um campo que o score já deveria ter absorvido. (b) Penalizar dentro da própria heurística estrutural — descartado por ora: mudaria o significado do score local, que hoje mede *qualidade geométrica do casamento*, e quebraria a simetria com a heurística de atributos, onde ambiguidade e score já são dimensões separadas (ADR-003).

**Consequência.** É o mesmo padrão do ADR-007: um metadado da heurística individual que a combinação é **obrigada a respeitar**, não só repassar. Alinha o comportamento com o princípio do desenho original — abaixo do limiar, falhar normalmente, para não mascarar defeito real — de que ambiguidade não resolvida deve empurrar para baixo do limiar, não permanecer em 1.0. Atenção: esta restrição é necessária mas **não suficiente** contra falso positivo; ver ADR-012.

---

## ADR-012 — Achado: reordenação produz falso positivo com confiança máxima e sem ambiguidade

**Data:** 2026-09-20 · **Etapa:** Camada 3, parte 2/2 · **Status:** aceito

**Contexto.** Medido contra o alvo real, invertendo a ordem dos cards de uma listagem — a mutação "reordenar elementos", já prevista no escopo do TCC:

| Fingerprint | Elemento devolvido | Score | `ambiguous` |
|---|---|---|---|
| `role=article` (geometria discriminante) | "Ways of Seeing" em vez de "Wall and Piece" | 1.0 | **`false`** |
| `role=article >> role=heading[level=3]` (geometria ambígua) | "You can't bury them…" em vez de "In Her Wake" | 1.0 | `true` (20 candidatos) |

O caso **discriminante** — o que o ADR-010 classificou como o bom — devolve o elemento errado com confiança máxima e sem nenhuma flag. Reordenar é precisamente a mutação que inverte identidade-por-posição: o `<li>` de índice 0 continua existindo, apenas contém outro livro. Não há ambiguidade a sinalizar, porque o match é único — e está errado.

**Decisão.** Registrar como limite de princípio, não como bug, e travá-lo num teste de caracterização (`integration/structuralHeuristic.spec.ts`). Para a etapa de score fica a restrição: o desconto por ambiguidade do ADR-011 **não cobre este caso**, então a combinação precisa de um **sinal de corroboração independente da posição** para poder rebaixar um match geometricamente perfeito porém incorreto. O candidato natural é o `text` do fingerprint, já capturado na Camada 1 — usado como *verificação posterior ao match*, nunca como critério de busca (a distinção do ADR-010 continua valendo), e como modulador de confiança, não como portão rígido, já que conteúdo legitimamente muda entre versões de uma página.

**Alternativas consideradas.** (a) Tratar como bug e corrigir na heurística estrutural — descartado: nenhum sinal *posicional* distingue "o elemento se moveu" de "outro elemento ocupou o lugar dele"; a informação simplesmente não existe na geometria. (b) Não registrar, por ser cenário da ferramenta de mutação que ainda não existe — descartado: apareceria tarde, já dentro dos experimentos, quando rastrear a causa de uma taxa de falso positivo inflada sairia caro.

**Consequência.** Material de discussão para o texto, não defeito a esconder: **elementos com geometria idêntica são estruturalmente indistinguíveis por definição**, e sob reordenação a própria geometria distinta deixa de identificar. É uma classe de caso em que a similaridade estrutural sozinha é insuficiente *por princípio* — o que reforça a razão de o desenho prever duas heurísticas complementares, mesmo tendo o alvo específico se mostrado sem instrumentação para a de atributos (ADR-006). Nos experimentos, a taxa de falso positivo precisa ser medida separando mutações que preservam ordem das que a alteram; somá-las esconde exatamente o efeito medido aqui.

---

## ADR-013 — Combinação por evidência mais forte, com desconto só na divergência

**Data:** 2026-10-02 · **Etapa:** Camada 3, combinação (score de confiança) · **Status:** aceito

**Contexto.** A combinação recebe os resultados das duas heurísticas e tem de produzir um número só. Três situações cabem no mesmo cálculo: uma heurística aplicável e outra não (o caso do alvo real, ADR-006), as duas aplicáveis apontando o mesmo elemento, e as duas apontando elementos diferentes. A isso se soma um quarto caso que o ADR-004 já tinha separado: heurística aplicável que rodou e não achou nada.

**Decisão.** O score base é o **maior** dos scores das heurísticas que encontraram candidato, não a média. Concordância no mesmo elemento não dá bônus (flag `heuristics-agree`); divergência aplica ×0.5 sobre o maior score (flag `heuristics-disagree`). Heurística aplicável sem match entra em `contributingHeuristics` e levanta `searched-without-match`, mas **não desconta**. Empate de score é resolvido a favor dos atributos estáveis.

**Alternativas consideradas.** (a) Média (ponderada ou não) — descartado: uma heurística que rodou e não achou nada entraria como 0 e rebaixaria pela metade um match que a outra sustenta com evidência sólida. As duas heurísticas leem sinais **disjuntos** (atributos vs. geometria), então não achar por um deles não é contra-evidência sobre o outro — é silêncio, e média trata silêncio como discordância. (b) Penalizar o `searched-without-match` com um fator próprio — descartado pelo mesmo argumento, e porque acrescentaria um número a calibrar sem caso empírico que o justifique.

**Consequência.** A divergência é a única contra-evidência real entre heurísticas, e é a única que custa score. **Ressalva importante para o texto: o caminho de divergência não será exercitado empiricamente nos experimentos.** Como a heurística de atributos nunca é `applicable: true` em books.toscrape.com (ADR-006), as condições para acioná-lo nunca ocorrem nos fingerprints capturados — a penalidade de divergência existe por completude arquitetural, mas não foi validada contra o alvo real, e está coberta apenas por teste unitário com resultado sintético. Ninguém lendo o trabalho deve supor que todos os caminhos do score foram observados sob dados reais; este não foi.

---

## ADR-014 — Corroboração por texto em rampa de dois patamares

**Data:** 2026-10-02 · **Etapa:** Camada 3, combinação · **Status:** aceito

**Contexto.** O ADR-012 exige um sinal de corroboração **independente de posição** para rebaixar o match geometricamente perfeito porém incorreto que a reordenação produz, e fixa duas condições: o `text` do fingerprint entra como verificação **posterior** ao match, nunca como critério de busca, e como **modulador**, nunca como portão binário. No alvo real a heurística de atributos é inaplicável (ADR-006), então a corroboração por texto é a **única** defesa do mecanismo contra esse falso positivo — o fator escolhido precisa, sozinho, derrubar um score 1.0 para baixo do limiar de decisão.

**Contexto empírico que determinou a forma da curva.** A similaridade é medida por sobreposição de tokens (Jaccard, o mesmo instrumento que o ADR-002 usa para comparar `class`). Medido no alvo, o caso de reordenação de `/catalogue/category/books/art_25/index.html` dá **0.3846**: `"Wall and Piece £44.18 In stock Add to basket"` contra `"Ways of Seeing £39.51 In stock Add to basket"`. Dois produtos **completamente diferentes** ainda compartilham 5 de 13 tokens, porque o texto do card carrega boilerplate (`in`, `stock`, `add`, `to`, `basket`). Uma rampa linear simples de [0.5, 1.0] sobre essa similaridade daria fator 0.69 e score final 0.69 — passaria por **0.01** do limiar. Margem desse tamanho não sustenta um critério de conclusão.

**Decisão.** Fator multiplicativo em rampa com dois patamares: similaridade ≤ 0.5 trava o fator no piso **0.5** (o texto não corrobora, contradiz); similaridade ≥ 0.9 dá fator **1.0** (corrobora plenamente, tolerando edição de copy); entre os dois, interpolação linear. O fator nunca zera o score, e a ausência de texto no fingerprint é caso próprio (`text-corroboration-unavailable`), sem desconto — ausência de corroboração não é contradição.

**Alternativas consideradas.** (a) Rampa linear de piso único — descartado pela margem de 0.01 acima. (b) Comparação binária igual/diferente — descartado por contrariar explicitamente o ADR-012: conteúdo muda legitimamente entre versões de uma página, e um portão rígido transformaria toda edição de copy em falha de recuperação. (c) Ponderar tokens por raridade (TF-IDF ou similar) para neutralizar o boilerplate — resolveria a inflação na origem e é tecnicamente superior, mas exigiria um corpus de referência e um parâmetro novo; a rampa resolve o mesmo problema com dois limiares justificáveis por medição direta. Fica registrado como melhoria possível, não descartado por mérito.

**Consequência.** O cenário do ADR-012 passa de score 1.0 para **0.50** atravessando a combinação, e a substituição automática é recusada — é o que torna a restrição 3 comportamento verificado em vez de documentação. Em troca, o mecanismo perde recuperações legítimas em que o conteúdo mudou muito: um elemento que manteve a geometria mas teve o texto reescrito cai para 0.50 e falha. É falso negativo, não falso positivo, e está do lado certo do princípio do projeto — falhar visivelmente em vez de mascarar. Os dois limiares da rampa são calibrados por uma medição num alvo; outro site com menos boilerplate por elemento toleraria um piso mais alto.

---

## ADR-015 — Ambiguidade desconta o combinado, salvo quando a outra heurística a resolve

**Data:** 2026-10-02 · **Etapa:** Camada 3, combinação · **Status:** aceito (implementa a restrição do ADR-011)

**Contexto.** O ADR-011 exigiu que `ambiguous: true` não propagasse o score bruto e que uma heurística ambígua **sozinha** não cruzasse o limiar. Restava decidir o fator e o que fazer quando uma heurística ambígua e outra não-ambígua apontam o **mesmo** elemento.

**Decisão.** Fator **0.5**, aplicado sobre o score já combinado (passo 3, depois da divergência e antes da corroboração por texto) — o mesmo valor que o `UNRESOLVED_AMBIGUITY_PENALTY` da heurística de atributos (ADR-002) já usa para o caso análogo. Reaproveitar é deliberado: um número a justificar no texto em vez de dois. A ambiguidade é considerada **resolvida**, sem desconto, apenas quando as duas heurísticas concordam no elemento e ao menos uma delas não é ambígua (`ambiguity-resolved-by-agreement`); duas heurísticas ambíguas que convergem continuam descontando, porque convergir pela ordem do documento não prova nada que uma delas já não provasse.

**Alternativas consideradas.** (a) Desconto proporcional a `candidateCount` — descartado: dá a impressão de medir grau de ambiguidade quando 2 e 20 candidatos são igualmente insuficientes como evidência de identidade, e acrescentaria uma curva a calibrar sem caso empírico que a motive. (b) Nunca considerar ambiguidade resolvida — descartado: ignoraria corroboração independente real, que é justamente o que o desenho de duas heurísticas existe para fornecer.

**Consequência.** Com o limiar em 0.7, um elemento em estrutura repetida no alvo atual chega a **0.50** e **nunca é substituído automaticamente**, mesmo quando o texto corrobora e o elemento devolvido é o correto (ADR-010). Isso é resultado a reportar, não detalhe de implementação: no alvo avaliado, só elementos de geometria discriminante são curáveis sem revisão humana, e acertar por ordem do documento não conta como evidência. O caminho `ambiguity-resolved-by-agreement` carrega a mesma ressalva do ADR-013 — depende das duas heurísticas aplicáveis, então não ocorre no alvo real.

---

## ADR-016 — Limiar 0.7, provisório e injetável, e log das duas decisões

**Data:** 2026-10-02 · **Etapa:** Camada 4 (decisão e registro) · **Status:** aceito, limiar pendente de calibração empírica

**Contexto.** A camada de decisão converte o score em uma de duas ações: substituir o seletor ou deixar o teste falhar. O valor do limiar define sozinho a taxa de falso positivo e de falso negativo do mecanismo, e ainda não há dados de experimento para escolhê-lo.

**Decisão.** `CONFIDENCE_THRESHOLD = 0.7`, **inclusivo**, sobrescrevível por parâmetro em cada chamada (`DecideOptions.threshold`) para que a etapa de experimentos varra valores sem alteração de código. O score é registrado junto com o limiar vigente em cada entrada de log, porque um log antigo só é interpretável com o limiar da época. São registradas **as duas** decisões, substituição e falha, e `score: null` ("sem confiança") permanece distinguível de "mediu e não bastou" no campo `reason`.

**Justificativa do valor.** 0.7 fica na margem entre os casos conhecidos, todos medidos: recuperação legítima sob reescrita de `class`/`id` em página real chega a **1.00**; edição leve de conteúdo (um token distinto em nove) a **0.875**; ambiguidade não resolvida a **0.50**; falso positivo por reordenação a **0.50**. A folga é de 0.175 para baixo e 0.20 para cima.

**Alternativas consideradas.** (a) Fixar o limiar como constante não sobrescrevível — descartado: tornaria a varredura de limiares dos experimentos uma edição de código por valor testado. (b) Registrar só as substituições, como a especificação inicial da etapa sugeria — descartado: sem as decisões de falha o harness de experimento não tem denominador, e nenhuma taxa de recuperação é calculável.

**Consequência.** O limiar é o parâmetro mais exposto do mecanismo e o único cuja escolha ainda é argumentativa — **não deve ser citado no texto como valor validado**. As margens acima vêm de quatro cenários num alvo, não de uma distribuição: os experimentos de mutação podem revelar uma faixa de scores entre 0.5 e 0.9 que hoje não se observa, e aí o valor entra em ADR novo. A camada ainda não é acionada por falha real de locator (Camada 2 não implementada): é alimentada diretamente com um `ConfidenceResult`, o que a torna testável isoladamente mas deixa a integração final fora desta etapa.

---

## ADR-017 — Interruptor de captura `HEALING_CAPTURE=off`, única mudança na Camada 1

**Data:** 2026-10-03 · **Etapa:** ferramenta de mutação de DOM · **Status:** aceito

**Contexto.** `withCapture` persiste o fingerprint depois de toda ação bem-sucedida. Sob DOM mutado, uma ação que ainda funcione — o caso típico é o M1, que reescreve `class`/`id` de um alvo localizado por role — gravaria o fingerprint **do DOM mutado** por cima do saudável. `healing/fingerprints/` é versionado e é o baseline reprodutível contra o qual os experimentos comparam (ADR-006, ADR-010): sobrescrevê-lo invalidaria silenciosamente toda medição posterior, sem nenhum erro visível.

**Decisão.** Guarda no topo de `persistFingerprint`: com `HEALING_CAPTURE` exatamente igual a `off`, a função retorna sem gravar e sem emitir o aviso de extração nula. A variável é lida a cada chamada, não no carregamento do módulo, para que um spec possa defini-la no próprio arquivo — as três configs do Playwright não podem mudar, e `VAR=x npm …` não funciona no PowerShell sem dependência nova (`cross-env`). Extração, ordem extrair → agir → persistir e assinatura de `withCapture` ficam intactas. Qualquer outro valor, inclusive ausência, mantém o comportamento anterior.

**Alternativas consideradas.** (a) Guarda em `saveFingerprint` (`fingerprintStore.ts`) — descartado: a especificação inicial da etapa fixa a mudança em `persist`, e o store é a primitiva de I/O; a política de *quando* gravar já mora em `persistFingerprint` (é ali que se decide pular o `null`), então o interruptor pertence ao mesmo lugar. (b) Pular também a extração quando desligado — economizaria até 5 s por locator quebrado, mas mudaria o caminho de execução de `withCapture` sob experimento em relação ao baseline, contaminando a medição de overhead do item 7. (c) Apontar `HEALING_FINGERPRINTS_DIR` para um diretório temporário durante os experimentos — descartado: a gravação continuaria acontecendo, e a Camada 2 futura leria desse diretório fingerprints mutados em vez do baseline.

**Consequência.** O critério de conclusão da etapa — nenhum arquivo de `healing/fingerprints/` muda após a execução — passa a ser garantido por construção nos specs que definem `HEALING_CAPTURE=off`, e verificado pelo spec de integração por hash antes/depois. O mesmo interruptor serve ao harness do item 7. O custo é uma variável de ambiente a mais que precisa estar definida em toda execução sob mutação: esquecê-la não quebra nenhum teste, só o baseline — por isso a verificação por hash, e não apenas a convenção.

---

## ADR-018 — Catálogo fixo de 5 mutações, alvos concretos e oráculo fora do DOM

**Data:** 2026-10-03 · **Etapa:** ferramenta de mutação de DOM · **Status:** aceito

**Contexto.** Os experimentos precisam de mutações com **rótulo de verdade** conhecido antes da execução: sem saber se o alvo ainda existe, não há como separar recuperação correta de falso positivo. O escopo fixa 4 a 5 tipos, determinísticos e escritos para o books.toscrape.com, e o ADR-012 exige que o falso positivo seja medido separando mutações que alteram a ordem das que a preservam.

**Decisão — tipos e justificativa.** Cada tipo modela uma classe de mudança real de front-end e isola uma propriedade do mecanismo:

| # | Tipo | class | preservesOrder | expectedOutcome | Por que está no catálogo |
|---|---|---|---|---|---|
| M1 | `volatile-attributes` | cosmetic | true | recover | Refatoração de CSS/build que renomeia classes e ids. Exercita a imunidade a voláteis por construção (ADR-002) e mede quanto da suíte depende deles. |
| M2 | `text-change` | cosmetic | true | recover | Edição de copy ou localização. Ataca locators por nome acessível e a corroboração por texto (ADR-014). |
| M3 | `reorder-siblings` | cosmetic | **false** | recover | Mudança de ordenação de listagem. É o cenário do falso positivo de confiança máxima do ADR-012 — único tipo que altera a ordem. |
| M4 | `wrap-in-container` | cosmetic | true | recover | Novo wrapper de layout. Muda pai e profundidade sem mudar o elemento — ataca os sinais posicionais da heurística estrutural (ADR-008). |
| M5 | `remove-element` | **defect** | true | fail | Regressão real: o alvo some. Único tipo `defect`; toda "recuperação" é falso positivo por definição. |

Os rótulos moram numa tabela única (`MUTATION_METADATA`) e cada entrada do catálogo copia o do seu tipo — verificado por teste.

**Decisão — alvos.** Dez alvos (T1–T10), um por elemento que a suíte baseline localiza, cada um ligado à chave do fingerprint de baseline correspondente (`baseline: {url, selector}`). T1, o link de categoria da sidebar, é instanciado pelas 16 categorias de `amostras.ts` para M1, M3, M4 e M5, como a suíte que o usa; M2 em T1 fica em "Travel" (relabel) e "Sequential Art" (edição leve). Combinações: M1, M4 e M5 em todos os alvos; M2 só em links (T1-Travel, T1-Sequential Art, T3, T4); M3 só onde existe grupo de irmãos real (T5 e T6 são filhos únicos). Combinações inertes **ficam** no catálogo e aparecem na matriz de efetividade (ADR-020) em vez de serem filtradas — esconder uma mutação que não quebra nada esconderia um achado.

**Decisão — parâmetros de cada tipo.** M1 define `class` (cada token vira `m1-<token>`, ou `m1` quando não havia classe) e `id` (`m1-<id da entrada>`) **mesmo quando ausentes**: nenhum dos dez alvos tem `id`, e metade não tem `class`, então "reescrever só o que existe" tornaria M1 um no-op silencioso nesses alvos. M3 declara explicitamente o contêiner cujos filhos inverte (`ol.row`, o `ul` das categorias, `ul.pager`, `.product_main`), em vez de inferi-lo por regra — o catálogo documenta exatamente o que é invertido. M4 usa um `<div>` sem atributos. M2 tem duas formas: **relabel total** por tabela explícita simulando localização para o português (`Travel` → `Viagem`, `next` → `próxima`, título de T3 → `É Só o Himalaia`) e duas **edições leves**: `drop-last-token` em T3 (remove o último token; em `It's Only the Himalayas` dá Jaccard 3/4 = 0.75, fator de corroboração 0.8125) e `append-token` em T1-Sequential Art (`Sequential Art` → `Sequential Art Comics`).

**Achado registrado por construção (M2 em alvo de um token).** A similaridade de texto é Jaccard sobre tokens (ADR-014). Em alvo de **um único token** (`Travel`, `next`), qualquer relabel produz interseção vazia: similaridade 0, fator no piso 0.5. Com a heurística de atributos inaplicável (ADR-006, ADR-007), o score combinado tem **teto de 0.50** — exatamente 0.50 quando a estrutural dá 1.0 — abaixo do limiar 0.7 (ADR-016). Essas entradas são falso negativo **garantido pelo desenho do score**, não pelo comportamento medido, e devem ser reportadas assim no texto. As variantes leves existem para que o M2 tenha casos em que a recuperação seja alcançável — mas a de T3 é **inerte prevista**: o locator de T3 é por índice (`nth(0)`) e não lê texto, então ela não quebra nada e não expõe o mecanismo. Ela é mantida no catálogo como controle, e o caso efetivo é a de T1.

**Achado registrado por construção (edição leve em T1 fica na borda do limiar).** A preferência era acrescentar um token a uma categoria de **três** tokens (Jaccard 3/4, fator 0.8125, folga clara sobre o limiar), mas a amostra de `amostras.ts` não tem nenhuma — as de mais tokens são `Christian Fiction` e `Sequential Art`, com dois. Categorias de três tokens existem no site (`Food and Drink`, `Sports and Games`), mas fora da amostra, e T1 é instanciado só a partir dela. Com dois tokens, acrescentar um dá Jaccard 2/3 e fator 0.5 + 0.5 × (0.667 − 0.5)/0.4 ≈ **0.708**: mesmo com a estrutural em 1.0, o combinado fica **~0.008 acima do limiar 0.7**, e qualquer estrutural abaixo de ~0.988 o derruba. A entrada é, portanto, **sensível ao ajuste do limiar** (ADR-016): uma varredura que suba o limiar em 0.01 a converte de recuperação em falha, e o resultado dela não deve ser lido como robustez do mecanismo a edição de copy. O verbo escolhido é acrescentar, e não remover, porque remover um de dois tokens daria Jaccard 1/2 — no piso.

**Decisão — oráculo.** A mutação guarda `{ id, applied, oracle }` em `window.__mutation`, uma propriedade JavaScript invisível ao DOM. Nenhum `data-*`/`aria-*` é adicionado em nenhuma hipótese: um marcador desses passaria a ser lido pela heurística de atributos estáveis e invalidaria o ADR-006. `applied: false` significa alvo ausente na página; `oracle: null` com `applied: true` é o M5.

**Decisão — onde moram os testes.** O código fica em `/mutation`; os unitários ficam em `healing/mutation/`. O `testDir` de `playwright.unit.config.ts` é `./healing` e as três configs não podem mudar nesta etapa, então um spec em `/mutation` simplesmente não seria encontrado. Os unitários de mutação entram no número de unitários, que continua reportado separado dos 66 E2E.

**Alternativas consideradas.** (a) Produto cartesiano completo tipo × alvo — descartado: M2 em `article`/`aside` e M3 em filhos únicos seriam no-ops por construção, que nada medem. (b) Texto do M2 por sufixo/prefixo — descartado como forma principal: `getByRole('link', { name: 'next' })` casa por substring sem caixa, e "Next page" seria inerte por acidente do locator, não por mérito. (c) Alvo por todos os matches do seletor (ex: renomear todas as categorias) — descartado: o oráculo precisa ser um elemento só para que "recuperou o elemento certo" seja decidível. (d) Alterar o `testDir` da config unitária — vedado pelo escopo.

**Consequência.** O catálogo tem 103 entradas determinísticas (25 M1, 5 M2, 23 M3, 25 M4, 25 M5). A expansão de T1 por categoria pesa nos totais: 66 das 103 entradas são T1, e o harness deve reportar resultados por alvo e por tipo, nunca só a média do catálogo. A escolha de qual teste roda contra qual entrada, e o mecanismo de injetar a mutação nos 66 testes E2E, ficam para o harness (item 7).

---

## ADR-019 — M1 como controle inerte: previsão, acoplamento do rating ao `class` e resultado medido

**Data:** 2026-10-03 · **Etapa:** ferramenta de mutação de DOM · **Status:** previsão registrada **antes** da execução (commit `b49c02e`); resultado medido em 2026-10-03

**Contexto.** A especificação inicial da etapa previa o M1 (reescrita de `class` e `id`) como **controle inerte**: os Page Objects priorizam `getByRole`/`getByText`, então uma suíte escrita com boas práticas seria naturalmente imune a esse tipo de mutação, e o M1 não exporia o mecanismo.

**Previsão (escrita antes da execução).** A premissa vale só para os alvos localizados por role (T1–T7), onde o M1 deve ser inerte. Ela **não vale** para T8–T10: preço, disponibilidade e rating do produto não têm gancho ARIA único, e o `ProductPage` os localiza por classe CSS (`.product_main p.price_color`, `p.instock.availability`, `p.star-rating`), seguindo a regra de usar CSS só quando não há alternativa. O M1 reescreve exatamente essas classes, então os três locators devem **quebrar**. O M1 continua no catálogo como controle nos alvos por role e como mutação efetiva nos outros três.

**Acoplamento do baseline: o rating é lido do `class`.** O site codifica a nota no nome da classe (`class="star-rating Three"`), e `ProductPage.getRatingValue()` lê o atributo `class` e procura a palavra que não seja `star-rating`. Sob o M1, o `class` vira `m1-star-rating m1-Three`. Mesmo que a recuperação relocalize o elemento certo, a primeira palavra diferente de `star-rating` passa a ser `m1-star-rating`, que não está em `RATING_WORDS`. O valor lido é **0**, e a asserção `rating >= 1` falha. É um caso em que **recuperar o locator não basta**: o dado que o teste consome mora no próprio atributo volátil que a mutação reescreve. A falha não é do mecanismo, e sim do acoplamento do baseline à representação do site. Deve ser reportada separadamente das falhas de recuperação, senão contaria como falso negativo do healing.

**Alternativas consideradas.** (a) Retirar T8–T10 do M1 para preservar o "controle inerte" — descartado: esconderia justamente o achado de que a suíte depende de classes onde o site não oferece outro gancho. (b) Fazer o M1 preservar a palavra do rating — descartado: seria uma mutação ajustada à suíte, não ao cenário real (uma refatoração de CSS não poupa a classe que por acaso carrega um dado).

**Resultado medido (2026-10-03, `mutation/effectiveness-matrix.json`).** A previsão se confirmou integralmente, sem nenhuma divergência:
- **Inerte em 22 de 25 entradas.** São T1 × 16 categorias e T2–T7: o locator resolve para o oráculo e o teste reproduzido passa.
- **Quebra em 3 de 25.** São T8, T9 e T10: o locator CSS não resolve e o teste reproduzido falha.

Portanto, o M1 é um controle inerte **para os alvos localizados por role**, e não para a suíte como um todo. A conclusão da especificação inicial ("a suíte escrita com boas práticas é naturalmente imune") vale na medida em que a suíte consegue usar role, e o books.toscrape.com não oferece um gancho ARIA para preço, disponibilidade e rating.

**O acoplamento do rating ainda não foi observado empiricamente.** Sem recuperação, o teste do T10 falha **antes** de ler o `class`: `expectStarRatingVisible` já não encontra o elemento. A consequência prevista, rating 0 mesmo com o elemento certo recuperado, só se torna observável quando o mecanismo relocalizar o elemento. Até lá ela é uma dedução do código (`getRatingValue` + `RATING_WORDS`), não uma medição. A confirmação fica para o harness (item 7), que deve classificar o caso na categoria "elemento certo, teste falha" do ADR-020.

---

## ADR-020 — Efetividade das mutações sem recuperação: previsão e matriz medida

**Data:** 2026-10-03 · **Etapa:** ferramenta de mutação de DOM · **Status:** previsão (commit `b49c02e`) e regra de relato (commit `fdde2ff`) registradas **antes** da execução; matriz medida em 2026-10-03

**Contexto.** Uma mutação só expõe o mecanismo de recuperação se o locator original do Page Object deixar de funcionar. A especificação inicial da etapa previa que M2, M3, M4 e M5 quebram os locators e que M1 é inerte; a leitura dos Page Objects antes de qualquer execução indica que isso vale só em parte. A previsão foi registrada aqui antes de a matriz ser medida, para que o registro mostre o que era esperado e o que foi observado, e não uma previsão ajustada depois.

**Estados do locator.** Sem recuperação, cada entrada do catálogo cai em um de três estados, medidos contra o oráculo de `window.__mutation`:
- **quebra** — o locator original não resolve nenhum elemento;
- **desvia** — resolve, mas para um elemento diferente do oráculo (com `oracle: null`, qualquer resolução é desvio);
- **inerte** — resolve para o oráculo.

`desvia` é o estado mais perigoso: a Camada 2 detecta falha por exceção, então nesse estado o mecanismo **nunca é acionado** e o teste segue sobre o elemento errado — é o falso positivo do ADR-012 acontecendo antes mesmo da recuperação.

**Locators dos Page Objects por alvo.** T1 `complementary >> link[name=<categoria>, exact]` · T2 `article.first()` · T3 `article.nth(0) >> heading[3] >> link` · T4 `link[name=next]` (substring, sem caixa) · T5/T7 `heading[1]` · T6 `complementary` · T8–T10 CSS `.product_main p.price_color` / `p.instock.availability` / `p.star-rating`.

**Previsão (escrita antes da execução).** "Testes" são os da suíte baseline que exercitam o alvo, no fluxo em que o exercitam. "Deveria" é o rótulo de verdade; "mecanismo atual" só é preenchido onde o desenho do score já determina o resultado.

| Entrada | Locator | Testes passariam sem healing? | Mecanismo deveria | Mecanismo atual (por construção) |
|---|---|---|---|---|
| M1 × T1 (×16), T2–T7 | inerte | sim | não acionado | não acionado |
| M1 × T8 preço, T9 disponibilidade | **quebra** | não (product-details 1 e 2) | recuperar | recuperar — ADR-016 mediu 1.00 sob reescrita de `class`/`id` |
| M1 × T10 rating | **quebra** | não (product-details 3) | recuperar | recuperar o elemento, **mas o teste falha mesmo assim** (ver ADR-019) |
| M2 × T1-Travel (relabel) | quebra | não (navegação para Travel) | recuperar | falhar: teto 0.50 (ADR-018), falso negativo |
| M2 × T1-Sequential Art (append) | quebra | não (navegação para Sequential Art) | recuperar | recuperar por ~0.008, se a estrutural der ≥ ~0.988 |
| M2 × T3 (relabel e drop-last-token) | inerte | sim | não acionado | não acionado — locator por índice não lê texto |
| M2 × T4 (relabel) | quebra | não (paginação) | recuperar | falhar: teto 0.50, falso negativo |
| M3 × T1 (×16), T4, T7–T10 | inerte | sim | não acionado | não acionado — role, nome e CSS de descendente não dependem de ordem |
| M3 × T2 primeiro card | **desvia** (vai para o último card) | sim, sobre o card errado | recuperar | não acionado — erro silencioso |
| M3 × T3 link do primeiro card | **desvia** (abre o último produto) | sim, sobre o produto errado | recuperar | não acionado — erro silencioso |
| M4 × todos os alvos | inerte | sim | não acionado | não acionado — todos os locators são por role ou por descendente, e nenhum depende do pai direto |
| M5 × T1 (×16) | quebra | não | falhar | falhar: o vizinho tem outro nome; relabel de um token cai no piso |
| M5 × T2 primeiro card | **desvia** (vai para o segundo card) | sim, sobre o card errado | falhar | não acionado — **defect** que passa despercebido |
| M5 × T3 link do primeiro card | quebra (o `article` 0 continua lá, sem link) | não (product-details 1–3) | falhar | risco de falso positivo: o link do card 1 é estruturalmente quase idêntico; depende da corroboração por texto (títulos distintos) |
| M5 × T4–T10 | quebra | não | falhar | falhar previsto; a medir no item 7 |

**Previsões que contradizem a especificação inicial da etapa, registradas antes de medir.**
1. **M1 não é inerte para toda a suíte:** quebra os três alvos que o `ProductPage` localiza por classe CSS (T8–T10), porque nenhum deles tem gancho ARIA. É inerte só para os alvos localizados por role.
2. **M3 não quebra nenhum locator:** onde importa (T2, T3), ele **desvia**, e nos demais é inerte.
3. **M4 é inerte em todos os 25 alvos:** nenhum locator da suíte depende do pai direto.
4. **M5 desvia em T2** em vez de quebrar: `article.first()` simplesmente passa para o próximo card.
5. **M2 é inerte em T3,** inclusive na edição leve.

Na prática, a exposição do mecanismo sob mutação fica concentrada em M1 (T8–T10), M2 (links por nome) e M5. M3 e M4 não acionam a recuperação nesta suíte.

**Observações de previsão.**
- Em categorias de um card só (Crime), inverter `ol.row` não muda nada: M3 × T2/T3 é inerte ali. As páginas de referência (home, 20 cards; Travel, 11 cards) são as que produzem o desvio.
- O seletor da mutação casa em toda página de listagem, não só na de referência. M5 × T2 aplicado à navegação para Crime zera a listagem, e `getProductCount() > 0` falharia nesse teste. Efeitos colaterais como esse ficam para o harness, que decide qual teste roda contra qual entrada.
- Sob M2 e M5 em T4, `hasNextPage()` usa `isVisible()`, que **devolve `false` em vez de lançar exceção**. A falha aparece na asserção do teste, não no locator. Uma Camada 2 baseada só em exceção não seria acionada nesse caminho.

**Previsão da especificação inicial revista pela leitura do código.** A especificação previa que o locator original **falha** sob M2, M3, M4 e M5. Antes de qualquer execução, a leitura dos Page Objects revisou essa previsão para M3 e M4. O M3 não faz nenhum locator lançar erro: nos locators por índice (T2, T3) ele **desvia**, e nos demais é inerte. O M4 é inerte nos 25 alvos. A revisão veio do código (os locators são por role, por nome ou por CSS de descendente, e nenhum depende de ordem ou do pai direto), não de uma medição. A matriz medida a confirma ou a refuta.

**Tamanho efetivo das amostras previstas.** Contando as entradas pela previsão acima:
- **Denominador da taxa de recuperação** (entradas `cosmetic` em que o locator quebra, ou seja, onde o mecanismo é acionado e deveria recuperar): **6 de 78**. São M1 × T8, T9 e T10, e M2 × T1-Travel, T1-Sequential Art e T4. Duas delas (Travel e next) têm falha garantida pelo teto de 0.50 (ADR-018), uma fica na borda do limiar (Sequential Art) e uma recupera o elemento, mas o teste falha mesmo assim (T10, ADR-019). As outras 72 entradas cosméticas se dividem em 70 inertes e 2 desvios (M3 × T2 e T3), que nunca acionam o mecanismo.
- **Denominador da taxa de falso positivo** (entradas M5 em que o locator quebra, ou seja, onde o mecanismo é acionado e deveria falhar): **24 de 25**. São T1 × 16 categorias e T3–T10. A entrada restante, M5 × T2, desvia: é um `defect` que passa despercebido sem acionar o mecanismo, e é reportada à parte, não como acerto nem como falso positivo do healing.
- Consequência: das 103 entradas, só **30 expõem o mecanismo**. A taxa de recuperação tem um denominador de 6, e não deve ser apresentada como percentual sem o número absoluto ao lado. O falso positivo tem 24 casos, dos quais 16 são o mesmo alvo (T1) em categorias diferentes, ou seja, não são 24 observações independentes.

**Vocabulário da coluna de testes na matriz medida.** A coluna "teste" da matriz medida é uma **reprodução, não uma execução real** dos specs da suíte: chama o mesmo método do Page Object e aplica a mesma asserção do teste baseline, na página de referência, com a mutação aplicada. A execução real dos 66 specs sob mutação depende do mecanismo de injeção, que é decisão do harness (item 7). Ela assume três valores: **passa**, **falha** e **passa por engano** (o locator resolve para um elemento que não é o oráculo, e a asserção ainda passa). Na tabela de previsão acima, "sim" corresponde a *passa*, "não" a *falha* e "sim, sobre o … errado" a *passa por engano*.

**Regra de relato (fixada antes da medição).** Os denominadores são pequenos, então o formato do relato é decidido agora, antes que os números o influenciem. A regra vale para esta matriz e para o harness do item 7:
- **Recuperação.** Com n pequeno, cada caso do denominador entra numa **tabela individual**, uma linha por entrada, com as colunas: alvo · mutação · score · decisão (substituir/falhar) · elemento certo (`pointsToOracle`) · teste passa (reproduzido). A taxa agregada, se aparecer, vem sempre como fração com o absoluto (ex: 3/6), nunca só como percentual. Nesta etapa, sem recuperação, a matriz preenche só o estado do locator e a coluna de teste; score e decisão são preenchidos pelo harness.
- **Falso positivo.** É reportado de duas formas, lado a lado: **por alvo distinto**, em que T1 conta como um alvo e o resultado aparece como "k de 16 categorias", e **bruto**, por entrada (k/24). Só a contagem bruta trataria as 16 instâncias de T1 como observações independentes. Só a contagem por alvo esconderia uma categoria em que o mecanismo erra e as outras não.
- **Categoria própria: "elemento certo, teste falha".** Quando a recuperação aponta para o oráculo, mas o teste falha mesmo assim, porque o dado consumido mora no atributo que a mutação reescreveu (o caso do T10 sob M1, ADR-019), o resultado não conta nem como recuperação bem-sucedida do teste nem como falha do mecanismo. Vai para uma categoria separada, com a causa registrada.
- **Fora dos denominadores, também reportados à parte:** os casos *passa por engano* (M3 × T2/T3: o locator desvia e o mecanismo nunca é acionado) e o *defect despercebido* (M5 × T2). Eles medem um limite da suíte e da detecção por exceção, não da recuperação.
- **Catálogo congelado até a matriz medida.** Nenhuma entrada é ajustada antes de a matriz ser medida e registrada. Se o denominador medido ficar abaixo do previsto, a decisão sobre o catálogo é tomada depois, com os números, e registrada em ADR próprio.

**Resultado medido (2026-10-03).** A matriz está em `mutation/effectiveness-matrix.json`, gerada por `integration/mutation.spec.ts` e não editada à mão. Uma linha por entrada, na ordem do catálogo, com estes campos: aplicação na página de referência, efeito verificado, estado do locator, reprodução do teste e qual teste foi reproduzido.

*Reprodutibilidade.* Duas rodadas independentes (207 s e 205 s, `retries: 0`) produziram arquivos idênticos byte a byte (diff zero). Uma terceira rodada, em modo de comparação contra o arquivo versionado, também concordou. Após as três, `healing/fingerprints/` estava inalterado, conferido pelo hash no próprio spec e pelo `git status`.

*Aplicação.* As 103 entradas foram aplicadas na página de referência, e o efeito específico de cada tipo foi verificado no DOM real (103/103).

| Mutação | Locator | Teste (reproduzido) | Entradas |
|---|---|---|---|
| M1 | inerte | passa | 22 — T1 × 16, T2–T7 |
| M1 | quebra | falha | 3 — T8, T9, T10 |
| M2 | quebra | falha | 3 — T1-Travel, T1-Sequential Art, T4 |
| M2 | inerte | passa | 2 — T3 relabel, T3 drop-last-token |
| M3 | inerte | passa | 21 — T1 × 16, T4, T7–T10 |
| M3 | desvia | passa por engano | 2 — T2, T3 |
| M4 | inerte | passa | 25 — todos |
| M5 | quebra | falha | 24 — T1 × 16, T3–T10 |
| M5 | desvia | passa por engano | 1 — T2 |

*Divergências em relação à tabela de previsão.* **Nenhuma.** As 15 linhas da tabela de previsão se confirmaram, todas no estado de locator previsto e todas no resultado de teste previsto, com "sim / não / sim, sobre o … errado" correspondendo a passa / falha / passa por engano. As cinco previsões que contradiziam a especificação inicial se confirmaram, e a revisão de M3 e M4 feita pela leitura do código se sustenta empiricamente:
1. o M1 quebra T8–T10;
2. o M3 desvia (T2, T3) e não quebra nenhum locator;
3. o M4 é inerte nos 25 alvos;
4. o M5 desvia em T2;
5. o M2 é inerte em T3, inclusive na edição leve.

*Denominadores medidos, iguais aos previstos.*
- **Recuperação: 6 de 78 entradas cosméticas.** São M1 × T8, T9, T10 e M2 × T1-Travel, T1-Sequential Art, T4. O critério de parada (denominador abaixo de 6) não foi acionado.
- **Falso positivo: 24 de 25 entradas M5**, em 9 alvos distintos (T1 conta uma vez, com 16 instâncias).
- **Fora dos denominadores:** 3 casos de *passa por engano*. Dois são M3 × T2/T3 (cosméticos, em que o mecanismo nunca é acionado) e um é M5 × T2 (o *defect despercebido*).

*Leitura.* Das 103 entradas, 30 expõem o mecanismo, exatamente como previsto. 70 são inertes, e só confirmam que a suíte não depende de ordem, de profundidade nem, onde há role, de `class`/`id`. Os 3 *passa por engano* mostram o limite que nenhuma camada de recuperação alcança: quando o locator resolve para o elemento errado, não há falha a detectar. A rigor, eles são achados sobre a suíte baseline (locators por índice), não sobre o mecanismo.

*Limite da reprodução.* Na coluna de teste, a causa da falha não é registrada (a linha não guarda mensagens de erro, para manter o JSON estável entre rodadas). Por isso a matriz não distingue a falha por exceção no locator da falha por asserção. Esse é o caso de `hasNextPage()` sob M2/M5 × T4, que devolve `false` sem lançar exceção, conforme a observação de previsão acima.

---

## ADR-021 — Escopo do achado do ADR-006: "elementos exercitados", não "o site inteiro"

**Data:** 2026-10-04 · **Etapa:** revisão de documentação (insumo dos capítulos 3 e 4) · **Status:** aceito; corrige a formulação do ADR-006, sem alterar a decisão nem os resultados

**Contexto.** O ADR-006 e dois arquivos versionados (`healing/README.md` e o comentário de `playwright.unit.config.ts`) afirmavam que o books.toscrape.com não usa `data-*` nem `aria-*` "em elemento nenhum". O que foi medido são os 134 fingerprints do baseline, todos com `stable: {}`. Ao conferir o HTML da home e de uma página de produto (2026-10-04), apareceu `data-loading-text="Adding..."`: 20 ocorrências na home e 6 no produto, fora de comentários HTML, nos botões "Add to basket", com o mesmo valor em todas. Também aparecem `role="alert"` e `id` em containers (`#promotions`, `#messages`, `#product_description`).

**Decisão.** Restringir a afirmação ao que foi medido: nenhum dos elementos exercitados pela suíte tem `data-*`/`aria-*`. Os arquivos versionados foram reescritos nesse sentido. Não fazer levantamento do site inteiro.

**Alternativas consideradas.** (a) Levantar os atributos estáveis de todas as páginas — descartado: a heurística só consulta elementos com fingerprint, então o levantamento não muda nenhuma taxa do experimento. Ele só valeria para discutir a representatividade do alvo (validade externa), e a amostra de 134 elementos já sustenta esse argumento. (b) Manter a frase original — descartado: é falsa literalmente, e um avaliador que abrir o HTML a refuta.

**Consequência.** A conclusão do ADR-006 fica intacta: `applicable: false` em 134/134 e a recuperação depende inteiramente da similaridade estrutural. Os atributos que existem no site não serviriam de qualquer forma, porque `data-loading-text` tem valor idêntico em todos os botões e não discrimina elemento. No texto do TCC, usar a formulação restrita.

---

## ADR-022 — Mapa teste → alvo gerado pela execução real, com duas definições de "exercita"

**Data:** 2026-10-05 · **Etapa:** mutação (rastreabilidade da tabela de alvos do TCC) · **Status:** implementado; a escolha da definição usada no texto está em aberto

**Contexto.** A coluna "Testes que o exercitam" da tabela de alvos T1–T10 foi preenchida à mão e mistura dois critérios: T6 = 17 conta os 16 testes de navegação, cujo locator `role=complementary >> role=link[...]` apenas passa pela sidebar, mas T2 = 1 não conta os testes que passam pelo primeiro card. Faltava um número rastreável.

**Decisão.** Gerar `mutation/target-test-map.json` pela execução dos 66 testes sem alteração (`mutation/targetTestMap.config.ts`). O hook troca `withCapture` pela propriedade do módulo e, antes de cada ação, avalia no DOM a relação do locator com o elemento de cada alvo, identificado pelo seletor CSS do catálogo na página da chamada. As relações são `resolve`, `resolve-colecao`, `ancestral` e `ancestral-colecao`. As definições são A (qualquer relação), A sem coleção e B (`resolve`: a ação ou asserção recai sobre o alvo e só nele). Ser de coleção é propriedade do par (método, locator): se ele resolve N > 1 em alguma chamada, é coleção em todas. Sem essa regra, `getProductCount` em Crime (1 livro) contaria como B para T2.

**Alternativas consideradas.** (a) Análise estática dos specs e POs — descartada: produz o mapa que o código *diz*, não o que a execução faz, e exigiria regras escritas à mão sobre página e alvo. (b) Reutilizar a reprodução de `integration/mutationMatrix.ts` — descartada: ela reproduz um teste por alvo, não os 66. (c) Identificar o alvo pela página de referência do catálogo — descartada: T3 tem referência em Travel, mas é exercitado nas 16 categorias. O seletor físico na página da chamada é o mesmo elemento que `applyMutation`, que roda em toda navegação, transformaria ali. (d) Contar `resolvidos === 1` como `resolve` sem a regra de coleção — descartada pelo caso de Crime.

**Resultado medido (duas rodadas, diff zero).** A / A sem coleção / B: T1 16/16/16 (1 por instância), T2 66/49/1, T3 48/48/48, T4 1/1/1, T5 16/16/16, T6 17/17/1, T7 16/16/16, T8 32/32/32, T9 32/32/32, T10 16/16/16. 66 testes, soma dos fluxos = 66, nenhum teste sem alvo em A nem em B. A e B divergem só em T2 e T6.

**Consequência.** A tabela do TCC precisa usar uma definição só. Com B, T6 passa de 17 para 1. Com A, T2 passa de 1 para 66: todo teste atravessa o primeiro card, seja na contagem, nos títulos ou no `nth(0)`. A sem coleção dá 49 para T2. A definição a adotar fica em aberto. A leitura que liga isso à matriz de efetividade: sob a definição A, mutar o ancestral pode afetar o teste sem que o alvo seja o objeto da asserção (ex.: M3 × T2 desvia `openProductByIndex(0)`).

---

## ADR-023 — Log de recuperação instrumentado para ablação offline do score

**Data:** 2026-10-05 · **Etapa:** preparação da rodada de experimentos · **Status:** implementado; semântica de `healing-off` e produtor de `detectionWaitMs` em aberto

**Contexto.** A monografia vai trazer uma ablação do score sem execuções extras: (i) saída estrutural bruta, (ii) bruta × fator de ambiguidade, (iii) score completo com corroboração por texto. O `HealingLogEntry` registrava o score final e as flags, mas não o score bruto, os valores dos fatores, a `textSimilarity`, o candidato de cada heurística nem se o candidato era o certo. Além disso, o log só existia em memória. Pelo código, o candidato é escolhido antes dos fatores (passo 2 de `combineConfidence`), e os fatores só multiplicam. Por isso as três configurações mudam a decisão, nunca o elemento: a ablação mede quais casos cruzam o limiar e se esses casos são acertos ou falsos positivos.

**Decisão.**
- `ConfidenceResult` e `HealingLogEntry` passam a ter `rawScore`, `factors { disagreement, ambiguity, text }` (1 quando o passo não descontou), `textSimilarity` antes do piso e `heuristics`. Este último lista sempre as duas heurísticas, com `applicable` explícito e o candidato de cada uma. O score passa a ser calculado como `rawScore × disagreement × ambiguity × text`, a identidade que permite recalcular offline.
- `HealingLogEntry` ganha também `candidateIsOracle`, `run { entryId, testId, repetition, condition }` e `timings { detectionWaitMs, recoveryMs, actionMs }`. `decide()` sozinho os deixa `null`.
- `healing/decision/recovery.ts` monta o fluxo nesta ordem: janela de t_rec (heurísticas, combinação e decisão) → oráculo → ação cronometrada → escrita do JSONL. O oráculo fica fora de t_rec e antes da ação, porque a ação pode navegar e descartar o DOM mutado. Ele é avaliado sobre o candidato também quando a decisão é `fail`. O oráculo é injetado (`pointsToOracle`), para que a camada de healing não dependa da ferramenta de mutação. O sink só acrescenta linhas, numa escrita por entrada, e nunca lê o arquivo.

**Alternativas consideradas.** (a) Deduzir o fator de texto algebricamente a partir de final ÷ (bruto × ambiguidade): descartada. Funciona, mas depende das constantes da versão do código e perde a `textSimilarity` abaixo do piso. (b) Gravar no sink dentro de `decide()`: descartada. A escrita cairia dentro da janela medida, e a entrada ficaria sem `actionMs` e sem oráculo. (c) Avaliar o oráculo só quando a decisão é `replace`: descartada, porque é justamente o candidato recusado que diz se a configuração sem fator teria errado. (d) Incluir as inaplicáveis em `contributingHeuristics`: descartada, porque mudaria a semântica de um campo já usado (lá, a ausência é informação). Foi criado o campo novo `heuristics`.

**Verificação.** 11 testes unitários novos (95 no total). Um teste de integração no alvo real (`integration/recovery.spec.ts`): M1-T2 dá `replace` com `candidateIsOracle: true`; M3-T2 dá `fail` com `rawScore` 1, `factors.text` < 1 e `candidateIsOracle: false`. Ou seja, a configuração (i) substituiria pelo card errado.

**Em aberto.** (1) O que significa uma entrada com `condition: 'healing-off'`: tentativa só registrada (sombra), sem substituir, ou nenhuma entrada. Isso cabe ao harness. (2) `detectionWaitMs` é informado por quem chama, porque a Camada 2 não existe. (3) Arquivo de log por worker ou compartilhado entre eles.

---

## ADR-024 — Entrada cujo comportamento diverge da matriz entre os testes do harness

**Data:** 2026-10-05 · **Etapa:** preparação da rodada de experimentos (harness, item 7) · **Status:** aceito; fixado antes da medição

**Contexto.** A matriz de efetividade (ADR-020) mede cada entrada contra **um** teste reproduzido (`reproducedTest`), na página de referência. O harness vai injetar a entrada nos specs reais, e um mesmo alvo é exercitado por mais de um teste (ADR-022: T1-travel_2, por exemplo, aparece em `category-navigation` e nos três `product-details` de Travel). Daí uma divergência previsível, e não acidental: a entrada quebra o locator no teste reproduzido e não quebra em outro, ou o inverso. O critério que agrega os testes de uma entrada num desfecho só está no ADR-025. Este ADR trata do denominador e de como a divergência aparece no relato.

**Decisão.**
- **Pertencer ao denominador segue a matriz versionada**, não a execução do harness. Uma entrada do denominador continua nele mesmo que, em algum teste, o locator não quebre. Pelo critério do ADR-025, ela então não conta como recuperada, porque nesse teste não houve substituição.
- **Toda entrada cujo comportamento por teste diverge da matriz é relatada à parte,** com uma linha por teste e estas colunas: teste · `applied` · locator quebrou · mecanismo acionado · decisão · `candidateIsOracle` · teste passa. A causa da não-recuperação é registrada distinguindo:
  - **mecanismo não acionado:** o locator resolveu e não há entrada de log para ele. Isso mede a cobertura da suíte, não o healing;
  - **mecanismo acionado com `fail`:** isso mede o healing.
- **Teste em que a mutação não foi aplicada (`applied: false`) fica fora do conjunto de testes da entrada.** É o caso do link "Travel" na própria página Travel. Ali o alvo não existe, então não há o que recuperar. Esse teste não entra na agregação do ADR-025, e não é relatado como divergência.

**Alternativas consideradas.** (a) Redefinir o denominador a partir da execução do harness: descartada, porque o denominador seria escolhido depois de ver os números, o que contraria a regra de fixar o relato antes da medição (ADR-020). (b) Relatar só o desfecho agregado da entrada: descartada, porque não daria para separar a não-recuperação que vem da suíte da que vem do mecanismo.

**Consequência.** Uma entrada que diverge da matriz nesse sentido não é recuperada por construção, seja qual for o desempenho do healing. A tabela à parte é obrigatória sempre que houver divergência, porque é nela que o leitor separa a suíte do mecanismo.

---

## ADR-025 — Agregação das execuções por entrada: na dúvida, contra o mecanismo

**Data:** 2026-10-05, revisto em 2026-10-11 antes do primeiro commit · **Etapa:** preparação da rodada de experimentos (harness, item 7) · **Status:** aceito; fixado antes de qualquer execução de M5 com healing ligado

**Contexto.** Complementa a regra de relato do ADR-020. Lá ficou definido o que entra em cada denominador e como se relata, mas a unidade continuava implícita: uma linha por entrada do catálogo. O harness, por sua vez, roda cada entrada em vários testes (ADR-022), e cada execução produz um desfecho próprio. Falta uma regra que reduza N execuções a um desfecho por entrada. Essa regra tem de ser fixada antes de ver os números, porque cada escolha move a taxa.

**Princípio.** Quando as execuções de uma entrada discordam, o desfecho agregado é o **desfavorável ao mecanismo**. O sucesso tem de ser unânime, e basta um erro para ele contar.

**Desfecho de cada execução.** Numa entrada `cosmetic`, cada execução cai em exatamente uma destas classes, verificadas nesta ordem:

| Classe | Condição |
|---|---|
| não acionado | o locator resolveu e não há entrada de log (ADR-024) |
| `fail` | o mecanismo foi acionado e decidiu falhar |
| cura incorreta | `replace` com `candidateIsOracle: false`, ou seja, substituiu pelo elemento errado |
| elemento certo, teste falha | `replace` com `candidateIsOracle: true`, e o teste falha mesmo assim (o caso do T10 sob M1, ADR-019) |
| **sucesso** | `replace` com `candidateIsOracle: true`, e o teste passa |

Só a última classe é sucesso. Ela exige as três coisas ao mesmo tempo: substituição, elemento certo segundo o oráculo (`pointsToOracle`) e teste passando.

**Decisão.** As duas regras, lado a lado:

| | Recuperação (entradas `cosmetic` do denominador) | Falso positivo (entradas M5 do denominador) |
|---|---|---|
| Conta a favor do mecanismo | **sucesso** em **todos** os testes da entrada | `fail` em **todos** os testes da entrada |
| Conta contra o mecanismo | basta **um** teste em outra classe | basta **um** teste com `replace` |

"Testes da entrada" são os testes em que a mutação foi aplicada (`applied: true`, ADR-024). Repetições do mesmo teste contam como execuções separadas, e a regra vale sobre todas. No M5 o oráculo é `null`, então qualquer `replace` é falso positivo, seja qual for o desfecho do teste.

**Fora do numerador, registradas à parte.** Uma entrada `cosmetic` que tenha alguma execução em **cura incorreta** ou em **elemento certo, teste falha** continua no denominador e não entra no numerador. Ela é listada na categoria correspondente, com a causa registrada:
- **cura incorreta:** é o erro mais grave do mecanismo sob mutação cosmética, porque o teste segue sobre outro elemento. Fica separada de `fail` e de "não acionado" para não ser diluída em "não recuperou";
- **elemento certo, teste falha:** o mecanismo acertou o elemento, mas o dado que o teste consome mora no atributo que a mutação reescreveu. Isso mede o acoplamento da suíte, não a identificação do elemento.

Uma entrada com execuções nas duas categorias aparece nas duas. Este item precisa o que o ADR-020 deixou aberto sobre "elemento certo, teste falha": a categoria segue relatada à parte, mas a entrada fica **dentro do denominador e fora do numerador**, conforme o princípio acima.

**Contagem bruta por entrada, sempre ao lado.** O desfecho binário esconde a gradação: "falhou em 1 de 4" e "falhou em 4 de 4" viram o mesmo "não recuperada". Por isso cada entrada leva também a contagem bruta das execuções, no formato k/N:
- na recuperação, por classe: sucesso · elemento certo, teste falha · cura incorreta · `fail` · não acionado;
- no falso positivo, quantas execuções tiveram `replace` e quantas tiveram `fail`.

A contagem bruta é descritiva. Ela não entra na taxa e não substitui o desfecho agregado, e o agregado não é recalculado a partir dela por maioria nem por média.

**Alternativas consideradas.** (a) Maioria das execuções: descartada. Com N pequeno o limiar é arbitrário (2 de 4 empata), e a maioria transforma um mecanismo que erra às vezes num mecanismo que acerta. (b) Recuperação contada só nos testes em que o locator quebrou: descartada. Ela retira do critério justamente os testes em que a mutação não acionou o mecanismo e, com n = 6, pode transformar uma divergência da suíte em acerto do healing sem que isso apareça no número. (c) Unidade por par (entrada, teste) como métrica principal: descartada. Multiplicaria o denominador por observações que não são independentes (como as 16 instâncias de T1 no falso positivo, ADR-020). Essa granularidade sobrevive na contagem bruta e na tabela do ADR-024. (d) Regras assimétricas por conveniência, como "qualquer" para recuperação e "todos" para falso positivo: descartada, porque favoreceriam o mecanismo dos dois lados. (e) Recuperação = `replace` em todos os testes, como na primeira redação deste ADR: descartada antes do commit. Contaria como recuperada uma substituição pelo elemento errado, desde que o teste passasse por engano, e também o caso do T10, em que o teste falha. (f) Retirar "elemento certo, teste falha" do denominador: descartada. Melhoraria a taxa com um caso em que o teste, que é o que o usuário vê, continua quebrado.

**Consequência.** A taxa de recuperação é um limite inferior e a de falso positivo é um limite superior. A contagem bruta mostra o quanto cada entrada está longe do outro desfecho. Com o denominador previsto de 6 (ADR-020), o caso do T10 sob M1 já sai do numerador por construção.

---

## ADR-026 — Condição desligada, arquivos de log e repetições do harness

**Data:** 2026-10-11 · **Etapa:** harness dos experimentos (item 7), antes do código · **Status:** aceito; fixado antes de escrever o harness e antes de qualquer execução de M5 com healing ligado

**Contexto.** O ADR-023 deixou em aberto três pontos de que o harness depende: o que a condição `healing-off` registra, como o log é dividido entre os workers e quantas vezes cada teste roda. Os três mudam o que pode ser medido, então ficam fixados antes do código.

**Decisão.**

*Condição desligada.* `healing-off` é o **controle**, e roda a suíte baseline intocada: sem checagem de detecção, sem heurísticas e sem modo sombra. O mecanismo não grava nenhuma entrada nessa condição. O que ela registra vem só do Playwright: o resultado e a duração de cada teste. É contra essa duração que o overhead da condição ligada é medido.

*Log.* Há um `.jsonl` por worker e por condição, dentro de um diretório próprio de cada rodada do harness. Cada evento carrega `entryId`, `testId`, `repetition` e `condition`. Nenhum worker escreve no arquivo de outro, então não há escrita concorrente. A junção dos arquivos é feita na análise, com ordenação determinística por (`condition`, `entryId`, `testId`, `repetition`), e o resultado não depende da ordem em que os workers terminaram.

*Repetições.* As entradas que expõem o mecanismo ou o desvio rodam **N = 3 por teste e por condição**: são as 30 dos denominadores (6 de recuperação e 24 de falso positivo, ADR-020) e as 3 que desviam (M3-T2, M3-T3 e M5-T2), 33 entradas no total. As 70 entradas inertes rodam **uma vez por condição**, como controle: na condição ligada, qualquer entrada de log numa entrada inerte é achado, não ruído.
- Nas três repetições, o desfecho de cada (entrada, teste, condição) tem de ser **idêntico**. Ou seja, a classe do ADR-025, ou o resultado do Playwright na condição desligada. Se divergir, o caso é relatado como **não determinismo**, com as três observações, e não é resolvido por média nem por maioria. Na agregação do ADR-025, uma repetição divergente conta como execução separada, então o princípio "contra o mecanismo" já decide o desfecho da entrada.
- O overhead é relatado como mediana e intervalo. Com N = 3, o intervalo é mínimo–máximo, porque percentis com três pontos não teriam significado.

**Alternativas consideradas.** (a) Modo sombra na condição desligada, com as heurísticas rodando sem substituir: descartado. Isso contaminaria o controle com o custo das heurísticas e o overhead deixaria de ser medido contra a baseline real. (b) Um log único compartilhado entre os workers: descartado, porque exigiria trava ou ordem de escrita, e a ordem do arquivo passaria a depender do agendamento. (c) N = 3 também para as entradas inertes: descartado. Elas multiplicariam o tempo da rodada sem medir o mecanismo, e uma passada já basta para detectar o acionamento indevido. (d) Resolver divergência entre repetições por maioria: descartado, pelo mesmo motivo da alternativa (a) do ADR-025.

**Consequência.** Ficam respondidos os pontos (1) e (3) do "Em aberto" do ADR-023. O ponto (2), quem produz o `detectionWaitMs`, continua aberto até a Camada 2. Uma divergência entre repetições não é ruído a esconder: ela entra no relato como achado de não determinismo, do alvo ou do mecanismo.
