/**
 * The Cockpit, as it runs in the browser: the Pane grid, the Mission bar with the Meter, the two human
 * answers, and the record of what the domain decided — including every Refusal, verbatim.
 *
 * ```
 * ToCockpit  ──fold──▶  Cockpit  ──render*──▶  HTML        what the human sees
 * a click    ──answerFor──▶  FromCockpit                   what the human means
 * a keypress ──keystrokesOf──▶  pane-write                 what the human types
 * ```
 *
 * ## Why this file is one module, and why it is TypeScript the browser runs
 *
 * `cockpit/server.ts` serves **one string at `/`** and there is no path to serve a second file from —
 * its declared Gap 1 says so, and this task may not edit it. So everything the browser executes has to
 * be inside that one string, which is what shapes this file:
 *
 * - **No runtime import.** Every `import` here is `import type`, erased at compile time, exactly as
 *   `cockpit/protocol.ts` is written and for the same reason: a browser cannot load `node-pty`, and
 *   `PaneStatus` lives in a module that does. So this module requires nothing at all, and the whole of
 *   it can be inlined as a single `<script type="module">`.
 * - **One file.** Two modules would need two script elements, which cannot share a scope, or a bundler,
 *   which this repo has no step for. `cockpit/view.ts` blanks the types out of this file with Node's own
 *   `stripTypeScriptTypes` and inlines the result; `view.test.ts` imports that inlined text back as a
 *   module and asserts it answers what this module answers, so "what the tests drive is what the browser
 *   runs" is measured rather than assumed.
 *
 * ## `xterm.js` is not here, and that is the decision this file is built around
 *
 * `xterm.js` is an npm package. It is **not installed** in this repository, `package.json` is outside
 * this task's scope, and `CLAUDE.md` records that the product must build and render with no network — so
 * a `<script src="https://…">` is ruled out in the one place a user would never look for it. That leaves
 * three doors, and two of them are shut:
 *
 * - **Vendor a copy into the served string.** There is no copy to vendor. Adding one means a dependency
 *   and a `package.json` edit.
 * - **Serve it from a second route.** The route does not exist and `server.ts` may not be edited here.
 * - **Draw the terminal here.** What this file does.
 *
 * So the terminal below is a small, honest emulator: a fixed screen with bounded scrollback, the control
 * characters a pty actually produces, and the CSI subset a CLI actually uses. What it costs is written
 * out in "What this terminal does not do". **If the server could be changed, the preference is a second
 * route** — `GET /xterm.js` serving a vendored copy, with `xterm` as a real dependency — because a
 * terminal emulator is a solved problem and every hour spent on this one is an hour not spent on the
 * Mission. This is the narrowest thing that draws a real process faithfully, not the right long answer.
 *
 * ## What is pure, and the one part that is not
 *
 * Everything that decides anything is a function of its arguments: the terminal fold, the Cockpit fold,
 * every `render*`, `answerFor`, `keystrokesOf`, `brl`. `attach` is the only function that touches the
 * DOM or a socket, it holds no judgement, and it is **not executed by any test** — see the Gap at the
 * foot of this file. That split is deliberate: no DOM implementation is installed in this repository
 * (`jsdom` is absent), so the choice was between logic a test can drive and logic a test cannot, and the
 * logic is all on this side of the line.
 *
 * ## The rule this file may not break
 *
 * A human gesture becomes a `MissionCommand` and goes out as `{ kind: "submit" }`. Nothing here mutates
 * a Mission, nothing here decides one, and **a Refusal is rendered**. Two consequences worth stating
 * because they look like omissions:
 *
 * - **A form is never validated against a Mission rule.** A revision with a blank reason and a Cap of
 *   `"abc"` are both *sent*, and `decide` answers each with the Refusal it already has the words for
 *   (`decisionOf` refuses a blank reason; `amountOf` refuses an amount that is not whole cents). A
 *   refused entry is not appended to the file, so this costs nothing but a red line in the record — and
 *   it buys the view holding no rule, which is the one thing it may not do. Reading the *form* is this
 *   file's (which box holds the amount); judging the *Command* is `decide`'s.
 * - **A branded value is cast, not constructed.** `Instant` and `Money` are branded and their
 *   constructors are engine functions this module cannot import. So an Instant is `toISOString()` cast,
 *   and a Cap is a number cast, and both are read back as `unknown` by the rules that compute with them.
 *   That is the sanctioned path, not a hole: `protocol.ts` casts the Command for the same reason and
 *   argues it at length.
 */

import type {
  AuthoriseCap,
  DecideGate,
  Delegation,
  Gate,
  GateId,
  Meter,
  Mission,
  Money,
  Instant,
  ReplayEntry,
} from "@engine/index";
import type { FromCockpit, ToCockpit } from "../protocol";
import type { PaneId, PaneStatus } from "../../runtime/pane-manager";

/* =================================================================================================
 * The terminal
 *
 * A screen is `rows` × `cols` cells plus bounded scrollback, and `feed` is the whole parser. It is
 * **mutable**, deliberately: a pty writes bytes by the hundred thousand and copying a grid per chunk
 * would be waste with nothing to show for it. What must be a pure fold in this product is the Mission,
 * and that one lives in the engine, on disk, and is re-derived from the file on every gesture.
 * ============================================================================================== */

/** Everything a cell can carry beyond its character. `""` for both colours means the terminal default. */
export type Pen = {
  readonly fg: string;
  readonly bg: string;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
};

/** The pen a screen starts with, and the one `SGR 0` returns to. */
export const DEFAULT_PEN: Pen = Object.freeze({
  fg: "",
  bg: "",
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
});

/**
 * One character and the inline CSS that draws it.
 *
 * The style is computed **when the cell is written**, not when it is rendered, so `htmlOfScreen` is a
 * run-length grouping over a string compare and holds no colour knowledge at all.
 */
export type Cell = {
  readonly ch: string;
  readonly style: string;
};

/** A blank cell in the default pen. Frozen and shared: a screen is mostly this. */
const BLANK: Cell = Object.freeze({ ch: " ", style: "" });

/**
 * A terminal screen: what is on it, where the cursor is, and what the pen looks like.
 *
 * `pending` is the half of an escape sequence that arrived at the end of a chunk. A pty splits wherever
 * the kernel felt like splitting, so a parser that did not keep it would mis-draw at random.
 */
export type Screen = {
  readonly rows: number;
  readonly cols: number;
  readonly maxScrollback: number;
  /** Exactly `rows` lines of exactly `cols` cells. The visible screen. */
  grid: Cell[][];
  /** Lines that scrolled off the top, oldest first, at most `maxScrollback` of them. */
  scrollback: Cell[][];
  row: number;
  col: number;
  pen: Pen;
  pending: string;
  /** What OSC 0 or OSC 2 last set. Rendered as the Pane's own title when a CLI sets one. */
  title: string;
};

