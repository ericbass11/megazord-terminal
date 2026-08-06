/**
 * These tests write to a real disk, and the one that matters reads it back **in another process**.
 *
 * That is the whole point of criterion 8: reopening the same in-memory object proves nothing about a
 * file. So `reopenedInAnotherProcess` compiles `engine/` and this module to CommonJS in a temporary
 * directory, runs a plain `node` process over the compiled output, and has *that* process call `load`,
 * fold it with `stateOf` and read it with `stepsOf`. Nothing of the writing process is in scope there —
 * no Vitest, no alias resolution, no shared object.
 *
 * The compile step exists because bare Node cannot load `engine/`: its relative specifiers carry no
 * extension, which ESM refuses, so `node --experimental-strip-types engine/index.ts` fails on
 * `./domain/ids`. `tsc` with `--module commonjs` produces a tree Node requires happily, and it takes
 * about two seconds once per run.
 *
 * Every temporary directory this file creates is removed afterwards, and the last test asserts the
 * repository root has no `.megazord/` in it: a store test that leaves a Mission behind in the Workspace
 * it was run from would be its own bug report.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
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
  gap,
  gateId,
  handoff,
  harness,
  instant,
  missionId,
  moneyFromDecimal,
  orchestrationCapability,
  refusedIn,
  slice,
  stateOf,
  stepsOf,
  submit,
  zordId,
  core as coreOf,
  type Instant,
  type Mission,
  type MissionId,
  type Money,
  type Replay,
  type ReplayEntry,
} from "@engine/index";

import {
  CorruptReplayError,
  InvalidReplayEntryError,
  MissionFileNameError,
  missionStore,
  type MissionStore,
} from "./mission-store";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

/* -------------------------------------------------------------------------------------------------
 * Temporary Workspaces
 * ---------------------------------------------------------------------------------------------- */

const created: string[] = [];

/** A directory of this run's own, removed at the end whatever happens. */
function temporary(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  created.push(made);
  return made;
}

/** A Workspace with nothing in it. `.megazord/` is the store's to create. */
function workspace(): string {
  return temporary("megazord-workspace-");
}

/**
 * Where a Mission's file must be, written out rather than asked of the module.
 *
 * The duplication is deliberate: the PRD pins "JSONL under `.megazord/`, one file per Mission", so a
 * test that asked the module for the path would agree with it by construction and pin nothing.
 */
function replayPath(root: string, id: string): string {
  return join(root, ".megazord", "missions", `${encodeURIComponent(id)}${".jsonl"}`);
}

function missionsRoot(root: string): string {
  return join(root, ".megazord", "missions");
}

afterAll(() => {
  for (const made of created) {
    rmSync(made, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------------------------------
 * The Mission being stored
 * ---------------------------------------------------------------------------------------------- */

const MISSION = missionId("mission-cockpit");
const SCOUT = zordId("zord-scout");
const FIRST = delegationId("delegation-1");
const GATE = gateId("gate-ship-this-week");
const RENDERS = clauseId("clause-renders");

/** R$ 10,00, and the one accrual below is exactly that: a Cap is reached at equality. */
const CAP: Money = moneyFromDecimal("10.00");

const REFERENCE_CONTRACT = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
]);

const LEADING_CORE = coreOf([
  orchestrationCapability("delegate"),
  orchestrationCapability("consolidate"),
]);

const CATALOG_DEFAULT = harness({
  cli: "claude",
  model: "sonnet-4-5",
  effort: "medium",
  skills: [],
});

/** Instants built up front, in order: nothing in this file reads a clock. */
function clock(): () => Instant {
  let minute = 0;
  return () => {
    minute += 1;
    return instant(`2026-08-06T10:${String(minute).padStart(2, "0")}:00.000Z`);
  };
}

/**
 * The Replay criterion 8 asks for: it contains a **Refusal**, a **Gate decision** and a **Cap halt**.
 *
 * Driven through `submit`, so every entry is a Decision the engine really made — a hand-built Replay
 * would prove the file format and nothing about the thing being persisted. `the fixture` below asserts
 * all three are in here, because a round-trip test over a Replay that lost its Refusal would pass.
 */
function recorded(): Replay {
  const at = clock();
  let recording: Replay = EMPTY_REPLAY;

  recording = submit(recording, {
    kind: "open-mission",
    occurredAt: at(),
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit with a Pane per Zord"),
    mode: "combination",
    cap: CAP,
    core: LEADING_CORE,
  });

  recording = submit(recording, {
    kind: "delegate",
    occurredAt: at(),
    delegationId: FIRST,
    zordId: SCOUT,
    slice: slice("Map the Surfaces the Cockpit needs"),
    harnessSources: { catalogDefault: CATALOG_DEFAULT },
    contract: REFERENCE_CONTRACT,
  });

  // Refused, with no human in it: a Gap excuses an optional Clause and this one is required.
  recording = submit(recording, {
    kind: "submit-handoff",
    occurredAt: at(),
    handoff: handoff({
      delegationId: FIRST,
      satisfies: [],
      gaps: [gap(RENDERS, "ran out of time on the Pane grid")],
      artifacts: ["surfaces.md"],
    }),
  });

  recording = submit(recording, {
    kind: "submit-handoff",
    occurredAt: at(),
    handoff: handoff({
      delegationId: FIRST,
      satisfies: [RENDERS],
      gaps: [],
      artifacts: ["surfaces.md", "panes.md"],
    }),
  });

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
    decision: { kind: "approved" },
  });

  // Reaches the Cap, so the Decision carries the accrual *and* the halt.
  recording = submit(recording, {
    kind: "accrue-cost",
    occurredAt: at(),
    delegationId: FIRST,
    cost: CAP,
  });

  return recording;
}

