/**
 * The Cockpit view, driven.
 *
 * ## What is real here, and the one thing that is not
 *
 * - **The engine.** Every Mission this file renders was built by `submit` from real Commands, so the
 *   Gate halt of criterion 6 and the Cap halt of criterion 7 are states the domain actually produces —
 *   not objects written by hand to look like one. Every gesture the view emits is handed back to
 *   `submit` and the Decision is asserted, so "the view offers the right answer" means the engine
 *   accepted it, not that a button had the right label.
 * - **The client.** `cockpit/view/client.ts` is imported as itself. Nothing about it is stubbed and no
 *   render is compared to a stored snapshot: every assertion reads a value out of the HTML and says why
 *   it must be there.
 *
 * **There is a DOM here, and it is a shim rather than a browser.** `jsdom` is not installed in
 * this repository — `npm ls jsdom` is empty, and asking for the jsdom environment in a per-file docblock
 * fails the whole file with `Cannot find package 'jsdom'` — and `package.json` is outside this task's
 * scope. So `attach` is driven under a shim this file builds, argued where it sits ("A DOM small enough
 * to be honest"): it parses the markup the renderers really emitted, delivers events to the listeners
 * `attach` really registered, and holds **no judgement about the Cockpit** — every assertion about what a
 * click *means* is made against the module's own exported `answerFor`, `keystrokesOf` and `ACTIONS`.
 *
 * (Naming that pragma in this docblock is itself a trap, and it cost a red run: **vitest reads the
 * pragma out of the first docblock of a file, comment or not**, exactly as TypeScript honours
 * `@ts-expect-error` only when the directive opens the comment. Mentioning it in prose here switched the
 * environment on and the file could not start at all.)
 *
 * That was written the other way round until QA planted a defect in it: severing the one line in `attach`
 * that sends a click's gesture left all 1078 tests green, because nothing executed the function. The
 * three things that stood in for it are all still here and all still worth having, and none of them is
 * the wire:
 *
 * 1. **The judgement is driven directly.** `answerFor` is the whole of what a click decides, and it is
 *    called with the values a click would carry.
 * 2. **The renderer and the reader are cross-checked** (see "The markup a click reads"). Every
 *    `data-action` the renderers emit must be an action `answerFor` knows; every `data-value` they emit
 *    must be a value `answerFor` reads; every region id `attach` looks up must exist in the markup.
 * 3. **The end-to-end run is in `cockpit/view.test.ts`**, over the real server and a real WebSocket.
 *
 * What stays unproven is the **vendor's** half: that a browser's own `closest`, `dataset` and event
 * dispatch behave as this shim does, that `innerHTML` parses this markup the same way, and that anything
 * is laid out or painted. It is listed as a Gap in `client.ts` too. The shim earned its keep on its first
 * run: it found the Kill control reading its PaneId out of an attribute *name* with a capital letter in
 * it, which an HTML parser lowercases — see `valuesAround`.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_REPLAY,
  briefing,
  contract,
  clause,
  clauseId,
  core as coreOf,
  delegationId,
  formatMoney,
  gateId,
  instant,
  isOpened,
  meterOf,
  missionId,
  moneyFromCents,
  moneyFromDecimal,
  orchestrationCapability,
  refusedIn as refusedStepsIn,
  slice,
  stateOf,
  stepsOf,
  submit,
  zordId,
  type Meter,
  type Mission,
  type Delegate,
  type MissionCommand,
  type Replay,
  type ReplayEntry,
} from "@engine/index";

import type { FromCockpit, ToCockpit } from "../protocol";
import type { PaneStatus } from "../../runtime/pane-manager";

import {
  ACTIONS,
  answerFor,
  attach,
  brl,
  centsIn,
  cockpitOf,
  delegationFor,
  escapeHtml,
  feed,
  fold,
  haltingGate,
  htmlOfScreen,
  keystrokesOf,
  providerFor,
  refusedIn,
  renderAnswers,
  renderCockpit,
  renderEntry,
  renderMeter,
  renderMission,
  renderPane,
  renderPanes,
  renderRecord,
  screenOf,
  spentOn,
  stoppedAtCap,
  textOf,
  type Action,
  type Cockpit,
} from "./client";

/* -------------------------------------------------------------------------------------------------
 * Fixtures: real Missions, built by the engine
 * ---------------------------------------------------------------------------------------------- */

const MISSION = missionId("mission-cockpit");
const GATE = gateId("gate-contract-signed");
const DELEGATION = delegationId("delegation-one");
const ZORD = zordId("zord-builder");

/** Instants derived from one base, never spelled out digit by digit: `11:80` is not a time. */
const BASE = Date.parse("2026-08-06T12:00:00.000Z");

function at(minutes: number): ReturnType<typeof instant> {
  return instant(new Date(BASE + minutes * 60_000).toISOString());
}

function opening(cap: string): MissionCommand {
  return {
    kind: "open-mission",
    occurredAt: at(0),
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit view"),
    mode: "combination",
    cap: moneyFromDecimal(cap),
    core: coreOf([orchestrationCapability("delegate")]),
  };
}

function delegating(): Delegate {
  return {
    kind: "delegate",
    occurredAt: at(1),
    delegationId: DELEGATION,
    zordId: ZORD,
    slice: slice("Draw the Pane grid"),
    harnessSources: {
      catalogDefault: { cli: "claude", model: "opus", effort: "high", skills: [] },
    },
    // Two Clauses, one required and one optional, so a Handoff that satisfies nothing breaks this
    // Contract **twice** — a Refusal carries a list, and a test that pinned one violation would miss
    // the second for ever.
    contract: contract([
      clause({ id: clauseId("clause-one"), description: "the grid renders", required: true }),
      clause({ id: clauseId("clause-two"), description: "the Meter is drawn", required: false }),
    ]),
  };
}

/** A Mission stopped at a Gate: what criterion 6 asks a human to answer. */
function gateHalted(): Replay {
  let recorded = submit(EMPTY_REPLAY, opening("50.00"));
  recorded = submit(recorded, delegating());
  recorded = submit(recorded, {
    kind: "raise-gate",
    occurredAt: at(2),
    gateId: GATE,
    question: "The Contract is signed. Carry on?",
  });
  return recorded;
}

/** A Mission stopped at its Cap: what criterion 7 asks a human to authorise. */
function capHalted(): Replay {
  let recorded = submit(EMPTY_REPLAY, opening("10.00"));
  recorded = submit(recorded, delegating());
  recorded = submit(recorded, {
    kind: "accrue-cost",
    occurredAt: at(3),
    delegationId: DELEGATION,
    cost: moneyFromCents(1000),
  });
  return recorded;
}

/** A Mission simply running, with one Delegation: the ordinary case the Pane grid draws. */
function running(): Replay {
  return submit(submit(EMPTY_REPLAY, opening("50.00")), delegating());
}

/** The `mission` message the server would send for a Replay, built the way the server builds it. */
function missionMessage(recorded: Replay): ToCockpit {
  const state = stateOf(recorded);
  return isOpened(state)
    ? { kind: "mission", state, meter: meterOf(state) }
    : { kind: "mission", state };
}

/** A Cockpit holding one `mission` message, which is what a freshly connected tab holds. */
function showing(recorded: Replay): Cockpit {
  const cockpit = cockpitOf(6, 40, 50);
  fold(cockpit, missionMessage(recorded));
  return cockpit;
}

/** Everything the last `mission` message said, for a test that wants the state directly. */
function stateIn(cockpit: Cockpit): Mission {
  const state = cockpit.state;
  if (state === undefined) {
    throw new Error("this Cockpit has heard no mission message");
  }
  return state;
}

const ESC = "\u001b";

/* -------------------------------------------------------------------------------------------------
 * The terminal
 * ---------------------------------------------------------------------------------------------- */

