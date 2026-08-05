# Megazord Terminal

Um ADE — Agentic Development Environment: um ambiente cujo propósito é coordenar um time de
agentes de IA que escreve, testa e entrega, em vez de editar arquivos.

Este documento é **só glossário**. Nada de decisão de implementação, nada de spec.

## Comando

**Missão**:
Unidade de trabalho isolada, com escopo, modo, orçamento e critério de pronto próprios. Todo
trabalho acontece dentro de uma.
_Avoid_: task, job, sessão, conversa

**Briefing**:
A descrição do resultado esperado que abre uma missão. Descreve o fim, não os passos.
_Avoid_: prompt, pedido, input, requisito

**Modo**:
Quem lidera a missão e quanta autonomia existe — Livre, Combinação ou Agêntico.
_Avoid_: tipo, perfil, nível

**Núcleo**:
O orquestrador de uma missão. Delega, cobra e consolida, e não possui ferramenta de execução.
_Avoid_: maestro, master, coordenador, agente principal

**Delegação**:
A atribuição de um pedaço da missão a um zord, feita pelo Núcleo.
_Avoid_: distribuição, repasse

## Time

**Zord**:
Agente executor, definido pela composição CLI + modelo + skills + effort. Nasce quando é
invocado e morre depois de entregar.
_Avoid_: agente (sozinho), bot, worker, subagente

**Papel**:
A função canônica de um zord — scout, builder, reviewer ou controller. Determina permissão,
não apenas nome.
_Avoid_: cargo, tipo de agente, função

**Harness**:
O pacote resolvido de CLI, modelo, effort e skills com que um zord roda uma tarefa específica.
_Avoid_: config, setup, preset, perfil

**Effort**:
Quanto esforço de raciocínio um zord gasta numa invocação.
_Avoid_: profundidade, nível de esforço

**Combinação**:
Formação nomeada de zords, com roster, gates e entregável declarados.
_Avoid_: squad, time, equipe, formação

**Roster**:
A lista de papéis de uma combinação, com o harness de cada papel.
_Avoid_: elenco, escalação, lista de agentes

**Skill**:
Bloco de instrução instalável que especializa um zord sem alterar código.
_Avoid_: prompt, regra, instrução, documento

## Acordo e entrega

**Contrato**:
A interface acordada entre zords antes de existir código, e a referência contra a qual uma
entrega é aceita ou recusada.
_Avoid_: spec, interface, acordo, schema

**Handoff**:
A entrega estruturada de um zord: escopo, artefatos, contrato de referência e lacunas
declaradas.
_Avoid_: entrega, output, resultado, PR

**Lacuna**:
O que um handoff declara explicitamente não ter coberto.
_Avoid_: pendência, débito, TODO

**Recusa**:
A rejeição de um handoff por violar o contrato, feita pelo Núcleo sem intervenção humana.
_Avoid_: reprovação, rejeição, bloqueio

**Gate**:
Checkpoint em que a missão para e espera decisão humana.
_Avoid_: aprovação, checkpoint, review, validação

**Entrega**:
O resultado consolidado de uma missão, com prova de que funciona.
_Avoid_: deploy, release, produto

## Contexto compartilhado

**Workspace**:
O projeto onde as missões acontecem, e o escopo de compartilhamento do Córtex.
_Avoid_: repo, pasta, projeto, diretório

**Córtex**:
A memória de fatos compartilhada por todos os zords de um workspace, que sobrevive ao fim da
sessão.
_Avoid_: memória, cache, histórico, contexto

**Fato**:
Uma entrada do Córtex, atribuída a quem gravou e à missão de origem.
_Avoid_: nota, log, aprendizado, lembrança

## Execução visível

**Pane**:
Terminal isolado com um zord dentro, visível no cockpit.
_Avoid_: janela, aba, terminal, célula

**Cockpit**:
A grade de panes de uma missão.
_Avoid_: dashboard, tela, grid, painel

**Superfície**:
Uma área do produto que resolve um problema de coordenação de time.
_Avoid_: feature, módulo, página, tela

## Governança

**Medidor**:
A contabilidade ao vivo de token e custo, por pane, por missão e por combinação.
_Avoid_: billing, dashboard de custo, contador

**Teto**:
O limite de gasto de uma missão. Ao ser atingido, a missão para e pede autorização.
_Avoid_: budget, limite, quota, orçamento

**Replay**:
A sequência auditável de eventos de uma missão, incluindo o que foi recusado.
_Avoid_: log, histórico, trace, auditoria
