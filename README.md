# Auto-Healing em Testes Automatizados de Interface Web

Protótipo desenvolvido como Trabalho de Conclusão de Curso (Ciência da Computação — UESC), sob orientação do Prof. Dr. Marcelo Ossamu Honda.

**Título completo:** *Auto-Healing em Testes Automatizados de Interface Web: uma Abordagem Baseada em Similaridade Estrutural e Atributos Estáveis*

## Sobre o projeto

Quando um seletor usado por um teste E2E deixa de encontrar seu elemento — por mudança de classe CSS, id, texto ou estrutura do DOM — a manutenção manual da suíte de testes se torna um gargalo constante. Este projeto implementa um mecanismo de **auto-healing (autorrecuperação)** que tenta relocalizar o elemento por heurísticas alternativas antes de deixar o teste falhar.

O mecanismo combina duas heurísticas:

- **Similaridade estrutural** — mesmo elemento pai, posição entre irmãos, profundidade na árvore DOM.
- **Atributos estáveis** — priorização de atributos como `data-testid` e `aria-label` em detrimento de atributos voláteis (`class`, `id` gerado dinamicamente).

As duas heurísticas são combinadas em um **score de confiança**: acima de um limiar definido, o seletor é substituído automaticamente e a mudança é registrada para revisão humana; abaixo do limiar, o teste falha normalmente — para não mascarar defeitos reais da aplicação sob teste.

## Stack

- [Playwright](https://playwright.dev/) + TypeScript
- Arquitetura **Page Object Model (POM)**
- Persistência leve de fingerprints em JSON (um arquivo por elemento)
- Sem dependências de ML — as heurísticas são baseadas em regras, não em modelos treinados

## Aplicação alvo

Os testes são executados contra [books.toscrape.com](https://books.toscrape.com), site estático de teste (catálogo de livros fictício), usado para os experimentos controlados de mutação de DOM.

## Estrutura do repositório

```
/pages          → Page Objects (POM) da aplicação sob teste
/tests          → Especificações de teste E2E (suíte baseline)
/healing        → Captura de fingerprint, heurísticas de recuperação e score de confiança
/mutation       → Ferramenta de mutação controlada de DOM para os experimentos
/experiments    → Harness de execução (suíte × mutações × com/sem auto-healing) e coleta de métricas
```

## Metodologia de avaliação

Os experimentos comparam a execução da suíte de testes sob as mesmas mutações controladas, com e sem o mecanismo de auto-healing habilitado, coletando três métricas principais:

- **Taxa de recuperação** — entre as mutações cosméticas que quebram o seletor original, a fração em que o mecanismo recupera o elemento correto.
- **Taxa de falso positivo** — entre as mutações que removem o elemento-alvo (defeito real) e quebram o seletor original, a fração em que o mecanismo substitui o seletor em vez de deixar o teste falhar.
- **Overhead de execução** — tempo extra introduzido pela tentativa de recuperação.

Como os denominadores são pequenos, as taxas são reportadas como fração absoluta (ex.: 3/6), com uma linha por caso, e não apenas como percentual.

## Como rodar

```bash
npm install
npx playwright install chromium
npm test                  # 66 testes E2E (suíte baseline)
npm run test:unit         # testes unitários do mecanismo, sem rede
npm run test:integration  # testes de integração contra o site real
```

## Escopo

Este é um protótipo de pesquisa com escopo deliberadamente reduzido para caber no prazo do TCC. Fora do escopo atual (possíveis trabalhos futuros): similaridade textual via embeddings e uma ferramenta de mutação genérica configurável para qualquer site.

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](./LICENSE) para mais detalhes.