/**
 * The 16 ANSI colours, in the site's palette.
 *
 * The primaries are the pilot colours `app/globals.css` already defines — `--color-cmd` is red,
 * `--color-ctrl` is green, `--color-build` is yellow, `--color-scout` is blue, `--color-review` is
 * magenta — so a CLI printing in ANSI prints in this product's colours rather than in a second visual
 * language beside them.
 */
const ANSI: readonly string[] = Object.freeze([
  "#05070a",
  "#ff3b30",
  "#12c8a0",
  "#ffb020",
  "#2e8cff",
  "#a472ff",
  "#4fd6c8",
  "#e9eff6",
  "#5b6878",
  "#ff6b62",
  "#4ae0bd",
  "#ffc65c",
  "#6bacff",
  "#bd99ff",
  "#7fe6db",
  "#ffffff",
]);

/** The largest `pending` this parser will hold before giving up on it. See `feed`. */
const MAX_PENDING = 4096;

/** A fresh screen. `rows`, `cols` and `maxScrollback` are required — see the Gap on resizing. */
export function screenOf(rows: number, cols: number, maxScrollback: number): Screen {
  return {
    rows,
    cols,
    maxScrollback,
    grid: blankGrid(rows, cols),
    scrollback: [],
    row: 0,
    col: 0,
    pen: DEFAULT_PEN,
    pending: "",
    title: "",
  };
}

function blankGrid(rows: number, cols: number): Cell[][] {
  const grid: Cell[][] = [];
  for (let row = 0; row < rows; row += 1) {
    grid.push(blankLine(cols));
  }
  return grid;
}

function blankLine(cols: number): Cell[] {
  const line: Cell[] = [];
  for (let col = 0; col < cols; col += 1) {
    line.push(BLANK);
  }
  return line;
}

/**
 * The 256-colour palette, computed rather than tabulated.
 *
 * 0–15 are the ANSI sixteen, 16–231 the 6×6×6 cube, 232–255 the greyscale ramp — the standard xterm
 * layout, which is what every CLI that emits `38;5;n` means by it.
 */
function indexedColour(index: number): string {
  if (index < 0 || index > 255) {
    return "";
  }
  if (index < 16) {
    return ANSI[index] ?? "";
  }
  if (index < 232) {
    const offset = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const red = steps[Math.floor(offset / 36) % 6] ?? 0;
    const green = steps[Math.floor(offset / 6) % 6] ?? 0;
    const blue = steps[offset % 6] ?? 0;
    return hex(red, green, blue);
  }
  const level = 8 + (index - 232) * 10;
  return hex(level, level, level);
}

