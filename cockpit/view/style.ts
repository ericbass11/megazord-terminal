/**
 * The Cockpit's stylesheet, inlined into the one document the server serves.
 *
 * ## Why this is plain CSS and not Tailwind
 *
 * The marketing site is Tailwind v4 and its tokens live in `app/globals.css` under `@theme`. Tailwind
 * needs a build step to turn a class list into rules, and this document is produced at runtime by
 * `cockpit/view.ts` — there is no step to add and `package.json` is outside this task's scope. So the
 * **tokens are copied and the rules are written by hand**, which is the narrow version of "reuse those
 * exact tokens rather than inventing a second visual language": every colour below is a value that
 * already exists in `app/globals.css`, spelled the same way, under the same custom-property name.
 *
 * What that costs is a second copy of eleven hex values. If the site's palette moves, this file has to
 * move with it, and nothing enforces that — `view.test.ts` pins the values against `app/globals.css` by
 * reading both, so the copy fails loudly rather than drifting quietly.
 *
 * Two rules are lifted verbatim rather than approximated: `--font-mono` (the whole stack) and `.grid-bg`
 * (the cockpit texture).
 *
 * `.caret` and its `blink` keyframes are **gone**, removed by Task 10 rather than left as dead rules:
 * they drew the hand-rolled emulator's own cursor, and `xterm.js`'s own stylesheet (`css/xterm.css`,
 * served from `XTERM_PATH` and linked into the document by `cockpit/view.ts`) draws a real terminal's
 * cursor now. A rule nothing emits is the same lie as a comment describing code that no longer runs.
 */

/** The palette, exactly as `@theme` in `app/globals.css` declares it. Pinned by `view.test.ts`. */
export const TOKENS: ReadonlyMap<string, string> = new Map([
  ["--color-void", "#05070a"],
  ["--color-panel", "#0a0e14"],
  ["--color-panel2", "#10161f"],
  ["--color-line", "#1a2432"],
  ["--color-line2", "#26323f"],
  ["--color-ink", "#e9eff6"],
  ["--color-mute", "#8494a6"],
  ["--color-dim", "#5b6878"],
  ["--color-cmd", "#ff3b30"],
  ["--color-scout", "#2e8cff"],
  ["--color-build", "#ffb020"],
  ["--color-review", "#a472ff"],
  ["--color-ctrl", "#12c8a0"],
]);

function declarations(): string {
  return [...TOKENS].map(([name, value]) => `  ${name}: ${value};`).join("\n");
}

