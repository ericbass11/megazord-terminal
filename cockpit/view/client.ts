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
 * `cockpit/server.ts` serves the document itself at `/` and nothing else composed the way this file is —
 * Task 10 gave it a second route, but that route serves `xterm.js`'s own installed bundle verbatim, not
 * anything assembled from TypeScript. Everything **this file** contributes to the page still has to be
 * inside the one document string `cockpit/view.ts` composes, which is what shapes this file:
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
 * ## `xterm.js` is here now, and it never appears in this file's imports
 *
 * Task 6 drew a hand-rolled terminal emulator in this module because `xterm.js` was not installed,
 * `server.ts` had no second route, and a `<script src="https://…">` is ruled out everywhere in this
 * repository. Task 10 closes all three: `@xterm/xterm` is a real dependency, `cockpit/server.ts` serves
 * its bundle from `XTERM_PATH`, and `cockpit/view.ts` loads it same-origin, before the module script that
 * needs it, as a classic `<script src>` that leaves a global `Terminal` behind — the way a UMD bundle
 * behaves with no module system to find. That global is never referenced by name in this file, and that
 * is deliberate rather than an oversight: **the whole point of "every import here is `import type`" is
 * that this module requires nothing to run**, and reaching for `window.Terminal` directly would tie a
 * pure fold to a name that only exists in a browser that has already loaded a `<script>` this file cannot
 * see. So a Pane's terminal is **injected** instead, through `Cockpit.terminalOf` — a factory that builds
 * something shaped like `TerminalLike`, below. The bootstrap at the foot of `cockpit/view.ts` is the one
 * place that actually writes `new Terminal(...)`, because it is the one piece of this whole page that is
 * not typechecked and not imported by a test (see that module's Declared Gap 1); everything on this side
 * of the injection is ordinary, testable TypeScript that has never heard of `@xterm/xterm`.
 *
 * The hand-rolled emulator — the screen grid, the CSI/OSC parser, the ANSI palette, the HTML it drew — is
 * **deleted**, not kept as a fallback: `xterm.js` implements every one of the six things its own module
 * doc listed as missing (the alternate buffer, insert/delete line, a scroll region, reflow, wide
 * characters, mouse reporting), so a fallback path would be exactly the second terminal that module doc
 * argued against keeping once a real one exists, and nothing in this codebase would ever choose it. What
 * a Pane's bytes become is now `xterm.js`'s question, asked once per Pane, and this file's job shrinks to
 * "get the bytes there and mount the result" — see `TerminalLike`, `fold`'s `pane-data` case and
 * `syncPanes` in `attach`.
 *
 * ## What is pure, and the one part that is not
 *
 * Everything that decides anything is a function of its arguments: the Cockpit fold, every `render*`,
 * `answerFor`, `keystrokesOf`, `brl`. `attach` is the only function that touches the DOM or a socket and
 * it holds no judgement. That split is deliberate: no DOM implementation is installed in this repository
 * (`jsdom` is absent), so the choice was between logic a test can drive and logic a test cannot, and the
 * logic is all on this side of the line.
 *
 * `fold`'s `pane-data` case is the one place that reaches slightly past "pure" on purpose, and it is not
 * new: Task 6's `feed` mutated a `Screen` in place for the same reason `TerminalLike.write` mutates a
 * terminal's buffer in place now — copying a grid, or a terminal's internal state, per chunk would be
 * waste with nothing to show for it. What must be a pure fold in this product is the Mission, and that
 * one lives in the engine, on disk, and is re-derived from the file on every gesture. Constructing a
 * `TerminalLike` itself is **not** a DOM operation — `new Terminal(options)` builds a parser and a buffer
 * with no browser underneath it, which is what makes `fold` able to call `cockpit.terminalOf(...)` at
 * all — only **mounting** one (`TerminalLike.open`) touches a page, and that stays inside `attach`.
 *
 * `attach` **is** executed now, over the markup the renderers really produce, under the small DOM
 * `client.test.ts` argues for at length ("A DOM small enough to be honest"). What that closes is the hole
 * QA measured: the one line that turns a click into a frame could be deleted and every test stayed green.
 * What it does not close is a browser — see the Gap at the foot of this file.
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
  KillMission,
  Meter,
  Mission,
  Money,
  Instant,
  ReplayEntry,
} from "@engine/index";
import type { FromCockpit, ToCockpit } from "../protocol";
import type { PaneId, PaneStatus } from "../../runtime/pane-manager";

