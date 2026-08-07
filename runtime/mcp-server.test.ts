/**
 * These tests drive the control plane the way a client does: JSON-RPC text in, JSON-RPC text out. There
 * is no MCP client library here and no transport, because there is no transport in the module — that is
 * Task 9's, and its absence is what makes criterion 9 provable by calling a function.
 *
 * **Criterion 9 is "a client calls `pane_spawn` and `handoff_submit`, and both take effect", and "take
 * effect" is the load-bearing half.** So:
 *
 * - `pane_spawn` is proven by a **real fork**: a real `paneManager`, `/bin/bash`, the child's own pid read
 *   out of the terminal it wrote it on, and `/proc` asked whether that pid exists. A stub would prove that
 *   this module calls the function it calls.
 * - `handoff_submit` is proven by the **Replay on disk**: a real temporary Workspace, and the entry read
 *   back through a **fresh** `missionStore` over the same directory, folded with `stateOf` and read with
 *   `stepsOf`. Not the object the call returned.
 *
 * **The holdout processes here sleep 293 seconds, and that is the third spelling in this directory.**
 * `pty-agent-runner.test.ts` asserts no `sleep 300` exists on the host and `pane-manager.test.ts` uses
 * `sleep 297` for exactly that reason; Vitest runs files in parallel workers, so a third file leaving a
 * live holdout needs a third number or it fails somebody else's cleanup check in a test that names no
 * cause.
 *
 * Every Pane opened here is killed in `afterEach`, through the process table, and every temporary
 * directory is removed. The last test asserts no `sleep 293` survived the file.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  briefing,
  clause,
  clauseId,
  contract,
  delegationId,
  eventsIn,
  fakeAgentRunner,
  harness,
  instantFromDate,
  isOpenDelegation,
  isOpened,
  missionId,
  moneyFromCents,
  orchestrationCapability,
  slice,
  stateOf,
  stepsOf,
  submit,
  zordId,
  core as coreOf,
  type FakeAgentRunner,
  type Instant,
  type MissionCommand,
  type MissionId,
  type Replay,
  type ReplayEntry,
} from "@engine/index";

import { cortexStore, type CortexStore } from "./cortex-store";
import { missionStore, type MissionStore } from "./mission-store";
import { missionWriter } from "./mission-writer";
import { paneManager, paneId, type PaneId, type PaneManager } from "./pane-manager";
import { inheritedEnv } from "./pty-agent-runner";

import {
  PROTOCOL_VERSION,
  SERVER_NAME,
  TOOLS,
  controlPlane,
  type ControlPlane,
  type ControlPlaneOptions,
  type ToolName,
} from "./mcp-server";

const BASH = "/bin/bash";
const ON_LINUX = process.platform === "linux";

/** Exactly the variables a shell needs to be itself. Nothing else of this process reaches a Pane. */
const ENV = inheritedEnv(["PATH", "HOME"]);

/** Long enough that nothing ends on its own, and spelled differently from the other two files. */
const FOREVER = "sleep 293";

/** The eight, in the order the PRD lists them. Written out rather than imported from the module. */
const EIGHT: readonly string[] = [
  "pane_spawn",
  "pane_write",
  "pane_read",
  "handoff_submit",
  "mission_create",
  "memory_write",
  "memory_read",
  "agent_invoke",
];

/* -------------------------------------------------------------------------------------------------
 * The Mission being acted on
 * ---------------------------------------------------------------------------------------------- */

const MISSION = missionId("mission-cockpit");
const BUILDER = zordId("zord-builder");
const SCOUT = zordId("zord-scout");
const FIRST = delegationId("delegation-1");
const RENDERS = clauseId("clause-renders");
const TESTED = clauseId("clause-tested");

/** One required Clause and one optional one, so a broken Handoff breaks the Contract **twice**. */
const REFERENCE_CONTRACT = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
  clause({ id: TESTED, description: "It has a test that spawns a real process", required: false }),
]);

const CATALOG_DEFAULT = harness({
  cli: "claude",
  model: "sonnet",
  effort: "medium",
  skills: ["tdd"],
});

const LEADING_CORE = coreOf([
  orchestrationCapability("delegate"),
  orchestrationCapability("consolidate"),
]);

/** A clock that never repeats itself and never runs off the end of an hour: derived from one base. */
const BASE = Date.parse("2026-08-06T12:00:00.000Z");

function clock(): () => Instant {
  let tick = 0;
  return () => {
    tick += 1;
    return instantFromDate(new Date(BASE + tick * 1_000));
  };
}

function at(tick: number): Instant {
  return instantFromDate(new Date(BASE + tick * 1_000));
}

/* -------------------------------------------------------------------------------------------------
 * Building one
 * ---------------------------------------------------------------------------------------------- */

type Built = {
  readonly plane: ControlPlane;
  readonly workspace: string;
  readonly store: MissionStore;
  readonly cortex: CortexStore;
  readonly panes: PaneManager;
  readonly runner: FakeAgentRunner;
  /** Every Pane this test opened, which is what the cleanup kills. */
  readonly opened: PaneId[];
  /** Everything a Pane wrote, as this test's own listener saw it — the control plane's ring is bounded. */
  wrote(pane: PaneId): string;
};

let built: Built[] = [];
let directories: string[] = [];

afterEach(async () => {
  for (const one of built) {
    for (const pane of one.opened) {
      await one.panes.kill(pane).catch(() => undefined);
    }
  }
  built = [];
  for (const made of directories) {
    rmSync(made, { recursive: true, force: true });
  }
  directories = [];
});

/** A Workspace of this test's own, removed afterwards. `.megazord/` is the stores' to create. */
function workspace(label: string): string {
  const made = mkdtempSync(join(tmpdir(), `megazord-plane-${label}-`));
  directories.push(made);
  return made;
}

type Overrides = {
  readonly script?: readonly { readonly output: string; readonly cost: ReturnType<typeof moneyFromCents> }[];
  readonly maxPaneBytes?: number;
  readonly zordId?: typeof BUILDER;
  readonly now?: () => Instant;
};

