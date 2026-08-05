"use client";

import { useEffect, useMemo, useState } from "react";
import { ACCENT, type Accent } from "./ui";

type PaneId = "nucleo" | "scout" | "contrato" | "builder-1" | "builder-2" | "reviewer";
type PStatus = "spawning" | "reading" | "writing" | "waiting" | "done";

interface PaneDef {
  id: PaneId;
  name: string;
  accent: Accent;
  model: string;
  role: string;
}

const PANES: Record<PaneId, PaneDef> = {
  nucleo: { id: "nucleo", name: "núcleo", accent: "cmd", model: "raciocínio · effort alto", role: "orquestra" },
  scout: { id: "scout", name: "scout", accent: "scout", model: "rápido · effort baixo", role: "explora" },
  contrato: { id: "contrato", name: "contrato", accent: "review", model: "raciocínio · effort médio", role: "assina interface" },
  "builder-1": { id: "builder-1", name: "builder-1", accent: "build", model: "código · effort médio", role: "backend" },
  "builder-2": { id: "builder-2", name: "builder-2", accent: "build", model: "local · custo zero", role: "frontend" },
  reviewer: { id: "reviewer", name: "reviewer", accent: "ctrl", model: "raciocínio · effort alto", role: "reprova" },
};

type Ev =
  | { at: number; k: "brief"; chars: number }
  | { at: number; k: "spawn"; id: PaneId }
  | { at: number; k: "log"; id: PaneId; line: string; cost: number; status?: PStatus }
  | { at: number; k: "gate"; label: string }
  | { at: number; k: "gateOk" }
  | { at: number; k: "deliver" };

const BRIEF = "app de agenda com login e dados reais, deploy em preview";

const SCRIPT: Ev[] = [
  ...Array.from({ length: BRIEF.length }, (_, i) => ({
    at: 2 + i * 0.32,
    k: "brief" as const,
    chars: i + 1,
  })),
  { at: 22, k: "spawn", id: "nucleo" },
  { at: 24, k: "log", id: "nucleo", line: "briefing lido · montando formação Fábrica", cost: 0.04, status: "reading" },
  { at: 27, k: "log", id: "nucleo", line: "plano: contrato → 2 builders paralelos → QA", cost: 0.06, status: "writing" },
  { at: 30, k: "spawn", id: "scout" },
  { at: 31, k: "log", id: "scout", line: "varrendo repo · stack e convenções", cost: 0.01, status: "reading" },
  { at: 34, k: "spawn", id: "contrato" },
  { at: 35, k: "log", id: "scout", line: "next 15 · postgres · convenção snake_case", cost: 0.02, status: "done" },
  { at: 37, k: "log", id: "contrato", line: "definindo schema e shape de payload", cost: 0.05, status: "writing" },
  { at: 40, k: "log", id: "nucleo", line: "córtex ← 'migrations vivem em /db/migrations'", cost: 0.01 },
  { at: 42, k: "log", id: "contrato", line: "handoff_submit · contract.v1", cost: 0.03, status: "done" },
  { at: 44, k: "gate", label: "aprovar contrato de interface + schema" },
  { at: 60, k: "gateOk" },
  { at: 62, k: "spawn", id: "builder-1" },
  { at: 63, k: "spawn", id: "builder-2" },
  { at: 64, k: "log", id: "builder-1", line: "lendo contract.v1 · gerando migrations", cost: 0.07, status: "writing" },
  { at: 65, k: "log", id: "builder-2", line: "lendo contract.v1 · telas contra mock", cost: 0.0, status: "writing" },
  { at: 69, k: "log", id: "builder-1", line: "POST /sessions · GET /slots · 6 arquivos", cost: 0.09 },
  { at: 71, k: "log", id: "builder-2", line: "AgendaGrid · SlotPicker · 4 arquivos", cost: 0.0 },
  { at: 74, k: "spawn", id: "reviewer" },
  { at: 75, k: "log", id: "builder-1", line: "handoff_submit · api + migrations", cost: 0.04, status: "done" },
  { at: 77, k: "log", id: "reviewer", line: "conferindo entrega contra contract.v1", cost: 0.05, status: "reading" },
  { at: 80, k: "log", id: "reviewer", line: "recusado: /slots devolve array, contrato pede paginado", cost: 0.03 },
  { at: 83, k: "log", id: "builder-1", line: "corrigindo · payload paginado", cost: 0.05, status: "writing" },
  { at: 86, k: "log", id: "builder-2", line: "handoff_submit · telas + estados vazios", cost: 0.0, status: "done" },
  { at: 88, k: "log", id: "builder-1", line: "handoff_submit · api conforme contrato", cost: 0.03, status: "done" },
  { at: 91, k: "log", id: "reviewer", line: "fluxo rodado · vídeo da prova gravado", cost: 0.06, status: "done" },
  { at: 94, k: "log", id: "nucleo", line: "consolidando · 3 handoffs aceitos, 1 recusado", cost: 0.04 },
  { at: 97, k: "deliver" },
];

const TOTAL = 118;
const TICK = 120;

const STATUS_TEXT: Record<PStatus, string> = {
  spawning: "subindo",
  reading: "lendo",
  writing: "escrevendo",
  waiting: "no gate",
  done: "entregue",
};

