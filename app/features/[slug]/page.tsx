import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SurfaceVisual from "@/components/Diagrams";
import {
  ACCENT,
  Button,
  Container,
  ContrastRow,
  Kicker,
  Prose,
  Section,
  StatusBadge,
} from "@/components/ui";
import { SITE } from "@/lib/site";
import { LAYERS, SURFACES, surfaceBySlug } from "@/lib/surfaces";

export function generateStaticParams() {
  return SURFACES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = surfaceBySlug(slug);
  if (!s) return {};
  return { title: s.name, description: s.sub };
}

export default async function SurfacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = surfaceBySlug(slug);
  if (!s) notFound();

  const a = ACCENT[s.accent];
  const layer = LAYERS[s.layer];
  const idx = SURFACES.findIndex((x) => x.slug === s.slug);
  const prev = SURFACES[(idx - 1 + SURFACES.length) % SURFACES.length];
  const next = SURFACES[(idx + 1) % SURFACES.length];
  const related = s.related.map(surfaceBySlug).filter(Boolean);

  return (
    <>
      {/* hero */}
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg mask-fade absolute inset-0 opacity-30" aria-hidden />
        <div
          className={`absolute -top-32 left-1/3 h-64 w-[32rem] rounded-full blur-[110px] opacity-20 ${a.bgSolid}`}
          aria-hidden
        />
        <Container className="relative py-16 sm:py-20">
          <nav className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-dim">
            <Link href="/features" className="transition-colors hover:text-ink">
              /features
            </Link>
            <span>/</span>
            <span className={a.text}>{s.slug}</span>
            <span className="ml-3 border-l border-line pl-3">{layer.label}</span>
          </nav>

          <div className="mt-8 grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-start">
            <div>
              <Kicker accent={s.accent}>{s.name}</Kicker>
              <h1 className="mt-4 text-[1.6rem] leading-[1.14] font-semibold sm:text-[2rem] lg:text-[2.3rem]">
                {s.title}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-mute">{s.sub}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button href="/combinacoes">Ver em ação numa combinação</Button>
                <span className="font-mono text-[11px] text-dim">{s.metric}</span>
              </div>
            </div>
            <div className="lg:pt-4">
              <SurfaceVisual visual={s.visual} accent={s.accent} />
            </div>
          </div>
        </Container>
      </div>

      {/* o que é */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_320px] lg:gap-16">
          <div>
            <Kicker accent={s.accent}>o que é</Kicker>
            <div className="mt-6">
              <Prose paragraphs={s.what} />
            </div>
          </div>
          <aside className="lg:pt-9">
            <div className={`border ${a.border} ${a.bg} p-5`}>
              <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                camada
              </p>
              <p className={`mt-2 font-mono text-[13px] ${a.text}`}>{layer.name}</p>
              <p className="mt-3 text-sm leading-relaxed text-mute">{layer.body}</p>
            </div>
            <div className="mt-4 border border-line bg-panel p-5">
              <p className="font-mono text-[10.5px] tracking-[0.16em] text-dim uppercase">
                superfícies ligadas
              </p>
              <ul className="mt-3 space-y-2.5">
                {related.map((r) => (
                  <li key={r!.slug}>
                    <Link
                      href={`/features/${r!.slug}`}
                      className="group flex items-center gap-2 text-sm text-mute transition-colors hover:text-ink"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${ACCENT[r!.accent].bgSolid}`}
                      />
                      {r!.name}
                      <span className="ml-auto font-mono text-[10px] text-dim group-hover:text-cmd">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Section>

      {/* como se usa */}
      <Section>
        <Kicker accent={s.accent}>como se usa</Kicker>
        <div className="mt-8 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">
          {s.steps.map((st, i) => (
            <div key={st.title} className="bg-panel p-6 sm:p-7">
              <p className={`font-mono text-[11px] ${a.text}`}>
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-4 text-lg font-semibold">{st.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-mute">{st.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* contraste */}
      <Section>
        <Kicker accent={s.accent}>a diferença</Kicker>
        <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">
          O que muda quando o ambiente é feito pro time
        </h2>
        <div className="mt-8">
          <ContrastRow ide={s.ide} ade={s.ade} />
        </div>
      </Section>

      {/* capacidades */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker accent={s.accent}>o que já existe</Kicker>
            <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">Capacidades desta superfície</h2>
          </div>
          <p className="font-mono text-[11px] text-dim">
            {s.caps.filter((c) => c.status === "live").length} no ar ·{" "}
            {s.caps.filter((c) => c.status === "beta").length} beta ·{" "}
            {s.caps.filter((c) => c.status === "wip").length} em obra
          </p>
        </div>
        <div className="mt-8 grid gap-px bg-line sm:grid-cols-2">
          {s.caps.map((c) => (
            <div key={c.label} className="bg-panel p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-mono text-[13px] font-medium">{c.label}</h3>
                <StatusBadge status={c.status} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mute">{c.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* nav + cta */}
      <Section>
        <div className="grid gap-px bg-line sm:grid-cols-2">
          <Link href={`/features/${prev.slug}`} className="group bg-panel p-6 hover:bg-panel2">
            <p className="font-mono text-[10.5px] text-dim">← anterior</p>
            <p className="mt-2 font-mono text-[13px] group-hover:text-cmd">{prev.name}</p>
            <p className="mt-2 text-sm text-mute">{prev.card}</p>
          </Link>
          <Link
            href={`/features/${next.slug}`}
            className="group bg-panel p-6 text-right hover:bg-panel2"
          >
            <p className="font-mono text-[10.5px] text-dim">próxima →</p>
            <p className="mt-2 font-mono text-[13px] group-hover:text-cmd">{next.name}</p>
            <p className="mt-2 text-sm text-mute">{next.card}</p>
          </Link>
        </div>

        <div className="mt-16 text-center">
          <h2 className="mx-auto max-w-2xl text-2xl leading-tight font-semibold sm:text-4xl">
            {SITE.surfaceCount} superfícies. 1 cockpit.
            <br />
            <span className="text-mute">Zero janela pra revezar.</span>
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/features">Ver todas as superfícies</Button>
            <Button href="/como-funciona" variant="ghost">
              Como funciona
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
