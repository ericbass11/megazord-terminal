import type { Metadata } from "next";
import { Button, Container, Kicker, Section, SectionHead } from "@/components/ui";
import { APPROACHES, CRITERIA, FAQ, SITE, WHEN_NOT } from "@/lib/site";

export const metadata: Metadata = {
  title: "IDE vs ADE",
  description:
    "Comparação honesta entre três jeitos de trabalhar com IA: time coordenado, um agente direto e copiar e colar entre janelas — incluindo quando não usar um ADE.",
};

export default function IdeVsAde() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <Container className="relative py-20">
          <Kicker accent="scout">comparação honesta</Kicker>
          <h1 className="mt-5 max-w-3xl text-[1.7rem] leading-[1.12] font-semibold sm:text-[2.25rem] lg:text-[2.75rem]">
            Três jeitos de trabalhar com IA, lado a lado.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mute">
            Não é “ADE é melhor que IDE”. São categorias diferentes com gargalos diferentes. A
            pergunta útil é: o seu trabalho hoje é escrever uma linha por vez, ou coordenar várias
            entregas ao mesmo tempo?
          </p>
        </Container>
      </div>

      {/* tabela */}
      <Section>
        <SectionHead
          kicker="cinco critérios"
          title="Onde cada abordagem ganha e onde ela trava"
        />
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line2">
                <th className="w-36 py-3 pr-4 font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                  critério
                </th>
                {APPROACHES.map((a, i) => (
                  <th key={a.id} className="py-3 pr-4 align-bottom">
                    <p
                      className={`font-mono text-[12.5px] ${i === 0 ? "text-cmd" : "text-mute"}`}
                    >
                      {a.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-dim">{a.note}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c.label} className="border-b border-line align-top">
                  <td className="py-5 pr-4 font-mono text-[12px] text-ink">{c.label}</td>
                  <td className="py-5 pr-4 text-sm leading-relaxed text-ink">
                    <span className="mr-2 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-cmd" />
                    {c.ade}
                  </td>
                  <td className="py-5 pr-4 text-sm leading-relaxed text-mute">{c.single}</td>
                  <td className="py-5 pr-4 text-sm leading-relaxed text-dim">{c.manual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* quando não usar */}
      <Section>
        <SectionHead
          kicker="honestidade"
          accent="build"
          title="Quando o ADE é a ferramenta errada"
          body="Cockpit tem overhead: briefing, contrato, gate. Em tarefa pequena isso custa mais do que resolve — e nesses casos um IDE com copilot ganha fácil."
        />
        <div className="mt-10 grid gap-px bg-line sm:grid-cols-2">
          {WHEN_NOT.map((w, i) => (
            <div key={w} className="bg-panel p-6">
              <p className="font-mono text-[11px] text-build">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="mt-3 leading-relaxed text-mute">{w}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 border-l-2 border-cmd/50 bg-panel p-6">
          <p className="leading-relaxed text-ink">
            A régua prática: se a tarefa cabe numa cabeça e numa janela, use um IDE. Se ela precisa de
            frentes paralelas, revisão independente e prova de que funcionou, ela é uma missão — e aí
            o {SITE.short} paga o overhead com folga.
          </p>
        </div>
      </Section>

      {/* faq */}
      <Section>
        <SectionHead kicker="antes de você perguntar" title="Perguntas que aparecem sempre" />
        <div className="mt-10 space-y-px bg-line">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-panel p-7">
              <h3 className="text-lg leading-snug font-semibold">{f.q}</h3>
              <p className="mt-3 max-w-3xl leading-relaxed text-mute">{f.a}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="text-center">
          <h2 className="mx-auto max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
            Se o seu gargalo é coordenação,
            <br />
            <span className="text-mute">você precisa de um ambiente pro time.</span>
          </h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button href="/features">Ver as {SITE.surfaceCount} superfícies</Button>
            <Button href="/manifesto" variant="ghost">
              Ler o manifesto
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
