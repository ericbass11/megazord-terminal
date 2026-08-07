import { describe, expect, it } from "vitest";

import { core, orchestrationCapability } from "@engine/domain/capability";
import { clause, contract, type Contract } from "@engine/domain/contract";
import { gap, handoff, type Handoff } from "@engine/domain/handoff";
import { harness, type Harness, type HarnessSources } from "@engine/domain/harness";
import { clauseId, delegationId, gateId, missionId, zordId } from "@engine/domain/ids";
import { addMoney, moneyFromDecimal, ZERO_MONEY, type Money } from "@engine/domain/money";
import { meterOf } from "@engine/domain/meter";
import { revisionsIn } from "@engine/domain/gate";
import {
  instant,
  type Delegated,
  type Instant,
  type MissionEvent,
} from "@engine/domain/events";
import type { MissionCommand } from "@engine/domain/commands";
import {
  UNOPENED_MISSION,
  briefing,
  decide,
  evolve,
  isOpened,
  slice,
  type Mission,
} from "@engine/domain/mission";
import {
  EMPTY_REPLAY,
  eventsIn,
  eventsOf,
  refusedIn,
  replay,
  stateOf,
  stepsOf,
  submit,
  type Replay,
  type ReplayEntry,
  type Step,
} from "@engine/domain/replay";

/**
 * Criterion 7: **the Replay contains every delegation, refusal, gate decision and cost, in order, and
 * replaying it reconstructs the same final state.**
 *
 * The two halves are proven by two different things, which is the decision this file records:
 *
 * - **the final state** comes from the Event log — `replay(events)` is `events.reduce(evolve, …)` and is
 *   asserted against a Mission built Command by Command;
 * - **the Refusal** is not in that log and never will be, because `Decision`'s refused member carries a
 *   Refusal and no Events. So the Replay is the sequence of **Decisions**, and `refusedIn` is where a
 *   refused attempt is read. See the head of `replay.ts` for why the other admissible shape — a
 *   `Decision` that carries facts when it refuses — was rejected.
 *
 * The run every test here folds is one Mission with all four of criterion 7's things in it plus the two
 * halts the lifecycle has: a Handoff refused and resubmitted, a Gate raised and answered with a
 * revision, an accrual that reaches the Cap, and the authorisation that raises it. A happy path would
 * prove the fold against the half of the machine that never stops.
 */

const OPENED_AT: Instant = instant("2026-08-06T09:00:00.000Z");
const AT_10: Instant = instant("2026-08-06T10:00:00.000Z");
const AT_11: Instant = instant("2026-08-06T11:00:00.000Z");
const AT_12: Instant = instant("2026-08-06T12:00:00.000Z");
const AT_13: Instant = instant("2026-08-06T13:00:00.000Z");
const AT_14: Instant = instant("2026-08-06T14:00:00.000Z");
const AT_15: Instant = instant("2026-08-06T15:00:00.000Z");
const AT_16: Instant = instant("2026-08-06T16:00:00.000Z");
const AT_17: Instant = instant("2026-08-06T17:00:00.000Z");
const AT_18: Instant = instant("2026-08-06T18:00:00.000Z");
const AT_19: Instant = instant("2026-08-06T19:00:00.000Z");
const AT_20: Instant = instant("2026-08-06T20:00:00.000Z");

const MISSION = missionId("mission-1");
const SCOUT = zordId("zord-scout");
const BUILDER = zordId("zord-builder");
const FIRST = delegationId("delegation-1");
const SECOND = delegationId("delegation-2");
const GATE = gateId("gate-1");

const CAP = moneyFromDecimal("50.00");
const RAISED_CAP = moneyFromDecimal("80.00");
const SCOUT_COST = moneyFromDecimal("12.00");
const BUILDER_COST = moneyFromDecimal("38.00");

const LEADING_CORE = core([
  orchestrationCapability("delegate"),
  orchestrationCapability("chase"),
  orchestrationCapability("consolidate"),
]);

const CATALOG_DEFAULT: Harness = harness({
  cli: "claude",
  model: "sonnet-4-5",
  effort: "medium",
  skills: [],
});

const SOURCES: HarnessSources = { catalogDefault: CATALOG_DEFAULT };
/** The Roster wins over the invocation, so the second Zord runs at a higher Effort. Task 5's rule. */
const HARDER: HarnessSources = {
  rosterEntry: { effort: "high" },
  invocation: { effort: "low", model: "opus-4-1" },
  catalogDefault: CATALOG_DEFAULT,
};

