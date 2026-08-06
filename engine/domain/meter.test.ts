import { describe, expect, it } from "vitest";

import { core, orchestrationCapability } from "@engine/domain/capability";
import { clause, contract, type Contract } from "@engine/domain/contract";
import { gap, handoff, type Handoff } from "@engine/domain/handoff";
import { harness, type Harness, type HarnessSources } from "@engine/domain/harness";
import { clauseId, delegationId, gateId, missionId, zordId } from "@engine/domain/ids";
import {
  ZERO_MONEY,
  formatMoney,
  moneyFromCents,
  moneyFromDecimal,
  type Money,
} from "@engine/domain/money";
import { accrued, amountOf, hasReachedCap, meterOf, type Meter } from "@engine/domain/meter";
import {
  instant,
  type CapAuthorised,
  type CostAccrued,
  type Instant,
  type MissionEvent,
} from "@engine/domain/events";
import type {
  AccrueCost,
  AuthoriseCap,
  Delegate,
  DeliverMission,
  MissionCommand,
  OpenMissionFields,
  SubmitHandoff,
} from "@engine/domain/commands";
import {
  UNOPENED_MISSION,
  briefing,
  decide,
  evolve,
  isOpened,
  openMission,
  slice,
  type Decision,
  type Delegation,
  type HaltedMission,
  type Mission,
  type OpenedMission,
  type Refusal,
  type RunningMission,
} from "@engine/domain/mission";

/**
 * Criterion 5: **a Mission that reaches its Cap halts and cannot continue without authorisation.**
 *
 * Everything here is decided by two amounts and one comparison. The Cap of every Mission in this file is
 * R$ 50,00, so the boundary case the whole task turns on — a spend of exactly R$ 50,00 — is one accrual
 * away in either direction.
 */

const OPENED_AT: Instant = instant("2026-08-06T09:00:00.000Z");
const LATER: Instant = instant("2026-08-06T10:00:00.000Z");
const LATER_STILL: Instant = instant("2026-08-06T11:00:00.000Z");

const MISSION = missionId("mission-1");
const DELEGATION = delegationId("delegation-1");
const OTHER_DELEGATION = delegationId("delegation-2");
const SCOUT = zordId("zord-scout");
const BUILDER = zordId("zord-builder");
const GATE = gateId("gate-1");

const SLICE = slice("Map the Surfaces the Cockpit needs and report the Contract of each");
const OTHER_SLICE = slice("Build the Pane grid against that Contract");

const CAP = moneyFromDecimal("50.00");

/** One cent short of the Cap, the Cap exactly, and one cent past it. */
const NEARLY = moneyFromDecimal("49.99");
const EXACTLY = CAP;
const PAST = moneyFromDecimal("50.01");

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

const RENDERS = clauseId("clause-renders");
const NOTES = clauseId("clause-notes");

const REFERENCE_CONTRACT: Contract = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
  clause({ id: NOTES, description: "The Surfaces it touched are listed", required: false }),
]);

const HONOURING_HANDOFF: Handoff = handoff({
  delegationId: DELEGATION,
  satisfies: [RENDERS],
  gaps: [gap(NOTES, "the Surfaces are still moving")],
  artifacts: ["cockpit.tsx"],
});

function opening(overrides: Partial<OpenMissionFields> = {}): OpenMissionFields {
  return {
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: CAP,
    core: LEADING_CORE,
    occurredAt: OPENED_AT,
    ...overrides,
  };
}

function running(overrides: Partial<OpenMissionFields> = {}): RunningMission {
  return openMission(opening(overrides));
}

function delegating(overrides: Partial<Delegate> = {}): Delegate {
  return {
    kind: "delegate",
    occurredAt: LATER,
    delegationId: DELEGATION,
    zordId: SCOUT,
    slice: SLICE,
    harnessSources: SOURCES,
    contract: REFERENCE_CONTRACT,
    ...overrides,
  };
}

function accruing(cost: Money, id = DELEGATION, occurredAt = LATER): AccrueCost {
  return { kind: "accrue-cost", occurredAt, delegationId: id, cost };
}

function authorising(cap: Money, occurredAt = LATER_STILL): AuthoriseCap {
  return { kind: "authorise-cap", occurredAt, cap };
}

const submitCommand: SubmitHandoff = {
  kind: "submit-handoff",
  occurredAt: LATER,
  handoff: HONOURING_HANDOFF,
};

const deliverCommand: DeliverMission = {
  kind: "deliver-mission",
  occurredAt: LATER,
  delivery: { summary: "Cockpit shipped", artifacts: ["cockpit.tsx"] },
};

/** The Refusal of a Decision, failing loudly when the Decision was an acceptance. */
function refusalOf(decision: Decision): Refusal {
  if (decision.kind !== "refused") {
    throw new Error(`expected a Refusal, got ${decision.events.length} accepted Event(s)`);
  }
  return decision.refusal;
}

/** The Events of a Decision, failing loudly when the Decision was a Refusal. */
function eventsOf(decision: Decision): readonly MissionEvent[] {
  if (decision.kind !== "accepted") {
    throw new Error(`expected an acceptance, refused: ${decision.refusal.violations.join("; ")}`);
  }
  return decision.events;
}

