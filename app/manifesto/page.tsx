import type { Metadata } from "next";
import { Button, Container, ContrastRow, Kicker, Section, SectionHead } from "@/components/ui";
import { SITE, THESES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Manifesto",
  description:
    "Sete teses sobre por que o ambiente de desenvolvimento mudou de categoria: do IDE pro ADE.",
};

export default function Manifesto() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <Container className="relative py-20 sm:py-24">
          <Kicker accent="review">manifesto</Kicker>
          <h1 className="mt-5 max-w-3xl text-[1.7rem] leading-[1.12] font-semibold sm:text-[2.25rem] lg:text-[2.75rem]">
            O gargalo deixou de ser escrever código.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mute">
            Escrever ficou barato. Coordenar quem escreve, contra qual contrato, a que custo, com
            qual aprovação — isso ficou caro. Um IDE não tem opinião sobre nada disso, porque não foi
            feito pra isso. O {SITE.short} tem sete.
          </p>
        </Container>
      </div>

      <Section>
        <div className="space-y-px bg-line">
          {THESES.map((t) => (
            <article key={t.n} className="bg-panel p-7 sm:p-9">
              <div className="grid gap-6 lg:grid-cols-[80px_1fr] lg:gap-10">
                <p className="font-mono text-2xl text-review/70">{t.n}</p>
                <div>
                  <h2 className="max-w-2xl text-xl leading-snug font-semibold sm:text-2xl">
                    {t.title}
                  </h2>
                  <p className="mt-4 max-w-3xl leading-relaxed text-mute">{t.body}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHead
          kicker="a consequência"
          accent="cmd"
          title="Se essas sete coisas são verdade, o produto muda de forma."
          body="Não dá pra colar coordenação de time na lateral de um editor de texto. O centro da tela precisa ser o time, o orquestrador precisa ser incapaz de executar, e custo, contrato e gate precisam ser objetos de primeira classe."
        />
        <div className="mt-10">
          <ContrastRow
            ide="Um editor com IA na lateral, um modelo escolhido no dropdown e a fatura no fim do mês."
            ade="Um cockpit onde 12 agentes trabalham à vista, cada um com harness próprio, contra contrato assinado, com teto de gasto e replay auditável."
          />
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button href="/features">Ver as {SITE.surfaceCount} superfícies</Button>
          <Button href="/ide-vs-ade" variant="ghost">
            E quando não usar
          </Button>
        </div>
      </Section>
    </>
  );
}