export default function CockpitSim() {
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= TOTAL) {
          setApproved(false);
          return 0;
        }
        return s + 1;
      });
    }, TICK);
    return () => clearInterval(t);
  }, []);

  const state = useMemo(() => {
    const order: PaneId[] = [];
    const logs: Record<string, string[]> = {};
    const status: Record<string, PStatus> = {};
    let brief = "";
    let cost = 0;
    let gate: string | null = null;
    let gateDone = false;
    let delivered = false;

    for (const ev of SCRIPT) {
      if (ev.at > step) break;
      if (ev.k === "brief") brief = BRIEF.slice(0, ev.chars);
      if (ev.k === "spawn") {
        order.push(ev.id);
        status[ev.id] = "spawning";
        logs[ev.id] = [];
      }
      if (ev.k === "log") {
        logs[ev.id] = [...(logs[ev.id] ?? []), ev.line].slice(-2);
        cost += ev.cost;
        if (ev.status) status[ev.id] = ev.status;
      }
      if (ev.k === "gate") gate = ev.label;
      if (ev.k === "gateOk") gateDone = true;
      if (ev.k === "deliver") delivered = true;
    }
    if (gate && !gateDone && !approved) {
      for (const id of order) if (status[id] === "done") status[id] = "waiting";
    }
    return { order, logs, status, brief, cost, gate, gateDone: gateDone || approved, delivered };
  }, [step, approved]);

  const gateOpen = !!state.gate && !state.gateDone;

  return (
    <div className="scanline relative border border-line2 bg-panel shadow-[0_40px_120px_-40px_rgba(255,59,48,0.25)]">
      {/* mission bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel2 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cmd" />
          <span className="h-2 w-2 rounded-full bg-build" />
          <span className="h-2 w-2 rounded-full bg-ctrl" />
        </div>
        <p className="font-mono text-[11px] text-mute">
          missão <span className="text-ink">agenda-visual</span> · modo{" "}
          <span className="text-cmd">combinação</span> · formação{" "}
          <span className="text-ink">Fábrica</span>
        </p>
        <p className="ml-auto font-mono text-[11px] text-mute">
          {state.order.length}/12 panes · R$ <span className="text-ink">{state.cost.toFixed(2)}</span>{" "}
          <span className="text-dim">/ teto 5,00</span>
        </p>
      </div>

      {/* briefing */}
      <div className="border-b border-line px-4 py-3">
        <p className="font-mono text-[12px] break-words">
          <span className="text-cmd">›</span>{" "}
          <span className="text-dim">briefing</span>{" "}
          <span className="text-ink">{state.brief}</span>
          {state.brief.length < BRIEF.length && <span className="caret text-cmd">▊</span>}
        </p>
      </div>

      {/* pane grid */}
      <div className="min-h-[266px] bg-panel">
        <div className="grid auto-rows-[132px] grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
        {state.order.map((id) => {
          const p = PANES[id];
          const st = state.status[id] ?? "spawning";
          const a = ACCENT[p.accent];
          return (
            <div key={id} className="rise bg-panel p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.bgSolid} ${
                    st === "writing" || st === "reading" ? "dot-live" : ""
                  }`}
                />
                <span className={`font-mono text-[11px] font-medium ${a.text}`}>{p.name}</span>
                <span className="ml-auto font-mono text-[10px] text-dim">{STATUS_TEXT[st]}</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-dim">{p.model}</p>
              <div className="mt-2 space-y-1">
                {(state.logs[id] ?? []).map((l, i) => (
                  <p key={i} className="rise font-mono text-[10.5px] leading-snug text-mute">
                    <span className="text-line2">$</span> {l}
                  </p>
                ))}
                {st === "spawning" && (
                  <p className="font-mono text-[10.5px] text-dim">
                    spawn<span className="caret">…</span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
          {state.order.length === 0 && (
            <div className="col-span-full flex items-center justify-center bg-panel py-16">
              <p className="font-mono text-[11px] text-dim">grade vazia · aguardando briefing</p>
            </div>
          )}
        </div>
      </div>

      {/* gate / delivery bar */}
      <div className="border-t border-line px-4 py-3">
        {gateOpen ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="border border-build/40 bg-build/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-build uppercase">
              gate
            </span>
            <p className="font-mono text-[11.5px] text-ink">{state.gate}</p>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => setApproved(true)}
                className="border border-ctrl/40 bg-ctrl/10 px-3 py-1 font-mono text-[11px] text-ctrl transition-colors hover:bg-ctrl/20"
              >
                aprovar
              </button>
              <button
                onClick={() => setApproved(true)}
                className="border border-line2 px-3 py-1 font-mono text-[11px] text-mute transition-colors hover:text-ink"
              >
                revisar
              </button>
            </div>
          </div>
        ) : state.delivered ? (
          <p className="font-mono text-[11.5px] text-ctrl">
            ✓ entrega consolidada · app em preview, migrations aplicadas, prova em vídeo ·{" "}
            <span className="text-mute">replay gravado</span>
          </p>
        ) : (
          <p className="font-mono text-[11.5px] text-mute">
            <span className="text-dim">handoff</span> event-driven · o núcleo dorme até alguém
            entregar
          </p>
        )}
      </div>
    </div>
  );
}