const RENDERS = clauseId("clause-renders");
const NOTES = clauseId("clause-notes");

const REFERENCE_CONTRACT: Contract = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
  clause({ id: NOTES, description: "The Surfaces it touched are listed", required: false }),
]);

/** A required Clause declared as a Gap: honest, and worth nothing. Refused `contract-violation`. */
const VIOLATING_HANDOFF: Handoff = handoff({
  delegationId: FIRST,
  satisfies: [],
  gaps: [gap(RENDERS, "ran out of time")],
  artifacts: ["notes.md"],
});

const SCOUT_HANDOFF: Handoff = handoff({
  delegationId: FIRST,
  satisfies: [RENDERS],
  gaps: [gap(NOTES, "the Surfaces are still moving")],
  artifacts: ["surfaces.md"],
});

const BUILDER_HANDOFF: Handoff = handoff({
  delegationId: SECOND,
  satisfies: [RENDERS, NOTES],
  gaps: [],
  artifacts: ["cockpit.tsx", "cockpit.test.tsx"],
});

/**
 * The whole run, as Commands. One list, so every test in this file folds the same history and a change
 * to it cannot make one assertion pass while another silently stops describing the same Mission.
 */
const THE_RUN: readonly MissionCommand[] = [
  {
    kind: "open-mission",
    occurredAt: OPENED_AT,
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: CAP,
    core: LEADING_CORE,
  },
  {
    kind: "delegate",
    occurredAt: AT_10,
    delegationId: FIRST,
    zordId: SCOUT,
    slice: slice("Map the Surfaces the Cockpit needs and report the Contract of each"),
    harnessSources: SOURCES,
    contract: REFERENCE_CONTRACT,
  },
  { kind: "accrue-cost", occurredAt: AT_11, delegationId: FIRST, cost: SCOUT_COST },
  // Refused: the required Clause is declared as a Gap, which does not excuse it. No Event, and the
  // Delegation stays open — which is what the next Command depends on.
  { kind: "submit-handoff", occurredAt: AT_12, handoff: VIOLATING_HANDOFF },
  { kind: "submit-handoff", occurredAt: AT_13, handoff: SCOUT_HANDOFF },
  {
    kind: "raise-gate",
    occurredAt: AT_14,
    gateId: GATE,
    question: "The Contract grew a Clause. Does the Cockpit still ship this week?",
  },
  {
    kind: "decide-gate",
    occurredAt: AT_15,
    gateId: GATE,
    decision: {
      kind: "revision-requested",
      reason: "Ship the Cockpit shell first, the Pane grid next week",
    },
  },
  {
    kind: "delegate",
    occurredAt: AT_16,
    delegationId: SECOND,
    zordId: BUILDER,
    slice: slice("Build the Cockpit shell against the Contract the scout reported"),
    harnessSources: HARDER,
    contract: REFERENCE_CONTRACT,
  },
  // R$ 12,00 + R$ 38,00 is exactly the Cap, and the Cap is reached at equality: accepted, and halted.
  { kind: "accrue-cost", occurredAt: AT_17, delegationId: SECOND, cost: BUILDER_COST },
  { kind: "authorise-cap", occurredAt: AT_18, cap: RAISED_CAP },
  { kind: "submit-handoff", occurredAt: AT_19, handoff: BUILDER_HANDOFF },
  {
    kind: "deliver-mission",
    occurredAt: AT_20,
    delivery: {
      summary: "Cockpit shell shipped, one Pane per Zord",
      artifacts: ["cockpit.tsx", "surfaces.md"],
    },
  },
];

/** The Replay of the whole run, recorded through `submit` — the only thing that appends to one. */
function recorded(commands: readonly MissionCommand[] = THE_RUN): Replay {
  return commands.reduce<Replay>(submit, EMPTY_REPLAY);
}

/** The Steps of the whole run. */
function steps(commands: readonly MissionCommand[] = THE_RUN): readonly Step[] {
  return stepsOf(recorded(commands));
}

/**
 * The Mission built Command by Command, and the log it produced — without going anywhere near
 * `replay.ts`.
 *
 * This is the other side of the equality criterion 7 asks for: `decide`, then `evolve` for each Event it
 * accepted, exactly as a Surface would drive it if the Replay did not exist. A refused Decision
 * contributes nothing, which is the shape under test.
 */