describe("the terminal, which is here because xterm.js could not be", () => {
  it("writes what a process wrote, line by line", () => {
    const screen = screenOf(4, 20, 10);
    feed(screen, "first\r\nsecond\r\nthird");
    expect(textOf(screen)).toBe("first\nsecond\nthird");
  });

  it("moves the cursor to the left margin on a carriage return, which is how a spinner redraws", () => {
    const screen = screenOf(3, 20, 10);
    feed(screen, "working...\rdone");
    expect(textOf(screen)).toBe("doneing...");
  });

  it("backspaces, and never past the left margin", () => {
    const screen = screenOf(3, 20, 10);
    feed(screen, "abc\b\b\b\b\bZ");
    expect(textOf(screen)).toBe("Zbc");
  });

  it("advances a tab to the next multiple of eight", () => {
    const screen = screenOf(3, 40, 10);
    feed(screen, "ab\tc");
    expect(textOf(screen)).toBe("ab      c");
  });

  it("wraps at the right margin rather than losing the character", () => {
    const screen = screenOf(4, 5, 10);
    feed(screen, "abcdefgh");
    expect(textOf(screen)).toBe("abcde\nfgh");
  });

  it("scrolls into bounded scrollback once the screen is full", () => {
    const screen = screenOf(2, 10, 1);
    feed(screen, "one\r\ntwo\r\nthree\r\nfour");
    // rows 2, scrollback 1: "one" has fallen off the top entirely.
    expect(textOf(screen)).toBe("two\nthree\nfour");
  });

  it("keeps an escape sequence split across two chunks, because a pty splits where it likes", () => {
    const screen = screenOf(3, 20, 10);
    feed(screen, `red: ${ESC}[3`);
    feed(screen, "1mDANGER");
    expect(textOf(screen)).toBe("red: DANGER");
    expect(htmlOfScreen(screen)).toContain("#ff3b30");
  });

  it("never prints the bytes of a sequence it does not implement", () => {
    const screen = screenOf(3, 30, 10);
    // Alternate screen buffer, bracketed paste, a scroll region: all consumed, none implemented.
    feed(screen, `${ESC}[?1049h${ESC}[?2004htext${ESC}[1;3r`);
    expect(textOf(screen)).toBe("text");
  });

  it("drops a pending sequence that is not one, rather than growing without bound", () => {
    const screen = screenOf(3, 20, 10);
    feed(screen, `${ESC}[${"1;".repeat(4000)}`);
    expect(screen.pending).toBe("");
    feed(screen, "after");
    expect(textOf(screen)).toBe("after");
  });

  it("colours a run in the site's palette, and one span carries the whole run", () => {
    const screen = screenOf(2, 20, 10);
    feed(screen, `${ESC}[34mblue${ESC}[0m.`);
    const html = htmlOfScreen(screen);
    // --color-scout, the blue app/globals.css already declares.
    expect(html).toContain(`<span style="color:#2e8cff">blue</span>`);
  });

  it("resolves the 256-colour cube rather than dropping the colour", () => {
    const screen = screenOf(2, 20, 10);
    feed(screen, `${ESC}[38;5;196mX`);
    // 196 = 16 + 36*5 + 6*0 + 0 → (255, 0, 0).
    expect(htmlOfScreen(screen)).toContain("color:#ff0000");
  });

  it("erases to the end of a line, which is how a progress line is rewritten", () => {
    const screen = screenOf(2, 20, 10);
    feed(screen, `100 percent done\r${ESC}[K5`);
    expect(textOf(screen)).toBe("5");
  });

  it("erases the whole display, which is what `clear` sends", () => {
    const screen = screenOf(3, 20, 10);
    feed(screen, `noise\r\nmore${ESC}[2J${ESC}[Hfresh`);
    expect(textOf(screen)).toBe("fresh");
  });

  it("positions the cursor within the screen and clamps what would leave it", () => {
    const screen = screenOf(3, 10, 10);
    feed(screen, `${ESC}[99;99Hx`);
    expect(textOf(screen).split("\n")).toEqual(["", "", "         x"]);
  });

  it("takes a title from an OSC sequence and prints none of it", () => {
    const screen = screenOf(2, 20, 10);
    feed(screen, `${ESC}]0;claude — building\u0007ready`);
    expect(screen.title).toBe("claude — building");
    expect(textOf(screen)).toBe("ready");
  });

  it("escapes what a process wrote, so a Zord printing markup cannot write the page", () => {
    const screen = screenOf(2, 40, 10);
    feed(screen, `<img src=x onerror="boom">`);
    const html = htmlOfScreen(screen);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;boom&quot;&gt;");
  });

  it("draws a caret at the cursor", () => {
    const screen = screenOf(2, 10, 10);
    feed(screen, "hi");
    expect(htmlOfScreen(screen)).toContain(`<span class="caret"`);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Money: the duplication, proven equal
 * ---------------------------------------------------------------------------------------------- */

describe("money in the browser, pinned against the engine", () => {
  const amounts = [0, 1, 9, 10, 99, 100, 999, 1000, 5000, 123456, 100000000, 999999999];

  it("formats exactly as formatMoney does", () => {
    for (const cents of amounts) {
      expect(brl(cents)).toBe(formatMoney(moneyFromCents(cents)));
    }
  });

  it("reads exactly what moneyFromDecimal reads", () => {
    for (const typed of ["0", "1", "48.5", "48.50", "60", "1234.56", "0.07"]) {
      expect(centsIn(typed)).toBe(moneyFromDecimal(typed));
    }
  });

  it("also reads the decimal comma and the currency a PT-BR speaker types", () => {
    expect(centsIn("60,00")).toBe(6000);
    expect(centsIn("R$ 1.234,50")).toBe(123450);
    expect(centsIn("  90 ")).toBe(9000);
  });

  it("answers undefined for what is not an amount, instead of guessing one", () => {
    for (const typed of ["", "abc", "-5", "1.234", "1e3", "R$"]) {
      expect(centsIn(typed)).toBeUndefined();
    }
  });

  it("says nothing rather than a number for an amount that is not finite", () => {
    expect(brl(Number.NaN)).toBe("—");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The fold
 * ---------------------------------------------------------------------------------------------- */

describe("folding what the server sends", () => {
  it("opens a Pane on the first thing it says, in the order it was heard from", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, { kind: "pane-data", paneId: "b", chunk: "hello" } as ToCockpit);
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "hi" } as ToCockpit);
    expect(cockpit.panes.map((pane) => pane.paneId)).toEqual(["b", "a"]);
    expect(cockpit.panes.map((pane) => pane.ordinal)).toEqual([1, 2]);
  });

  it("streams a Pane's bytes onto that Pane's screen and no other", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "for a" } as ToCockpit);
    fold(cockpit, { kind: "pane-data", paneId: "b", chunk: "for b" } as ToCockpit);
    expect(textOf(cockpit.panes[0]!.screen)).toBe("for a");
    expect(textOf(cockpit.panes[1]!.screen)).toBe("for b");
  });

  it("reports a screen change as a screen change, so a chunk does not rebuild the page", () => {
    const cockpit = cockpitOf(4, 20, 10);
    expect(fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "x" } as ToCockpit)).toEqual({
      kind: "panes",
    });
    expect(fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "y" } as ToCockpit)?.kind).toBe(
      "pane-screen",
    );
  });

  it("starts a Pane at starting, which is what the process table announces for one that is silent", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "x" } as ToCockpit);
    expect(cockpit.panes[0]?.status).toBe("starting");
  });

  it("takes every status the process table can announce", () => {
    const statuses: readonly PaneStatus[] = [
      "starting",
      "working",
      "idle",
      "delivered",
      "failed",
      "killed",
    ];
    const cockpit = cockpitOf(4, 20, 10);
    for (const status of statuses) {
      fold(cockpit, { kind: "pane-status", paneId: "a", status } as ToCockpit);
      expect(cockpit.panes[0]?.status).toBe(status);
    }
  });

  it("keeps the state and the Meter of the last mission message", () => {
    const cockpit = showing(running());
    expect(stateIn(cockpit).status).toBe("running");
    expect(cockpit.meter?.cap).toBe(5000);
  });

  it("holds no Meter for a Mission nobody opened, rather than a zero one", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, missionMessage(EMPTY_REPLAY));
    expect(stateIn(cockpit).status).toBe("unopened");
    expect(cockpit.meter).toBeUndefined();
  });

  it("bounds the record, dropping the oldest rather than growing without end", () => {
    const cockpit = cockpitOf(4, 20, 10);
    const entry = (n: number): ToCockpit => ({
      kind: "decided",
      entry: {
        command: { kind: `k${n}` },
        decision: { kind: "refused", refusal: { reason: "illegal-transition", violations: [] } },
      } as unknown as ReplayEntry,
    });
    for (let n = 0; n < 100; n += 1) {
      fold(cockpit, entry(n));
    }
    expect(cockpit.decided.length).toBe(60);
    expect(cockpit.decided[0]?.command.kind).toBe("k40");
  });

  it("ignores a message that says nothing, rather than throwing inside a browser tab", () => {
    const cockpit = cockpitOf(4, 20, 10);
    for (const rubbish of [
      null,
      "a string",
      { kind: "pane-data" },
      { kind: "pane-data", paneId: 7, chunk: "x" },
      { kind: "mission" },
      { kind: "decided" },
      { kind: "nothing-like-this" },
    ]) {
      expect(fold(cockpit, rubbish as unknown as ToCockpit)).toBeUndefined();
    }
    expect(cockpit.panes).toEqual([]);
    expect(cockpit.state).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 6 — a Gate halts the Mission, and answering it resumes
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 6: a Gate halts the Mission in the Cockpit and a human answer resumes it", () => {
  it("shows the Gate's own question when the Mission is halted at one", () => {
    const cockpit = showing(gateHalted());
    expect(stateIn(cockpit).status).toBe("halted");
    expect(haltingGate(cockpit.state)?.id).toBe(GATE);

    const html = renderAnswers(cockpit);
    expect(html).toContain("A Gate is open");
    expect(html).toContain("The Contract is signed. Carry on?");
    expect(html).toContain(`data-action="approve-gate"`);
    expect(html).toContain(`data-action="revise-gate"`);
    expect(html).toContain(`value="${GATE}"`);
  });

  it("offers nothing while the Mission is running, so there is no inert control to press", () => {
    expect(renderAnswers(showing(running()))).toBe("");
    expect(haltingGate(stateIn(showing(running())))).toBeUndefined();
  });

  it("emits an approval the engine accepts, and the Mission is running again", () => {
    const recorded = gateHalted();
    const cockpit = showing(recorded);

    const answer = answerFor("approve-gate", { gateId: String(GATE) }, at(4));
    expect(answer.kind).toBe("sends");
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Gate answer is not a submit");
    }
    expect(answer.sent.command).toEqual({
      kind: "decide-gate",
      occurredAt: at(4),
      gateId: GATE,
      decision: { kind: "approved" },
    });

    const next = submit(recorded, answer.sent.command);
    expect(next[next.length - 1]?.decision.kind).toBe("accepted");
    expect(stateOf(next).status).toBe("running");
  });

  it("emits a revision carrying the reason, and the reason comes back as context", () => {
    const recorded = gateHalted();
    const answer = answerFor(
      "revise-gate",
      { gateId: String(GATE), reason: "the Contract is missing a Clause about errors" },
      at(4),
    );
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Gate answer is not a submit");
    }

    const next = submit(recorded, answer.sent.command);
    expect(next[next.length - 1]?.decision.kind).toBe("accepted");
    const state = stateOf(next);
    expect(state.status).toBe("running");
    if (!isOpened(state)) {
      throw new Error("a resumed Mission is opened");
    }
    expect(state.gates[0]?.decision).toEqual({
      kind: "revision-requested",
      reason: "the Contract is missing a Clause about errors",
    });
  });

  it("answers the Gate the halt names, not the first one on the record", () => {
    // Found by plant: with one Gate in the fixture, reading `gates[0]` and reading the Gate the halt
    // names are indistinguishable, so a view that ignored the halt passed every test. A Mission that
    // has answered one Gate and raised another tells them apart.
    let recorded = submit(EMPTY_REPLAY, opening("50.00"));
    recorded = submit(recorded, delegating());
    recorded = submit(recorded, {
      kind: "raise-gate",
      occurredAt: at(2),
      gateId: GATE,
      question: "The Contract is signed. Carry on?",
    });
    recorded = submit(recorded, {
      kind: "decide-gate",
      occurredAt: at(3),
      gateId: GATE,
      decision: { kind: "approved" },
    });
    const second = gateId("gate-ready-to-deliver");
    recorded = submit(recorded, {
      kind: "raise-gate",
      occurredAt: at(4),
      gateId: second,
      question: "Ready to deliver?",
    });

    const cockpit = showing(recorded);
    const state = stateIn(cockpit);
    if (!isOpened(state)) {
      throw new Error("this Mission is opened");
    }
    expect(state.gates.length).toBe(2);
    expect(haltingGate(cockpit.state)?.id).toBe(second);

    const html = renderAnswers(cockpit);
    expect(html).toContain("Ready to deliver?");
    expect(html).not.toContain("The Contract is signed. Carry on?");
    expect(html).toContain(`value="${second}"`);
  });

  it("stops offering the Gate once it has been answered", () => {
    const recorded = gateHalted();
    const answer = answerFor("approve-gate", { gateId: String(GATE) }, at(4));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Gate answer is not a submit");
    }
    const cockpit = showing(submit(recorded, answer.sent.command));
    expect(renderAnswers(cockpit)).toBe("");
  });

  it("sends a blank revision rather than judging it, and the engine's Refusal is what a human reads", () => {
    const recorded = gateHalted();
    const answer = answerFor("revise-gate", { gateId: String(GATE), reason: "   " }, at(4));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Gate answer is not a submit");
    }
    const next = submit(recorded, answer.sent.command);
    const entry = next[next.length - 1];
    expect(entry?.decision.kind).toBe("refused");
    // Still halted: a Refusal settles nothing, and the Gate is still there to answer.
    expect(stateOf(next).status).toBe("halted");

    const cockpit = showing(recorded);
    fold(cockpit, { kind: "decided", entry: entry as ReplayEntry });
    expect(renderRecord(cockpit)).toContain("refused");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 7 — the Cap halts the Mission, and nothing is commissioned until it is authorised
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 7: reaching the Cap halts the Mission and no work is commissioned until authorised", () => {
  it("shows the authorisation, with what the Mission has already spent", () => {
    const cockpit = showing(capHalted());
    expect(stoppedAtCap(cockpit.state)).toBe(true);

    const html = renderAnswers(cockpit);
    expect(html).toContain("The Cap has been reached");
    expect(html).toContain("R$ 10,00");
    expect(html).toContain(`data-action="authorise-cap"`);
    expect(html).toContain(`data-value="amount"`);
  });

  it("draws the Meter as reached, which is the reading the halt is derived from", () => {
    const cockpit = showing(capHalted());
    const meter: Meter | undefined = cockpit.meter;
    expect(meter?.reached).toBe(true);
    expect(renderMeter(meter!)).toContain("Cap reached");
  });

  it("commissions nothing while it is stopped: a Delegation is refused cap-reached", () => {
    const recorded = capHalted();
    const next = submit(recorded, { ...delegating(), occurredAt: at(4), delegationId: delegationId("delegation-two") });
    const decision = next[next.length - 1]?.decision;
    expect(decision?.kind).toBe("refused");
    if (decision?.kind !== "refused") {
      throw new Error("a Mission at its Cap refuses a Delegation");
    }
    expect(decision.refusal.reason).toBe("cap-reached");
  });

  it("emits an authorisation the engine accepts, and work is commissioned again", () => {
    const recorded = capHalted();
    const answer = answerFor("authorise-cap", { amount: "30,00" }, at(5));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Cap answer is not a submit");
    }
    expect(answer.sent.command).toEqual({
      kind: "authorise-cap",
      occurredAt: at(5),
      cap: 3000,
    });

    const authorised = submit(recorded, answer.sent.command);
    expect(authorised[authorised.length - 1]?.decision.kind).toBe("accepted");
    expect(stateOf(authorised).status).toBe("running");

    // And the Delegation that was refused a moment ago is now accepted.
    const commissioned = submit(authorised, {
      ...delegating(),
      occurredAt: at(6),
      delegationId: delegationId("delegation-two"),
    });
    expect(commissioned[commissioned.length - 1]?.decision.kind).toBe("accepted");
  });

  it("sends an amount that is not one rather than judging it, and shows what the engine said", () => {
    const recorded = capHalted();
    const answer = answerFor("authorise-cap", { amount: "as much as it takes" }, at(5));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Cap answer is not a submit");
    }
    // NaN on the wire is null, which is what `amountOf` refuses. Either way the view holds no rule.
    const next = submit(recorded, JSON.parse(JSON.stringify(answer.sent.command)) as MissionCommand);
    const entry = next[next.length - 1];
    expect(entry?.decision.kind).toBe("refused");
    if (entry?.decision.kind !== "refused") {
      throw new Error("an unreadable Cap is refused");
    }
    expect(entry.decision.refusal.violations.join(" ")).toContain("whole BRL cents");
  });

  it("refuses an authorisation at or below what was already spent, and says so to the human", () => {
    const recorded = capHalted();
    const answer = answerFor("authorise-cap", { amount: "5,00" }, at(5));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Cap answer is not a submit");
    }
    const next = submit(recorded, answer.sent.command);
    const entry = next[next.length - 1];
    if (entry?.decision.kind !== "refused") {
      throw new Error("authorising nothing is refused");
    }
    expect(entry.decision.refusal.reason).toBe("cap-reached");
  });

  it("offers the authorisation and not the Gate, because the Cap is what stopped it", () => {
    const cockpit = showing(capHalted());
    const html = renderAnswers(cockpit);
    expect(html).toContain(`data-answer="cap"`);
    expect(html).not.toContain(`data-answer="gate"`);
  });
});

