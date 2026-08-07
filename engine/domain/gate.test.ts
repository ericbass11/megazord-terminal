import { describe, expect, it } from "vitest";

import { core, orchestrationCapability } from "@engine/domain/capability";
import { clause, contract, type Contract } from "@engine/domain/contract";
import { gap, handoff, type Handoff } from "@engine/domain/handoff";
import { harness, type Harness, type HarnessSources } from "@engine/domain/harness";
import { clauseId, delegationId, gateId, missionId, zordId } from "@engine/domain/ids";
import { moneyFromDecimal, type Money } from "@engine/domain/money";
import { meterOf } from "@engine/domain/meter";
import {
  decisionOf,
  isOpenGate,
  openGateIn,
  revisionsIn,
  type Gate,
  type GateDecision,
} from "@engine/domain/gate";
import {
  instant,
  type GateDecided,
  type GateRaised,
  type Instant,
  type MissionEvent,
} from "@engine/domain/events";
import type {
  AccrueCost,
  AuthoriseCap,
  DecideGate,
  Delegate,
  DeliverMission,
  KillMission,
  MissionCommand,
  OpenMissionFields,
  RaiseGate,
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
  type HaltedMission,
  type Mission,
  type OpenedMission,
  type Refusal,
  type RunningMission,
} from "@engine/domain/mission";

/**
 * Criterion 6: **a Gate blocks progress until decided, and killing it stops the Mission.**
 *
 * Three human answers, and this file proves each of them plus the blocking in between. Two of the three are
 * Gate decisions and the third is a Command of its own: killing ends the **Mission** rather than answering
 * the Gate's question, so it is reachable while a Mission is running, while it is halted at a Gate, and —
 * this is the hole Task 7 left and Task 8 closes — while it is halted at its Cap, which until now had
 * exactly one exit and no way to say "no more".
 *
 * The Cap of every Mission here is R$ 50,00, so the interaction Task 7 handed over is one accrual away: a
 * Gate approved on a Mission that spent its whole Cap while it was stopped resumes to `running`, and the Cap
 * guard takes over on the next Command that would commission work.
 */

const OPENED_AT: Instant = instant("2026-08-06T09:00:00.000Z");
const LATER: Instant = instant("2026-08-06T10:00:00.000Z");
const LATER_STILL: Instant = instant("2026-08-06T11:00:00.000Z");

const MISSION = missionId("mission-1");
const GATE = gateId("gate-1");
const OTHER_GATE = gateId("gate-2");
const DELEGATION = delegationId("delegation-1");
const OTHER_DELEGATION = delegationId("delegation-2");
const SCOUT = zordId("zord-scout");
const BUILDER = zordId("zord-builder");

const SLICE = slice("Map the Surfaces the Cockpit needs and report the Contract of each");
const OTHER_SLICE = slice("Build the Pane grid against that Contract");

const CAP = moneyFromDecimal("50.00");

/** The question every Gate in this file asks, and the revision most of them come back with. */
const QUESTION = "The Contract grew a Clause. Does the Cockpit still ship this week?";
const REVISION = "Split the Pane grid off: ship the Cockpit shell first, the grid next week";

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

