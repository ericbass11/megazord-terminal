import type { Visual } from "@/lib/surfaces";
import { ACCENT, type Accent } from "./ui";

function Frame({
  children,
  label,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className="scanline relative border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line bg-panel2 px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-line2" />
        <p className="font-mono text-[10px] tracking-[0.16em] text-dim uppercase">{label}</p>
      </div>
      <div className={`p-4 ${className}`}>{children}</div>
    </div>
  );
}

const Row = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`flex items-center gap-2 ${className}`}>{children}</div>;

const Chip = ({
  children,
  accent,
  dim = false,
}: {
  children: React.ReactNode;
  accent?: Accent;
  dim?: boolean;
}) => (
  <span
    className={`border px-2 py-1 font-mono text-[10px] whitespace-nowrap ${
      accent && !dim
        ? `${ACCENT[accent].border} ${ACCENT[accent].bg} ${ACCENT[accent].text}`
        : "border-line2 text-dim"
    }`}
  >
    {children}
  </span>
);

const Bar = ({ w, accent }: { w: number; accent: Accent }) => (
  <span className="block h-1 w-full bg-line">
    <span className={`block h-1 ${ACCENT[accent].bgSolid}`} style={{ width: `${w}%` }} />
  </span>
);

/* ────────────────────────── visuals ────────────────────────── */

function Cockpit({ accent }: { accent: Accent }) {
  const panes: { n: string; a: Accent; w: number }[] = [
    { n: "núcleo", a: "cmd", w: 30 },
    { n: "scout", a: "scout", w: 100 },
    { n: "contrato", a: "review", w: 100 },
    { n: "builder-1", a: "build", w: 62 },
    { n: "builder-2", a: "build", w: 48 },
    { n: "reviewer", a: "ctrl", w: 12 },
  ];
  return (
    <Frame label="grade de panes · missão ativa">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {panes.map((p) => (
          <div key={p.n} className="border border-line bg-panel2 p-2.5">
            <Row>
              <span className={`h-1.5 w-1.5 rounded-full ${ACCENT[p.a].bgSolid} dot-live`} />
              <span className={`font-mono text-[10px] ${ACCENT[p.a].text}`}>{p.n}</span>
            </Row>
            <div className="mt-2.5">
              <Bar w={p.w} accent={p.a} />
            </div>
            <p className="mt-2 font-mono text-[9px] text-dim">{p.w}% · R$ {(p.w / 100).toFixed(2)}</p>
          </div>
        ))}
      </div>
      <p className={`mt-3 font-mono text-[10px] ${ACCENT[accent].text}`}>
        6 agentes · 3 providers · custo somando ao vivo
      </p>
    </Frame>
  );
}

function Delegation() {
  return (
    <Frame label="delegação com gate">
      <div className="flex flex-col items-center">
        <div className="border border-cmd/40 bg-cmd/10 px-3 py-2 text-center">
          <p className="font-mono text-[11px] text-cmd">núcleo</p>
          <p className="mt-0.5 font-mono text-[9px] text-dim">sem shell · sem editor</p>
        </div>
        <svg viewBox="0 0 240 44" className="h-11 w-full max-w-[260px]">
          <g stroke="var(--color-line2)" fill="none" strokeWidth="1">
            <path d="M120 0 V14 H40 V44" className="flow-line" />
            <path d="M120 0 V14 H120 V44" className="flow-line" />
            <path d="M120 0 V14 H200 V44" className="flow-line" />
          </g>
        </svg>
        <div className="grid w-full grid-cols-3 gap-2">
          {(
            [
              ["scout", "scout"],
              ["builder", "build"],
              ["reviewer", "ctrl"],
            ] as [string, Accent][]
          ).map(([n, a]) => (
            <div key={n} className={`border ${ACCENT[a].border} ${ACCENT[a].bg} px-2 py-2 text-center`}>
              <p className={`font-mono text-[10px] ${ACCENT[a].text}`}>{n}</p>
              <p className="mt-0.5 font-mono text-[9px] text-dim">executa</p>
            </div>
          ))}
        </div>
        <div className="mt-3 w-full border-t border-dashed border-line2 pt-2.5">
          <Row className="justify-center">
            <Chip accent="ctrl">handoff ↑ acorda o núcleo</Chip>
            <Chip>0 loop de espera</Chip>
          </Row>
        </div>
      </div>
    </Frame>
  );
}