/** Decides a Command and folds whatever it accepted, the way a caller of the engine would. */
function run(state: Mission, command: MissionCommand): Mission {
  return eventsOf(decide(state, command)).reduce<Mission>(evolve, state);
}

/** A running Mission with one Pane: one Delegation, open, nothing spent. */
function withPane(): Mission {
  return run(running(), delegating());
}

/** A running Mission with two Panes, so per-Pane accounting has something to keep apart. */
function withTwoPanes(): Mission {
  return run(withPane(), delegating({ delegationId: OTHER_DELEGATION, zordId: BUILDER, slice: OTHER_SLICE }));
}

function opened(state: Mission): OpenedMission {
  if (!isOpened(state)) {
    throw new Error("expected an opened Mission");
  }
  return state;
}

function halted(state: Mission): HaltedMission {
  if (state.status !== "halted") {
    throw new Error(`expected a halted Mission, got ${state.status}`);
  }
  return state;
}

function paneOf(state: Mission, id = DELEGATION): Delegation {
  const found = opened(state).delegations.find((delegation) => delegation.id === id);
  if (found === undefined) {
    throw new Error(`expected a Delegation "${id}"`);
  }
  return found;
}

/** A Mission held through the union, so a probe about narrowing is not narrowed away by the compiler. */
function whicheverState(): Mission {
  return withPane();
}

describe("the Cap boundary", () => {
  /**
   * The decision this task turns on: **the Cap is reached at equality, and a Mission that reaches it
   * halts.**
   *
   * The glossary says a Cap is "the spending limit of a Mission. Once *reached*, the Mission stops" —
   * reached, not exceeded. R$ 50,00 spent of a R$ 50,00 Cap leaves nothing to spend, so the limit has
   * been met and the next cent is already over it. Read as strictly-greater, the Cap would have to be
   * breached before the product kept its promise: every Mission would overspend by at least one cent,
   * and the number a human typed would be one cent below the real limit.
   */
  it("reads a spend equal to the Cap as reached", () => {
    expect(hasReachedCap(NEARLY, CAP)).toBe(false);
    expect(hasReachedCap(EXACTLY, CAP)).toBe(true);
    expect(hasReachedCap(PAST, CAP)).toBe(true);
  });

  it("reads a Cap of zero as reached by a Mission that has spent nothing", () => {
    // Degenerate but coherent: a Mission with nothing to spend has already reached its limit, and the
    // refusals below say so rather than letting it commission work it cannot pay for.
    expect(hasReachedCap(ZERO_MONEY, ZERO_MONEY)).toBe(true);
  });

  it("halts on the accrual that brings the spend exactly to the Cap", () => {
    const state = run(withPane(), accruing(EXACTLY));

    expect(halted(state).halt).toEqual({ reason: "cap-reached" });
    expect(halted(state).spent).toBe(5000);
  });

  it("keeps running one cent short of the Cap", () => {
    const state = run(withPane(), accruing(NEARLY));

    expect(state.status).toBe("running");
    expect(opened(state).spent).toBe(4999);
    expect(meterOf(opened(state)).reached).toBe(false);
  });

  it("halts on an accrual that goes past the Cap, and records the whole amount", () => {
    const state = run(withPane(), accruing(PAST));

    expect(halted(state).halt.reason).toBe("cap-reached");
    // Not clamped to the Cap: the runtime spent R$ 50,01 and the Meter says R$ 50,01.
    expect(halted(state).spent).toBe(5001);
    expect(formatMoney(halted(state).spent)).toBe("R$ 50,01");
  });
});

/**
 * Cost accrues **per Pane and per Mission**.
 *
 * There is no Pane type in this domain and this task did not invent one: a Pane is an isolated terminal
 * with one Zord inside, and the thing the domain can name is the Delegation that Zord is running. So the
 * per-Pane half of the Meter lives on the Delegation, which is the finer of the two grains available — a
 * per-Zord reading is the sum of its Delegations, while the reverse cannot be recovered once summed.
 */