/* =================================================================================================
 * The terminal, as this file now sees it
 *
 * `xterm.js` owns the screen grid, the CSI/OSC parser, the ANSI palette and the DOM it paints into —
 * everything Task 6's hand-rolled emulator did, and more, which is why that emulator is gone rather than
 * kept beside it. This file only needs to name the handful of members it actually calls.
 * ============================================================================================== */

/**
 * The handful of an `xterm.js` `Terminal` this file needs, named structurally rather than imported.
 *
 * A real `@xterm/xterm` `Terminal` satisfies this by construction — TypeScript's structural typing needs
 * no `implements` for it — and so does a lightweight fake with no library behind it at all, which is what
 * lets a wiring test build a `Cockpit` without ever loading `@xterm/xterm`. The module doc explains why
 * this is a structural type and not `import type { Terminal } from "@xterm/xterm"`: naming the real type
 * here would still be erased at compile time, but it would also make this file's only sanctioned path to
 * a terminal an **exact** match to a library's own surface — dozens of methods a fake would have to stub
 * to satisfy the assignment — where three methods are the whole of what a Pane needs from one.
 */
export type TerminalLike = {
  /**
   * Feeds a Pane's bytes to the terminal. Fire-and-forget: `xterm.js` parses and repaints on its own
   * schedule once it is open, and nothing here waits for that — see `fold`'s `pane-data` case.
   */
  write(data: string): void;
  /**
   * Mounts the terminal's own DOM into `container`, once. Called by `attach`'s `syncPanes` the first time
   * a Pane's container exists; never called again for the same terminal — see `syncPanes` for why a
   * rebuilt `#panes` region does not mean calling this twice.
   */
  open(container: HTMLElement): void;
};

/** How a Pane's terminal is built. Rows, columns and scrollback — the same three `SCREEN` already names. */
export type TerminalFactory = (rows: number, cols: number, scrollback: number) => TerminalLike;

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
  const bare = typed.trim().replace(/^R\$\s*/u, "");
  // **Which separator is the decimal point is decided by the text, never by stripping one first.** A
  // comma present means PT-BR notation, so the dots are thousands and the comma is the point; a comma
  // absent means the engine's own notation, where the dot *is* the point — and stripping dots first
  // turned `48.5` into R$ 485,00. The pin against `moneyFromDecimal` is what caught that.
  const cleaned = bare.includes(",")
    ? bare.replace(/\./gu, "").replace(/,/gu, ".")
    : bare;
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

/** One Pane, as the browser knows it: what it last said about itself, its slot, and its terminal. */
export type PaneReading = {
  readonly paneId: string;
  /** Its slot in the grid, from one, in the order the Pane was first heard from. */
  readonly ordinal: number;
  status: PaneStatus;
  /** Where its bytes go. Built once, by `cockpit.terminalOf`, and never replaced. */
  readonly terminal: TerminalLike;
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
  /** How a new Pane's terminal is built. Injected so this module never names `@xterm/xterm` itself. */
  readonly terminalOf: TerminalFactory;
};

/** How many decided entries the record keeps. Older ones fall off the top. */
export const MAX_DECIDED = 60;

/** A Cockpit with nothing in it yet: what the browser holds before the first message arrives. */
export function cockpitOf(
  rows: number,
  cols: number,
  maxScrollback: number,
  terminalOf: TerminalFactory,
): Cockpit {
  return {
    panes: [],
    state: undefined,
    meter: undefined,
    decided: [],
    rows,
    cols,
    maxScrollback,
    terminalOf,
  };
}

/** What changed, so `attach` can redraw the one region that moved instead of the whole page. */
export type Change =
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
      // Fed straight through: `xterm.js` parses and repaints on its own schedule, so there is nothing
      // for a redraw to do for bytes landing on a Pane that already has a mounted terminal. A brand-new
      // Pane still needs its shell built and its terminal opened, which is what `{ kind: "panes" }` asks
      // `attach`'s `syncPanes` to do.
      pane.terminal.write(chunk);
      return cockpit.panes.length === before ? undefined : { kind: "panes" };
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
    // Built now, mounted later: construction touches no DOM (see the module doc), so `fold` can do this
    // without `attach` ever having run — `client.test.ts` proves exactly that with a fixture that never
    // calls `attach` at all.
    terminal: cockpit.terminalOf(cockpit.rows, cockpit.cols, cockpit.maxScrollback),
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