function planeOver(label: string, overrides: Overrides = {}): Built {
  const root = workspace(label);
  const store = missionStore({ workspace: root });
  const cortex = cortexStore({ workspace: root });
  const panes = paneManager({ env: ENV, idleAfterMs: 400 });
  const runner = fakeAgentRunner(overrides.script ?? []);

  const plane = controlPlane({
    missionId: MISSION,
    zordId: overrides.zordId ?? BUILDER,
    workspace: root,
    // The store is what this test seeds and reads the file back through; the control plane is handed the
    // one door over it — `load → submit → append` as one atom. See `runtime/mission-writer.ts`.
    writer: missionWriter({ store }),
    panes,
    cortex,
    runner,
    now: overrides.now ?? clock(),
    maxPaneBytes: overrides.maxPaneBytes ?? 64 * 1024,
  });

  // Attached **after** the control plane's own, so both see every chunk of every Pane opened below. This
  // is the unbounded reading the bounded one is compared against.
  const seen = new Map<string, string>();
  panes.onData((pane, chunk) => {
    seen.set(pane, (seen.get(pane) ?? "") + chunk);
  });

  const one: Built = {
    plane,
    workspace: root,
    store,
    cortex,
    panes,
    runner,
    opened: [],
    wrote: (pane) => seen.get(pane) ?? "",
  };
  built.push(one);
  return one;
}

/* -------------------------------------------------------------------------------------------------
 * Speaking JSON-RPC
 * ---------------------------------------------------------------------------------------------- */

type Frame = Readonly<Record<string, unknown>>;

let nextId = 0;

function objectIn(value: unknown, at: string): Frame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${at} is not an object: ${JSON.stringify(value)}`);
  }
  return value as Frame;
}

function listIn(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${at} is not a list: ${JSON.stringify(value)}`);
  }
  return value;
}

/** One request, answered. Asserts an answer arrived, because a request always has one. */
async function asked(one: Built, method: string, params?: unknown): Promise<Frame> {
  nextId += 1;
  const frame = JSON.stringify({ jsonrpc: "2.0", id: nextId, method, ...(params === undefined ? {} : { params }) });
  const answered = await one.plane.handle(frame);
  expect(typeof answered).toBe("string");
  const response = objectIn(JSON.parse(String(answered)), "the response");
  expect(response.jsonrpc).toBe("2.0");
  expect(response.id).toBe(nextId);
  return response;
}

function called(one: Built, name: string, args: unknown): Promise<Frame> {
  return asked(one, "tools/call", { name, arguments: args });
}

/** The JSON a tool answered, out of its one text content block. */
function payloadIn(response: Frame): Frame {
  const result = objectIn(response.result, "result");
  const content = listIn(result.content, "result.content");
  const first = objectIn(content[0], "result.content[0]");
  expect(first.type).toBe("text");
  return objectIn(JSON.parse(String(first.text)), "the tool's answer");
}

function failedIn(response: Frame): boolean {
  return objectIn(response.result, "result").isError === true;
}

function errorIn(response: Frame): Frame {
  return objectIn(response.error, "error");
}

async function until(condition: () => boolean, withinMs = 10_000): Promise<boolean> {
  const stop = Date.now() + withinMs;
  while (Date.now() < stop) {
    if (condition()) {
      return true;
    }
    await new Promise((wake) => setTimeout(wake, 25));
  }
  return condition();
}

function rested(ms: number): Promise<void> {
  return new Promise((wake) => {
    setTimeout(wake, ms);
  });
}

/** Whether a pid names a live process. `/proc`, because a zombie answers signal 0. */
function running(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}

/* -------------------------------------------------------------------------------------------------
 * Driving the Mission to where a Handoff can be submitted
 * ---------------------------------------------------------------------------------------------- */

const OPEN_MISSION: MissionCommand = {
  kind: "open-mission",
  occurredAt: at(0),
  missionId: MISSION,
  briefing: briefing("A Cockpit that runs real Zords"),
  mode: "combination",
  cap: moneyFromCents(5_000),
  core: LEADING_CORE,
};

const DELEGATE: MissionCommand = {
  kind: "delegate",
  occurredAt: at(1),
  delegationId: FIRST,
  zordId: SCOUT,
  slice: slice("Draw one Pane per Zord"),
  harnessSources: { catalogDefault: CATALOG_DEFAULT },
  contract: REFERENCE_CONTRACT,
};

/**
 * Puts a Mission on disk, through the engine and the store directly.
 *
 * Directly on purpose: `delegate` is the Core's act and there is no tool for it, so a test that needed
 * one would be testing a tool this control plane deliberately does not have.
 */
async function recorded(one: Built, commands: readonly MissionCommand[]): Promise<void> {
  let replay: Replay = await one.store.load(MISSION);
  for (const command of commands) {
    replay = submit(replay, command);
    const entry = replay[replay.length - 1];
    expect(entry.decision.kind).toBe("accepted");
    await one.store.append(MISSION, entry);
  }
}

/** The Replay as a **fresh** store over the same directory reads it. Never the object a call returned. */
function reopened(one: Built): Promise<Replay> {
  return missionStore({ workspace: one.workspace }).load(MISSION);
}

/* -------------------------------------------------------------------------------------------------
 * The handshake
 * ---------------------------------------------------------------------------------------------- */

