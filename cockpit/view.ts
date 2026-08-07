/**
 * The one string `cockpit/server.ts` serves at `/`.
 *
 * ```
 * cockpit/view/client.ts  ──stripTypeScriptTypes──▶  JavaScript  ──▶  <script type="module">
 * cockpit/view/style.ts   ──────────────────────────────────────────▶  <style>
 * ```
 *
 * ## The constraint, and how the client reaches the browser
 *
 * The server serves **one document and no assets** — its declared Gap 1 — so everything the browser
 * needs is inside this string. There is no bundler in this repository and no build step this task may
 * add, and `<script src="https://…">` is out: `CLAUDE.md` records that the product builds and renders
 * with no network, and a CDN would break that in the one place nobody would look.
 *
 * So the client is authored as **real, typechecked TypeScript** (`view/client.ts`) whose every import is
 * `import type`, and this module blanks the types out of it with Node's own
 * `module.stripTypeScriptTypes` and inlines the result. Three things make that the right shape rather
 * than a trick:
 *
 * - **It is the same mechanism the rest of this repository runs on.** Nothing here is compiled: `mz` is
 *   a `.ts` file and Node strips its types to run it. The client is stripped by the same stripper, one
 *   layer earlier, because its destination is a browser instead of this process.
 * - **The types are blanked, not removed**, so the JavaScript the browser runs has the same line and
 *   column numbers as the TypeScript a human reads. A stack trace from the page points at `client.ts`.
 * - **The inlined text is executed by the tests.** `view.test.ts` imports it back through a `data:` URL
 *   and asserts it answers exactly what `client.ts` answers, so "what the tests drive is what the
 *   browser runs" is measured rather than claimed.
 *
 * What it costs, stated plainly:
 *
 * 1. **`stripTypeScriptTypes` is experimental.** Node prints one `ExperimentalWarning` to stderr per
 *    process the first time it is called, and the API may change. The alternatives were a hand-written
 *    type stripper (worse than an experimental builtin from the same vendor as the runtime), the
 *    TypeScript compiler API (a devDependency called at runtime), or a string of untypechecked
 *    JavaScript in a `.ts` file (which is what this exists to avoid).
 * 2. **The client is read from disk at serve time**, so `client.ts` must sit beside this module. A tree
 *    compiled to JavaScript elsewhere — the way `mission-store.test.ts` compiles one to prove a fresh
 *    process can read a Replay — would not carry it. Declared Gap 2 below.
 * 3. **Erasable syntax only.** `client.ts` may not use an `enum`, a `namespace`, a `declare`, or a
 *    parameter property, because `mode: "strip"` refuses them. It uses none, and the test that imports
 *    the stripped text is what would catch one.
 *
 * ## What is not here
 *
 * No token in the URL, no session, no CSP. The server binds loopback and refuses a foreign `Origin`, and
 * its own declared Gap says authentication belongs to whoever starts it. This module adds no security of
 * its own and claims none.
 *
 * ## `xterm.js`, read from the installed package and served same-origin
 *
 * `cockpit/view/client.ts` no longer draws a Pane's bytes itself — it hands them to an `xterm.js`
 * `Terminal`, and that terminal's own JavaScript and CSS have to reach the browser somehow. Task 6's
 * client could not add the dependency or the route; this task can, and `xtermAssets()` below is the
 * reader `cockpit/server.ts`'s `xterm` option asks for, the same shape `clientScript()` already is for
 * `view`.
 *
 * The document references both files with a **same-origin** `<script src="${XTERM_PATH}/xterm.js">` and
 * `<link rel="stylesheet" href="${XTERM_PATH}/xterm.css">` — paths on this server, never a URL naming
 * another host. `view.test.ts`'s "asks the browser for nothing" check reads for exactly that difference:
 * a `<script src="https://…">` or `<script src="//…">` is a CDN and stays refused; a `<script
 * src="/xterm/xterm.js">` names this server's own second route and is what "no CDN" was always about —
 * fetching nothing **external**, not fetching nothing at all. Say this here too, because a future reader
 * scanning this file for `<script src` should not mistake one for the other.
 *
 * The classic `<script src>` is placed **before** the module script, and deliberately not `type="module"`
 * itself: a classic script runs synchronously at its place in the document, so `window.Terminal` — the
 * global `@xterm/xterm`'s UMD bundle attaches when there is no module system to find — exists before the
 * deferred module script that constructs one ever runs. A second `import` of `@xterm/xterm` from the
 * module script was rejected for the reason `client.ts` already refuses any runtime import: a browser
 * has nowhere to resolve a bare specifier from, with no bundler and no import map in this repository.
 */

import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";

import { STYLE } from "./view/style";
import { XTERM_PATH } from "./server";

/** Where the client lives. Read at serve time — see cost 2 in the module doc. */
export const CLIENT_SOURCE = new URL("./view/client.ts", import.meta.url);

/**
 * Where the installed `@xterm/xterm` package's browser bundle and stylesheet live.
 *
 * Resolved through Node's own module resolution rather than a relative path from this file, because
 * `node_modules` is not a fixed distance from `cockpit/view.ts` — hoisting, a workspace, a package
 * manager's own layout can all move it. `createRequire(import.meta.url).resolve` is Node's own answer to
 * "where does a bare specifier actually live", not a path this module invents or assumes.
 */
