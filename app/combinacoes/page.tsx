import Link from "next/link";
import type { Metadata } from "next";
import { ACCENT, Button, Container, Kicker, Section, SectionHead } from "@/components/ui";
import { FORMATIONS, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Combinações",
  description:
    "Times prontos de IAs que combinam num entregável só: site publicado, app funcionando, SaaS cobrando, automação instalada, game jogável.",
};

export default function Combinacoes() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <Container className="relative py-20">
          <Kicker accent="build">combinações</Kicker>
          <h1 className="mt-5 max-w-3xl text-[1.7rem] leading-[1.12] font-semibold sm:text-[2.25rem] lg:text-[2.75rem]">
            Cinco zords combinam.
            <br />
            <span className="text-mute">Sai um entregável, não cinco pedaços.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mute">
            Combinação é o time montado: quem entra, em que ordem, com quais gates, entregando o quê.
            Você escolhe pelo resultado — o roster, o harness e o contrato já vêm resolvidos.
          </p>
          <div className="mt-9 flex flex-wrap gap-2">
            {FORMATIONS.map((f) => (
              <a
                key={f.slug}
                href={`#${f.slug}`}
                className="border border-line2 px-3 py-1.5 font-mono text-[11.5px] text-mute transition-colors hover:border-mute hover:text-ink"
              >
                {f.name}
              </a>
            ))}
          </div>
        </Container>
      </div>

      {FORMATIONS.map((f) => {
        const a = ACCENT[f.accent];
        return (
          <Section key={f.slug} id={f.slug}>
            <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
              <div>
                <Kicker accent={f.accent}>{f.name}</Kicker>
                <h2 className="mt-4 text-2xl leading-snug font-semibold sm:text-3xl">
                  {f.outcome}
                </h2>
                <div className={`mt-6 border-l-2 ${a.border} bg-panel p-5`}>
                  <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                    briefing
                  </p>
                  <p className="mt-2 leading-relaxed text-ink">{f.brief}</p>
                </div>

                <div className="mt-7 grid grid-cols-3 gap-px bg-line">
                  {[
                    ["panes", f.panes.replace(" panes", "")],
                    ["gates humanos", String(f.gates.length)],
                    ["especialistas", String(f.roster.length - 1)],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-panel p-4">
                      <p className={`font-mono text-lg ${a.text}`}>{v}</p>
                      <p className="mt-1 font-mono text-[10px] text-dim">{k}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-7">
                  <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                    gates
                  </p>
                  <ol className="mt-3 space-y-2">
                    {f.gates.map((g, i) => (
                      <li key={g} className="flex gap-3 text-sm text-mute">
                        <span className="font-mono text-[11px] text-dim">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {g}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div>
                <div className="border border-line bg-panel">
                  <div className="border-b border-line bg-panel2 px-4 py-2.5">
                    <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                      roster · {f.panes}
                    </p>
                  </div>
                  <ul className="divide-y divide-line">
                    {f.roster.map((r) => (
                      <li
                        key={r.role}
                        className="grid grid-cols-[10px_minmax(0,148px)_1fr] items-baseline gap-x-3 px-4 py-3"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 rounded-full ${ACCENT[r.accent].bgSolid}`}
                        />
                        <span className={`font-mono text-[12px] ${ACCENT[r.accent].text}`}>
                          {r.role}
                        </span>
                        <span className="text-sm leading-snug text-mute sm:text-right">{r.job}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-line bg-panel2 px-4 py-3">
                    <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                      entrega
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.delivers.map((d) => (
                        <span
                          key={d}
                          className="border border-line2 px-2 py-1 font-mono text-[10px] text-mute"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-4 font-mono text-[10.5px] text-dim">
                  roster editável: troque CLI, modelo e effort por papel, aperte um gate e salve como
                  sua.
                </p>
              </div>
            </div>
          </Section>
        );
      })}

      <Section>
        <SectionHead
          kicker="por que isso encaixa"
          accent="review"
          title="Trabalho paralelo só é ganho quando o merge é garantido antes"
          body="Toda combinação nasce com uma fase de contrato: a interface é assinada antes de qualquer builder escrever a primeira linha. É o que separa cinco agentes entregando rápido de cinco agentes gerando merge hell."
        />
        <div className="mt-9 flex flex-wrap gap-3">
          <Button href="/features/contratos">Ver Contratos</Button>
          <Button href="/features/gates" variant="ghost">
            Ver Gates
          </Button>
        </div>
      </Section>

      <Section>
        <div className="text-center">
          <h2 className="mx-auto max-w-2xl text-3xl leading-tight font-semibold sm:text-4xl">
            Um briefing. Um time. Uma entrega.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-mute">
            E as {SITE.surfaceCount} superfícies do cockpit existem pra você acompanhar isso sem
            perder o fio.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/features">Ver as superfícies</Button>
            <Link
              href="/como-funciona"
              className="inline-flex items-center px-5 py-3 font-mono text-[13px] text-mute hover:text-ink"
            >
              como funciona →
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
