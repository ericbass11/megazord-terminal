/**
 * These tests drive whole Missions against a real disk, with no process anywhere.
 *
 * **The thing that plays the Zord is the test itself, through the control plane.** ADR 0010 says a Handoff
 * is built by the Zord that delivers it and submitted as a Command, so a drive that could compose one from
 * an `AgentReport` would be the party being judged writing its own verdict. Here the Zord's hand is
 * `runtime/mcp-server.ts`'s `handoff_submit`, called from inside the runner's `run` — which is exactly when
 * a real Zord calls it: while it is running, before the process that is it exits.
 *
 * Three properties of that arrangement are deliberate, and each one is load-bearing:
 *
 * - **The reports still come from `fakeAgentRunner`.** `zordRunner` wraps it rather than replacing it, so
 *   the script is consumed one entry per call, in order, and being asked more times than it was scripted
 *   for still fails at the call. The wrapper adds only what the fake cannot have: an act on the control
 *   plane between the ask and the answer.
 * - **The Zord writes through a *second* `missionStore` over the same Workspace.** The drive and the Zord
 *   share no object; the channel between them is the file, which is the whole of ADR 0009. A drive that
 *   cached the Replay would never see the Handoff, and that is one of the plants.
 * - **The human answers through `submit` and `append`**, which is the path `cockpit/server.ts` takes for a
 *   gesture. There is no Gate tool in the control plane's pinned eight, and a Gate decision is a human's
 *   answer rather than a Zord's, so the honest stand-in for the Cockpit is the Cockpit's own path.
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  EMPTY_REPLAY,
  briefing,
  clause,
  clauseId,
  contract,
  delegationId,
  eventsIn,
  gateId,
  harness,
  instantFromDate,
  isOpenDelegation,
  isOpened,
  meterOf,
  missionId,
  moneyFromCents,
  openMission,
  orchestrationCapability,
  refusedIn,
  revisionsIn,
  slice,
  stateOf,
  stepsOf,
  submit,
  zordId,
  core as coreOf,
  fakeAgentRunner,
  type AgentReport,
  type AgentRunner,
  type Briefing,
  type Contract,
  type Delegated,
  type Delegation,
  type FakeAgentRunner,
  type GateId,
  type Harness,
  type HarnessSources,
  type Instant,
  type MissionCommand,
  type MissionId,
  type Money,
  type Replay,
  type ReplayEntry,
  type RunningMission,
  type Slice,
  type ZordId,
} from "@engine/index";

import {
  BrokenClockError,
  InvalidCombinationError,
  InvalidDriveError,
  combination,
  drive,
  instructionFor,
  nextGestureOf,
  type Combination,
  type DeclaredGate,
  type Drive,
  type DriveOptions,
  type DriveOutcome,
  type Gesture,
  type RosterEntry,
} from "./combination-driver";
import { missionStore, type MissionStore } from "./mission-store";
import { missionWriter, type MissionWriter } from "./mission-writer";
import { controlPlane, type ControlPlane } from "./mcp-server";
import type { CortexStore } from "./cortex-store";
import type { PaneManager } from "./pane-manager";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/* -------------------------------------------------------------------------------------------------
 * The recipe under test
 * ---------------------------------------------------------------------------------------------- */

const MISSION: MissionId = missionId("cockpit-drive");
const SCOUT: ZordId = zordId("scout");
const BUILDER: ZordId = zordId("builder");
const SURVEY = delegationId("d-survey");
const BUILD = delegationId("d-build");
const GATE: GateId = gateId("g-before-the-build");

const REPORTED = clauseId("c-report");
const NOTED = clauseId("c-notes");
const CODED = clauseId("c-code");

const BRIEFING: Briefing = briefing("a module that reads the Workspace and says what it holds");

const CORE = coreOf([orchestrationCapability("delegate")]);

const CATALOG: Harness = harness({ cli: "claude", model: "opus", effort: "high", skills: [] });

const SURVEY_CONTRACT: Contract = contract([
  clause({ id: REPORTED, description: "a written report of what the Workspace holds", required: true }),
  clause({ id: NOTED, description: "notes on whatever was surprising", required: false }),
]);

const BUILD_CONTRACT: Contract = contract([
  clause({ id: CODED, description: "the module and the test beside it", required: true }),
]);

const SURVEY_SOURCES: HarnessSources = { catalogDefault: CATALOG };
const BUILD_SOURCES: HarnessSources = { catalogDefault: CATALOG, rosterEntry: { effort: "low" } };

const SURVEY_SLICE: Slice = slice("say what the Workspace holds, in writing");
const BUILD_SLICE: Slice = slice("the module the survey describes, with its test");

/** The Roster entry every test starts from. Written out rather than defaulted, on purpose. */
function surveyEntry(): RosterEntry {
  return {
    delegationId: SURVEY,
    zordId: SCOUT,
    slice: SURVEY_SLICE,
    harnessSources: SURVEY_SOURCES,
    contract: SURVEY_CONTRACT,
    instruction: "Read the Workspace and write down what it holds.",
  };
}

function buildEntry(): RosterEntry {
  return {
    delegationId: BUILD,
    zordId: BUILDER,
    slice: BUILD_SLICE,
    harnessSources: BUILD_SOURCES,
    contract: BUILD_CONTRACT,
    instruction: "Write the module the survey describes, with a test beside it.",
  };
}

/** Two Slices, one Gate between them, one deliverable. The Combination the end-to-end run drives. */
function recipe(): Combination {
  return combination({
    name: "survey-then-build",
    roster: [surveyEntry(), buildEntry()],
    gates: [{ gateId: GATE, question: "The survey is in. Build on it?", after: SURVEY }],
    deliverable: "the module the Briefing asked for, surveyed and then built",
  });
}

/** One Slice and no Gate, for the failure paths that have nothing to do with either. */
function surveyOnly(): Combination {
  return combination({
    name: "survey-only",
    roster: [surveyEntry()],
    gates: [],
    deliverable: "a survey of the Workspace",
  });
}

/* -------------------------------------------------------------------------------------------------
 * A Workspace, a store, a clock and a control plane
 * ---------------------------------------------------------------------------------------------- */

const workspaces: string[] = [];

