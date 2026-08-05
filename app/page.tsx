import Link from "next/link";
import CockpitSim from "@/components/CockpitSim";
import {
  ACCENT,
  Button,
  Container,
  ContrastRow,
  Kicker,
  Section,
  SectionHead,
} from "@/components/ui";
import { FORMATIONS, MODES, SITE, THESES } from "@/lib/site";
import { LAYERS, SURFACES, type LayerId } from "@/lib/surfaces";

const LAYER_ORDER: LayerId[] = ["comando", "time", "contexto", "controle"];

export default function Home() {
  return (
    <>
      {/* ───────────────── hero ───────────────── */}
      <div className="relative overflow-hidden">
        <div className="grid-bg mask-fade absolute inset-0 opacity-40" aria-hidden />
        <div
          className="absolute -top-40 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-cmd/12 blur-[120px]"
          aria-hidden
        />
        <Container className="relative pt-20 pb-16 sm:pt-28">
          <div className="flex flex-wrap items-center gap-3">
            <span className="border border-cmd/35 bg-cmd/10 px-2.5 py-1 font-mono text-[10.5px] tracking-[0.18em] text-cmd uppercase">
              ADE
            </span>
            <p className="font-mono text-[11.5px] text-mute">
              {SITE.surfaceCount} superfícies · {SITE.toolCount} MCP tools · 1 cockpit
            </p>
          </div>

          <h1 className="mt-7 max-w-5xl text-[1.75rem] leading-[1.1] font-semibold sm:text-[2.5rem] lg:text-[3.15rem]">
            Você não escreve o código.
            <br />
            <span className="text-mute">Você comanda o time que escreve.</span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-mute">
            Num IDE, você escreve código com ajuda de IA. Num{" "}
            <span className="text-ink">ADE</span>, você comanda um time de IAs que escreve, testa e
            entrega — e o ambiente inteiro existe pra coordenar esse time, não pra editar arquivo.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button href="/features">Ver as {SITE.surfaceCount} superfícies →</Button>
            <Button href="/como-funciona" variant="ghost">
              Como funciona
            </Button>
            <code className="ml-1 hidden border border-line px-3 py-3 font-mono text-[12px] text-dim sm:block">
              $ {SITE.cli} . <span className="caret text-cmd">▊</span>
            </code>
          </div>

          <div className="mt-14">
            <CockpitSim />
            <p className="mt-3 font-mono text-[10.5px] text-dim">
              simulação do cockpit · 1 briefing, 6 agentes, 1 gate, 1 entrega consolidada
            </p>
          </div>
        </Container>
      </div>

      {/* ───────────────── a virada ───────────────── */}
      <Section>
        <SectionHead
          kicker="a virada"
          title="O editor saiu do centro da tela."
          body="Um IDE é ótimo no que ele faz: te deixar escrever uma linha por vez, mais rápido. O ADE assume outra coisa — que o trabalho é feito por vários agentes ao mesmo tempo, e que o gargalo passou a ser coordenação: quem faz o quê, contra qual contrato, a que custo, com qual aprovação."
        />
        <div className="mt-12 grid gap-px overflow-hidden border border-line bg-line lg:grid-cols-3">
          {[
            {
              t: "No centro",
              ide: "O arquivo. A IA sugere na lateral.",
              ade: "O time. O editor é 1 das 18 superfícies.",
            },
            {
              t: "Seu trabalho",
              ide: "Escrever, revisar, colar entre janelas.",
              ade: "Dar briefing, aprovar 3 gates, checar custo.",
            },
            {
              t: "A unidade",
              ide: "Um arquivo salvo.",
              ade: "Uma missão entregue, com replay e prova.",
            },
          ].map((c) => (
            <div key={c.t} className="bg-panel p-6 sm:p-7">
              <p className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">{c.t}</p>
              <p className="mt-4 text-sm leading-relaxed text-dim line-through decoration-line2">
                {c.ide}
              </p>
              <p className="mt-2.5 text-base leading-relaxed text-ink">{c.ade}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <ContrastRow
            ide="Você é o orquestrador: copiar, colar, trocar de janela, repetir — e o custo aparece na fatura."
            ade="O orquestrador é software: delega, cobra handoff, recusa entrega fora do contrato e mostra o custo subindo."
          />
        </div>
      </Section>

      {/* ───────────────── como funciona ───────────────── */}
      <Section>
        <SectionHead
          kicker="o loop"
          title="Briefing entra. Time se monta. Entrega sai."
          body="Três passos, e você aparece em dois deles."
        />
        <div className="mt-12 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Briefing",
              b: "Texto ou voz, no nível de resultado. Sem configurar agente, sem escolher modelo, sem escrever YAML.",
              a: "cmd" as const,
            },
            {
              n: "02",
              t: "Combinação",
              b: "O Núcleo monta o roster, fecha contrato de interface, dispara os zords em paralelo e cobra handoff.",
              a: "build" as const,
            },
            {
              n: "03",
              t: "Entrega",
              b: "Resultado consolidado, prova em vídeo, custo fechado e replay auditável da missão inteira.",
              a: "ctrl" as const,
            },
          ].map((s) => (
            <div key={s.n} className="bg-panel p-7">
              <p className={`font-mono text-[11px] ${ACCENT[s.a].text}`}>{s.n}</p>
              <h3 className="mt-4 text-xl font-semibold">{s.t}</h3>
              <p className="mt-3 leading-relaxed text-mute">{s.b}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {MODES.map((m) => (
            <div key={m.id} className={`border ${ACCENT[m.accent].border} ${ACCENT[m.accent].bg} p-5`}>
              <div className="flex items-baseline gap-2">
                <p className={`font-mono text-[13px] ${ACCENT[m.accent].text}`}>{m.name}</p>
                <p className="font-mono text-[10.5px] text-dim">{m.lead}</p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mute">{m.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────────── superfícies ───────────────── */}
      <Section id="superficies">
        <SectionHead
          kicker="/features"
          title={`${SITE.surfaceCount} superfícies. Nenhuma delas é um editor de texto.`}
          body="Cada superfície resolve um problema de coordenação. Elas se dividem em quatro camadas: como a ordem entra, quem executa, o que o time compartilha e como você não perde o controle."
        />
        <div className="mt-12 space-y-14">
          {LAYER_ORDER.map((id) => {
            const layer = LAYERS[id];
            const items = SURFACES.filter((s) => s.layer === id);
            return (
              <div key={id}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line pb-3">
                  <p className="font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
                    {layer.label}
                  </p>
                  <p className="text-sm text-mute">{layer.body}</p>
                </div>
                <div className="mt-5 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((s) => (
                    <Link
                      key={s.slug}
                      href={`/features/${s.slug}`}
                      className="group bg-panel p-5 transition-colors hover:bg-panel2"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT[s.accent].bgSolid}`} />
                        <h3 className="font-mono text-[13px] font-medium">{s.name}</h3>
                        <span className="ml-auto font-mono text-[10px] text-dim">{s.metric}</span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-mute">{s.card}</p>
                      <p className="mt-4 font-mono text-[10.5px] text-dim transition-colors group-hover:text-cmd">
                        abrir →
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ───────────────── combinações ───────────────── */}
      <Section>
        <SectionHead
          kicker="combinações"
          accent="build"
          title="Times prontos. Escolha pelo resultado."
          body="Combinação é o time montado: quem entra, em que ordem, com quais gates, entregando o quê. Um briefing, um entregável."
        />
        <div className="mt-12 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FORMATIONS.map((f) => (
            <Link
              key={f.slug}
              href={`/combinacoes#${f.slug}`}
              className="group bg-panel p-6 transition-colors hover:bg-panel2"
            >
              <Kicker accent={f.accent}>{f.name}</Kicker>
              <p className="mt-3 text-base leading-snug text-ink">{f.outcome}</p>
              <div className="mt-5 space-y-1.5 border-t border-line pt-4 font-mono text-[10.5px] text-dim">
                <p>1 núcleo + {f.roster.length - 1} especialistas</p>
                <p>{f.panes}</p>
                <p>
                  {f.gates.length} gates humanos
                </p>
              </div>
            </Link>
          ))}
          <div className="flex items-center bg-panel p-6">
            <div>
              <p className="font-mono text-[13px] text-ink">Ou monte a sua.</p>
              <p className="mt-3 text-sm leading-relaxed text-mute">
                Clone o roster, troque o modelo de um papel, aperte um gate e salve. A sua formação
                vale igual às de fábrica.
              </p>
              <Link
                href="/combinacoes"
                className="mt-4 inline-block font-mono text-[10.5px] text-cmd"
              >
                ver as combinações →
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────────────── manifesto ───────────────── */}
      <Section>
        <SectionHead
          kicker="manifesto"
          accent="review"
          title="O modelo não é o teto. O harness é."
          body="O mesmo modelo entrega resultado diferente dependendo de como você o monta. É a tese que organiza o produto inteiro."
        />
        <div className="mt-12 grid gap-px bg-line lg:grid-cols-3">
          {THESES.slice(0, 3).map((t) => (
            <div key={t.n} className="bg-panel p-7">
              <p className="font-mono text-[11px] text-review">{t.n}</p>
              <h3 className="mt-4 text-lg leading-snug font-semibold">{t.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-mute">{t.body}</p>
            </div>
          ))}
        </div>
        <Link href="/manifesto" className="mt-8 inline-block font-mono text-[12px] text-cmd">
          ler as 7 teses →
        </Link>
      </Section>

      {/* ───────────────── cta ───────────────── */}
      <Section className="relative overflow-hidden">
        <div
          className="absolute inset-x-0 -bottom-32 h-64 bg-cmd/8 blur-[100px]"
          aria-hidden
        />
        <div className="relative text-center">
          <h2 className="mx-auto max-w-3xl text-3xl leading-[1.1] font-semibold sm:text-5xl">
            Pare de revezar janelas.
            <br />
            <span className="text-mute">Comece a comandar um time.</span>
          </h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button href="/features">Ver o cockpit</Button>
            <Button href="/ide-vs-ade" variant="ghost">
              IDE vs ADE, honestamente
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