describe("accrual per Pane and per Mission", () => {
  it("charges the accrual to the Delegation it names and to the Mission's total", () => {
    const state = run(withPane(), accruing(moneyFromDecimal("12.34")));

    expect(paneOf(state).spent).toBe(1234);
    expect(opened(state).spent).toBe(1234);
  });

  it("keeps each Pane's cost apart, and the Mission's total as their sum", () => {
    const first = run(withTwoPanes(), accruing(moneyFromDecimal("10.00")));
    const both = run(first, accruing(moneyFromDecimal("5.50"), OTHER_DELEGATION));
    const again = run(both, accruing(moneyFromDecimal("0.50")));

    expect(paneOf(again).spent).toBe(1050);
    expect(paneOf(again, OTHER_DELEGATION).spent).toBe(550);
    expect(opened(again).spent).toBe(1600);
  });

  it("reports the Meter as one reading: the Cap, the total, and one entry per Pane", () => {
    const state = run(run(withTwoPanes(), accruing(moneyFromDecimal("10.00"))), accruing(moneyFromDecimal("5.00"), OTHER_DELEGATION));

    const meter: Meter = meterOf(opened(state));

    expect(meter).toEqual({
      cap: 5000,
      spent: 1500,
      perDelegation: [
        { delegationId: DELEGATION, spent: 1000 },
        { delegationId: OTHER_DELEGATION, spent: 500 },
      ],
      reached: false,
    });
  });

  /**
   * The invariant behind carrying the total twice: the Mission's `spent` is the sum of its Panes. It is
   * folded rather than summed on demand because the Cap comparison must never throw — `addMoney` does,
   * past the exactly-representable range — and both copies are written by one rule from one fact.
   */
  it("keeps the Mission's total equal to the sum of its Panes", () => {
    const state = run(
      run(run(withTwoPanes(), accruing(moneyFromDecimal("3.33"))), accruing(moneyFromDecimal("7.77"), OTHER_DELEGATION)),
      accruing(moneyFromDecimal("1.11")),
    );

    const meter = meterOf(opened(state));
    const summed = meter.perDelegation.reduce((total, pane) => total + pane.spent, 0);

    expect(summed).toBe(meter.spent);
    expect(meter.spent).toBe(1221);
  });

  it("counts a Pane that spent nothing as an entry of zero, not as an absence", () => {
    const meter = meterOf(opened(withTwoPanes()));

    expect(meter.perDelegation).toEqual([
      { delegationId: DELEGATION, spent: ZERO_MONEY },
      { delegationId: OTHER_DELEGATION, spent: ZERO_MONEY },
    ]);
    expect(meter.spent).toBe(0);
  });

  it("hands out a Meter nobody can rewrite", () => {
    const meter = meterOf(opened(withPane()));

    expect(Object.isFrozen(meter)).toBe(true);
    expect(Object.isFrozen(meter.perDelegation)).toBe(true);
    expect(Object.isFrozen(meter.perDelegation[0])).toBe(true);
  });

  it("opens every Mission and every Pane at zero", () => {
    expect(running().spent).toBe(ZERO_MONEY);
    expect(paneOf(withPane()).spent).toBe(ZERO_MONEY);
  });
});

/**
 * Judgement call: **an accrual that would cross the Cap is recorded, and then the Mission halts.** It is
 * not refused.
 *
 * The money was already spent by the runtime before the domain heard about it. Refusing the report would
 * not un-spend it — it would only make the Meter understate what the Mission cost, and the Cap is
 * compared against exactly that total, so an understated total means a Mission that stops late or never
 * stops at all. `Decision`'s accepted member carries a *list* of Events for this: one Command, two facts,
 * in the order they happened.
 */
describe("reaching the Cap halts the Mission", () => {
  it("accepts the accrual and halts in one Decision, the accrual first", () => {
    const events = eventsOf(decide(withPane(), accruing(EXACTLY)));

    expect(events).toEqual([
      {
        kind: "cost-accrued",
        missionId: MISSION,
        occurredAt: LATER,
        delegationId: DELEGATION,
        cost: 5000,
      },
      {
        kind: "mission-halted",
        missionId: MISSION,
        occurredAt: LATER,
        halt: { reason: "cap-reached" },
      },
    ]);
  });

  /** A Cap halt and a Gate halt are different halts, and only the Gate variant carries a GateId. */
  it("halts without a Gate, because no human was asked about the work", () => {
    const state = halted(run(withPane(), accruing(EXACTLY)));

    expect(state.halt.reason).toBe("cap-reached");
    expect(Object.keys(state.halt)).toEqual(["reason"]);
    expect(state.halt.gateId).toBeUndefined();
  });

  it("keeps everything the Mission had when it stopped", () => {
    const state = halted(run(withPane(), accruing(EXACTLY)));

    expect(state.id).toBe(MISSION);
    expect(state.cap).toBe(CAP);
    expect(state.delegations).toHaveLength(1);
    expect(paneOf(state).spent).toBe(5000);
    expect(meterOf(state).reached).toBe(true);
  });

  it("does not halt twice: an accrual on an already halted Mission produces one fact", () => {
    const stopped = run(withPane(), accruing(EXACTLY));

    const events = eventsOf(decide(stopped, accruing(moneyFromDecimal("1.00"), DELEGATION, LATER_STILL)));

    // A second `MissionHalted` would be a fact the fold ignores — the first halt stands — and a fact
    // that folds to nothing is the same lie as an always-zero field.
    expect(events.map((event) => event.kind)).toEqual(["cost-accrued"]);
    expect(halted(run(stopped, accruing(moneyFromDecimal("1.00")))).spent).toBe(5100);
  });
});

/**
 * Criterion 5's second half: **it cannot continue without authorisation.**
 *
 * Every Command that commissions or concludes work is refused, and refused with `cap-reached` — the
 * reason a human can act on. `cap-reached` has been in `RefusalReason` since the techspec with no user;
 * this is its first one, the way `missing-capability` waited for Task 4.
 */
