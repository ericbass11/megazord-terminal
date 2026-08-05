export type Status = "live" | "beta" | "wip";
export type LayerId = "comando" | "time" | "contexto" | "controle";
export type Visual =
  | "cockpit"
  | "delegation"
  | "harness"
  | "memory"
  | "contract"
  | "timeline"
  | "meter"
  | "gate"
  | "voice"
  | "providers"
  | "mission"
  | "skills"
  | "api"
  | "media"
  | "market"
  | "workspace";

export interface Cap {
  label: string;
  body: string;
  status: Status;
}

export interface Step {
  title: string;
  body: string;
}

export interface Surface {
  slug: string;
  name: string;
  layer: LayerId;
  visual: Visual;
  accent: "cmd" | "scout" | "build" | "review" | "ctrl";
  /** one-line index card copy */
  card: string;
  /** page h1 */
  title: string;
  /** page subheadline */
  sub: string;
  /** metric shown on the card, e.g. "8+ panes" */
  metric: string;
  what: string[];
  steps: Step[];
  caps: Cap[];
  /** the IDE/ADE contrast pair */
  ide: string;
  ade: string;
  related: string[];
}

export const LAYERS: Record<LayerId, { name: string; label: string; body: string }> = {
  comando: {
    name: "Comando",
    label: "01 / COMANDO",
    body: "Como a ordem entra. Você descreve o resultado — não os passos, não os arquivos.",
  },
  time: {
    name: "Time",
    label: "02 / TIME",
    body: "Quem executa. Agentes são peças combináveis com modelo, skill e effort próprios.",
  },
  contexto: {
    name: "Contexto",
    label: "03 / CONTEXTO",
    body: "O que o time compartilha. Memória, contratos e chão de trabalho comuns a todos.",
  },
  controle: {
    name: "Controle",
    label: "04 / CONTROLE",
    body: "Como você não perde o controle. Gate, teto de gasto e replay auditável.",
  },
};