/** Appends a whole Replay, one entry at a time, exactly as a Surface would as it went. */
async function append(store: MissionStore, id: MissionId, recording: Replay): Promise<void> {
  for (const entry of recording) {
    await store.append(id, entry);
  }
}

/* -------------------------------------------------------------------------------------------------
 * Reopening in another process
 * ---------------------------------------------------------------------------------------------- */

/** What the child process reports back, all of it derived from what `load` gave it. */
type Reopened = {
  readonly entries: number;
  readonly frozen: boolean;
  readonly replay: Replay;
  readonly state: Mission;
  readonly refusals: readonly string[];
  readonly gateDecisions: number;
  readonly halts: readonly string[];
  readonly summaries: readonly string[];
  readonly missions: readonly string[];
};

/**
 * The reader the child runs: it loads a Mission and reports the state it folds to.
 *
 * CommonJS, over the compiled tree, requiring nothing but it. No template literals, so this stays
 * readable inside the one it is written with.
 */
const READER = [
  'const { missionStore } = require("./runtime/mission-store.js");',
  'const { eventsIn, refusedIn, stateOf, stepsOf } = require("./engine/index.js");',
  "",
  "const workspace = process.argv[2];",
  "const id = process.argv[3];",
  "const store = missionStore({ workspace });",
  "",
  "Promise.all([store.load(id), store.list()]).then(([loaded, missions]) => {",
  "  const steps = stepsOf(loaded);",
  "  process.stdout.write(",
  "    JSON.stringify({",
  "      entries: loaded.length,",
  "      frozen: Object.isFrozen(loaded),",
  "      replay: loaded,",
  "      state: stateOf(loaded),",
  "      refusals: refusedIn(steps).map((step) => step.decision.refusal.reason),",
  '      gateDecisions: eventsIn(steps, "gate-decided").length,',
  '      halts: eventsIn(steps, "mission-halted").map((halted) => halted.halt.reason),',
  '      summaries: steps.map((step) => step.ordinal + ". " + step.summary),',
  "      missions: missions,",
  "    }),",
  "  );",
  "}, (failed) => {",
  "  process.stderr.write(String((failed && failed.stack) || failed));",
  "  process.exit(1);",
  "});",
  "",
].join("\n");

let built: string | undefined;

/**
 * `engine/` and this module, compiled to CommonJS once per run.
 *
 * `tsc` is spawned rather than imported: what the child needs is a tree on disk, and a compiler API
 * call would be this test process doing the emit, which is the thing it is trying not to be part of.
 */