describe("the handshake", () => {
  it("answers initialize with the protocol version it speaks", async () => {
    const one = planeOver("initialize");
    const response = await asked(one, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "a-zord", version: "1" },
    });

    const result = objectIn(response.result, "result");
    // Pinned as a string, so the day a client refuses this revision something says so here.
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    // A client that asked for another revision is answered with ours, which is what the spec prescribes.
    expect(result.protocolVersion).not.toBe("2025-03-26");
    expect(objectIn(result.capabilities, "capabilities")).toHaveProperty("tools");
    expect(objectIn(result.serverInfo, "serverInfo").name).toBe(SERVER_NAME);
    expect(typeof objectIn(result.serverInfo, "serverInfo").version).toBe("string");
  });

  it("answers the initialized notification with nothing at all", async () => {
    const one = planeOver("initialized");
    const answered = await one.plane.handle(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(answered).toBeUndefined();
  });

  it("answers a ping, because a client that is refused one concludes the connection is dead", async () => {
    const one = planeOver("ping");
    const response = await asked(one, "ping");
    expect(objectIn(response.result, "result")).toEqual({});
  });

  it("answers a tool call that arrived before initialize", async () => {
    // The handshake is not enforced as an order — the control plane holds no connection state.
    const one = planeOver("unhandshaken");
    const response = await called(one, "memory_read", {});
    expect(failedIn(response)).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * tools/list
 * ---------------------------------------------------------------------------------------------- */

describe("tools/list", () => {
  it("answers the eight the PRD pins, and would fail if one were added, removed or renamed", async () => {
    const one = planeOver("list");
    const response = await asked(one, "tools/list");
    const listed = listIn(objectIn(response.result, "result").tools, "tools");

    const names = listed.map((tool) => objectIn(tool, "a tool").name);
    expect(names).toEqual(EIGHT);
    expect(listed).toHaveLength(8);
  });

  it("answers exactly what `tools` holds, so there is one list and not two", async () => {
    const one = planeOver("one-list");
    const response = await asked(one, "tools/list");
    expect(objectIn(response.result, "result").tools).toEqual(one.plane.tools);
    expect(one.plane.tools.map((tool) => tool.name)).toEqual(EIGHT);
  });

  it("declares a closed object schema for every tool", async () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      // Enforced, not decorative: it is what stops a Zord believing it passed a zordId.
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(typeof tool.description).toBe("string");
      for (const named of tool.inputSchema.required) {
        expect(Object.keys(tool.inputSchema.properties)).toContain(named);
      }
    }
  });

  it("declares no field a Zord may not say", async () => {
    // The four values that are options, checked as absences across every schema at once.
    for (const tool of TOOLS) {
      const declared = Object.keys(tool.inputSchema.properties);
      expect(declared).not.toContain("occurredAt");
      expect(declared).not.toContain("recordedAt");
      expect(declared).not.toContain("cwd");
    }
    // `memory_read` filters by zordId and missionId, which is reading rather than claiming; nothing else
    // takes either.
    for (const tool of TOOLS.filter((each) => each.name !== "memory_read")) {
      const declared = Object.keys(tool.inputSchema.properties);
      expect(declared).not.toContain("zordId");
      expect(declared).not.toContain("missionId");
    }
  });

  it("hands out a frozen list", () => {
    const one = planeOver("frozen");
    expect(Object.isFrozen(one.plane.tools)).toBe(true);
    expect(() => {
      (one.plane.tools as unknown as ToolDescriptorLike[]).push({ name: "pane_spawn" });
    }).toThrow(TypeError);
  });
});

/** Only for the runtime half of the freeze probe above; the type half is at the foot of this file. */
type ToolDescriptorLike = { readonly name: string };

/* -------------------------------------------------------------------------------------------------
 * Frames nobody should be able to break this with
 * ---------------------------------------------------------------------------------------------- */

describe("a frame that is not a request", () => {
  it("answers a parse error under a null id", async () => {
    const one = planeOver("unparseable");
    const response = objectIn(JSON.parse(String(await one.plane.handle("{not json"))), "the response");
    expect(response.id).toBeNull();
    expect(errorIn(response).code).toBe(-32700);
  });

  it("refuses a batch, because MCP 2025-06-18 removed them", async () => {
    const one = planeOver("batch");
    const frame = JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    const response = objectIn(JSON.parse(String(await one.plane.handle(frame))), "the response");
    expect(errorIn(response).code).toBe(-32600);
    expect(String(errorIn(response).message)).toContain("batches");
  });

  it("refuses a frame that does not say it is JSON-RPC 2.0", async () => {
    const one = planeOver("versionless");
    const frame = JSON.stringify({ id: 1, method: "ping" });
    const response = objectIn(JSON.parse(String(await one.plane.handle(frame))), "the response");
    expect(errorIn(response).code).toBe(-32600);
  });

  it("refuses an id that is neither a string nor a number", async () => {
    const one = planeOver("bad-id");
    const frame = JSON.stringify({ jsonrpc: "2.0", id: { deep: true }, method: "ping" });
    const response = objectIn(JSON.parse(String(await one.plane.handle(frame))), "the response");
    expect(response.id).toBeNull();
    expect(errorIn(response).code).toBe(-32600);
  });

  it("answers a request whose method it does not know", async () => {
    const one = planeOver("unknown-method");
    const response = await asked(one, "resources/list");
    expect(errorIn(response).code).toBe(-32601);
  });

  it("answers a *notification* whose method it does not know with nothing", async () => {
    // JSON-RPC 2.0 §4.1: a notification is never replied to, not even to refuse it.
    const one = planeOver("unknown-notification");
    const answered = await one.plane.handle(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }),
    );
    expect(answered).toBeUndefined();
  });

  it("refuses positional params", async () => {
    const one = planeOver("positional");
    const frame = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: ["pane_read"] });
    const response = objectIn(JSON.parse(String(await one.plane.handle(frame))), "the response");
    expect(errorIn(response).code).toBe(-32602);
  });

  it("never rejects, whatever it is handed", async () => {
    const one = planeOver("hostile");
    const frames = [
      "",
      "null",
      "[]",
      "1",
      '"a string"',
      "{}",
      JSON.stringify({ jsonrpc: "2.0", id: 1 }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: 7 }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 7 } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pane_read", arguments: null } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pane_read", arguments: [] } }),
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "pane_spawn" } }),
    ];

    for (const frame of frames) {
      // `resolves` and not a try/catch: a rejection here would be the failure, and it must be awaited.
      await expect(one.plane.handle(frame)).resolves.not.toThrow();
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * Arguments, which is the only thing this layer reads for itself
 * ---------------------------------------------------------------------------------------------- */

describe("the arguments", () => {
  it("refuses a tool nobody has", async () => {
    const one = planeOver("no-such-tool");
    const response = await called(one, "pane_list", {});
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("pane_spawn");
  });

  it("refuses a call with no arguments object", async () => {
    const one = planeOver("no-arguments");
    const response = await asked(one, "tools/call", { name: "pane_read" });
    expect(errorIn(response).code).toBe(-32602);
  });

  it("names the required argument that is missing", async () => {
    const one = planeOver("missing");
    const response = await called(one, "pane_spawn", { paneId: "p", cli: BASH });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("argv");
  });

  it("refuses an argument of the wrong type", async () => {
    const one = planeOver("wrong-type");
    const response = await called(one, "pane_spawn", { paneId: "p", cli: 7, argv: [] });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("pane_spawn.cli");
  });

  it("refuses a list whose element is of the wrong type, naming the position", async () => {
    const one = planeOver("wrong-element");
    const response = await called(one, "pane_spawn", { paneId: "p", cli: BASH, argv: ["-c", 3] });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("argv[1]");
  });

  it("refuses a Mode the engine has no name for", async () => {
    // The one value rule this layer owns, because `engine/` has no `mode()` to relay it to.
    const one = planeOver("bad-mode");
    const response = await called(one, "mission_create", {
      briefing: "x",
      mode: "autonomous",
      capCents: 100,
      capabilities: [],
    });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("combination");
  });

  it("refuses an argument the schema does not declare, rather than dropping it", async () => {
    const one = planeOver("extra");
    const response = await called(one, "pane_read", { paneId: "p", tail: 200 });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("tail");
  });

  it("refuses a zordId on memory_write, which is the reason that refusal is enforced", async () => {
    // Silently ignoring it would leave the Zord believing it had attributed the Fact to somebody else.
    const one = planeOver("attribution");
    const response = await called(one, "memory_write", {
      subject: "panes",
      body: "a Pane is a pty",
      zordId: "zord-somebody-else",
    });
    expect(errorIn(response).code).toBe(-32602);
    expect(String(errorIn(response).message)).toContain("zordId");
  });

  it("refuses a NaN where a number is declared, because JSON cannot carry one back", async () => {
    const one = planeOver("nan");
    const response = await called(one, "memory_read", { limit: Number.NaN });
    // `JSON.stringify(NaN)` is `null`, so this arrives as a null and is refused as "not a number".
    expect(errorIn(response).code).toBe(-32602);
  });

  it("relays a collaborator's refusal as a tool result, not as a protocol error", async () => {
    const one = planeOver("relay");
    const response = await called(one, "memory_write", { subject: "   ", body: "something" });
    expect(response.error).toBeUndefined();
    expect(failedIn(response)).toBe(true);
    // The Cortex's own wording and its own error name, relayed rather than restated.
    expect(payloadIn(response).error).toBe("InvalidFactError");
    expect(String(payloadIn(response).detail)).toContain("subject");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 9, first half: pane_spawn forks a real process
 * ---------------------------------------------------------------------------------------------- */

describe("pane_spawn (criterion 9)", () => {
  it.skipIf(!ON_LINUX)("forks a real process, in the Workspace, and the Cockpit can see it", async () => {
    const one = planeOver("spawn");
    const pane = paneId("pane-scout");
    one.opened.push(pane);

    const response = await called(one, "pane_spawn", {
      paneId: pane,
      cli: BASH,
      argv: ["-c", `echo PID:$$; echo cwd:$PWD; ${FOREVER}`],
    });

    expect(failedIn(response)).toBe(false);
    expect(payloadIn(response).paneId).toBe(pane);
    // `starting` is announced synchronously with the fork, so it is already in the answer.
    expect(payloadIn(response).status).toBe("starting");

    expect(await until(() => one.wrote(pane).includes("PID:"))).toBe(true);
    const said = /PID:(\d+)/u.exec(one.wrote(pane));
    expect(said).not.toBeNull();
    const pid = Number(said?.[1]);

    // The load-bearing assertion: a process with that pid exists on this host.
    expect(running(pid)).toBe(true);
    // And it runs in the Workspace, which is an option and not an argument.
    expect(await until(() => one.wrote(pane).includes(`cwd:${one.workspace}`))).toBe(true);

    await one.panes.kill(pane);
    expect(running(pid)).toBe(false);
  });

  it("refuses a second Pane under one id, in the process table's own words", async () => {
    const one = planeOver("duplicate");
    const pane = paneId("pane-twice");
    one.opened.push(pane);

    const first = await called(one, "pane_spawn", { paneId: pane, cli: BASH, argv: ["-c", FOREVER] });
    expect(failedIn(first)).toBe(false);

    const second = await called(one, "pane_spawn", { paneId: pane, cli: BASH, argv: ["-c", FOREVER] });
    expect(second.error).toBeUndefined();
    expect(failedIn(second)).toBe(true);
    expect(payloadIn(second).error).toBe("PaneSpawnError");
    expect(String(payloadIn(second).detail)).toContain("already open");
  });

  it("refuses a blank cli before anything is forked, and says nothing was opened", async () => {
    // The guard's answer, pinned. Unguarded, `node-pty` substitutes `sh` for an empty file and the Pane
    // would run a different program under the name the record shows — the silent, permanent kind of lie
    // `pty-agent-runner.ts` records. `paneManager.spawn` reads `cli` as `unknown` and refuses *before*
    // the fork, so the damage is not re-created here; what is pinned is that the refusal arrives as a
    // readable tool error and that no Pane came into existence.
    const one = planeOver("blank-cli");
    const response = await called(one, "pane_spawn", { paneId: "pane-blank", cli: "", argv: [] });

    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("PaneSpawnError");
    expect(String(payloadIn(response).detail)).toContain("no cli");

    // Nothing was opened: reading it is the "no such Pane" answer, not an empty one.
    const read = await called(one, "pane_read", { paneId: "pane-blank" });
    expect(failedIn(read)).toBe(true);
    expect(payloadIn(read).error).toBe("UnknownPaneError");
  });
});

/* -------------------------------------------------------------------------------------------------
 * pane_write and pane_read
 * ---------------------------------------------------------------------------------------------- */

describe("pane_write", () => {
  it("delivers keystrokes that reach the process", async () => {
    const one = planeOver("write");
    const pane = paneId("pane-cat");
    one.opened.push(pane);

    await called(one, "pane_spawn", { paneId: pane, cli: BASH, argv: ["-c", "cat"] });
    const response = await called(one, "pane_write", { paneId: pane, keystrokes: "marco\r" });

    expect(failedIn(response)).toBe(false);
    expect(payloadIn(response).paneId).toBe(pane);
    expect(await until(() => one.wrote(pane).includes("marco"))).toBe(true);

    const read = await called(one, "pane_read", { paneId: pane });
    expect(String(payloadIn(read).output)).toContain("marco");
  });

  it("refuses a Pane it holds no record of", async () => {
    const one = planeOver("write-nowhere");
    const response = await called(one, "pane_write", { paneId: "pane-nowhere", keystrokes: "x" });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnknownPaneError");
  });
});

describe("pane_read", () => {
  it("answers an empty reading for a Pane that has written nothing — and refuses one that does not exist", async () => {
    // The two halves of one guard. Answering `output: ""` for a Pane nobody opened would make these two
    // cases indistinguishable, which is the substituted default in a reading: a Zord would read "it wrote
    // nothing" from a Pane that is not there. Remove the guard and the second assertion goes red.
    const one = planeOver("empty-vs-absent");
    const pane = paneId("pane-quiet");
    one.opened.push(pane);
    await called(one, "pane_spawn", { paneId: pane, cli: BASH, argv: ["-c", FOREVER] });

    const quiet = await called(one, "pane_read", { paneId: pane });
    expect(failedIn(quiet)).toBe(false);
    expect(payloadIn(quiet).output).toBe("");
    expect(payloadIn(quiet).dropped).toBe(0);
    expect(payloadIn(quiet).status).toBe("starting");

    const absent = await called(one, "pane_read", { paneId: "pane-never-opened" });
    expect(failedIn(absent)).toBe(true);
    expect(payloadIn(absent).error).toBe("UnknownPaneError");
  });

  it("reports what it evicted, and keeps the newest end", async () => {
    // The control: without `dropped` in the answer, a reader cannot tell a bounded window from the whole
    // output, and this assertion is what fails.
    const one = planeOver("evicted", { maxPaneBytes: 300 });
    const pane = paneId("pane-loud");
    one.opened.push(pane);

    // The Pane stays alive after the burst, and that is not padding. A process that exits immediately
    // after writing 9 KB races the terminal: measured on this host, the master stopped delivering at
    // exactly 4095 bytes when the child exited with the pty still buffered, so the tail was lost. That
    // is a finding about the process table rather than about this module, and a test that depended on
    // it would be flaky for a reason with nothing to do with eviction.
    await called(one, "pane_spawn", {
      paneId: pane,
      cli: BASH,
      argv: [
        "-c",
        `for i in $(seq 1 200); do echo "line-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; done; echo DONE; ${FOREVER}`,
      ],
    });

    expect(await until(() => one.wrote(pane).includes("DONE"))).toBe(true);
    await rested(150);

    const response = await called(one, "pane_read", { paneId: pane });
    const output = String(payloadIn(response).output);
    const whole = one.wrote(pane);

    expect(whole.length).toBeGreaterThan(5_000);
    expect(output.length).toBeLessThan(whole.length);
    expect(Number(payloadIn(response).dropped)).toBeGreaterThan(0);
    // The newest end, whole chunks, so what a reader gets is a suffix of what the Pane wrote.
    expect(whole.endsWith(output)).toBe(true);
    expect(output).toContain("DONE");
  });

  it("says a Pane delivered, which is how a caller learns keystrokes went nowhere", async () => {
    const one = planeOver("delivered");
    const pane = paneId("pane-brief");
    one.opened.push(pane);

    await called(one, "pane_spawn", { paneId: pane, cli: BASH, argv: ["-c", "echo bye"] });

    let status = "";
    const stop = Date.now() + 10_000;
    while (Date.now() < stop && status !== "delivered") {
      status = String(payloadIn(await called(one, "pane_read", { paneId: pane })).status ?? "");
      if (status !== "delivered") {
        await rested(25);
      }
    }
    expect(status).toBe("delivered");

    const written = await called(one, "pane_write", { paneId: pane, keystrokes: "into the void" });
    expect(failedIn(written)).toBe(false);
    expect(payloadIn(written).status).toBe("delivered");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 9, second half: handoff_submit takes effect on the Replay on disk
 * ---------------------------------------------------------------------------------------------- */

describe("handoff_submit (criterion 9)", () => {
  it("records an accepted Handoff, and a fresh store over the same folder reads it back", async () => {
    const one = planeOver("handoff-accepted");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "handoff_submit", {
      delegationId: FIRST,
      satisfies: [RENDERS],
      gaps: [{ clauseId: TESTED, reason: "no real process in this cut" }],
      artifacts: ["cockpit/view/pane.tsx"],
    });

    expect(failedIn(response)).toBe(false);
    const entry = objectIn(payloadIn(response).entry, "entry");
    expect(objectIn(entry.decision, "decision").kind).toBe("accepted");

    // Read back from the disk, through a store this test built a moment ago and nothing else touched.
    const replay = await reopened(one);
    expect(replay).toHaveLength(3);

    const state = stateOf(replay);
    expect(isOpened(state)).toBe(true);
    if (!isOpened(state)) {
      throw new Error("the Mission on disk is not open");
    }
    const delegation = state.delegations.find((made) => made.id === FIRST);
    expect(delegation).toBeDefined();
    expect(delegation === undefined ? true : isOpenDelegation(delegation)).toBe(false);
    expect(delegation?.handoff?.artifacts).toEqual(["cockpit/view/pane.tsx"]);

    const steps = stepsOf(replay);
    expect(eventsIn(steps, "handoff-accepted")).toHaveLength(1);
    expect(steps[2].ordinal).toBe(3);
  });

  it("answers a Refusal with every violation, and the attempt is on disk", async () => {
    const one = planeOver("handoff-refused");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "handoff_submit", {
      delegationId: FIRST,
      satisfies: [],
      gaps: [],
      artifacts: [],
    });

    // A Refusal is data, so the tool did not fail: the domain answered.
    expect(failedIn(response)).toBe(false);
    const decision = objectIn(objectIn(payloadIn(response).entry, "entry").decision, "decision");
    expect(decision.kind).toBe("refused");

    const refusal = objectIn(decision.refusal, "refusal");
    expect(refusal.reason).toBe("contract-violation");
    // The whole list: a Handoff that satisfies nothing breaks the required Clause **and** says nothing
    // about the optional one. Asserting the first entry would hide the second.
    const violations = listIn(refusal.violations, "violations");
    expect(violations).toHaveLength(2);
    expect(violations.join(" | ")).toContain(RENDERS);
    expect(violations.join(" | ")).toContain(TESTED);

    // The Delegation is still open: a Refusal settles nothing, and the Zord submits again.
    const replay = await reopened(one);
    expect(replay).toHaveLength(3);
    const state = stateOf(replay);
    if (!isOpened(state)) {
      throw new Error("the Mission on disk is not open");
    }
    const delegation = state.delegations.find((made) => made.id === FIRST);
    expect(delegation === undefined ? false : isOpenDelegation(delegation)).toBe(true);
  });

  it("keeps a refused attempt in the Replay, so `refusedIn` has something to read", async () => {
    const one = planeOver("refused-then-accepted");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    await called(one, "handoff_submit", { delegationId: FIRST, satisfies: [], gaps: [], artifacts: [] });
    await called(one, "handoff_submit", {
      delegationId: FIRST,
      satisfies: [RENDERS, TESTED],
      gaps: [],
      artifacts: ["proof.md"],
    });

    const replay = await reopened(one);
    expect(replay).toHaveLength(4);
    // The loop criterion 3 promises, on disk: refused, told what broke, submitted again, accepted.
    const kinds = replay.map((entry) => entry.decision.kind);
    expect(kinds).toEqual(["accepted", "accepted", "refused", "accepted"]);
    expect(stateOf(replay).status).toBe("running");
  });

  it("refuses a Handoff that is not a claim anybody can judge, before it becomes an intent", async () => {
    const one = planeOver("unbuildable");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "handoff_submit", {
      delegationId: FIRST,
      satisfies: [RENDERS, RENDERS],
      gaps: [],
      artifacts: [],
    });

    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("InvalidHandoffError");
    // Stated as a finding rather than hidden: an unbuildable Handoff leaves no entry, while one that
    // merely breaks its Contract leaves a refused one.
    expect(await reopened(one)).toHaveLength(2);
  });

  it("refuses a Gap that names no Clause, in the Handoff's own words", async () => {
    const one = planeOver("gapless-gap");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "handoff_submit", {
      delegationId: FIRST,
      satisfies: [RENDERS],
      gaps: [{ clauseId: " ", reason: "ran out of time" }],
      artifacts: [],
    });

    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("InvalidGapError");
  });
});

/* -------------------------------------------------------------------------------------------------
 * mission_create
 * ---------------------------------------------------------------------------------------------- */

describe("mission_create", () => {
  it("opens the Mission this control plane is on, and only that one", async () => {
    const one = planeOver("create");
    const response = await called(one, "mission_create", {
      briefing: "A Cockpit that runs real Zords",
      mode: "combination",
      capCents: 5_000,
      capabilities: ["delegate", "consolidate"],
    });

    expect(failedIn(response)).toBe(false);
    const replay = await reopened(one);
    const state = stateOf(replay);
    expect(state.status).toBe("running");
    if (!isOpened(state)) {
      throw new Error("the Mission on disk is not open");
    }
    // Not an argument, so there is nothing to disagree with the file's name.
    expect(state.id).toBe(MISSION);
    expect(state.core.capabilities.map((held) => held.name)).toEqual(["delegate", "consolidate"]);
  });

  it("relays the engine's Refusal when the Mission is already open", async () => {
    const one = planeOver("create-twice");
    await recorded(one, [OPEN_MISSION]);

    const response = await called(one, "mission_create", {
      briefing: "again",
      mode: "free",
      capCents: 100,
      capabilities: [],
    });

    expect(failedIn(response)).toBe(false);
    const decision = objectIn(objectIn(payloadIn(response).entry, "entry").decision, "decision");
    expect(decision.kind).toBe("refused");
    expect(objectIn(decision.refusal, "refusal").reason).toBe("illegal-transition");
  });

  it("refuses to give the Core an executing capability", async () => {
    const one = planeOver("armed-core");
    const response = await called(one, "mission_create", {
      briefing: "x",
      mode: "free",
      capCents: 100,
      capabilities: ["spawn-process"],
    });

    expect(failedIn(response)).toBe(true);
    // `core()` owns the invariant, at both levels, and this is its runtime half answering — reached
    // through a name that came off the wire, which is the only way an executing one could arrive.
    expect(payloadIn(response).error).toBe("ExecutionCapabilityError");
    expect(await reopened(one)).toHaveLength(0);
  });

  it("refuses a capability no registry has, rather than proving it non-executing", async () => {
    const one = planeOver("unknown-capability");
    const response = await called(one, "mission_create", {
      briefing: "x",
      mode: "free",
      capCents: 100,
      capabilities: ["write-file"],
    });

    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnknownCapabilityError");
    expect(await reopened(one)).toHaveLength(0);
  });

  it("refuses a Cap that is not whole cents, in the Money constructor's words", async () => {
    const one = planeOver("fractional-cap");
    const response = await called(one, "mission_create", {
      briefing: "x",
      mode: "free",
      capCents: 10.5,
      capabilities: [],
    });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("InvalidMoneyError");
  });
});

/* -------------------------------------------------------------------------------------------------
 * memory_write and memory_read
 * ---------------------------------------------------------------------------------------------- */

describe("the Cortex", () => {
  it("attributes a Fact to this Zord and this Mission, neither of them an argument", async () => {
    const one = planeOver("attributed");
    const response = await called(one, "memory_write", {
      subject: "  Cockpit  Panes ",
      body: "a Pane is one pty with one Zord in it",
    });

    expect(failedIn(response)).toBe(false);
    const fact = objectIn(payloadIn(response).fact, "fact");
    expect(fact.zordId).toBe(BUILDER);
    expect(fact.missionId).toBe(MISSION);
    // Normalised by the Cortex, and answered as recorded rather than as sent.
    expect(fact.subject).toBe("cockpit panes");
    expect(typeof fact.recordedAt).toBe("string");
    expect(String(fact.recordedAt)).toContain("2026-08-06T12:00");
  });

  it("reads back what was written, with its subjects and its damage", async () => {
    const one = planeOver("read-back");
    await called(one, "memory_write", { subject: "panes", body: "one pty each" });
    await called(one, "memory_write", { subject: "PANES", body: "killed by process group" });
    await called(one, "memory_write", { subject: "cortex", body: "one file per Workspace" });

    const response = await called(one, "memory_read", {});
    const answer = payloadIn(response);
    expect(listIn(answer.facts, "facts")).toHaveLength(3);
    // The navigation the Cortex was built for, derived with the engine's own reader.
    expect(answer.subjects).toEqual([
      { subject: "cortex", facts: 1 },
      { subject: "panes", facts: 2 },
    ]);
    expect(answer.unreadable).toEqual([]);

    const narrowed = await called(one, "memory_read", { subject: "Panes", limit: 1 });
    const facts = listIn(payloadIn(narrowed).facts, "facts");
    expect(facts).toHaveLength(1);
    expect(objectIn(facts[0], "a Fact").body).toBe("killed by process group");
  });

  it("filters by another Zord, because reading is not claiming", async () => {
    const one = planeOver("other-zord");
    await called(one, "memory_write", { subject: "panes", body: "written by the builder" });

    const mine = await called(one, "memory_read", { zordId: BUILDER });
    expect(listIn(payloadIn(mine).facts, "facts")).toHaveLength(1);

    const theirs = await called(one, "memory_read", { zordId: SCOUT });
    expect(listIn(payloadIn(theirs).facts, "facts")).toHaveLength(0);
  });

  it("relays a query the Cortex cannot be asked", async () => {
    const one = planeOver("bad-query");
    const response = await called(one, "memory_read", { limit: -1 });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("InvalidFactQueryError");
  });
});

/* -------------------------------------------------------------------------------------------------
 * agent_invoke
 * ---------------------------------------------------------------------------------------------- */

describe("agent_invoke", () => {
  it("runs the Zord with the Harness the Delegation recorded, and accrues what it cost", async () => {
    const one = planeOver("invoke", {
      script: [{ output: "I drew the Pane.\r\n", cost: moneyFromCents(250) }],
    });
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "agent_invoke", {
      delegationId: FIRST,
      instruction: "Draw one Pane per Zord, then submit your Handoff.",
    });

    expect(failedIn(response)).toBe(false);
    expect(payloadIn(response).output).toBe("I drew the Pane.\r\n");
    expect(payloadIn(response).costCents).toBe(250);

    // The Harness came off the fact, never re-resolved.
    expect(one.runner.calls).toHaveLength(1);
    expect(one.runner.calls[0].harness).toEqual(CATALOG_DEFAULT);
    expect(one.runner.calls[0].instruction).toContain("submit your Handoff");

    // The Meter knows about it, from disk.
    const replay = await reopened(one);
    expect(replay).toHaveLength(3);
    const accruals = eventsIn(stepsOf(replay), "cost-accrued");
    expect(accruals).toHaveLength(1);
    expect(accruals[0].delegationId).toBe(FIRST);
    const state = stateOf(replay);
    if (!isOpened(state)) {
      throw new Error("the Mission on disk is not open");
    }
    expect(state.spent).toBe(moneyFromCents(250));
  });

  it("records a zero cost rather than skipping it, because the run still happened", async () => {
    const one = planeOver("zero-cost", {
      script: [{ output: "done", cost: moneyFromCents(0) }],
    });
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    await called(one, "agent_invoke", { delegationId: FIRST, instruction: "go" });
    expect(eventsIn(stepsOf(await reopened(one)), "cost-accrued")).toHaveLength(1);
  });

  it("refuses a Delegation this Mission never made, and runs nothing", async () => {
    const one = planeOver("no-delegation", {
      script: [{ output: "should never run", cost: moneyFromCents(1) }],
    });
    await recorded(one, [OPEN_MISSION]);

    const response = await called(one, "agent_invoke", { delegationId: "delegation-nowhere", instruction: "go" });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnknownDelegationError");
    expect(String(payloadIn(response).detail)).toContain("made by the Core");
    expect(one.runner.calls).toHaveLength(0);
    expect(await reopened(one)).toHaveLength(1);
  });

  it("refuses a recorded Harness that names no cli, before a runner is handed it", async () => {
    // The Harness comes off a file the store deliberately does not judge. Read as `unknown` here, because
    // a runner is an implementation of a port: the fake dereferences `asked.harness.cli` in its own error
    // message, so an absent Harness would throw out of a tool rather than answer one.
    const one = planeOver("harness-lost", {
      script: [{ output: "should never run", cost: moneyFromCents(1) }],
    });
    await recorded(one, [OPEN_MISSION]);
    await one.store.append(MISSION, handWritten());

    const response = await called(one, "agent_invoke", { delegationId: FIRST, instruction: "go" });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnrunnableHarnessError");
    expect(one.runner.calls).toHaveLength(0);
  });

  it("refuses a recorded Harness that is an object with no cli in it", async () => {
    // The second half of the same guard, and it needs its own fixture: a Harness that is *absent* is
    // caught by the object check above, so a Harness that is present and says nothing about which
    // program to run is the only thing that exercises this branch. Without it the branch is a check
    // that can only pass.
    const one = planeOver("harness-cli-less", {
      script: [{ output: "should never run", cost: moneyFromCents(1) }],
    });
    await recorded(one, [OPEN_MISSION]);
    await one.store.append(MISSION, handWritten({ model: "sonnet", effort: "medium", skills: [] }));

    const response = await called(one, "agent_invoke", { delegationId: FIRST, instruction: "go" });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnrunnableHarnessError");
    expect(String(payloadIn(response).detail)).toContain("names no cli");
    expect(one.runner.calls).toHaveLength(0);
  });

  it("answers a runner that failed, and accrues nothing", async () => {
    // The fake is scripted for no runs, so the first call rejects. A failed run carries no cost — the pty
    // runner's own decision, inherited and declared.
    const one = planeOver("runner-failed");
    await recorded(one, [OPEN_MISSION, DELEGATE]);

    const response = await called(one, "agent_invoke", { delegationId: FIRST, instruction: "go" });
    expect(failedIn(response)).toBe(true);
    expect(payloadIn(response).error).toBe("UnscriptedRunError");
    expect(await reopened(one)).toHaveLength(2);
  });
});

/**
 * A `Delegated` fact whose Harness was lost, written by hand.
 *
 * The store casts what it loads and the engine copies a Harness onto the Delegation, so this is exactly
 * the value a hand-edited or truncated Replay produces. It is not reachable through `decide`. The
 * parameter is what the Harness became: absent when nothing is passed, and a bundle naming no program
 * when a partial one is.
 */
function handWritten(lostHarness?: unknown): ReplayEntry {
  return {
    command: {
      kind: "delegate",
      occurredAt: at(2),
      delegationId: FIRST,
      zordId: SCOUT,
      slice: slice("Draw one Pane per Zord"),
      harnessSources: { catalogDefault: CATALOG_DEFAULT },
      contract: REFERENCE_CONTRACT,
    },
    decision: {
      kind: "accepted",
      events: [
        {
          kind: "delegated",
          missionId: MISSION,
          occurredAt: at(2),
          delegationId: FIRST,
          zordId: SCOUT,
          slice: slice("Draw one Pane per Zord"),
          // The whole point of this fixture: absent by default, and present-but-cli-less on request.
          harness: lostHarness as typeof CATALOG_DEFAULT,
          contract: REFERENCE_CONTRACT,
        },
      ],
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * The clock
 * ---------------------------------------------------------------------------------------------- */

describe("the clock is injected, and its answer is not trusted", () => {
  it("reports a clock that answers something that is not an Instant as this host's fault", async () => {
    const one = planeOver("bad-clock", { now: () => "" as Instant });
    const response = await called(one, "memory_write", { subject: "s", body: "b" });
    // Not a tool error: the caller did nothing wrong and can do nothing about it.
    expect(response.result).toBeUndefined();
    expect(errorIn(response).code).toBe(-32603);
    expect(String(errorIn(response).message)).toContain("clock");
  });

  it("reports a clock that throws the same way, rather than rejecting", async () => {
    const one = planeOver("throwing-clock", {
      now: () => {
        throw new Error("no clock on this host");
      },
    });
    const response = await called(one, "memory_write", { subject: "s", body: "b" });
    expect(errorIn(response).code).toBe(-32603);
    expect(String(errorIn(response).message)).toContain("no clock on this host");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Type-level guarantees
 * ---------------------------------------------------------------------------------------------- */

describe("type-level guarantees", () => {
  /** A complete, valid set of options, so each probe below differs from it in exactly one way. */
  function goodOptions(): ControlPlaneOptions {
    const root = workspace("probe");
    return {
      missionId: MISSION,
      zordId: BUILDER,
      workspace: root,
      writer: missionWriter({ store: missionStore({ workspace: root }) }),
      panes: paneManager({ env: ENV, idleAfterMs: 400 }),
      cortex: cortexStore({ workspace: root }),
      runner: fakeAgentRunner([]),
      now: clock(),
      maxPaneBytes: 1_024,
    };
  }

  it("requires the Zord this control plane speaks for", () => {
    const probe = (): ControlPlane => {
      const without: Omit<ControlPlaneOptions, "zordId"> = goodOptions();
      // @ts-expect-error — zordId is required: a Fact carries the Zord that wrote it, and a Zord must
      // not be able to say it was somebody else, so identity is configuration and never an argument.
      return controlPlane(without);
    };
    expect(typeof probe).toBe("function");
  });

  it("requires the Workspace a Pane runs in", () => {
    const probe = (): ControlPlane => {
      const without: Omit<ControlPlaneOptions, "workspace"> = goodOptions();
      // @ts-expect-error — workspace is required and never defaulted to process.cwd(): a Zord runs
      // inside a Workspace, not wherever the process that hosts it happened to start.
      return controlPlane(without);
    };
    expect(typeof probe).toBe("function");
  });

  it("requires the clock, because time enters the domain on a Command", () => {
    const probe = (): ControlPlane => {
      const without: Omit<ControlPlaneOptions, "now"> = goodOptions();
      // @ts-expect-error — now is required: nothing in engine/ reads a clock, so a Surface must say
      // where time comes from rather than have one guessed for it.
      return controlPlane(without);
    };
    expect(typeof probe).toBe("function");
  });

  it("requires the runner agent_invoke hands a Harness to", () => {
    const probe = (): ControlPlane => {
      const without: Omit<ControlPlaneOptions, "runner"> = goodOptions();
      // @ts-expect-error — runner is required: the real one needs node-pty and a flag mapping nobody
      // can write once for every CLI, so it is injected and never built here.
      return controlPlane(without);
    };
    expect(typeof probe).toBe("function");
  });

  it("requires the bound on what pane_read keeps", () => {
    const probe = (): ControlPlane => {
      const without: Omit<ControlPlaneOptions, "maxPaneBytes"> = goodOptions();
      // @ts-expect-error — maxPaneBytes is required: it is half of what pane_read answers, and a
      // default would be this module choosing invisibly how much of a Zord's work is forgotten.
      return controlPlane(without);
    };
    expect(typeof probe).toBe("function");
  });

  it("takes no directory to run a Pane in", () => {
    const probe = (): ControlPlane =>
      controlPlane({
        ...goodOptions(),
        // @ts-expect-error — there is no cwd option: a Pane runs in the Workspace, and a second way to
        // say where would be the one a caller reaches for.
        cwd: "/tmp",
      });
    expect(typeof probe).toBe("function");
  });

  it("hands out a list of tools nothing can add to", () => {
    const one = planeOver("readonly-tools");
    const probe = (): void => {
      // @ts-expect-error — `tools` is readonly: it is the same list tools/list answers, and a caller
      // that could push onto it would make the two disagree. Frozen at runtime as well, which is why
      // this probe sits in a function nobody calls.
      one.plane.tools.push(TOOLS[0]);
    };
    expect(typeof probe).toBe("function");
  });

  it("names the eight tools in the type, not merely in a string", () => {
    const named: ToolName = "pane_spawn";
    expect(named).toBe("pane_spawn");
    const probe = (): ToolName =>
      // @ts-expect-error — ToolName is the eight the PRD pins; a ninth is not one of them.
      "pane_list";
    expect(typeof probe).toBe("function");
  });

  it("answers a frame with a string or with nothing, and the caller must handle both", () => {
    const one = planeOver("handle-answer");
    const probe = async (): Promise<string> =>
      // @ts-expect-error — handle answers `string | undefined`: a notification has no reply, and a
      // caller that assumed a string would write `undefined` onto its transport.
      one.plane.handle("{}");
    expect(typeof probe).toBe("function");
  });

  it("is a ControlPlane, which no directive can phrase", () => {
    // Assignability cannot be written as a @ts-expect-error, so the proof is the annotation and its
    // falsification is the build failing.
    const one = planeOver("assignable");
    const asPlane: ControlPlane = one.plane;
    expect(typeof asPlane.handle).toBe("function");
    expect(asPlane.tools).toHaveLength(8);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing left behind
 * ---------------------------------------------------------------------------------------------- */

describe("nothing is left behind", () => {
  it.skipIf(!ON_LINUX)("leaves no stray holdout from any test in this file", () => {
    const listed = execFileSync("ps", ["-e", "-o", "args="], { encoding: "utf8" });
    expect(listed).not.toContain("sleep 293");
  });
});