describe("a Mission stopped at its Cap refuses to continue", () => {
  function stopped(): Mission {
    return run(withTwoPanes(), accruing(EXACTLY));
  }

  it("refuses a Delegation, and names what would lift the refusal", () => {
    const refusal = refusalOf(decide(stopped(), delegating({ delegationId: delegationId("delegation-3") })));

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations).toEqual([
      "a Mission that is halted because it reached its Cap admits no Delegation, " +
        'so Zord "zord-scout" cannot be given one until its Cap is authorised',
    ]);
  });

  /**
   * The Handoff is refused, not destroyed. A Refusal settles nothing (Task 6), so the Delegation stays
   * open and the Zord resubmits once the Cap is authorised — which is why refusing work that was already
   * paid for loses nothing.
   */
  it("refuses a Handoff, and leaves the Delegation open to be resubmitted", () => {
    const refusal = refusalOf(decide(stopped(), submitCommand));

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations).toEqual([
      "a Mission that is halted because it reached its Cap admits no Handoff " +
        "until its Cap is authorised",
    ]);
    expect(paneOf(stopped()).handoff).toBeUndefined();
  });

  /**
   * Consolidating is not free: a Core reading every Handoff and writing the Delivery spends tokens. A
   * Mission that could deliver itself while stopped would spend money nobody authorised, and its one
   * terminal transition would happen without the human the halt exists to ask.
   */
  it("refuses to be delivered", () => {
    const refusal = refusalOf(decide(stopped(), deliverCommand));

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations).toEqual([
      "a Mission that is halted because it reached its Cap cannot be delivered " +
        "until its Cap is authorised",
    ]);
  });

  /**
   * Two Commands keep a more specific refusal, and that is deliberate: `cap-reached` is the right reason
   * only when the Cap is what stands in the way.
   *
   * - `open-mission` is refused because the Mission is already open, which is true whatever it spent.
   * - `decide-gate` is refused because **no Gate is open** — a Cap halt carries no GateId, so there is
   *   genuinely no Gate to decide, and telling a human "the Cap" would send them to the wrong remedy.
   */
  it("keeps the truthful reason for Commands the Cap is not what blocks", () => {
    const alreadyOpen = refusalOf(decide(stopped(), { kind: "open-mission", ...opening() }));
    expect(alreadyOpen.reason).toBe("illegal-transition");
    expect(alreadyOpen.violations.join(" ")).toMatch(/a Mission is opened once/);

    // Task 8 gave `decide-gate` a decision to carry: approving is as valid a decision as this Command can
    // hold, which is what makes the Refusal below provably about there being no Gate to decide.
    const noGate = refusalOf(
      decide(stopped(), {
        kind: "decide-gate",
        occurredAt: LATER,
        gateId: GATE,
        decision: { kind: "approved" },
      }),
    );
    expect(noGate.reason).toBe("illegal-transition");
    expect(noGate.violations.join(" ")).toMatch(/no Gate is open/);
  });

  /**
   * And the one Command it still accepts. An accrual is a report of money already gone, not an intent to
   * spend it: a Zord that was mid-run when the Cap was reached — which is how a Cap gets reached at all —
   * keeps reporting, and the Meter keeps telling the truth about what the Mission cost.
   */
  it("still accepts an accrual, because the money was already spent", () => {
    const later = run(stopped(), accruing(moneyFromDecimal("2.00"), OTHER_DELEGATION, LATER_STILL));

    expect(halted(later).spent).toBe(5200);
    expect(paneOf(later, OTHER_DELEGATION).spent).toBe(200);
    expect(halted(later).halt.reason).toBe("cap-reached");
  });

  it("refuses every commissioning Command while halted, whatever the Command asks for", () => {
    const commands: readonly MissionCommand[] = [
      delegating({ delegationId: delegationId("delegation-9") }),
      submitCommand,
      deliverCommand,
    ];

    for (const command of commands) {
      const refusal = refusalOf(decide(stopped(), command));

      expect(refusal.reason, command.kind).toBe("cap-reached");
      expect(refusal.violations.join(" "), command.kind).toMatch(/until its Cap is authorised/);
    }
  });
});

/**
 * The exit Task 3 deliberately left off `halted`.
 *
 * Judgement call: **authorising raises the Cap; it cannot merely permit continuing.** A Mission resumed at
 * the same Cap would resume with its limit still reached, so the very next commissioning Command would be
 * refused `cap-reached` again and the authorisation would have changed nothing — "the Mission stops and
 * asks for authorisation" would be a loop rather than a question. What the human answers is not "carry
 * on?" but "how much more?", and the answer is a number.
 */
