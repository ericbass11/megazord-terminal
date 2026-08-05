# Megazord Terminal — desenho de produto

Documento de referência do produto: a categoria, a tese, a arquitetura de superfícies e as
decisões que separam este produto de um IDE com IA.

---

## 1. A categoria

**ADE — Agentic Development Environment.**

Um IDE otimiza a escrita de uma linha por vez. O gargalo dele é a velocidade dos seus dedos e
a sua memória de trabalho, e a IA entrou nesse mundo como autocomplete melhor: um assistente
na lateral do arquivo aberto.

Um ADE assume outra premissa: o trabalho é feito por **vários agentes ao mesmo tempo**, e o
gargalo passou a ser **coordenação** — quem faz o quê, contra qual contrato, a que custo, com
qual aprovação. É outra categoria, com outro centro de tela.

| | IDE | ADE |
| --- | --- | --- |
| No centro | o arquivo | o time |
| Papel do humano | escrever e revisar | dar briefing, aprovar gates, conferir |
| Unidade de trabalho | arquivo salvo | missão entregue, com prova e replay |
| Papel da IA | assistente | executor coordenado por software |
| Papel do editor | o produto inteiro | 1 de 18 superfícies, usada pra conferir |

A frase de teste: **se o seu ambiente não sabe abrir dez agentes, cobrar handoff estruturado e
mostrar o custo de cada um ao vivo, ele é um IDE com copilot.** O que é ótimo — e é outra
coisa.

## 2. Nome e metáfora

`Megazord`: cinco pilotos, cada um com seu zord especializado, que **combinam** numa máquina só
quando o problema é grande demais pra um. A metáfora carrega o produto inteiro sem esforço:

- **zord** = agente (CLI + modelo + skills + effort)
- **combinação** = squad/formação pronta que entrega um resultado
- **cockpit** = a grade de panes onde o time trabalha à vista
- **núcleo** = o orquestrador, que comanda e não executa

`terminal` mantém o produto ancorado onde o trabalho realmente acontece: processos rodando,
não caixas de chat.

## 3. As sete teses

1. **O modelo não é o teto. O harness é.** Mesmo modelo, resultados diferentes, conforme como
   você o monta.
2. **Orquestrador com shell vira gargalo.** Se pode executar, vai executar — e aí o modelo mais
   caro faz task mecânica.
3. **Paralelismo sem contrato é merge hell.** O ganho só é real quando a interface é fechada
   antes do código.
4. **Custo é feature, não fatura.** Token gasto aparece na hora, por agente, com teto que freia.
5. **Benchmark de lab não paga sua conta.** O que importa é bench maxing na sua operação.
6. **Autonomia sem gate é irresponsabilidade; gate em tudo é inútil.** Duas ou três decisões
   por missão são realmente suas.
7. **Se você abriu um arquivo pra corrigir na mão, algo falhou.** Faltou skill, contrato ou gate.

Consequência de produto: coordenação de time não é um painel na lateral de um editor. Contrato,
gate, custo e replay têm que ser objetos de primeira classe.

## 4. Arquitetura de superfícies

18 superfícies, em quatro camadas. A divisão responde quatro perguntas, na ordem em que elas
aparecem pra quem opera.

### 01 · Comando — como a ordem entra
| Superfície | Resolve |
| --- | --- |
| **Cockpit** | ver o time inteiro trabalhando, com status e custo por agente |
| **Núcleo** | orquestrar sem poder executar (sem shell, sem editor) |
| **Missões** | isolar trabalho: escopo, modo, worktree, teto de gasto |
| **Voz** | encurtar o briefing: push-to-talk local e conversa contínua |

### 02 · Time — quem executa
| Superfície | Resolve |
| --- | --- |
| **Zords** | agente como peça combinável, não como conversa |
| **Combinações** | time pronto por resultado, com roster e gates declarados |
| **Skills** | instrução instalável com auto-deploy por papel e gate por missão |
| **Harness** | tarefa certa → agente, modelo e effort certos, deterministicamente |
| **Providers** | um provider por pane; nenhum lab é bom em tudo |
| **Mercado** | distribuir skill, zord e formação em 1 clique |

### 03 · Contexto — o que o time compartilha
| Superfície | Resolve |
| --- | --- |
| **Córtex** | memória compartilhada que sobrevive à sessão |
| **Contratos** | interface assinada antes do código — paralelismo que dá merge |
| **Workspace** | arquivos, editor e browser como ferramenta de conferência |
| **Mídia** | asset (imagem, vídeo, áudio) como entregável de primeira classe |
| **Control plane** | 52 MCP tools: o cockpit é uma API que o agente opera |

### 04 · Controle — como você não perde o controle
| Superfície | Resolve |
| --- | --- |
| **Gates** | handoff estruturado + checkpoint humano nos pontos que importam |
| **Medidor** | token, custo e rate limit ao vivo, com teto que freia |
| **Replay** | timeline auditável: quem decidiu o quê, com qual harness, a que custo |