export const SURFACES: Surface[] = [
  /* ───────────────────────── 01 COMANDO ───────────────────────── */
  {
    slug: "cockpit",
    name: "Cockpit",
    layer: "comando",
    visual: "cockpit",
    accent: "cmd",
    metric: "12 panes",
    card: "O time inteiro numa tela: cada agente num pane, status e custo à vista.",
    title: "Cockpit — o time inteiro na mesma tela",
    sub: "Cada agente num pane vivo. Trabalhando ao mesmo tempo, com token e custo contando na sua frente.",
    what: [
      "O cockpit é a tela principal do ADE, e ela não tem um editor no centro. Tem uma grade de panes — cada pane é um terminal isolado com um agente dentro, rodando de verdade: seu próprio processo, seu próprio provider, seu próprio orçamento.",
      "Você não lê o resumo depois. Você assiste. Dá pra ver o scout varrendo o repositório enquanto dois builders escrevem em paralelo e o reviewer espera o handoff. Quando algo trava, você vê no pane que travou — não numa mensagem de erro genérica três minutos depois.",
      "Pane é descartável por design. O Núcleo abre quando precisa e fecha 30s depois da entrega, devolvendo memória. A grade é sempre o estado real do time, não um histórico de conversa.",
    ],
    steps: [
      { title: "Abra uma missão", body: "Cada missão traz sua própria grade, seu worktree e seu teto de gasto." },
      { title: "Deixe o Núcleo montar a grade", body: "Ele spawna os zords que o briefing pede — ou você adiciona um pane na mão." },
      { title: "Assista e intervenha", body: "Digite direto em qualquer pane, pause, mate ou promova um agente sem parar os outros." },
    ],
    caps: [
      { label: "Grade dinâmica", status: "live", body: "De 1 a 12 panes com layout que se reorganiza; arraste um pane pra fora e vire janela." },
      { label: "Medidor por pane", status: "live", body: "Token in/out, custo acumulado e latência do último turno, por agente." },
      { label: "8 estados de agente", status: "live", body: "Idle, lendo, escrevendo, aguardando gate, bloqueado, entregando, morto, hibernado." },
      { label: "Hibernação", status: "live", body: "Pane ocioso libera ~370 MB e volta com o histórico intacto." },
      { label: "Boot < 2s", status: "live", body: "Spawn de agente com CLI, skills e contexto já injetados." },
      { label: "Pane de browser", status: "live", body: "Preview do localhost ao lado dos agentes que estão mexendo nele." },
    ],
    ide: "Uma janela, um arquivo, um cursor — o seu.",
    ade: "Doze janelas, doze agentes, e o seu papel é decidir quem continua.",
    related: ["nucleo", "medidor", "missoes"],
  },
  {
    slug: "nucleo",
    name: "Núcleo",
    layer: "comando",
    visual: "delegation",
    accent: "cmd",
    metric: "0 tools de edição",
    card: "O comandante que não sabe escrever código — só delegar, cobrar e consolidar.",
    title: "Núcleo — o comandante que não escreve código",
    sub: "Ele lê o briefing, delega, cobra e consolida. Sem shell, sem editor: não consegue fazer sozinho nem se quiser.",
    what: [
      "O Núcleo é o orquestrador, e a decisão de produto mais importante do ADE é o que ele não tem: ferramenta de edição, shell, acesso a arquivo. Ele é fisicamente incapaz de executar a tarefa. Só pode delegar, observar e consolidar.",
      "Isso não é limitação, é o que faz a coordenação funcionar. Orquestrador com shell sempre cai na tentação de \"resolver rapidinho\" — e aí ele vira o gargalo, gasta o token caro na task mecânica e perde a visão do time. Delegação com gate mantém coordenação e execução em camadas separadas.",
      "O Núcleo também não fica em loop de espera queimando token. Handoff é event-driven: o zord acorda o Núcleo quando entrega. Enquanto ninguém entrega, o Núcleo está dormindo e custando zero.",
    ],
    steps: [
      { title: "Dê o briefing", body: "Texto ou voz, no nível de resultado: \"quero um SaaS de validação de e-mail cobrando\"." },
      { title: "Ele monta o time", body: "Escolhe combinação, chefes de área e o harness de cada zord — e te mostra o plano antes." },
      { title: "Ele cobra e consolida", body: "Recebe handoff, cruza com o contrato, devolve trabalho recusado e entrega o resultado agregado." },
    ],
    caps: [
      { label: "Delegação com gate", status: "live", body: "Coordenação e execução nunca no mesmo processo. O Núcleo não tem como burlar." },
      { label: "Handoff event-driven", status: "live", body: "Zero polling: o zord acorda o Núcleo na entrega. Sem loop de espera pago." },
      { label: "Chefes de área", status: "live", body: "Scout, builder, reviewer e controller recebem lotes e despacham workers visíveis." },
      { label: "Recusa de entrega", status: "live", body: "Handoff fora do contrato volta pro zord com o motivo, sem passar por você." },
      { label: "Plano antes de gastar", status: "live", body: "Time, custo estimado e gates propostos aparecem pra aprovação no início." },
      { label: "Modo agêntico profundo", status: "beta", body: "Missões longas com re-planejamento entre fases." },
    ],
    ide: "Você é o orquestrador. Copiar, colar, trocar de janela, repetir.",
    ade: "O orquestrador é software. Você é o cliente dele.",
    related: ["cockpit", "gates", "harness"],
  },
  {
    slug: "missoes",
    name: "Missões",
    layer: "comando",
    visual: "mission",
    accent: "cmd",
    metric: "3 modos",
    card: "A unidade de trabalho: escopo, modo, worktree e um resultado apontável.",
    title: "Missões — a unidade de trabalho do ADE",
    sub: "Livre, Combinação ou Agêntico. Cada missão com panes, worktree, teto de gasto e status próprios.",
    what: [
      "Missão é o container de tudo. Não existe \"conversa solta\" no ADE: todo trabalho acontece dentro de uma missão que tem escopo declarado, modo de operação, branch isolada e um critério de pronto.",
      "O que diferencia uma missão da outra é o modo — quem lidera e quanta autonomia existe. No Livre você comanda os panes na mão. Na Combinação o Núcleo abre e conduz o time. No Agêntico um piloto decompõe a missão em fases e invoca chefes de área, que despacham workers.",
      "Cada missão vira um placar. Os zords registram marcos — todo, em progresso, feito — e você lê o progresso sem perguntar \"e aí?\" pra ninguém. E como cada missão tem worktree próprio, duas missões podem rodar no mesmo repo sem se atropelar.",
    ],
    steps: [
      { title: "Escolha o resultado", body: "O wizard pergunta o que precisa existir no fim, não quais passos dar." },
      { title: "Escolha o modo", body: "Livre pra explorar, Combinação pra entregar, Agêntico pra missão longa." },
      { title: "Deixe rodar — ou agende", body: "Cron dispara a missão de madrugada e te avisa se algum gate reprovar." },
    ],
    caps: [
      { label: "3 modos", status: "live", body: "Livre, Combinação e Agêntico, com estilos Pipeline ou Torre de Controle." },
      { label: "Worktree por missão", status: "live", body: "Branch isolada automática; missões paralelas no mesmo repo sem conflito." },
      { label: "Placar de tasks", status: "live", body: "Telemetria read-only do que cada zord está fazendo agora." },
      { label: "Missões agendadas", status: "live", body: "Cron com alerta de falha: a missão roda sozinha e só te chama se quebrar." },
      { label: "Restore de sessão", status: "live", body: "Feche o app; reabra e retome a missão com histórico e panes intactos." },
      { label: "Teto de gasto", status: "live", body: "Limite em R$ por missão; ao bater, o time para e pede autorização." },
    ],
    ide: "Um repositório aberto, um branch, e a memória de tudo é a sua.",
    ade: "Missões isoladas e paralelas, cada uma com estado, orçamento e histórico próprios.",
    related: ["cockpit", "workspace", "replay"],
  },
  {
    slug: "voz",
    name: "Voz",
    layer: "comando",
    visual: "voice",
    accent: "cmd",
    metric: "3 STT",
    card: "Briefing falado: push-to-talk no pane ativo, conversa contínua no cockpit.",
    title: "Voz — o caminho mais curto entre a ideia e a ordem dada",
    sub: "Aperta, fala, o time executa. E no modo contínuo você conversa com o cockpit inteiro sem tocar no teclado.",
    what: [
      "Briefing é a parte do trabalho em que digitar é o gargalo. Descrever um resultado em voz alta leva 8 segundos; escrever o mesmo parágrafo leva um minuto e sai pior, porque você resume pra economizar teclado.",
      "São dois modos. Push-to-talk: você segura a tecla, fala, solta — o texto entra no pane ativo e o agente começa. Contínuo: você conversa com o Núcleo, que abre missão, dispara combinação, checa status e responde falando.",
      "Transcrição pode rodar 100% local com whisper.cpp — custo zero por uso e nenhum áudio saindo da máquina — ou via Groq/endpoint compatível quando você quer velocidade. Fala em português e a ordem sai em inglês pro agente, se for isso que rende melhor no seu modelo.",
    ],
    steps: [
      { title: "Segure a tecla", body: "Space por padrão, configurável, nos modos Hold ou Toggle." },
      { title: "Dê a ordem", body: "\"Sobe o preview e manda o reviewer olhar o checkout.\"" },
      { title: "Solte", body: "O texto entra no pane e o trabalho começa antes de você terminar de pensar." },
    ],
    caps: [
      { label: "Push-to-talk", status: "live", body: "Hold ou Toggle, tecla configurável, direto no pane em foco." },
      { label: "STT local", status: "live", body: "whisper.cpp na sua máquina: zero custo por uso, zero áudio na nuvem." },
      { label: "Groq e compatíveis", status: "live", body: "whisper-large-v3 / turbo, ou qualquer endpoint OpenAI-compatible." },
      { label: "PT → EN", status: "live", body: "Você fala português, o agente recebe inglês. Auto, PT, EN ou ES." },
      { label: "Modos de intenção", status: "live", body: "Coding, planning ou conversa — muda como a transcrição é formatada." },
      { label: "Conversa contínua", status: "beta", body: "Operar o cockpit inteiro por voz, com resposta falada." },
    ],
    ide: "Autocompletar mais rápido enquanto você digita.",
    ade: "Não digitar. Descrever o resultado e ver o time se mexer.",
    related: ["nucleo", "cockpit", "combinacoes"],
  },

  /* ───────────────────────── 02 TIME ───────────────────────── */
  {
    slug: "zords",
    name: "Zords",
    layer: "time",
    visual: "skills",
    accent: "build",
    metric: "4 papéis",
    card: "Agentes são peças: CLI + modelo + skills + effort. Invocáveis por nome.",
    title: "Zords — seus agentes são peças, não chats",
    sub: "Cada zord é CLI + modelo + skills + effort. Invocável por nome, especializado por composição, descartável por design.",
    what: [
      "Um chat é uma conversa que você mantém. Um zord é uma peça que você encaixa. A diferença prática: zord tem composição declarada — qual CLI roda, qual modelo pensa, quais skills estão instaladas, qual effort ele gasta — e essa composição é o que faz dele um especialista, não o prompt que você escreveu no começo.",
      "Quatro papéis canônicos organizam o arsenal. Scout explora e não edita produção. Builder constrói e entrega. Reviewer só lê e reprova. Controller centraliza log e despacho. O papel define permissão, não só nome: um scout com permissão de escrita não é um scout.",
      "Os Originals vêm de fábrica com playbook interno e são re-semeados no boot — quando a gente melhora o builder, seu builder melhora também. Os seus zords customizados ficam intactos ao lado.",
    ],
    steps: [
      { title: "Abra o arsenal", body: "Catálogo lista todo zord instalado por CLI, com o harness de cada um." },
      { title: "Escolha ou componha", body: "Use um Original, clone e ajuste, ou instale do Mercado." },
      { title: "Invoque por nome", body: "O Núcleo chama \"builder-2\", abre o pane e cobra o handoff." },
    ],
    caps: [
      { label: "Composição declarada", status: "live", body: "CLI + modelo + skills + effort versionados como configuração, não prompt." },
      { label: "4 papéis canônicos", status: "live", body: "Scout, builder, reviewer, controller — com permissão amarrada ao papel." },
      { label: "Originals", status: "live", body: "Zords de fábrica com playbook interno e re-seed automático a cada boot." },
      { label: "Invocação on-demand", status: "live", body: "Nasce quando é chamado, morre 30s depois de entregar." },
      { label: "Isolamento por zord", status: "live", body: "Processo, sessão e credencial separados: um zord não vê o contexto do outro." },
      { label: "Auto-deploy de skill", status: "live", body: "Skills do papel entram no spawn, sem você configurar nada." },
    ],
    ide: "Um assistente, sempre o mesmo, sempre genérico.",
    ade: "Um arsenal de especialistas que você combina por tarefa.",
    related: ["harness", "skills", "combinacoes"],
  },
  {
    slug: "combinacoes",
    name: "Combinações",
    layer: "time",
    visual: "cockpit",
    accent: "build",
    metric: "5 prontas",
    card: "Times prontos por resultado: 1 briefing entra, 1 entregável sai.",
    title: "Combinações — times prontos que viram um entregável só",
    sub: "Cinco zords combinam numa entrega. Você escolhe pelo resultado, não pelos agentes.",
    what: [
      "Combinação é o time montado: quem entra, em que ordem, com quais gates, entregando o quê. Você não escolhe agentes — escolhe resultado. \"Quero um site publicado e revisado\" carrega uma formação de 1 Núcleo + 5 especialistas com dois gates humanos no caminho.",
      "É aqui que o ADE fica óbvio contra um IDE. Não existe \"abrir a combinação num arquivo\": você aponta o resultado, aprova o plano e acompanha 9 panes convergindo. O merge do trabalho paralelo não é problema seu porque a formação já nasce com contrato entre as peças.",
      "Formação é dado, não código: dá pra clonar, editar o roster, trocar o modelo de um papel, apertar um gate e salvar como sua. A sua formação vale exatamente o mesmo que as de fábrica.",
    ],
    steps: [
      { title: "Escolha pelo resultado", body: "Site, app, SaaS cobrando, automação instalada ou game jogável." },
      { title: "Dê um briefing", body: "Uma vez. O Núcleo transforma em plano, roster e gates." },
      { title: "Aprove nos checkpoints", body: "Você entra só onde a decisão é sua. O resto o time resolve." },
    ],
    caps: [
      { label: "5 formações de fábrica", status: "live", body: "Cinema Site, App Factory, SaaS 10K, Autopilot e Arcade." },
      { label: "Roster editável", status: "live", body: "Troque CLI, modelo e effort por papel dentro da formação." },
      { label: "Gates declarados", status: "live", body: "A formação já diz onde o humano é obrigatório." },
      { label: "Custo agregado", status: "live", body: "Token e R$ somados por formação, não só por pane." },
      { label: "Salvar como minha", status: "live", body: "Clone, ajuste e reutilize — ou publique no Mercado." },
      { label: "Formações da comunidade", status: "beta", body: "Instalar formação de terceiro com um clique." },
    ],
    ide: "Você monta o processo na cabeça, toda vez, do zero.",
    ade: "O processo é um objeto instalável que já vem com gate e contrato.",
    related: ["zords", "contratos", "gates"],
  },
  {
    slug: "skills",
    name: "Skills",
    layer: "time",
    visual: "skills",
    accent: "build",
    metric: "gate por missão",
    card: "Instrução instalável que vira especialidade — entra sozinha no zord certo.",
    title: "Skills — instrução instalável que vira especialidade",
    sub: "Um clique instala. Ela entra sozinha no zord do papel certo, com gate por missão e efeito imediato.",
    what: [
      "Skill é um bloco de instrução versionado que transforma um agente genérico em especialista sem tocar em código. \"Como a gente escreve migration nesse projeto\", \"o checklist de acessibilidade que a gente exige\", \"o tom de voz da marca\" — conhecimento que hoje mora na cabeça de alguém.",
      "Duas coisas fazem skill valer no ADE e não num IDE. Auto-deploy: a skill do papel entra no zord no momento do spawn, sem você lembrar de configurar. E gate por missão: você declara quais skills existem naquela missão e o resto fica inacessível — o reviewer não improvisa fora do checklist.",
      "Skill é conteúdo, então o time também escreve skill. Um scout que descobriu a convenção do repositório pode gravar isso como skill e o próximo builder já nasce sabendo.",
    ],
    steps: [
      { title: "Ache", body: "Catálogo local ou busca no Mercado, com filtro por papel e CLI." },
      { title: "Instale", body: "Um clique. Aparece no catálogo e já vale pra próxima missão." },
      { title: "Amarre à missão", body: "Declare a lista permitida; o gate barra o que ficou fora." },
    ],
    caps: [
      { label: "Auto-deploy por papel", status: "live", body: "A skill certa entra no zord certo no spawn, sem configuração manual." },
      { label: "Gate por missão", status: "live", body: "Lista branca de skills por missão, com enforcement no spawn." },
      { label: "Camada canônica", status: "live", body: "Uma skill base define comportamento comum a todo zord da casa." },
      { label: "Escrita por agente", status: "live", body: "O time grava skill nova a partir do que descobriu na missão." },
      { label: "Multi-CLI", status: "live", body: "A mesma skill vale em Claude, Codex e Antigravity." },
      { label: "Versionamento", status: "beta", body: "Diff e rollback de skill, com histórico de quem mudou o quê." },
    ],
    ide: "Um arquivo de regras que o assistente às vezes lê.",
    ade: "Instrução com deploy, escopo e enforcement — igual permissão.",
    related: ["zords", "mercado", "cortex"],
  },
  {
    slug: "harness",
    name: "Harness",
    layer: "time",
    visual: "harness",
    accent: "build",
    metric: "5 níveis de effort",
    card: "Tarefa certa, zord certo, modelo certo. O modelo não é o teto — o harness é.",
    title: "Harness — tarefa certa, zord certo, modelo certo",
    sub: "O mesmo modelo entrega resultados diferentes dependendo de como você o monta. A gente não joga prompt em modelo — monta o harness.",
    what: [
      "Harness é o pacote: agente + skills + CLI + modelo + effort, escolhido por tipo de tarefa e não fixado por agente. É a tese central do produto — o modelo não é o teto. Dois times com o mesmo modelo entregam qualidade diferente porque um montou o harness e o outro escreveu um prompt.",
      "Na prática isso é economia. Renomear variável em 40 arquivos não precisa do modelo de raciocínio mais caro do mercado; precisa do modelo rápido com effort baixo e uma skill de convenção. Decidir a arquitetura do billing precisa do contrário. Queimar token caro em task mecânica é o desperdício mais comum de quem trabalha com agentes.",
      "A resolução é determinística, com precedência declarada: roster da combinação vence argumento de invocação, que vence default do catálogo. Nada de \"às vezes ele escolhe o modelo bom\". Você sabe qual harness rodou porque o replay guarda.",
    ],
    steps: [
      { title: "Declare a tarefa", body: "O intake pergunta o tipo de trabalho; a receita já responde a maior parte." },
      { title: "O harness se monta", body: "Agente, modelo, effort e gates de skill entram resolvidos." },
      { title: "Ajuste o que importa", body: "No roster, cada papel aceita CLI, modelo e effort próprios." },
    ],
    caps: [
      { label: "Pacote por tipo de tarefa", status: "live", body: "Mecânica, exploratória, arquitetural e crítica têm harness diferente." },
      { label: "Precedência determinística", status: "live", body: "Roster > invocação > default de catálogo. Sem surpresa." },
      { label: "Effort por invocação", status: "live", body: "Mesmo zord roda barato numa task e caro na próxima." },
      { label: "Receitas", status: "live", body: "Formações de harness salvas que pré-preenchem o intake." },
      { label: "Gate de skill", status: "live", body: "O harness também define o que o zord não pode usar." },
      { label: "Auto-tuning por histórico", status: "wip", body: "Sugerir harness a partir do que rendeu melhor nas suas missões." },
    ],
    ide: "Escolher o modelo num dropdown e esperar o melhor.",
    ade: "Montar o harness por tarefa e saber por que aquele custo aconteceu.",
    related: ["zords", "providers", "medidor"],
  },
  {
    slug: "providers",
    name: "Providers",
    layer: "time",
    visual: "providers",
    accent: "scout",
    metric: "1 por pane",
    card: "Claude, Codex, Gemini, OpenRouter e locais — um provider por pane.",
    title: "Providers — Claude, Codex, Gemini e locais lado a lado",
    sub: "Um provider por pane, com modelo, effort e modo de permissão próprios. Nenhum lab é bom em tudo.",
    what: [
      "Nenhum modelo ganha em todas as tarefas, e o ranking muda todo mês. Então o ADE não aposta num lab: cada pane pode usar provider, modelo e modo de permissão distintos, na mesma missão, entregando pro mesmo contrato.",
      "Isso é o que permite o harness existir de verdade. O scout roda num modelo rápido e barato, dois builders rodam em labs diferentes pra você comparar output no mesmo briefing, o reviewer roda no modelo mais forte que você paga, e a task mecânica vai pro modelo local — custo zero por token.",
      "Conexão é por OAuth onde existe (sem colar chave), detecção automática de CLI no PATH, ou chave criptografada em repouso. Multi-conta com isolamento e proxy por conta, pra quem opera mais de uma assinatura sem misturar rate limit.",
    ],
    steps: [
      { title: "Conecte", body: "OAuth no Claude, CLI detectada no PATH, ou chave de API criptografada." },
      { title: "Atribua por pane", body: "Provider, modelo, effort e modo de permissão na criação do pane." },
      { title: "Compare no mesmo briefing", body: "Dois builders em labs diferentes, mesmo contrato, output lado a lado." },
    ],
    caps: [
      { label: "OAuth nativo", status: "live", body: "Sessão local do Claude sem chave manual; multi-conta com isolamento." },
      { label: "Detecção de CLI", status: "live", body: "Codex, Gemini e Antigravity encontrados no PATH, com modelos listados." },
      { label: "Agregadores", status: "live", body: "OpenRouter, Fireworks e afins: centenas de modelos por chave." },
      { label: "Modelos locais", status: "live", body: "Ollama, LM Studio e llama.cpp — token a custo zero, sem nuvem." },
      { label: "4 modos de permissão", status: "live", body: "Danger, Auto, Pend e Plan, por pane, não por app." },
      { label: "Chave criptografada", status: "live", body: "AES-256-GCM em repouso; nunca exibida depois de salva." },
    ],
    ide: "Um provider por instalação, escolhido nas configurações.",
    ade: "Um provider por agente, escolhido por tarefa.",
    related: ["harness", "medidor", "zords"],
  },
  {
    slug: "mercado",
    name: "Mercado",
    layer: "time",
    visual: "market",
    accent: "scout",
    metric: "1 clique",
    card: "Skills, zords e combinações da comunidade. Zero YAML, zero config de CLI.",
    title: "Mercado — arsenal a um clique",
    sub: "Skill, zord ou combinação inteira instalada de dentro do app. Sua próxima missão já usa.",
    what: [
      "Todo poder do ADE é dado instalável: skill é conteúdo, zord é composição, combinação é formação. Se são dados, podem ser distribuídos — e é isso que o Mercado faz, de dentro do app, sem terminal e sem editar YAML.",
      "Instalação é imediata e escopada: o item aparece no catálogo, respeita os gates da missão e já vale no próximo spawn. Nada de reiniciar app ou reconfigurar CLI. Itens de fábrica atualizam sozinhos; itens de terceiro pedem sua confirmação antes de subir de versão.",
      "Como quem publica é builder que entrega, o catálogo mostra o que importa pra decidir: downloads, CLIs compatíveis, papel de destino e o que exatamente o item injeta no agente.",
    ],
    steps: [
      { title: "Busque", body: "Filtro por tipo, papel e CLI compatível, com contador de instalações." },
      { title: "Instale", body: "Um clique. Sem YAML, sem terminal, sem reiniciar." },
      { title: "Use na próxima missão", body: "Já disponível pro Núcleo montar no harness." },
    ],
    caps: [
      { label: "Catálogo ao vivo", status: "live", body: "Busca com filtro de tipo e contador de downloads da comunidade." },
      { label: "Instalação 1 clique", status: "live", body: "Integração automática com a CLI de destino." },
      { label: "Painel de detalhe", status: "live", body: "O que o item injeta, em qual papel, com qual compatibilidade." },
      { label: "Update de fábrica", status: "live", body: "Itens nativos atualizam sozinhos; terceiros pedem confirmação." },
      { label: "Publicar", status: "beta", body: "Suba sua skill ou formação com versionamento e changelog." },
      { label: "Revenue share", status: "wip", body: "Item pago com repasse pro autor." },
    ],
    ide: "Extensões que mudam o seu editor.",
    ade: "Itens que mudam a capacidade do seu time.",
    related: ["skills", "combinacoes", "zords"],
  },

  /* ───────────────────────── 03 CONTEXTO ───────────────────────── */
  {
    slug: "cortex",
    name: "Córtex",
    layer: "contexto",
    visual: "memory",
    accent: "review",
    metric: "escopo workspace",
    card: "Memória compartilhada que sobrevive à sessão: um descobre, o time lembra.",
    title: "Córtex — um zord descobre, o time inteiro lembra",
    sub: "Memória compartilhada e persistente por workspace. Sobrevive ao fim da sessão e ao fechamento do app.",
    what: [
      "O custo escondido de trabalhar com muitos agentes é que cada um redescobre a mesma coisa. Três zords lendo o mesmo schema, quatro descobrindo que o build quebra sem a variável de ambiente, todos pagando token pela mesma descoberta — e amanhã tudo de novo, porque a sessão morreu.",
      "O Córtex é escrita e leitura de fato compartilhado no escopo do workspace. Um zord grava \"o deploy exige NODE_OPTIONS assim\" e qualquer agente, em qualquer missão futura, lê isso antes de investigar. O que um aprende, o time não esquece.",
      "É memória de fato, não histórico de conversa: entrada curta, atribuída a quem gravou, com timestamp e missão de origem. Dá pra revisar, corrigir e apagar — memória errada envenena o time todo, então ela é editável por você.",
    ],
    steps: [
      { title: "O time grava", body: "Durante a missão, o zord registra o que descobriu como fato reutilizável." },
      { title: "Feche o app", body: "A memória é do workspace, não da sessão. Nada se perde." },
      { title: "A próxima missão já sabe", body: "Qualquer zord lê antes de investigar, e economiza a descoberta." },
    ],
    caps: [
      { label: "Escopo de workspace", status: "live", body: "Compartilhada entre todos os zords e todas as missões do projeto." },
      { label: "Persistência real", status: "live", body: "Sobrevive ao fim da sessão e ao fechamento do app." },
      { label: "Fato atribuído", status: "live", body: "Quem gravou, quando e em qual missão." },
      { label: "Curadoria humana", status: "live", body: "Revise, corrija ou apague — memória errada contamina o time." },
      { label: "Leitura antes de investigar", status: "live", body: "Consulta ao Córtex entra no playbook padrão dos zords." },
      { label: "Promoção pra skill", status: "beta", body: "Fato recorrente virar skill instalável com um clique." },
    ],
    ide: "Contexto que morre quando você fecha a aba.",
    ade: "Conhecimento de time que acumula entre sessões.",
    related: ["skills", "contratos", "replay"],
  },
  {
    slug: "contratos",
    name: "Contratos",
    layer: "contexto",
    visual: "contract",
    accent: "review",
    metric: "0 merge hell",
    card: "Antes de codar, o time assina a interface. Trabalho paralelo que dá merge.",
    title: "Contratos — paralelismo que dá merge",
    sub: "Backend e frontend nascem compatíveis porque assinaram a interface antes de escrever a primeira linha.",
    what: [
      "Todo mundo que tentou rodar cinco agentes em paralelo bateu na mesma parede: eles entregam rápido e o trabalho não encaixa. O frontend chamou /api/users esperando um array; o backend devolveu um objeto paginado. Duas entregas corretas, uma integração quebrada, e o tempo que você economizou volta como merge hell.",
      "Contrato resolve isso invertendo a ordem. Antes de qualquer builder escrever código, o time fecha a interface — endpoint, shape de payload, nome de evento, assinatura de componente, contrato de erro. Isso vira um artefato versionado que os zords leem, e é ele que o Núcleo usa pra aceitar ou recusar handoff.",
      "É por isso que o Núcleo pode recusar entrega sem te consultar: existe um critério objetivo. Handoff que viola o contrato volta pro zord com o diff da violação. O paralelismo só é ganho real quando o merge é garantido antes, não negociado depois.",
    ],
    steps: [
      { title: "O time propõe", body: "Scout e builders fecham a interface antes de codar, e você aprova num gate." },
      { title: "Todos codam contra ela", body: "Cada zord lê o contrato no spawn. Ninguém inventa shape de payload." },
      { title: "O handoff é conferido", body: "Entrega fora do contrato volta com o diff, sem passar por você." },
    ],
    caps: [
      { label: "Contrato antes do código", status: "live", body: "Fase de interface obrigatória nas formações de trabalho paralelo." },
      { label: "Validação no handoff", status: "live", body: "O Núcleo confere a entrega contra o contrato e recusa desvio." },
      { label: "Versionado no repo", status: "live", body: "Contrato é artefato, entra no diff e no code review." },
      { label: "Mudança pede gate", status: "live", body: "Alterar contrato no meio da missão exige aprovação humana." },
      { label: "Mock automático", status: "beta", body: "Frontend trabalha contra mock derivado do contrato antes do backend existir." },
      { label: "Teste de conformidade", status: "wip", body: "Suite gerada do contrato rodando nos dois lados." },
    ],
    ide: "Você descobre a incompatibilidade no merge.",
    ade: "A incompatibilidade não acontece porque a interface veio primeiro.",
    related: ["combinacoes", "gates", "nucleo"],
  },
  {
    slug: "workspace",
    name: "Workspace",
    layer: "contexto",
    visual: "workspace",
    accent: "review",
    metric: "1 cockpit",
    card: "Arquivos, editor, browser e worktrees no mesmo chão do cockpit.",
    title: "Workspace — arquivos, editor e browser no mesmo chão",
    sub: "Worktree por missão, preview ao vivo e sessão que retoma de onde parou. Um comando abre tudo.",
    what: [
      "O workspace é o chão do cockpit — e a parte mais parecida com um IDE, de propósito. Você precisa abrir arquivo, ler diff, olhar o preview. A diferença é o peso: aqui isso é ferramenta de conferência, não o lugar onde o trabalho acontece.",
      "Cada projeto vive numa aba com seus panes, missões, árvore de arquivos e sessões. Link de arquivo no terminal abre no viewer; localhost sobe num pane de browser ao lado de quem está mexendo nele. E cada missão tem worktree próprio, então você compara o que dois times fizeram do mesmo briefing sem trocar de branch.",
      "Retomar é um clique. O workspace vazio mostra as sessões anteriores com o que estava rodando; você reabre com histórico e grade intactos. `mz .` no terminal e você está de volta no cockpit do diretório atual.",
    ],
    steps: [
      { title: "Entre pelo terminal", body: "`cd` no projeto e `mz .` abre o cockpit já no diretório." },
      { title: "Trabalhe com tudo à vista", body: "Árvore, editor, preview de localhost e panes na mesma tela." },
      { title: "Retome depois", body: "O picker de sessão traz missão, panes e histórico de volta." },
    ],
    caps: [
      { label: "Aba por projeto", status: "live", body: "Um projeto por aba, com drag-out pra virar janela separada." },
      { label: "Árvore de arquivos", status: "live", body: "Carregada por demanda, com filtro de ruído e link do terminal." },
      { label: "Editor multi-aba", status: "beta", body: "Preview de markdown e salvamento; sem LSP e sem syntax highlight ainda." },
      { label: "Worktree por missão", status: "live", body: "Compare duas execuções do mesmo briefing sem trocar de branch." },
      { label: "Pane de browser", status: "live", body: "Preview do localhost do lado do agente que está mexendo nele." },
      { label: "CLI launcher", status: "live", body: "`mz .` e \"Abrir com Megazord\" no explorador do sistema." },
    ],
    ide: "É o produto inteiro.",
    ade: "É uma superfície de conferência entre 17 outras.",
    related: ["missoes", "cockpit", "midia"],
  },
  {
    slug: "midia",
    name: "Mídia",
    layer: "contexto",
    visual: "media",
    accent: "review",
    metric: "img · vídeo · áudio",
    card: "Imagem, vídeo e áudio como output de primeira classe, dentro do cockpit.",
    title: "Mídia — entrega não é só código",
    sub: "Imagem, vídeo e áudio gerados e revisados no mesmo cockpit, pela mesma combinação.",
    what: [
      "Site publicado precisa de imagem. Game jogável precisa de sprite e som. Prova de que a automação funcionou é um vídeo. Se o ADE existe pra entregar resultado e não código, gerar asset tem que ser parte do time — não uma aba de outro produto e um arquivo que você arrasta na mão.",
      "Então geração de mídia é MCP tool nativa: o zord de arte gera seis imagens em paralelo a partir da referência que o scout extraiu do site que você admira, o zord de QA grava o fluxo e devolve os frames como prova, e o reviewer olha tudo antes do gate.",
      "Providers são declarados por formação, com allowlist: uma combinação de site tem imagem liberada e vídeo bloqueado, e nenhum zord estoura sua conta gerando o que não foi pedido. Chave criptografada em repouso, custo de mídia contando no mesmo medidor do token.",
    ],
    steps: [
      { title: "Configure os providers", body: "Chave criptografada em Ajustes, com modelo padrão por tipo de mídia." },
      { title: "Rode uma combinação criativa", body: "A formação já declara o que cada papel pode gerar." },
      { title: "Receba no workspace", body: "Arquivo cai no projeto, revisado no gate antes de entrar na entrega." },
    ],
    caps: [
      { label: "Imagem", status: "live", body: "Texto pra imagem e img2img com preservação de referência." },
      { label: "Vídeo", status: "live", body: "Animação por interpolação de keyframe, com prova de fluxo." },
      { label: "Áudio", status: "live", body: "Voz e efeito a partir de prompt, com modelo por provider." },
      { label: "Allowlist por formação", status: "live", body: "A combinação declara qual papel pode gerar o quê." },
      { label: "Custo no mesmo medidor", status: "live", body: "Mídia entra no teto de gasto da missão junto com token." },
      { label: "Captura pro agente", status: "beta", body: "Screenshot e gravação viram frames analisáveis pelo zord." },
    ],
    ide: "Nada. Você abre outro app.",
    ade: "Asset é entregável, então tem agente, gate e custo próprios.",
    related: ["combinacoes", "control-plane", "medidor"],
  },
  {
    slug: "control-plane",
    name: "Control plane",
    layer: "contexto",
    visual: "api",
    accent: "scout",
    metric: "52 tools",
    card: "O cockpit é uma API que o agente opera: spawn, delegate, handoff, gate, cron.",
    title: "Control plane — o cockpit é uma API que o agente opera",
    sub: "52 ferramentas nativas de MCP. O Núcleo abre pane, delega, cobra handoff e agenda missão — você não instala nada.",
    what: [
      "Essa é a superfície que faz o ADE ser um ambiente e não uma interface bonita: tudo que você pode fazer no cockpit, o agente também pode, pelas mesmas 52 ferramentas. Abrir pane, escrever nele, ler saída, invocar zord, submeter handoff, criar missão, mover task, gravar memória, gerar mídia, agendar cron, tirar screenshot do próprio app.",
      "Servidor de MCP embutido, ferramentas expostas como `mcp__mz__*`, configuração injetada no spawn de cada agente. Não tem instalação, não tem YAML, não tem \"conecta o servidor primeiro\". O zord nasce com o cockpit nas mãos.",
      "É o que permite o produto se dobrar sobre si mesmo. Um zord pode montar uma combinação nova, rodar, medir o custo e ajustar o harness — porque o ambiente inteiro é programável de dentro.",
    ],
    steps: [
      { title: "Abra um pane", body: "O agente nasce com as ferramentas do cockpit já configuradas." },
      { title: "Peça trabalho de time", body: "Ele usa spawn e delegate; você vê a grade crescer sozinha." },
      { title: "Acompanhe o protocolo", body: "Handoff, gate e task aparecem como eventos, não como texto." },
    ],
    caps: [
      { label: "Panes", status: "live", body: "`pane_spawn`, `pane_write`, `pane_read`, `pane_kill` — a grade é programável." },
      { label: "Handoff", status: "live", body: "`handoff_submit`, `handoff_list`: entrega estruturada e conferível." },
      { label: "Missões e tasks", status: "live", body: "`mission_create`, `task_set_status` — placar movido por quem trabalha." },
      { label: "Time", status: "live", body: "`agent_invoke`, `squad_spawn`, `contract_read`." },
      { label: "Memória e mídia", status: "live", body: "`memory_write/read`, `image_generate`, `video_generate`, `audio_generate`." },
      { label: "Cron e diagnóstico", status: "live", body: "`cron_create`, `app_status`, `app_screenshot` — o app se inspeciona." },
    ],
    ide: "Uma API de extensão pra você programar.",
    ade: "Uma API de operação pro agente programar.",
    related: ["nucleo", "gates", "missoes"],
  },

  /* ───────────────────────── 04 CONTROLE ───────────────────────── */
  {
    slug: "gates",
    name: "Gates",
    layer: "controle",
    visual: "gate",
    accent: "ctrl",
    metric: "2–3 por missão",
    card: "Handoff estruturado + checkpoint humano. Autonomia com freio de mão.",
    title: "Gates — autonomia com freio de mão",
    sub: "O time entrega em handoff estruturado e para nos pontos que são decisão sua. Não nos outros.",
    what: [
      "Autonomia total é irresponsável e aprovação em tudo é inútil — vira você digitando \"sim\" trinta vezes. Gate é onde essa linha fica declarada: a formação já diz quais são os dois ou três momentos em que o humano é obrigatório.",
      "Antes do gate vem o handoff, que é entrega estruturada e não \"pronto, terminei\". O zord submete o que fez, contra qual contrato, quais arquivos tocou, o que testou e o que não testou. O Núcleo confere contra o contrato e recusa sozinho o que está fora — você só vê o que passou na peneira.",
      "Gate típico de uma formação de SaaS: aprovar o contrato de interface, aprovar o schema de cobrança, aprovar o deploy. Arquitetura e dinheiro são seus. Nomear variável não é.",
    ],
    steps: [
      { title: "A formação declara", body: "Os gates vêm na combinação; você aperta ou solta antes de rodar." },
      { title: "O time entrega estruturado", body: "Handoff com escopo, arquivos, contrato e o que ficou sem teste." },
      { title: "Você decide no ponto certo", body: "Aprovar, pedir revisão com motivo, ou matar a linha inteira." },
    ],
    caps: [
      { label: "Handoff estruturado", status: "live", body: "Entrega com escopo, diff, contrato de referência e lacunas declaradas." },
      { label: "Recusa automática", status: "live", body: "Fora do contrato volta pro zord sem ocupar seu tempo." },
      { label: "Gate declarado", status: "live", body: "A formação diz onde o humano é obrigatório; você ajusta." },
      { label: "Revisão com motivo", status: "live", body: "Reprovar devolve o motivo como contexto, não como novo briefing." },
      { label: "Kill switch", status: "live", body: "Mate um pane, um ramo do plano ou a missão inteira, na hora." },
      { label: "Aprovação remota", status: "beta", body: "Aprovar gate pelo celular quando a missão roda de madrugada." },
    ],
    ide: "Você aprova cada linha, porque cada linha é sua.",
    ade: "Você aprova as três decisões que importam, e o time resolve as trezentas restantes.",
    related: ["nucleo", "contratos", "replay"],
  },
  {
    slug: "medidor",
    name: "Medidor",
    layer: "controle",
    visual: "meter",
    accent: "ctrl",
    metric: "R$ ao vivo",
    card: "Token, custo e rate limit em tempo real, com teto de gasto por missão.",
    title: "Medidor — token, custo e rate limit em tempo real",
    sub: "Custo por pane, por missão e por formação enquanto acontece. Com teto de gasto e alerta de limite.",
    what: [
      "Rodar dez agentes em paralelo é a coisa mais fácil de fazer caro sem perceber. A fatura chega no fim do mês e você não sabe qual missão comeu o orçamento, nem qual papel desperdiçou modelo caro em task mecânica.",
      "O medidor mostra isso enquanto acontece: token de entrada e saída por pane, custo acumulado em R$ por missão, e o consolidado por formação — dá pra comparar duas execuções do mesmo briefing com harness diferente e ver a economia em número.",
      "E ele freia. Teto de gasto por missão: ao bater, o time para e pede autorização em vez de continuar. Rate limit das suas assinaturas fica visível com janela de reset, porque descobrir que estourou o limite no meio de uma missão de madrugada é o pior jeito de descobrir.",
    ],
    steps: [
      { title: "Defina o teto", body: "Limite em R$ por missão no wizard; o time respeita e pede autorização ao bater." },
      { title: "Acompanhe ao vivo", body: "Custo por pane no cockpit e agregado por formação no rodapé." },
      { title: "Compare depois", body: "Duas execuções, dois harness, a diferença de custo em número." },
    ],
    caps: [
      { label: "Custo por pane", status: "live", body: "Token in/out e R$ acumulado por agente, atualizado por turno." },
      { label: "Agregado por missão", status: "live", body: "Consolidado por formação e por papel, não só por pane." },
      { label: "Teto de gasto", status: "live", body: "Missão para e pede autorização ao atingir o limite definido." },
      { label: "Rate limit das assinaturas", status: "live", body: "Consumo e janela de reset por conta, sem exibir credencial." },
      { label: "Alerta de limite", status: "live", body: "Aviso antes de estourar, com sugestão de trocar o provider do pane." },
      { label: "Retrospecto", status: "beta", body: "Histórico de consumo por semana, projeto e formação." },
    ],
    ide: "Você descobre o custo na fatura.",
    ade: "Você vê o custo subir e pode parar.",
    related: ["harness", "providers", "replay"],
  },
  {
    slug: "replay",
    name: "Replay",
    layer: "controle",
    visual: "timeline",
    accent: "ctrl",
    metric: "timeline auditável",
    card: "A missão inteira reproduzível: quem decidiu o quê, com qual harness, a que custo.",
    title: "Replay — a missão inteira, reproduzível",
    sub: "Timeline auditável de cada delegação, handoff, gate e custo. Pra entender, corrigir e rodar de novo melhor.",
    what: [
      "Quando dez agentes trabalham em paralelo, \"por que ficou assim?\" fica difícil de responder. O replay guarda a missão como sequência de eventos: qual briefing entrou, qual plano o Núcleo montou, qual zord recebeu o quê com qual harness, o que cada um entregou, o que foi recusado e por quê, onde você aprovou, quanto custou cada passo.",
      "Serve pra três coisas. Entender o resultado sem reconstituir na memória. Auditar — em time de verdade alguém vai perguntar quem autorizou aquele deploy. E melhorar: o mesmo briefing rodado com o harness ajustado, comparado lado a lado com a execução anterior.",
      "É também o antídoto ao maior medo de quem delega pra IA: perder o fio. Nada aqui é caixa-preta. A decisão de cada peça está gravada, com o prompt exato e o custo exato.",
    ],
    steps: [
      { title: "Rode a missão", body: "O replay é gravado por padrão, sem você ligar nada." },
      { title: "Percorra a timeline", body: "Delegação, handoff, recusa, gate e custo, em ordem, com o prompt exato." },
      { title: "Rode de novo melhor", body: "Reexecute o briefing com harness ajustado e compare as duas execuções." },
    ],
    caps: [
      { label: "Timeline de eventos", status: "live", body: "Plano, delegação, handoff, recusa, gate e custo em ordem cronológica." },
      { label: "Prompt exato", status: "live", body: "O que cada zord recebeu, com harness e effort resolvidos." },
      { label: "Trilha de aprovação", status: "live", body: "Quem aprovou qual gate, quando, com qual justificativa." },
      { label: "Custo por passo", status: "live", body: "Onde o token foi gasto dentro da missão, não só no total." },
      { label: "Re-run comparativo", status: "beta", body: "Mesmo briefing, harness diferente, diff de resultado e custo." },
      { label: "Exportar", status: "wip", body: "Relatório da missão pra fora do app, pra time e cliente." },
    ],
    ide: "O histórico é o git log — o que sobrou depois do processo.",
    ade: "O histórico é o processo inteiro, incluindo o que foi recusado.",
    related: ["gates", "medidor", "cortex"],
  },
];

export const surfaceBySlug = (slug: string) => SURFACES.find((s) => s.slug === slug);

export const surfacesByLayer = (layer: LayerId) => SURFACES.filter((s) => s.layer === layer);

export const STATUS_LABEL: Record<Status, string> = {
  live: "no ar",
  beta: "beta",
  wip: "em obra",
};