function hex(red: number, green: number, blue: number): string {
  const pair = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${pair(red)}${pair(green)}${pair(blue)}`;
}

/**
 * The inline CSS one pen draws with, or `""` for the terminal default.
 *
 * `inverse` is resolved here, by swapping the two colours and defaulting whichever is missing, because a
 * cell written under `SGR 7` must keep looking inverted after the pen moves on.
 */
export function styleOf(pen: Pen): string {
  const foreground = pen.inverse ? pen.bg || "#05070a" : pen.fg;
  const background = pen.inverse ? pen.fg || "#e9eff6" : pen.bg;
  const parts: string[] = [];
  if (foreground !== "") {
    parts.push(`color:${foreground}`);
  }
  if (background !== "") {
    parts.push(`background:${background}`);
  }
  if (pen.bold) {
    parts.push("font-weight:700");
  }
  if (pen.dim) {
    parts.push("opacity:.6");
  }
  if (pen.italic) {
    parts.push("font-style:italic");
  }
  if (pen.underline) {
    parts.push("text-decoration:underline");
  }
  return parts.join(";");
}

/**
 * Everything a process wrote, folded onto a screen.
 *
 * Never throws: a chunk is bytes a CLI produced and this is the one function in the Cockpit that reads
 * all of them. An escape sequence it does not implement is **consumed and ignored**, never printed as
 * text — half-drawn garbage in a Pane is worse than a missing colour, and printing the bytes would leave
 * a human reading `[1;32m` and blaming their Zord.
 */
export function feed(screen: Screen, chunk: string): void {
  const text = screen.pending + chunk;
  screen.pending = "";
  let at = 0;

  while (at < text.length) {
    const ch = text.charAt(at);

    if (ch === "\u001b") {
      const consumed = escapeAt(screen, text, at);
      if (consumed === undefined) {
        // The sequence is split across chunks: keep it and wait. Bounded, because a stream of `\u001b[`
        // and nothing else would otherwise grow this without end; past the bound it is not a sequence
        // anybody wrote, so it is dropped rather than held for ever.
        const tail = text.slice(at);
        screen.pending = tail.length <= MAX_PENDING ? tail : "";
        return;
      }
      at += consumed;
      continue;
    }

    at += 1;

    switch (ch) {
      case "\n":
        lineFeed(screen);
        continue;
      case "\r":
        screen.col = 0;
        continue;
      case "\b":
        screen.col = Math.max(0, screen.col - 1);
        continue;
      case "\t": {
        const stop = Math.min(screen.cols - 1, (Math.floor(screen.col / 8) + 1) * 8);
        screen.col = stop;
        continue;
      }
      case "\u0007":
        // The bell. Nothing here rings, and a visible one would be a decision nobody asked for.
        continue;
      default:
        break;
    }

    if (ch < " " || ch === "\u007f") {
      // Any other C0 control, and DEL. Consumed: they are not text and this terminal implements none.
      continue;
    }

    put(screen, ch);
  }
}

/** One printable character at the cursor, wrapping at the right margin. */
function put(screen: Screen, ch: string): void {
  if (screen.col >= screen.cols) {
    screen.col = 0;
    lineFeed(screen);
  }
  const line = screen.grid[screen.row];
  if (line === undefined) {
    return;
  }
  line[screen.col] = { ch, style: styleOf(screen.pen) };
  screen.col += 1;
}

/** Down one line, scrolling the screen when the cursor is already on the last one. */
function lineFeed(screen: Screen): void {
  if (screen.row + 1 < screen.rows) {
    screen.row += 1;
    return;
  }
  const gone = screen.grid.shift();
  if (gone !== undefined) {
    screen.scrollback.push(gone);
    while (screen.scrollback.length > screen.maxScrollback) {
      screen.scrollback.shift();
    }
  }
  screen.grid.push(blankLine(screen.cols));
}

/**
 * How many characters the escape sequence at `at` occupies, or `undefined` when it is not all here yet.
 *
 * The sequence is applied as a side effect on the way past. Splitting "how long is it" from "what does
 * it do" would mean parsing it twice.
 */
function escapeAt(screen: Screen, text: string, at: number): number | undefined {
  const next = text.charAt(at + 1);
  if (next === "") {
    return undefined;
  }

  if (next === "[") {
    return csiAt(screen, text, at);
  }
  if (next === "]") {
    return oscAt(screen, text, at);
  }
  if (next === "P" || next === "X" || next === "^" || next === "_") {
    // DCS, SOS, PM, APC: a string terminated by ST. Consumed whole and ignored.
    return stringAt(text, at, 2);
  }
  if (next === "(" || next === ")" || next === "*" || next === "+" || next === "#") {
    // Character-set designation, one byte of payload.
    return text.length > at + 2 ? 3 : undefined;
  }
  // A two-character escape: `ESC M`, `ESC 7`, `ESC =`, and the rest. None is implemented.
  return 2;
}

/** A CSI sequence: parameter bytes, intermediate bytes, one final byte in `@`–`~`. */
function csiAt(screen: Screen, text: string, at: number): number | undefined {
  let scan = at + 2;
  while (scan < text.length) {
    const code = text.charCodeAt(scan);
    // Parameter bytes 0x30–0x3f, intermediate bytes 0x20–0x2f.
    if ((code >= 0x30 && code <= 0x3f) || (code >= 0x20 && code <= 0x2f)) {
      scan += 1;
      continue;
    }
    if (code >= 0x40 && code <= 0x7e) {
      applyCsi(screen, text.slice(at + 2, scan), text.charAt(scan));
      return scan + 1 - at;
    }
    // Not a CSI at all — a stray ESC followed by `[`. Consume what was scanned and carry on.
    return scan - at;
  }
  return undefined;
}

/** An OSC string, terminated by BEL or by ST. */
function oscAt(screen: Screen, text: string, at: number): number | undefined {
  const bell = text.indexOf("\u0007", at + 2);
  const st = text.indexOf("\u001b\\", at + 2);
  const end = bell < 0 ? st : st < 0 ? bell : Math.min(bell, st);
  if (end < 0) {
    return undefined;
  }
  const body = text.slice(at + 2, end);
  const semicolon = body.indexOf(";");
  const code = semicolon < 0 ? body : body.slice(0, semicolon);
  if (code === "0" || code === "2") {
    screen.title = semicolon < 0 ? "" : body.slice(semicolon + 1);
  }
  return end + (end === st ? 2 : 1) - at;
}

/** A string sequence terminated by ST, consumed whole. */
function stringAt(text: string, at: number, from: number): number | undefined {
  const st = text.indexOf("\u001b\\", at + from);
  if (st < 0) {
    return undefined;
  }
  return st + 2 - at;
}

/** The CSI subset this terminal implements. Everything else is consumed. */
function applyCsi(screen: Screen, parameters: string, final: string): void {
  if (parameters.startsWith("?") || parameters.startsWith("<") || parameters.startsWith(">")) {
    // A private-mode sequence: cursor visibility, the alternate screen buffer, mouse reporting, bracketed
    // paste. None is implemented, all are consumed. See "What this terminal does not do".
    return;
  }
  const numbers = numbersIn(parameters);
  const first = numbers[0] ?? 0;

  switch (final) {
    case "m":
      screen.pen = penAfter(screen.pen, numbers);
      return;
    case "A":
      screen.row = Math.max(0, screen.row - Math.max(1, first));
      return;
    case "B":
      screen.row = Math.min(screen.rows - 1, screen.row + Math.max(1, first));
      return;
    case "C":
      screen.col = Math.min(screen.cols - 1, screen.col + Math.max(1, first));
      return;
    case "D":
      screen.col = Math.max(0, screen.col - Math.max(1, first));
      return;
    case "G":
      screen.col = clamp(Math.max(1, first) - 1, 0, screen.cols - 1);
      return;
    case "d":
      screen.row = clamp(Math.max(1, first) - 1, 0, screen.rows - 1);
      return;
    case "H":
    case "f":
      screen.row = clamp(Math.max(1, first) - 1, 0, screen.rows - 1);
      screen.col = clamp(Math.max(1, numbers[1] ?? 1) - 1, 0, screen.cols - 1);
      return;
    case "K":
      eraseInLine(screen, first);
      return;
    case "J":
      eraseInDisplay(screen, first);
      return;
    default:
      return;
  }
}

function numbersIn(parameters: string): number[] {
  if (parameters === "") {
    return [];
  }
  return parameters.split(";").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? 0 : value;
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** SGR: the pen after a `CSI … m`. Extended colours consume their own parameters. */
function penAfter(pen: Pen, numbers: readonly number[]): Pen {
  if (numbers.length === 0) {
    return DEFAULT_PEN;
  }
  let next: Pen = pen;
  for (let at = 0; at < numbers.length; at += 1) {
    const code = numbers[at] ?? 0;
    if (code === 38 || code === 48) {
      const mode = numbers[at + 1] ?? 0;
      const colour =
        mode === 5
          ? indexedColour(numbers[at + 2] ?? 0)
          : mode === 2
            ? hex(numbers[at + 2] ?? 0, numbers[at + 3] ?? 0, numbers[at + 4] ?? 0)
            : "";
      next = code === 38 ? { ...next, fg: colour } : { ...next, bg: colour };
      at += mode === 5 ? 2 : mode === 2 ? 4 : 1;
      continue;
    }
    next = penWith(next, code);
  }
  return next;
}

function penWith(pen: Pen, code: number): Pen {
  if (code === 0) {
    return DEFAULT_PEN;
  }
  if (code === 1) {
    return { ...pen, bold: true };
  }
  if (code === 2) {
    return { ...pen, dim: true };
  }
  if (code === 3) {
    return { ...pen, italic: true };
  }
  if (code === 4) {
    return { ...pen, underline: true };
  }
  if (code === 7) {
    return { ...pen, inverse: true };
  }
  if (code === 22) {
    return { ...pen, bold: false, dim: false };
  }
  if (code === 23) {
    return { ...pen, italic: false };
  }
  if (code === 24) {
    return { ...pen, underline: false };
  }
  if (code === 27) {
    return { ...pen, inverse: false };
  }
  if (code >= 30 && code <= 37) {
    return { ...pen, fg: ANSI[code - 30] ?? "" };
  }
  if (code === 39) {
    return { ...pen, fg: "" };
  }
  if (code >= 40 && code <= 47) {
    return { ...pen, bg: ANSI[code - 40] ?? "" };
  }
  if (code === 49) {
    return { ...pen, bg: "" };
  }
  if (code >= 90 && code <= 97) {
    return { ...pen, fg: ANSI[code - 90 + 8] ?? "" };
  }
  if (code >= 100 && code <= 107) {
    return { ...pen, bg: ANSI[code - 100 + 8] ?? "" };
  }
  return pen;
}

function eraseInLine(screen: Screen, mode: number): void {
  const line = screen.grid[screen.row];
  if (line === undefined) {
    return;
  }
  const from = mode === 1 ? 0 : mode === 2 ? 0 : screen.col;
  const to = mode === 1 ? screen.col : screen.cols - 1;
  for (let col = from; col <= to && col < screen.cols; col += 1) {
    line[col] = BLANK;
  }
}

function eraseInDisplay(screen: Screen, mode: number): void {
  if (mode === 2 || mode === 3) {
    screen.grid = blankGrid(screen.rows, screen.cols);
    return;
  }
  if (mode === 1) {
    for (let row = 0; row < screen.row; row += 1) {
      screen.grid[row] = blankLine(screen.cols);
    }
    eraseInLine(screen, 1);
    return;
  }
  eraseInLine(screen, 0);
  for (let row = screen.row + 1; row < screen.rows; row += 1) {
    screen.grid[row] = blankLine(screen.cols);
  }
}

/**
 * What is on the screen as plain text, scrollback first, trailing blanks trimmed.
 *
 * The reading a test drives the terminal through, and the reading a human copies out of a Pane.
 */
export function textOf(screen: Screen): string {
  return [...screen.scrollback, ...screen.grid].map(lineText).join("\n").replace(/\n+$/u, "");
}

function lineText(line: readonly Cell[]): string {
  return line
    .map((cell) => cell.ch)
    .join("")
    .replace(/ +$/u, "");
}

/** The screen as HTML: one `<span>` per run of cells sharing a style, and a caret at the cursor. */
export function htmlOfScreen(screen: Screen): string {
  const lines = [...screen.scrollback, ...screen.grid];
  const cursorLine = screen.scrollback.length + screen.row;
  return lines.map((line, at) => htmlOfLine(line, at === cursorLine ? screen.col : -1)).join("\n");
}

function htmlOfLine(line: readonly Cell[], cursorAt: number): string {
  const width = trimmedWidth(line, cursorAt);
  let html = "";
  let runStyle: string | undefined;
  let run = "";

  const flush = (): void => {
    if (runStyle === undefined) {
      return;
    }
    html += runStyle === "" ? escapeHtml(run) : `<span style="${runStyle}">${escapeHtml(run)}</span>`;
    runStyle = undefined;
    run = "";
  };

  for (let col = 0; col < width; col += 1) {
    const cell = line[col] ?? BLANK;
    if (col === cursorAt) {
      flush();
      html += `<span class="caret" style="${cell.style}">${escapeHtml(cell.ch)}</span>`;
      continue;
    }
    if (runStyle !== cell.style) {
      flush();
      runStyle = cell.style;
    }
    run += cell.ch;
  }
  flush();
  return html;
}

/** How much of a line is worth drawing: up to its last non-blank cell, and never before the cursor. */
function trimmedWidth(line: readonly Cell[], cursorAt: number): number {
  let width = 0;
  for (let col = 0; col < line.length; col += 1) {
    const cell = line[col] ?? BLANK;
    if (cell.ch !== " " || cell.style !== "") {
      width = col + 1;
    }
  }
  return Math.max(width, cursorAt + 1);
}

/** Text as HTML. The only escaping in this file, used by every `render*` below. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/* =================================================================================================
 * Money, in the browser
 *
 * `formatMoney` and `moneyFromDecimal` are engine functions this module cannot import, so both are
 * written again here — and `client.test.ts` pins each against the engine's own answer over a table of
 * amounts, so the duplication is *proven equal* rather than hoped equal.
 * ============================================================================================== */

/** An amount of whole BRL cents, exactly as `formatMoney` writes it. */
export function brl(cents: number): string {
  if (!Number.isFinite(cents)) {
    return "—";
  }
  const digits = String(Math.trunc(Math.abs(cents))).padStart(3, "0");
  const reais = digits.slice(0, -2);
  const rest = digits.slice(-2);
  const groups: string[] = [];
  for (let end = reais.length; end > 0; end -= 3) {
    groups.unshift(reais.slice(Math.max(0, end - 3), end));
  }
  return `${cents < 0 ? "-" : ""}R$ ${groups.join(".")},${rest}`;
}

/**
 * What a human typed, as whole BRL cents, or `undefined` when it is not an amount.
 *
 * Mirrors `moneyFromDecimal` and accepts **one thing it does not**: a decimal comma. The team speaks
 * PT-BR and types `60,00`; `CONTEXT.md`'s spoken-form rule is that the language a human uses is not the
 * language the code is written in, and a decimal separator is exactly that boundary. `R$` and thousands
 * separators are accepted for the same reason — a human pastes what the Meter showed them.
 */
export function centsIn(typed: string): number | undefined {
  const cleaned = typed.trim().replace(/^R\$\s*/u, "").replace(/\./gu, "").replace(/,/gu, ".");
  const matched = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(cleaned);
  if (matched === null) {
    return undefined;
  }
  const reais = matched[1] ?? "";
  const cents = (matched[2] ?? "").padEnd(2, "0");
  const total = Number(reais) * 100 + Number(cents);
  return Number.isSafeInteger(total) ? total : undefined;
}

/* =================================================================================================
 * The Cockpit: what the browser holds
 * ============================================================================================== */

/** One Pane, as the browser knows it: what it wrote, what it last said about itself, and its slot. */
export type PaneReading = {
  readonly paneId: string;
  /** Its slot in the grid, from one, in the order the Pane was first heard from. */
  readonly ordinal: number;
  status: PaneStatus;
  readonly screen: Screen;
};

/**
 * Everything the browser holds. Mutable, and none of it is a Mission.
 *
 * `state` and `meter` are the last `mission` reading, copied and never edited — the Mission is the
 * Replay on disk, this is a photograph of what the server derived from it. `decided` is what the domain
 * answered the gestures made **on this connection**, newest last and bounded.
 */
export type Cockpit = {
  readonly panes: PaneReading[];
  state: Mission | undefined;
  meter: Meter | undefined;
  readonly decided: ReplayEntry[];
  readonly rows: number;
  readonly cols: number;
  readonly maxScrollback: number;
};

/** How many decided entries the record keeps. Older ones fall off the top. */
export const MAX_DECIDED = 60;

/** A Cockpit with nothing in it yet: what the browser holds before the first message arrives. */
export function cockpitOf(rows: number, cols: number, maxScrollback: number): Cockpit {
  return {
    panes: [],
    state: undefined,
    meter: undefined,
    decided: [],
    rows,
    cols,
    maxScrollback,
  };
}

/** What changed, so `attach` can redraw the one region that moved instead of the whole page. */
export type Change =
  | { readonly kind: "pane-screen"; readonly pane: PaneReading }
  | { readonly kind: "panes" }
  | { readonly kind: "mission" }
  | { readonly kind: "record" };

/**
 * One message from the server, folded in.
 *
 * Never throws. Every field is read as `unknown` before it is used, because a message is whatever
 * reached this tab: the Cockpit's own server sends the envelope, and this function is also the first
 * thing a hand-written frame would meet. Anything unreadable is ignored and answered `undefined` —
 * there is nothing truthful to draw for a message that says nothing.
 */
export function fold(cockpit: Cockpit, said: ToCockpit): Change | undefined {
  const message: unknown = said;
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const envelope = message as ToCockpit;

  switch (envelope.kind) {
    case "pane-data": {
      const paneId: unknown = envelope.paneId;
      const chunk: unknown = envelope.chunk;
      if (typeof paneId !== "string" || typeof chunk !== "string") {
        return undefined;
      }
      const before = cockpit.panes.length;
      const pane = paneIn(cockpit, paneId);
      feed(pane.screen, chunk);
      return cockpit.panes.length === before ? { kind: "pane-screen", pane } : { kind: "panes" };
    }

    case "pane-status": {
      const paneId: unknown = envelope.paneId;
      const status: unknown = envelope.status;
      if (typeof paneId !== "string" || typeof status !== "string") {
        return undefined;
      }
      const pane = paneIn(cockpit, paneId);
      pane.status = status as PaneStatus;
      return { kind: "panes" };
    }

    case "decided": {
      const entry: unknown = envelope.entry;
      if (typeof entry !== "object" || entry === null) {
        return undefined;
      }
      cockpit.decided.push(entry as ReplayEntry);
      while (cockpit.decided.length > MAX_DECIDED) {
        cockpit.decided.shift();
      }
      return { kind: "record" };
    }

    case "mission": {
      const state: unknown = envelope.state;
      if (typeof state !== "object" || state === null) {
        return undefined;
      }
      cockpit.state = state as Mission;
      const meter: unknown = envelope.meter;
      cockpit.meter = typeof meter === "object" && meter !== null ? (meter as Meter) : undefined;
      return { kind: "mission" };
    }

    default:
      // A member of `ToCockpit` with no branch here stops this compiling: `exhausted` takes `never`. It
      // returns rather than throws, the same shape the server uses, because a Cockpit that crashed on an
      // envelope it did not know would take the human's whole window down with it.
      exhausted(envelope);
      return undefined;
  }
}

/** The Pane with this id, created on first sight. A Pane exists because it spoke. */
function paneIn(cockpit: Cockpit, paneId: string): PaneReading {
  const known = cockpit.panes.find((pane) => pane.paneId === paneId);
  if (known !== undefined) {
    return known;
  }
  const pane: PaneReading = {
    paneId,
    ordinal: cockpit.panes.length + 1,
    // A Pane heard from before its first status is starting, which is what the process table announces
    // for one that exists and has written nothing.
    status: "starting",
    screen: screenOf(cockpit.rows, cockpit.cols, cockpit.maxScrollback),
  };
  cockpit.panes.push(pane);
  return pane;
}

/** Widen a union to `never` here and this stops compiling. Returns; the caller answers safely. */
function exhausted(_value: never): void {
  return;
}

/* =================================================================================================
 * Readings over the state
 *
 * Every one is derived at read time and none is stored — the rule `meterOf` and `stepsOf` already
 * follow. What is *not* here is a rule: none of these decides anything, they only say what the state
 * the server sent already says.
 * ============================================================================================== */

/** The Gate this Mission is stopped at, or `undefined` when a Gate is not what stopped it. */
export function haltingGate(state: Mission | undefined): Gate | undefined {
  if (state === undefined || state.status !== "halted" || state.halt.reason !== "gate-open") {
    return undefined;
  }
  const wanted = state.halt.gateId;
  const gates: unknown = state.gates;
  if (!Array.isArray(gates)) {
    return undefined;
  }
  return (gates as readonly Gate[]).find((gate) => gate.id === wanted);
}

/** Whether this Mission is stopped at its Cap, which is what an authorisation answers. */
export function stoppedAtCap(state: Mission | undefined): boolean {
  return state !== undefined && state.status === "halted" && state.halt.reason === "cap-reached";
}

/**
 * The Delegation a Pane is running, or `undefined` when this Pane is not one the Mission made.
 *
 * **The PaneId is read as a DelegationId**, and that join is the whole of how a Pane gets a provider and
 * a cost. It is not invented here: `CLAUDE.md` records the engine's own decision that "per Pane means
 * per Delegation", which is why `spent` lives on the `Delegation` and why the Meter reports
 * `perDelegation`. Nothing in the envelope carries a Pane's CLI or its cost, so this is the only
 * derivation available — and when it finds nothing, the view says **nothing**, never zero. An
 * always-zero cost in front of a human is the lie this repo keeps refusing.
 *
 * Whoever spawns a Pane for a Delegation names it with that DelegationId. That is the control plane's
 * (Task 7) and it is a declared Gap of this view — see the foot of this file.
 */
export function delegationFor(state: Mission | undefined, paneId: string): Delegation | undefined {
  if (state === undefined || state.status === "unopened") {
    return undefined;
  }
  const delegations: unknown = state.delegations;
  if (!Array.isArray(delegations)) {
    return undefined;
  }
  return (delegations as readonly Delegation[]).find((delegation) => delegation.id === paneId);
}

/** The CLI a Pane's Delegation resolved to, or `undefined` when there is no Delegation to read. */
export function providerFor(state: Mission | undefined, paneId: string): string | undefined {
  const cli: unknown = delegationFor(state, paneId)?.harness?.cli;
  return typeof cli === "string" ? cli : undefined;
}

/** What a Pane has cost, in whole BRL cents, or `undefined` when nothing attributes a cost to it. */
export function spentOn(state: Mission | undefined, paneId: string): number | undefined {
  const spent: unknown = delegationFor(state, paneId)?.spent;
  return typeof spent === "number" ? spent : undefined;
}

/** The entries whose Command was refused, oldest first. What criterion 5 asks to be visible. */
export function refusedIn(decided: readonly ReplayEntry[]): readonly ReplayEntry[] {
  return decided.filter((entry) => entry.decision.kind === "refused");
}

/* =================================================================================================
 * The two human answers
 *
 * A click carries an action name and the values of whichever boxes go with it, and this is where those
 * become a `FromCockpit`. It is the only place in the browser that builds a Command, and it builds one
 * for **every** click: a form that is not filled in is still a gesture somebody made, and `decide` is
 * what says no to it. See "The rule this file may not break".
 * ============================================================================================== */

/** What a click turned into. `unknown` is only reachable from markup nobody here wrote. */
export type Answer =
  | { readonly kind: "sends"; readonly sent: FromCockpit }
  | { readonly kind: "unknown"; readonly detail: string };

/** The actions the rendered Cockpit puts on a control. Anything else is not one of ours. */
export const ACTIONS = Object.freeze([
  "approve-gate",
  "revise-gate",
  "authorise-cap",
  "kill-pane",
] as const);

/** One of the actions the rendered Cockpit puts on a control. */
export type Action = (typeof ACTIONS)[number];

/**
 * The gesture one click means.
 *
 * `at` is the Instant, handed in rather than read from the clock, so this function is a function of its
 * arguments and a test does not have to poison `Date`. `attach` passes `new Date().toISOString()`, whose
 * shape is exactly the `Instant` the engine's own regular expression accepts.
 */
export function answerFor(
  action: string,
  values: Readonly<Record<string, string>>,
  at: string,
): Answer {
  // The cast the module doc argues for: `Instant` is branded and its constructor is an engine function
  // this module cannot import. `decide` reads `occurredAt` back and refuses what it cannot use.
  const occurredAt = at as Instant;

  switch (action) {
    case "approve-gate": {
      const command: DecideGate = {
        kind: "decide-gate",
        occurredAt,
        gateId: idAs<GateId>(values["gateId"]),
        decision: { kind: "approved" },
      };
      return sends({ kind: "submit", command });
    }

    case "revise-gate": {
      const command: DecideGate = {
        kind: "decide-gate",
        occurredAt,
        gateId: idAs<GateId>(values["gateId"]),
        decision: { kind: "revision-requested", reason: values["reason"] ?? "" },
      };
      return sends({ kind: "submit", command });
    }

    case "authorise-cap": {
      const command: AuthoriseCap = {
        kind: "authorise-cap",
        occurredAt,
        // An amount that is not one goes out as `NaN`, which is `null` on the wire, and `amountOf`
        // answers it with the Refusal it already has the words for. The alternative is a rule here.
        cap: capAs(centsIn(values["amount"] ?? "")),
      };
      return sends({ kind: "submit", command });
    }

    case "kill-pane":
      return sends({ kind: "pane-kill", paneId: idAs<PaneId>(values["paneId"]) });

    default:
      return { kind: "unknown", detail: `${JSON.stringify(action)} is not an answer this Cockpit makes` };
  }
}

function sends(sent: FromCockpit): Answer {
  return { kind: "sends", sent };
}

/**
 * A branded id, as the browser has it: a string off an attribute.
 *
 * Every id in this product is a non-blank string and nothing else, and the far side re-reads it —
 * `paneIdIn` in `protocol.ts` refuses a blank one, and `decide` refuses a GateId that names no open
 * Gate. So this is a cast with a check behind it rather than in front of it.
 */
function idAs<TId extends string>(value: string | undefined): TId {
  return (value ?? "") as TId;
}

/**
 * An amount as a Cap, including the amount that is not one.
 *
 * `undefined` becomes `NaN` rather than being refused here, and that is the "no rule in the view"
 * decision made concrete: `amountOf` in the engine already refuses a Cap that is not whole BRL cents,
 * with words a human can act on, and a second copy of that judgement in a browser is a second place the
 * rule lives.
 */
function capAs(cents: number | undefined): Money {
  return (cents ?? Number.NaN) as unknown as Money;
}

/* =================================================================================================
 * Keystrokes
 *
 * What a key means to a process. Pure, so every mapping below has a test rather than a comment.
 * ============================================================================================== */

/**
 * The bytes a keypress delivers to a pty, or `undefined` when the browser should keep the key.
 *
 * `undefined` matters: a key this does not map — `F5`, `Tab` out of the Pane, a browser shortcut — must
 * stay the browser's, so a human is never trapped inside a Pane.
 */
export function keystrokesOf(key: string, ctrl: boolean, alt: boolean): string | undefined {
  if (ctrl && !alt && key.length === 1) {
    const letter = key.toLowerCase();
    const code = letter.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      // Ctrl+A..Z is 0x01..0x1a: Ctrl+C is the interrupt, Ctrl+D the end of input.
      return String.fromCharCode(code - 96);
    }
    if (key === "[") {
      return "\u001b";
    }
    return undefined;
  }

  switch (key) {
    case "Enter":
      // CR, not LF: the line discipline turns it into the newline that completes a line — the same
      // mechanic `pty-agent-runner.ts` records for delivering an instruction.
      return "\r";
    case "Backspace":
      return "\u007f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "ArrowUp":
      return "\u001b[A";
    case "ArrowDown":
      return "\u001b[B";
    case "ArrowRight":
      return "\u001b[C";
    case "ArrowLeft":
      return "\u001b[D";
    case "Home":
      return "\u001b[H";
    case "End":
      return "\u001b[F";
    case "Delete":
      return "\u001b[3~";
    case "PageUp":
      return "\u001b[5~";
    case "PageDown":
      return "\u001b[6~";
    default:
      break;
  }

  if (alt && key.length === 1) {
    return `\u001b${key}`;
  }
  // One printable character, and nothing else: `key` is `"Shift"`, `"F5"`, `"Meta"` for the rest.
  return key.length === 1 ? key : undefined;
}

/* =================================================================================================
 * Drawing
 *
 * Every function here is `reading → HTML`. None reads the DOM, none reads a clock, none holds state.
 * ============================================================================================== */

/** The whole Cockpit: the Mission bar, the answers it is waiting for, the Pane grid, the record. */
export function renderCockpit(cockpit: Cockpit): string {
  return (
    `<header id="mission">${renderMission(cockpit)}</header>` +
    `<section id="panes">${renderPanes(cockpit)}</section>` +
    `<section id="record">${renderRecord(cockpit)}</section>`
  );
}

/** The Mission bar: where the Mission is, what it has spent against its Cap, and what it is waiting for. */
export function renderMission(cockpit: Cockpit): string {
  const state = cockpit.state;
  if (state === undefined) {
    return `<p class="waiting">waiting for the Mission</p>`;
  }
  if (state.status === "unopened") {
    return (
      `<div class="bar">${pill("unopened", "dim")}` +
      `<span class="note">no Mission has been opened in this Workspace yet</span></div>`
    );
  }

  const meter = cockpit.meter;
  const bar =
    `<div class="bar">` +
    pill(state.status, statusTone(state.status)) +
    `<h1 class="briefing">${escapeHtml(String(state.briefing))}</h1>` +
    `<span class="mode">${escapeHtml(String(state.mode))}</span>` +
    (meter === undefined ? "" : renderMeter(meter)) +
    `<span class="count">${state.delegations.length} delegation` +
    `${state.delegations.length === 1 ? "" : "s"}</span>` +
    `</div>`;

  return bar + renderAnswers(cockpit);
}

/** The Meter: the Cap, what has been spent against it, and whether it has been reached. */
export function renderMeter(meter: Meter): string {
  const spent = typeof meter.spent === "number" ? meter.spent : Number.NaN;
  const cap = typeof meter.cap === "number" ? meter.cap : Number.NaN;
  const share = Number.isFinite(spent) && Number.isFinite(cap) && cap > 0 ? spent / cap : 0;
  const filled = Math.max(0, Math.min(100, Math.round(share * 100)));
  return (
    `<span class="meter${meter.reached === true ? " reached" : ""}">` +
    `<span class="gauge"><span class="fill" style="width:${filled}%"></span></span>` +
    `<span class="spent">${escapeHtml(brl(spent))}</span>` +
    `<span class="cap">of ${escapeHtml(brl(cap))}</span>` +
    (meter.reached === true ? `<span class="flag">Cap reached</span>` : "") +
    `</span>`
  );
}

/**
 * What the Mission is waiting for a human to answer: a Gate decision, or a Cap authorisation.
 *
 * Nothing is offered when nothing is waiting, which is why this is derived from the halt rather than
 * from a flag: a control that is present and inert is a control a human will press.
 */
export function renderAnswers(cockpit: Cockpit): string {
  const gate = haltingGate(cockpit.state);
  if (gate !== undefined) {
    return (
      `<div class="answer gate" data-answer="gate">` +
      `<h2>A Gate is open</h2>` +
      `<p class="question">${escapeHtml(String(gate.question))}</p>` +
      `<input type="hidden" data-value="gateId" value="${escapeHtml(String(gate.id))}">` +
      `<div class="controls">` +
      `<button type="button" data-action="approve-gate">Approve</button>` +
      `<input type="text" data-value="reason" placeholder="what to revise, and why">` +
      `<button type="button" data-action="revise-gate">Request revision</button>` +
      `</div></div>`
    );
  }

  if (stoppedAtCap(cockpit.state)) {
    const spent = cockpit.meter?.spent;
    return (
      `<div class="answer cap" data-answer="cap">` +
      `<h2>The Cap has been reached</h2>` +
      `<p class="question">This Mission has spent ` +
      `${escapeHtml(brl(typeof spent === "number" ? spent : Number.NaN))} and commissions no more work ` +
      `until a higher Cap is authorised.</p>` +
      `<div class="controls">` +
      `<input type="text" data-value="amount" placeholder="the new Cap, in reais">` +
      `<button type="button" data-action="authorise-cap">Authorise</button>` +
      `</div></div>`
    );
  }

  return "";
}

/** The Pane grid: one live terminal per Pane, with its status, its provider and what it has cost. */
export function renderPanes(cockpit: Cockpit): string {
  if (cockpit.panes.length === 0) {
    return `<p class="waiting">no Pane has opened yet</p>`;
  }
  return cockpit.panes.map((pane) => renderPane(cockpit, pane)).join("");
}

/** One Pane. The terminal is its own element so a chunk redraws it without touching anything else. */
export function renderPane(cockpit: Cockpit, pane: PaneReading): string {
  const provider = providerFor(cockpit.state, pane.paneId);
  const spent = spentOn(cockpit.state, pane.paneId);
  return (
    `<article class="pane" id="pane-${pane.ordinal}" data-pane="${escapeHtml(pane.paneId)}">` +
    `<div class="head">` +
    pill(pane.status, paneTone(pane.status)) +
    `<span class="zord">${escapeHtml(pane.paneId)}</span>` +
    `<span class="provider">${provider === undefined ? "provider unattributed" : escapeHtml(provider)}</span>` +
    `<span class="cost">${spent === undefined ? "—" : escapeHtml(brl(spent))}</span>` +
    `<button type="button" data-action="kill-pane" data-value-paneId="${escapeHtml(pane.paneId)}">Kill</button>` +
    `</div>` +
    (pane.screen.title === "" ? "" : `<div class="title">${escapeHtml(pane.screen.title)}</div>`) +
    `<pre class="screen" id="screen-${pane.ordinal}" tabindex="0">${htmlOfScreen(pane.screen)}</pre>` +
    `</article>`
  );
}

/**
 * The record: what the domain answered every gesture made on this connection, newest first.
 *
 * A Refusal is drawn with its **reason and every violation**, which is why the whole entry travels: the
 * protocol carries it verbatim precisely so a human reads what the domain said rather than a summary
 * somebody wrote about it. A Refusal carries a *list*, and all of it is shown — one violation would
 * send a human round the loop twice.
 */
export function renderRecord(cockpit: Cockpit): string {
  if (cockpit.decided.length === 0) {
    return `<p class="waiting">nothing has been decided on this connection yet</p>`;
  }
  return [...cockpit.decided]
    .reverse()
    .map((entry) => renderEntry(entry))
    .join("");
}

/** One Decision. Refused or accepted, and never softened either way. */
export function renderEntry(entry: ReplayEntry): string {
  const kind: unknown = entry.command?.kind;
  const intent = typeof kind === "string" ? kind : "an unreadable Command";

  if (entry.decision.kind === "refused") {
    const refusal = entry.decision.refusal;
    const violations: unknown = refusal?.violations;
    const lines = Array.isArray(violations) ? (violations as readonly unknown[]) : [];
    return (
      `<div class="entry refused">` +
      `<span class="intent">${escapeHtml(intent)}</span>` +
      `<span class="verdict">refused</span>` +
      `<span class="reason">${escapeHtml(String(refusal?.reason ?? "unstated"))}</span>` +
      `<ul class="violations">` +
      lines.map((line) => `<li>${escapeHtml(String(line))}</li>`).join("") +
      `</ul></div>`
    );
  }

  const events: unknown = entry.decision.events;
  const facts = Array.isArray(events) ? (events as readonly { readonly kind?: unknown }[]) : [];
  return (
    `<div class="entry accepted">` +
    `<span class="intent">${escapeHtml(intent)}</span>` +
    `<span class="verdict">accepted</span>` +
    `<ul class="facts">` +
    facts.map((fact) => `<li>${escapeHtml(String(fact.kind ?? "an unreadable Event"))}</li>`).join("") +
    `</ul></div>`
  );
}

function pill(label: string, tone: string): string {
  return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

/** The pilot colour a Mission status is drawn in. The palette is `app/globals.css`'s, unchanged. */
function statusTone(status: string): string {
  if (status === "running") {
    return "ctrl";
  }
  if (status === "halted") {
    return "build";
  }
  if (status === "delivered") {
    return "scout";
  }
  if (status === "killed") {
    return "cmd";
  }
  return "dim";
}

/**
 * The pilot colour a Pane status is drawn in — **six of them**, which is every member of `PaneStatus`.
 *
 * The site promises eight Zord states and this is not that list, deliberately: two of the site's eight
 * ("aguardando gate", "hibernado") are not things a pty can report. `pane-manager.ts` records why
 * "waiting for you" is not modelled, and hibernation is out of scope in this PRD. Drawing a state the
 * process table can never announce would be a pill no rule fills.
 */
function paneTone(status: PaneStatus): string {
  switch (status) {
    case "working":
      return "ctrl";
    case "idle":
      return "build";
    case "delivered":
      return "scout";
    case "failed":
      return "cmd";
    case "killed":
      return "review";
    case "starting":
      return "dim";
    default:
      exhausted(status);
      return "dim";
  }
}

/* =================================================================================================
 * The DOM binding
 *
 * The only impure function in this file, and the only one no test executes — no DOM implementation is
 * installed in this repository, so it is kept down to plumbing: read a message, fold it, redraw the one
 * region that moved, and turn a click or a keypress into a frame. Every judgement it needs is above.
 * ============================================================================================== */

/** What `attach` needs from the world. A socket and a root, and nothing else. */
export type Wiring = {
  readonly root: HTMLElement;
  readonly send: (sent: FromCockpit) => void;
  /** The clock, injected so the one impure reading in a gesture is visible at the call site. */
  readonly now: () => string;
};

/**
 * Binds a Cockpit to a page.
 *
 * Redraws by region: a Pane's bytes touch only that Pane's `<pre>`, so a stream of output never rebuilds
 * the answer a human is halfway through typing into. A status change rebuilds the grid, a `mission`
 * rebuilds the bar and the answers, a `decided` rebuilds the record.
 */
export function attach(cockpit: Cockpit, wiring: Wiring): (said: ToCockpit) => void {
  const { root } = wiring;
  root.innerHTML = renderCockpit(cockpit);

  const region = (id: string): HTMLElement | null => root.querySelector(`#${id}`);

  const redraw = (change: Change | undefined): void => {
    if (change === undefined) {
      return;
    }
    if (change.kind === "pane-screen") {
      const screen = region(`screen-${change.pane.ordinal}`);
      if (screen !== null) {
        screen.innerHTML = htmlOfScreen(change.pane.screen);
        screen.scrollTop = screen.scrollHeight;
        return;
      }
    }
    const panes = region("panes");
    const mission = region("mission");
    const record = region("record");
    if (mission !== null) {
      mission.innerHTML = renderMission(cockpit);
    }
    if (panes !== null) {
      panes.innerHTML = renderPanes(cockpit);
    }
    if (record !== null) {
      record.innerHTML = renderRecord(cockpit);
    }
  };

  root.addEventListener("click", (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest("[data-action]");
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const action = button.dataset["action"] ?? "";
    const answer = answerFor(action, valuesAround(button), wiring.now());
    if (answer.kind === "sends") {
      wiring.send(answer.sent);
    }
  });

  root.addEventListener("keydown", (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const screen = target.closest(".screen");
    const pane = target.closest("[data-pane]");
    if (screen === null || !(pane instanceof HTMLElement)) {
      return;
    }
    const keystrokes = keystrokesOf(event.key, event.ctrlKey, event.altKey);
    if (keystrokes === undefined) {
      return;
    }
    event.preventDefault();
    wiring.send({ kind: "pane-write", paneId: idAs<PaneId>(pane.dataset["pane"]), keystrokes });
  });

  return (said: ToCockpit): void => {
    redraw(fold(cockpit, said));
  };
}

/**
 * The values a control's answer needs: its own `data-value-*`, and the boxes in the block it sits in.
 *
 * Reading the block rather than a form because the two answers are two blocks, and a `<form>` would
 * bring a submit event and a page navigation this page has no use for.
 */
function valuesAround(button: HTMLElement): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  const block = button.closest("[data-answer]") ?? button.closest("[data-pane]") ?? button;
  for (const field of block.querySelectorAll("[data-value]")) {
    if (field instanceof HTMLInputElement) {
      const name = field.dataset["value"];
      if (name !== undefined) {
        values[name] = field.value;
      }
    }
  }
  for (const [name, value] of Object.entries(button.dataset)) {
    if (name.startsWith("value") && name !== "value" && typeof value === "string") {
      const key = name.slice("value".length);
      values[key.charAt(0).toLowerCase() + key.slice(1)] = value;
    }
  }
  return values;
}

/* =================================================================================================
 * What this terminal does not do, and the Gaps of this view
 *
 * ## The terminal
 *
 * 1. **No alternate screen buffer.** `CSI ?1049h` is consumed, so a full-screen CLI (`vim`, a TUI
 *    installer) draws over the scrollback instead of beside it. What a Zord CLI prints is a stream of
 *    lines, which is the case this is built for.
 * 2. **No insert/delete line or character** (`L`, `M`, `P`, `@`), no scroll region (`r`), no tab stops
 *    (`H` as HTS). A CLI that redraws a progress bar with them leaves the bar behind.
 * 3. **No reflow and no resize.** `rows` and `cols` are fixed when a screen is made and the process is
 *    never told a size, so a CLI that reads `COLUMNS` from its pty gets the pty's, not this screen's.
 *    The two agree only if whoever spawns the Pane uses the same numbers.
 * 4. **One column per code point.** A CJK character or an emoji occupies one cell here and two on the
 *    process's own idea of the screen, so a line of them drifts. No combining-mark handling either.
 * 5. **No mouse, no bracketed paste, no focus reporting.** All consumed.
 * 6. **No UTF-8 assembly.** The server hands over a string the pty already decoded; a code point split
 *    across two reads is `node-pty`'s problem, not this one's.
 *
 * ## The view
 *
 * 1. **A Pane's provider and cost are the PaneId read as a DelegationId.** Nothing in the envelope
 *    carries either, and the engine's own rule is that per Pane means per Delegation. When the join
 *    finds nothing the Pane says "provider unattributed" and "—", never zero. Whoever spawns a Pane for
 *    a Delegation must name it with that DelegationId, and that belongs to the control plane.
 * 2. **The record starts when the connection does.** `mission` carries the state, not the Replay, so a
 *    Refusal decided before this tab connected is not shown — and the server's Gap 4 means a Refusal
 *    decided for *another* client is not broadcast at all. Both are fixed on the server's side of the
 *    envelope, by sending the Replay on connect or by broadcasting `decided`; neither is the view's to
 *    change, and the view already draws every entry it is given.
 * 3. **`Step` and `stepsOf` are not used, because they cannot be.** They are engine functions and the
 *    browser holds no engine. So `renderEntry` writes its own one line per entry from the `ReplayEntry`
 *    the protocol carried, and `client.test.ts` pins the set of Refusals it draws against
 *    `refusedIn(stepsOf(replay))` over the same Replay, so the two readings are proven to agree.
 * 4. **No `kill-mission`.** The PRD names three human answers at a Gate — approve, revise, kill — and
 *    this task's scope names two. A Mission stopped at its Cap whose human does **not** want to spend
 *    more therefore has no answer in this view; the Command exists in the engine and the gesture is four
 *    lines. Recorded as a finding rather than added, because scope is the contract.
 * 5. **`attach` is not executed by a test.** `jsdom` is not installed in this repository and
 *    `package.json` is outside this task's scope, so there is no DOM to drive. Everything it decides is
 *    a pure function above it with its own test; what is unproven is the wiring — that the click
 *    listener finds the button, that the values come off the right boxes, that the region ids match the
 *    markup. Installing `jsdom` and driving `attach` is the first thing to do when a dependency may be
 *    added.
 */