const resolve = createRequire(import.meta.url);
export const XTERM_JS_SOURCE = resolve.resolve("@xterm/xterm/lib/xterm.js");
export const XTERM_CSS_SOURCE = resolve.resolve("@xterm/xterm/css/xterm.css");

/** How many rows, columns and scrollback lines a Pane's screen is drawn with. */
export const SCREEN = Object.freeze({ rows: 24, cols: 100, maxScrollback: 2000 });

/**
 * A document that cannot be composed, because inlining what it was given would break the page.
 *
 * Refused rather than escaped: a script containing `</script` would end the element early and the rest
 * of it would be rendered as text, which is a page that silently half-works. The same standard the
 * envelope holds for a message that cannot be JSON — say so, send nothing.
 */
export class UnservableViewError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this view cannot be served: ${detail}`);
    this.name = "UnservableViewError";
    this.detail = detail;
  }
}

/**
 * The client as JavaScript a browser runs: `view/client.ts` with its types blanked out.
 *
 * Separate from `cockpitView` so a test can read the shipped text on its own and execute it.
 */
export async function clientScript(): Promise<string> {
  const source = await readFile(CLIENT_SOURCE, "utf8");
  return stripTypeScriptTypes(source, { mode: "strip" });
}

/**
 * `xterm.js`'s browser bundle and stylesheet, read from the installed package.
 *
 * Separate from `cockpitView` for the same reason `clientScript` is: a test reads the shipped bytes on
 * their own, and `cockpit/server.ts`'s `xterm` option asks for exactly this shape.
 */
export async function xtermAssets(): Promise<{ readonly js: string; readonly css: string }> {
  const [js, css] = await Promise.all([
    readFile(XTERM_JS_SOURCE, "utf8"),
    readFile(XTERM_CSS_SOURCE, "utf8"),
  ]);
  return { js, css };
}

/**
 * The whole document, given the client's JavaScript.
 *
 * Pure, and separate from reading the file, so the composition is testable without a disk and the
 * refusal below can be driven with a script nobody had to write to a file.
 *
 * @throws {UnservableViewError} when the script or the stylesheet would break out of its element.
 */
export function documentOf(script: string): string {
  refuseBreakout("the script", script, ["</script"]);
  refuseBreakout("the stylesheet", STYLE, ["</style"]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Cockpit — Megazord Terminal</title>
<link rel="stylesheet" href="${XTERM_PATH}/xterm.css">
<style>
${STYLE}
</style>
</head>
<body>
<main id="cockpit"></main>
<noscript>The Cockpit draws live processes, so it needs JavaScript. Nothing here works without it.</noscript>
<script src="${XTERM_PATH}/xterm.js"></script>
<script type="module">
${script}

const cockpit = cockpitOf(${SCREEN.rows}, ${SCREEN.cols}, ${SCREEN.maxScrollback}, (rows, cols, scrollback) => new Terminal({ rows, cols, scrollback }));
const root = document.getElementById("cockpit");
if (root !== null) {
  const socket = new WebSocket(new URL("/", location.href).href.replace(/^http/u, "ws"));
  const heard = attach(cockpit, {
    root,
    send: (sent) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(sent));
      }
    },
    now: () => new Date().toISOString(),
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      heard(JSON.parse(event.data));
    }
  });
}
</script>
</body>
</html>
`;
}

/** The view, ready to hand to `cockpitServer` as its `view`. */
export async function cockpitView(): Promise<string> {
  return documentOf(await clientScript());
}

function refuseBreakout(what: string, text: string, forbidden: readonly string[]): void {
  for (const sequence of forbidden) {
    const at = text.toLowerCase().indexOf(sequence);
    if (at >= 0) {
      throw new UnservableViewError(
        `${what} contains ${JSON.stringify(sequence)} at offset ${at}, which would end its element early`,
      );
    }
  }
}

/* =================================================================================================
 * Declared Gaps
 *
 * 1. **The bootstrap at the foot of the document is not typechecked.** Ten lines of JavaScript inside a
 *    template literal: build the Cockpit, open the socket, hand `attach` a `send` and a clock. It is
 *    here rather than in `client.ts` because `client.ts` is a module a test imports, and a module that
 *    opened a WebSocket on import could not be imported. What keeps it honest is that it holds no
 *    decision — every name it calls (`cockpitOf`, `attach`) is exported and tested — and `view.test.ts`
 *    asserts each of those names is really exported by the stripped script, so a rename fails a test
 *    instead of a page.
 * 2. **`client.ts` is read from disk relative to this module.** A tree compiled to JavaScript and moved
 *    elsewhere would not carry the `.ts` file, and `cockpitView` would reject with `ENOENT`. Whoever
 *    packages this decides between shipping the source beside the output and stripping it at build
 *    time; nothing here pretends to have made that decision.
 * 3. **The stylesheet's tokens are a copy of `app/globals.css`.** Pinned by a test that reads both, so
 *    the copy fails loudly, but it is still a copy — Tailwind needs a build step and this document is
 *    composed at runtime.
 * 4. **`bin/mz.ts` does not call `xtermAssets()` yet.** It is outside this task's editable scope — see
 *    `cockpit/server.ts`'s declared Gap on the same collaborator. `xtermAssets()` exists and is tested on
 *    its own; wiring it into the real `mz .` run is a one-line addition (`xterm: await xtermAssets()`)
 *    for whoever owns that file.
 * ============================================================================================== */
