# Megazord Terminal

**O ADE — Agentic Development Environment.**

> Num IDE, você escreve código com ajuda de IA. Num ADE, você comanda um time de IAs que
> escreve, testa e entrega — e o ambiente inteiro existe pra coordenar esse time, não pra
> editar arquivo.

Este repositório contém o **site de produto** do Megazord Terminal: o posicionamento da
categoria, o desenho das 18 superfícies de coordenação (`/features`), as combinações de
time prontas, o manifesto e a comparação honesta IDE × ADE.

O design de produto por trás do site está documentado em [`docs/PRODUTO.md`](docs/PRODUTO.md).

---

## Rodar

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # build estático (27 rotas pré-renderizadas)
npm start
```

Sem dependência de runtime além de Next/React. Fontes são stacks do sistema — nenhuma
requisição externa, nenhum CDN.

## Stack

| Peça | Escolha |
| --- | --- |
| Framework | Next.js 15 (App Router, RSC, SSG) |
| Estilo | Tailwind CSS v4 (`@theme` com tokens próprios) |
| Tipos | TypeScript strict |
| Conteúdo | Data layer tipado em `lib/` — nada de copy solta no JSX |
| Motion | CSS puro, com `prefers-reduced-motion` respeitado |

## Estrutura

```
app/
  page.tsx              home — hero, simulação do cockpit, 18 superfícies, combinações
  features/page.tsx     índice das superfícies, agrupado nas 4 camadas
  features/[slug]/      1 página por superfície (18 rotas SSG)
  como-funciona/        o loop de 6 passos, do briefing à prova
  combinacoes/          as 5 formações de time, com roster, gates e entregáveis
  manifesto/            as 7 teses do produto
  ide-vs-ade/           comparação de 3 abordagens + quando NÃO usar um ADE
components/
  CockpitSim.tsx        simulação animada: 1 briefing → 6 agentes → gate → entrega
  Diagrams.tsx          16 diagramas de mecanismo, um por tipo de superfície
  ui.tsx                primitivos + mapa de accents por papel canônico
  Nav.tsx / Footer.tsx
lib/
  surfaces.ts           as 18 superfícies: copy, passos, capacidades, contraste IDE/ADE
  site.ts               formações, modos, teses, critérios de comparação, FAQ
```

Toda a informação de produto vive em `lib/`. Adicionar uma superfície é adicionar um objeto
em `SURFACES` — a rota, o card do índice, o rodapé e a navegação anterior/próxima saem de
graça.

## Sistema visual

Cockpit escuro, tipografia mono para comando e sans para leitura corrida. Os cinco accents
não são decoração: cada um é um **papel canônico** do time, e a cor é consistente em toda a
interface.

| Token | Cor | Papel |
| --- | --- | --- |
| `cmd` | `#ff3b30` | comando / orquestração |
| `scout` | `#2e8cff` | exploração |
| `build` | `#ffb020` | construção |
| `review` | `#a472ff` | contrato / revisão |
| `ctrl` | `#12c8a0` | controle / QA |

## Licença

Ainda não definida.