/**
 * The Gate this Mission is stopped at, or `undefined` when a Gate is not what stopped it.
 *
 * **The Halt is read as `unknown`**, like the Gate list beside it and like `renderEntry` reads a Refusal.
 * A Mission arrives here off a socket, and the server folded it from a file `runtime/mission-store.ts`
 * deliberately does not judge (ADR 0009) — so a `mission-halted` fact whose `halt` was lost folds cleanly
 * to `{ status: "halted", halt: null }` and reaches this function. Dereferencing `state.halt.reason` threw
 * `TypeError` **inside the socket's `message` handler**, where nothing catches it: the Cockpit then drew
 * nothing at all, for that frame and every later one, and said nothing about why. That was BUG-2, and it is
 * the same defect the engine closed in `added()` (`engine/domain/replay.ts`) for the same fact.
 *
 * The answer to a Halt nobody can read is **nothing to offer**, never a plausible default: a Halt whose
 * reason was lost must not read as a Cap, because that is a different fact and it sends a human to the
 * wrong remedy. The rest of the Cockpit — the bar, the Meter, the Panes, the record — draws.
 *
 * Every condition stays inline in its `if`, because TypeScript does not narrow through an aliased compound
 * condition that uses `in`.
 */
export function haltingGate(state: Mission | undefined): Gate | undefined {
  if (state === undefined || state.status !== "halted") {
    return undefined;
  }
  const halt: unknown = state.halt;
  if (
    typeof halt !== "object" ||
    halt === null ||
    !("reason" in halt) ||
    halt.reason !== "gate-open"
  ) {
    return undefined;
  }
  // A Halt that says it is a Gate and names none is a Gate this view cannot offer an answer to: the
  // Command carries a GateId, and inventing one would answer a question nobody asked.
  const wanted: unknown = "gateId" in halt ? halt.gateId : undefined;
  const gates: unknown = state.gates;
  if (typeof wanted !== "string" || !Array.isArray(gates)) {
    return undefined;
  }
  // And the **elements** as `unknown` too: guarding the list and then dereferencing what is in it is the
  // half of this rule that is easy to miss. A `find` callback reading `gate.id` off a list holding `null`
  // throws in the same place, for the same reason.
  const held: readonly unknown[] = gates;
  for (const gate of held) {
    if (typeof gate === "object" && gate !== null && "id" in gate && gate.id === wanted) {
      return gate as Gate;
    }
  }
  return undefined;
}

/**
 * Whether this Mission is stopped at its Cap, which is what an authorisation answers.
 *
 * The Halt is read as `unknown` for the reason `haltingGate` states above. The equality is what keeps the
 * answer truthful: a Halt whose reason was lost is not a Cap, so this says `false` and the view offers
 * nothing rather than an Authorisation for a Mission that may be waiting on something else entirely.
 */
