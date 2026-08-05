import Link from "next/link";
import type { Metadata } from "next";
import CockpitSim from "@/components/CockpitSim";
import SurfaceVisual from "@/components/Diagrams";
import { ACCENT, Button, Container, Kicker, Section, SectionHead } from "@/components/ui";
import { MODES, SITE } from "@/lib/site";
import { SURFACES } from "@/lib/surfaces";

export const metadata: Metadata = {
  title: "Como funciona",
  description:
    "Briefing entra, o Núcleo monta o time, o trabalho roda em paralelo contra contrato e a entrega sai consolidada — com gate, custo à vista e replay.",
};

const FLOW = [
  {
    n: "01",
    a: "cmd" as const,
    t: "Você dá o briefing",
    b: "Texto ou voz, no nível de resultado: “app de agenda com login e dados reais, deploy em preview”. Você não escolhe agente, nem modelo, nem escreve YAML.",
    detail: ["Voz: push-to-talk local, custo zero", "Teto de gasto definido aqui", "Modo: livre, combinação ou agêntico"],
    surface: "voz",
  },
  {
    n: "02",
    a: "cmd" as const,
    t: "O Núcleo monta o plano",
    b: "O orquestrador lê o briefing, escolhe a formação, define o roster e o harness de cada papel — e te mostra time, custo estimado e gates antes de gastar o primeiro token.",
    detail: ["Núcleo sem shell e sem editor", "Harness por tipo de tarefa", "Plano aprovado antes de rodar"],
    surface: "nucleo",
  },
  {
    n: "03",
    a: "review" as const,
    t: "O time fecha o contrato",
    b: "Antes de qualquer builder escrever código, a interface é assinada: endpoint, shape de payload, assinatura de componente. É o que faz o trabalho paralelo dar merge no fim.",
    detail: ["Contrato versionado no repo", "Mudança de contrato pede gate", "Mock derivado pro front começar"],
    surface: "contratos",
  },
  {
    n: "04",
    a: "build" as const,
    t: "Os zords trabalham em paralelo",
    b: "Cada agente num pane, com provider e effort próprios. Scout em modelo rápido, task mecânica em modelo local a custo zero, reviewer no modelo forte. Você assiste, e pode digitar em qualquer pane.",
    detail: ["Até 12 panes por missão", "Custo por agente ao vivo", "Worktree isolado por missão"],
    surface: "cockpit",
  },
  {
    n: "05",
    a: "ctrl" as const,
    t: "O handoff é conferido",
    b: "Entrega é estruturada: escopo, arquivos, contrato de referência, o que ficou sem teste. O Núcleo recusa sozinho o que está fora do contrato — você só vê o que passou.",
    detail: ["Recusa automática com o diff", "2–3 gates humanos por missão", "Kill switch por pane ou missão"],
    surface: "gates",
  },
  {
    n: "06",
    a: "ctrl" as const,
    t: "A entrega sai com prova",
    b: "Resultado consolidado, prova em vídeo do fluxo rodando, custo fechado por papel e replay auditável de cada delegação, recusa e aprovação da missão.",
    detail: ["Replay com o prompt exato", "Custo por passo, não só total", "Re-run com harness ajustado"],
    surface: "replay",
  },
];

export default function ComoFunciona() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <Container className="relative py-20">
          <Kicker>como funciona</Kicker>
          <h1 className="mt-5 max-w-3xl text-[1.7rem] leading-[1.12] font-semibold sm:text-[2.25rem] lg:text-[2.75rem]">
            Um briefing entra. Um time se monta.
            <br />
            <span className="text-mute">Uma entrega sai — com prova.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mute">
            Seis passos. Você aparece em três: no briefing, nos gates e na conferência. O resto é
            trabalho de time — e ele acontece à sua vista.
          </p>
          <div className="mt-12">
            <CockpitSim />
          </div>
        </Container>
      </div>

      <Section>
        <SectionHead
          kicker="o loop completo"
          title="Do briefing à prova"
          body="Cada passo tem uma superfície por trás dele. Nenhum deles pede que você abra um arquivo."
        />
        <div className="mt-12 space-y-px bg-line">
          {FLOW.map((f) => {
            const s = SURFACES.find((x) => x.slug === f.surface)!;
            return (
              <div key={f.n} className="grid gap-6 bg-panel p-7 lg:grid-cols-[60px_1fr_260px] lg:gap-10 sm:p-9">
                <p className={`font-mono text-xl ${ACCENT[f.a].text}`}>{f.n}</p>
                <div>
                  <h3 className="text-xl leading-snug font-semibold sm:text-2xl">{f.t}</h3>
                  <p className="mt-3 max-w-2xl leading-relaxed text-mute">{f.b}</p>
                  <Link
                    href={`/features/${s.slug}`}
                    className="mt-4 inline-block font-mono text-[11px] text-cmd"
                  >
                    superfície: {s.name} →
                  </Link>
                </div>
                <ul className="space-y-2 border-l border-line pl-5 lg:pl-6">
                  {f.detail.map((d) => (
                    <li key={d} className="font-mono text-[10.5px] leading-relaxed text-dim">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      <Section>
        <SectionHead
          kicker="modos"
          accent="scout"
          title="Três modos, e o modo é quem define a autonomia"
          body="A mesma missão pode rodar com você no comando ou com o time se auto-organizando. O que muda é quem lidera e quanto você aprova."
        />
        <div className="mt-10 grid gap-px bg-line md:grid-cols-3">
          {MODES.map((m) => (
            <div key={m.id} className="bg-panel p-7">
              <div className="flex items-baseline gap-2">
                <h3 className={`font-mono text-base ${ACCENT[m.accent].text}`}>{m.name}</h3>
                <p className="font-mono text-[10.5px] text-dim">{m.lead}</p>
              </div>
              <p className="mt-4 leading-relaxed text-mute">{m.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Kicker accent="build">a peça que economiza</Kicker>
            <h2 className="mt-4 text-2xl leading-tight font-semibold sm:text-3xl">
              Task mecânica não queima token de modelo caro
            </h2>
            <p className="mt-5 leading-relaxed text-mute">
              O harness é o que decide quem faz o quê com qual modelo e qual effort. Renomear em 40
              arquivos vai pro modelo local, a custo zero. Decidir arquitetura vai pro modelo de
              raciocínio com effort máximo. A resolução é determinística: roster vence invocação, que
              vence default de catálogo.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href="/features/harness" variant="ghost">
                Ver o Harness
              </Button>
              <Button href="/features/medidor" variant="ghost">
                Ver o Medidor
              </Button>
            </div>
          </div>
          <SurfaceVisual visual="harness" accent="build" />
        </div>
      </Section>

      <Section>
        <div className="text-center">
          <h2 className="mx-auto max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
            {SITE.surfaceCount} superfícies existem pra que esse loop rode sem você virar o
            barramento.
          </h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button href="/combinacoes">Ver as combinações</Button>
            <Button href="/features" variant="ghost">
              Ver as superfícies
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