function compiled(): string {
  if (built !== undefined) {
    return built;
  }

  const out = temporary("megazord-store-build-");
  const lib = join(out, "lib");
  const config = join(out, "tsconfig.json");

  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        moduleResolution: "node10",
        target: "es2022",
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        outDir: lib,
        rootDir: REPO,
        baseUrl: REPO,
        // The same alias `tsconfig.json` and `vitest.config.mts` carry, so the type-only import of
        // `@engine/index` resolves here too.
        paths: { "@engine/*": ["engine/*"] },
        types: ["node"],
        typeRoots: [join(REPO, "node_modules", "@types")],
      },
      files: [join(REPO, "engine", "index.ts"), join(REPO, "runtime", "mission-store.ts")],
    }),
    "utf8",
  );

  const done = spawnSync(process.execPath, [TSC, "-p", config], { encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`tsc could not compile the engine and the store:\n${done.stdout}${done.stderr}`);
  }

  writeFileSync(join(lib, "reopen.cjs"), READER, "utf8");
  built = lib;
  return lib;
}

/** Loads a Mission in a process that never saw the one that wrote it. */
function reopenedInAnotherProcess(root: string, id: string): Reopened {
  const done = spawnSync(process.execPath, [join(compiled(), "reopen.cjs"), root, id], {
    encoding: "utf8",
  });

  if (done.status !== 0) {
    throw new Error(`the reader failed (${String(done.status)}):\n${done.stdout}${done.stderr}`);
  }

  return JSON.parse(done.stdout) as Reopened;
}

/** The failure of a `load` that was supposed to fail. Fails the test loudly when it did not. */
async function corruptionIn(pending: Promise<unknown>): Promise<CorruptReplayError> {
  try {
    const loaded = await pending;
    throw new Error(`expected a corrupt Replay, it loaded ${JSON.stringify(loaded)}`);
  } catch (caught) {
    if (!(caught instanceof CorruptReplayError)) {
      throw caught;
    }
    return caught;
  }
}

/* -------------------------------------------------------------------------------------------------
 * The fixture itself
 * ---------------------------------------------------------------------------------------------- */

describe("the Replay this file stores", () => {
  it("contains a Refusal, a Gate decision and a Cap halt", () => {
    const steps = stepsOf(recorded());

    expect(refusedIn(steps).map((step) => step.decision.refusal.reason)).toEqual([
      "contract-violation",
    ]);
    expect(eventsIn(steps, "gate-decided").map((decided) => decided.decision.kind)).toEqual([
      "approved",
    ]);
    // Two halts, and the first one is not an oversight: `raise-gate` stops the Mission as well, so a
    // Replay with a Gate in it records the Gate halt and then the Cap halt.
    expect(eventsIn(steps, "mission-halted").map((halted) => halted.halt.reason)).toEqual([
      "gate-open",
      "cap-reached",
    ]);

    const closed = stateOf(recorded());
    expect(closed.status).toBe("halted");
    expect(closed.status === "halted" && closed.halt.reason).toBe("cap-reached");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 8
 * ---------------------------------------------------------------------------------------------- */

describe("closing the app and reopening it (criterion 8)", () => {
  it("restores the Mission from disk in a separate process, Replay intact", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();

    await append(store, MISSION, before);
    const closed = stateOf(before);

    const reopened = reopenedInAnotherProcess(root, MISSION);

    // The criterion itself: the state the reopened Mission folds to is the state it was closed in.
    expect(reopened.state).toEqual(closed);
    expect(reopened.entries).toBe(before.length);
    expect(reopened.replay).toEqual(before);

    // And it is still a *Replay*, not merely equal bytes: the engine's own readings work over it.
    expect(reopened.refusals).toEqual(["contract-violation"]);
    expect(reopened.gateDecisions).toBe(1);
    expect(reopened.halts).toEqual(["gate-open", "cap-reached"]);
    expect(reopened.missions).toEqual([MISSION]);
    expect(reopened.frozen).toBe(true);
    expect(reopened.summaries[2]).toContain("was refused (contract-violation)");
  });

  it("keeps the Missions apart, and a fresh process finds them all", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const other = missionId("mission-second");

    await append(store, MISSION, recorded());
    await store.append(other, recorded()[0] ?? unreachable());

    expect(reopenedInAnotherProcess(root, other).entries).toBe(1);
    expect(reopenedInAnotherProcess(root, other).missions).toEqual([MISSION, other]);
    expect(reopenedInAnotherProcess(root, MISSION).entries).toBe(recorded().length);
  });
});

function unreachable(): never {
  throw new Error("the recorded Replay is empty");
}

/* -------------------------------------------------------------------------------------------------
 * The layout
 * ---------------------------------------------------------------------------------------------- */

describe("the layout on disk", () => {
  it("is one JSONL file per Mission under .megazord/", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();

    await append(store, MISSION, before);
    await store.append(missionId("mission-second"), before[0] ?? unreachable());

    expect(readdirSync(missionsRoot(root)).sort()).toEqual([
      "mission-cockpit.jsonl",
      "mission-second.jsonl",
    ]);

    const text = readFileSync(replayPath(root, MISSION), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(before.length);
  });

  it("appends one entry per line, in the order they were submitted", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();

    await append(store, MISSION, before);

    const lines = readFileSync(replayPath(root, MISSION), "utf8").trimEnd().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as ReplayEntry).command.kind)).toEqual(
      before.map((entry) => entry.command.kind),
    );
  });

  it("orders appends by the call, not by whichever write finishes first", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();

    // Fired without an await between them: the queue is what keeps the record in order.
    await Promise.all(before.map((entry) => store.append(MISSION, entry)));

    expect((await store.load(MISSION)).map((entry) => entry.command.kind)).toEqual(
      before.map((entry) => entry.command.kind),
    );
  });
});