describe("the authorisation that resumes a Mission", () => {
  function stopped(): Mission {
    return run(withPane(), accruing(EXACTLY));
  }

  it("produces one fact carrying the new Cap", () => {
    const events = eventsOf(decide(stopped(), authorising(moneyFromDecimal("80.00"))));

    expect(events).toEqual([
      { kind: "cap-authorised", missionId: MISSION, occurredAt: LATER_STILL, cap: 8000 },
    ]);
  });

  it("returns the Mission to running, at the new Cap, with what it spent untouched", () => {
    const resumed = run(stopped(), authorising(moneyFromDecimal("80.00")));

    expect(resumed.status).toBe("running");
    expect(opened(resumed).cap).toBe(8000);
    // Nothing is given back: the money is gone, and this model has no subtraction to reach for.
    expect(opened(resumed).spent).toBe(5000);
    expect(meterOf(opened(resumed)).reached).toBe(false);
  });

  it("lets the Mission commission work again", () => {
    const resumed = run(stopped(), authorising(moneyFromDecimal("80.00")));

    const events = eventsOf(decide(resumed, delegating({ delegationId: OTHER_DELEGATION, slice: OTHER_SLICE })));

    expect(events.map((event) => event.kind)).toEqual(["delegated"]);
    expect(eventsOf(decide(resumed, submitCommand)).map((event) => event.kind)).toEqual([
      "handoff-accepted",
    ]);
  });

  it("halts again when the new Cap is reached, so the loop is real and not a bypass", () => {
    const resumed = run(stopped(), authorising(moneyFromDecimal("80.00")));

    const again = run(resumed, accruing(moneyFromDecimal("30.00"), DELEGATION, LATER_STILL));

    expect(halted(again).halt.reason).toBe("cap-reached");
    expect(halted(again).spent).toBe(8000);
    expect(halted(again).cap).toBe(8000);
  });

  /** The boundary again, from the other side: a Cap equal to what was spent is already reached. */
  it("refuses a new Cap that is at or below what the Mission already spent", () => {
    for (const cap of [EXACTLY, moneyFromDecimal("49.99"), ZERO_MONEY]) {
      const refusal = refusalOf(decide(stopped(), authorising(cap)));

      expect(refusal.reason, formatMoney(cap)).toBe("cap-reached");
      expect(refusal.violations.join(" "), formatMoney(cap)).toMatch(
        /so authorising it would authorise nothing/,
      );
    }
  });

  it("accepts one cent above what was spent, because that is the smallest authorisation with an effect", () => {
    const resumed = run(stopped(), authorising(moneyFromDecimal("50.01")));

    expect(resumed.status).toBe("running");
    expect(meterOf(opened(resumed)).reached).toBe(false);
  });

  /**
   * It is not a way to edit a Mission's budget mid-flight. Revising a Cap nothing has reached is a
   * different act with rules this PRD does not model — who may lower it, and what happens to work already
   * commissioned — so it is refused rather than quietly allowed.
   */
  it("refuses on a Mission the Cap is not stopping", () => {
    const refusal = refusalOf(decide(withPane(), authorising(moneyFromDecimal("80.00"))));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      "a Mission that is running is waiting on no Cap authorisation",
    ]);
  });

  it("refuses a second authorisation once the Mission is running again", () => {
    const resumed = run(stopped(), authorising(moneyFromDecimal("80.00")));

    expect(refusalOf(decide(resumed, authorising(moneyFromDecimal("90.00")))).reason).toBe(
      "illegal-transition",
    );
  });

  /** A Gate is answered by a Gate decision, not by money. Task 8 owns that exit. */
  it("refuses on a Mission halted at a Gate, even when it has spent its whole Cap", () => {
    const atGate = evolve(run(withPane(), accruing(moneyFromDecimal("49.99"))), {
      kind: "mission-halted",
      missionId: MISSION,
      occurredAt: LATER,
      halt: { reason: "gate-open", gateId: GATE },
    });
    const past = run(atGate, accruing(moneyFromDecimal("10.00"), DELEGATION, LATER_STILL));

    expect(opened(past).spent).toBe(5999);

    const refusal = refusalOf(decide(past, authorising(moneyFromDecimal("90.00"))));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'a Mission that is halted at Gate "gate-1" is waiting on no Cap authorisation',
    ]);
  });

  it("refuses on a Mission that is over, or not open yet", () => {
    const terminal: readonly Mission[] = [
      UNOPENED_MISSION,
      run(withPane(), deliverCommand),
      evolve(withPane(), {
        kind: "mission-killed",
        missionId: MISSION,
        occurredAt: LATER,
        reason: "the Briefing was wrong",
      }),
    ];

    for (const state of terminal) {
      const refusal = refusalOf(decide(state, authorising(moneyFromDecimal("80.00"))));

      expect(refusal.reason, state.status).toBe("illegal-transition");
      expect(refusal.violations.join(" "), state.status).toMatch(
        /is waiting on no Cap authorisation/,
      );
    }
  });

  it("refuses instead of throwing when the Command carries no Cap at all", () => {
    const empty = { kind: "authorise-cap", occurredAt: LATER_STILL } as unknown as AuthoriseCap;

    expect(() => decide(stopped(), empty)).not.toThrow();

    const refusal = refusalOf(decide(stopped(), empty));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations.join(" ")).toMatch(/must carry one in whole BRL cents/);
  });
});

/**
 * A Mission opened with a Cap of zero has reached it before anything happened. It is running, and every
 * commissioning Command is refused — the Cap is enforced by the comparison, not only by the halt, so a
 * Mission cannot walk around it by never accruing.
 */
describe("a Mission with nothing to spend", () => {
  function broke(): RunningMission {
    return running({ cap: ZERO_MONEY });
  }

  it("refuses a Delegation while running, and says what it has spent its Cap on", () => {
    const refusal = refusalOf(decide(broke(), delegating()));

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations).toEqual([
      "a Mission that has spent its whole Cap of R$ 0,00 admits no Delegation, " +
        'so Zord "zord-scout" cannot be given one until its Cap is authorised',
    ]);
  });

  it("can be authorised out of it, being stopped by its Cap and nothing else", () => {
    const resumed = run(broke(), authorising(moneyFromDecimal("10.00")));

    expect(resumed.status).toBe("running");
    expect(opened(resumed).cap).toBe(1000);
    expect(eventsOf(decide(resumed, delegating())).map((event) => event.kind)).toEqual(["delegated"]);
  });
});