function Harness() {
  const rows: { task: string; a: Accent; model: string; effort: string }[] = [
    { task: "renomear em 40 arquivos", a: "scout", model: "modelo local", effort: "effort mín" },
    { task: "escrever endpoint", a: "build", model: "modelo de código", effort: "effort médio" },
    { task: "decidir arquitetura", a: "cmd", model: "raciocínio", effort: "effort máx" },
  ];
  return (
    <Frame label="tarefa → agente → modelo → effort">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.task} className="border border-line bg-panel2 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip accent={r.a}>{r.task}</Chip>
              <span className="font-mono text-[10px] text-line2">→</span>
              <Chip>{r.model}</Chip>
              <span className="font-mono text-[10px] text-line2">→</span>
              <Chip>{r.effort}</Chip>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-dim">
        precedência: roster <span className="text-line2">&gt;</span> invocação{" "}
        <span className="text-line2">&gt;</span> default de catálogo
      </p>
    </Frame>
  );
}

function Memory() {
  return (
    <Frame label="córtex · escopo workspace">
      <div className="grid grid-cols-3 gap-2">
        {["sessão de ontem", "sessão de hoje", "missão agendada"].map((s, i) => (
          <div key={s} className="border border-line bg-panel2 p-2">
            <p className="font-mono text-[9.5px] text-mute">{s}</p>
            <p className={`mt-1 font-mono text-[9px] ${i === 0 ? "text-review" : "text-dim"}`}>
              {i === 0 ? "grava fato" : "lê antes de investigar"}
            </p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 20" className="mt-1 h-5 w-full">
        <g stroke="var(--color-review)" fill="none" strokeWidth="1" opacity="0.6">
          <path d="M50 0 V10 H150 V20" className="flow-line" />
          <path d="M150 20 V10 H250 V0" />
        </g>
      </svg>
      <div className="border border-review/35 bg-review/10 p-2.5">
        <p className="font-mono text-[10px] text-review">memória compartilhada · persistente</p>
        <p className="mt-1.5 font-mono text-[9.5px] text-mute">
          “deploy exige NODE_OPTIONS=--max-old-space-size=4096”
        </p>
        <p className="font-mono text-[9px] text-dim">— scout · missão #14</p>
      </div>
    </Frame>
  );
}

function Contract() {
  return (
    <Frame label="contrato antes do código">
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-build/35 bg-build/10 p-2.5">
          <p className="font-mono text-[10px] text-build">builder back</p>
          <p className="mt-1 font-mono text-[9px] text-dim">GET /slots</p>
        </div>
        <div className="border border-build/35 bg-build/10 p-2.5">
          <p className="font-mono text-[10px] text-build">builder front</p>
          <p className="mt-1 font-mono text-[9px] text-dim">SlotPicker</p>
        </div>
      </div>
      <svg viewBox="0 0 300 26" className="h-6 w-full">
        <g stroke="var(--color-line2)" fill="none" strokeWidth="1">
          <path d="M75 0 V13 H150 V26" className="flow-line" />
          <path d="M225 0 V13 H150 V26" className="flow-line" />
        </g>
      </svg>
      <div className="border border-review/40 bg-review/10 p-2.5 text-center">
        <p className="font-mono text-[10px] text-review">contract.v1 · assinado</p>
        <p className="mt-1 font-mono text-[9px] text-mute">
          {"{ items: Slot[], page: number, total: number }"}
        </p>
      </div>
      <Row className="mt-3 justify-center">
        <Chip accent="ctrl">merge garantido</Chip>
        <Chip>handoff fora do contrato = recusado</Chip>
      </Row>
    </Frame>
  );
}

function Timeline() {
  const evs: [string, string, Accent][] = [
    ["00:00", "briefing recebido · plano montado", "cmd"],
    ["00:14", "contrato.v1 submetido", "review"],
    ["00:19", "gate aprovado por você", "ctrl"],
    ["00:41", "handoff recusado · fora do contrato", "build"],
    ["01:02", "entrega consolidada · R$ 3,18", "ctrl"],
  ];
  return (
    <Frame label="replay · timeline auditável">
      <div className="space-y-0">
        {evs.map(([t, e, a], i) => (
          <div key={t} className="flex gap-3">
            <p className="w-10 shrink-0 pt-2 font-mono text-[9.5px] text-dim">{t}</p>
            <div className="flex flex-col items-center pt-2.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT[a].bgSolid}`} />
              {i < evs.length - 1 && <span className="h-full w-px flex-1 bg-line" />}
            </div>
            <p className="pt-1.5 pb-2 font-mono text-[10px] text-mute">{e}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-dim">prompt exato + harness + custo por passo</p>
    </Frame>
  );
}

function Meter() {
  const rows: [string, number, Accent, string][] = [
    ["núcleo", 22, "cmd", "0,42"],
    ["scout", 8, "scout", "0,06"],
    ["builder-1", 54, "build", "1,18"],
    ["builder-2", 4, "build", "0,00 · local"],
    ["reviewer", 31, "ctrl", "0,71"],
  ];
  return (
    <Frame label="medidor · missão agenda-visual">
      <div className="space-y-2.5">
        {rows.map(([n, w, a, c]) => (
          <div key={n}>
            <Row className="justify-between">
              <span className={`font-mono text-[10px] ${ACCENT[a].text}`}>{n}</span>
              <span className="font-mono text-[10px] text-mute">R$ {c}</span>
            </Row>
            <div className="mt-1">
              <Bar w={w} accent={a} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-line2 pt-2.5">
        <p className="font-mono text-[10px] text-ink">total R$ 2,37</p>
        <p className="font-mono text-[10px] text-dim">teto 5,00 · freia ao bater</p>
      </div>
    </Frame>
  );
}

function Gate() {
  return (
    <Frame label="handoff → gate → entrega">
      <div className="space-y-2">
        <div className="border border-build/35 bg-build/10 p-2.5">
          <p className="font-mono text-[10px] text-build">handoff · builder-1</p>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[9.5px] text-mute">
            <li>escopo: api de agendamento</li>
            <li>contra: contract.v1</li>
            <li>6 arquivos · 2 migrations</li>
            <li className="text-dim">sem teste: retry de webhook</li>
          </ul>
        </div>
        <div className="border-y border-dashed border-cmd/40 py-2 text-center">
          <p className="font-mono text-[10px] text-cmd">gate · decisão sua</p>
        </div>
        <Row>
          <Chip accent="ctrl">aprovar</Chip>
          <Chip accent="build">revisar com motivo</Chip>
          <Chip accent="cmd">matar linha</Chip>
        </Row>
      </div>
    </Frame>
  );
}

function Voice() {
  return (
    <Frame label="push-to-talk · pane ativo">
      <Row className="h-10 items-end gap-[3px]">
        {[
          6, 14, 22, 10, 30, 38, 24, 16, 34, 40, 28, 18, 12, 26, 36, 20, 10, 22, 14, 8, 18, 30, 12,
          6,
        ].map((h, i) => (
          <span
            key={i}
            className="w-full bg-cmd/70"
            style={{ height: `${h}px`, opacity: 0.35 + (h / 40) * 0.65 }}
          />
        ))}
      </Row>
      <div className="mt-3 border border-line bg-panel2 p-2.5">
        <p className="font-mono text-[9.5px] text-dim">transcrito · whisper.cpp local</p>
        <p className="mt-1 font-mono text-[10.5px] text-ink">
          “sobe o preview e manda o reviewer olhar o checkout”
        </p>
      </div>
      <Row className="mt-3">
        <Chip accent="cmd">hold: space</Chip>
        <Chip>PT → EN</Chip>
        <Chip accent="ctrl">custo zero por uso</Chip>
      </Row>
    </Frame>
  );
}

function Providers() {
  const rows: [string, string, Accent][] = [
    ["pane · scout", "modelo rápido · effort baixo", "scout"],
    ["pane · builder-1", "modelo de código · nuvem", "build"],
    ["pane · builder-2", "modelo local · R$ 0,00", "build"],
    ["pane · reviewer", "raciocínio · effort máx", "ctrl"],
  ];
  return (
    <Frame label="um provider por pane">
      <div className="space-y-2">
        {rows.map(([p, m, a]) => (
          <Row key={p} className="border border-line bg-panel2 px-2.5 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${ACCENT[a].bgSolid}`} />
            <span className={`font-mono text-[10px] ${ACCENT[a].text}`}>{p}</span>
            <span className="ml-auto font-mono text-[9.5px] text-dim">{m}</span>
          </Row>
        ))}
      </div>
      <Row className="mt-3 flex-wrap">
        <Chip>OAuth</Chip>
        <Chip>CLI no PATH</Chip>
        <Chip>chave AES-256</Chip>
        <Chip accent="ctrl">4 modos de permissão</Chip>
      </Row>
    </Frame>
  );
}

function Mission() {
  return (
    <Frame label="3 modos · worktree por missão">
      <div className="space-y-2">
        {(
          [
            ["livre", "você comanda os panes", "scout"],
            ["combinação", "o núcleo conduz o time", "cmd"],
            ["agêntico", "piloto decompõe em fases", "review"],
          ] as [string, string, Accent][]
        ).map(([n, d, a]) => (
          <div key={n} className={`border ${ACCENT[a].border} ${ACCENT[a].bg} px-2.5 py-2`}>
            <Row>
              <span className={`font-mono text-[10.5px] ${ACCENT[a].text}`}>{n}</span>
              <span className="ml-auto font-mono text-[9.5px] text-dim">{d}</span>
            </Row>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 40" className="mt-3 h-10 w-full">
        <g stroke="var(--color-line2)" fill="none" strokeWidth="1">
          <path d="M10 20 H290" />
          <path d="M90 20 C110 20 110 6 130 6 H290" stroke="var(--color-ctrl)" opacity="0.7" />
          <path d="M90 20 C110 20 110 34 130 34 H290" stroke="var(--color-build)" opacity="0.7" />
        </g>
        <circle cx="90" cy="20" r="2.5" fill="var(--color-cmd)" />
      </svg>
      <p className="font-mono text-[9.5px] text-dim">
        duas missões, dois worktrees, mesmo repo, zero conflito
      </p>
    </Frame>
  );
}

function Skills() {
  return (
    <Frame label="composição do zord">
      <div className="border border-build/35 bg-build/10 p-3">
        <p className="font-mono text-[11px] text-build">builder-1</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Chip>CLI: código</Chip>
          <Chip>modelo: nuvem</Chip>
          <Chip>papel: builder</Chip>
          <Chip>effort: médio</Chip>
        </div>
      </div>
      <p className="mt-2.5 text-center font-mono text-[10px] text-line2">↑ auto-deploy no spawn</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Chip accent="review">skill: migrations da casa</Chip>
        <Chip accent="review">skill: convenção de teste</Chip>
        <Chip accent="ctrl">skill: acessibilidade</Chip>
        <Chip dim>skill: fora do gate ✕</Chip>
      </div>
    </Frame>
  );
}

function Api() {
  const calls = [
    ["pane_spawn", "abre agente na grade"],
    ["agent_invoke", "chama zord por nome"],
    ["contract_read", "lê a interface assinada"],
    ["handoff_submit", "entrega estruturada"],
    ["memory_write", "grava fato no córtex"],
    ["cron_create", "agenda a missão"],
  ];
  return (
    <Frame label="mcp__mz__* · 52 tools nativas">
      <div className="space-y-1.5">
        {calls.map(([c, d]) => (
          <Row key={c} className="border-b border-line pb-1.5">
            <span className="font-mono text-[10px] text-scout">{c}</span>
            <span className="ml-auto font-mono text-[9.5px] text-dim">{d}</span>
          </Row>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-dim">
        injetadas no spawn · nada pra instalar · o agente opera o cockpit
      </p>
    </Frame>
  );
}

function Media() {
  return (
    <Frame label="mídia como entregável">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["imagem", "6 em paralelo", "review"],
            ["vídeo", "prova do fluxo", "cmd"],
            ["áudio", "voz e efeito", "ctrl"],
          ] as [string, string, Accent][]
        ).map(([n, d, a]) => (
          <div key={n} className={`border ${ACCENT[a].border} ${ACCENT[a].bg} p-2.5 text-center`}>
            <p className={`font-mono text-[10px] ${ACCENT[a].text}`}>{n}</p>
            <p className="mt-1 font-mono text-[9px] text-dim">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 border border-line bg-panel2 p-2.5">
        <p className="font-mono text-[9.5px] text-dim">allowlist da formação Vitrine</p>
        <Row className="mt-1.5 flex-wrap">
          <Chip accent="ctrl">imagem: liberada</Chip>
          <Chip dim>vídeo: bloqueado</Chip>
          <Chip dim>áudio: bloqueado</Chip>
        </Row>
      </div>
      <p className="mt-2.5 font-mono text-[9.5px] text-dim">custo de mídia no mesmo teto da missão</p>
    </Frame>
  );
}

function Market() {
  const items: [string, string, Accent][] = [
    ["skill · migrations postgres", "1.2k instalações", "review"],
    ["zord · reviewer de segurança", "840 instalações", "ctrl"],
    ["formação · landing em 1 briefing", "2.4k instalações", "cmd"],
  ];
  return (
    <Frame label="mercado · instalar em 1 clique">
      <div className="space-y-2">
        {items.map(([n, d, a]) => (
          <Row key={n} className="border border-line bg-panel2 px-2.5 py-2">
            <div>
              <p className={`font-mono text-[10px] ${ACCENT[a].text}`}>{n}</p>
              <p className="mt-0.5 font-mono text-[9px] text-dim">{d}</p>
            </div>
            <span className="ml-auto border border-line2 px-2 py-1 font-mono text-[9.5px] text-mute">
              instalar
            </span>
          </Row>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-dim">zero YAML · zero terminal · vale no próximo spawn</p>
    </Frame>
  );
}

function Workspace() {
  return (
    <Frame label="chão do cockpit">
      <div className="grid grid-cols-3 gap-2">
        <div className="border border-line bg-panel2 p-2">
          <p className="font-mono text-[9.5px] text-dim">árvore</p>
          <div className="mt-1.5 space-y-1 font-mono text-[9px] text-mute">
            <p>app/</p>
            <p className="pl-2">page.tsx</p>
            <p>db/</p>
            <p className="pl-2 text-build">migrations/</p>
          </div>
        </div>
        <div className="border border-line bg-panel2 p-2">
          <p className="font-mono text-[9.5px] text-dim">editor · conferência</p>
          <div className="mt-1.5 space-y-1">
            <Bar w={80} accent="review" />
            <Bar w={55} accent="review" />
            <Bar w={68} accent="review" />
            <Bar w={30} accent="review" />
          </div>
        </div>
        <div className="border border-line bg-panel2 p-2">
          <p className="font-mono text-[9.5px] text-dim">browser</p>
          <div className="mt-1.5 border border-line p-1.5">
            <p className="font-mono text-[8.5px] text-ctrl">localhost:3000</p>
            <div className="mt-1.5 space-y-1">
              <Bar w={100} accent="ctrl" />
              <Bar w={70} accent="ctrl" />
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] text-dim">
        $ mz . <span className="text-line2">·</span> retoma missão, panes e histórico
      </p>
    </Frame>
  );
}

export default function SurfaceVisual({
  visual,
  accent = "cmd",
}: {
  visual: Visual;
  accent?: Accent;
}) {
  switch (visual) {
    case "cockpit":
      return <Cockpit accent={accent} />;
    case "delegation":
      return <Delegation />;
    case "harness":
      return <Harness />;
    case "memory":
      return <Memory />;
    case "contract":
      return <Contract />;
    case "timeline":
      return <Timeline />;
    case "meter":
      return <Meter />;
    case "gate":
      return <Gate />;
    case "voice":
      return <Voice />;
    case "providers":
      return <Providers />;
    case "mission":
      return <Mission />;
    case "skills":
      return <Skills />;
    case "api":
      return <Api />;
    case "media":
      return <Media />;
    case "market":
      return <Market />;
    case "workspace":
      return <Workspace />;
  }
}
