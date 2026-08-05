import { describe, expect, it } from "vitest";

import { core, orchestrationCapability } from "@engine/domain/capability";
import {
  instant,
  type Delegated,
  type MissionDelivered,
  type MissionEvent,
  type MissionHalted,
  type MissionKilled,
  type MissionOpened,
} from "@engine/domain/events";
import { delegationId, gateId, missionId, zordId } from "@engine/domain/ids";
import { moneyFromDecimal } from "@engine/domain/money";
import type { MissionCommand, OpenMissionFields } from "@engine/domain/commands";
import {
  InvalidBriefingError,
  MODES,
  REFUSAL_REASONS,
  UNOPENED_MISSION,
  briefing,
  decide,
  evolve,
  exhausted,
  isOpened,
  openMission,
  type Decision,
  type Halt,
  type HaltedMission,
  type Mission,
  type Refusal,
  type RunningMission,
} from "@engine/domain/mission";

const OPENED_AT = instant("2026-08-05T12:00:00.000Z");
const LATER = instant("2026-08-05T13:00:00.000Z");

const GATE = gateId("gate-1");
const DELEGATION = delegationId("delegation-1");
const OTHER_DELEGATION = delegationId("delegation-2");
const SCOUT = zordId("zord-scout");

/** The Core that leads every Mission in this file: orchestrating capabilities only, by construction. */
const LEADING_CORE = core([
  orchestrationCapability("delegate"),
  orchestrationCapability("chase"),
  orchestrationCapability("consolidate"),
]);

function opening(overrides: Partial<OpenMissionFields> = {}): OpenMissionFields {
  return {
    missionId: missionId("mission-1"),
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: moneyFromDecimal("50.00"),
    core: LEADING_CORE,
    occurredAt: OPENED_AT,
    ...overrides,
  };
}

function running(): RunningMission {
  return openMission(opening());
}

/** A Mission halted the way Task 7 will halt one: at its Cap. */
function haltedAtCap(): HaltedMission {
  return expectHalted(evolve(running(), halted({ reason: "cap-reached" })));
}

/** A Mission halted the way Task 8 will halt one: at a Gate, waiting for a human. */
function haltedAtGate(gate = GATE): HaltedMission {
  return expectHalted(evolve(running(), halted({ reason: "gate-open", gateId: gate })));
}

function expectHalted(state: Mission): HaltedMission {
  if (state.status !== "halted") {
    throw new Error(`expected a halted Mission, got ${state.status}`);
  }
  return state;
}

/* Events, built by hand. `MissionHalted` and `MissionKilled` have no Command behind them in this
 * task — the Cap (Task 7) and the Gate (Task 8) produce them — so the lifecycle is exercised the way
 * a Replay exercises it: by folding the fact. */

function halted(halt: Halt): MissionHalted {
  return { kind: "mission-halted", missionId: missionId("mission-1"), occurredAt: LATER, halt };
}

function killed(reason = "the Briefing was wrong"): MissionKilled {
  return { kind: "mission-killed", missionId: missionId("mission-1"), occurredAt: LATER, reason };
}

function delegated(id = DELEGATION): Delegated {
  return {
    kind: "delegated",
    missionId: missionId("mission-1"),
    occurredAt: LATER,
    delegationId: id,
    zordId: SCOUT,
  };
}

function delivered(): MissionDelivered {
  return {
    kind: "mission-delivered",
    missionId: missionId("mission-1"),
    occurredAt: LATER,
    delivery: { summary: "Cockpit shipped", artifacts: ["cockpit.tsx", "cockpit.test.tsx"] },
  };
}

function opened(): MissionOpened {
  return {
    kind: "mission-opened",
    missionId: missionId("mission-1"),
    occurredAt: OPENED_AT,
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: moneyFromDecimal("50.00"),
    core: LEADING_CORE,
  };
}

const openMissionCommand: MissionCommand = { kind: "open-mission", ...opening() };
const deliverCommand: MissionCommand = {
  kind: "deliver-mission",
  occurredAt: LATER,
  delivery: { summary: "Cockpit shipped", artifacts: ["cockpit.tsx"] },
};
const delegateCommand: MissionCommand = {
  kind: "delegate",
  occurredAt: LATER,
  delegationId: DELEGATION,
  zordId: SCOUT,
};
const submitHandoffCommand: MissionCommand = {
  kind: "submit-handoff",
  occurredAt: LATER,
  delegationId: DELEGATION,
};
const decideGateCommand: MissionCommand = { kind: "decide-gate", occurredAt: LATER, gateId: GATE };

