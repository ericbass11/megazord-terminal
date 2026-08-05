"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV, SITE } from "@/lib/site";

function Mark() {
  return (
    <span className="grid grid-cols-3 gap-[2px]" aria-hidden>
      {[
        "bg-cmd",
        "bg-scout",
        "bg-build",
        "bg-review",
        "bg-cmd",
        "bg-ctrl",
        "bg-build",
        "bg-scout",
        "bg-review",
      ].map((c, i) => (
        <span key={i} className={`h-[3px] w-[3px] ${c}`} />
      ))}
    </span>
  );
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-void/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group">
          <Mark />
          <span className="font-mono text-[13px] font-semibold tracking-tight">
            {SITE.short}
            <span className="text-dim group-hover:text-cmd transition-colors">/terminal</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 font-mono text-[12px] transition-colors ${
                  active ? "text-cmd" : "text-mute hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/features"
            className="ml-3 bg-cmd px-4 py-2 font-mono text-[12px] font-medium text-void transition-colors hover:bg-cmd/85"
          >
            Ver o cockpit
          </Link>
        </nav>

        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto font-mono text-[12px] text-mute md:hidden"
          aria-expanded={open}
          aria-label="Menu"
        >
          {open ? "[ fechar ]" : "[ menu ]"}
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-panel md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block border-b border-line px-5 py-3.5 font-mono text-[13px] text-mute"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
