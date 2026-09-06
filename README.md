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
- Persistência leve de fingerprints (JSON ou SQLite)
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

Os experimentos comparam a execução da suíte de testes com e sob as mesmas mutações controladas, com e sem o mecanismo de auto-healing habilitado, coletando três métricas principais:

- **Taxa de recuperação** — % de testes que continuam passando corretamente após a mutação.
- **Taxa de falso positivo** — % de casos em que o mecanismo "recupera" um teste que deveria de fato falhar, indicando um defeito real na aplicação.
- **Overhead de execução** — tempo extra introduzido pela tentativa de recuperação.

## Como rodar

```bash
npm install
npx playwright install chromium
npx playwright test
```

## Escopo

Este é um protótipo de pesquisa com escopo deliberadamente reduzido para caber no prazo do TCC. Fora do escopo atual (possíveis trabalhos futuros): similaridade textual via embeddings e uma ferramenta de mutação genérica configurável para qualquer site.

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](./LICENSE) para mais detalhes.