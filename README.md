# Auto-Healing em Testes Automatizados de Interface Web

Protótipo desenvolvido como Trabalho de Conclusão de Curso (Ciência da Computação — UESC), sob orientação do Prof. Dr. Marcelo Ossamu Honda.

**Título completo:** *Auto-Healing em Testes Automatizados de Interface Web: uma Abordagem Baseada em Similaridade Estrutural e Atributos Estáveis*

> ⚠️ **Rodadas contra o site.** A suíte E2E, os testes de integração, a matriz de efetividade, a ida e volta, o harness (`--run`/`--resume`) e a medição da captura acessam [books.toscrape.com](https://books.toscrape.com), um **site de terceiros** que não pertence a este projeto. Os resultados oficiais já estão versionados, e **a análise inteira é reproduzível sem rede** (ver [Reprodução offline](#reprodução-offline-sem-acesso-ao-site)). O workflow de CI (`.github/workflows/playwright.yml`) roda a suíte E2E contra o site a cada push ou pull request no `main`.

## Sobre o projeto

Quando um seletor usado por um teste E2E deixa de encontrar seu elemento, por mudança de classe CSS, id, texto ou estrutura do DOM, a manutenção manual da suíte vira um gargalo. Este projeto implementa um mecanismo de **auto-healing (autorrecuperação)** que, ao detectar um locator quebrado, tenta relocalizar o elemento por heurísticas e só substitui o seletor quando a confiança é alta. Abaixo do limiar, o teste falha normalmente, para não mascarar defeitos reais.

Stack: [Playwright](https://playwright.dev/) 1.63 + TypeScript, Page Object Model, fingerprints em JSON (um arquivo por elemento), heurísticas baseadas em regras, sem ML.

## Arquitetura

O mecanismo tem quatro camadas. Todas passam por um único ponto de extensão, `withCapture(page, descrição, locator, ação)`, que todo Page Object usa no lugar de chamar o `Locator` diretamente.

| Camada | O que faz | Onde |
|---|---|---|
| 1 · Captura | Antes de cada ação, extrai o fingerprint do elemento (tag, texto, atributos estáveis e voláteis, posição na árvore) e o grava depois da ação bem-sucedida. A gravação é determinística: duas execuções sobre o site inalterado produzem bytes idênticos | `healing/withCapture.ts`, `healing/fingerprintStore.ts` |
| 2 · Detecção | Com `HEALING=on`, uma ação que lança exceção só conta como locator quebrado se, depois da falha, o locator resolver **zero** elementos. Sem checagem prévia: `isVisible()` sobre um elemento ausente devolve `false` e não aciona nada | `healing/withCapture.ts` |
| 3 · Heurísticas e score | Duas heurísticas procuram o elemento no DOM atual a partir do fingerprint de baseline, e o score de confiança as combina | `healing/heuristics/`, `healing/decision/confidenceScore.ts` |
| 4 · Decisão | Converte o score em `replace` (substitui e executa a ação no candidato) ou `fail` (relança o erro original) e registra as duas decisões em log estruturado | `healing/decision/decide.ts`, `healing/decision/recovery.ts` |

**Heurísticas.**

- **Atributos estáveis:** escada de prioridade com teto de score por critério: `data-testid` (1,00), `aria-label` (0,90) e demais `data-*`/`aria-*` (0,75 × fração que casou). `class` e `id` só desempatam, nunca buscam. Quando o fingerprint não tem atributo estável, devolve `applicable: false`. É o caso dos 134 fingerprints deste alvo.
- **Similaridade estrutural:** soma ponderada de quatro sinais: pai (0,45), índice entre irmãos (0,30), profundidade (0,15) e tag (0,10). Candidatos abaixo de 0,25 são descartados. Sinaliza `ambiguous` quando há empate.

**Score de confiança**, em quatro passos:

1. **Aplicabilidade:** heurística com `applicable: false` sai do cálculo. Sem nenhuma aplicável, o score é `null` ("sem confiança"), não zero.
2. **Combinação:** maior score entre as heurísticas que acharam candidato. Se elas apontam elementos diferentes, ×0,5.
3. **Ambiguidade:** ambiguidade não resolvida por concordância das heurísticas, ×0,5.
4. **Corroboração por texto:** fator em [0,5; 1,0] pela similaridade de tokens (Jaccard) entre o texto do fingerprint e o do candidato, em rampa com piso até 0,5 de similaridade e fator cheio a partir de 0,9. Sem texto no fingerprint, não há desconto.

O log guarda `rawScore` e os três fatores (`score = rawScore × divergência × ambiguidade × texto`), o que permite recalcular a decisão offline sob outro limiar.

**Decisão.** Limiar `CONFIDENCE_THRESHOLD = 0.7`, inclusivo. Ele ficou fixo na rodada principal, e outros limiares aparecem só como análise de sensibilidade offline, secundária e aproximada.

**Ferramenta de mutação.** Um catálogo fixo e determinístico de 103 entradas: 5 tipos de mutação (M1 atributos voláteis, M2 texto, M3 reordenação, M4 wrapper, M5 remoção) × 10 alvos (T1–T10), cada uma com rótulo de verdade. A mutação é aplicada ao HTML antes de ele chegar à página, e o oráculo fica fora do DOM. Detalhes em [mutation/README.md](mutation/README.md).

Documentação detalhada do mecanismo: [healing/README.md](healing/README.md).

## Estrutura do repositório

```
pages/                Page Objects (POM); todo acesso ao DOM passa por withCapture
tests/                Suíte E2E baseline (66 testes); amostra de categorias em tests/fixtures/amostras.ts
healing/              Mecanismo (camadas 1 a 4) e registro das decisões de projeto
  fingerprints/       Baseline versionado: 134 fingerprints em 34 páginas
  heuristics/         Atributos estáveis e similaridade estrutural
  decision/           Score de confiança, decisão e tentativa instrumentada
  mutation/, experiments/, *.spec.ts   Testes unitários (testDir da config unitária)
integration/          Testes de integração contra o site real, incluindo a matriz de efetividade
mutation/             Catálogo de mutações, aplicação, matriz de efetividade e mapa teste → alvo (JSON gerados)
experiments/
  harness.mts         Orquestrador da rodada principal (suíte × mutações × healing ligado/desligado)
  overhead.mts        Orquestrador da medição complementar do custo da captura
  roundtrip.mts       Ida e volta da reescrita de documentos, sem mutação
  resultsAnalysis.mts Análise: gera experiments/analysis/ a partir de experiments/results/
  ablationAnalysis.mts Ablação do score em três configurações, chamada pela análise
  results/            Rodadas oficiais copiadas sem edição, cada uma com MANIFEST.sha256
  analysis/           Tabelas (.md e .csv), gráficos (.svg) e RESUMO.md, gerados por script
  CADERNO.md          Caderno de experimentos: o que foi executado, quando, com que commit e o que se observou
playwright.config.ts              Suíte E2E
playwright.unit.config.ts         Unitários (sem rede)
playwright.integration.config.ts  Integração (rede, retries: 2)
```

## Contagens finais de testes

São três categorias com propósitos distintos, e **não devem ser somadas num total só**.

| Categoria | Testes | Comando | Rede |
|---|---|---|---|
| E2E (suíte baseline) | **66**: 2 fluxos fixos (home e paginação) + 4 fluxos × 16 categorias (navegação por categoria e 3 de detalhes do produto) | `npm test` | site |
| Unitários | **167**, em 16 arquivos | `npm run test:unit` | nenhuma: DOM via `page.setContent()` e `page.route` |
| Integração | **18**, em 4 arquivos (estrutural 9, score 6, mutação 2, recuperação 1) | `npm run test:integration` | site |

Contagens conferidas com `npx playwright test --config=<config> --list`, que lista sem executar.

## Requisitos

- **Node.js 24** ou superior. Os scripts `.mts` rodam no Node puro, que executa TypeScript sem compilação. As rodadas usaram o Node v24.14.0.
- Chromium do Playwright: `npx playwright install chromium`. As rodadas usaram o Chromium 153.0.8010.12.
- **Windows:** clone com `core.longpaths` ligado. Alguns caminhos de `experiments/results/` passam de 260 caracteres.
- **Histórico completo do git**, sem `--depth`: a análise lê a matriz e o mapa versionados no commit de cada rodada (`git show <commit>:<arquivo>`).

```bash
git clone -c core.longpaths=true https://github.com/lluigecm/autohealing-e2e-tests.git
cd autohealing-e2e-tests
npm ci
npx playwright install chromium
```

## Reprodução offline (sem acesso ao site)

Nada nesta seção faz requisição ao books.toscrape.com.

```bash
npx tsc --noEmit                          # checagem de tipos
npm run test:unit                         # 167 unitários
node experiments/harness.mts              # simulação do plano da rodada principal (padrão: não executa)
node experiments/overhead.mts             # simulação do plano da medição da captura
node experiments/resultsAnalysis.mts --check   # regenera a análise em memória e compara byte a byte
```

**Conferência dos manifestos.** Cada rodada oficial tem um `MANIFEST.sha256` no formato do `sha256sum`, com hashes calculados a partir dos arquivos originais da rodada:

```bash
(cd experiments/results/2026-10-12T16-32-03-131Z && sha256sum -c --quiet MANIFEST.sha256)
(cd experiments/results/overhead-captura-2026-10-15T15-16-16-991Z && sha256sum -c --quiet MANIFEST.sha256)
```

O `.gitattributes` marca `experiments/results/**` e `experiments/analysis/**` como `-text`, para que o checkout preserve os bytes exatos. O script da análise também confere os dois manifestos antes de gerar qualquer tabela e para se algum arquivo divergir.

## Reprodução de cada parte

Os comandos abaixo usam sintaxe bash para variáveis de ambiente. No PowerShell, use `$env:VAR = 'valor'` antes do comando.

### Suíte E2E

```bash
npm test     # 66 testes, healing desligado, captura ligada (regrava healing/fingerprints/)
```

Com o site inalterado, a regravação produz bytes idênticos aos versionados, e `git status` continua limpo.

### Unitários e integração

```bash
npm run test:unit          # 167, sem rede
npm run test:integration   # 18, contra o site; inclui a matriz de efetividade em modo de comparação
```

### Matriz de efetividade

Mede, para as 103 entradas do catálogo e **sem recuperação**, se o locator quebra, desvia ou fica inerte, e reproduz o teste baseline correspondente.

```bash
# Comparação com o arquivo versionado (mutation/effectiveness-matrix.json)
npx playwright test --config=playwright.integration.config.ts -g "matriz"

# Regeração: duas rodadas e diff zero antes de substituir o arquivo
MUTATION_MATRIX_OUT=a.json npx playwright test --config=playwright.integration.config.ts -g "matriz"
MUTATION_MATRIX_OUT=b.json npx playwright test --config=playwright.integration.config.ts -g "matriz"
diff a.json b.json && cp a.json mutation/effectiveness-matrix.json
```

O mapa teste → alvo (`mutation/target-test-map.json`) é regerado da mesma forma. Veja [mutation/README.md](mutation/README.md).

### Ida e volta da reescrita de documentos

```bash
node experiments/roundtrip.mts   # 66 testes com todo documento reserializado; exige os 134 fingerprints idênticos
```

### Harness da rodada principal

Roda os 66 testes sob cada uma das 103 entradas, nas condições `healing-off` (controle, suíte intocada) e `healing-on`: 206 invocações e 4.040 execuções de teste. Entradas que quebram ou desviam o locator rodam 3 vezes por teste e condição, e as inertes, uma. As condições são intercaladas por entrada, alternando qual vai primeiro.

```bash
node experiments/harness.mts                               # simulação (padrão): plano e tempo estimado, sem rede
node experiments/harness.mts --run                         # executa contra o site (~3 h)
node experiments/harness.mts --resume experiments/runs/<rodada>   # retoma uma rodada interrompida
```

- Opções: `--entries M1-T8,M5-T2` (subconjunto), `--calibrate-from experiments/runs/<rodada>` (calibra a estimativa de tempo) e `--per-test-s`, `--broken-extra-s`, `--startup-s` (custos da simulação).
- `--run` e `--resume` recusam rodar com a árvore do git suja. `--resume` exige o mesmo commit da rodada interrompida e só executa as invocações sem desfecho registrado.
- Antes de cada invocação, uma pré-verificação faz GET na home (3 tentativas). Se as três falharem, a rodada aborta.
- Uma invocação com execução inválida por infraestrutura, identificada só por sinal estruturado do Playwright, roda de novo inteira uma única vez. Se falhar de novo, fica "não medida".
- A rodada é gravada em `experiments/runs/`, ignorado pelo git. A rodada oficial é copiada sem edição para `experiments/results/<rodada>/`, com manifesto.

### Medição do custo da captura

Medição complementar à rodada principal: os 66 testes sem mutação e com healing desligado, com a captura ligada e desligada. São 1 aquecimento descartado e 10 pares alternados.

```bash
node experiments/overhead.mts                               # simulação (padrão), sem rede
node experiments/overhead.mts --run                         # executa contra o site (~30 min)
node experiments/overhead.mts --resume experiments/runs/<rodada>
```

Valem as mesmas regras de árvore limpa, pré-verificação, reexecução e retomada do harness.

### Análise

```bash
node experiments/resultsAnalysis.mts           # gera experiments/analysis/ a partir de experiments/results/
node experiments/resultsAnalysis.mts --check   # regenera em memória e compara byte a byte com o versionado
```

A análise lê só `experiments/results/`, confere os manifestos, confere a coerência entre o log do mecanismo e os eventos dos testes e então gera as tabelas, os gráficos e o [RESUMO.md](experiments/analysis/RESUMO.md). A saída é determinística, e nenhum arquivo de `experiments/analysis/` é editado à mão.

## Resultados

Os resultados estão em [experiments/analysis/RESUMO.md](experiments/analysis/RESUMO.md), com uma tabela por métrica em `experiments/analysis/tabelas/`. O histórico das execuções (pilotos, rodada principal, medição da captura e anomalias) está no [caderno de experimentos](experiments/CADERNO.md).

Os denominadores são pequenos, então as taxas são relatadas como fração com o número absoluto e uma linha por entrada, nunca só como percentual.

## Escopo

Protótipo de pesquisa com escopo reduzido para caber no prazo do TCC. As heurísticas e a ferramenta de mutação foram escritas para um único alvo, o books.toscrape.com. Similaridade textual por embeddings e uma ferramenta de mutação genérica ficam fora do escopo.

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](./LICENSE).