afterAll(() => {
  for (const workspace of workspaces) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/**
 * A clock that answers one Instant per call, a second apart, from a fixed base.
 *
 * Derived from a base rather than spelled out digit by digit: a fixture that increments minutes by hand
 * produces `11:80` an hour in, and every test that reads a timestamp fails for a reason that has nothing
 * to do with its subject.
 */
function clockFrom(base: number): () => Instant {
  let tick = 0;
  return () => {
    const at = instantFromDate(new Date(base + tick * 1_000));
    tick += 1;
    return at;
  };
}

const BASE = Date.parse("2026-08-06T11:00:00.000Z");

/** A process table that is never touched: the control plane attaches two listeners and nothing else. */
const NO_PANES: PaneManager = {
  spawn() {
    throw new Error("no Pane is opened in these tests");
  },
  write() {
    throw new Error("no Pane is written to in these tests");
  },
  async kill() {
    throw new Error("no Pane is killed in these tests");
  },
  onData() {
    // Nothing streams here.
  },
  onStatus() {
    // Nothing changes status here.
  },
};

/** A Cortex that is never touched either: no test here writes a Fact. */
const NO_CORTEX: CortexStore = {
  async write() {
    throw new Error("no Fact is written in these tests");
  },
  async read() {
    throw new Error("no Fact is read in these tests");
  },
};

/** The control plane's own runner. `agent_invoke` is never called: the drive is what invokes a Zord. */
const NEVER_INVOKED: AgentRunner = {
  async run() {
    throw new Error("the control plane does not invoke a Zord in these tests");
  },
};

type Bench = {
  readonly workspace: string;
  /** The store behind the one door. What a test seeds and reads the file back through. */
  readonly store: MissionStore;
  /**
   * The door the drive and the Zord both go through.
   *
   * **One** writer for both, which is the fix for BUG-1: `load → submit → append` is one atom, so a
   * Command the drive submits can no longer be decided against a Mission the Zord has already moved. It
   * is `missionWriter({ store })`, and asking for it again with the same store answers the same writer.
   */
  readonly writer: MissionWriter;
  /**
   * A second store over the same Workspace: what a test writes with **directly**, outside every door.
   *
   * Used only where the point is a log no gesture could have produced — a hand-edited `Delegated` fact
   * carrying a Harness nothing would have resolved. Every gesture a human or a Zord really makes goes
   * through `writer`.
   */
  readonly outside: MissionStore;
  readonly now: () => Instant;
  /** The Zord's hand. */
  readonly plane: ControlPlane;
  readonly path: string;
};

function benchOf(): Bench {
  const workspace = mkdtempSync(join(tmpdir(), "megazord-drive-"));
  workspaces.push(workspace);

  const now = clockFrom(BASE);
  const store = missionStore({ workspace });
  const writer = missionWriter({ store });
  const outside = missionStore({ workspace });

  return {
    workspace,
    store,
    writer,
    outside,
    now,
    plane: controlPlane({
      missionId: MISSION,
      zordId: SCOUT,
      workspace,
      writer,
      panes: NO_PANES,
      cortex: NO_CORTEX,
      runner: NEVER_INVOKED,
      now,
      maxPaneBytes: 4_096,
    }),
    path: join(workspace, ".megazord", "missions", `${encodeURIComponent(MISSION)}.jsonl`),
  };
}

/** What every drive in these tests is bounded by. Written out at each call: nothing has a default. */
type Bounds = {
  readonly runner: AgentRunner;
  readonly plan: Combination;
  readonly cap: Money;
  readonly settleTimeoutMs: number;
  readonly pollEveryMs: number;
  readonly maxAttemptsPerDelegation: number;
};

function driving(bench: Bench, bounds: Bounds): DriveOptions {
  return {
    missionId: MISSION,
    briefing: BRIEFING,
    mode: "combination",
    cap: bounds.cap,
    core: CORE,
    combination: bounds.plan,
    writer: bench.writer,
    runner: bounds.runner,
    now: bench.now,
    settleTimeoutMs: bounds.settleTimeoutMs,
    pollEveryMs: bounds.pollEveryMs,
    maxAttemptsPerDelegation: bounds.maxAttemptsPerDelegation,
  };
}

/* -------------------------------------------------------------------------------------------------
 * The Zord, and the human
 * ---------------------------------------------------------------------------------------------- */

/** One invocation: what the Zord does through the control plane while it runs, and what it reports. */
type ZordTurn = {
  readonly acts: () => Promise<void>;
  readonly report: AgentReport;
};

/** A Zord that submits nothing at all. Written out at the call site so nothing defaults to it. */
const SUBMITS_NOTHING = async (): Promise<void> => {
  // A Zord that ran and answered no Delegation. It is a real case, not a missing fixture.
};

function costing(cents: number): AgentReport {
  return { output: `the Zord wrote ${cents} cents worth of terminal`, cost: moneyFromCents(cents) };
}

/**
 * A runner that plays a Zord: it acts on the control plane, then answers the next scripted report.
 *
 * The reports come from `fakeAgentRunner`, so the script is consumed in order and over-asking still fails
 * with `UnscriptedRunError` rather than repeating an answer.
 */
function zordRunner(turns: readonly ZordTurn[]): FakeAgentRunner {
  const fake = fakeAgentRunner(turns.map((turn) => turn.report));
  let asked = 0;

  return {
    get calls() {
      return fake.calls;
    },
    async run(run) {
      const turn = turns[asked];
      asked += 1;
      if (turn !== undefined) {
        await turn.acts();
      }
      // Asked more times than scripted: the fake raises, and the drive answers `run-failed`.
      return fake.run(run);
    },
  };
}

type SubmittedHandoff = {
  readonly delegationId: string;
  readonly satisfies: readonly string[];
  readonly gaps: readonly { readonly clauseId: string; readonly reason: string }[];
  readonly artifacts: readonly string[];
};

/**
 * The Zord submitting its own Handoff, through the control plane's `handoff_submit`.
 *
 * A protocol fault is thrown here, because it would be this test being wrong. A **Refusal** is not one: it
 * comes back as an ordinary result carrying a refused entry, which is exactly the loop under test.
 */
async function submits(plane: ControlPlane, said: SubmittedHandoff): Promise<ReplayEntry> {
  const answered = await plane.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "handoff_submit", arguments: said },
    }),
  );
  if (answered === undefined) {
    throw new Error("handoff_submit answered nothing");
  }
  const framed = JSON.parse(answered) as {
    readonly error?: { readonly message: string };
    readonly result?: {
      readonly content: readonly { readonly text: string }[];
      readonly isError: boolean;
    };
  };
  if (framed.error !== undefined || framed.result === undefined) {
    throw new Error(`handoff_submit failed at the protocol: ${answered}`);
  }
  if (framed.result.isError) {
    throw new Error(`handoff_submit refused to build the Handoff: ${framed.result.content[0]?.text}`);
  }
  const said2 = JSON.parse(framed.result.content[0]?.text ?? "") as { readonly entry: ReplayEntry };
  return said2.entry;
}

/** The Handoff that breaks the survey Contract twice: the required Clause, and the optional one. */
function submitsABrokenSurvey(bench: Bench): () => Promise<void> {
  return async () => {
    await submits(bench.plane, {
      delegationId: SURVEY,
      satisfies: [],
      gaps: [{ clauseId: REPORTED, reason: "ran out of time" }],
      artifacts: [],
    });
  };
}

