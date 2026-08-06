import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EMPTY_REPLAY,
  addMoney,
  briefing,
  clause,
  clauseId,
  contract,
  delegationId,
  eventsIn,
  eventsOf,
  fakeAgentRunner,
  gap,
  gateId,
  handoff,
  harness,
  instant,
  isOpened,
  meterOf,
  missionId,
  moneyFromDecimal,
  orchestrationCapability,
  refusedIn,
  replay,
  revisionsIn,
  slice,
  stateOf,
  stepsOf,
  submit,
  zordId,
  core as coreOf,
  type AgentReport,
  type ClauseId,
  type Contract,
  type Delegated,
  type DelegationId,
  type FakeAgentRunner,
  type Handoff,
  type Harness,
  type Instant,
  type Mission,
  type Money,
  type Replay,
  type Step,
} from "@engine/index";

/**
 * Criterion 13: **a whole Mission, end to end, against the fake `AgentRunner`, with no CLI installed
 * and no network.**
 *
 * Everything here is imported from `@engine/index` and nothing from `engine/domain/*`. That is
 * deliberate: this file stands in for the first Surface, so it is held to the boundary a Surface is held
 * to, and it proves the public surface is enough to run a Mission rather than merely enough to inspect
 * one. `engine/index.ts` is a deliverable of this task, and this is its test.
 *
 * ## The story it drives
 *
 * One Mission, from a Briefing to a Delivery, with every human moment the lifecycle has in it:
 *
 * 1. the Core delegates a Slice to a scout, and the Zord runs behind the port with the resolved Harness;
 * 2. its first Handoff declares a **required** Clause as a Gap, so the Core refuses it — no human — and
 *    the Zord is told what it broke and submits again;
 * 3. a **Gate** stops the Mission and a human sends it back with a reason, which returns as the context
 *    the next Delegation is given;
 * 4. the builder runs at a higher Effort, and its cost **reaches the Cap**: the Mission stops and asks
 *    for authorisation, which raises the Cap to a new absolute amount;
 * 5. the Core consolidates the Delivery.
 *
 * ## What "no clock" means when a Surface obviously has one
 *
 * Time enters the domain on a Command and nowhere else, so the stand-in Surface below owns the clock —
 * and its clock is a pre-built list of Instants, consumed in order. Same run, same Instants, always. The
 * whole drive is then repeated with `Date.now`, `Date.parse`, `Math.random` **and** `fetch` poisoned, so
 * "no clock, no dice, no network" is a test rather than a claim.
 */

/* -------------------------------------------------------------------------------------------------
 * The Mission being run
 * ---------------------------------------------------------------------------------------------- */

const MISSION = missionId("mission-cockpit");
const SCOUT = zordId("zord-scout");
const BUILDER = zordId("zord-builder");
const FIRST = delegationId("delegation-1");
const SECOND = delegationId("delegation-2");
const GATE = gateId("gate-ship-this-week");

const CAP: Money = moneyFromDecimal("50.00");
/** What the human answers when the Mission stops and asks "how much more?". A number nobody derived. */
const AUTHORISED_CAP: Money = moneyFromDecimal("80.00");

const RENDERS: ClauseId = clauseId("clause-renders");
const NOTES: ClauseId = clauseId("clause-notes");

const REFERENCE_CONTRACT: Contract = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
  clause({ id: NOTES, description: "The Surfaces it touched are listed", required: false }),
]);