const EVERY_COMMAND: readonly MissionCommand[] = [
  openMissionCommand,
  deliverCommand,
  delegateCommand,
  submitHandoffCommand,
  decideGateCommand,
];

const EVERY_EVENT: readonly MissionEvent[] = [
  opened(),
  delegated(),
  halted({ reason: "cap-reached" }),
  halted({ reason: "gate-open", gateId: GATE }),
  killed(),
  delivered(),
];

function everyState(): ReadonlyArray<readonly [string, Mission]> {
  return [
    ["unopened", UNOPENED_MISSION],
    ["running", running()],
    ["halted at its Cap", haltedAtCap()],
    ["halted at a Gate", haltedAtGate()],
    ["delivered", expectStatus(evolve(running(), delivered()), "delivered")],
    ["killed", expectStatus(evolve(running(), killed()), "killed")],
  ];
}

/** A Mission in some state, as a caller who has not narrowed it yet holds one. */
function whicheverState(): Mission {
  return running();
}

function expectStatus(state: Mission, status: Mission["status"]): Mission {
  expect(state.status).toBe(status);
  return state;
}

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

/** Folds an accepted Decision into the state, the way a caller of the engine would. */
function apply(state: Mission, decision: Decision): Mission {
  return eventsOf(decision).reduce<Mission>(evolve, state);
}

describe("opening a Mission", () => {
  it("opens from a Briefing, with a Mode, a Cap and the Core that leads it", () => {
    const mission = running();

    expect(mission.status).toBe("running");
    expect(mission.id).toBe("mission-1");
    expect(mission.briefing).toBe("Ship the Cockpit with a Pane per Zord");
    expect(mission.mode).toBe("combination");
    expect(mission.cap).toBe(5000);
    expect(mission.core.capabilities.map((held) => held.name)).toEqual([
      "delegate",
      "chase",
      "consolidate",
    ]);
    expect(mission.openedAt).toBe(OPENED_AT);
    expect(mission.delegations).toEqual([]);
  });

  it("opens in any Mode the domain has", () => {
    for (const mode of MODES) {
      expect(openMission(opening({ mode })).mode, mode).toBe(mode);
    }
  });

  it("accepts the Command on an unopened Mission and produces one fact", () => {
    const events = eventsOf(decide(UNOPENED_MISSION, openMissionCommand));

    expect(events).toEqual([opened()]);
  });

  it("reaches the same state whether it is opened directly or by folding the Event", () => {
    expect(evolve(UNOPENED_MISSION, opened())).toEqual(running());
    expect(apply(UNOPENED_MISSION, decide(UNOPENED_MISSION, openMissionCommand))).toEqual(
      running(),
    );
  });

  it("refuses to open a Mission twice, whatever became of the first one", () => {
    for (const [label, state] of everyState()) {
      if (state.status === "unopened") {
        continue;
      }
      const refusal = refusalOf(decide(state, openMissionCommand));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(/a Mission is opened once/);
    }
  });

  it("refuses a Briefing that says nothing", () => {
    expect(() => briefing("")).toThrow(InvalidBriefingError);
    expect(() => briefing("   ")).toThrow(/must describe an expected outcome/);
  });

  it("keeps the state every log starts from immutable", () => {
    expect(Object.isFrozen(UNOPENED_MISSION)).toBe(true);
    expect(isOpened(UNOPENED_MISSION)).toBe(false);
    expect(isOpened(running())).toBe(true);
  });
});

describe("delivering a Mission", () => {
  it("consolidates a running Mission into its Delivery", () => {
    const state = apply(running(), decide(running(), deliverCommand));

    if (state.status !== "delivered") {
      throw new Error(`expected a delivered Mission, got ${state.status}`);
    }
    expect(state.delivery).toEqual({ summary: "Cockpit shipped", artifacts: ["cockpit.tsx"] });
    expect(state.briefing).toBe(running().briefing);
    expect(state.cap).toBe(running().cap);
  });

  it("refuses to deliver a Mission that is not running", () => {
    for (const [label, state] of everyState()) {
      if (state.status === "running") {
        continue;
      }
      const refusal = refusalOf(decide(state, deliverCommand));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(/cannot be delivered/);
    }
  });

  it("refuses to deliver twice", () => {
    const first = evolve(running(), delivered());

    expect(refusalOf(decide(first, deliverCommand)).violations.join(" ")).toMatch(
      /a Mission that is delivered cannot be delivered/,
    );
  });
});