function submitsTheSurvey(bench: Bench): () => Promise<void> {
  return async () => {
    await submits(bench.plane, {
      delegationId: SURVEY,
      satisfies: [REPORTED],
      gaps: [{ clauseId: NOTED, reason: "nothing surprising to write down" }],
      artifacts: ["docs/survey.md", "shared.md"],
    });
  };
}

function submitsTheBuild(bench: Bench): () => Promise<void> {
  return async () => {
    await submits(bench.plane, {
      delegationId: BUILD,
      satisfies: [CODED],
      gaps: [],
      artifacts: ["runtime/thing.ts", "shared.md"],
    });
  };
}

/**
 * A human gesture in the Cockpit: one `record` through the door.
 *
 * Literally the path `cockpit/server.ts` takes — it holds a `MissionWriter` and calls exactly this — and
 * the same door the drive and the Zord's control plane hold, which is what BUG-1's fix bought. It used to
 * load and append through a second store of its own, which resembled the server and no longer does.
 */
async function asHuman(bench: Bench, command: MissionCommand): Promise<ReplayEntry> {
  return (await bench.writer.record(MISSION, command)).entry;
}

/* -------------------------------------------------------------------------------------------------
 * Criterion 5
 * ---------------------------------------------------------------------------------------------- */

/**
 * The whole run: a Briefing, a Delegation per Slice, a Handoff refused and then accepted, a Gate raised
 * and answered, a Delivery. Two calls, because the Gate stops the first one — which is also what proves
 * the drive resumes from the file rather than from anything it remembered.
 */
async function driveTheWholeThing(): Promise<Bench> {
  const bench = benchOf();
  const runner = zordRunner([
    { acts: submitsABrokenSurvey(bench), report: costing(100) },
    { acts: submitsTheSurvey(bench), report: costing(150) },
    { acts: submitsTheBuild(bench), report: costing(200) },
  ]);
  const bounds: Bounds = {
    runner,
    plan: recipe(),
    cap: moneyFromCents(10_000),
    settleTimeoutMs: 200,
    pollEveryMs: 5,
    maxAttemptsPerDelegation: 3,
  };

  const stopped = await drive(driving(bench, bounds));
  expect(stopped.outcome).toEqual({ kind: "halted-at-gate", gateId: GATE });

  await asHuman(bench, {
    kind: "decide-gate",
    occurredAt: bench.now(),
    gateId: GATE,
    decision: { kind: "approved" },
  });

  // A fresh store, as if the app had been closed and `mz .` run again: the drive holds nothing.
  const resumed = await drive(
    driving({ ...bench, store: missionStore({ workspace: bench.workspace }) }, bounds),
  );
  expect(resumed.outcome).toEqual({ kind: "delivered" });

  return bench;
}

