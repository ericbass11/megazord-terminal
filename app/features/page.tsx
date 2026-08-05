import Link from "next/link";
import type { Metadata } from "next";
import { ACCENT, Button, Container, Kicker, Section, SectionHead } from "@/components/ui";
import { SITE } from "@/lib/site";
import { LAYERS, SURFACES, type LayerId } from "@/lib/surfaces";

export const metadata: Metadata = {
  title: "Superfícies",
  description: `As ${SITE.surfaceCount} superfícies do ADE: cada uma resolve um problema de coordenação de time de IAs.`,
};

const ORDER: LayerId[] = ["comando", "time", "contexto", "controle"];

export default function FeaturesIndex() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <Container className="relative py-20">
          <Kicker>/features</Kicker>
          <h1 className="mt-5 max-w-3xl text-[1.7rem] leading-[1.12] font-semibold sm:text-[2.25rem] lg:text-[2.75rem]">
            {SITE.surfaceCount} superfícies de coordenação.
            <br />
            <span className="text-mute">Uma delas é um editor — e é a menos importante.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mute">
            Num IDE, tudo orbita o arquivo aberto. Aqui, tudo orbita o time: como a ordem entra, quem
            executa, o que eles compartilham e como você mantém o controle sem virar um clicador de
            “sim”.
          </p>
          <div className="mt-9 flex flex-wrap gap-2">
            {ORDER.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                className="border border-line2 px-3 py-1.5 font-mono text-[11.5px] text-mute transition-colors hover:border-mute hover:text-ink"
              >
                {LAYERS[id].label}
              </a>
            ))}
          </div>
        </Container>
      </div>

      {ORDER.map((id) => {
        const layer = LAYERS[id];
        const items = SURFACES.filter((s) => s.layer === id);
        return (
          <Section key={id} id={id} className="!border-t-0">
            <SectionHead
              kicker={layer.label}
              accent={items[0].accent}
              title={layer.name}
              body={layer.body}
            />
            <div className="mt-10 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => (
                <Link
                  key={s.slug}
                  href={`/features/${s.slug}`}
                  className="group flex flex-col bg-panel p-6 transition-colors hover:bg-panel2"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${ACCENT[s.accent].bgSolid}`} />
                    <h3 className="font-mono text-sm font-medium">{s.name}</h3>
                    <span className="ml-auto font-mono text-[10px] text-dim">{s.metric}</span>
                  </div>
                  <p className="mt-3.5 flex-1 text-sm leading-relaxed text-mute">{s.card}</p>
                  <div className="mt-5 border-t border-line pt-3.5">
                    <p className="font-mono text-[10px] text-dim">
                      num ADE: <span className="text-mute">{s.ade}</span>
                    </p>
                    <p className="mt-3 font-mono text-[10.5px] text-dim transition-colors group-hover:text-cmd">
                      abrir superfície →
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        );
      })}

      <Section>
        <div className="text-center">
          <h2 className="text-3xl font-semibold sm:text-4xl">Tudo isso pra uma coisa só:</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-mute">
            você descreve o resultado e um time de IAs entrega — com contrato, gate, custo à vista e
            replay de tudo que aconteceu.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button href="/combinacoes">Ver as combinações</Button>
            <Button href="/manifesto" variant="ghost">
              Ler o manifesto
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