/* -------------------------------------------------------------------------------------------------
 * A Refusal is visible
 * ---------------------------------------------------------------------------------------------- */

describe("a Refusal is rendered, with its reason and every violation", () => {
  /** A Refusal the engine really produces: a Handoff that breaks its Contract twice. */
  function refusedEntry(): ReplayEntry {
    const recorded = running();
    const next = submit(recorded, {
      kind: "submit-handoff",
      occurredAt: at(5),
      handoff: {
        delegationId: DELEGATION,
        scope: "nothing much",
        artifacts: [],
        satisfies: [],
        gaps: [],
      },
    } as unknown as MissionCommand);
    const entry = next[next.length - 1];
    if (entry === undefined || entry.decision.kind !== "refused") {
      throw new Error("this fixture must produce a Refusal");
    }
    return entry;
  }

  it("shows the reason the engine gave, not a generic failure", () => {
    const entry = refusedEntry();
    const html = renderEntry(entry);
    expect(html).toContain(`class="entry refused"`);
    expect(html).toContain("refused");
    if (entry.decision.kind !== "refused") {
      throw new Error("unreachable");
    }
    expect(html).toContain(escapeHtml(entry.decision.refusal.reason));
  });

  it("shows every violation, because a Refusal carries a list", () => {
    const entry = refusedEntry();
    if (entry.decision.kind !== "refused") {
      throw new Error("unreachable");
    }
    const violations = entry.decision.refusal.violations;
    expect(violations.length).toBeGreaterThan(1);

    const html = renderEntry(entry);
    for (const violation of violations) {
      expect(html).toContain(escapeHtml(violation));
    }
    expect(html.match(/<li>/gu)?.length).toBe(violations.length);
  });

  it("draws exactly the Refusals refusedIn(stepsOf(replay)) finds, so the two readings agree", () => {
    const recorded = capHalted();
    const refusedByEngine = refusedStepsIn(stepsOf(submit(recorded, delegating())));
    const cockpit = showing(recorded);
    for (const entry of submit(recorded, delegating())) {
      fold(cockpit, { kind: "decided", entry });
    }
    expect(refusedIn(cockpit.decided).length).toBe(refusedByEngine.length);
    expect(refusedIn(cockpit.decided).map((entry) => entry.command.kind)).toEqual(
      refusedByEngine.map((step) => step.command.kind),
    );
  });

  it("shows an accepted Decision as its facts, so the record is not only bad news", () => {
    const recorded = running();
    const entry = recorded[recorded.length - 1];
    if (entry === undefined) {
      throw new Error("a Delegation was recorded");
    }
    const html = renderEntry(entry);
    expect(html).toContain(`class="entry accepted"`);
    expect(html).toContain("delegated");
  });

  it("draws a Refusal whose fields were lost to a cast, instead of throwing in the tab", () => {
    const broken = {
      command: {},
      decision: { kind: "refused", refusal: {} },
    } as unknown as ReplayEntry;
    expect(() => renderEntry(broken)).not.toThrow();
    expect(renderEntry(broken)).toContain("unstated");
  });

  it("says so when nothing has been decided yet, rather than showing an empty box", () => {
    expect(renderRecord(cockpitOf(4, 20, 10))).toContain("nothing has been decided");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The Pane grid: status, provider, cost
 * ---------------------------------------------------------------------------------------------- */

describe("a Pane shows its status, its provider and what it has cost", () => {
  function withPane(recorded: Replay, paneId: string): Cockpit {
    const cockpit = showing(recorded);
    fold(cockpit, { kind: "pane-data", paneId, chunk: "building" } as ToCockpit);
    fold(cockpit, { kind: "pane-status", paneId, status: "working" } as ToCockpit);
    return cockpit;
  }

  it("reads the provider and the cost off the Delegation the Pane is named after", () => {
    const recorded = submit(running(), {
      kind: "accrue-cost",
      occurredAt: at(4),
      delegationId: DELEGATION,
      cost: moneyFromCents(250),
    });
    const cockpit = withPane(recorded, String(DELEGATION));

    expect(delegationFor(cockpit.state, String(DELEGATION))?.id).toBe(DELEGATION);
    expect(providerFor(cockpit.state, String(DELEGATION))).toBe("claude");
    expect(spentOn(cockpit.state, String(DELEGATION))).toBe(250);

    const html = renderPane(cockpit, cockpit.panes[0]!);
    expect(html).toContain("claude");
    expect(html).toContain("R$ 2,50");
    expect(html).toContain(`class="pill ctrl"`);
    expect(html).toContain("working");
  });

  it("says nothing rather than zero when no Delegation attributes a cost to a Pane", () => {
    const cockpit = withPane(running(), "a-pane-nobody-delegated");
    expect(providerFor(cockpit.state, "a-pane-nobody-delegated")).toBeUndefined();
    expect(spentOn(cockpit.state, "a-pane-nobody-delegated")).toBeUndefined();

    const html = renderPane(cockpit, cockpit.panes[0]!);
    expect(html).toContain("provider unattributed");
    expect(html).toContain("<span class=\"cost\">—</span>");
    expect(html).not.toContain("R$ 0,00");
  });

  it("draws every Pane it has heard from, each with its own screen element", () => {
    const cockpit = showing(running());
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "one" } as ToCockpit);
    fold(cockpit, { kind: "pane-data", paneId: "b", chunk: "two" } as ToCockpit);
    const html = renderPanes(cockpit);
    expect(html).toContain(`id="screen-1"`);
    expect(html).toContain(`id="screen-2"`);
    expect(html).toContain("one");
    expect(html).toContain("two");
  });

  it("says so when no Pane has opened, rather than drawing an empty grid", () => {
    expect(renderPanes(cockpitOf(4, 20, 10))).toContain("no Pane has opened yet");
  });

  it("escapes a PaneId, so an id cannot write attributes into the markup", () => {
    const cockpit = showing(running());
    fold(cockpit, { kind: "pane-data", paneId: `x" onload="boom`, chunk: "" } as ToCockpit);
    const html = renderPane(cockpit, cockpit.panes[0]!);
    expect(html).not.toContain(`onload="boom"`);
    expect(html).toContain("&quot;");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The Mission bar
 * ---------------------------------------------------------------------------------------------- */

describe("the Mission bar carries the Meter", () => {
  it("shows the Briefing, the Mode, the status and the Meter", () => {
    const html = renderMission(showing(running()));
    expect(html).toContain("Ship the Cockpit view");
    expect(html).toContain("combination");
    expect(html).toContain("running");
    expect(html).toContain("R$ 0,00");
    expect(html).toContain("of R$ 50,00");
    expect(html).toContain("1 delegation");
  });

  it("says a Mission is waited for before the first message, and unopened after it", () => {
    expect(renderMission(cockpitOf(4, 20, 10))).toContain("waiting for the Mission");
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, missionMessage(EMPTY_REPLAY));
    expect(renderMission(cockpit)).toContain("unopened");
  });

  it("fills the gauge by what has been spent against the Cap", () => {
    const recorded = submit(running(), {
      kind: "accrue-cost",
      occurredAt: at(4),
      delegationId: DELEGATION,
      cost: moneyFromCents(2500),
    });
    expect(renderMission(showing(recorded))).toContain(`style="width:50%"`);
  });

  it("escapes a Briefing, so nothing a human typed can write the page", () => {
    const recorded = submit(EMPTY_REPLAY, {
      ...opening("50.00"),
      briefing: briefing(`<script>boom</script>`),
    } as MissionCommand);
    const html = renderMission(showing(recorded));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Keystrokes
 * ---------------------------------------------------------------------------------------------- */

describe("what a key means to a process", () => {
  it("sends a carriage return for Enter, which the line discipline turns into a newline", () => {
    expect(keystrokesOf("Enter", false, false)).toBe("\r");
  });

  it("sends the control character for Ctrl+letter, so Ctrl+C interrupts", () => {
    expect(keystrokesOf("c", true, false)).toBe("\u0003");
    expect(keystrokesOf("C", true, false)).toBe("\u0003");
    expect(keystrokesOf("d", true, false)).toBe("\u0004");
  });

  it("sends the escape sequence for an arrow key, which is how history is walked", () => {
    expect(keystrokesOf("ArrowUp", false, false)).toBe(`${ESC}[A`);
    expect(keystrokesOf("ArrowDown", false, false)).toBe(`${ESC}[B`);
    expect(keystrokesOf("ArrowRight", false, false)).toBe(`${ESC}[C`);
    expect(keystrokesOf("ArrowLeft", false, false)).toBe(`${ESC}[D`);
  });

  it("sends DEL for Backspace, which is what a terminal expects", () => {
    expect(keystrokesOf("Backspace", false, false)).toBe("\u007f");
  });

  it("sends one printable character as itself", () => {
    expect(keystrokesOf("a", false, false)).toBe("a");
    expect(keystrokesOf("ç", false, false)).toBe("ç");
    expect(keystrokesOf(" ", false, false)).toBe(" ");
  });

  it("keeps a key it does not map, so a human is never trapped inside a Pane", () => {
    for (const key of ["F5", "Shift", "Meta", "Control", "CapsLock", "F12"]) {
      expect(keystrokesOf(key, false, false)).toBeUndefined();
      expect(keystrokesOf(key, true, false)).toBeUndefined();
    }
    // Ctrl held over a key that carries no control byte is a browser shortcut, not a keystroke.
    expect(keystrokesOf("1", true, false)).toBeUndefined();
  });

  it("prefixes the control byte with ESC when Alt is held too, rather than dropping the Ctrl", () => {
    // Ctrl+Alt+R is ESC then Ctrl+R. Sending ESC and `r` would deliver Alt+R under another name.
    expect(keystrokesOf("r", true, true)).toBe(`${ESC}\u0012`);
    expect(keystrokesOf("r", false, true)).toBe(`${ESC}r`);
  });

  it("carries the punctuation keys that hold the rest of the C0 range", () => {
    expect(keystrokesOf("[", true, false)).toBe(ESC);
    expect(keystrokesOf(" ", true, false)).toBe("\u0000");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The markup a click reads
 *
 * The contract between the renderers and `answerFor`, which is what a DOM test would exercise by
 * clicking. Asserted over the markup instead, because there is no DOM here — see the module doc.
 * ---------------------------------------------------------------------------------------------- */

describe("the markup a click reads agrees with what answerFor reads", () => {
  /** Every rendering this view can produce, so no control escapes the checks below. */
  function everyRendering(): readonly string[] {
    const gate = showing(gateHalted());
    const cap = showing(capHalted());
    const panes = showing(running());
    fold(panes, { kind: "pane-data", paneId: String(DELEGATION), chunk: "x" } as ToCockpit);
    return [renderCockpit(gate), renderCockpit(cap), renderCockpit(panes)];
  }

  function attributesIn(html: string, attribute: string): readonly string[] {
    const found = html.matchAll(new RegExp(`${attribute}="([^"]*)"`, "gu"));
    return [...found].map((match) => match[1] ?? "");
  }

  it("puts only actions answerFor knows on a control", () => {
    const seen = new Set<string>();
    for (const html of everyRendering()) {
      for (const action of attributesIn(html, "data-action")) {
        seen.add(action);
        expect(answerFor(action, {}, at(9)).kind).toBe("sends");
      }
    }
    // And every action it knows is reachable from some rendering: a dead action is a dead control.
    expect([...seen].sort()).toEqual([...ACTIONS].sort());
  });

  it("puts only value names answerFor reads on a box", () => {
    const read = new Set(["gateId", "reason", "amount", "paneId"]);
    for (const html of everyRendering()) {
      for (const name of attributesIn(html, "data-value")) {
        expect(read.has(name)).toBe(true);
      }
      // And there is no second spelling: a value named by part of an attribute's *name* would be
      // lowercased by an HTML parser and arrive under a name `answerFor` does not read. See
      // `valuesAround`, which used to carry that branch and what it cost.
      expect(html).not.toMatch(/data-value-[A-Za-z]/u);
    }
  });

  it("carries every value each answer needs, in the block that answer's control sits in", () => {
    const gate = renderAnswers(showing(gateHalted()));
    expect(gate).toContain(`data-value="gateId"`);
    expect(gate).toContain(`data-value="reason"`);

    const cap = renderAnswers(showing(capHalted()));
    expect(cap).toContain(`data-value="amount"`);

    const panes = showing(running());
    fold(panes, { kind: "pane-data", paneId: "p", chunk: "x" } as ToCockpit);
    // The same mechanism as the Gate's: the name is the *value* of `data-value`, so no attribute name
    // carries a capital letter and nothing depends on how a parser cases one.
    expect(renderPanes(panes)).toContain(`data-value="paneId"`);
    expect(renderPanes(panes)).toContain(`value="p"`);
  });

  it("renders every region attach looks up, so a redraw finds somewhere to draw", () => {
    const cockpit = showing(running());
    fold(cockpit, { kind: "pane-data", paneId: "p", chunk: "x" } as ToCockpit);
    const html = renderCockpit(cockpit);
    for (const id of [`id="mission"`, `id="panes"`, `id="record"`, `id="screen-1"`]) {
      expect(html).toContain(id);
    }
    // And the element a keystroke is read from carries the PaneId the write is addressed to.
    expect(html).toContain(`data-pane="p"`);
    expect(html).toContain(`class="screen"`);
  });

  it("answers unknown for an action nobody rendered, which is the only way one can arrive", () => {
    const answer = answerFor("drop-the-database", {}, at(9));
    expect(answer.kind).toBe("unknown");
  });

  it("emits a pane-kill addressed to the Pane the control names", () => {
    const answer = answerFor("kill-pane", { paneId: "pane-7" }, at(9));
    expect(answer).toEqual({ kind: "sends", sent: { kind: "pane-kill", paneId: "pane-7" } });
  });
});

/* -------------------------------------------------------------------------------------------------
 * A record damaged past what any rule validated — BUG-2
 *
 * `runtime/mission-store.ts` deliberately does not judge what it loads (ADR 0009), so a `mission-halted`
 * fact that lost its Halt folds cleanly to `{ status: "halted", halt: null }` and the server serves it.
 * The engine closed its half of this inside this PRD — `added()` in `engine/domain/replay.ts` — and the
 * view had not. Reading `state.halt.reason` threw inside the socket's `message` handler, where nothing
 * catches it, so the Cockpit drew nothing at all and said nothing about why.
 *
 * The damage is applied to a Replay the **engine** built and folded by the **engine's** `stateOf`, so
 * every state below is one the domain really produces from a file in that condition.
 * ---------------------------------------------------------------------------------------------- */

/** One Event of an accepted Decision, replaced. Everything else about the Replay is the engine's. */
function damaged(recorded: Replay, hurt: (event: { readonly kind: string }) => unknown): Replay {
  return recorded.map((entry) =>
    entry.decision.kind === "accepted"
      ? { ...entry, decision: { ...entry.decision, events: entry.decision.events.map(hurt) } }
      : entry,
  ) as unknown as Replay;
}

/** The Cap halt of criterion 7, with the Halt itself gone: the line `bugs.md` reproduces. */
function haltLost(): Replay {
  return damaged(capHalted(), (event) =>
    event.kind === "mission-halted" ? { ...event, halt: null } : event,
  );
}

/** A Gate halt that says it is a Gate and names none. The other half of the same damage. */
function gateIdLost(): Replay {
  return damaged(gateHalted(), (event) =>
    event.kind === "mission-halted" ? { ...event, halt: { reason: "gate-open" } } : event,
  );
}

describe("a Halt no rule validated is read, never dereferenced", () => {
  it("folds to a halted Mission with no Halt, which is the premise the rest of this rests on", () => {
    const state = stateOf(haltLost());
    expect(state.status).toBe("halted");
    // Measured rather than assumed: a test whose reasoning contains "because" has to check the because.
    expect((state as unknown as { readonly halt: unknown }).halt).toBeNull();
  });

  it("does not read a lost Halt as a Cap, because that is a different fact and a different remedy", () => {
    const state = stateOf(haltLost());
    expect(() => stoppedAtCap(state)).not.toThrow();
    expect(stoppedAtCap(state)).toBe(false);
    expect(() => haltingGate(state)).not.toThrow();
    expect(haltingGate(state)).toBeUndefined();
  });

  it("offers nothing for a Gate the halt names but the fact does not", () => {
    const state = stateOf(gateIdLost());
    expect(haltingGate(state)).toBeUndefined();
    // And the Gate is still on the record: what is missing is which one the Mission stopped at, so
    // answering any of them would be answering a question nobody asked.
    expect(isOpened(state) ? state.gates.length : 0).toBe(1);
  });

  it("draws the whole Cockpit anyway — the bar, the Meter and the record — and offers no answer", () => {
    const cockpit = showing(haltLost());
    const html = renderCockpit(cockpit);

    expect(html).toContain(escapeHtml("Ship the Cockpit view"));
    expect(html).toContain(formatMoney(moneyFromDecimal("10.00")));
    expect(renderAnswers(cockpit)).toBe("");
    // The pill still says where the Mission is. What cannot be read is *why* it stopped, and the view
    // says nothing rather than guessing.
    expect(html).toContain("halted");
  });

  it("draws a Mission whose delegation list was lost, instead of counting it", () => {
    const hurt = damaged(running(), (event) =>
      event.kind === "delegated" ? { ...event, delegationId: undefined } : event,
    );
    const cockpit = cockpitOf(6, 40, 50);
    fold(cockpit, {
      kind: "mission",
      state: { ...stateOf(hurt), delegations: null },
    } as unknown as ToCockpit);

    expect(() => renderMission(cockpit)).not.toThrow();
    expect(renderMission(cockpit)).toContain("a delegation list this Mission does not carry");
    // Never "0 delegations": a number in front of a human that no rule computed is the lie this
    // repository keeps refusing.
    expect(renderMission(cockpit)).not.toContain("0 delegation");
  });

  it("offers no Gate when the list holds something that is not one", () => {
    // Guarding the list and then dereferencing what is in it is the half of the rule that is easy to
    // miss: a `find` callback reading `gate.id` off `[null]` throws in the same listener, for the same
    // reason. Reachable from a frame, because `fold` checks that a state is an object and no more.
    const cockpit = cockpitOf(6, 40, 50);
    fold(cockpit, {
      kind: "mission",
      state: {
        status: "halted",
        halt: { reason: "gate-open", gateId: "g-somewhere" },
        gates: [null],
        delegations: [],
      },
    } as unknown as ToCockpit);

    expect(() => haltingGate(cockpit.state)).not.toThrow();
    expect(haltingGate(cockpit.state)).toBeUndefined();
    expect(() => renderMission(cockpit)).not.toThrow();
  });

  it("attributes nothing to a Pane when the Delegation list holds something that is not one", () => {
    const cockpit = cockpitOf(6, 40, 50);
    fold(cockpit, {
      kind: "mission",
      state: { status: "running", delegations: [null], gates: [] },
    } as unknown as ToCockpit);

    expect(() => delegationFor(cockpit.state, "pane-one")).not.toThrow();
    expect(delegationFor(cockpit.state, "pane-one")).toBeUndefined();
    expect(providerFor(cockpit.state, "pane-one")).toBeUndefined();
    expect(spentOn(cockpit.state, "pane-one")).toBeUndefined();
  });

  it("draws an entry whose Decision was lost, and says that is what is missing", () => {
    // The Command half of a Step was already read as `unknown`; the Decision was not, and
    // `entry.decision.kind` throws off an entry that lost it. The record still draws, and it says which
    // of the two it could not read rather than reporting the gesture as refused.
    const entry = { command: { kind: "delegate" } } as unknown as ReplayEntry;

    expect(() => renderEntry(entry)).not.toThrow();
    expect(renderEntry(entry)).toContain("an unreadable Decision");
    expect(renderEntry(entry)).toContain("delegate");
    expect(renderEntry(entry)).not.toContain("refused");
  });
});

/* =================================================================================================
 * A DOM small enough to be honest
 *
 * `attach` is the one function in `client.ts` that touches a page, and until now **nothing executed
 * it**: QA's plant severed the single line that sends a click's gesture and all 1078 tests stayed
 * green. `jsdom` is not installed and `package.json` is out of scope, so the choice is a shim or
 * nothing — and QA showed a shim is enough by driving the served bootstrap under one it wrote itself.
 *
 * ## Where the line is drawn, because this repository has a rule about doubles
 *
 * "A fake with rules of its own is a second rule set the tests pass because of." So this one holds **no
 * judgement about the Cockpit at all**: it does not know what a click means, which attributes matter, or
 * what a gesture looks like. It does two things a browser does — parse the markup the view really
 * emitted, and deliver an event to the listeners `attach` really registered — and records what it was
 * asked to send. Every assertion about *meaning* is made against the module's own exported
 * `answerFor`, `keystrokesOf` and `ACTIONS`: the tests below never spell a frame out by hand, they
 * compare what came out of the socket with what the pure function says that click meant.
 *
 * Three consequences of that line, stated rather than discovered later:
 *
 * - **The markup is the view's**, never this file's. The tree is parsed from `renderCockpit` output, so
 *   a control the view stops rendering disappears from these tests instead of passing against a fixture
 *   nobody ships. The one exception is the "action nobody rendered" case, which cannot come from a
 *   renderer by construction and says so where it sits.
 * - **The parser is guarded rather than trusted.** A parser that quietly dropped elements would make
 *   every test below pass over an empty tree, which is the under-reporting failure `CLAUDE.md` records
 *   about scans. `the parser sees every control the markup carries` counts the raw string's attributes
 *   against the tree's, so the shim cannot be silently wrong about the thing it exists to read.
 * - **Attribute names are lowercased**, which is what an HTML parser does, and it is the one place this
 *   shim's fidelity has teeth: the first run of these tests found the Kill control reading its PaneId
 *   out of `data-value-paneId`, whose `dataset` key in a browser is `valuePaneid`. `valuesAround`
 *   records what that cost and why the view no longer depends on it.
 *
 * What is still not proven, and no shim can prove: that a browser's own `closest`, `dataset` and event
 * dispatch behave as read here, that `innerHTML` parses this markup the same way, and that anything is
 * laid out or painted. This is the wiring, exercised. It is not a browser.
 * ============================================================================================== */

/** The tags that carry no closing tag. `input` is the only one this view emits; the rest are HTML's. */
const VOID_TAGS: ReadonlySet<string> = new Set(["input", "br", "hr", "img", "meta", "link"]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>/gu;
const ATTRIBUTE = /([^\s=/>]+)(?:="([^"]*)")?/gu;

/** The reverse of `escapeHtml`, which is the only escaping the view does. `&amp;` last, as a parser does. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/** `data-value-paneid` → `valuePaneid`. Dash-to-camel, over a name a parser has already lowercased. */
function camelOf(name: string): string {
  return name.replace(/-([a-z0-9])/gu, (_whole, letter: string) => letter.toUpperCase());
}

type ShimEvent = {
  readonly type: string;
  readonly target: ShimElement;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
};

/** One element. Nothing here is about the Cockpit; it is the handful of members `attach` touches. */
class ShimElement {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** Children and text, in the order they were parsed, so `textContent` is exact rather than nearly. */
  readonly nodes: (ShimElement | string)[] = [];
  parent: ShimElement | undefined = undefined;
  scrollTop = 0;
  private readonly listeners = new Map<string, ((event: ShimEvent) => void)[]>();

  constructor(tag: string, attributes: ReadonlyMap<string, string>) {
    this.tag = tag;
    this.attributes = attributes;
  }

  get children(): ShimElement[] {
    return this.nodes.filter((node): node is ShimElement => typeof node !== "string");
  }

  /** What a human reads, entity-decoded, as a browser's `textContent` answers it. */
  get textContent(): string {
    return this.nodes
      .map((node) => (typeof node === "string" ? node : node.textContent))
      .join("");
  }

  /** A browser's `scrollHeight` on an element nothing laid out. `attach` only ever writes `scrollTop`. */
  get scrollHeight(): number {
    return 0;
  }

  get dataset(): Record<string, string> {
    const data: Record<string, string> = {};
    for (const [name, value] of this.attributes) {
      if (name.startsWith("data-")) {
        data[camelOf(name.slice("data-".length))] = value;
      }
    }
    return data;
  }

  /**
   * Replaces this element's content, exactly as `attach` does on the root and on a region.
   *
   * Write-only on purpose: a browser's getter **serialises its children**, and a serialiser here would be
   * a rule of this shim's own that an assertion could then pass or fail because of. Tests read
   * `textContent`, which is what a human reads.
   */
  set innerHTML(html: string) {
    this.nodes.length = 0;
    parseInto(this, html);
  }

  /** Descendants, in document order. A browser's `querySelector*` never matches the element itself. */
  descendants(): ShimElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selector: string): ShimElement | null {
    return this.descendants().find((element) => matches(element, selector)) ?? null;
  }

  querySelectorAll(selector: string): ShimElement[] {
    return this.descendants().filter((element) => matches(element, selector));
  }

  closest(selector: string): ShimElement | null {
    for (let at: ShimElement | undefined = this; at !== undefined; at = at.parent) {
      if (matches(at, selector)) {
        return at;
      }
    }
    return null;
  }

  addEventListener(type: string, listener: (event: ShimEvent) => void): void {
    const held = this.listeners.get(type) ?? [];
    held.push(listener);
    this.listeners.set(type, held);
  }

  listenersFor(type: string): readonly ((event: ShimEvent) => void)[] {
    return this.listeners.get(type) ?? [];
  }
}

/** An `<input>`, whose `value` starts as the attribute said and is whatever was typed after that. */
class ShimInput extends ShimElement {
  value: string;

  constructor(tag: string, attributes: ReadonlyMap<string, string>) {
    super(tag, attributes);
    this.value = attributes.get("value") ?? "";
  }
}

/**
 * The three selector forms this view uses: `#id`, `.class`, `[attribute]`.
 *
 * Anything else **throws**, rather than answering "no match": a shim that silently matched nothing would
 * turn a renamed selector into a green test, which is the failure mode this whole section exists to
 * close.
 */
function matches(element: ShimElement, selector: string): boolean {
  if (selector.startsWith("#")) {
    return element.attributes.get("id") === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return (element.attributes.get("class") ?? "").split(/\s+/u).includes(selector.slice(1));
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    return element.attributes.has(selector.slice(1, -1));
  }
  throw new Error(`this shim does not implement the selector ${JSON.stringify(selector)}`);
}

/** Attribute names lowercased, values entity-decoded: what an HTML parser hands a `dataset`. */
function attributesIn(source: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) {
    attributes.set((name ?? "").toLowerCase(), decodeEntities(value ?? ""));
  }
  return attributes;
}

/** Parses the view's own dialect: quoted attributes, escaped text, `<input>` void, nothing else. */
function parseInto(root: ShimElement, html: string): void {
  const open: ShimElement[] = [root];
  let at = 0;

  const hold = (text: string): void => {
    if (text.length > 0) {
      open[open.length - 1]?.nodes.push(decodeEntities(text));
    }
  };

  for (const found of html.matchAll(TAG)) {
    hold(html.slice(at, found.index));
    at = found.index + found[0].length;

    const tag = (found[2] ?? "").toLowerCase();
    if (found[1] === "/") {
      const depth = open.findLastIndex((element) => element.tag === tag);
      if (depth > 0) {
        open.length = depth;
      }
      continue;
    }

    const element =
      tag === "input"
        ? new ShimInput(tag, attributesIn(found[3] ?? ""))
        : new ShimElement(tag, attributesIn(found[3] ?? ""));
    const holder = open[open.length - 1];
    if (holder !== undefined) {
      element.parent = holder;
      holder.nodes.push(element);
    }
    if (!VOID_TAGS.has(tag) && found[4] !== "/") {
      open.push(element);
    }
  }

  hold(html.slice(at));
}

/** A page with one root, the four globals `attach` reads, and a note of everything sent. */
type Page = {
  readonly root: ShimElement;
  /** Every `FromCockpit` `attach` handed to `send`, in order. Nothing is interpreted. */
  readonly sent: FromCockpit[];
  /** The socket's `message` handler, which is what `attach` answers with. */
  readonly receives: (said: ToCockpit) => void;
  /** The Instant every gesture on this page carries, so an assertion can rebuild the same Command. */
  readonly at: string;
  /** Delivers an event to the listeners registered on the element and on its ancestors. */
  click(target: ShimElement): void;
  keydown(target: ShimElement, key: string, ctrl?: boolean, alt?: boolean): boolean;
};

/**
 * `attach`, running: the real function, over the real markup, with the real listeners.
 *
 * The globals are installed here because `client.ts` reads `HTMLElement` and `HTMLInputElement` off the
 * global scope — the browser's own way of asking "is this an element" — and Vitest's node environment
 * has neither. They are removed again in `afterEach`, so no other test in this file ever sees them.
 */
function attached(cockpit: Cockpit): Page {
  (globalThis as Record<string, unknown>)["HTMLElement"] = ShimElement;
  (globalThis as Record<string, unknown>)["HTMLInputElement"] = ShimInput;

  const root = new ShimElement("div", new Map());
  const sent: FromCockpit[] = [];
  const now = new Date(BASE + 99 * 60_000).toISOString();

  const receives = attach(cockpit, {
    root: root as unknown as HTMLElement,
    send: (frame: FromCockpit) => {
      sent.push(frame);
    },
    now: () => now,
  });

  const deliver = (target: ShimElement, event: ShimEvent): void => {
    for (let at: ShimElement | undefined = target; at !== undefined; at = at.parent) {
      for (const listener of at.listenersFor(event.type)) {
        listener(event);
      }
    }
  };

  return {
    root,
    sent,
    receives,
    at: now,
    click(target: ShimElement): void {
      deliver(target, {
        type: "click",
        target,
        key: "",
        ctrlKey: false,
        altKey: false,
        preventDefault: () => undefined,
      });
    },
    keydown(target: ShimElement, key: string, ctrl = false, alt = false): boolean {
      let prevented = false;
      deliver(target, {
        type: "keydown",
        target,
        key,
        ctrlKey: ctrl,
        altKey: alt,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["HTMLElement"];
  delete (globalThis as Record<string, unknown>)["HTMLInputElement"];
});

/** A Cockpit with two Panes, so "the Pane this control sits in" has two candidates rather than one. */
function withPanes(): Cockpit {
  const cockpit = showing(running());
  fold(cockpit, { kind: "pane-data", paneId: "pane-one", chunk: "one" } as ToCockpit);
  fold(cockpit, { kind: "pane-data", paneId: "pane-two", chunk: "two" } as ToCockpit);
  return cockpit;
}

/** The control carrying an action, in the page's own markup. Fails loudly rather than answering null. */
function controlFor(page: Page, action: Action): ShimElement {
  const found = page.root
    .querySelectorAll("[data-action]")
    .find((element) => element.attributes.get("data-action") === action);
  if (found === undefined) {
    throw new Error(`the view rendered no control for ${action}`);
  }
  return found;
}

/** A box in the block a control sits in, by the value it names. */
function boxFor(page: Page, name: string): ShimInput {
  const found = page.root
    .querySelectorAll("[data-value]")
    .find((element) => element.attributes.get("data-value") === name);
  if (!(found instanceof ShimInput)) {
    throw new Error(`the view rendered no box for ${name}`);
  }
  return found;
}

describe("a click becomes the gesture answerFor says it means", () => {
  it("the parser sees every control the markup carries", () => {
    // The guard that keeps every test below from passing over an empty tree. Counted against the raw
    // string the view produced, so the shim cannot be quietly wrong about the one thing it is for.
    const cockpit = showing(gateHalted());
    fold(cockpit, { kind: "pane-data", paneId: String(DELEGATION), chunk: "building" } as ToCockpit);
    const html = renderCockpit(cockpit);
    const page = attached(cockpit);

    const counted = (attribute: string): number => html.split(`${attribute}=`).length - 1;
    expect(counted("data-action")).toBeGreaterThan(2);
    expect(page.root.querySelectorAll("[data-action]")).toHaveLength(counted("data-action"));
    expect(page.root.querySelectorAll("[data-value]")).toHaveLength(counted("data-value"));
    expect(page.root.querySelectorAll("[data-pane]")).toHaveLength(counted("data-pane"));
    // And the regions a redraw writes into are found by the same selectors `attach` uses.
    for (const id of ["mission", "panes", "record", "screen-1"]) {
      expect(page.root.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("sends the Gate approval, and it is exactly what answerFor makes of that control", () => {
    const page = attached(showing(gateHalted()));

    page.click(controlFor(page, "approve-gate"));

    // Never a frame spelled out here: the assertion is that the wiring and the judgement agree, and the
    // judgement is the module's own. A Command written by hand in this file would pass a severed wire
    // only if the wire were severed in the same way twice.
    const meant = answerFor("approve-gate", { gateId: String(GATE) }, page.at);
    expect(page.sent).toEqual([meant.kind === "sends" ? meant.sent : undefined]);
    // And it really is the Gate the halt names, read off the markup rather than from this test.
    expect(boxFor(page, "gateId").value).toBe(String(GATE));
  });

  it("carries what a human typed into the box beside the control", () => {
    const page = attached(showing(gateHalted()));
    boxFor(page, "reason").value = "the survey missed the runtime";

    page.click(controlFor(page, "revise-gate"));

    const meant = answerFor(
      "revise-gate",
      { gateId: String(GATE), reason: "the survey missed the runtime" },
      page.at,
    );
    expect(page.sent).toEqual([meant.kind === "sends" ? meant.sent : undefined]);
  });

  it("carries the amount typed into the Authorisation, in the notation a human types", () => {
    const page = attached(showing(capHalted()));
    boxFor(page, "amount").value = "R$ 30,00";

    page.click(controlFor(page, "authorise-cap"));

    const meant = answerFor("authorise-cap", { amount: "R$ 30,00" }, page.at);
    expect(page.sent).toEqual([meant.kind === "sends" ? meant.sent : undefined]);
    const submitted = page.sent[0];
    if (submitted?.kind !== "submit" || submitted.command.kind !== "authorise-cap") {
      throw new Error("an Authorisation is a submit");
    }
    // Pinned against the engine, because a view that reads its own numbers is a view with a rule.
    expect(submitted.command.cap).toBe(moneyFromDecimal("30.00"));
  });

  it("names the Pane the Kill control sits in, and not another one", () => {
    const page = attached(withPanes());

    // The second Pane's control, so "the block it sits in" is a claim with two candidates. A fixture with
    // one Pane could not tell "the Pane this control belongs to" from "the first Pane on the page".
    const second = page.root
      .querySelectorAll("[data-pane]")
      .find((pane) => pane.attributes.get("data-pane") === "pane-two");
    const killing = second?.querySelectorAll("[data-action]")[0];
    if (killing === undefined) {
      throw new Error("the second Pane rendered no Kill control");
    }

    page.click(killing);

    const meant = answerFor("kill-pane", { paneId: "pane-two" }, page.at);
    expect(page.sent).toEqual([meant.kind === "sends" ? meant.sent : undefined]);
  });

  it("wires every action the Cockpit renders, and nothing that is not a control", () => {
    // The whole claim plant 7 measured: each rendered control reaches `send`. Driven over every rendering
    // this view can produce, so an action added to `ACTIONS` with no wire fails here.
    const answered = new Set<string>();
    for (const cockpit of [showing(gateHalted()), showing(capHalted()), withPanes()]) {
      const page = attached(cockpit);
      for (const control of page.root.querySelectorAll("[data-action]")) {
        const before = page.sent.length;
        page.click(control);
        expect(page.sent.length).toBe(before + 1);
        answered.add(control.attributes.get("data-action") ?? "");
      }
    }
    expect([...answered].sort()).toEqual([...ACTIONS].sort());
  });

  it("sends nothing for a click that is not on a control", () => {
    const page = attached(showing(gateHalted()));
    const question = page.root.querySelector(".question");
    if (question === null) {
      throw new Error("the Gate's question is drawn");
    }

    page.click(question);

    expect(page.sent).toEqual([]);
  });

  it("sends nothing for an action no renderer emits, which is the only way one can arrive", () => {
    // The one place this file writes markup: by construction it cannot come from a renderer, and
    // `answerFor` answering `unknown` is what `attach` must not turn into a frame.
    const page = attached(showing(gateHalted()));
    page.root.innerHTML = `<button data-action="drop-the-database">Go on then</button>`;
    const planted = page.root.querySelector("[data-action]");
    if (planted === null) {
      throw new Error("the planted control is there");
    }

    page.click(planted);

    expect(answerFor("drop-the-database", {}, page.at).kind).toBe("unknown");
    expect(page.sent).toEqual([]);
  });
});

describe("a keypress reaches the Pane it was typed into", () => {
  it("sends what keystrokesOf makes of the key, addressed to that Pane", () => {
    const page = attached(withPanes());
    const screen = page.root.querySelectorAll(".screen")[1];
    if (screen === undefined) {
      throw new Error("the second Pane has a screen");
    }

    const prevented = page.keydown(screen, "c", true, false);

    expect(prevented).toBe(true);
    expect(page.sent).toEqual([
      { kind: "pane-write", paneId: "pane-two", keystrokes: keystrokesOf("c", true, false) },
    ]);
  });

  it("leaves a key it does not map to the browser", () => {
    const page = attached(withPanes());
    const screen = page.root.querySelectorAll(".screen")[0];
    if (screen === undefined) {
      throw new Error("the first Pane has a screen");
    }

    expect(page.keydown(screen, "F5", false, false)).toBe(false);
    expect(keystrokesOf("F5", false, false)).toBeUndefined();
    expect(page.sent).toEqual([]);
  });

  it("ignores a keypress that did not land in a Pane", () => {
    const page = attached(showing(gateHalted()));
    const box = boxFor(page, "reason");

    expect(page.keydown(box, "a", false, false)).toBe(false);
    expect(page.sent).toEqual([]);
  });
});

describe("a frame from the server redraws the region that moved", () => {
  it("draws the Gate's question when the Mission halts at one", () => {
    const page = attached(cockpitOf(6, 40, 50));
    expect(page.root.querySelector("#mission")?.textContent).toContain("waiting for the Mission");

    page.receives(missionMessage(gateHalted()));

    const bar = page.root.querySelector("#mission");
    expect(bar?.textContent).toContain("The Contract is signed. Carry on?");
    expect(bar?.textContent).toContain("Approve");
    // And the answer is live: the control the redraw wrote is the one a click now finds.
    page.click(controlFor(page, "approve-gate"));
    expect(page.sent).toHaveLength(1);
  });

  it("draws a Mission whose Halt was lost, instead of throwing in the socket listener — BUG-2", () => {
    const page = attached(cockpitOf(6, 40, 50));

    // The exact failure: the frame reaches `attach`'s redraw, `renderMission` calls `renderAnswers`, and
    // `state.halt.reason` was read off `null`. The throw was *inside* the `message` handler, so nothing
    // caught it and the region kept "waiting for the Mission" for ever.
    expect(() => page.receives(missionMessage(haltLost()))).not.toThrow();

    const bar = page.root.querySelector("#mission");
    expect(bar?.textContent).toContain("Ship the Cockpit view");
    expect(bar?.textContent).not.toContain("waiting for the Mission");
    // A later frame still draws, which is the other half of what the throw cost.
    page.receives(missionMessage(capHalted()));
    expect(page.root.querySelector("#mission")?.textContent).toContain("The Cap has been reached");
  });

  it("writes a Pane's bytes into that Pane's screen and leaves the rest of the page alone", () => {
    const page = attached(withPanes());
    const bar = page.root.querySelector("#mission")?.textContent;

    page.receives({ kind: "pane-data", paneId: "pane-one", chunk: "hello" } as ToCockpit);

    expect(page.root.querySelector("#screen-1")?.textContent).toContain("hello");
    expect(page.root.querySelector("#screen-2")?.textContent).not.toContain("hello");
    expect(page.root.querySelector("#mission")?.textContent).toBe(bar);
  });

  it("draws a Decision the moment it is decided, Refusal and all", () => {
    const page = attached(showing(running()));
    const refused = submit(running(), {
      kind: "decide-gate",
      occurredAt: at(6),
      gateId: GATE,
      decision: { kind: "approved" },
    });
    const entry = refused[refused.length - 1];
    if (entry === undefined || entry.decision.kind !== "refused") {
      throw new Error("this fixture must produce a Refusal");
    }

    page.receives({ kind: "decided", entry });

    const record = page.root.querySelector("#record")?.textContent ?? "";
    expect(record).toContain("refused");
    expect(record).toContain(entry.decision.refusal.violations[0] ?? "");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Type-level guarantees
 *
 * Each is falsified by breaking the **source of the guarantee** and confirming `tsc --noEmit
 * --incremental false` reports `TS2578: Unused '@ts-expect-error' directive` — never by widening a
 * helper in this file, which would prove only that the scaffolding is wired up. The two that cannot be
 * phrased as a directive are annotations whose falsification fails the build instead; both say so.
 * ---------------------------------------------------------------------------------------------- */

describe("the guarantees the compiler carries", () => {
  it("refuses to read `sent` off an Answer nobody narrowed", () => {
    const answer = answerFor("approve-gate", {}, at(0));
    // @ts-expect-error the `unknown` member declares no `sent`, so every caller has to answer the fault
    const read = () => answer.sent;
    expect(typeof read).toBe("function");
    // The runtime half: narrowing is what makes it readable.
    expect(answer.kind === "sends" ? answer.sent.kind : "").toBe("submit");
  });

  it("refuses an action name that is not one of the four the Cockpit renders", () => {
    // @ts-expect-error `Action` is the union of ACTIONS, not `string`: an unrendered action is not one
    const action: Action = "drop-the-database";
    expect(typeof action).toBe("string");
    expect([...ACTIONS]).toContain("approve-gate");
  });

  it("refuses to resize a screen, because rows and cols are fixed when it is made", () => {
    const screen = screenOf(4, 20, 10);
    // @ts-expect-error `rows` is readonly: this terminal does not reflow, and the type is what says so
    screen.rows = 40;
    // @ts-expect-error `cols` is readonly for the same reason, and no rule anywhere changes it
    screen.cols = 200;
    expect(screen.rows).toBe(40);
  });

  it("refuses to swap a Cockpit's Pane list, although the fold appends to it", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "x" } as ToCockpit);
    expect(cockpit.panes.length).toBe(1);
    // @ts-expect-error `panes` is a readonly reference: a Pane is added by the fold, never replaced
    cockpit.panes = [];
    // Readonly is a compile-time guarantee and nothing freezes this list, which is the point: the
    // fold pushes onto it. What the type stops is a caller throwing the Panes away wholesale.
    expect(cockpit.panes.length).toBe(0);
  });

  it("refuses to renumber a Pane, because its slot is assigned once when it is first heard from", () => {
    const cockpit = cockpitOf(4, 20, 10);
    fold(cockpit, { kind: "pane-data", paneId: "a", chunk: "x" } as ToCockpit);
    const pane = cockpit.panes[0]!;
    // @ts-expect-error `ordinal` is readonly: the grid slot is the order the Pane was first heard in
    pane.ordinal = 9;
    // @ts-expect-error `paneId` is readonly: a Pane is not renamed, a different Pane is a different one
    pane.paneId = "b";
    expect(pane.ordinal).toBe(9);
  });

  it("refuses to draw a Meter that may not be there", () => {
    const cockpit = showing(running());
    // @ts-expect-error `renderMeter` takes a Meter: an unopened Mission has none, and none is not zero
    renderMeter(cockpit.meter);
    expect(cockpit.meter).toBeDefined();
  });

  it("refuses to fold a gesture, because the fold reads what the server said", () => {
    const cockpit = cockpitOf(4, 20, 10);
    // @ts-expect-error `pane-write` is a FromCockpit: it travels the other way and folds into nothing
    fold(cockpit, { kind: "pane-write", paneId: "a", keystrokes: "x" });
    expect(cockpit.panes).toEqual([]);
  });

  /**
   * A guarantee no directive can phrase, so it is an annotation: `answerFor`'s `submit` carries a
   * `MissionCommand` and not an object that merely looks like one. Falsifying it — widening `Submit`'s
   * `command`, or building the Gate answer without the `DecideGate` annotation — fails the build with
   * `TS2322` rather than reporting `TS2578`, which is the third kind of proof this repo records.
   */
  it("emits Commands the engine's own union accepts", () => {
    const answer = answerFor("approve-gate", { gateId: String(GATE) }, at(0));
    if (answer.kind !== "sends" || answer.sent.kind !== "submit") {
      throw new Error("the Gate answer is a submit");
    }
    const asCommand: MissionCommand = answer.sent.command;
    expect(asCommand.kind).toBe("decide-gate");

    const cap = answerFor("authorise-cap", { amount: "30,00" }, at(0));
    if (cap.kind !== "sends" || cap.sent.kind !== "submit") {
      throw new Error("the Cap answer is a submit");
    }
    const asCap: MissionCommand = cap.sent.command;
    expect(asCap.kind).toBe("authorise-cap");
  });

  /**
   * The other annotation: `keystrokesOf` answers `string | undefined`, so a caller **cannot** forget
   * that some keys stay the browser's. Falsified by narrowing the return type to `string`, which fails
   * the build here with `TS2322` at the `undefined` half.
   */
  it("makes a caller handle the key it does not map", () => {
    const mapped: string | undefined = keystrokesOf("F5", false, false);
    expect(mapped).toBeUndefined();
  });
});