function running(): RunningMission {
  return openMission(opening());
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

function raising(overrides: Partial<RaiseGate> = {}): RaiseGate {
  return { kind: "raise-gate", occurredAt: LATER, gateId: GATE, question: QUESTION, ...overrides };
}

function deciding(
  decision: GateDecision = { kind: "approved" },
  id = GATE,
  occurredAt = LATER_STILL,
): DecideGate {
  return { kind: "decide-gate", occurredAt, gateId: id, decision };
}

function killing(reason = "the Briefing was wrong", occurredAt = LATER_STILL): KillMission {
  return { kind: "kill-mission", occurredAt, reason };
}

function accruing(cost: Money, id = DELEGATION, occurredAt = LATER_STILL): AccrueCost {
  return { kind: "accrue-cost", occurredAt, delegationId: id, cost };
}

function authorising(cap: Money): AuthoriseCap {
  return { kind: "authorise-cap", occurredAt: LATER_STILL, cap };
}

const submitCommand: SubmitHandoff = {
  kind: "submit-handoff",
  occurredAt: LATER_STILL,
  handoff: HONOURING_HANDOFF,
};

const deliverCommand: DeliverMission = {
  kind: "deliver-mission",
  occurredAt: LATER_STILL,
  delivery: { summary: "Cockpit shipped", artifacts: ["cockpit.tsx"] },
};

/* Events, built by hand, for the folds `decide` never produces. */

function gateRaised(id = GATE, question = QUESTION, occurredAt = LATER): GateRaised {
  return { kind: "gate-raised", missionId: MISSION, occurredAt, gateId: id, question };
}

function gateDecided(
  decision: GateDecision = { kind: "approved" },
  id = GATE,
  occurredAt = LATER_STILL,
): GateDecided {
  return { kind: "gate-decided", missionId: MISSION, occurredAt, gateId: id, decision };
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

/** Decides a Command and folds whatever it accepted, the way a caller of the engine would. */
function run(state: Mission, command: MissionCommand): Mission {
  return eventsOf(decide(state, command)).reduce<Mission>(evolve, state);
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

/** The Gates a Mission remembers, in the order it raised them. */
function gatesOf(state: Mission): readonly Gate[] {
  return opened(state).gates;
}

/** The one Gate a Mission holds, failing loudly when it holds none or more than one. */
function soleGate(state: Mission): Gate {
  const gates = gatesOf(state);
  if (gates.length !== 1) {
    throw new Error(`expected exactly one Gate, got ${gates.length}`);
  }
  return gates[0];
}

/** A running Mission with one Pane, so the Commands a Gate blocks have something real to ask for. */
function withPane(): Mission {
  return run(running(), delegating());
}

/** The state criterion 6 is about: a Mission stopped at Gate "gate-1", waiting for a human. */
function atGate(): Mission {
  return run(withPane(), raising());
}

/** A Mission stopped at its Cap: the halt Task 7 left with exactly one exit. */
function atCap(): Mission {
  return run(withPane(), accruing(CAP));
}

/* -------------------------------------------------------------------------------------------------
 * Raising a Gate
 * ---------------------------------------------------------------------------------------------- */

/**
 * Judgement call: **the domain raises the Gate, and does not decide when one is due.**
 *
 * A Gate is declared by a Combination — the glossary says a Combination has "a declared Roster, Gates and
 * deliverable" — and there is no Combination aggregate in `engine/`, so nothing here can *derive* that a
 * checkpoint has been reached. Two ways out were available and one of them is a lie: leave the `gate-open`
 * halt with no producer, so the only way to reach it is a hand-written log, or take the intent as a Command
 * and own what happens next. The first would leave the whole Gate cluster unreachable through the engine's
 * own API — criterion 6 provable only against a state nobody can arrive at, and Task 9's end-to-end run
 * unable to contain a Gate decision at all. So `raise-gate` exists, and it is the same split `accrue-cost`
 * lives with: the domain does not decide what a Zord's run cost either, it decides what a cost does.
 */
describe("raising a Gate", () => {
  it("produces the question and the halt, in that order", () => {
    const events = eventsOf(decide(withPane(), raising()));

    expect(events).toEqual([
      {
        kind: "gate-raised",
        missionId: MISSION,
        occurredAt: LATER,
        gateId: GATE,
        question: QUESTION,
      },
      {
        kind: "mission-halted",
        missionId: MISSION,
        occurredAt: LATER,
        halt: { reason: "gate-open", gateId: GATE },
      },
    ]);
  });

  it("stops the Mission on the Gate it raised", () => {
    const stopped = halted(atGate());

    expect(stopped.halt.reason).toBe("gate-open");
    expect(stopped.halt.gateId).toBe(GATE);
  });

  /**
   * The key set is pinned so that adding a field to `Gate` without a rule that fills it in fails here.
   * Three keys, each written by the raising rule from the `GateRaised` fact — and deliberately no fourth:
   * no `status` whose only value would be `"open"`, and no `decidedAt` that can be present beside an absent
   * decision and mean nothing.
   */
  it("records the Gate, open, with nothing a rule cannot fill", () => {
    const gate = soleGate(atGate());

    expect(gate).toEqual({ id: GATE, question: QUESTION, raisedAt: LATER });
    expect(Object.keys(gate).sort()).toEqual(["id", "question", "raisedAt"]);
    expect(isOpenGate(gate)).toBe(true);
    expect(openGateIn(gatesOf(atGate()))).toEqual(gate);
  });

  it("refuses a Gate that asks nothing, so no Mission stops for nothing", () => {
    for (const question of ["", "   "]) {
      const refusal = refusalOf(decide(withPane(), raising({ question })));

      expect(refusal.reason, JSON.stringify(question)).toBe("illegal-transition");
      expect(refusal.violations.join(" "), JSON.stringify(question)).toMatch(
        /a raise-gate Command must carry the question it asks/,
      );
    }
  });

  /**
   * Two Gates under one id could not be folded deterministically, and an answer naming that id could not
   * say which question it answered. The same rule a reused DelegationId meets, and reached the same way:
   * raise it, have it answered, then try to raise it again.
   */
  it("refuses a GateId this Mission already raised", () => {
    const answered = run(atGate(), deciding());

    const refusal = refusalOf(decide(answered, raising({ occurredAt: LATER_STILL })));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Gate "gate-1" was already raised in this Mission, and a Mission raises each one once',
    ]);
  });

  it("refuses to raise a Gate on a Mission that is not running", () => {
    const cases: ReadonlyArray<readonly [string, Mission, RegExp]> = [
      ["unopened", UNOPENED_MISSION, /a Mission that is not open yet raises no Gate/],
      ["halted at its Cap", atCap(), /halted because it reached its Cap raises no Gate/],
      ["halted at a Gate", atGate(), /halted at Gate "gate-1" raises no Gate/],
      ["delivered", run(withPane(), deliverCommand), /a Mission that is delivered raises no Gate/],
      ["killed", run(withPane(), killing()), /a Mission that is killed raises no Gate/],
    ];

    for (const [label, state, violation] of cases) {
      const refusal = refusalOf(decide(state, raising({ gateId: OTHER_GATE })));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(violation);
    }
  });

  /**
   * Judgement call: **the Cap is deliberately not consulted here.** `stoppedAtCap` guards the Commands that
   * *commission* work; raising a Gate commissions nothing and spends nothing, so a Mission that is running
   * with its whole Cap spent may still be stopped and asked a question — which is often exactly the question
   * worth asking. That is also why a Cap-halted Mission is refused `illegal-transition` above and not
   * `cap-reached`: what stands in the way there is that the Mission is already stopped, not the Cap.
   */
  it("raises a Gate on a running Mission that has spent its whole Cap", () => {
    const spent = run(run(atGate(), accruing(CAP)), deciding());

    expect(spent.status).toBe("running");
    expect(meterOf(opened(spent)).reached).toBe(true);

    const events = eventsOf(decide(spent, raising({ gateId: OTHER_GATE, occurredAt: LATER_STILL })));

    expect(events.map((event) => event.kind)).toEqual(["gate-raised", "mission-halted"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The blocking
 * ---------------------------------------------------------------------------------------------- */

/**
 * The first half of criterion 6: **a Gate blocks progress until it is decided.**
 *
 * Every Command that would move the work forward is refused while the Mission waits, and refused
 * `illegal-transition` rather than `cap-reached` — Task 7's rule, kept: `cap-reached` is the right reason
 * only when the Cap is what stands in the way, and here it is a human.
 */
describe("a Gate blocks progress until it is decided", () => {
  it("refuses every Command that would commission work", () => {
    const commands: readonly MissionCommand[] = [
      delegating({ delegationId: OTHER_DELEGATION, zordId: BUILDER, slice: OTHER_SLICE }),
      submitCommand,
      deliverCommand,
    ];

    for (const command of commands) {
      const refusal = refusalOf(decide(atGate(), command));

      expect(refusal.reason, command.kind).toBe("illegal-transition");
      expect(refusal.violations.join(" "), command.kind).toMatch(/halted at Gate "gate-1"/);
    }
  });

  /** A Gate is answered by a Gate decision, not by money. Pinned by Task 7 and kept here. */
  it("refuses an authorisation, because a Gate is not answered with money", () => {
    const refusal = refusalOf(decide(atGate(), authorising(moneyFromDecimal("80.00"))));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'a Mission that is halted at Gate "gate-1" is waiting on no Cap authorisation',
    ]);
  });

  it("refuses an answer to a Gate that is not the one it is waiting on", () => {
    const refusal = refusalOf(decide(atGate(), deciding({ kind: "approved" }, OTHER_GATE)));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Gate "gate-2" is not open: this Mission is waiting on Gate "gate-1"',
    ]);
  });

  /**
   * The halt and the `gates` record have to agree, and `decide` is where they are made to. A halt naming a
   * Gate the Mission never raised is reachable only from a hand-written log — Task 3's own fixtures build
   * exactly that state — and `evolve` would have nowhere to record the answer, so accepting it here would
   * produce a Decision the fold drops on the floor. `decide` and `evolve` refusing the same thing is what
   * keeps a fold equal to the sequence of Decisions that produced it.
   */
  it("refuses an answer when the halt names a Gate the Mission never raised", () => {
    const byHand = evolve(withPane(), {
      kind: "mission-halted",
      missionId: MISSION,
      occurredAt: LATER,
      halt: { reason: "gate-open", gateId: GATE },
    });
    expect(gatesOf(byHand)).toEqual([]);

    const refusal = refusalOf(decide(byHand, deciding()));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations).toEqual([
      'Gate "gate-1" is not recorded as open on this Mission, so there is nothing to decide',
    ]);
    // And the fold agrees: the same fact, folded by hand, changes nothing.
    expect(evolve(byHand, gateDecided())).toBe(byHand);
  });

  it("refuses a second answer to a Gate whose halt was written back by hand", () => {
    const answered = run(atGate(), deciding());
    const stoppedAgain = evolve(answered, {
      kind: "mission-halted",
      missionId: MISSION,
      occurredAt: LATER_STILL,
      halt: { reason: "gate-open", gateId: GATE },
    });

    const refusal = refusalOf(decide(stoppedAgain, deciding()));

    expect(refusal.violations.join(" ")).toMatch(/is not recorded as open on this Mission/);
  });

  it("refuses a decide-gate that decides nothing this domain can record", () => {
    const unreadable = [undefined, null, "approved", { kind: "postponed" }] as const;

    for (const claimed of unreadable) {
      // Written out rather than built by `deciding`, whose default parameter would swallow the
      // `undefined` case and quietly test an approval instead. A decision forced past the compiler is the
      // only way one of these arrives.
      const command: DecideGate = {
        kind: "decide-gate",
        occurredAt: LATER_STILL,
        gateId: GATE,
        decision: claimed as unknown as GateDecision,
      };
      const refusal = refusalOf(decide(atGate(), command));

      expect(refusal.reason, String(claimed)).toBe("illegal-transition");
      expect(refusal.violations.join(" "), String(claimed)).toMatch(
        /a Gate is decided by approving it or by asking for a revision that says why/,
      );
    }
  });

  /**
   * The one Command that is not blocked, and it is not progress: an accrual is a report of money already
   * gone. A Zord that was mid-run when the Gate stopped the Mission keeps reporting, and the Meter keeps
   * telling the truth about what the Mission cost while a human thought about it.
   */
  it("still accepts an accrual, because the money was already spent", () => {
    const later = run(atGate(), accruing(moneyFromDecimal("2.00")));

    expect(halted(later).spent).toBe(200);
    expect(halted(later).halt.reason).toBe("gate-open");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Approving
 * ---------------------------------------------------------------------------------------------- */

describe("approving a Gate", () => {
  it("produces one fact carrying the decision", () => {
    const events = eventsOf(decide(atGate(), deciding()));

    expect(events).toEqual([
      {
        kind: "gate-decided",
        missionId: MISSION,
        occurredAt: LATER_STILL,
        gateId: GATE,
        decision: { kind: "approved" },
      },
    ]);
  });

  it("returns the Mission to running and records the answer on the Gate", () => {
    const resumed = run(atGate(), deciding());

    expect(resumed.status).toBe("running");
    expect(soleGate(resumed)).toEqual({
      id: GATE,
      question: QUESTION,
      raisedAt: LATER,
      decision: { kind: "approved" },
    });
    expect(isOpenGate(soleGate(resumed))).toBe(false);
    expect(openGateIn(gatesOf(resumed))).toBeUndefined();
  });

  it("lets the Mission commission work again", () => {
    const resumed = run(atGate(), deciding());

    expect(eventsOf(decide(resumed, submitCommand)).map((event) => event.kind)).toEqual([
      "handoff-accepted",
    ]);
  });

  it("refuses a second answer, because the Gate is no longer open", () => {
    const resumed = run(atGate(), deciding());

    const refusal = refusalOf(decide(resumed, deciding()));

    expect(refusal.reason).toBe("illegal-transition");
    expect(refusal.violations.join(" ")).toMatch(
      /no Gate is open on a Mission that is running, so Gate "gate-1" cannot be decided/,
    );
  });

  /**
   * Task 7's handover, proven: `stoppedAtCap` excludes the Gate halt on purpose, so approving a Gate returns
   * the Mission to `running` whatever its Meter says — and the Cap guard takes over on the very next Command
   * that would commission work. The Mission is not walked past its Cap by a human answering a different
   * question.
   */
  it("hands a Mission that spent its Cap while stopped back to the Cap guard", () => {
    const resumed = run(run(atGate(), accruing(CAP)), deciding());

    expect(resumed.status).toBe("running");
    expect(opened(resumed).spent).toBe(5000);
    expect(meterOf(opened(resumed)).reached).toBe(true);

    const refusal = refusalOf(
      decide(resumed, delegating({ delegationId: OTHER_DELEGATION, slice: OTHER_SLICE })),
    );

    expect(refusal.reason).toBe("cap-reached");
    expect(refusal.violations.join(" ")).toMatch(/until its Cap is authorised/);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Revising
 * ---------------------------------------------------------------------------------------------- */

/**
 * Judgement call: **a revision resumes the Mission, and its reason is on the state.**
 *
 * It has to resume: a revision that left the Mission halted would be a reason nothing could act on. And the
 * reason has to be readable afterwards or the whole answer is theatre — so it is recorded on the Gate, where
 * `revisionsIn` reads it, rather than only in the Event log, which nobody has folded at the moment the Core
 * decides what to do next.
 *
 * It is **not** a new Briefing. A Mission is opened once, from one Briefing, and rewriting it would erase
 * what the Mission was for — the Replay would then describe a Mission that was never opened.
 */
describe("revising with a reason", () => {
  const revision: GateDecision = { kind: "revision-requested", reason: REVISION };

  it("produces one fact carrying the reason", () => {
    const events = eventsOf(decide(atGate(), deciding(revision)));

    expect(events).toEqual([
      {
        kind: "gate-decided",
        missionId: MISSION,
        occurredAt: LATER_STILL,
        gateId: GATE,
        decision: { kind: "revision-requested", reason: REVISION },
      },
    ]);
  });

  it("returns the Mission to running, carrying the reason as context", () => {
    const resumed = run(atGate(), deciding(revision));

    expect(resumed.status).toBe("running");
    expect(soleGate(resumed).decision).toEqual({ kind: "revision-requested", reason: REVISION });
    expect(revisionsIn(gatesOf(resumed))).toEqual([REVISION]);
  });

  it("leaves the Briefing exactly as the Mission was opened with", () => {
    const resumed = run(atGate(), deciding(revision));

    expect(opened(resumed).briefing).toBe(running().briefing);
  });

  /** Including the terminal states, which is where "why does this look like this" is asked from. */
  it("keeps the reason readable in every later state", () => {
    const resumed = run(atGate(), deciding(revision));

    for (const [label, state] of [
      ["raised another Gate", run(resumed, raising({ gateId: OTHER_GATE, occurredAt: LATER_STILL }))],
      ["delivered", run(resumed, deliverCommand)],
      ["killed", run(resumed, killing())],
    ] as const) {
      expect(revisionsIn(gatesOf(state)), label).toEqual([REVISION]);
    }
  });

  it("keeps every revision, in the order the Gates that carried them were raised", () => {
    const once = run(atGate(), deciding(revision));
    const again = run(once, raising({ gateId: OTHER_GATE, occurredAt: LATER_STILL }));
    const twice = run(
      again,
      deciding({ kind: "revision-requested", reason: "and drop the animation" }, OTHER_GATE),
    );

    expect(revisionsIn(gatesOf(twice))).toEqual([REVISION, "and drop the animation"]);
  });

  it("refuses a revision that does not say what to change", () => {
    for (const reason of ["", "   "]) {
      const refusal = refusalOf(
        decide(atGate(), deciding({ kind: "revision-requested", reason })),
      );

      expect(refusal.reason, JSON.stringify(reason)).toBe("illegal-transition");
      expect(refusal.violations.join(" "), JSON.stringify(reason)).toMatch(
        /asking for a revision that says why/,
      );
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * Killing
 * ---------------------------------------------------------------------------------------------- */

/**
 * The second half of criterion 6: **killing it stops the Mission.**
 *
 * Judgement call: **kill is a Command of its own, not a Gate decision.** The PRD lists three human answers at
 * a Gate and the first two answer the Gate's *question*; killing answers nothing — it ends the Mission the
 * question was about. Routed through `decide-gate` it would have made ending a Mission depend on somebody
 * having raised a checkpoint first, which breaks in two directions at once: a Mission that is running away,
 * delegating and spending, could not be stopped, and a Mission halted at its **Cap** could never be
 * abandoned. Task 7 left that halt exactly one exit — authorise more money — so a human who did not want to
 * spend more had nothing to say. This is the other answer to "how much more?": none, and stop.
 *
 * All three answers therefore remain available at a Gate, and the third one is available everywhere else too.
 */
describe("killing a Mission", () => {
  it("ends a Mission halted at a Gate, with the reason recorded", () => {
    const events = eventsOf(decide(atGate(), killing("the Briefing was wrong")));

    expect(events).toEqual([
      {
        kind: "mission-killed",
        missionId: MISSION,
        occurredAt: LATER_STILL,
        reason: "the Briefing was wrong",
      },
    ]);

    const dead = run(atGate(), killing("the Briefing was wrong"));

    if (dead.status !== "killed") {
      throw new Error(`expected a killed Mission, got ${dead.status}`);
    }
    expect(dead.reason).toBe("the Briefing was wrong");
    // No state carries what it cannot mean: a killed Mission is not waiting for anybody.
    expect(Object.keys(dead)).not.toContain("halt");
  });

  /**
   * And the Gate stays **open**, which is the truth: nobody answered it. A kill that marked the Gate decided
   * would put an answer on the record that no human gave, and a Replay would show a checkpoint that was
   * passed rather than a Mission that was abandoned at it.
   */
  it("leaves the Gate unanswered, because a kill answers nothing", () => {
    const dead = run(atGate(), killing());

    expect(isOpenGate(soleGate(dead))).toBe(true);
    expect(soleGate(dead).decision).toBeUndefined();
    expect(openGateIn(gatesOf(dead))).toEqual(soleGate(dead));
  });

  it("ends a running Mission, so one that is spending can be stopped at all", () => {
    const dead = run(withPane(), killing("the Cockpit is not the bottleneck"));

    expect(dead.status).toBe("killed");
    expect(opened(dead).delegations).toHaveLength(1);
  });

  /**
   * The hole Task 7 declared and this task closes. Before `kill-mission` a Mission stopped at its Cap had one
   * exit and it cost money: authorise more, or leave it stopped forever.
   */
  it("ends a Mission halted at its Cap, which had no way out but money", () => {
    const dead = run(atCap(), killing("not worth another R$ 30,00"));

    expect(dead.status).toBe("killed");
    if (dead.status !== "killed") {
      throw new Error("expected a killed Mission");
    }
    expect(dead.reason).toBe("not worth another R$ 30,00");
    // What it cost is kept: the money is gone, and a killed Mission still has to say what it spent.
    expect(dead.spent).toBe(5000);
  });

  it("refuses a kill that does not say why", () => {
    for (const reason of ["", "   "]) {
      const refusal = refusalOf(decide(atGate(), killing(reason)));

      expect(refusal.reason, JSON.stringify(reason)).toBe("illegal-transition");
      expect(refusal.violations.join(" "), JSON.stringify(reason)).toMatch(
        /a kill-mission Command must carry the reason it was ended for/,
      );
    }
  });

  it("refuses to end a Mission that is not open yet, or already over", () => {
    const cases: ReadonlyArray<readonly [string, Mission]> = [
      ["unopened", UNOPENED_MISSION],
      ["delivered", run(withPane(), deliverCommand)],
      ["killed", run(withPane(), killing())],
    ];

    for (const [label, state] of cases) {
      const refusal = refusalOf(decide(state, killing("again")));

      expect(refusal.reason, label).toBe("illegal-transition");
      expect(refusal.violations.join(" "), label).toMatch(/cannot be killed/);
    }
  });

  it("refuses everything afterwards, because a killed Mission is terminal", () => {
    const dead = run(atGate(), killing());
    const commands: readonly MissionCommand[] = [
      raising({ gateId: OTHER_GATE }),
      deciding(),
      killing("again"),
      delegating({ delegationId: OTHER_DELEGATION }),
      submitCommand,
      deliverCommand,
      authorising(moneyFromDecimal("80.00")),
      accruing(moneyFromDecimal("1.00")),
    ];

    for (const command of commands) {
      expect(decide(dead, command).kind, command.kind).toBe("refused");
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The fold
 * ---------------------------------------------------------------------------------------------- */

describe("folding the Gate facts", () => {
  it("rebuilds by folding the log what was built Command by Command", () => {
    const log: MissionEvent[] = [];
    let state: Mission = UNOPENED_MISSION;

    for (const command of [
      { kind: "open-mission", ...opening() } as MissionCommand,
      delegating(),
      raising(),
      accruing(moneyFromDecimal("1.00")),
      deciding({ kind: "revision-requested", reason: REVISION }),
      killing("the human said no"),
    ]) {
      for (const event of eventsOf(decide(state, command))) {
        log.push(event);
        state = evolve(state, event);
      }
    }

    expect(log.map((event) => event.kind)).toEqual([
      "mission-opened",
      "delegated",
      "gate-raised",
      "mission-halted",
      "cost-accrued",
      "gate-decided",
      "mission-killed",
    ]);
    expect(log.reduce<Mission>(evolve, UNOPENED_MISSION)).toEqual(state);
  });

  it("ignores a Gate raised on a Mission that is not running", () => {
    for (const state of [UNOPENED_MISSION, atGate(), atCap(), run(withPane(), killing())]) {
      expect(evolve(state, gateRaised(OTHER_GATE))).toBe(state);
    }
  });

  it("keeps the first Gate when a duplicated fact arrives, so the fold is deterministic", () => {
    const once = evolve(running(), gateRaised());
    const twice = evolve(once, gateRaised(GATE, "a different question"));

    expect(twice).toBe(once);
  });

  it("ignores a Gate whose question says nothing, exactly as decide refuses one", () => {
    // The same object, so it has to be held: `running()` builds a fresh Mission on every call.
    const mission = running();

    expect(evolve(mission, gateRaised(GATE, "   "))).toBe(mission);
    expect(gatesOf(evolve(mission, gateRaised(GATE, "  ")))).toEqual([]);
  });

  /**
   * A Cap halt is answered by money, and a Gate halt by a Gate decision. `applyCapAuthorised` already refuses
   * to resume a Gate halt; this is the mirror, and it is what stops a hand-written log from walking a Mission
   * past its Cap by answering a Gate that is not what stopped it.
   */
  it("leaves a Mission halted at its Cap exactly where it is", () => {
    const stopped = atCap();

    expect(evolve(stopped, gateDecided())).toBe(stopped);
  });

  it("ignores an answer to a Gate the Mission is not waiting on", () => {
    const stopped = atGate();

    expect(evolve(stopped, gateDecided({ kind: "approved" }, OTHER_GATE))).toBe(stopped);
  });

  it("ignores an answer on a Mission that is not halted", () => {
    for (const state of [UNOPENED_MISSION, running(), run(withPane(), deliverCommand)]) {
      expect(evolve(state, gateDecided())).toBe(state);
    }
  });

  /**
   * A Gate answered twice would let the second answer overwrite the first. `decide` never produces that — the
   * Mission is running once the first answer landed — so the state this needs is one only a hand-written log
   * can produce: a Gate already decided, and a halt pointing at it.
   */
  it("ignores a second answer to a Gate that already has one", () => {
    const answered = run(atGate(), deciding({ kind: "revision-requested", reason: REVISION }));
    const stoppedAgain = evolve(answered, {
      kind: "mission-halted",
      missionId: MISSION,
      occurredAt: LATER_STILL,
      halt: { reason: "gate-open", gateId: GATE },
    });

    expect(evolve(stoppedAgain, gateDecided({ kind: "approved" }))).toBe(stoppedAgain);
    expect(revisionsIn(gatesOf(stoppedAgain))).toEqual([REVISION]);
  });

  it("ignores an answer this domain cannot read, exactly as decide refuses one", () => {
    const stopped = atGate();
    // The second one is written out rather than built by `gateDecided`, whose default parameter would
    // swallow the `undefined` and fold a perfectly good approval instead.
    const decidedByNothing: GateDecided = {
      kind: "gate-decided",
      missionId: MISSION,
      occurredAt: LATER_STILL,
      gateId: GATE,
      decision: undefined as unknown as GateDecision,
    };

    expect(evolve(stopped, gateDecided({ kind: "revision-requested", reason: "  " }))).toBe(stopped);
    expect(evolve(stopped, decidedByNothing)).toBe(stopped);
  });

  it("carries the Gates of a Mission into every later state", () => {
    const withGate = run(atGate(), deciding());

    for (const state of [
      run(withGate, deliverCommand),
      run(withGate, killing()),
      run(run(withGate, raising({ gateId: OTHER_GATE, occurredAt: LATER_STILL })), killing()),
    ]) {
      expect(gatesOf(state).length).toBeGreaterThanOrEqual(1);
      expect(gatesOf(state)[0].id).toBe(GATE);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The readings
 * ---------------------------------------------------------------------------------------------- */

describe("the readings a Surface is given", () => {
  it("reports no open Gate on a Mission that raised none", () => {
    expect(openGateIn([])).toBeUndefined();
    expect(revisionsIn([])).toEqual([]);
    expect(gatesOf(running())).toEqual([]);
  });

  it("reads a decision that arrived through a cast, and refuses what it cannot read", () => {
    expect(decisionOf({ kind: "approved" })).toEqual({ kind: "approved" });
    expect(decisionOf({ kind: "revision-requested", reason: REVISION })).toEqual({
      kind: "revision-requested",
      reason: REVISION,
    });

    for (const claimed of [undefined, null, 7, "approved", {}, { kind: "postponed" }]) {
      expect(decisionOf(claimed as unknown as GateDecision), String(claimed)).toBeUndefined();
    }
    for (const reason of ["", "   ", undefined, 7]) {
      expect(
        decisionOf({ kind: "revision-requested", reason } as unknown as GateDecision),
        String(reason),
      ).toBeUndefined();
    }
  });

  it("rebuilds what it returns, so a forced field never reaches a fact", () => {
    const forced = { kind: "approved", pressuredBy: "the deadline" } as unknown as GateDecision;

    expect(Object.keys(decisionOf(forced) ?? {})).toEqual(["kind"]);
    expect(Object.isFrozen(decisionOf(forced))).toBe(true);
  });

  it("never throws, whatever it is handed", () => {
    for (const claimed of [undefined, null, 7, "approved", [], { kind: 3 }]) {
      expect(() => decisionOf(claimed as unknown as GateDecision), String(claimed)).not.toThrow();
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The compile-time half
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every probe here was falsified by breaking the guarantee **at its source** — the union member, the
 * required field, the `readonly` — and confirming `tsc --noEmit` reports `TS2578: Unused
 * '@ts-expect-error' directive`.
 */
describe("what the type system refuses", () => {
  it("refuses an approval that carries a revision reason", () => {
    const rejected = (): GateDecision => {
      // @ts-expect-error approving says nothing back: only a revision carries a reason
      const decision: GateDecision = { kind: "approved", reason: REVISION };
      return decision;
    };

    expect(rejected().kind).toBe("approved");
  });

  it("refuses a revision that carries no reason", () => {
    const rejected = (): GateDecision => {
      // @ts-expect-error a revision that does not say what to change is a rejection dressed as guidance
      const decision: GateDecision = { kind: "revision-requested" };
      return decision;
    };

    expect(rejected().kind).toBe("revision-requested");
  });

  it("refuses a decision the domain does not have", () => {
    const rejected = (): GateDecision => {
      // @ts-expect-error a Gate is approved or sent back for a revision; killing is not an answer to it
      const decision: GateDecision = { kind: "killed", reason: "the Briefing was wrong" };
      return decision;
    };

    expect(rejected().kind).toBe("killed");
  });

  it("refuses a Gate that carries a status field instead of the answer it got", () => {
    const rejected = (): Gate => ({
      id: GATE,
      question: QUESTION,
      raisedAt: LATER,
      // @ts-expect-error a Gate is open exactly while nothing has answered it: there is no status to hold
      status: "open",
    });

    expect(rejected().id).toBe(GATE);
  });

  it("refuses a Gate that asks nothing", () => {
    const rejected = (): Gate => {
      // @ts-expect-error a Gate stops the Mission to ask something, so the question is part of it
      const gate: Gate = { id: GATE, raisedAt: LATER };
      return gate;
    };

    expect(rejected().id).toBe(GATE);
  });

  it("refuses rewriting the answer a Gate got", () => {
    const gate: Gate = soleGate(run(atGate(), deciding()));

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject it.
    // @ts-expect-error what a human decided is a fact: it is recorded once and never rewritten
    const rejected = (): void => void (gate.decision = gate.decision);

    // No runtime claim beyond the type, like the Delegation record before it: the fold builds a new Gate
    // rather than mutating one, which is what the `evolve` tests above assert.
    expect(rejected).not.toThrow();
  });

  it("refuses appending a Gate to a Mission", () => {
    const state: RunningMission = running();

    const rejected = (): void =>
      // @ts-expect-error the Gates of a Mission are folded from its facts, never pushed onto it
      void state.gates.push({ id: GATE, question: QUESTION, raisedAt: LATER });

    // No runtime claim beyond the type, and that is the existing shape rather than an omission: neither
    // `delegations` nor `gates` is frozen on a Mission, because `evolve` builds a new list every time and a
    // caller that pushes onto the old one has mutated a state nothing will read again. The frozen readings
    // are the ones handed *out* — `meterOf`, `harness()`, `handoff()`.
    expect(rejected).not.toThrow();
    expect(state.gates).toHaveLength(1);
  });

  it("refuses a raise-gate Command that carries no question", () => {
    const rejected = (): RaiseGate => {
      // @ts-expect-error a Gate that asks nothing stops the Mission for no stated purpose
      const command: RaiseGate = { kind: "raise-gate", occurredAt: LATER, gateId: GATE };
      return command;
    };

    expect(rejected().kind).toBe("raise-gate");
  });

  it("refuses a decide-gate Command that decides nothing", () => {
    const rejected = (): DecideGate => {
      // @ts-expect-error a Command that carries no decision decides nothing: neither answer is a default
      const command: DecideGate = { kind: "decide-gate", occurredAt: LATER_STILL, gateId: GATE };
      return command;
    };

    expect(rejected().kind).toBe("decide-gate");
  });

  it("refuses a decide-gate Command that does not name the Gate it answers", () => {
    const rejected = (): DecideGate => {
      // @ts-expect-error an answer that names no Gate would apply to whatever is open when it lands
      const command: DecideGate = {
        kind: "decide-gate",
        occurredAt: LATER_STILL,
        decision: { kind: "approved" },
      };
      return command;
    };

    expect(rejected().kind).toBe("decide-gate");
  });

  it("refuses a kill-mission Command that does not say why", () => {
    const rejected = (): KillMission => {
      // @ts-expect-error why a Mission ended with no Delivery is the one thing its Replay is read for
      const command: KillMission = { kind: "kill-mission", occurredAt: LATER_STILL };
      return command;
    };

    expect(rejected().kind).toBe("kill-mission");
  });

  /**
   * The declared Gap, pinned at the type level. A Gate decision is a human act and nothing in `engine/`
   * names a human, so recording who decided would be a claim no rule could check — the always-zero field
   * again. This is the same answer Task 7 gave for `CapAuthorised`, and the same probe: whoever adds an actor
   * model deletes both directives in one change.
   */
  it("refuses an author on a Gate decision, because nothing here names a human", () => {
    const rejected = (): GateDecided => ({
      kind: "gate-decided",
      missionId: MISSION,
      occurredAt: LATER_STILL,
      gateId: GATE,
      decision: { kind: "approved" },
      // @ts-expect-error this domain has no actor model, so who decided is a claim no rule could check
      decidedBy: "eric",
    });

    expect(rejected().gateId).toBe(GATE);
  });

  it("refuses an author on a kill, for the same reason", () => {
    const rejected = (): KillMission => ({
      kind: "kill-mission",
      occurredAt: LATER_STILL,
      reason: "the Briefing was wrong",
      // @ts-expect-error this domain has no actor model, so who killed it is a claim no rule could check
      killedBy: "eric",
    });

    expect(rejected().reason).toBe("the Briefing was wrong");
  });
});