/* -------------------------------------------------------------------------------------------------
 * load
 * ---------------------------------------------------------------------------------------------- */

describe("load", () => {
  it("round-trips every entry, Refusal included", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();

    await append(store, MISSION, before);
    const loaded = await store.load(MISSION);

    expect(loaded).toEqual(before);
    expect(stateOf(loaded)).toEqual(stateOf(before));
  });

  it("answers the empty Replay for a Mission nothing was ever appended to", async () => {
    const store = missionStore({ workspace: workspace() });

    expect(await store.load(missionId("mission-nobody-opened"))).toEqual([]);
    expect(stateOf(await store.load(missionId("mission-nobody-opened")))).toEqual({
      status: "unopened",
    });
  });

  it("freezes what it hands out, entries and all", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();
    await append(store, MISSION, before);

    const loaded = await store.load(MISSION);
    const first = loaded[0] ?? unreachable();

    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => (loaded as ReplayEntry[]).push(first)).toThrow(TypeError);
  });

  it("refuses a MissionId that is not one, rather than reading a directory", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });

    await expect(store.load("" as MissionId)).rejects.toThrow(MissionFileNameError);
    await expect(store.load(undefined as unknown as MissionId)).rejects.toThrow(
      MissionFileNameError,
    );
    await expect(store.load(undefined as unknown as MissionId)).rejects.toThrow(
      "received undefined",
    );
  });
});

/* -------------------------------------------------------------------------------------------------
 * A corrupt line
 * ---------------------------------------------------------------------------------------------- */