function builtCommandByCommand(commands: readonly MissionCommand[] = THE_RUN): {
  readonly state: Mission;
  readonly log: readonly MissionEvent[];
} {
  const log: MissionEvent[] = [];
  let state: Mission = UNOPENED_MISSION;

  for (const command of commands) {
    const decision = decide(state, command);
    if (decision.kind !== "accepted") {
      continue;
    }
    for (const event of decision.events) {
      log.push(event);
      state = evolve(state, event);
    }
  }
  return { state, log };
}

/* -------------------------------------------------------------------------------------------------
 * The fold
 * ---------------------------------------------------------------------------------------------- */

describe("replay folds the log to the Mission that was built Command by Command", () => {
  it("folds an empty log to a Mission that was never opened", () => {
    expect(replay([])).toEqual(UNOPENED_MISSION);
  });

  it("rebuilds the state of a run containing a Refusal, a Gate decision, a Cap halt and an authorisation", () => {
    const { state, log } = builtCommandByCommand();

    expect(replay(log)).toEqual(state);
  });

  it("rebuilds it from the Replay's own Events, which is the same log", () => {
    const { state, log } = builtCommandByCommand();
    const recording = recorded();

    expect(eventsOf(recording)).toEqual(log);
    expect(stateOf(recording)).toEqual(state);
  });

  it("reaches the Mission that was actually delivered, and not some other one", () => {
    const state = stateOf(recorded());

    expect(state.status).toBe("delivered");
    if (state.status !== "delivered") {
      throw new Error("the run ends delivered");
    }
    expect(state.delivery.summary).toBe("Cockpit shell shipped, one Pane per Zord");
    // Both Delegations answered, the Cap raised, the revision readable, and every cent accounted for.
    expect(state.delegations.map((delegation) => delegation.handoff?.delegationId)).toEqual([
      FIRST,
      SECOND,
    ]);
    expect(state.cap).toBe(RAISED_CAP);
    expect(state.spent).toBe(addMoney(SCOUT_COST, BUILDER_COST));
    expect(revisionsIn(state.gates)).toEqual([
      "Ship the Cockpit shell first, the Pane grid next week",
    ]);
  });

  it("folds the same log to the same Mission every time", () => {
    const log = eventsOf(recorded());

    expect(replay(log)).toEqual(replay(log));
  });

  it("folds every prefix of the log to the state that prefix's Commands had reached", () => {
    const log = eventsOf(recorded());

    // One assertion per prefix: a fold that only agreed at the end would be a fold that recovers, and a
    // Replay is read at every point, not just the last one.
    for (let length = 0; length <= log.length; length += 1) {
      expect(replay(log.slice(0, length)), `prefix of ${length}`).toEqual(
        builtCommandByCommandUntil(log.slice(0, length).length),
      );
    }
  });

  it("does not filter by MissionId, because evolve does not either", () => {
    const log = eventsOf(recorded());
    const foreign: readonly MissionEvent[] = log.map((event) =>
      event.kind === "mission-delivered" ? { ...event, missionId: missionId("mission-2") } : event,
    );

    // A finding of Task 9, recorded rather than fixed: `evolve` never checks that an Event belongs to
    // the Mission it is folded into, so neither can `replay` without the two disagreeing — and the whole
    // value of this function is that they cannot. A log mixing two Missions is a Surface's mistake.
    expect(replay(foreign)).toEqual(log.reduce<Mission>(evolve, UNOPENED_MISSION));
  });
});

/**
 * The state the first `length` Events had produced, built Command by Command.
 *
 * Rebuilt from the Commands rather than sliced off a stored list, so the comparison in the prefix test
 * is against `decide`+`evolve` and not against `replay` wearing a different hat.
 */
function builtCommandByCommandUntil(length: number): Mission {
  let state: Mission = UNOPENED_MISSION;
  let folded = 0;

  for (const command of THE_RUN) {
    const decision = decide(state, command);
    if (decision.kind !== "accepted") {
      continue;
    }
    for (const event of decision.events) {
      if (folded === length) {
        return state;
      }
      state = evolve(state, event);
      folded += 1;
    }
  }
  return state;
}