export function stoppedAtCap(state: Mission | undefined): boolean {
  if (state === undefined || state.status !== "halted") {
    return false;
  }
  const halt: unknown = state.halt;
  return (
    typeof halt === "object" && halt !== null && "reason" in halt && halt.reason === "cap-reached"
  );
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
  // The elements as `unknown` as well — see `haltingGate` for why the list alone is not enough.
  const held: readonly unknown[] = delegations;
  for (const delegation of held) {
    if (
      typeof delegation === "object" &&
      delegation !== null &&
      "id" in delegation &&
      delegation.id === paneId
    ) {
      return delegation as Delegation;
    }
  }
  return undefined;
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
  "kill-mission",
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

    case "kill-mission": {
      const command: KillMission = {
        kind: "kill-mission",
        occurredAt,
        // A blank reason is sent rather than refused here, for the reason every other answer in this
        // file is: `decideKillMission` already has the words for it ("a kill-mission Command must carry
        // the reason it was ended for, and this one does not"), and a second copy of that judgement in a
        // browser is a second place the rule lives.
        reason: values["reason"] ?? "",
      };
      return sends({ kind: "submit", command });
    }

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
  if (ctrl && key.length === 1) {
    const control = controlByte(key);
    if (control === undefined) {
      return undefined;
    }
    // Alt is the meta prefix, so Ctrl+Alt+R is ESC then **Ctrl+R** — the control byte, not the letter.
    // Sending ESC and `r` would deliver a different keystroke under the same name, which is the one
    // thing a terminal must never do.
    return alt ? `\u001b${control}` : control;
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

/**
 * The control byte a key produces when Ctrl is held, or `undefined` when it produces none.
 *
 * `Ctrl+A`..`Ctrl+Z` are 0x01..0x1a — `Ctrl+C` the interrupt, `Ctrl+D` the end of input — and the five
 * punctuation keys below carry the rest of the C0 range, which is where `Ctrl+[` being ESC comes from.
 * Anything else with Ctrl held is a browser shortcut and stays the browser's.
 */
function controlByte(key: string): string | undefined {
  const code = key.toLowerCase().charCodeAt(0);
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 96);
  }
  const punctuation: Readonly<Record<string, number>> = {
    "[": 27,
    "\\": 28,
    "]": 29,
    "^": 30,
    _: 31,
    " ": 0,
  };
  const byte = punctuation[key];
  return byte === undefined ? undefined : String.fromCharCode(byte);
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
  // Read as `unknown`, for the reason `haltingGate` states: this Mission was folded from a file nothing
  // judged, and `delegations.length` off a fact that lost its list would throw in the socket listener and
  // take the whole Cockpit down with it. A list nobody can read is not "0 delegations", which would be a
  // number in front of a human that no rule computed.
  const delegations: unknown = state.delegations;
  const made = Array.isArray(delegations) ? delegations.length : undefined;
  const bar =
    `<div class="bar">` +
    pill(state.status, statusTone(state.status)) +
    `<h1 class="briefing">${escapeHtml(String(state.briefing))}</h1>` +
    `<span class="mode">${escapeHtml(String(state.mode))}</span>` +
    (meter === undefined ? "" : renderMeter(meter)) +
    `<span class="count">` +
    (made === undefined
      ? "a delegation list this Mission does not carry"
      : `${made} delegation${made === 1 ? "" : "s"}`) +
    `</span>` +
    `</div>`;

  return bar + (state.status === "killed" ? renderKilled(state) : "") + renderAnswers(cockpit);
}

/**
 * The one line a killed Mission adds to the bar: that it ended with no Delivery, and why.
 *
 * What tells a killed Mission apart from a delivered one is not only the pill's label and tone
 * (`statusTone` already answers those two differently) — it is this line, because "killed" alone reads
 * as a fault and a human reading a Replay needs the reason a person gave for ending it. `reason` is read
 * as `unknown`, for the reason `haltingGate` states: this Mission was folded from a file nothing judged,
 * and a killed Mission whose reason was lost must say so rather than draw a blank a human cannot explain.
 */