describe("a line that is not a ReplayEntry", () => {
  it("is reported with the line and the byte to truncate at, and recovering keeps the rest", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();
    await append(store, MISSION, before);

    // Exactly what a kill between the write and the newline leaves behind.
    const torn = JSON.stringify(before[0] ?? unreachable()).slice(0, 40);
    appendFileSync(replayPath(root, MISSION), torn, "utf8");

    const failed = await corruptionIn(store.load(MISSION));
    expect(failed.line).toBe(before.length + 1);
    expect(failed.detail).toContain("still being written");
    expect(failed.message).toContain(replayPath(root, MISSION));

    // The offset is the recovery, not decoration.
    truncateSync(replayPath(root, MISSION), failed.at);
    expect(await store.load(MISSION)).toEqual(before);
  });

  it("is never skipped: a corruption in the middle refuses the whole Replay", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const before = recorded();
    await append(store, MISSION, before);

    const lines = readFileSync(replayPath(root, MISSION), "utf8").trimEnd().split("\n");
    lines.splice(3, 0, '{"command":{"kind":"accrue-cost"},"decision":{"kind":"acce');
    writeFileSync(replayPath(root, MISSION), `${lines.join("\n")}\n`, "utf8");

    const failed = await corruptionIn(store.load(MISSION));
    expect(failed.line).toBe(4);
    expect(failed.detail).toContain("is not JSON");
    // The point: not the three good entries before it. Nothing was loaded.
    await expect(store.load(MISSION)).rejects.toThrow(CorruptReplayError);
  });

  it("still lets list() answer, so a Cockpit can show the Mission and its failure", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    mkdirSync(missionsRoot(root), { recursive: true });
    writeFileSync(replayPath(root, MISSION), "{ not json\n", "utf8");

    expect(await store.list()).toEqual([MISSION]);
    await expect(store.load(MISSION)).rejects.toThrow(CorruptReplayError);
  });

  it.each([
    ["", "is empty"],
    ["   ", "is not JSON"],
    ["null", "not a recorded entry"],
    ["[]", "not a recorded entry"],
    ['"a line"', "not a recorded entry"],
    ["{}", "carries no Command with a kind"],
    ['{"command":{},"decision":{"kind":"accepted","events":[]}}', "no Command with a kind"],
    ['{"command":{"kind":"  "},"decision":{"kind":"accepted","events":[]}}', "no Command"],
    ['{"command":{"kind":"delegate"}}', "carries no Decision"],
    ['{"command":{"kind":"delegate"},"decision":null}', "carries a Decision that is null"],
    ['{"command":{"kind":"delegate"},"decision":{"kind":"maybe"}}', "neither accepted nor refused"],
    ['{"command":{"kind":"delegate"},"decision":{"kind":"accepted"}}', "no list of Events"],
    [
      '{"command":{"kind":"delegate"},"decision":{"kind":"accepted","events":[{"missionId":"m"}]}}',
      "Event at position 0 with no kind",
    ],
    ['{"command":{"kind":"delegate"},"decision":{"kind":"refused"}}', "carries no Refusal"],
    [
      '{"command":{"kind":"delegate"},"decision":{"kind":"refused","refusal":{"violations":[]}}}',
      "Refusal with no reason",
    ],
    [
      '{"command":{"kind":"delegate"},"decision":{"kind":"refused","refusal":{"reason":"cap-reached"}}}',
      "Refusal with no list of violations",
    ],
  ])("refuses %j, saying it %s", async (line, detail) => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    mkdirSync(missionsRoot(root), { recursive: true });
    writeFileSync(replayPath(root, MISSION), `${line}\n`, "utf8");

    const failed = await corruptionIn(store.load(MISSION));
    expect(failed.line).toBe(1);
    expect(failed.at).toBe(0);
    expect(failed.detail).toContain(detail);
  });

  it("points at the right line when the good entries before it are multi-byte", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    await store.append(MISSION, entryFor("uma missão em português — com acentos"));
    appendFileSync(replayPath(root, MISSION), "not json\n", "utf8");

    const failed = await corruptionIn(store.load(MISSION));
    expect(failed.line).toBe(2);
    // Bytes, not characters: the accented line is longer on disk than it is in memory.
    const first = readFileSync(replayPath(root, MISSION), "utf8").split("\n")[0] ?? "";
    expect(failed.at).toBe(Buffer.byteLength(first, "utf8") + 1);
    expect(failed.at).toBeGreaterThan(first.length + 1);
  });
});

/** A one-entry Replay whose Command carries the given text, for tests about bytes rather than rules. */
function entryFor(outcome: string): ReplayEntry {
  const only = submit(EMPTY_REPLAY, {
    kind: "open-mission",
    occurredAt: instant("2026-08-06T10:00:00.000Z"),
    missionId: MISSION,
    briefing: briefing(outcome),
    mode: "free",
    cap: CAP,
    core: LEADING_CORE,
  })[0];
  return only ?? unreachable();
}

/* -------------------------------------------------------------------------------------------------
 * append
 * ---------------------------------------------------------------------------------------------- */

