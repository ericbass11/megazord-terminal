import Link from "next/link";
import type { ReactNode } from "react";
import type { Status } from "@/lib/surfaces";
import { STATUS_LABEL } from "@/lib/surfaces";

export type Accent = "cmd" | "scout" | "build" | "review" | "ctrl";

/** static class maps — Tailwind needs literal strings */
export const ACCENT: Record<
  Accent,
  { text: string; bg: string; bgSolid: string; border: string; ring: string; shadow: string }
> = {
  cmd: {
    text: "text-cmd",
    bg: "bg-cmd/10",
    bgSolid: "bg-cmd",
    border: "border-cmd/35",
    ring: "ring-cmd/30",
    shadow: "shadow-[0_0_40px_-16px_var(--color-cmd)]",
  },
  scout: {
    text: "text-scout",
    bg: "bg-scout/10",
    bgSolid: "bg-scout",
    border: "border-scout/35",
    ring: "ring-scout/30",
    shadow: "shadow-[0_0_40px_-16px_var(--color-scout)]",
  },
  build: {
    text: "text-build",
    bg: "bg-build/10",
    bgSolid: "bg-build",
    border: "border-build/35",
    ring: "ring-build/30",
    shadow: "shadow-[0_0_40px_-16px_var(--color-build)]",
  },
  review: {
    text: "text-review",
    bg: "bg-review/10",
    bgSolid: "bg-review",
    border: "border-review/35",
    ring: "ring-review/30",
    shadow: "shadow-[0_0_40px_-16px_var(--color-review)]",
  },
  ctrl: {
    text: "text-ctrl",
    bg: "bg-ctrl/10",
    bgSolid: "bg-ctrl",
    border: "border-ctrl/35",
    ring: "ring-ctrl/30",
    shadow: "shadow-[0_0_40px_-16px_var(--color-ctrl)]",
  },
};

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`border-t border-line py-20 sm:py-28 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Kicker({
  children,
  accent = "cmd",
  className = "",
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
}) {
  return (
    <p
      className={`font-mono text-[11px] font-medium tracking-[0.22em] uppercase ${ACCENT[accent].text} ${className}`}
    >
      {children}
    </p>
  );
}

export function SectionHead({
  kicker,
  title,
  body,
  accent = "cmd",
  align = "left",
}: {
  kicker?: string;
  title: ReactNode;
  body?: ReactNode;
  accent?: Accent;
  align?: "left" | "center";
}) {
  return (
    <div className={`max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      {kicker && <Kicker accent={accent}>{kicker}</Kicker>}
      <h2 className="mt-4 text-3xl leading-[1.1] font-semibold sm:text-4xl">{title}</h2>
      {body && <p className="mt-5 text-base leading-relaxed text-mute sm:text-lg">{body}</p>}
    </div>
  );
}

export function Button({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-mono text-[13px] font-medium tracking-tight px-5 py-3 transition-all duration-150";
  const styles =
    variant === "primary"
      ? "bg-cmd text-void hover:bg-cmd/85 shadow-[0_10px_40px_-18px_var(--color-cmd)]"
      : "border border-line2 text-ink hover:border-mute hover:bg-panel2";
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    live: "text-ctrl border-ctrl/30 bg-ctrl/10",
    beta: "text-build border-build/30 bg-build/10",
    wip: "text-dim border-line2 bg-panel2",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${map[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Dot({ accent = "ctrl", live = false }: { accent?: Accent; live?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${ACCENT[accent].bgSolid} ${live ? "dot-live" : ""}`}
    />
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-line bg-panel ${className}`}>{children}</div>
  );
}

export function Prose({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-5">
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className={`leading-relaxed ${i === 0 ? "text-lg text-ink" : "text-base text-mute"}`}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

export function ContrastRow({ ide, ade }: { ide: string; ade: string }) {
  return (
    <div className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
      <div className="bg-panel p-6 sm:p-8">
        <p className="font-mono text-[11px] tracking-[0.2em] text-dim uppercase">num IDE</p>
        <p className="mt-3 text-base leading-relaxed text-mute">{ide}</p>
      </div>
      <div className="relative bg-panel2 p-6 sm:p-8">
        <span className="absolute top-0 left-0 h-full w-px bg-cmd/50" />
        <p className="font-mono text-[11px] tracking-[0.2em] text-cmd uppercase">num ADE</p>
        <p className="mt-3 text-base leading-relaxed text-ink">{ade}</p>
      </div>
    </div>
  );
}