function renderKilled(state: Mission): string {
  const record: unknown = state;
  const reason: unknown =
    typeof record === "object" && record !== null && "reason" in record
      ? (record as { reason: unknown }).reason
      : undefined;
  return (
    `<p class="killed-reason">Ended with no Delivery — ` +
    `${escapeHtml(typeof reason === "string" && reason !== "" ? reason : "no reason recorded")}</p>`
  );
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
 * Whether this Mission currently accepts `kill-mission`.
 *
 * Matches `decideKillMission`'s guard in `engine/domain/mission.ts` **exactly** rather than a plausible
 * approximation, per this task's own instruction not to guess it: running, or halted by whichever Halt
 * stopped it — a Gate or the Cap alike, because Kill answers no Gate and is not blocked by the Cap either
 * (`CLAUDE.md`: "Kill is not a Gate decision", "the kill because ending a Mission spends nothing"). A
 * Mission this predicate says no to is `unopened`, `delivered` or already `killed` — nothing left to end.
 */
export function killable(state: Mission | undefined): boolean {
  return state !== undefined && (state.status === "running" || state.status === "halted");
}

/**
 * What the Mission is waiting for a human to answer: a Gate decision, a Cap authorisation, and — while
 * running or halted at all — the option to end it instead.
 *
 * Nothing situational is offered when nothing is waiting, which is why the Gate/Cap half is derived from
 * the halt rather than from a flag: a control that is present and inert is a control a human will press.
 * Kill is different on purpose: it is not an answer to a *question* the Mission is asking, so it is
 * offered whenever `killable` says the engine would accept it, Gate or Cap or neither.
 */
export function renderAnswers(cockpit: Cockpit): string {
  const gate = haltingGate(cockpit.state);
  let situational = "";
  if (gate !== undefined) {
    situational =
      `<div class="answer gate" data-answer="gate">` +
      `<h2>A Gate is open</h2>` +
      `<p class="question">${escapeHtml(String(gate.question))}</p>` +
      `<input type="hidden" data-value="gateId" value="${escapeHtml(String(gate.id))}">` +
      `<div class="controls">` +
      `<button type="button" data-action="approve-gate">Approve</button>` +
      `<input type="text" data-value="reason" placeholder="what to revise, and why">` +
      `<button type="button" data-action="revise-gate">Request revision</button>` +
      `</div></div>`;
  } else if (stoppedAtCap(cockpit.state)) {
    const spent = cockpit.meter?.spent;
    situational =
      `<div class="answer cap" data-answer="cap">` +
      `<h2>The Cap has been reached</h2>` +
      `<p class="question">This Mission has spent ` +
      `${escapeHtml(brl(typeof spent === "number" ? spent : Number.NaN))} and commissions no more work ` +
      `until a higher Cap is authorised.</p>` +
      `<div class="controls">` +
      `<input type="text" data-value="amount" placeholder="the new Cap, in reais">` +
      `<button type="button" data-action="authorise-cap">Authorise</button>` +
      `</div></div>`;
  }

  const kill = killable(cockpit.state)
    ? `<div class="answer kill" data-answer="kill">` +
      `<h2>End the Mission</h2>` +
      `<p class="question">Ends the Mission with no Delivery. An open Gate, if there is one, is left ` +
      `unanswered.</p>` +
      `<div class="controls">` +
      `<input type="text" data-value="reason" placeholder="why this Mission is ending">` +
      `<button type="button" data-action="kill-mission">Kill</button>` +
      `</div></div>`
    : "";

  return situational + kill;
}

/** The Pane grid: one live terminal per Pane, with its status, its provider and what it has cost. */
export function renderPanes(cockpit: Cockpit): string {
  if (cockpit.panes.length === 0) {
    return `<p class="waiting">no Pane has opened yet</p>`;
  }
  return cockpit.panes.map((pane) => renderPane(cockpit, pane)).join("");
}

/**
 * One Pane's chrome: its status, provider, cost and Kill control. Split out of `renderPane` so `attach`
 * can refresh it — on a status change, a Delegation join that just started answering, a cost update —
 * **without** touching `.screen`, which is the one element in this Pane an `xterm.js` `Terminal` mounts
 * itself into and must never see rebuilt out from under it. See `syncPanes`.
 */
export function renderPaneHead(cockpit: Cockpit, pane: PaneReading): string {
  const provider = providerFor(cockpit.state, pane.paneId);
  const spent = spentOn(cockpit.state, pane.paneId);
  return (
    pill(pane.status, paneTone(pane.status)) +
    `<span class="zord">${escapeHtml(pane.paneId)}</span>` +
    `<span class="provider">${provider === undefined ? "provider unattributed" : escapeHtml(provider)}</span>` +
    `<span class="cost">${spent === undefined ? "—" : escapeHtml(brl(spent))}</span>` +
    // The PaneId travels as the **value** of a `data-value` box, exactly as the Gate's does, and not as
    // part of an attribute *name*. See `valuesAround` for what the other spelling cost.
    `<input type="hidden" data-value="paneId" value="${escapeHtml(pane.paneId)}">` +
    `<button type="button" data-action="kill-pane">Kill</button>`
  );
}

/**
 * One Pane's whole shell: the chrome, and an **empty** mount point for its terminal.
 *
 * Rendered once, when a Pane is first added to the grid — never again for the same Pane, because
 * `.screen`'s content from that point on is `xterm.js`'s, mounted by `attach`'s `syncPanes` and written
 * to by `fold`'s `pane-data` case, neither of which goes through this function. `renderPaneHead` is what
 * a later chrome update re-renders.
 */
export function renderPane(cockpit: Cockpit, pane: PaneReading): string {
  return (
    `<article class="pane" id="pane-${pane.ordinal}" data-pane="${escapeHtml(pane.paneId)}">` +
    `<div class="head" id="head-${pane.ordinal}">${renderPaneHead(cockpit, pane)}</div>` +
    `<div class="screen" id="screen-${pane.ordinal}" tabindex="0"></div>` +
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

  // The Decision itself, before either branch reads its payload: `entry.decision.kind` off an entry that
  // lost its Decision throws exactly where the Halt did. Everything after this guard is the typed
  // reading, because the entry has now said which member it is.
  const decided: unknown = entry.decision;
  if (typeof decided !== "object" || decided === null || !("kind" in decided)) {
    return (
      `<div class="entry">` +
      `<span class="intent">${escapeHtml(intent)}</span>` +
      `<span class="verdict">an unreadable Decision</span></div>`
    );
  }

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
 * Redraws by region: a `mission` change rebuilds the bar and the answers, a `decided` rebuilds the
 * record, a `panes` change resyncs the grid through `syncPanes` — which is careful, and the module doc's
 * "xterm.js is here now" section says why: a Pane's bytes are never drawn by rebuilding markup any more,
 * `xterm.js` repaints its own mount point on its own schedule the moment `fold` calls `write`, so a byte
 * stream never touches the DOM through this function at all (`fold` answers `undefined` for it, and
 * `undefined` redraws nothing — see `redraw`).
 */
export function attach(cockpit: Cockpit, wiring: Wiring): (said: ToCockpit) => void {
  const { root } = wiring;
  root.innerHTML = renderCockpit(cockpit);

  const region = (id: string): HTMLElement | null => root.querySelector(`#${id}`);

  // Which Panes' terminals have already been mounted, keyed by ordinal — bound to this `attach` call,
  // never to the Cockpit: whether a terminal has been opened is a fact about *this page*, not about the
  // Mission, and a real `xterm.js` `Terminal.open` is not itself the right guard (see `TerminalLike.open`
  // and `syncPanes` below for why calling it a second time, on a different container, is not safe to
  // rely on).
  const opened = new Set<number>();

  /** Opens a Pane's terminal into its `.screen`, once, whenever that element exists and this has not. */
  const openPane = (pane: PaneReading): void => {
    if (opened.has(pane.ordinal)) {
      return;
    }
    const container = region(`screen-${pane.ordinal}`);
    if (container !== null) {
      pane.terminal.open(container);
      opened.add(pane.ordinal);
    }
  };

  /**
   * Keeps the Pane grid in step with `cockpit.panes`, without ever rebuilding a Pane's `.screen` — the
   * one element `xterm.js` owns once a terminal is mounted into it.
   *
   * - **No Pane yet, or the grid is still the "no Pane has opened yet" placeholder.** Nothing is mounted
   *   to protect, so the region is rebuilt outright — this is also what the very first call after the
   *   initial full-page paint takes when a Pane already exists, because the placeholder was never drawn.
   * - **Otherwise**, each Pane is visited: one whose shell already exists gets its chrome refreshed in
   *   place (`renderPaneHead`, into `#head-N`, never touching `#screen-N`); one that does not is a
   *   brand-new Pane, built through a **detached** scratch element — `document.createElement`, never
   *   `panesRegion.innerHTML +=`, which would reparse and rebuild every existing Pane's markup, tearing
   *   an already-mounted terminal's own DOM out along with it — and appended.
   *
   * `openPane` runs over every Pane afterward, every time, and its own `opened` guard is what keeps a
   * chrome-only refresh from mounting anything twice.
   */
  const syncPanes = (): void => {
    const panesRegion = region("panes");
    if (panesRegion === null) {
      return;
    }
    if (cockpit.panes.length === 0 || panesRegion.children.length === 0) {
      panesRegion.innerHTML = renderPanes(cockpit);
    } else {
      for (const pane of cockpit.panes) {
        const head = region(`head-${pane.ordinal}`);
        if (head !== null) {
          head.innerHTML = renderPaneHead(cockpit, pane);
          continue;
        }
        const scratch = document.createElement("div");
        scratch.innerHTML = renderPane(cockpit, pane);
        const article = scratch.firstElementChild;
        if (article !== null) {
          panesRegion.appendChild(article);
        }
      }
    }
    for (const pane of cockpit.panes) {
      openPane(pane);
    }
  };

  // The initial paint may already hold Panes — a test, or a reconnect that folded a Replay before
  // `attach` ran — and those terminals are exactly as unopened as one `syncPanes` would build fresh, so
  // this is not a special case: it is the same call every later `panes` change makes.
  syncPanes();

  const redraw = (change: Change | undefined): void => {
    if (change === undefined) {
      return;
    }
    if (change.kind === "panes") {
      syncPanes();
      return;
    }
    const mission = region("mission");
    const record = region("record");
    if (mission !== null) {
      mission.innerHTML = renderMission(cockpit);
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
 * The values a control's answer needs: the boxes in the block it sits in.
 *
 * Reading the block rather than a form because the answers are blocks, and a `<form>` would bring a
 * submit event and a page navigation this page has no use for. A value is named by the **content** of a
 * `data-value` attribute and never by part of an attribute's own name — one mechanism, for every answer,
 * and the reason is a browser behaviour nothing in this repository can test.
 *
 * ## What the second spelling cost, kept because it is the kind of thing that comes back
 *
 * A control used to carry its own value as `data-value-paneId="p"`, read back out of `dataset`. **An HTML
 * parser lowercases attribute names**, so the attribute a browser holds is `data-value-paneid`, its
 * `dataset` key is `valuePaneid`, and the name this function derived was `paneid` — which `answerFor`
 * does not read. The Kill control would have sent `{ kind: "pane-write"… paneId: "" }`, which
 * `protocol.ts` refuses as unreadable and the server answers by closing the connection. Every test in
 * this repository agreed with the markup rather than with a browser, because nothing here parses HTML.
 *
 * There is no DOM to settle it with, and that is exactly the argument: **the view must not depend on a
 * browser behaviour no test here can check.** The `data-value` spelling depends on none — the name is a
 * value, and values keep their case everywhere. The `data-value-*` branch is gone rather than fixed,
 * because nothing emits one now and a branch nothing reaches is a guard that rots.
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
  return values;
}

/* =================================================================================================
 * The Gaps of this view
 *
 * The six the hand-rolled emulator used to list here — no alternate buffer, no insert/delete line, no
 * scroll region, no reflow, one column per code point, no mouse — are `xterm.js`'s problem now, and it
 * answers all six. What replaces them is what `xterm.js` still leaves to this file and to the browser it
 * has never run inside.
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
 * 4. **A Pane's OSC title (0/2) is not shown.** `xterm.js` exposes it only through `onTitleChange`, an
 *    event subscription, and not as a property this file could read at render time the way the hand-rolled
 *    emulator's `screen.title` was. Wiring it means `attach` subscribing once per Pane and having
 *    somewhere to put the answer — a small addition, and one this task's scope (a Pane's *bytes* becoming
 *    pixels) does not reach; the hand-rolled version had exactly one test, and it tested the parser this
 *    version deletes rather than the view, so nothing that proved the view is lost by dropping it.
 * 5. **`attach` is executed by a test, and not by a browser.** ~~`attach` is not executed by a test~~ —
 *    that Gap was real and QA proved it with a plant: severing the one line that sends a click's gesture
 *    left every test green. It is closed by the shim `client.test.ts` builds, which parses the markup the
 *    renderers emit and delivers events to the listeners `attach` really registers, and every assertion
 *    about *meaning* is made against this module's own `answerFor`, `keystrokesOf` and `ACTIONS`. So the
 *    wiring is proven: the click listener finds the control, the values come off the boxes in its block,
 *    the region ids match the markup, and a keypress reaches the Pane it was typed into.
 *
 *    What is still unproven is the vendor's half — that a browser's `closest`, `dataset` and event
 *    dispatch behave as read, that `innerHTML` parses this markup the same way, that anything is laid out
 *    or painted. `jsdom` is deliberately still not installed — closing that Gap is not this task's, even
 *    though `package.json` is, this time, for `@xterm/xterm` alone — so the shim is what a test can have
 *    today, and it earned its keep on its first run by finding the `data-value-*` reading `valuesAround`
 *    now records.
 * 6. **`xterm.js`'s own half is unproven in exactly the same way, and for the same reason.** `write` and
 *    the buffer it fills are proven directly against the real library — see `client.test.ts`'s "xterm.js
 *    actually renders" — because building a `Terminal` touches no DOM. **Mounting one does**: `.open`
 *    creates its internal elements, measures a character cell against `getComputedStyle`, and paints
 *    through a canvas or DOM renderer, none of which this file's shim can exercise without becoming a
 *    second, unfaithful implementation of a browser (`CLAUDE.md`: "a shim is only evidence if it is
 *    faithful exactly where the code is fragile", and faking `.open()`'s internals would not be). So the
 *    wiring tests in this file use a `TerminalLike` fake that treats `open` as a no-op it merely records,
 *    and `syncPanes`'s call to it is proven to happen at the right time, with the right container, and
 *    exactly once — never that a browser would actually draw anything as a result.
 */