const LEADING_CORE = coreOf([
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

const SCOUT_SLICE = slice("Map the Surfaces the Cockpit needs and report the Contract of each");
const BUILDER_SLICE = slice("Build the Cockpit shell against the Contract the scout reported");

const SCOUT_COST: Money = moneyFromDecimal("12.00");
const RESUBMISSION_COST: Money = moneyFromDecimal("8.00");
/** R$ 12,00 + R$ 8,00 + R$ 30,00 is exactly the Cap, and a Cap is reached at equality. */
const BUILDER_COST: Money = moneyFromDecimal("30.00");

/**
 * What the fake Zords write, in the order they are run.
 *
 * The first claim declares the **required** Clause as a Gap, which is honest and worth nothing — the
 * Core refuses it. The second covers it. The third covers both Clauses of the Contract.
 *
 * The output is JSON on purpose: a Handoff arriving through `JSON.parse` from a Zord's output is exactly
 * the threat model `handoff()` and `validateHandoff` are written for, so the boundary this file crosses
 * is the real one and not a hand-built record.
 */
const SCRIPT: readonly AgentReport[] = [
  {
    output: JSON.stringify({
      satisfies: [],
      gaps: [{ clauseId: RENDERS, reason: "ran out of time on the Pane grid" }],
      artifacts: ["surfaces.md"],
    }),
    cost: SCOUT_COST,
  },
  {
    output: JSON.stringify({
      satisfies: [RENDERS],
      gaps: [{ clauseId: NOTES, reason: "the Surfaces are still moving" }],
      artifacts: ["surfaces.md", "panes.md"],
    }),
    cost: RESUBMISSION_COST,
  },
  {
    output: JSON.stringify({
      satisfies: [RENDERS, NOTES],
      gaps: [],
      artifacts: ["cockpit.tsx", "cockpit.test.tsx"],
    }),
    cost: BUILDER_COST,
  },
];

/* -------------------------------------------------------------------------------------------------
 * The stand-in Surface
 * ---------------------------------------------------------------------------------------------- */

/** The Instants this run uses, built once so the drive itself never constructs one. */
const CLOCK: readonly Instant[] = Object.freeze(
  Array.from({ length: 24 }, (_, minute) =>
    instant(`2026-08-06T09:${String(minute).padStart(2, "0")}:00.000Z`),
  ),
);

/** The edge's clock: the next Instant, in order. Deterministic, and nothing else reads a clock. */
function edgeClock(): () => Instant {
  let minute = 0;
  return (): Instant => {
    const at = CLOCK[minute];
    minute += 1;
    if (at === undefined) {
      throw new Error("the drive ran longer than its scripted clock");
    }
    return at;
  };
}

/** What a Zord writes: a claim about the Contract, without saying which Delegation it answers. */
type ZordClaim = {
  readonly satisfies: readonly ClauseId[];
  readonly gaps: readonly { readonly clauseId: ClauseId; readonly reason: string }[];
  readonly artifacts: readonly string[];
};

/**
 * The Handoff a Zord's output claims, addressed to the Delegation the Surface asked.
 *
 * The Surface adds the `delegationId` because it knows which Delegation it commissioned; letting the
 * Zord name it would let one Zord answer another's Delegation. `handoff()` and `gap()` are the checks at
 * this boundary, and they are the reason a malformed claim fails here rather than inside `decide`.
 */
function claimed(output: string, answers: DelegationId): Handoff {
  const written: unknown = JSON.parse(output);
  if (typeof written !== "object" || written === null) {
    throw new Error(`a Zord's output must be a claim, received ${output}`);
  }
  const claim = written as ZordClaim;
  return handoff({
    delegationId: answers,
    satisfies: claim.satisfies,
    gaps: claim.gaps.map((declared) => gap(declared.clauseId, declared.reason)),
    artifacts: claim.artifacts,
  });
}

/** The last Decision a Replay recorded. */
function lastDecision(recording: Replay): Replay[number]["decision"] {
  const last = recording[recording.length - 1];
  if (last === undefined) {
    throw new Error("nothing has been submitted to this Mission yet");
  }
  return last.decision;
}

/** The `Delegated` fact of one Delegation — where the resolved Harness is recorded. */
function delegatedIn(recording: Replay, id: DelegationId): Delegated {
  const made = eventsIn(stepsOf(recording), "delegated").find(
    (event) => event.delegationId === id,
  );
  if (made === undefined) {
    throw new Error(`Delegation "${id}" was never made`);
  }
  return made;
}

/** The violations of the Refusal a Replay just recorded, for the instruction that goes back. */
function refusedFor(recording: Replay): readonly string[] {
  const decision = lastDecision(recording);
  if (decision.kind !== "refused") {
    throw new Error("the last Command was accepted");
  }
  return decision.refusal.violations;
}

/**
 * Drives the whole Mission, exactly as a Surface would: it submits Commands, runs Zords behind the
 * port, and reacts to what the domain answered.
 *
 * Assertion-free on purpose — the tests below read the Replay it produced. The only `throw`s are the
 * control-flow ones: a Surface that cannot find the Delegation it just made has a bug of its own.
 */
async function driveTheMission(): Promise<{
  readonly recording: Replay;
  readonly runner: FakeAgentRunner;
}> {
  const at = edgeClock();
  const runner = fakeAgentRunner(SCRIPT);
  let recording: Replay = EMPTY_REPLAY;

  // 1. The Briefing opens the Mission, with the Mode, the Cap and the Core that leads it.
  recording = submit(recording, {
    kind: "open-mission",
    occurredAt: at(),
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: CAP,
    core: LEADING_CORE,
  });

  // 2. The Core delegates the first Slice. The Harness is resolved inside `decide` and recorded on the
  //    fact, which is where the runner reads it from — nobody re-resolves anything.
  recording = submit(recording, {
    kind: "delegate",
    occurredAt: at(),
    delegationId: FIRST,
    zordId: SCOUT,
    slice: SCOUT_SLICE,
    harnessSources: { catalogDefault: CATALOG_DEFAULT },
    contract: REFERENCE_CONTRACT,
  });

  // 3. The Zord runs, reports what it spent, and submits its Handoff. Refused, it is told what it broke
  //    and submits again — no human in the loop, which is the whole of criterion 3.
  let instruction = `${SCOUT_SLICE}\n\nHonour this Contract: ${asTold(REFERENCE_CONTRACT)}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const report = await runner.run({ harness: delegatedIn(recording, FIRST).harness, instruction });
    recording = submit(recording, {
      kind: "accrue-cost",
      occurredAt: at(),
      delegationId: FIRST,
      cost: report.cost,
    });
    recording = submit(recording, {
      kind: "submit-handoff",
      occurredAt: at(),
      handoff: claimed(report.output, FIRST),
    });
    if (lastDecision(recording).kind === "accepted") {
      break;
    }
    instruction = `${instruction}\n\nThe Core refused it: ${refusedFor(recording).join("; ")}`;
  }

  // 4. The Combination's declared checkpoint stops the Mission, and a human sends it back with a reason.
  recording = submit(recording, {
    kind: "raise-gate",
    occurredAt: at(),
    gateId: GATE,
    question: "The scout found a Clause nobody planned. Does the Cockpit still ship this week?",
  });
  recording = submit(recording, {
    kind: "decide-gate",
    occurredAt: at(),
    gateId: GATE,
    decision: {
      kind: "revision-requested",
      reason: "Ship the Cockpit shell first, the Pane grid next week",
    },
  });

  // 5. The second Delegation carries that reason as context, read off the state — which is what keeps
  //    "revise with a reason" from being theatre. The Roster wins over the invocation, so this Zord runs
  //    at a higher Effort than the scout did.
  const resumed = stateOf(recording);
  recording = submit(recording, {
    kind: "delegate",
    occurredAt: at(),
    delegationId: SECOND,
    zordId: BUILDER,
    slice: BUILDER_SLICE,
    harnessSources: {
      rosterEntry: { effort: "high" },
      invocation: { effort: "low", model: "opus-4-1" },
      catalogDefault: CATALOG_DEFAULT,
    },
    contract: REFERENCE_CONTRACT,
  });

  const builderReport = await runner.run({
    harness: delegatedIn(recording, SECOND).harness,
    instruction: `${BUILDER_SLICE}\n\nA human asked for: ${revisionsOf(resumed).join("; ")}`,
  });
  recording = submit(recording, {
    kind: "accrue-cost",
    occurredAt: at(),
    delegationId: SECOND,
    cost: builderReport.cost,
  });

  // 6. That accrual reached the Cap, so the Mission stopped and is asking for authorisation. The human
  //    answers with a new, higher Cap — the only thing that resumes it.
  const stopped = stateOf(recording);
  if (stopped.status === "halted" && stopped.halt.reason === "cap-reached") {
    recording = submit(recording, { kind: "authorise-cap", occurredAt: at(), cap: AUTHORISED_CAP });
  }

  recording = submit(recording, {
    kind: "submit-handoff",
    occurredAt: at(),
    handoff: claimed(builderReport.output, SECOND),
  });

  // 7. The Core consolidates what the Zords delivered.
  recording = submit(recording, {
    kind: "deliver-mission",
    occurredAt: at(),
    delivery: {
      summary: "Cockpit shell shipped, one Pane per Zord",
      artifacts: ["cockpit.tsx", "surfaces.md"],
    },
  });

  return { recording, runner };
}

/** The Contract as a Zord is told about it. The domain judges it; this only has to be readable. */
function asTold(reference: Contract): string {
  return reference.clauses
    .map((agreed) => `${agreed.id} (${agreed.required ? "required" : "optional"})`)
    .join(", ");
}

/** The revisions a human has asked for so far, read off the state a Surface holds. */
function revisionsOf(state: Mission): readonly string[] {
  return isOpened(state) ? revisionsIn(state.gates) : [];
}

/* -------------------------------------------------------------------------------------------------
 * What the run proves
 * ---------------------------------------------------------------------------------------------- */

describe("a whole Mission, from Briefing to Delivery, with no CLI and no network", () => {
  it("ends delivered, with everything the Mission spent accounted for", async () => {
    const { recording } = await driveTheMission();
    const state = stateOf(recording);

    expect(state.status).toBe("delivered");
    if (state.status !== "delivered") {
      throw new Error("the drive ends delivered");
    }
    expect(state.delivery).toEqual({
      summary: "Cockpit shell shipped, one Pane per Zord",
      artifacts: ["cockpit.tsx", "surfaces.md"],
    });
    // The Cap a human raised, and not the one the Mission opened with.
    expect(state.cap).toBe(AUTHORISED_CAP);
    expect(meterOf(state)).toEqual({
      cap: AUTHORISED_CAP,
      spent: addMoney(addMoney(SCOUT_COST, RESUBMISSION_COST), BUILDER_COST),
      perDelegation: [
        { delegationId: FIRST, spent: addMoney(SCOUT_COST, RESUBMISSION_COST) },
        { delegationId: SECOND, spent: BUILDER_COST },
      ],
      reached: false,
    });
  });

  it("answers both Delegations, and remembers what the human asked for", async () => {
    const { recording } = await driveTheMission();
    const state = stateOf(recording);

    if (!isOpened(state)) {
      throw new Error("the drive opens the Mission");
    }
    expect(state.delegations.map((made) => made.zordId)).toEqual([SCOUT, BUILDER]);
    expect(state.delegations.map((made) => made.handoff?.artifacts)).toEqual([
      ["surfaces.md", "panes.md"],
      ["cockpit.tsx", "cockpit.test.tsx"],
    ]);
    expect(revisionsIn(state.gates)).toEqual([
      "Ship the Cockpit shell first, the Pane grid next week",
    ]);
  });

  it("refuses the first Handoff with no human involved, and accepts the resubmission", async () => {
    const { recording } = await driveTheMission();
    const refused = refusedIn(stepsOf(recording));

    expect(refused).toHaveLength(1);
    const only = refused[0] as (typeof refused)[number];
    expect(only.command.kind).toBe("submit-handoff");
    expect(only.decision.refusal.reason).toBe("contract-violation");
    // Two violations from one Handoff: the required Clause it declared as a Gap, and the optional one it
    // said nothing at all about. The Refusal carries the list, so the Zord fixes both in one attempt.
    expect(only.decision.refusal.violations).toEqual([
      `Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required, so declaring ` +
        `it as a Gap does not excuse it: "ran out of time on the Pane grid"`,
      `Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was not ` +
        `declared as a Gap`,
    ]);
    // The Delegation it answered was settled afterwards, by the resubmission: a Refusal settles nothing.
    expect(eventsIn(stepsOf(recording), "handoff-accepted").map((event) => event.delegationId)).toEqual([
      FIRST,
      SECOND,
    ]);
  });

  it("stops at the Gate and at the Cap, and both times a human is what resumes it", async () => {
    const { recording } = await driveTheMission();
    const steps = stepsOf(recording);

    expect(eventsIn(steps, "mission-halted").map((event) => event.halt)).toEqual([
      { reason: "gate-open", gateId: GATE },
      { reason: "cap-reached" },
    ]);
    expect(eventsIn(steps, "gate-decided").map((event) => event.decision.kind)).toEqual([
      "revision-requested",
    ]);
    expect(eventsIn(steps, "cap-authorised").map((event) => event.cap)).toEqual([AUTHORISED_CAP]);
  });

  it("runs each Zord with the Harness the Replay says it ran", async () => {
    const { recording, runner } = await driveTheMission();
    const delegated = eventsIn(stepsOf(recording), "delegated");

    expect(delegated.map((event) => event.harness)).toEqual([
      { cli: "claude", model: "sonnet-4-5", effort: "medium", skills: [] },
      // Roster > invocation: the Effort is the Roster's, the model the invocation's.
      { cli: "claude", model: "opus-4-1", effort: "high", skills: [] },
    ]);
    // The port was handed the same bundles, in the same order — the scout twice, once per attempt.
    expect(runner.calls.map((call) => call.harness)).toEqual([
      delegated[0]?.harness,
      delegated[0]?.harness,
      delegated[1]?.harness,
    ]);
  });

  it("tells the Zord what it broke, and the next Zord what the human said", async () => {
    const { runner } = await driveTheMission();

    expect(runner.calls).toHaveLength(3);
    expect(runner.calls[0]?.instruction).not.toContain("The Core refused it");
    expect(runner.calls[1]?.instruction).toContain(
      `Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required`,
    );
    expect(runner.calls[2]?.instruction).toContain(
      "A human asked for: Ship the Cockpit shell first, the Pane grid next week",
    );
  });

  it("reads back as a Replay whose Steps are the whole story, in order", async () => {
    const { recording } = await driveTheMission();
    const steps = stepsOf(recording);

    expect(steps.map((step) => `${step.ordinal}. ${step.command.kind}`)).toEqual([
      "1. open-mission",
      "2. delegate",
      "3. accrue-cost",
      "4. submit-handoff",
      "5. accrue-cost",
      "6. submit-handoff",
      "7. raise-gate",
      "8. decide-gate",
      "9. delegate",
      "10. accrue-cost",
      "11. authorise-cap",
      "12. submit-handoff",
      "13. deliver-mission",
    ]);
    expect((steps[3] as Step).summary).toBe(
      `answering Delegation "delegation-1" with a Handoff was refused (contract-violation): ` +
        `Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required, so ` +
        `declaring it as a Gap does not excuse it: "ran out of time on the Pane grid"; ` +
        `Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was ` +
        `not declared as a Gap`,
    );
    expect((steps[9] as Step).summary).toBe(
      `accruing R$ 30,00 against Delegation "delegation-2" was accepted, ` +
        `and the Mission stopped because it reached its Cap`,
    );
  });

  it("folds its own log back to the Mission it drove", async () => {
    const { recording } = await driveTheMission();

    // Criterion 7's property, over a log a runner produced rather than one a test wrote by hand.
    expect(replay(eventsOf(recording))).toEqual(stateOf(recording));
  });

  it("drives the same Mission twice, identically", async () => {
    const one = await driveTheMission();
    const other = await driveTheMission();

    expect(eventsOf(other.recording)).toEqual(eventsOf(one.recording));
    expect(other.runner.calls).toEqual(one.runner.calls);
  });
});

describe("nothing in the run touches the world", () => {
  it("drives the whole Mission with the clock, the dice and fetch poisoned", async () => {
    const realNow = Date.now;
    const realParse = Date.parse;
    const realRandom = Math.random;
    const realFetch = globalThis.fetch;
    Date.now = (): number => {
      throw new Error("nothing in this run may read a clock");
    };
    Date.parse = (): number => {
      throw new Error("nothing in this run may parse time");
    };
    Math.random = (): number => {
      throw new Error("nothing in this run may randomise");
    };
    globalThis.fetch = (): Promise<Response> => {
      throw new Error("nothing in this run may reach the network");
    };

    try {
      const { recording } = await driveTheMission();
      expect(stateOf(recording).status).toBe("delivered");
    } finally {
      Date.now = realNow;
      Date.parse = realParse;
      Math.random = realRandom;
      globalThis.fetch = realFetch;
    }
  });

  it("imports nothing but itself, so there is no CLI to install and nothing to reach", () => {
    const engine = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(engine, { recursive: true, encoding: "utf8" }).filter(
      (entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"),
    );

    expect(sources.length).toBeGreaterThan(10);
    for (const source of sources) {
      const imported = [...readFileSync(`${engine}${source}`, "utf8").matchAll(/from "([^"]+)"/g)];
      // The structural half of "no network, no CLI": every import in the engine is a relative path
      // inside it. No `node:child_process`, no `node:fs`, no http client, no dependency at all — so
      // there is nothing to stub in the test above that could have been reached around it.
      expect(
        imported.map(([, specifier]) => specifier).filter((specifier) => !specifier?.startsWith(".")),
        source,
      ).toEqual([]);
    }
  });
});