describe("what an accrual refuses", () => {
  it("refuses a cost charged to a Delegation this Mission never made", () => {
    const refusal = refusalOf(decide(withPane(), accruing(moneyFromDecimal("1.00"), OTHER_DELEGATION)));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Delegation "delegation-2" was never made in this Mission, ' +
        "so there is nothing to charge the cost to",
    ]);
  });

  it("reports both the state and the unknown Delegation when a Command breaks both", () => {
    const refusal = refusalOf(decide(UNOPENED_MISSION, accruing(moneyFromDecimal("1.00"))));

    expect(refusal.violations).toHaveLength(2);
    expect(refusal.violations[0]).toBe("a Mission that is not open yet accrues no cost");
    expect(refusal.violations[1]).toMatch(/was never made in this Mission/);
  });

  /**
   * A terminal Mission has no Zord left running — a Zord dies after delivering — so there is no in-flight
   * spend to report, and recording one would change what a Mission that closed its books cost.
   */
  it("refuses a cost on a Mission that is over", () => {
    const delivered = run(withPane(), deliverCommand);
    const killed = evolve(withPane(), {
      kind: "mission-killed",
      missionId: MISSION,
      occurredAt: LATER,
      reason: "the Briefing was wrong",
    });

    for (const state of [delivered, killed]) {
      const refusal = refusalOf(decide(state, accruing(moneyFromDecimal("1.00"))));

      expect(refusal.reason, state.status).toBe("illegal-transition");
      expect(refusal.violations, state.status).toEqual([
        `a Mission that is ${state.status} accrues no cost`,
      ]);
    }
  });

  /**
   * This is the first Command in the engine that does **arithmetic** with a required field. Task 3's and
   * Task 4's copy theirs onto an Event and survive a cast by accident; Task 6's dereferences one. A cost
   * forced past the compiler would reach `addMoney` and throw where `decide` promised not to, so it is
   * read as `unknown` first and refused.
   */
  it("refuses instead of throwing when the cost is not an amount at all", () => {
    const malformed: readonly AccrueCost[] = [
      { kind: "accrue-cost", occurredAt: LATER, delegationId: DELEGATION } as unknown as AccrueCost,
      { ...accruing(ZERO_MONEY), cost: "12.34" } as unknown as AccrueCost,
      { ...accruing(ZERO_MONEY), cost: 12.34 } as unknown as AccrueCost,
      { ...accruing(ZERO_MONEY), cost: Number.NaN } as unknown as AccrueCost,
    ];

    for (const command of malformed) {
      expect(() => decide(withPane(), command)).not.toThrow();

      const refusal = refusalOf(decide(withPane(), command));

      expect(refusal.reason).toBe("illegal-transition");
      expect(refusal.violations.join(" ")).toMatch(/must carry a cost in whole BRL cents/);
    }
  });

  /** A cost is never negative, and this model has no subtraction — so an accrual cannot be a refund. */
  it("refuses a negative cost", () => {
    const refund = { ...accruing(ZERO_MONEY), cost: -500 } as unknown as AccrueCost;

    const refusal = refusalOf(decide(withPane(), refund));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations.join(" ")).toMatch(/must carry a cost in whole BRL cents/);
  });

  /**
   * A total past `Number.MAX_SAFE_INTEGER` cents is where addition starts losing cents silently. It is
   * refused `cap-reached`, truthfully: it is beyond any Cap a Mission could have been opened with, and the
   * domain cannot record the amount exactly either way.
   */
  it("refuses a total this domain cannot record exactly", () => {
    const enormous = run(withPane(), accruing(moneyFromCents(Number.MAX_SAFE_INTEGER)));

    expect(halted(enormous).spent).toBe(Number.MAX_SAFE_INTEGER);

    const command = accruing(moneyFromCents(1), DELEGATION, LATER_STILL);
    expect(() => decide(enormous, command)).not.toThrow();

    const refusal = refusalOf(decide(enormous, command));

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations.join(" ")).toMatch(
      /would exceed the largest amount this domain can record exactly/,
    );
  });

  /**
   * A settled Delegation still accrues. A cost report can arrive after the Handoff was accepted — the
   * runtime bills what it billed — and refusing it would make the Meter understate the Pane that produced
   * the delivery.
   */
  it("accepts a cost on a Delegation whose Handoff was already accepted", () => {
    const settled = run(withPane(), submitCommand);

    const later = run(settled, accruing(moneyFromDecimal("3.00"), DELEGATION, LATER_STILL));

    expect(paneOf(later).spent).toBe(300);
    expect(paneOf(later).handoff).toEqual(HONOURING_HANDOFF);
  });

  it("never throws and never mutates, whatever it is handed", () => {
    const state = withTwoPanes();
    const before = structuredClone(state);

    for (const command of [
      accruing(moneyFromDecimal("1.00")),
      accruing(moneyFromDecimal("1.00"), OTHER_DELEGATION),
      accruing(EXACTLY),
      authorising(moneyFromDecimal("80.00")),
    ]) {
      expect(() => decide(state, command), command.kind).not.toThrow();
    }
    expect(state).toEqual(before);
  });
});