/** The whole stylesheet, as the text of a `<style>` element. */
export const STYLE: string = `:root {
${declarations()}
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono",
    "Cascadia Mono", Menlo, Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; border-color: var(--color-line); }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background-color: var(--color-void);
  background-image: linear-gradient(to right, color-mix(in srgb, var(--color-line) 55%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--color-line) 55%, transparent) 1px, transparent 1px);
  background-size: 56px 56px;
  color: var(--color-ink);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
#cockpit { display: flex; flex-direction: column; gap: 14px; padding: 14px; min-height: 100%; }
::selection { background: color-mix(in srgb, var(--color-cmd) 35%, transparent); }

.waiting { color: var(--color-dim); margin: 0; padding: 10px 12px; }

.pill {
  text-transform: uppercase;
  letter-spacing: .08em;
  font-size: 10px;
  padding: 2px 7px;
  border: 1px solid currentColor;
  border-radius: 999px;
  white-space: nowrap;
}
.pill.dim { color: var(--color-dim); }
.pill.mute { color: var(--color-mute); }
.pill.cmd { color: var(--color-cmd); }
.pill.scout { color: var(--color-scout); }
.pill.build { color: var(--color-build); }
.pill.review { color: var(--color-review); }
.pill.ctrl { color: var(--color-ctrl); }

/* ---------- the Mission bar ---------- */
#mission {
  border: 1px solid var(--color-line);
  background: var(--color-panel);
  border-radius: 10px;
}
#mission .bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
}
#mission .briefing { font-size: 13px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
#mission .mode, #mission .count, #mission .note { color: var(--color-mute); font-size: 11px; }
#mission .meter { display: flex; align-items: center; gap: 8px; margin-left: auto; }
#mission .gauge {
  display: block;
  width: 120px;
  height: 5px;
  border-radius: 999px;
  background: var(--color-line2);
  overflow: hidden;
}
#mission .fill { display: block; height: 100%; background: var(--color-ctrl); }
#mission .meter.reached .fill { background: var(--color-cmd); }
#mission .spent { font-variant-numeric: tabular-nums; }
#mission .cap { color: var(--color-mute); font-variant-numeric: tabular-nums; }
#mission .flag { color: var(--color-cmd); font-size: 11px; }

/* ---------- the two human answers ---------- */
.answer {
  border-top: 1px solid var(--color-line);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.answer h2 { margin: 0; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
.answer.gate h2 { color: var(--color-build); }
.answer.cap h2 { color: var(--color-cmd); }
.answer .question { margin: 0; color: var(--color-ink); }
.answer .controls { display: flex; gap: 8px; flex-wrap: wrap; }
.answer input[type="text"] {
  flex: 1 1 260px;
  min-width: 180px;
  background: var(--color-void);
  border: 1px solid var(--color-line2);
  border-radius: 6px;
  color: var(--color-ink);
  font: inherit;
  padding: 6px 9px;
}
.answer input[type="text"]:focus { outline: none; border-color: var(--color-scout); }
button {
  background: var(--color-panel2);
  border: 1px solid var(--color-line2);
  border-radius: 6px;
  color: var(--color-ink);
  font: inherit;
  padding: 6px 12px;
  cursor: pointer;
}
button:hover { border-color: var(--color-ink); }
.answer.gate button[data-action="approve-gate"] { border-color: color-mix(in srgb, var(--color-ctrl) 55%, transparent); color: var(--color-ctrl); }
.answer.cap button { border-color: color-mix(in srgb, var(--color-cmd) 55%, transparent); color: var(--color-cmd); }

/* ---------- the Pane grid ---------- */
#panes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 14px;
  flex: 1 1 auto;
  align-content: start;
}
.pane {
  border: 1px solid var(--color-line);
  background: var(--color-panel);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 240px;
}
.pane .head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-panel2);
}
.pane .zord { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane .provider { color: var(--color-scout); font-size: 11px; }
.pane .cost { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--color-build); }
.pane .head button { padding: 2px 8px; font-size: 11px; }
/*
 * The mount point xterm.js's Terminal.open fills — empty until then, which is why this carries no
 * white-space or text rules of its own any more: what used to draw text here was Task 6's hand-rolled
 * emulator, and xterm.js's own stylesheet (linked into the document, see the module doc) draws
 * everything inside it, including its cursor. Sizing and the pre-mount background are this file's;
 * everything about how a character looks is xterm.css's.
 */
.pane .screen {
  flex: 1 1 auto;
  overflow: hidden;
  background: var(--color-void);
  color: var(--color-ink);
}
.pane .screen:focus { outline: 1px solid var(--color-scout); outline-offset: -1px; }

/* ---------- the record ---------- */
#record {
  border: 1px solid var(--color-line);
  background: var(--color-panel);
  border-radius: 10px;
  max-height: 30vh;
  overflow: auto;
}
.entry {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-line);
}
.entry:last-child { border-bottom: none; }
.entry .intent { font-weight: 600; }
.entry .verdict { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.entry.accepted .verdict { color: var(--color-ctrl); }
.entry.refused .verdict { color: var(--color-cmd); }
.entry.refused { background: color-mix(in srgb, var(--color-cmd) 7%, transparent); }
.entry .reason { color: var(--color-cmd); }
.entry .violations, .entry .facts { margin: 0; padding-left: 18px; flex: 1 1 100%; }
.entry .violations li { color: var(--color-ink); }
.entry .facts li { color: var(--color-mute); }
`;
