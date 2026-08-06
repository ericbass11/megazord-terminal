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
 * **There is no DOM, and that is a Gap, not a choice.** `jsdom` is not installed in this repository —
 * `npm ls jsdom` is empty, and asking for the jsdom environment in a per-file docblock fails the whole
 * file with `Cannot find package 'jsdom'` — and `package.json` is outside this task's scope, so the
 * environment cannot be added. Writing a DOM stub instead was rejected on this repository's own rule: a
 * fake with rules of its own is a second rule set the tests would start passing because of, and a
 * hand-written `closest` that disagrees with a browser's is exactly the bug a DOM test exists to catch.
 *
 * (Naming that pragma in this docblock is itself a trap, and it cost a red run: **vitest reads the
 * pragma out of the first docblock of a file, comment or not**, exactly as TypeScript honours
 * `@ts-expect-error` only when the directive opens the comment. Mentioning it in prose here switched the
 * environment on and the file could not start at all.)
 *
 * So `attach` is not executed, and what would have been proven by clicking is proven in three other
 * ways, none of which is a snapshot:
 *
 * 1. **The judgement is driven directly.** `answerFor` is the whole of what a click decides, and it is
 *    called with the values a click would carry.
 * 2. **The renderer and the reader are cross-checked** (see "The markup a click reads"). Every
 *    `data-action` the renderers emit must be an action `answerFor` knows; every `data-value` they emit
 *    must be a value `answerFor` reads; every region id `attach` looks up must exist in the markup. That
 *    is the contract a DOM test would exercise, asserted over the markup itself.
 * 3. **The end-to-end run is in `cockpit/view.test.ts`**, over the real server and a real WebSocket.
 *
 * What stays unproven is the browser's own half: that a click event bubbles to the delegated listener,
 * and that `closest` and `dataset` behave as read. It is listed as a Gap in `client.ts` too.
 */

import { describe, expect, it } from "vitest";

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

import type { ToCockpit } from "../protocol";
import type { PaneStatus } from "../../runtime/pane-manager";

import {
  ACTIONS,
  answerFor,
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
      // `data-value-paneId` is the other spelling: a value carried on the control itself.
      for (const [, name] of html.matchAll(/data-value-([A-Za-z]+)=/gu)) {
        expect(read.has(name ?? "")).toBe(true);
      }
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
    expect(renderPanes(panes)).toContain(`data-value-paneId="p"`);
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