/**
 * Criterion 12. The three refusals this task must prove, each in the state it is specified for.
 *
 * Note what these prove and what they do not: the accept path of `delegate`, `submit-handoff` and
 * `decide-gate` belongs to Tasks 4, 6 and 8, so today those Commands are refused from every state.
 * The assertions below pin the *specific* violation each illegal state produces, which is what a
 * later task must keep producing once it adds its accept path.
 */
describe("illegal transitions", () => {
  it("refuses a Delegation on a halted Mission", () => {
    const capRefusal = refusalOf(decide(haltedAtCap(), delegateCommand));

    expect(capRefusal.reason).toBe("illegal-transition");
    expect(capRefusal.violations).toEqual([
      'a Mission that is halted because it reached its Cap admits no Delegation, ' +
        'so Zord "zord-scout" cannot be given one',
    ]);

    const gateRefusal = refusalOf(decide(haltedAtGate(), delegateCommand));

    expect(gateRefusal.reason).toBe("illegal-transition");
    expect(gateRefusal.violations.join(" ")).toMatch(
      /halted at Gate "gate-1" admits no Delegation/,
    );
  });

  it("refuses a Delegation on a Mission that is over, or not open yet", () => {
    for (const [label, state] of everyState()) {
      if (state.status === "running") {
        continue;
      }
      const refusal = refusalOf(decide(state, delegateCommand));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(/admits no Delegation/);
    }
  });

  it("refuses a Handoff for a Delegation that was never made", () => {
    const withOneDelegation = evolve(running(), delegated(DELEGATION));
    const forAnother: MissionCommand = {
      kind: "submit-handoff",
      occurredAt: LATER,
      delegationId: OTHER_DELEGATION,
    };

    const refusal = refusalOf(decide(withOneDelegation, forAnother));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Delegation "delegation-2" was never made in this Mission, so there is nothing to hand off',
    ]);
  });

  it("does not refuse a known Delegation for being unknown", () => {
    const withOneDelegation = evolve(running(), delegated(DELEGATION));

    const refusal = refusalOf(decide(withOneDelegation, submitHandoffCommand));

    // Still refused — the Contract validation is Task 6 — but not for the reason above.
    expect(refusal.violations.join(" ")).not.toMatch(/never made in this Mission/);
    expect(refusal.violations.join(" ")).toMatch(/no "submit-handoff" transition in this engine yet/);
  });

  it("reports every rule a Handoff broke, not just the first", () => {
    const refusal = refusalOf(decide(UNOPENED_MISSION, submitHandoffCommand));

    expect(refusal.violations).toHaveLength(2);
    expect(refusal.violations[0]).toMatch(/a Mission that is not open yet admits no Handoff/);
    expect(refusal.violations[1]).toMatch(/was never made in this Mission/);
  });

  it("refuses a Handoff on a Mission that is not running, even for a known Delegation", () => {
    const stopped = evolve(
      evolve(running(), delegated(DELEGATION)),
      halted({ reason: "cap-reached" }),
    );

    const refusal = refusalOf(decide(stopped, submitHandoffCommand));

    expect(refusal.violations).toEqual([
      "a Mission that is halted because it reached its Cap admits no Handoff",
    ]);
  });

  it("refuses deciding a Gate when no Gate is open", () => {
    for (const [label, state] of everyState()) {
      if (state.status === "halted" && state.halt.reason === "gate-open") {
        continue;
      }
      const refusal = refusalOf(decide(state, decideGateCommand));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(
        /no Gate is open on a Mission that is .+ so Gate "gate-1" cannot be decided/,
      );
    }
  });

  it("refuses deciding a Gate that is not the one the Mission is waiting on", () => {
    const refusal = refusalOf(
      decide(haltedAtGate(gateId("gate-7")), decideGateCommand),
    );

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Gate "gate-1" is not open: this Mission is waiting on Gate "gate-7"',
    ]);
  });

  it("always refuses with a reason the Contract knows and at least one violation", () => {
    for (const [label, state] of everyState()) {
      for (const command of EVERY_COMMAND) {
        const decision = decide(state, command);
        if (decision.kind !== "refused") {
          continue;
        }
        expect(REFUSAL_REASONS, `${label} / ${command.kind}`).toContain(decision.refusal.reason);
        expect(
          decision.refusal.violations.length,
          `${label} / ${command.kind}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("never throws, whatever Command lands on whatever state", () => {
    for (const [label, state] of everyState()) {
      for (const command of EVERY_COMMAND) {
        expect(() => decide(state, command), `${label} / ${command.kind}`).not.toThrow();
      }
    }
  });
});

describe("evolve", () => {
  it("is total: every Event applies to every state and returns a Mission", () => {
    for (const [label, state] of everyState()) {
      for (const event of EVERY_EVENT) {
        const next = evolve(state, event);

        expect(() => evolve(state, event), `${label} / ${event.kind}`).not.toThrow();
        expect(typeof next.status, `${label} / ${event.kind}`).toBe("string");
      }
    }
  });

  it("is deterministic: the same state and Event always fold to the same result", () => {
    for (const [label, state] of everyState()) {
      for (const event of EVERY_EVENT) {
        expect(evolve(state, event), `${label} / ${event.kind}`).toEqual(evolve(state, event));
      }
    }
  });

  it("never mutates the state it was given", () => {
    for (const [label, state] of everyState()) {
      const before = structuredClone(state);
      for (const event of EVERY_EVENT) {
        evolve(state, event);
      }
      expect(state, label).toEqual(before);
    }
  });

  it("leaves the state untouched when the Event cannot apply", () => {
    const mission = running();

    expect(evolve(mission, opened())).toBe(mission);
    expect(evolve(UNOPENED_MISSION, delegated())).toBe(UNOPENED_MISSION);
    expect(evolve(UNOPENED_MISSION, delivered())).toBe(UNOPENED_MISSION);
    expect(evolve(evolve(mission, delivered()), killed()).status).toBe("delivered");
    expect(evolve(evolve(mission, killed()), delivered()).status).toBe("killed");
  });

  it("keeps the first halt when a second one arrives", () => {
    const atGate = haltedAtGate();

    expect(evolve(atGate, halted({ reason: "cap-reached" }))).toBe(atGate);
  });

  it("records a Delegation the Mission can then be held to", () => {
    const withTwo = evolve(evolve(running(), delegated(DELEGATION)), delegated(OTHER_DELEGATION));

    if (!isOpened(withTwo)) {
      throw new Error("expected an opened Mission");
    }
    expect(withTwo.delegations).toEqual([
      { id: DELEGATION, zordId: SCOUT, delegatedAt: LATER },
      { id: OTHER_DELEGATION, zordId: SCOUT, delegatedAt: LATER },
    ]);
  });

  it("carries the Delegations of a Mission into every later state", () => {
    const withOne = evolve(running(), delegated(DELEGATION));

    for (const event of [halted({ reason: "cap-reached" }), killed(), delivered()]) {
      const next = evolve(withOne, event);

      if (!isOpened(next)) {
        throw new Error("expected an opened Mission");
      }
      expect(next.delegations, event.kind).toHaveLength(1);
    }
  });

  it("drops the halt when a halted Mission is killed, so no state carries what it cannot mean", () => {
    const state = evolve(haltedAtGate(), killed("the human said no"));

    if (state.status !== "killed") {
      throw new Error(`expected a killed Mission, got ${state.status}`);
    }
    expect(state.reason).toBe("the human said no");
    expect(Object.keys(state)).not.toContain("halt");
  });

  it("rebuilds by folding the log what was built Command by Command", () => {
    const log: MissionEvent[] = [];
    let state: Mission = UNOPENED_MISSION;

    for (const command of [openMissionCommand, deliverCommand]) {
      const decision = decide(state, command);
      for (const event of eventsOf(decision)) {
        log.push(event);
        state = evolve(state, event);
      }
    }

    expect(log.map((event) => event.kind)).toEqual(["mission-opened", "mission-delivered"]);
    expect(log.reduce<Mission>(evolve, UNOPENED_MISSION)).toEqual(state);
  });
});

describe("the domain reads no clock and rolls no dice", () => {
  it("decides and folds with Date and Math.random poisoned", () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    const realParse = Date.parse;
    Date.now = (): number => {
      throw new Error("the domain must not read a clock");
    };
    Date.parse = (): number => {
      throw new Error("the domain must not parse time while deciding");
    };
    Math.random = (): number => {
      throw new Error("the domain must not randomise");
    };

    try {
      for (const [label, state] of everyState()) {
        for (const command of EVERY_COMMAND) {
          expect(() => decide(state, command), `${label} / ${command.kind}`).not.toThrow();
        }
        for (const event of EVERY_EVENT) {
          expect(() => evolve(state, event), `${label} / ${event.kind}`).not.toThrow();
        }
      }
    } finally {
      Date.now = realNow;
      Date.parse = realParse;
      Math.random = realRandom;
    }
  });
});

/**
 * The compile-time half of the model. Every probe here is falsified by breaking the guarantee at its
 * source — the brand, the union, the `never` parameter — and confirming `tsc` reports `TS2578:
 * Unused '@ts-expect-error' directive`, as `CLAUDE.md` requires.
 */
describe("what the type system refuses", () => {
  it("refuses a raw string where a Briefing is required", () => {
    const rejected = (): RunningMission =>
      openMission({
        ...opening(),
        // @ts-expect-error an unchecked string is not a Briefing: it may say nothing at all
        briefing: "Ship the Cockpit",
      });

    // The type error is the proof; the call still runs, because the brand is erased at runtime.
    expect(rejected().briefing).toBe("Ship the Cockpit");
  });

  it("refuses a Mode the domain does not have", () => {
    const rejected = (): RunningMission =>
      openMission({
        ...opening(),
        // @ts-expect-error a Mission is led in Free, Combination or Agentic Mode, and nothing else
        mode: "turbo",
      });

    expect(rejected().mode).toBe("turbo");
  });

  it("refuses reading a Mission's Delegations before it is known to be open", () => {
    // Returned through a `Mission` signature on purpose: a `const` annotated with a union but
    // initialised from a known member is narrowed by the compiler, which would hide the probe.
    const state = whicheverState();

    // @ts-expect-error an unopened Mission carries no Delegations: narrow with isOpened first
    const rejected = (): number => state.delegations.length;

    expect(rejected()).toBe(0);
  });

  it("refuses a Cap halt that carries a Gate", () => {
    const rejected = (): Halt => {
      // @ts-expect-error only a Gate halt waits on a Gate; a Cap halt waits on an authorisation
      const halt: Halt = { reason: "cap-reached", gateId: GATE };
      return halt;
    };

    expect(rejected().reason).toBe("cap-reached");
  });

  it("refuses a Gate halt with no Gate to wait on", () => {
    const rejected = (): Halt => {
      // @ts-expect-error a Mission halted at a Gate always says which Gate
      const halt: Halt = { reason: "gate-open" };
      return halt;
    };

    expect(rejected().reason).toBe("gate-open");
  });

  it("refuses mutating a Mission in place", () => {
    // Assigning the value the field already holds, so `readonly` is the only thing that can reject
    // it: writing `"running"` here would also fail on the literal type and prove nothing about
    // immutability.
    // @ts-expect-error a Mission is never mutated: fold an Event and take the state it returns
    const rejected = (): void => void (UNOPENED_MISSION.status = "unopened");

    // Frozen as well as readonly, so the state every log starts from cannot be rewritten either.
    expect(rejected).toThrow(TypeError);
    expect(UNOPENED_MISSION.status).toBe("unopened");
  });

  it("refuses a Command the union does not have", () => {
    const rejected = (): Decision =>
      decide(running(), {
        // @ts-expect-error "polish-mission" is not a Command of a Mission
        kind: "polish-mission",
        occurredAt: LATER,
      });

    expect(refusalOf(rejected()).violations.join(" ")).toMatch(/does not recognise/);
  });

  it("keeps the exhaustiveness check accepting nothing but a narrowed-away value", () => {
    // If this parameter is ever widened, both `decide` and `evolve` stop being exhaustive and a new
    // Command or Event can be added without the build noticing. That is the guarantee this probe
    // exists to break.
    const rejected = (): void =>
      // @ts-expect-error exhausted() accepts only a value the compiler has narrowed to nothing
      exhausted("delegate");

    expect(rejected).not.toThrow();
  });
});
