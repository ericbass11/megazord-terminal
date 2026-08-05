import Link from "next/link";
import { SITE, NAV } from "@/lib/site";
import { LAYERS, SURFACES, type LayerId } from "@/lib/surfaces";

export default function Footer() {
  const layers = Object.keys(LAYERS) as LayerId[];
  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <p className="font-mono text-[13px] font-semibold">{SITE.name}</p>
            <p className="mt-3 text-sm leading-relaxed text-dim">{SITE.tagline}</p>
            <p className="mt-4 font-mono text-[11px] text-dim">
              $ {SITE.cli} . <span className="caret">▊</span>
            </p>
          </div>

          {layers.map((id) => (
            <div key={id}>
              <p className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">
                {LAYERS[id].name}
              </p>
              <ul className="mt-3 space-y-2">
                {SURFACES.filter((s) => s.layer === id).map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/features/${s.slug}`}
                      className="text-sm text-mute transition-colors hover:text-ink"
                    >
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[11px] text-dim">
            v{SITE.version} · {SITE.surfaceCount} superfícies · {SITE.toolCount} MCP tools
          </p>
          <div className="flex flex-wrap gap-4 sm:ml-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="font-mono text-[11px] text-dim transition-colors hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
