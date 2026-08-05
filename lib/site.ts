export const SITE = {
  name: "Megazord Terminal",
  short: "Megazord",
  cli: "mz",
  version: "0.1.0",
  tagline: "O ADE — Agentic Development Environment",
  promise:
    "Num IDE você escreve código com ajuda de IA. Num ADE você comanda um time de IAs que escreve, testa e entrega.",
  surfaceCount: 18,
  toolCount: 52,
  maxPanes: 12,
};

export const NAV = [
  { href: "/manifesto", label: "Manifesto" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/features", label: "Superfícies" },
  { href: "/combinacoes", label: "Combinações" },
  { href: "/ide-vs-ade", label: "IDE vs ADE" },
];

/* ─────────────── modos de missão ─────────────── */
export const MODES = [
  {
    id: "livre",
    name: "Livre",
    lead: "Você comanda",
    body: "Você abre os panes na mão, escolhe provider por agente e conduz. Pra explorar, prototipar e testar ideia.",
    accent: "scout" as const,
  },
  {
    id: "combinacao",
    name: "Combinação",
    lead: "O Núcleo comanda",
    body: "O orquestrador abre, monta o roster, delega e consolida. Pra entregar resultado repetível: site, app, SaaS, automação.",
    accent: "cmd" as const,
  },
  {
    id: "agentico",
    name: "Agêntico",
    lead: "Um piloto decompõe",
    body: "O piloto quebra a missão em fases, invoca chefes de área e re-planeja entre elas. Pra missão longa e autônoma.",
    accent: "review" as const,
  },
];

/* ─────────────── combinações (times prontos) ─────────────── */
export interface Formation {
  slug: string;
  name: string;
  outcome: string;
  brief: string;
  roster: { role: string; accent: "cmd" | "scout" | "build" | "review" | "ctrl"; job: string }[];
  panes: string;
  gates: string[];
  delivers: string[];
  accent: "cmd" | "scout" | "build" | "review" | "ctrl";
}

export const FORMATIONS: Formation[] = [
  {
    slug: "vitrine",
    name: "Vitrine",
    outcome: "Site de produto publicado e revisado",
    brief: "\"Landing de produto premium, referência nesse site aqui, copy em PT-BR, publicado.\"",
    accent: "cmd",
    panes: "9 panes no pico",
    roster: [
      { role: "Núcleo", accent: "cmd", job: "lê o briefing, monta o time, consolida" },
      { role: "Scout de referência", accent: "scout", job: "extrai grid, tipografia e paleta do site-referência" },
      { role: "Contrato", accent: "review", job: "fecha estrutura de seções e props de componente" },
      { role: "Builder ×2", accent: "build", job: "seções em paralelo contra o contrato" },
      { role: "Zord de arte", accent: "review", job: "6 imagens em paralelo no estilo extraído" },
      { role: "Reviewer", accent: "ctrl", job: "acessibilidade, responsivo, Lighthouse, copy" },
    ],
    gates: ["Aprovar direção visual + contrato de seções", "Aprovar antes do deploy"],
    delivers: ["Site no ar", "Assets gerados", "Relatório de review", "Replay da missão"],
  },
  {
    slug: "fabrica",
    name: "Fábrica",
    outcome: "Web app funcionando com dados de verdade",
    brief: "\"App de agenda visual, login, CRUD, dados reais, deploy em preview.\"",
    accent: "build",
    panes: "8+ panes",
    roster: [
      { role: "Núcleo", accent: "cmd", job: "plano de fases e cobrança de handoff" },
      { role: "Scout de repo", accent: "scout", job: "mapeia stack, convenções e o que já existe" },
      { role: "Contrato", accent: "review", job: "schema, endpoints e shape de payload assinados" },
      { role: "Builder back", accent: "build", job: "API e migrations contra o contrato" },
      { role: "Builder front", accent: "build", job: "telas contra o mesmo contrato, em paralelo" },
      { role: "QA", accent: "ctrl", job: "roda o fluxo, grava a prova, reprova o que falha" },
    ],
    gates: ["Aprovar contrato de API + schema", "Aprovar migration", "Aprovar deploy"],
    delivers: ["App em preview", "Migrations aplicadas", "Prova de fluxo em vídeo", "Replay da missão"],
  },
  {
    slug: "caixa",
    name: "Caixa",
    outcome: "SaaS publicado, cobrando, com revisão de segurança",
    brief: "\"SaaS de validação de e-mail com plano mensal, checkout e painel.\"",
    accent: "ctrl",
    panes: "11 panes",
    roster: [
      { role: "Núcleo", accent: "cmd", job: "coordena as três frentes e os gates de dinheiro" },
      { role: "Scout de mercado", accent: "scout", job: "levanta pricing e requisitos de compliance" },
      { role: "Contrato", accent: "review", job: "modelo de assinatura, webhooks e estados de cobrança" },
      { role: "Builder produto ×2", accent: "build", job: "core do serviço e painel" },
      { role: "Builder billing", accent: "build", job: "checkout, webhook e ciclo de vida do plano" },
      { role: "Reviewer de segurança", accent: "ctrl", job: "authz, segredo, rate limit, dados sensíveis" },
    ],
    gates: ["Aprovar modelo de cobrança", "Aprovar review de segurança", "Aprovar go-live"],
    delivers: ["SaaS no ar cobrando", "Relatório de segurança", "Runbook de operação", "Replay da missão"],
  },
  {
    slug: "piloto-automatico",
    name: "Piloto Automático",
    outcome: "Automação instalada, agendada e testada",
    brief: "\"Todo dia 7h, puxa a cotação, atualiza a planilha e me avisa se falhar.\"",
    accent: "scout",
    panes: "N+1 panes",
    roster: [
      { role: "Núcleo", accent: "cmd", job: "decompõe em passos e define o alerta de falha" },
      { role: "Scout de integração", accent: "scout", job: "descobre API, limite e formato de dado" },
      { role: "Builder", accent: "build", job: "escreve, instala e agenda a rotina" },
      { role: "QA de rotina", accent: "ctrl", job: "roda seco, simula falha, valida o alerta" },
    ],
    gates: ["Aprovar acesso a credencial", "Aprovar antes de instalar o cron", "Aprovar teste de falha"],
    delivers: ["Rotina agendada rodando", "Teste de falha passando", "Alerta configurado", "Replay da missão"],
  },
  {
    slug: "arena",
    name: "Arena",
    outcome: "Game web jogável com prova em vídeo",
    brief: "\"Jogo de nave em canvas, 3 fases, som, jogável no navegador.\"",
    accent: "review",
    panes: "7 panes",
    roster: [
      { role: "Núcleo", accent: "cmd", job: "fecha escopo jogável e ordena as fases" },
      { role: "Builder de engine", accent: "build", job: "loop, colisão e estado" },
      { role: "Zord de asset", accent: "review", job: "sprites e trilha gerados no cockpit" },
      { role: "QA jogador", accent: "ctrl", job: "joga de verdade e grava o vídeo da sessão" },
    ],
    gates: ["Aprovar escopo jogável", "Aprovar direção de arte", "Aprovar build final"],
    delivers: ["Game publicado", "Vídeo da sessão jogada", "Assets do jogo", "Replay da missão"],
  },
];

/* ─────────────── manifesto ─────────────── */
export const THESES = [
  {
    n: "01",
    title: "O modelo não é o teto. O harness é.",
    body: "O mesmo modelo entrega resultado diferente dependendo de como você o monta: agente, skills, CLI, effort, escopo. Quem troca de modelo esperando salto de qualidade está otimizando a variável errada. A gente não joga prompt em modelo — monta o harness.",
  },
  {
    n: "02",
    title: "Orquestrador com shell vira gargalo.",
    body: "Se o coordenador pode executar, ele vai executar — \"resolvo rapidinho\" — e aí você tem o modelo mais caro do time fazendo task mecânica e perdendo a visão do conjunto. O Núcleo não tem editor nem shell. Não é disciplina, é arquitetura.",
  },
  {
    n: "03",
    title: "Paralelismo sem contrato é merge hell.",
    body: "Cinco agentes entregando rápido e nada encaixando é mais lento que um agente sozinho. O ganho do paralelo só é real quando a interface é fechada antes da primeira linha de código. Contrato primeiro, código depois.",
  },
  {
    n: "04",
    title: "Custo é feature, não fatura.",
    body: "Token gasto tem que aparecer na hora, por agente, com teto que freia. Descobrir o custo no fim do mês não é informação, é susto. Quem não mede desperdício paga modelo de raciocínio pra renomear variável.",
  },
  {
    n: "05",
    title: "Benchmark de lab não paga sua conta.",
    body: "Score em prova pública mede prova pública. O que importa é bench maxing: rodar o seu prompt real, na sua stack, medindo entrega, custo e tempo. O melhor modelo é o que ganha na sua operação — e ele muda de mês.",
  },
  {
    n: "06",
    title: "Autonomia sem gate é irresponsabilidade. Gate em tudo é inútil.",
    body: "Aprovar trezentas decisões é o mesmo que não aprovar nenhuma: você vira um clicador de \"sim\". Duas ou três decisões por missão são realmente suas — arquitetura, dinheiro, deploy. O resto é trabalho do time.",
  },
  {
    n: "07",
    title: "Se você abriu um arquivo, algo falhou.",
    body: "Abrir arquivo pra conferir é normal. Abrir arquivo pra corrigir na mão é sintoma: faltou skill, faltou contrato ou faltou gate. O editor existe no Megazord como ferramenta de conferência — não como o lugar onde o trabalho acontece.",
  },
];

/* ─────────────── IDE vs ADE ─────────────── */
export const APPROACHES = [
  { id: "ade", name: "ADE (Megazord)", note: "time coordenado" },
  { id: "single", name: "1 agente direto", note: "IDE com copilot" },
  { id: "manual", name: "Copiar e colar", note: "N janelas na mão" },
];

export const CRITERIA = [
  {
    label: "Coordenação",
    ade: "O Núcleo distribui, cobra handoff e consolida. Recusa entrega fora do contrato sem te consultar.",
    single: "Existe uma fila: uma tarefa por vez, na ordem que o agente decidir.",
    manual: "Você é o barramento. Cada troca de contexto passa pelo seu ctrl+C.",
  },
  {
    label: "Visibilidade",
    ade: "Grade de panes ao vivo, status por agente, placar de tasks e replay auditável.",
    single: "Um log de conversa. O que aconteceu é o que você lembra de ter lido.",
    manual: "N conversas espalhadas, nenhuma visão de conjunto.",
  },
  {
    label: "Custo",
    ade: "Token e R$ por pane, por missão e por formação, ao vivo, com teto que freia.",
    single: "Um modelo pra tudo: você paga preço de raciocínio em task mecânica.",
    manual: "Aparece na fatura, sem saber qual janela consumiu.",
  },
  {
    label: "Velocidade",
    ade: "Trabalho realmente paralelo, e com contrato o merge não come o ganho.",
    single: "Serial por definição. Rápido no pequeno, teto baixo no grande.",
    manual: "Paralelo no papel; o gargalo virou você.",
  },
  {
    label: "Escala",
    ade: "Adicionar capacidade é adicionar zord ao roster. A formação é reutilizável.",
    single: "Escala com o tamanho do contexto — e degrada junto.",
    manual: "Escala com a sua paciência.",
  },
];

export const WHEN_NOT = [
  "Correção de uma linha que você já sabe fazer. Abrir o cockpit pra isso é overhead.",
  "Exploração puramente pessoal, sem entregável — o modo Livre resolve, sem combinação.",
  "Código que você precisa entender linha por linha pra aprender. Delegar aqui é atalho errado.",
  "Base sem nenhum teste e sem convenção escrita: monte contrato e skill primeiro, depois escale o time.",
];

export const FAQ = [
  {
    q: "ADE não é só um nome bonito pra IDE com mais IA?",
    a: "A diferença é o que fica no centro da tela. Num IDE, o arquivo — a IA é um assistente na lateral. Num ADE, o time — e o editor é uma das 18 superfícies, usada pra conferir. Se o seu ambiente não sabe abrir dez agentes, cobrar handoff estruturado e te mostrar o custo de cada um ao vivo, ele é um IDE com copilot. O que é ótimo, e é outra categoria.",
  },
  {
    q: "Vou perder o controle do que entra no meu código?",
    a: "O oposto do que costuma acontecer com agente solto. Gate declarado nos pontos que importam, handoff estruturado com o que foi e o que não foi testado, contrato que o Núcleo confere, worktree isolado por missão e replay com o prompt exato de cada decisão. Você aprova menos vezes e sabe muito mais.",
  },
  {
    q: "E se eu já pago Claude, Codex e Gemini?",
    a: "Melhor cenário. O Megazord usa as suas assinaturas: OAuth onde existe, CLI detectada no PATH, chave criptografada quando necessário. Um provider por pane, e o Medidor mostra o rate limit de cada conta com a janela de reset.",
  },
  {
    q: "Dez agentes em paralelo não fica caro?",
    a: "Fica caro sem harness. Com harness, o scout roda em modelo rápido, a task mecânica vai pro modelo local a custo zero e só o reviewer usa o modelo forte. Some teto de gasto por missão e custo por pane ao vivo, e o paralelo normalmente sai mais barato que um modelo caro fazendo tudo, serialmente, com retrabalho.",
  },
  {
    q: "Preciso escrever YAML pra montar um time?",
    a: "Não. Combinação, zord e skill são dados instaláveis: um clique no Mercado, e o roster é editável na interface. Se você quiser versionar a formação no repo, dá — mas não é requisito pra começar.",
  },
];