### Onde este desenho é opinativo

Quatro superfícies existem porque a operação com muitos agentes quebra sem elas, e são o que
diferencia este desenho de um multiplexador de chats:

- **Contratos** — a resposta ao merge hell. Sem essa fase, cinco agentes rápidos produzem
  trabalho que não encaixa, e o ganho do paralelo volta como retrabalho. É também o que dá ao
  Núcleo um critério **objetivo** pra recusar handoff sem consultar o humano.
- **Gates** — a resposta ao falso dilema entre agente solto e aprovação em tudo.
- **Medidor** — a resposta ao custo invisível: teto por missão e custo por pane, não fatura.
- **Replay** — a resposta ao medo de perder o fio: nada de caixa-preta, com prompt e custo
  exatos por passo.

## 5. Modos de missão

| Modo | Quem lidera | Uso |
| --- | --- | --- |
| **Livre** | você | explorar, prototipar, testar ideia |
| **Combinação** | o Núcleo | entregar resultado repetível |
| **Agêntico** | piloto que decompõe em fases | missão longa e autônoma |

Papéis canônicos (com permissão amarrada ao papel, não só ao nome): `scout` explora e não
edita produção; `builder` constrói; `reviewer` só lê e reprova; `controller` centraliza log e
despacho.

## 6. Combinações de fábrica

| Formação | Entrega | Time | Gates |
| --- | --- | --- | --- |
| **Vitrine** | site de produto publicado e revisado | 1 núcleo + 6 | 2 |
| **Fábrica** | web app funcionando com dados reais | 1 núcleo + 5 | 3 |
| **Caixa** | SaaS publicado, cobrando, com review de segurança | 1 núcleo + 5 | 3 |
| **Piloto Automático** | automação instalada, agendada e testada | 1 núcleo + 3 | 3 |
| **Arena** | game web jogável com prova em vídeo | 1 núcleo + 3 | 3 |

Toda formação nasce com **fase de contrato** antes de qualquer builder escrever código, e com
os gates já declarados. Roster é editável e salvável: a formação do usuário vale igual às de
fábrica.

## 7. O loop de operação

```
briefing (texto ou voz)
   → núcleo monta plano, roster e harness  → [você aprova o plano]
   → time fecha o contrato de interface    → [gate humano]
   → zords trabalham em paralelo (panes, providers e efforts distintos)
   → handoff estruturado, conferido contra o contrato (recusa automática)
   → [gate humano nas decisões que são suas]
   → entrega consolidada + prova + custo fechado + replay
```

O humano aparece em três pontos: briefing, gates e conferência. As outras trezentas decisões
são trabalho de time.

## 8. Quando o ADE é a ferramenta errada

Honestidade é parte do posicionamento — o site tem uma seção só pra isso:

- correção de uma linha que você já sabe fazer;
- exploração pessoal sem entregável (aí o modo Livre basta);
- código que você precisa entender linha por linha pra aprender;
- base sem teste e sem convenção escrita — monte contrato e skill antes de escalar o time.

Régua prática: **se a tarefa cabe numa cabeça e numa janela, use um IDE. Se ela precisa de
frentes paralelas, revisão independente e prova de que funcionou, ela é uma missão.**

## 9. Como o site materializa a tese

O site é a primeira demonstração do produto, então ele não pode ser uma lista de features:

- **A home mostra o cockpit rodando** (`CockpitSim`) — briefing digitando, 6 panes nascendo,
  custo subindo, um gate exigindo aprovação clicável, um handoff recusado por violar contrato
  e a entrega consolidada. O loop inteiro em ~14s, e o gate é interativo.
- **Cada superfície tem um diagrama de mecanismo**, não um ícone: delegação com gate, contrato
  convergindo, timeline de replay, medidor com teto, harness mapeando tarefa → modelo → effort.
- **Cada superfície declara o contraste** `num IDE` × `num ADE`, porque a categoria é a tese.
- **Cada capacidade tem status honesto** — `no ar`, `beta` ou `em obra`. Roadmap à vista em vez
  de promessa uniforme.
- **A comparação inclui quando não usar.** Comparação sem essa seção é folheto.

## 10. Próximos passos naturais

1. **Preços** — três planos, com voz e mídia como divisores plausíveis.
2. **Prova social real** — missões públicas com replay aberto (o replay é o ativo de marketing
   mais forte do produto: dá pra publicar a missão inteira).
3. **Benchmark próprio** — página de bench maxing com metodologia aberta, alinhada à tese 5.
4. **Docs do control plane** — referência das 52 MCP tools, que é o que atrai quem estende.
5. **Onboarding** — do `mz .` à primeira missão entregue, medido em minutos.