describe("folding the Meter", () => {
  function accrual(cost: Money, id = DELEGATION): CostAccrued {
    return { kind: "cost-accrued", missionId: MISSION, occurredAt: LATER, delegationId: id, cost };
  }

  function authorisation(cap: Money): CapAuthorised {
    return { kind: "cap-authorised", missionId: MISSION, occurredAt: LATER_STILL, cap };
  }

  it("ignores an accrual for a Delegation the Mission does not hold", () => {
    const state = withPane();

    expect(evolve(state, accrual(moneyFromDecimal("1.00"), OTHER_DELEGATION))).toBe(state);
  });

  it("ignores an accrual on a Mission that is not open, or is over", () => {
    const delivered = run(withPane(), deliverCommand);

    expect(evolve(UNOPENED_MISSION, accrual(moneyFromDecimal("1.00")))).toBe(UNOPENED_MISSION);
    expect(evolve(delivered, accrual(moneyFromDecimal("1.00")))).toBe(delivered);
  });

  /** `evolve` is total and folds whatever log it is handed, so it refuses the same amounts `decide` does. */
  it("ignores an accrual whose amount it cannot record", () => {
    const state = withPane();
    const malformed = { ...accrual(ZERO_MONEY), cost: undefined } as unknown as CostAccrued;
    const enormous = run(state, accruing(moneyFromCents(Number.MAX_SAFE_INTEGER)));

    expect(evolve(state, malformed)).toBe(state);
    expect(evolve(enormous, accrual(moneyFromCents(1)))).toBe(enormous);
  });

  it("keeps a halted Mission halted while it charges the accrual", () => {
    const stopped = run(withPane(), accruing(EXACTLY));

    const later = evolve(stopped, accrual(moneyFromDecimal("1.00")));

    expect(halted(later).halt).toEqual({ reason: "cap-reached" });
    expect(halted(later).spent).toBe(5100);
  });

  it("resumes a Mission halted at its Cap when the authorisation is folded", () => {
    const stopped = run(withPane(), accruing(EXACTLY));

    const resumed = evolve(stopped, authorisation(moneyFromDecimal("80.00")));

    expect(resumed.status).toBe("running");
    expect(opened(resumed).cap).toBe(8000);
  });

  /**
   * A Gate halt is not resumed by money, and the fold enforces that as well as `decide` does: a
   * hand-written log cannot walk a Mission past a Gate by raising its Cap.
   */
  it("leaves a Mission halted at a Gate exactly where it is", () => {
    const atGate = evolve(withPane(), {
      kind: "mission-halted",
      missionId: MISSION,
      occurredAt: LATER,
      halt: { reason: "gate-open", gateId: GATE },
    });

    expect(evolve(atGate, authorisation(moneyFromDecimal("80.00")))).toBe(atGate);
  });

  it("ignores an authorisation on a Mission that is not open, or is over", () => {
    const killed = evolve(withPane(), {
      kind: "mission-killed",
      missionId: MISSION,
      occurredAt: LATER,
      reason: "the Briefing was wrong",
    });

    expect(evolve(UNOPENED_MISSION, authorisation(moneyFromDecimal("80.00")))).toBe(UNOPENED_MISSION);
    expect(evolve(killed, authorisation(moneyFromDecimal("80.00")))).toBe(killed);
  });

  it("is deterministic and never mutates what it was given", () => {
    const state = withTwoPanes();
    const before = structuredClone(state);
    const facts: readonly MissionEvent[] = [
      accrual(moneyFromDecimal("1.00")),
      accrual(moneyFromDecimal("2.00"), OTHER_DELEGATION),
      accrual(EXACTLY),
      authorisation(moneyFromDecimal("80.00")),
    ];

    for (const fact of facts) {
      expect(evolve(state, fact), fact.kind).toEqual(evolve(state, fact));
    }
    expect(state).toEqual(before);
  });

  /**
   * The Replay property, in miniature and only over this task's facts: the state built Command by Command
   * equals the state folded from the log those Commands produced, halt and authorisation included. Task 9
   * owns the general proof.
   */
  it("rebuilds by folding the log what was built Command by Command", () => {
    const log: MissionEvent[] = [];
    let state: Mission = UNOPENED_MISSION;

    const commands: readonly MissionCommand[] = [
      { kind: "open-mission", ...opening() },
      delegating(),
      accruing(moneyFromDecimal("20.00")),
      accruing(moneyFromDecimal("30.00"), DELEGATION, LATER_STILL),
      authorising(moneyFromDecimal("80.00")),
      accruing(moneyFromDecimal("5.00"), DELEGATION, LATER_STILL),
    ];

    for (const command of commands) {
      for (const event of eventsOf(decide(state, command))) {
        log.push(event);
        state = evolve(state, event);
      }
    }

    expect(log.map((event) => event.kind)).toEqual([
      "mission-opened",
      "delegated",
      "cost-accrued",
      "cost-accrued",
      "mission-halted",
      "cap-authorised",
      "cost-accrued",
    ]);
    expect(log.reduce<Mission>(evolve, UNOPENED_MISSION)).toEqual(state);
    expect(opened(state).spent).toBe(5500);
    expect(state.status).toBe("running");
  });
});