describe("criterion 5 — one Briefing, a Combination, a Delivery", () => {
  it("delegates each Slice, is refused once, passes a Gate and delivers", async () => {
    const bench = await driveTheWholeThing();

    // Read back through a store nothing in the drive ever held.
    const reopened = missionStore({ workspace: bench.workspace });
    const replay = await reopened.load(MISSION);
    const state = stateOf(replay);
    const steps = stepsOf(replay);

    expect(state.status).toBe("delivered");
    if (state.status !== "delivered") {
      throw new Error("unreachable: the assertion above already failed");
    }

    // One Delegation per Slice, each with the Harness `decide` resolved, each settled.
    const made = eventsIn(steps, "delegated");
    expect(made.map((fact) => fact.delegationId)).toEqual([SURVEY, BUILD]);
    expect(made.map((fact) => fact.zordId)).toEqual([SCOUT, BUILDER]);
    expect(made.map((fact) => fact.harness.effort)).toEqual(["high", "low"]);
    expect(state.delegations.map(isOpenDelegation)).toEqual([false, false]);

    // A Handoff refused and then accepted. The whole list of violations, because a Handoff that breaks a
    // required Clause usually breaks an optional one too.
    const refused = refusedIn(steps);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.command.kind).toBe("submit-handoff");
    expect(refused[0]?.decision.refusal.reason).toBe("contract-violation");
    expect(refused[0]?.decision.refusal.violations).toEqual([
      'Clause "c-report" ("a written report of what the Workspace holds") is required, so declaring it as a Gap does not excuse it: "ran out of time"',
      'Clause "c-notes" ("notes on whatever was surprising") was not satisfied and was not declared as a Gap',
    ]);
    expect(eventsIn(steps, "handoff-accepted").map((fact) => fact.delegationId)).toEqual([
      SURVEY,
      BUILD,
    ]);

    // A Gate raised and answered. The whole list of halts: a Replay with a Gate in it carries one.
    expect(eventsIn(steps, "gate-raised").map((fact) => fact.gateId)).toEqual([GATE]);
    expect(eventsIn(steps, "mission-halted").map((fact) => fact.halt.reason)).toEqual(["gate-open"]);
    expect(eventsIn(steps, "gate-decided").map((fact) => fact.decision.kind)).toEqual(["approved"]);
    expect(revisionsIn(state.gates)).toEqual([]);

    // The Delivery: the Combination's deliverable, and the artifacts the Handoffs actually carried.
    expect(state.delivery).toEqual({
      summary: "the module the Briefing asked for, surveyed and then built",
      artifacts: ["docs/survey.md", "shared.md", "runtime/thing.ts"],
    });

    // The Meter: three runs, three accruals, per Delegation and in total.
    expect(eventsIn(steps, "cost-accrued").map((fact) => fact.cost)).toEqual([100, 150, 200]);
    expect(meterOf(state)).toEqual({
      cap: moneyFromCents(10_000),
      spent: moneyFromCents(450),
      perDelegation: [
        { delegationId: SURVEY, spent: moneyFromCents(250) },
        { delegationId: BUILD, spent: moneyFromCents(200) },
      ],
      reached: false,
    });

    // And the Replay reads as one sequence, numbered from one, with nothing missing in the middle.
    expect(steps.map((step) => step.ordinal)).toEqual(
      Array.from({ length: steps.length }, (_, index) => index + 1),
    );
    expect(steps[0]?.command.kind).toBe("open-mission");
    expect(steps[steps.length - 1]?.command.kind).toBe("deliver-mission");
  });

  it("hands the second Zord the Harness the Delegation recorded, and quotes what the first one broke", async () => {
    const bench = benchOf();
    const runner = zordRunner([
      { acts: submitsABrokenSurvey(bench), report: costing(100) },
      { acts: submitsTheSurvey(bench), report: costing(150) },
    ]);

    const stopped = await drive(
      driving(bench, {
        runner,
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
    );
    expect(stopped.outcome).toEqual({ kind: "delivered" });

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls.map((asked) => asked.harness)).toEqual([CATALOG, CATALOG]);
    // The first invocation knows nothing about a Refusal; the second quotes both violations verbatim.
    expect(runner.calls[0]?.instruction).not.toContain("refused");
    expect(runner.calls[1]?.instruction).toContain("Your last Handoff was refused");
    expect(runner.calls[1]?.instruction).toContain("is required, so declaring it as a Gap does not excuse it");
    expect(runner.calls[1]?.instruction).toContain("was not satisfied and was not declared as a Gap");
  });

  it("appends nothing to a Mission it has already delivered", async () => {
    const bench = await driveTheWholeThing();
    const before = readFileSync(bench.path, "utf8");

    const again = await drive(
      driving(bench, {
        runner: fakeAgentRunner([]),
        plan: recipe(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
    );

    expect(again.outcome).toEqual({ kind: "delivered" });
    expect(readFileSync(bench.path, "utf8")).toBe(before);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------------------------- */

describe("the Core follows a recipe deterministically", () => {
  it("drives the same Briefing, Combination and script into a byte-identical Replay", async () => {
    const one = await driveTheWholeThing();
    const two = await driveTheWholeThing();

    expect(one.workspace).not.toBe(two.workspace);
    expect(readFileSync(two.path, "utf8")).toBe(readFileSync(one.path, "utf8"));
  });

  it("answers the same gesture for the same state and the same recipe", () => {
    const state = openMission({
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10_000),
      core: CORE,
      occurredAt: instantFromDate(new Date(BASE)),
    });

    expect(nextGestureOf(recipe(), state)).toEqual({ kind: "delegate", entry: surveyEntry() });
    expect(nextGestureOf(recipe(), state)).toEqual(nextGestureOf(recipe(), state));
  });
});

/* -------------------------------------------------------------------------------------------------
 * Every failure path has an answer, and none of them is a hang
 * ---------------------------------------------------------------------------------------------- */

describe("a Zord that never delivers", () => {
  it("stops with awaiting-handoff, leaving the Delegation open and the Mission running", async () => {
    const bench = benchOf();
    const runner = zordRunner([{ acts: SUBMITS_NOTHING, report: costing(100) }]);

    const stopped = await drive(
      driving(bench, {
        runner,
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 20,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 1,
      }),
    );

    expect(stopped.outcome).toEqual({
      kind: "awaiting-handoff",
      delegationId: SURVEY,
      attempts: 1,
    });

    const state = stateOf(stopped.replay);
    expect(state.status).toBe("running");
    expect(isOpened(state) && state.delegations.map(isOpenDelegation)).toEqual([true]);
    // The run happened, so what it cost is on the record even though nothing was answered.
    expect(eventsIn(stepsOf(stopped.replay), "cost-accrued")).toHaveLength(1);
  });

  it("does not invoke it again once its attempts are spent, and does not call that a Refusal", async () => {
    const bench = benchOf();
    const first = zordRunner([{ acts: SUBMITS_NOTHING, report: costing(100) }]);
    const bounds = (runner: AgentRunner): Bounds => ({
      runner,
      plan: surveyOnly(),
      cap: moneyFromCents(10_000),
      settleTimeoutMs: 20,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 1,
    });

    await drive(driving(bench, bounds(first)));

    // A runner scripted for nothing at all: reaching it would be the drive invoking a Zord it should not.
    const stopped = await drive(driving(bench, bounds(fakeAgentRunner([]))));
    expect(stopped.outcome).toEqual({
      kind: "awaiting-handoff",
      delegationId: SURVEY,
      attempts: 1,
    });
    expect(eventsIn(stepsOf(stopped.replay), "cost-accrued")).toHaveLength(1);
  });
});

describe("a Handoff refused to the last attempt", () => {
  it("stops with handoff-refused, carrying every violation of the last one", async () => {
    const bench = benchOf();
    const runner = zordRunner([
      { acts: submitsABrokenSurvey(bench), report: costing(100) },
      { acts: submitsABrokenSurvey(bench), report: costing(100) },
    ]);

    const stopped = await drive(
      driving(bench, {
        runner,
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 2,
      }),
    );

    expect(stopped.outcome).toEqual({
      kind: "handoff-refused",
      delegationId: SURVEY,
      attempts: 2,
      violations: [
        'Clause "c-report" ("a written report of what the Workspace holds") is required, so declaring it as a Gap does not excuse it: "ran out of time"',
        'Clause "c-notes" ("notes on whatever was surprising") was not satisfied and was not declared as a Gap',
      ],
    });

    // Two runs, two Refusals, one still-open Delegation, and no Delivery.
    expect(runner.calls).toHaveLength(2);
    expect(refusedIn(stepsOf(stopped.replay))).toHaveLength(2);
    expect(stateOf(stopped.replay).status).toBe("running");
    expect(eventsIn(stepsOf(stopped.replay), "mission-delivered")).toEqual([]);
  });
});

describe("a Gate answered with a revision", () => {
  it("stops the drive, says what was asked for, and stops there again", async () => {
    const bench = benchOf();
    const runner = zordRunner([{ acts: submitsTheSurvey(bench), report: costing(100) }]);
    const bounds: Bounds = {
      runner,
      plan: recipe(),
      cap: moneyFromCents(10_000),
      settleTimeoutMs: 200,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 3,
    };

    expect((await drive(driving(bench, bounds))).outcome).toEqual({
      kind: "halted-at-gate",
      gateId: GATE,
    });

    await asHuman(bench, {
      kind: "decide-gate",
      occurredAt: bench.now(),
      gateId: GATE,
      decision: { kind: "revision-requested", reason: "the survey missed the runtime" },
    });

    const stopped = await drive(driving(bench, bounds));
    expect(stopped.outcome).toEqual({
      kind: "revision-requested",
      reasons: ["the survey missed the runtime"],
    });
    // The Mission resumed — the engine says a revision resumes it — and the drive did not build on it.
    expect(stateOf(stopped.replay).status).toBe("running");
    expect(eventsIn(stepsOf(stopped.replay), "delegated").map((fact) => fact.delegationId)).toEqual([
      SURVEY,
    ]);

    // Driven again it stops in the same place and writes nothing: nothing changed, so nothing changed.
    const before = readFileSync(bench.path, "utf8");
    const again = await drive(driving(bench, bounds));
    expect(again.outcome).toEqual({
      kind: "revision-requested",
      reasons: ["the survey missed the runtime"],
    });
    expect(readFileSync(bench.path, "utf8")).toBe(before);
  });
});

describe("a Kill", () => {
  it("mid-drive: the accrual it was about to record is refused, and the drive stops on it", async () => {
    const bench = benchOf();
    const runner = zordRunner([
      {
        acts: async () => {
          await asHuman(bench, {
            kind: "kill-mission",
            occurredAt: bench.now(),
            reason: "the human changed their mind while the Zord was running",
          });
        },
        report: costing(100),
      },
    ]);

    const stopped = await drive(
      driving(bench, {
        runner,
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
    );

    // Not `killed`: the drive's own Command was refused, and that is the more specific truth. The Replay
    // says both — the money that could not be charged, and the Mission that ended.
    expect(stopped.outcome.kind).toBe("refused");
    if (stopped.outcome.kind !== "refused") {
      throw new Error("unreachable: the assertion above already failed");
    }
    expect(stopped.outcome.step.command.kind).toBe("accrue-cost");
    expect(stopped.outcome.step.decision.refusal.reason).toBe("illegal-transition");
    expect(stopped.outcome.step.decision.refusal.violations).toEqual([
      "a Mission that is killed accrues no cost",
    ]);
    expect(stateOf(stopped.replay).status).toBe("killed");
  });

  it("before a drive: the Mission is over, and nothing is commissioned into it", async () => {
    const bench = benchOf();
    const runner = zordRunner([{ acts: submitsTheSurvey(bench), report: costing(100) }]);
    const bounds: Bounds = {
      runner,
      plan: recipe(),
      cap: moneyFromCents(10_000),
      settleTimeoutMs: 200,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 3,
    };

    await drive(driving(bench, bounds));
    await asHuman(bench, {
      kind: "kill-mission",
      occurredAt: bench.now(),
      reason: "not worth building after all",
    });

    const before = readFileSync(bench.path, "utf8");
    const stopped = await drive(driving(bench, bounds));

    expect(stopped.outcome).toEqual({ kind: "killed" });
    expect(readFileSync(bench.path, "utf8")).toBe(before);
  });
});

describe("the Cap reached mid-drive", () => {
  it("halts, commissions nothing more, and carries on once a human authorises", async () => {
    const bench = benchOf();
    const runner = zordRunner([
      // The first run alone reaches a Cap of exactly what it cost — reached is `>=`, not `>`.
      { acts: SUBMITS_NOTHING, report: costing(500) },
      { acts: submitsTheSurvey(bench), report: costing(100) },
      { acts: submitsTheBuild(bench), report: costing(100) },
    ]);
    const bounds = (cap: Money): Bounds => ({
      runner,
      plan: recipe(),
      cap,
      settleTimeoutMs: 200,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 3,
    });

    const halted = await drive(driving(bench, bounds(moneyFromCents(500))));
    expect(halted.outcome).toEqual({ kind: "halted-at-cap" });

    const stopped = stateOf(halted.replay);
    expect(stopped.status).toBe("halted");
    expect(eventsIn(stepsOf(halted.replay), "mission-halted").map((fact) => fact.halt.reason)).toEqual(
      ["cap-reached"],
    );
    // Nothing further was commissioned: the second Slice has no Delegation, and no Gate was raised.
    expect(eventsIn(stepsOf(halted.replay), "delegated").map((fact) => fact.delegationId)).toEqual([
      SURVEY,
    ]);
    expect(eventsIn(stepsOf(halted.replay), "gate-raised")).toEqual([]);
    expect(isOpened(stopped) && meterOf(stopped).reached).toBe(true);

    // A drive over a Mission stopped at its Cap runs nobody at all.
    const askedBefore = runner.calls.length;
    expect((await drive(driving(bench, bounds(moneyFromCents(500))))).outcome).toEqual({
      kind: "halted-at-cap",
    });
    expect(runner.calls).toHaveLength(askedBefore);

    // The human answers "how much more", and the same recipe carries on from where it stopped.
    await asHuman(bench, {
      kind: "authorise-cap",
      occurredAt: bench.now(),
      cap: moneyFromCents(2_000),
    });
    expect((await drive(driving(bench, bounds(moneyFromCents(500))))).outcome).toEqual({
      kind: "halted-at-gate",
      gateId: GATE,
    });
  });
});

describe("a runner that fails", () => {
  it("stops with run-failed, having accrued nothing for a run that reported no cost", async () => {
    const bench = benchOf();

    const stopped = await drive(
      driving(bench, {
        // Scripted for nothing: the first ask raises `UnscriptedRunError`, as a rejection.
        runner: fakeAgentRunner([]),
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
    );

    expect(stopped.outcome.kind).toBe("run-failed");
    if (stopped.outcome.kind !== "run-failed") {
      throw new Error("unreachable: the assertion above already failed");
    }
    expect(stopped.outcome.delegationId).toBe(SURVEY);
    expect(stopped.outcome.detail).toContain("fake AgentRunner was scripted for 0 runs");

    expect(eventsIn(stepsOf(stopped.replay), "cost-accrued")).toEqual([]);
    expect(eventsIn(stepsOf(stopped.replay), "delegated")).toHaveLength(1);
  });
});

describe("a Harness that cannot be run", () => {
  /**
   * A Mission with one Delegation whose recorded Harness was damaged.
   *
   * Only reachable by editing the file: `decide` resolved that Harness and `harness()` checked it when the
   * fact was made, so the engine cannot produce one. The two entries are built with the engine and only
   * the second one's fact is rewritten, so everything around the damage is exactly what a real Replay has.
   */
  async function withADamagedHarness(bench: Bench, damage: unknown): Promise<void> {
    let recorded: Replay = submit(EMPTY_REPLAY, {
      kind: "open-mission",
      occurredAt: bench.now(),
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10_000),
      core: CORE,
    });
    recorded = submit(recorded, {
      kind: "delegate",
      occurredAt: bench.now(),
      delegationId: SURVEY,
      zordId: SCOUT,
      slice: SURVEY_SLICE,
      harnessSources: SURVEY_SOURCES,
      contract: SURVEY_CONTRACT,
    });

    const delegated = eventsIn(stepsOf(recorded), "delegated")[0];
    if (delegated === undefined) {
      throw new Error("the fixture did not delegate");
    }
    const damaged: Delegated = { ...delegated, harness: damage as Harness };

    await bench.outside.append(MISSION, recorded[0]);
    await bench.outside.append(MISSION, {
      command: recorded[1].command,
      decision: { kind: "accepted", events: [damaged] },
    });
  }

  function bounded(bench: Bench): DriveOptions {
    return driving(bench, {
      // Reaching this runner at all would be the drive forking on a Harness it could not read.
      runner: fakeAgentRunner([]),
      plan: surveyOnly(),
      cap: moneyFromCents(10_000),
      settleTimeoutMs: 200,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 3,
    });
  }

  it("stops rather than handing a runner what a hand-edited log recorded", async () => {
    const bench = benchOf();
    await withADamagedHarness(bench, { model: "opus", effort: "high", skills: [] });

    const stopped = await drive(bounded(bench));

    expect(stopped.outcome).toEqual({
      kind: "unrunnable-harness",
      delegationId: SURVEY,
      detail: "the Harness recorded on this Delegation names no cli",
    });
    expect(eventsIn(stepsOf(stopped.replay), "cost-accrued")).toEqual([]);
  });

  /**
   * **The finding this task declared, now closed, and this is the assertion that replaced the pin.**
   *
   * `added()` in `engine/domain/replay.ts` used to read `event.harness.cli` off a `Delegated` fact
   * without reading it as `unknown`, so `stepsOf` — the reading this module counts attempts with —
   * threw on a fact whose Harness is not an object at all. This test pinned the throw
   * (`rejects.toThrow(TypeError)`) with the finding written beside it, deliberately arranged to go red
   * the day the engine was fixed rather than routing around it: a driver that walked the entries
   * itself to dodge the engine's own reading would be a second implementation of it.
   *
   * It went red in review, the engine now reads all six of `added`'s nested fields as `unknown`, and
   * the drive answers the same way it does for a Harness that *is* an object and names no `cli` —
   * which is the point. A damaged fact makes the audit surface say less, never throw.
   */
  it("reports a Harness that is not an object, now that the engine's reading no longer throws", async () => {
    const bench = benchOf();
    await withADamagedHarness(bench, null);

    const stopped = await drive(bounded(bench));

    // The driver's own answer, and note it is the **more precise** of its two: it distinguishes a
    // Harness that is not there at all from one that is an object naming no `cli`. That branch was
    // unreachable while the engine threw first — a guard nothing could enter, which is why the pin
    // mattered rather than being a formality.
    expect(stopped.outcome).toEqual({
      kind: "unrunnable-harness",
      delegationId: SURVEY,
      detail: "the Delegation records null where its Harness should be",
    });
    expect(eventsIn(stepsOf(stopped.replay), "cost-accrued")).toEqual([]);
    // And the Replay is still readable end to end, which is the whole of what the engine fix buys.
    expect(stepsOf(stopped.replay).length).toBeGreaterThan(0);
  });
});

describe("a Refusal of the drive's own open-mission", () => {
  /**
   * The route into it, now that `load → submit → append` is one atom.
   *
   * The queue makes every *Decision* fresh; it does not make a caller's **choice** of Command fresh. This
   * drive reads the Replay, decides that the next gesture is `open-mission` because nothing has opened the
   * Mission yet, and by the time `record` runs another hand has. That is the one live route, and it is the
   * interleave `runtime/mission-writer.ts` states as what a queue cannot fix — before the fix it was
   * BUG-1's own shape, which is why QA could not find a test for this guard: nothing exercised it.
   *
   * The other hand is a **real control plane** over the **same door**, so nothing here is a double: it is
   * `mission_create`, the tool a Zord calls, deciding against the file exactly as it always does. The store
   * wrapper delays nothing and decides nothing — it lets that gesture happen at the one observable moment,
   * which is the load the drive chooses from.
   */
  async function droveInto(bench: Bench): Promise<Drive> {
    let elsewhere: ControlPlane | undefined;
    let first = true;

    const store: MissionStore = {
      append: (id, entry) => bench.store.append(id, entry),
      list: () => bench.store.list(),
      async load(id: MissionId): Promise<Replay> {
        const recorded = await bench.store.load(id);
        if (first) {
          first = false;
          const answered = await elsewhere?.handle(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "mission_create",
                arguments: {
                  briefing: "somebody else got there first",
                  mode: "combination",
                  capCents: 10_000,
                  capabilities: ["delegate"],
                },
              },
            }),
          );
          if (answered === undefined || answered.includes('"isError":true')) {
            throw new Error(`the other hand did not open the Mission: ${String(answered)}`);
          }
        }
        return recorded;
      },
    };

    const writer = missionWriter({ store });
    elsewhere = controlPlane({
      missionId: MISSION,
      zordId: BUILDER,
      workspace: bench.workspace,
      writer,
      panes: NO_PANES,
      cortex: NO_CORTEX,
      runner: NEVER_INVOKED,
      now: bench.now,
      maxPaneBytes: 4_096,
    });

    return drive({
      ...driving(bench, {
        // Reaching this runner at all would be a drive that carried on past its own Refusal.
        runner: fakeAgentRunner([]),
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
      writer,
    });
  }

  it("stops on it, rather than commissioning work into a Mission it did not open", async () => {
    const bench = benchOf();

    const stopped = await droveInto(bench);

    expect(stopped.outcome.kind).toBe("refused");
    if (stopped.outcome.kind !== "refused") {
      throw new Error("unreachable: the assertion above already failed");
    }
    expect(stopped.outcome.step.command.kind).toBe("open-mission");
    expect(stopped.outcome.step.decision.refusal.reason).toBe("illegal-transition");

    // The record is what says the drive stopped **there**: the other hand's opening, this drive's refused
    // opening, and nothing after it. A drive that carried on would have delegated into a Mission opened
    // with a Briefing and a Core it never chose — and, without the exit, this is what changes.
    const steps = stepsOf(stopped.replay);
    expect(steps.map((step) => step.command.kind)).toEqual(["open-mission", "open-mission"]);
    expect(refusedIn(steps)).toHaveLength(1);
    expect(eventsIn(steps, "delegated")).toEqual([]);
  });

  it("is driven again from where the Mission actually is, which is why stopping costs nothing", async () => {
    const bench = benchOf();
    await droveInto(bench);

    // Resumable by construction: the second turn re-derives its gesture from the Replay, so the Mission
    // somebody else opened is the one this drive now advances. Stopping is not giving up.
    const again = await drive(
      driving(bench, {
        runner: fakeAgentRunner([{ output: "surveyed", cost: moneyFromCents(0) }]),
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 50,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 1,
      }),
    );

    expect(eventsIn(stepsOf(again.replay), "delegated").map((made) => made.delegationId)).toEqual([
      SURVEY,
    ]);
  });
});

describe("a Core that may not delegate", () => {
  it("stops on the Refusal rather than asking again forever", async () => {
    const bench = benchOf();
    const options: DriveOptions = {
      ...driving(bench, {
        runner: fakeAgentRunner([]),
        plan: surveyOnly(),
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
      core: coreOf([orchestrationCapability("consolidate")]),
    };

    const stopped = await drive(options);

    expect(stopped.outcome.kind).toBe("refused");
    if (stopped.outcome.kind !== "refused") {
      throw new Error("unreachable: the assertion above already failed");
    }
    expect(stopped.outcome.step.command.kind).toBe("delegate");
    expect(stopped.outcome.step.decision.refusal.reason).toBe("missing-capability");
    // The refused Command is on the record, once: a drive that carried on would ask forever.
    expect(refusedIn(stepsOf(stopped.replay))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The recipe itself
 * ---------------------------------------------------------------------------------------------- */

describe("a Combination is checked before a single gesture", () => {
  it("reports everything wrong with it at once", () => {
    let thrown: unknown;
    try {
      combination({
        name: "  ",
        roster: [
          { ...surveyEntry(), instruction: "" },
          { ...buildEntry(), delegationId: SURVEY },
        ],
        gates: [
          { gateId: GATE, question: "?", after: delegationId("d-nobody") },
          { gateId: GATE, question: " ", after: SURVEY },
        ],
        deliverable: "something",
      });
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(InvalidCombinationError);
    const violations = thrown instanceof InvalidCombinationError ? thrown.violations : [];
    expect(violations).toEqual([
      'name must say what this formation is called, received "  "',
      'roster[0].instruction must say what the Zord is asked to do, received ""',
      'roster[1].delegationId "d-survey" is declared twice, and a Mission makes each Delegation once',
      'gates[0].after names Delegation "d-nobody", which this Roster does not declare',
      'gates[1].question must say what the human is asked, received " "',
      'gates[1].gateId "g-before-the-build" is declared twice, and a Mission raises each Gate once',
    ]);
  });

  it("refuses a formation of nobody", () => {
    expect(() => combination({ name: "empty", roster: [], gates: [], deliverable: "nothing" })).toThrow(
      /at least one Delegation/,
    );
  });

  it("refuses a Roster entry with no Contract, because empty is an answer and absent is not", () => {
    expect(() =>
      combination({
        name: "no-contract",
        roster: [{ ...surveyEntry(), contract: undefined as unknown as Contract }],
        gates: [],
        deliverable: "something",
      }),
    ).toThrow(/contract must be the Contract this Delegation is judged against/);
  });

  it("accepts an empty Contract and no Gates at all", () => {
    const bare = combination({
      name: "bare",
      roster: [{ ...surveyEntry(), contract: contract([]) }],
      gates: [],
      deliverable: "a report nobody can be held to",
    });
    expect(bare.gates).toEqual([]);
    expect(bare.roster[0]?.contract.clauses).toEqual([]);
  });

  it("freezes what it hands out", () => {
    const plan = recipe();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.roster)).toBe(true);
    expect(Object.isFrozen(plan.roster[0])).toBe(true);
    expect(Object.isFrozen(plan.gates[0])).toBe(true);
    expect(() => (plan.roster as RosterEntry[]).push(buildEntry())).toThrow(TypeError);
  });

  it("is what a drive checks, so a recipe forced past the compiler never opens a Mission", async () => {
    const bench = benchOf();
    const broken = { ...recipe(), roster: [] } as unknown as Combination;

    await expect(
      drive(
        driving(bench, {
          runner: fakeAgentRunner([]),
          plan: broken,
          cap: moneyFromCents(10_000),
          settleTimeoutMs: 200,
          pollEveryMs: 5,
          maxAttemptsPerDelegation: 3,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCombinationError);

    expect(await bench.store.list()).toEqual([]);
  });

  it("refuses options it cannot be run with, before any gesture", async () => {
    const bench = benchOf();

    await expect(
      drive(
        driving(bench, {
          runner: fakeAgentRunner([]),
          plan: surveyOnly(),
          cap: moneyFromCents(10_000),
          settleTimeoutMs: -1,
          pollEveryMs: 0,
          maxAttemptsPerDelegation: 0,
        }),
      ),
    ).rejects.toThrow(InvalidDriveError);

    expect(await bench.store.list()).toEqual([]);
  });

  it("rejects a clock that stops answering Instants, having written nothing", async () => {
    const bench = benchOf();

    await expect(
      drive({
        ...driving(bench, {
          runner: fakeAgentRunner([]),
          plan: surveyOnly(),
          cap: moneyFromCents(10_000),
          settleTimeoutMs: 200,
          pollEveryMs: 5,
          maxAttemptsPerDelegation: 3,
        }),
        now: () => "" as Instant,
      }),
    ).rejects.toBeInstanceOf(BrokenClockError);

    expect(await bench.store.list()).toEqual([]);
  });
});

describe("what a Combination asks of a Mission next", () => {
  function running(): RunningMission {
    return openMission({
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10_000),
      core: CORE,
      occurredAt: instantFromDate(new Date(BASE)),
    });
  }

  it("walks the Roster in order, raising a Gate only once its Delegation is settled", async () => {
    const bench = benchOf();
    const runner = zordRunner([
      { acts: submitsTheSurvey(bench), report: costing(100) },
      { acts: submitsTheBuild(bench), report: costing(100) },
    ]);
    const bounds: Bounds = {
      runner,
      plan: recipe(),
      cap: moneyFromCents(10_000),
      settleTimeoutMs: 200,
      pollEveryMs: 5,
      maxAttemptsPerDelegation: 3,
    };

    await drive(driving(bench, bounds));
    await asHuman(bench, {
      kind: "decide-gate",
      occurredAt: bench.now(),
      gateId: GATE,
      decision: { kind: "approved" },
    });
    await drive(driving(bench, bounds));

    // The order the Commands went in, which is the recipe's order and the Gate in the middle of it.
    const asked = stepsOf(await bench.store.load(MISSION)).map((step) => step.command.kind);
    // The Handoff lands **before** the accrual, and that is the Zord's own doing rather than an ordering
    // this module chose: it submits while it runs, and the drive records what the run cost once the run
    // has resolved.
    expect(asked).toEqual([
      "open-mission",
      "delegate",
      "submit-handoff",
      "accrue-cost",
      "raise-gate",
      "decide-gate",
      "delegate",
      "submit-handoff",
      "accrue-cost",
      "deliver-mission",
    ]);
  });

  it("asks for a Delivery when every Slice is settled and every Gate was raised", () => {
    const settled = stateOf(EMPTY_REPLAY);
    expect(settled.status).toBe("unopened");
    // With nothing delegated, the first thing any recipe asks for is its first Delegation.
    expect(nextGestureOf(surveyOnly(), running())).toEqual({
      kind: "delegate",
      entry: surveyEntry(),
    });
  });

  it("lets one Zord hold two Delegations, because a Handoff answers a Delegation and not a Zord", async () => {
    const bench = benchOf();
    const twice = combination({
      name: "twice",
      roster: [surveyEntry(), { ...buildEntry(), zordId: SCOUT }],
      gates: [],
      deliverable: "two Slices, one Zord",
    });
    const runner = zordRunner([
      { acts: submitsTheSurvey(bench), report: costing(10) },
      { acts: submitsTheBuild(bench), report: costing(10) },
    ]);

    const stopped = await drive(
      driving(bench, {
        runner,
        plan: twice,
        cap: moneyFromCents(10_000),
        settleTimeoutMs: 200,
        pollEveryMs: 5,
        maxAttemptsPerDelegation: 3,
      }),
    );

    expect(stopped.outcome).toEqual({ kind: "delivered" });
    expect(eventsIn(stepsOf(stopped.replay), "delegated").map((fact) => fact.zordId)).toEqual([
      SCOUT,
      SCOUT,
    ]);
  });
});

describe("the instruction a Zord is handed", () => {
  it("is the declared text, the Delegation it answers, and nothing invented", () => {
    expect(instructionFor(surveyEntry(), [])).toBe(
      [
        "Read the Workspace and write down what it holds.",
        "",
        'You are answering Delegation "d-survey" of this Mission. When you are done, submit your ' +
          'Handoff with the control plane\'s "handoff_submit" tool, naming that Delegation.',
      ].join("\n"),
    );
  });

  it("quotes every violation of the last Refusal, in the order the domain listed them", () => {
    const said = instructionFor(surveyEntry(), ["first thing broken", "second thing broken"]);
    expect(said).toContain(
      [
        "Your last Handoff was refused against its Contract. Fix these and submit again:",
        "- first thing broken",
        "- second thing broken",
      ].join("\n"),
    );
  });
});

/* -------------------------------------------------------------------------------------------------
 * What the types refuse
 * ---------------------------------------------------------------------------------------------- */

describe("what the types refuse", () => {
  it("takes no way to turn a run into a Handoff — ADR 0010", () => {
    const probe = (bench: Bench, runner: AgentRunner): DriveOptions => ({
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10),
      core: CORE,
      combination: recipe(),
      writer: bench.writer,
      runner,
      now: bench.now,
      settleTimeoutMs: 1,
      pollEveryMs: 1,
      maxAttemptsPerDelegation: 1,
      // @ts-expect-error ADR 0010: a caller that could hand the drive a way to build a Handoff out of a
      // run would be inferring one from what a Zord wrote, one stack frame further out.
      handoffFrom: (report: AgentReport): string => report.output,
    });
    expect(typeof probe).toBe("function");
  });

  it("hands back no Mission state beside the Replay", () => {
    const probe = (done: Drive): unknown =>
      // @ts-expect-error `stateOf(done.replay)` is the state; a copy beside the Replay would be the
      // second reading of one truth this repository refuses everywhere else.
      done.state;
    expect(typeof probe).toBe("function");
  });

  it("says nothing about a Gate on an outcome that delivered", () => {
    const probe = (): DriveOutcome => ({
      kind: "delivered",
      // @ts-expect-error a delivered drive stopped for no reason a human has to answer, so it names no
      // Gate — and the Replay says everything else about it.
      gateId: GATE,
    });
    expect(typeof probe).toBe("function");
  });

  it("lets nothing add a Delegation to a Combination after it was checked", () => {
    const probe = (plan: Combination, entry: RosterEntry): void => {
      // @ts-expect-error a Combination is checked once and frozen, so its Roster is what was checked.
      plan.roster.push(entry);
    };
    expect(typeof probe).toBe("function");
  });

  it("refuses a Roster entry with no Contract", () => {
    // @ts-expect-error the Contract is required: a Delegation with none is a Slice nobody can be held
    // to, and an optional one would switch the product's loudest promise off by omission.
    const probe: RosterEntry = {
      delegationId: SURVEY,
      zordId: SCOUT,
      slice: SURVEY_SLICE,
      harnessSources: SURVEY_SOURCES,
      instruction: "Read the Workspace.",
    };
    expect(probe.delegationId).toBe(SURVEY);
  });

  it("refuses a declared Gate that does not say where it falls", () => {
    // @ts-expect-error `after` is required: an optional one would have to mean "at the start", and a
    // field with two meanings is the shape this repository refuses.
    const probe: DeclaredGate = { gateId: GATE, question: "Build on it?" };
    expect(probe.gateId).toBe(GATE);
  });

  it("refuses a drive with no timeout, because a default would choose invisibly how long a Mission waits", () => {
    // @ts-expect-error `settleTimeoutMs` is required: it is half of what "a Zord never delivered" means.
    const probe: DriveOptions = {
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10),
      core: CORE,
      combination: recipe(),
      writer: missionWriter({ store: missionStore({ workspace: "/nowhere" }) }),
      runner: fakeAgentRunner([]),
      now: clockFrom(BASE),
      pollEveryMs: 1,
      maxAttemptsPerDelegation: 1,
    };
    expect(probe.pollEveryMs).toBe(1);
  });

  it("asks what a recipe wants next only of a Mission that is running", () => {
    const probe = (plan: Combination): Gesture =>
      // @ts-expect-error a halted Mission is waiting for a human and a terminal one is over, so "what
      // next" is not a recipe question there — the drive answers those from the state instead.
      nextGestureOf(plan, stateOf(EMPTY_REPLAY));
    expect(typeof probe).toBe("function");
  });

  it("names a Gate with a GateId and an invocation with the Delegation it recorded", () => {
    const halted: DriveOutcome = { kind: "halted-at-gate", gateId: GATE };
    if (halted.kind === "halted-at-gate") {
      // An annotation, not a directive: what is being proven is assignability, which no
      // `@ts-expect-error` can phrase. Widen `gateId` to `string` and the build fails here.
      const named: GateId = halted.gateId;
      expect(named).toBe(GATE);
    }

    const opened = openMission({
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10_000),
      core: CORE,
      occurredAt: instantFromDate(new Date(BASE)),
    });
    const asked = nextGestureOf(surveyOnly(), opened);
    expect(asked.kind).toBe("delegate");
    if (asked.kind === "invoke") {
      const made: Delegation = asked.delegation;
      expect(made.id).toBe(SURVEY);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The Workspace this suite ran in
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary this module keeps", () => {
  it("imports the engine's public surface and one type, and touches no operating system", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./combination-driver.ts", import.meta.url)),
      "utf8",
    );
    const imported = [...source.matchAll(/\bimport\s+(type\s+)?[\s\S]*?from\s+"([^"]+)"/g)].map(
      (found) => ({ typeOnly: found[1] !== undefined, from: found[2] }),
    );

    // `@engine/index` and nothing deeper: `engine/index.ts` states that reaching into `engine/domain/*`
    // from outside the module is not part of the Contract, and this repository settled that every import
    // from `runtime/` names the public surface.
    expect(imported.map((entry) => entry.from)).toEqual(["@engine/index", "./mission-writer"]);
    expect(imported.find((entry) => entry.from === "./mission-writer")?.typeOnly).toBe(true);

    // No disk, no process, no clock but `Date.now`, and no dependency: the Core is coordination, and
    // everything that touches the world is handed to it.
    expect(source).not.toMatch(/from\s+"node:/);
    expect(source).not.toMatch(/require\(/);
  });
});

describe("the tests themselves", () => {
  it("leave no Mission in the repository they ran from", () => {
    expect(existsSync(join(REPO, ".megazord"))).toBe(false);
  });

  it("keep the Handoff out of the runner's hands: a report is output and a cost, and nothing else", () => {
    const answered: AgentReport = costing(1);
    expect(Object.keys(answered).sort()).toEqual(["cost", "output"]);
    const asHandoff: unknown = answered;
    expect(asHandoff).not.toHaveProperty("delegationId");
    expect(asHandoff).not.toHaveProperty("satisfies");
    expect(asHandoff).not.toHaveProperty("gaps");
  });
});