/* -------------------------------------------------------------------------------------------------
 * Recording
 * ---------------------------------------------------------------------------------------------- */

describe("submit records what the domain answered, and only that", () => {
  it("starts from a Replay with nothing in it", () => {
    expect(EMPTY_REPLAY).toEqual([]);
    expect(stateOf(EMPTY_REPLAY)).toEqual(UNOPENED_MISSION);
    expect(eventsOf(EMPTY_REPLAY)).toEqual([]);
  });

  it("records one entry per Command, refused ones included", () => {
    const recording = recorded();

    expect(recording).toHaveLength(THE_RUN.length);
    expect(recording.map((entry) => entry.command.kind)).toEqual(
      THE_RUN.map((command) => command.kind),
    );
    expect(recording.map((entry) => entry.decision.kind)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      // The Handoff that broke its Contract. It is in the Replay and not in the log.
      "refused",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
    ]);
  });

  it("leaves the Replay it was given untouched", () => {
    const before = recorded(THE_RUN.slice(0, 2));
    const after = submit(before, THE_RUN[2] as MissionCommand);

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual([...before]);
  });

  it("freezes what it hands out, entries and all", () => {
    const recording = recorded(THE_RUN.slice(0, 1));
    const only = recording[0] as ReplayEntry;

    expect(Object.isFrozen(recording)).toBe(true);
    expect(Object.isFrozen(only)).toBe(true);
    expect(Object.isFrozen(EMPTY_REPLAY)).toBe(true);
  });

  it("decides against the state the Replay folds to, so the next Command sees the last one", () => {
    // Delegating twice under one id is refused because the first one was recorded — which only works if
    // `submit` decided the second against the folded state and not against a fresh Mission.
    const twice = recorded([...THE_RUN.slice(0, 2), THE_RUN[1] as MissionCommand]);
    const last = twice[2] as ReplayEntry;

    expect(last.decision.kind).toBe("refused");
    if (last.decision.kind !== "refused") {
      throw new Error("a reused DelegationId is refused");
    }
    expect(last.decision.refusal.reason).toBe("illegal-transition");
  });

  it("settles nothing when it records a Refusal, so the Zord resubmits", () => {
    const upToTheRefusal = recorded(THE_RUN.slice(0, 4));
    const state = stateOf(upToTheRefusal);

    expect(eventsOf(upToTheRefusal)).toHaveLength(3);
    if (!isOpened(state) || state.status !== "running") {
      throw new Error("a refused Handoff leaves the Mission running");
    }
    // Still open: `handoff` absent is what "open" means, and it is why the fifth Command is accepted.
    expect(state.delegations[0]?.handoff).toBeUndefined();
    expect(stateOf(recorded(THE_RUN.slice(0, 5))).status).toBe("running");
  });

  it("records a Command refused before any Mission existed", () => {
    // The reason a refusal cannot be an Event: there is no MissionId for a fact to belong to.
    const recording = recorded([THE_RUN[3] as MissionCommand]);
    const only = recording[0] as ReplayEntry;

    expect(eventsOf(recording)).toEqual([]);
    expect(stateOf(recording)).toEqual(UNOPENED_MISSION);
    expect(only.decision.kind).toBe("refused");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The projection
 * ---------------------------------------------------------------------------------------------- */

describe("the Replay reads as Steps, in order", () => {
  it("numbers every Step from one, in the order it was submitted", () => {
    const projected = steps();

    expect(projected.map((step) => step.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(projected.map((step) => step.command.occurredAt)).toEqual(
      THE_RUN.map((command) => command.occurredAt),
    );
  });

  it("keeps the Command and the Decision whole, and adds nothing else", () => {
    const recording = recorded();
    const projected = stepsOf(recording);

    projected.forEach((step, index) => {
      const entry = recording[index] as ReplayEntry;
      expect(step.command).toBe(entry.command);
      expect(step.decision).toBe(entry.decision);
    });
    expect(Object.keys(projected[0] as Step).sort()).toEqual([
      "command",
      "decision",
      "ordinal",
      "summary",
    ]);
  });

  it("freezes the reading it hands out", () => {
    const projected = steps();

    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected[0])).toBe(true);
  });

  it("contains every delegation, with the Harness each Zord actually ran", () => {
    const delegations = eventsIn(steps(), "delegated");

    expect(delegations.map((event) => event.zordId)).toEqual([SCOUT, BUILDER]);
    // Resolved once, in `decide`, and recorded — so the Replay answers "what did this Zord run with"
    // without re-resolving anything against a Catalog that has moved on.
    expect(delegations.map((event) => event.harness)).toEqual([
      { cli: "claude", model: "sonnet-4-5", effort: "medium", skills: [] },
      { cli: "claude", model: "opus-4-1", effort: "high", skills: [] },
    ]);
  });

  it("contains every refusal, with what it broke", () => {
    const refused = refusedIn(steps());

    expect(refused).toHaveLength(1);
    const only = refused[0] as (typeof refused)[number];
    expect(only.ordinal).toBe(4);
    expect(only.command.kind).toBe("submit-handoff");
    expect(only.decision.refusal.reason).toBe("contract-violation");
    // Both of them: the Handoff is wrong in two ways at once, and a Refusal carries a list precisely so
    // the audit surface does not report the first and send the Zord round the loop twice.
    expect(only.decision.refusal.violations).toEqual([
      `Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required, so declaring ` +
        `it as a Gap does not excuse it: "ran out of time"`,
      `Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was not ` +
        `declared as a Gap`,
    ]);
  });

  it("contains every gate decision", () => {
    const decided = eventsIn(steps(), "gate-decided");

    expect(decided).toHaveLength(1);
    expect(decided[0]?.gateId).toBe(GATE);
    expect(decided[0]?.decision).toEqual({
      kind: "revision-requested",
      reason: "Ship the Cockpit shell first, the Pane grid next week",
    });
  });

  it("contains every cost, per Pane, adding up to what the Meter says", () => {
    const state = stateOf(recorded());
    const costs = eventsIn(steps(), "cost-accrued");

    expect(costs.map((event) => [event.delegationId, event.cost])).toEqual([
      [FIRST, SCOUT_COST],
      [SECOND, BUILDER_COST],
    ]);
    if (!isOpened(state)) {
      throw new Error("the run opens the Mission");
    }
    // The Replay reports what each Step cost; the **totals** are the Meter's answer, from the state.
    // Two readings of one truth is the trap this repo records, and the Meter got there first.
    expect(costs.reduce<Money>((total, event) => addMoney(total, event.cost), ZERO_MONEY)).toBe(
      meterOf(state).spent,
    );
  });

  it("keeps the two facts of one Decision in the order they happened", () => {
    const projected = steps();
    const halting = projected[8] as Step;

    expect(halting.decision.kind).toBe("accepted");
    if (halting.decision.kind !== "accepted") {
      throw new Error("the accrual that reaches the Cap is accepted");
    }
    expect(halting.decision.events.map((event) => event.kind)).toEqual([
      "cost-accrued",
      "mission-halted",
    ]);
  });

  it("answers with nothing when a kind never happened", () => {
    expect(eventsIn(steps(), "mission-killed")).toEqual([]);
  });
});

describe("a Step says in one line what happened", () => {
  it("names the Mission, its Mode and its Cap when it opens", () => {
    expect((steps()[0] as Step).summary).toBe(
      `opening Mission "mission-1" was accepted, in combination Mode with a Cap of R$ 50,00`,
    );
  });

  it("names the Zord, the Delegation and the resolved Harness", () => {
    expect((steps()[1] as Step).summary).toBe(
      `delegating a Slice to Zord "zord-scout" as Delegation "delegation-1" was accepted, ` +
        `running claude/sonnet-4-5 at medium effort`,
    );
    expect((steps()[7] as Step).summary).toBe(
      `delegating a Slice to Zord "zord-builder" as Delegation "delegation-2" was accepted, ` +
        `running claude/opus-4-1 at high effort`,
    );
  });

  it("says what was refused and why, with every violation", () => {
    expect((steps()[3] as Step).summary).toBe(
      `answering Delegation "delegation-1" with a Handoff was refused (contract-violation): ` +
        `Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required, so ` +
        `declaring it as a Gap does not excuse it: "ran out of time"; ` +
        `Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was ` +
        `not declared as a Gap`,
    );
  });

  it("says what a Handoff covered and what it declared", () => {
    expect((steps()[4] as Step).summary).toBe(
      `answering Delegation "delegation-1" with a Handoff was accepted, ` +
        `covering 1 Clause and declaring 1 Gap`,
    );
    expect((steps()[10] as Step).summary).toBe(
      `answering Delegation "delegation-2" with a Handoff was accepted, ` +
        `covering 2 Clauses and declaring no Gap`,
    );
  });

  it("says where the Mission stopped, and what stopped it", () => {
    expect((steps()[5] as Step).summary).toBe(
      `raising Gate "gate-1" was accepted, asking "The Contract grew a Clause. Does the Cockpit ` +
        `still ship this week?", and the Mission stopped at Gate "gate-1"`,
    );
    expect((steps()[8] as Step).summary).toBe(
      `accruing R$ 38,00 against Delegation "delegation-2" was accepted, ` +
        `and the Mission stopped because it reached its Cap`,
    );
  });

  it("says how the human answered, and what it cost to carry on", () => {
    expect((steps()[6] as Step).summary).toBe(
      `deciding Gate "gate-1" was accepted, and a human asked for a revision: ` +
        `"Ship the Cockpit shell first, the Pane grid next week"`,
    );
    expect((steps()[9] as Step).summary).toBe(
      `authorising a Cap of R$ 80,00 was accepted, and the Mission may now spend up to R$ 80,00`,
    );
  });

  it("says what the Mission delivered, and what proves it", () => {
    expect((steps()[11] as Step).summary).toBe(
      `delivering this Mission was accepted, with 2 artifacts as proof: ` +
        `"Cockpit shell shipped, one Pane per Zord"`,
    );
  });

  /**
   * Found in review. `decide` deliberately refuses a `submit-handoff` whose Handoff was lost to a cast or
   * a truncated payload rather than throwing on it — and `submit` records that Refusal, so reading the
   * Replay back is the last place allowed to throw. It used to: `asked` dereferenced
   * `command.handoff.delegationId`, so the audit reading of a Refusal `decide` had handled correctly threw
   * `TypeError`. A Replay that cannot be read cannot be shown to a human, which is all it is for.
   */
  it("reads back a refused Handoff that carried none, instead of throwing", () => {
    const handoffless = JSON.parse(
      '{"kind":"submit-handoff","occurredAt":"2026-08-06T10:00:00.000Z"}',
    ) as MissionCommand;
    const recording = submit(recorded(THE_RUN.slice(0, 2)), handoffless);

    expect(() => stepsOf(recording)).not.toThrow();

    const refused = refusedIn(stepsOf(recording));

    expect(refused).toHaveLength(1);
    expect((refused[0] as Step).summary).toBe(
      `answering a Delegation this Command does not name with a Handoff was refused ` +
        `(illegal-transition): a Handoff is what a submit-handoff Command submits, and this one ` +
        `carries none`,
    );
  });

  it("says why a Mission was killed, without saying it twice", () => {
    const killed = steps([
      ...THE_RUN.slice(0, 3),
      { kind: "kill-mission", occurredAt: AT_13, reason: "the Briefing was wrong" },
    ]);

    expect((killed[3] as Step).summary).toBe(
      `killing this Mission because "the Briefing was wrong" was accepted`,
    );
  });
});

describe("the Replay reads no clock and rolls no dice", () => {
  it("records, folds and projects with Date and Math.random poisoned", () => {
    const realNow = Date.now;
    const realParse = Date.parse;
    const realRandom = Math.random;
    Date.now = (): number => {
      throw new Error("the Replay must not read a clock");
    };
    Date.parse = (): number => {
      throw new Error("the Replay must not parse time");
    };
    Math.random = (): number => {
      throw new Error("the Replay must not randomise");
    };

    try {
      const recording = recorded();
      expect(stepsOf(recording)).toHaveLength(THE_RUN.length);
      expect(stateOf(recording).status).toBe("delivered");
    } finally {
      Date.now = realNow;
      Date.parse = realParse;
      Math.random = realRandom;
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The compile-time half
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every probe here was falsified by breaking the guarantee **at its source** — the `readonly`, the
 * absent field, the constrained parameter — and confirming `tsc --noEmit` reports `TS2578: Unused
 * '@ts-expect-error' directive`.
 */
describe("what the type system refuses", () => {
  it("refuses appending to a Replay", () => {
    const recording = recorded(THE_RUN.slice(0, 1));

    const rejected = (): void =>
      // @ts-expect-error a Replay grows through `submit`, which is what records the Decision as well
      void recording.push({ command: THE_RUN[0] as MissionCommand, decision: { kind: "accepted", events: [] } });

    // Unlike the lists on a Mission, a Replay **is** frozen: it is a reading handed out, like `meterOf`.
    expect(rejected).toThrow(TypeError);
    expect(recording).toHaveLength(1);
  });

  it("refuses rewriting what a Command was decided as", () => {
    const entry = recorded(THE_RUN.slice(0, 1))[0] as ReplayEntry;

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject it.
    // @ts-expect-error what the domain answered is a fact: it is recorded once and never rewritten
    const rejected = (): void => void (entry.decision = entry.decision);

    expect(rejected).toThrow(TypeError);
  });

  it("refuses rewriting the position of a Step", () => {
    const step = steps()[0] as Step;

    // @ts-expect-error where a Step sits is derived from the Replay, never assigned onto it
    const rejected = (): void => void (step.ordinal = step.ordinal);

    expect(rejected).toThrow(TypeError);
  });

  it("refuses a Step that carries its own Instant", () => {
    const rejected = (): Step => {
      const step: Step = {
        command: THE_RUN[0] as MissionCommand,
        decision: { kind: "accepted", events: [] },
        ordinal: 1,
        summary: "opening was accepted",
        // @ts-expect-error the Instant is on the Command a Step carries; a second copy could disagree
        occurredAt: OPENED_AT,
      };
      return step;
    };

    expect(rejected().ordinal).toBe(1);
  });

  it("refuses reading facts of a kind no Event has", () => {
    const rejected = (): number =>
      // @ts-expect-error the kinds are the Event union's own, so a typo is not a reading that returns nothing
      eventsIn(steps(), "handoff-refused").length;

    expect(rejected()).toBe(0);
  });

  it("narrows what it reads to the one kind asked for", () => {
    // A positive compile-time proof rather than a probe, and deliberately so: **no `@ts-expect-error`
    // can tell `readonly Delegated[]` from `readonly MissionEvent[]`**, because reading a field off
    // either one fails — off the narrow type because the field is absent, off the union because it is
    // absent from *some* member. Tried as a probe on `delegations[0]?.gateId`, widening the return type
    // left the directive used and reported no `TS2578`, which is the trap `CLAUDE.md` records: a
    // falsification that reports nothing has proven you broke the wrong thing.
    //
    // What distinguishes them is assignability, so this annotation is the guarantee. Falsified by
    // widening the return type of `eventsIn` to `readonly MissionEvent[]`: `tsc` reports 18 errors
    // across this file and `mission.e2e.test.ts`, starting with `TS2322: Type 'readonly
    // MissionEvent[]' is not assignable to type 'readonly Delegated[]'` on the line below — a build
    // failure rather than a `TS2578`, which is the right signal for a proof that carries structural
    // load instead of merely observing one.
    const made: readonly Delegated[] = eventsIn(steps(), "delegated");

    expect(made[0]?.harness.cli).toBe("claude");
    expect(made.map((event) => event.zordId)).toEqual([SCOUT, BUILDER]);
  });

  it("refuses reading a Refusal off a Step that was not refused", () => {
    const step = steps()[0] as Step;

    const rejected = (): unknown =>
      // @ts-expect-error an accepted Decision carries Events, so `refusal` has to be narrowed for
      step.decision.refusal;

    expect(rejected()).toBeUndefined();
    // `refusedIn` is the narrowing, and it is why reading a Refusal needs no cast.
    expect(refusedIn(steps())[0]?.decision.refusal.reason).toBe("contract-violation");
  });
});

/* -------------------------------------------------------------------------------------------------
 * A fact nothing validated
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Event side of the non-throwing contract, added in review after the Task 8 driver declared it.
 *
 * `runtime/mission-store.ts` loads a Replay **without judging it** — ADR 0009 — so a hand-edited line, a
 * file recovered from a torn tail, or a deserialiser upstream can hand this reading an Event whose shape
 * no rule ever checked. `asked` was hardened for exactly this on the Command side and `added` was not, so
 * `stepsOf` still threw on six nested dereferences. The rule `CLAUDE.md` records is one rule, and it
 * covers both halves of a Step: **a reading is part of the non-throwing contract**.
 *
 * Each case asserts the reading does not throw *and* what it says instead, because "does not throw" alone
 * would pass just as happily for a summary that invented a value.
 */
describe("a Step read off a fact nothing validated", () => {
  /** One accepted Step carrying whatever the file happened to hold. */
  function stepFor(damaged: string): Step {
    const entry = {
      command: JSON.parse(
        '{"kind":"deliver-mission","occurredAt":"2026-08-06T10:00:00.000Z"}',
      ) as MissionCommand,
      decision: { kind: "accepted" as const, events: [JSON.parse(damaged) as MissionEvent] },
    };
    const read = stepsOf([entry]);
    return read[0] as Step;
  }

  it("says a Harness is not described rather than dereferencing one that is not there", () => {
    expect(() => stepFor('{"kind":"delegated"}')).not.toThrow();
    expect(stepFor('{"kind":"delegated"}').summary).toContain(
      "running a Harness this fact does not describe",
    );
    // Present but not an object, and present but incomplete, answer the same way — the reading makes no
    // distinction the record cannot support.
    expect(stepFor('{"kind":"delegated","harness":null}').summary).toContain(
      "running a Harness this fact does not describe",
    );
    expect(stepFor('{"kind":"delegated","harness":{"cli":"claude"}}').summary).toContain(
      "running a Harness this fact does not describe",
    );
  });

  it("says a Contract is not described rather than counting a Handoff that is not there", () => {
    expect(stepFor('{"kind":"handoff-accepted"}').summary).toContain(
      "covering a Contract this fact does not describe",
    );
    // `satisfies` present but not a list is the same absence: there is nothing to count.
    expect(
      stepFor('{"kind":"handoff-accepted","handoff":{"satisfies":"two","gaps":[]}}').summary,
    ).toContain("covering a Contract this fact does not describe");
  });

  it("does not report a Halt whose reason was lost as a Cap", () => {
    // The branch this replaces was an `else`, so a damaged Halt read as "it reached its Cap" — a
    // different fact, and one that sends a human to the wrong remedy. `CLAUDE.md` records that rule
    // about Refusal reasons; it is the same rule about a reading.
    expect(stepFor('{"kind":"mission-halted"}').summary).toContain(
      "and the Mission stopped for a reason this fact does not describe",
    );
    expect(stepFor('{"kind":"mission-halted","halt":{"reason":"gate-open"}}').summary).toContain(
      "and the Mission stopped at a Gate this fact does not name",
    );
    // And the two well-formed shapes still read exactly as they did.
    expect(
      stepFor('{"kind":"mission-halted","halt":{"reason":"cap-reached"}}').summary,
    ).toContain("and the Mission stopped because it reached its Cap");
    expect(
      stepFor('{"kind":"mission-halted","halt":{"reason":"gate-open","gateId":"g-1"}}').summary,
    ).toContain('and the Mission stopped at Gate "g-1"');
  });

  it("does not report an unreadable Gate decision as an approval", () => {
    expect(stepFor('{"kind":"gate-decided"}').summary).toContain(
      "and a human answered it in a way this fact does not describe",
    );
    // A revision with no reason is not a revision anybody can read, and it is not an approval either.
    expect(
      stepFor('{"kind":"gate-decided","decision":{"kind":"revision-requested"}}').summary,
    ).toContain("and a human answered it in a way this fact does not describe");
  });

  it("says a Delivery is not described rather than counting artifacts that are not there", () => {
    expect(stepFor('{"kind":"mission-delivered"}').summary).toContain(
      "with a Delivery this fact does not describe",
    );
    expect(
      stepFor('{"kind":"mission-delivered","delivery":{"artifacts":[],"summary":"done"}}').summary,
    ).toContain('with no artifact as proof: "done"');
  });

  it("reads a whole Replay of damaged facts without throwing once", () => {
    const damaged: readonly string[] = [
      '{"kind":"delegated"}',
      '{"kind":"handoff-accepted"}',
      '{"kind":"gate-decided"}',
      '{"kind":"mission-halted"}',
      '{"kind":"mission-delivered"}',
    ];
    for (const one of damaged) {
      expect({ one, threw: throwsFor(one) }).toEqual({ one, threw: false });
    }
  });

  /** Whether reading a Step off this fact throws. Kept out of the loop so the failure names the fact. */
  function throwsFor(damaged: string): boolean {
    try {
      stepFor(damaged);
      return false;
    } catch {
      return true;
    }
  }
});