describe("the amounts this module refuses to compute", () => {
  it("reads an amount only when it is one", () => {
    expect(amountOf(moneyFromCents(1234))).toBe(1234);
    expect(amountOf(ZERO_MONEY)).toBe(ZERO_MONEY);
    expect(amountOf(12.34 as unknown as Money)).toBeUndefined();
    expect(amountOf(-1 as unknown as Money)).toBeUndefined();
    expect(amountOf("1234" as unknown as Money)).toBeUndefined();
    expect(amountOf(undefined as unknown as Money)).toBeUndefined();
    expect(amountOf(Number.NaN as unknown as Money)).toBeUndefined();
  });

  it("answers with no total rather than throwing when addition would stop being exact", () => {
    expect(accrued(moneyFromCents(100), moneyFromCents(23))).toBe(123);
    expect(accrued(moneyFromCents(Number.MAX_SAFE_INTEGER), moneyFromCents(1))).toBeUndefined();
    // `decide` refuses that one and `evolve` ignores it, so the two agree and a fold stays equal to the
    // sequence of Decisions that produced it.
    expect(() => accrued(moneyFromCents(Number.MAX_SAFE_INTEGER), moneyFromCents(1))).not.toThrow();
  });
});

/**
 * The compile-time half. Every probe here was falsified by breaking the guarantee **at its source** — the
 * required field, the brand, the `readonly`, the parameter type — and confirming `tsc --noEmit` reports
 * `TS2578: Unused '@ts-expect-error' directive`.
 */
describe("what the type system refuses", () => {
  it("refuses an accrual that does not say which Pane spent the money", () => {
    const rejected = (): AccrueCost => {
      // @ts-expect-error cost is accounted per Pane, so an accrual names the Delegation it is charged to
      const command: AccrueCost = { kind: "accrue-cost", occurredAt: LATER, cost: CAP };
      return command;
    };

    expect(rejected().kind).toBe("accrue-cost");
  });

  it("refuses a raw number where an accrual's cost is required", () => {
    const rejected = (): AccrueCost => ({
      kind: "accrue-cost",
      occurredAt: LATER,
      delegationId: DELEGATION,
      // @ts-expect-error an unchecked number is not Money: it may be a float, or a negative, or reais
      cost: 1234,
    });

    expect(rejected().cost).toBe(1234);
  });

  it("refuses a CostAccrued fact that carries the total it produces", () => {
    const rejected = (): CostAccrued => ({
      kind: "cost-accrued",
      missionId: MISSION,
      occurredAt: LATER,
      delegationId: DELEGATION,
      cost: CAP,
      // @ts-expect-error a fact carries what this accrual cost; the totals are the fold's answer
      spent: CAP,
    });

    expect(rejected().cost).toBe(CAP);
  });

  it("refuses an authorisation that does not say what the new Cap is", () => {
    const rejected = (): AuthoriseCap => {
      // @ts-expect-error authorising raises the Cap, so the Command carries the Cap it raises it to
      const command: AuthoriseCap = { kind: "authorise-cap", occurredAt: LATER_STILL };
      return command;
    };

    expect(rejected().kind).toBe("authorise-cap");
  });

  it("refuses rewriting what a Pane spent", () => {
    const pane: Delegation = paneOf(run(withPane(), accruing(moneyFromDecimal("1.00"))));

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject it.
    // @ts-expect-error what a Pane cost is folded from the facts, never written by hand
    const rejected = (): void => void (pane.spent = pane.spent);

    // No runtime claim beyond the type: like the Harness and the Handoff before it, the Delegation record
    // itself is not frozen — see the Meter probes below for the reading that is.
    expect(rejected).not.toThrow();
  });

  it("refuses rewriting what a Mission spent", () => {
    const state: RunningMission = running();

    // @ts-expect-error a Mission's total is folded from its accruals, never assigned
    const rejected = (): void => void (state.spent = state.spent);

    expect(rejected).not.toThrow();
  });

  it("refuses rewriting a Meter reading, and freezes it as well", () => {
    const meter: Meter = meterOf(opened(withPane()));

    // @ts-expect-error a Meter is a reading of the state, not a place to record anything
    const rejected = (): void => void (meter.spent = meter.spent);

    // Frozen as well as readonly, so a Surface cannot rewrite what it was shown.
    expect(rejected).toThrow(TypeError);
    expect(meter.spent).toBe(ZERO_MONEY);
  });

  it("refuses adding a Pane to a Meter reading", () => {
    const meter: Meter = meterOf(opened(withPane()));

    const rejected = (): void =>
      // @ts-expect-error the Panes of a Meter are the Delegations the Mission made, not a list to append to
      void meter.perDelegation.push({ delegationId: OTHER_DELEGATION, spent: ZERO_MONEY });

    expect(rejected).toThrow(TypeError);
    expect(meter.perDelegation).toHaveLength(1);
  });

  it("refuses metering a Mission before it is known to be open", () => {
    // Held through the union on purpose: a `const` initialised from a known member would be narrowed by
    // the compiler and the probe would prove nothing.
    const state = whicheverState();

    // @ts-expect-error a Mission that is not open has no Cap and no Panes: narrow with isOpened first
    const rejected = (): Meter => meterOf(state);

    expect(rejected().cap).toBe(CAP);
  });
});