describe("append", () => {
  it("has the entry on disk once it resolves", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const entry = entryFor("Ship the Cockpit");

    await store.append(MISSION, entry);

    // What cannot be tested here is the `fsync`: proving durability needs the power cut. What this
    // asserts is the half that is observable — the bytes are in the file, not in a buffer somewhere.
    expect(JSON.parse(readFileSync(replayPath(root, MISSION), "utf8").trimEnd())).toEqual(entry);
  });

  it("refuses a MissionId that cannot name a file, and writes nothing", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const entry = entryFor("Ship the Cockpit");

    await expect(store.append("" as MissionId, entry)).rejects.toThrow(MissionFileNameError);
    await expect(store.append("   " as MissionId, entry)).rejects.toThrow("non-blank string");
    await expect(store.append(7 as unknown as MissionId, entry)).rejects.toThrow("received 7");
    await expect(store.append("\uD800" as MissionId, entry)).rejects.toThrow(MissionFileNameError);

    expect(existsSync(missionsRoot(root))).toBe(false);
  });

  it("refuses an entry that cannot be a line, and writes nothing", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });

    const circular: { command: { kind: string }; decision?: unknown } = {
      command: { kind: "open-mission" },
    };
    circular.decision = circular;

    await expect(store.append(MISSION, circular as unknown as ReplayEntry)).rejects.toThrow(
      InvalidReplayEntryError,
    );
    expect(existsSync(missionsRoot(root))).toBe(false);
  });

  it("keeps a MissionId that looks like a path inside the Missions directory", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const escaping = "../../etc/passwd" as MissionId;

    await store.append(escaping, entryFor("Ship the Cockpit"));

    expect(readdirSync(missionsRoot(root))).toEqual(["..%2F..%2Fetc%2Fpasswd.jsonl"]);
    expect(existsSync(join(root, "..", "..", "etc", "passwd.jsonl"))).toBe(false);
    expect(await store.list()).toEqual([escaping]);
    expect(await store.load(escaping)).toHaveLength(1);
  });

  it.each([
    "mission with spaces",
    "missão-com-acentos",
    "mission/with/separators",
    "mission%2Falready-encoded",
    "mission.with.dots",
    "..",
  ])("round-trips the MissionId %j through the file name", async (id) => {
    const root = workspace();
    const store = missionStore({ workspace: root });

    await store.append(id as MissionId, entryFor("Ship the Cockpit"));

    expect(await store.list()).toEqual([id]);
    expect(await store.load(id as MissionId)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * list
 * ---------------------------------------------------------------------------------------------- */

describe("list", () => {
  it("is empty before anything was stored", async () => {
    expect(await missionStore({ workspace: workspace() }).list()).toEqual([]);
  });

  it("answers every Mission, in ascending order", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const entry = entryFor("Ship the Cockpit");

    for (const id of ["mission-c", "mission-a", "mission-b"]) {
      await store.append(id as MissionId, entry);
    }

    expect(await store.list()).toEqual(["mission-a", "mission-b", "mission-c"]);
  });

  it("ignores what is not a Mission's file", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    await store.append(MISSION, entryFor("Ship the Cockpit"));

    writeFileSync(join(missionsRoot(root), "notes.md"), "not a Replay\n", "utf8");
    writeFileSync(join(missionsRoot(root), "mission-cockpit.jsonl.tmp"), "half\n", "utf8");
    mkdirSync(join(missionsRoot(root), "a-directory.jsonl"));

    expect(await store.list()).toEqual([MISSION]);
  });

  it.each(["a b.jsonl", "%zz.jsonl", ".jsonl", "%.jsonl", "  .jsonl"])(
    "refuses to name a Mission after %j",
    async (name) => {
      const root = workspace();
      const store = missionStore({ workspace: root });
      mkdirSync(missionsRoot(root), { recursive: true });
      writeFileSync(join(missionsRoot(root), name), "\n", "utf8");

      await expect(store.list()).rejects.toThrow(MissionFileNameError);
      await expect(store.list()).rejects.toThrow("is not a Mission");
    },
  );
});

/* -------------------------------------------------------------------------------------------------
 * The boundary
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary", () => {
  it("runs no engine code: its only engine import is a type", () => {
    const here = readFileSync(fileURLToPath(new URL("./mission-store.ts", import.meta.url)), "utf8");
    // Anchored at an `import` statement rather than at `from "…"`: this module's own doc quotes that
    // phrase when it explains the engine's import assertion, and a scan that read the comment would
    // report a specifier nobody wrote. `codeOf` in `tools/` exists for the same reason.
    const specifiers = [...here.matchAll(/^import\s[^;]*?from "([^"]+)";$/gm)].map(
      ([, specifier]) => specifier,
    );

    expect(specifiers.filter((specifier) => specifier?.startsWith(".")))
      .toEqual([]);
    expect([...new Set(specifiers)].sort()).toEqual([
      "@engine/index",
      "node:fs/promises",
      "node:path",
    ]);
    // Not merely "it imports types": the statement itself is `import type`, so `tsc` erases it and the
    // compiled module requires nothing but Node builtins — which is what makes the store unable to
    // re-decide, re-fold or re-validate anything. Read off the emitted JavaScript, because that is the
    // claim: no engine module is loaded at runtime.
    expect(here).toContain('import type { MissionId, Replay, ReplayEntry } from "@engine/index";');

    const emitted = readFileSync(join(compiled(), "runtime", "mission-store.js"), "utf8");
    const required = [...emitted.matchAll(/require\("([^"]+)"\)/g)].map(([, specifier]) => specifier);
    expect([...new Set(required)].sort()).toEqual(["node:fs/promises", "node:path"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 * ---------------------------------------------------------------------------------------------- */

describe("the type level", () => {
  it("answers the techspec's MissionStore exactly, with nothing widened", () => {
    // Not expressible as a `@ts-expect-error`: what is claimed is assignability, so the proof is the
    // annotation. Widen `list`'s answer to `readonly string[]`, or `load`'s to `ReplayEntry[]`, and this
    // line stops compiling — which fails `npm run build`.
    const asContract: MissionStore = missionStore({ workspace: tmpdir() });
    expect(typeof asContract.append).toBe("function");
  });

  it("requires the Workspace, and takes nothing else", () => {
    // @ts-expect-error — workspace has no default: a Mission belongs to a Workspace, not to wherever
    // the process happened to start.
    const rootless = (): MissionStore => missionStore({});
    const invented = (): MissionStore =>
      missionStore({
        workspace: tmpdir(),
        // @ts-expect-error — there is no fsync option, deliberately: durability is not a thing a test
        // may switch off, and an option only a test would pass is the always-zero field with a type.
        fsync: false,
      });

    expect([rootless, invented].every((build) => typeof build === "function")).toBe(true);
  });

  it("takes a MissionId and not any string, in both directions", () => {
    const store = missionStore({ workspace: tmpdir() });

    // @ts-expect-error — a raw string is not a MissionId: the brand is what keeps a ZordId or a
    // DelegationId out of the path a Replay is stored at.
    const appended = (): Promise<void> => store.append("mission-cockpit", entryFor("anything"));
    // @ts-expect-error — the same for reading it back.
    const loaded = (): Promise<Replay> => store.load("mission-cockpit");

    expect([appended, loaded].every((call) => typeof call === "function")).toBe(true);
  });

  it("hands out a Replay, not a list somebody can append to", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    await store.append(MISSION, entryFor("Ship the Cockpit"));
    const loaded = await store.load(MISSION);
    const ids = await store.list();

    // Both probes sit inside a function nothing calls: the lists are also frozen, so *running* the push
    // throws a TypeError and would fail the test for the runtime reason instead of proving the type one.
    // @ts-expect-error — a Replay is readonly: the file is the record, and a reader that could push
    // onto it would be a second way of appending, one that never reaches the disk.
    const appending = (): number => loaded.push(entryFor("anything"));
    // @ts-expect-error — the same for the Missions a store holds.
    const naming = (): number => ids.push(MISSION);

    expect([appending, naming].every((probe) => typeof probe === "function")).toBe(true);
    // The runtime half of the same claim, which is what actually stops a write.
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(ids)).toBe(true);
    expect(() => (ids as MissionId[]).push(MISSION)).toThrow(TypeError);
    expect(loaded).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing is left behind
 * ---------------------------------------------------------------------------------------------- */

describe("nothing is left behind", () => {
  it("never writes a .megazord/ into the repository it runs from", () => {
    expect(existsSync(join(REPO, ".megazord"))).toBe(false);
    expect(existsSync(join(process.cwd(), ".megazord"))).toBe(false);
  });
});
