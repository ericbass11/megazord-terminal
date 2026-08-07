/**
 * The product, running. Criterion 1 and criterion 5, with nothing stubbed on either path.
 *
 * **Criterion 1 is proven against the program**, not against `startCockpit`: a child process is spawned on
 * `bin/mz.ts` exactly as a human runs it, its own banner is read for the URL it printed, and the view is
 * fetched from there. That is what "reachable with no further steps" means — no build, no install, no
 * second command — and it is also the only thing that proves the resolver `mz` installs for the
 * `@engine/*` alias works, because Vitest resolves that alias itself and would hide the question.
 *
 * **Criterion 5 is proven with real processes submitting their own Handoffs.** The Zord is a `bash` script
 * — a legitimate stand-in, because what makes something a Zord here is the Harness it ran under and the
 * Handoff it delivered, not the name of its binary — and the way it delivers is the whole point:
 *
 * ```
 *   drive ──ptyAgentRunner──▶ bash ──pipe──▶ node bin/mz.ts mcp ──POST /mcp/<zord>──▶ control plane
 *                              │                (the stdio transport)                      │
 *                              └── reads its instruction, finds what its last Handoff broke │
 *                                                                                    the Replay on disk
 * ```
 *
 * Nothing in that chain is a test double. ADR 0010 says a Handoff is built by the Zord that delivers it,
 * and here a **process** builds it: it reads the Delegation it answers out of the text it was handed, and
 * on the second attempt it reads the violations the engine produced and fixes what it claimed. The
 * driver's own tests had the test playing that part; this file makes the process play it.
 *
 * The human plays their part through the Cockpit too: the Gate is answered over a real WebSocket to the
 * running server, which is the gesture the view makes.
 *
 * **The holdout process here sleeps 291 seconds, and that is the fourth spelling in this repository.**
 * `pty-agent-runner.test.ts` asserts no `sleep 300` exists on the host, `pane-manager.test.ts` uses 297 and
 * `mcp-server.test.ts` uses 293, all for the same reason: Vitest runs files in parallel workers, so a
 * fifth file that leaves a live holdout needs a fifth number or it fails somebody else's cleanliness check
 * in a test that names no cause. The last test here asserts no `sleep 291` survived this file.
 *
 * One trap this file is written around, because it cost an hour: in `cmd & PID=$!`, a shell reports the
 * **subshell's** pid when the backgrounded thing is a compound list, so a signal sent to it never reaches
 * the program and the program is left running. Everything here holds the pid `child_process.spawn`
 * returned, and the cleanliness check at the end is what would notice if that ever stopped being true.
 */

import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  briefing,
  clause,
  clauseId,
  contract,
  core as coreOf,
  delegationId,
  eventsIn,
  gateId,
  harness,
  instantFromDate,
  isOpenDelegation,
  meterOf,
  missionId,
  moneyFromCents,
  orchestrationCapability,
  refusedIn,
  revisionsIn,
  slice,
  stateOf,
  stepsOf,
  zordId,
  type Briefing,
  type Contract,
  type GateId,
  type Harness,
  type HarnessSources,
  type Instant,
  type MissionId,
  type ZordId,
  type AgentRunner,
} from "@engine/index";

import type { ToCockpit } from "./protocol";

import { drive, type Combination, type DriveOptions, type RosterEntry } from "../runtime/combination-driver";
import { controlPlane, type ControlPlane } from "../runtime/mcp-server";
import { missionStore, type MissionStore } from "../runtime/mission-store";
import { missionWriter, type MissionWriter } from "../runtime/mission-writer";
import type { PaneManager } from "../runtime/pane-manager";
import { cortexStore } from "../runtime/cortex-store";
import { inheritedEnv, ptyAgentRunner } from "../runtime/pty-agent-runner";
import { startCockpit, refusingArguments, type RunningCockpit } from "../bin/mz";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const MZ = join(REPO, "bin", "mz.ts");
const BASH = "/bin/bash";

/** Long enough that nothing ends on its own, and spelled differently from the other three files. */
const FOREVER = "sleep 291";

/** Exactly the variables a shell needs to be itself. Nothing else of this process reaches a Zord. */
const SHELL_ENV = inheritedEnv(["PATH", "HOME"]);

/** A process table nothing touches: the two control planes of the finding below open no Pane. */
const NO_PANES: PaneManager = {
  spawn() {
    throw new Error("no Pane is opened by the two writers");
  },
  write() {
    throw new Error("no Pane is written to by the two writers");
  },
  async kill() {
    throw new Error("no Pane is killed by the two writers");
  },
  onData() {
    // Nothing streams into these.
  },
  onStatus() {
    // Nothing changes status in these.
  },
};

/** And no Zord is invoked either: `mission_create` is the whole of what the finding submits. */
const NEVER_RUN: AgentRunner = {
  async run() {
    throw new Error("no Zord is invoked by the two writers");
  },
};

/* -------------------------------------------------------------------------------------------------
 * Workspaces, and what must not survive one
 * ---------------------------------------------------------------------------------------------- */

const workspaces: string[] = [];
const running: RunningCockpit[] = [];
const programs: Watched[] = [];

function temporary(): string {
  const workspace = mkdtempSync(join(tmpdir(), "megazord-cockpit-"));
  workspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.allSettled(running.splice(0).map((cockpit) => cockpit.close()));
  for (const program of programs.splice(0)) {
    program.kill("SIGKILL");
  }
});

afterAll(() => {
  for (const workspace of workspaces) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/** A Cockpit started in this process, closed after the test whatever it did. */
async function cockpitOn(
  workspace: string,
  options: Partial<Parameters<typeof startCockpit>[0]> = {},
): Promise<RunningCockpit> {
  const cockpit = await startCockpit({
    workspace,
    missionId: MISSION,
    argumentsFor: refusingArguments,
    ...options,
  });
  running.push(cockpit);
  return cockpit;
}

/* -------------------------------------------------------------------------------------------------
 * Criterion 1 — the program
 * ---------------------------------------------------------------------------------------------- */

/** A spawned `mz`, with the two streams this file reads. */
type Watched = ChildProcessByStdio<null, Readable, Readable>;

type Program = {
  readonly child: Watched;
  readonly url: string;
  readonly banner: string;
  /** Sends `SIGINT` the way a human's Ctrl-C does, and answers the exit code. */
  ended(): Promise<number | null>;
};

/**
 * `mz` as a human runs it: a child process on the file `package.json` points `bin` at.
 *
 * Started through `process.execPath` rather than through the shebang, so the test does not depend on how
 * this host resolves `/usr/bin/env -S`. The shebang itself is asserted separately.
 */
async function startProgram(
  args: readonly string[],
  env: Readonly<Record<string, string>> = SHELL_ENV,
): Promise<Program> {
  const child = spawn(process.execPath, [MZ, ...args], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  programs.push(child);

  let banner = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    banner += chunk;
  });
  let complained = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    complained += chunk;
  });

  const url = await until(
    () => /^Cockpit {4}(\S+)$/mu.exec(banner)?.[1],
    () => `mz printed no Cockpit line.\nstdout:\n${banner}\nstderr:\n${complained}`,
  );

  return {
    child,
    url,
    get banner() {
      return banner;
    },
    async ended(): Promise<number | null> {
      const stopping = new Promise<number | null>((stopped) => {
        child.once("exit", (code: number | null) => stopped(code));
      });
      child.kill("SIGINT");
      return stopping;
    },
  };
}

/** The exit code and the two streams of a program that was expected to end on its own. */
async function ranToCompletion(
  args: readonly string[],
  env: Readonly<Record<string, string>> = SHELL_ENV,
): Promise<{ code: number | null; out: string; err: string }> {
  const child = spawn(process.execPath, [MZ, ...args], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  programs.push(child);

  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
  });

  const code = await new Promise<number | null>((exited) => {
    child.once("exit", (status: number | null) => exited(status));
  });
  return { code, out, err };
}

describe("criterion 1 — mz starts the Cockpit and it is reachable with no further steps", () => {
  it("prints where it is, serves the view there, and answers the control plane on the same port", async () => {
    const workspace = temporary();

    const program = await startProgram([workspace]);

    // What a human is told. The URL is read out of this, which is the same act as reading it off a
    // terminal and clicking it.
    expect(program.banner).toContain(`Workspace  ${workspace}`);
    expect(program.banner).toContain("Mission    mission-1");
    expect(program.banner).toContain("Control    ");
    expect(program.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);

    const view = await fetch(program.url);
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const document = await view.text();
    expect(document).toContain("<title>Cockpit — Megazord Terminal</title>");
    expect(document).toContain('<main id="cockpit">');

    // The second half of "reachable": the control plane is on the same port, in the same process, with
    // nothing else started. Task 7 wrote the protocol and left both transports here.
    const listed = await frameTo(`${program.url}mcp/scout`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(namesIn(listed)).toEqual([
      "pane_spawn",
      "pane_write",
      "pane_read",
      "handoff_submit",
      "mission_create",
      "memory_write",
      "memory_read",
      "agent_invoke",
    ]);

    expect(await program.ended()).toBe(0);
    await expect(fetch(program.url)).rejects.toThrow();
  });

  it("discovers its providers from the PATH it was started with", async () => {
    const workspace = temporary();
    // A PATH holding one CLI named after a real provider, and nothing else. Criterion 11 is proven in
    // `providers.test.ts`; what this proves is that the program is wired to the lookup rather than to a
    // list of its own.
    const elsewhere = temporary();
    execFileSync(BASH, ["-c", `printf '#!/bin/sh\\nexit 0\\n' > "${elsewhere}/codex" && chmod +x "${elsewhere}/codex"`]);

    const program = await startProgram([workspace], { ...SHELL_ENV, PATH: elsewhere });

    expect(program.banner).toContain(`Providers  codex (${elsewhere}/codex)`);
    expect(program.banner).toContain("Not found  claude, gemini");
    await program.ended();
  });

  it("refuses a Workspace that is not one, and says how it is used", async () => {
    const notADirectory = join(temporary(), "a-file");
    execFileSync(BASH, ["-c", `echo hello > "${notADirectory}"`]);

    const refused = await ranToCompletion([notADirectory]);

    expect(refused.code).toBe(2);
    expect(refused.err).toContain("is not a directory, and a Workspace is one");

    const asked = await ranToCompletion(["--help"]);
    expect(asked.code).toBe(0);
    expect(asked.out).toContain("mz mcp");
  });

  it("is what package.json points at, and says how to run a .ts file", () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      readonly bin?: Readonly<Record<string, string>>;
    };

    expect(manifest.bin).toEqual({ mz: "bin/mz.ts" });
    // Node strips types by itself from 22.18, and the flag is what makes the same file run on 22.6
    // through 22.17. It is spelled with `env -S` because a shebang carries one argument otherwise.
    expect(readFileSync(MZ, "utf8").split("\n")[0]).toBe("#!/usr/bin/env -S node --experimental-strip-types");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The recipe criterion 5 drives
 * ---------------------------------------------------------------------------------------------- */

const MISSION: MissionId = missionId("cockpit-e2e");
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

/** The Harness a Zord really runs under here: `bash` is the CLI, and the Replay records exactly that. */
const CATALOG: Harness = harness({ cli: BASH, model: "a shell has no model", effort: "medium", skills: [] });

const SURVEY_CONTRACT: Contract = contract([
  clause({ id: REPORTED, description: "a written report of what the Workspace holds", required: true }),
  clause({ id: NOTED, description: "notes on whatever was surprising", required: false }),
]);
const BUILD_CONTRACT: Contract = contract([
  clause({ id: CODED, description: "the module and the test beside it", required: true }),
]);

const SURVEY_SOURCES: HarnessSources = { catalogDefault: CATALOG };
const BUILD_SOURCES: HarnessSources = { catalogDefault: CATALOG, rosterEntry: { effort: "low" } };

function surveyEntry(): RosterEntry {
  return {
    delegationId: SURVEY,
    zordId: SCOUT,
    slice: slice("say what the Workspace holds, in writing"),
    harnessSources: SURVEY_SOURCES,
    contract: SURVEY_CONTRACT,
    instruction: "Read the Workspace and write down what it holds.",
  };
}

function buildEntry(): RosterEntry {
  return {
    delegationId: BUILD,
    zordId: BUILDER,
    slice: slice("the module the survey describes, with its test"),
    harnessSources: BUILD_SOURCES,
    contract: BUILD_CONTRACT,
    instruction: "Write the module the survey describes, with a test beside it.",
  };
}

const RECIPE: Combination = {
  name: "survey-then-build",
  roster: [surveyEntry(), buildEntry()],
  gates: [{ gateId: GATE, question: "The survey is in. Build on it?", after: SURVEY }],
  deliverable: "the module the Briefing asked for, surveyed and then built",
};

/**
 * The Zord: a real process that reads its instruction and answers the Delegation named in it.
 *
 * Every decision it makes is one a Zord makes. It works out which Delegation it is answering from the text
 * it was handed; it notices that its last Handoff **was refused** and reads the violations the engine
 * wrote; and it delivers by speaking JSON-RPC at `mz mcp`, which is the transport a real CLI's MCP client
 * uses. Nothing here is told anything by the test.
 *
 * Two frames go down one pipe, which is also what proves the framing carries more than one.
 */
const ZORD = `set -u
instruction="\${1}"
delegation=$(printf '%s\\n' "\${instruction}" | sed -n 's/.*answering Delegation "\\([^"]*\\)".*/\\1/p' | head -n 1)

case "\${delegation}" in
  d-survey) zord=scout ;;
  d-build) zord=builder ;;
  *) echo "this Zord cannot tell which Delegation it answers"; exit 3 ;;
esac

if printf '%s\\n' "\${instruction}" | grep -q 'was refused against its Contract'; then
  echo "the last Handoff was refused; fixing what it broke"
  handoff='{"delegationId":"d-survey","satisfies":["c-report"],"gaps":[{"clauseId":"c-notes","reason":"nothing surprising to write down"}],"artifacts":["docs/survey.md","shared.md"]}'
elif [ "\${delegation}" = "d-survey" ]; then
  echo "delivering a survey that does not cover what it promised"
  handoff='{"delegationId":"d-survey","satisfies":[],"gaps":[{"clauseId":"c-report","reason":"ran out of time"}],"artifacts":[]}'
else
  handoff='{"delegationId":"d-build","satisfies":["c-code"],"gaps":[],"artifacts":["runtime/thing.ts","shared.md"]}'
fi

{
  printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"handoff_submit","arguments":%s}}\\n' "\${handoff}"
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_write","arguments":{"subject":"%s","body":"answered by a real process"}}}\\n' "\${delegation}"
} | "\${MZ_NODE}" "\${MZ_ENTRY}" mcp --zord "\${zord}"

echo "the Zord is done with \${delegation}"
`;

/** A clock that answers one Instant per call, a second apart, so a Replay reads in order. */
function clockFrom(base: number): () => Instant {
  let tick = 0;
  return () => {
    const at = instantFromDate(new Date(base + tick * 1_000));
    tick += 1;
    return at;
  };
}

/* -------------------------------------------------------------------------------------------------
 * Criterion 5 — one Briefing, real processes, a Delivery
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 5 — one Briefing drives real processes to a Delivery", () => {
  it("delegates, is refused by the engine, is answered at a Gate, and delivers, all from disk", async () => {
    const workspace = temporary();
    const now = clockFrom(Date.parse("2026-08-06T11:00:00.000Z"));
    const cockpit = await cockpitOn(workspace, { now });

    // The drive writes through the **Cockpit's own door**, which is what `RunningCockpit.writer` is for: a
    // store of its own would be a second queue over one file, which is the bug this A/B below still pins.
    // The channel between the Core and its Zords is still the file and nothing else — reading is free, and
    // every gesture of the drive, the server and the control plane is ordered against the other two.
    const runner = ptyAgentRunner({
      cwd: workspace,
      env: {
        ...SHELL_ENV,
        MZ_NODE: process.execPath,
        MZ_ENTRY: MZ,
        MEGAZORD_CONTROL_URL: cockpit.controlUrl,
      },
      timeoutMs: 25_000,
      // The instruction reaches the Zord on its command line, so nothing is typed into the terminal.
      instructionDelivery: "arguments",
      argumentsFor: (asked) => ["-c", ZORD, "megazord-zord", asked.instruction],
    });

    const driving: DriveOptions = {
      missionId: MISSION,
      briefing: BRIEFING,
      mode: "combination",
      cap: moneyFromCents(10_000),
      core: CORE,
      combination: RECIPE,
      writer: cockpit.writer,
      runner,
      now,
      settleTimeoutMs: 2_000,
      pollEveryMs: 25,
      maxAttemptsPerDelegation: 3,
    };

    const stopped = await drive(driving);
    expect(stopped.outcome).toEqual({ kind: "halted-at-gate", gateId: GATE });

    // The human answers in the Cockpit: a gesture over the real WebSocket, against the real server.
    const answered = await gestureOn(cockpit, {
      kind: "submit",
      command: { kind: "decide-gate", occurredAt: now(), gateId: GATE, decision: { kind: "approved" } },
    });
    expect(answered.decision.kind).toBe("accepted");

    // A fresh door over a fresh store, as if the app had been closed and `mz .` run again: the drive
    // remembers nothing, and the Mission is the file.
    const resumed = await drive({
      ...driving,
      writer: missionWriter({ store: missionStore({ workspace }) }),
    });
    expect(resumed.outcome).toEqual({ kind: "delivered" });

    /* --- and now the record, read back through a store nothing above ever held --- */

    const replay = await missionStore({ workspace }).load(MISSION);
    const state = stateOf(replay);
    const steps = stepsOf(replay);

    expect(state.status).toBe("delivered");
    if (state.status !== "delivered") {
      throw new Error("unreachable: the assertion above already failed");
    }

    // A real Delegation per Slice, each carrying the Harness `decide` resolved — the one a real process
    // really ran under.
    const made = eventsIn(steps, "delegated");
    expect(made.map((fact) => fact.delegationId)).toEqual([SURVEY, BUILD]);
    expect(made.map((fact) => fact.zordId)).toEqual([SCOUT, BUILDER]);
    expect(made.map((fact) => fact.harness.cli)).toEqual([BASH, BASH]);
    expect(made.map((fact) => fact.harness.effort)).toEqual(["medium", "low"]);
    expect(state.delegations.map(isOpenDelegation)).toEqual([false, false]);

    // The Refusal, on the record, with the whole list: a Handoff that breaks a required Clause usually
    // breaks an optional one too. A process wrote this Handoff and a process fixed it.
    const refused = refusedIn(steps);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.command.kind).toBe("submit-handoff");
    expect(refused[0]?.decision.refusal.reason).toBe("contract-violation");
    expect(refused[0]?.decision.refusal.violations).toEqual([
      'Clause "c-report" ("a written report of what the Workspace holds") is required, so declaring it as a Gap does not excuse it: "ran out of time"',
      'Clause "c-notes" ("notes on whatever was surprising") was not satisfied and was not declared as a Gap',
    ]);
    expect(eventsIn(steps, "handoff-accepted").map((fact) => fact.delegationId)).toEqual([SURVEY, BUILD]);

    // The Gate: raised by the Core, halting the Mission, answered by a human in the Cockpit.
    expect(eventsIn(steps, "gate-raised").map((fact) => fact.gateId)).toEqual([GATE]);
    expect(eventsIn(steps, "mission-halted").map((fact) => fact.halt.reason)).toEqual(["gate-open"]);
    expect(eventsIn(steps, "gate-decided").map((fact) => fact.decision.kind)).toEqual(["approved"]);
    expect(revisionsIn(state.gates)).toEqual([]);

    // The Delivery: the Combination's deliverable, and the artifacts the Handoffs actually carried.
    expect(state.delivery).toEqual({
      summary: "the module the Briefing asked for, surveyed and then built",
      artifacts: ["docs/survey.md", "shared.md", "runtime/thing.ts"],
    });

    // Three runs, three accruals, every one of them **zero** — the real runner's declared zero, which
    // means "no price source exists" and not "this run was free". The Meter says so rather than guessing.
    expect(eventsIn(steps, "cost-accrued")).toHaveLength(3);
    expect(meterOf(state)).toEqual({
      cap: moneyFromCents(10_000),
      spent: moneyFromCents(0),
      perDelegation: [
        { delegationId: SURVEY, spent: moneyFromCents(0) },
        { delegationId: BUILD, spent: moneyFromCents(0) },
      ],
      reached: false,
    });

    // The Replay reads as one sequence with nothing missing in the middle.
    expect(steps.map((step) => step.ordinal)).toEqual(
      Array.from({ length: steps.length }, (_, index) => index + 1),
    );
    expect(steps[0]?.command.kind).toBe("open-mission");
    expect(steps[steps.length - 1]?.command.kind).toBe("deliver-mission");

    // Each Zord wrote a Fact under its own name, through the same bridge, and the Cortex kept who wrote
    // what. That is the identity the mount routes by, measured rather than assumed.
    const remembered = await cortexStore({ workspace }).read();
    expect(remembered.unreadable).toEqual([]);
    expect(remembered.facts.map((fact) => [fact.zordId, fact.subject])).toEqual([
      [SCOUT, "d-survey"],
      [SCOUT, "d-survey"],
      [BUILDER, "d-build"],
    ]);

    /* --- criterion 8's shape, over the Replay this test just produced --- */

    await cockpit.close();
    const reopened = await cockpitOn(workspace, { now });
    const reading = await firstMissionReadingOn(reopened);

    expect(reading.state.status).toBe("delivered");
    expect(reading.meter?.spent).toBe(moneyFromCents(0));
  });
});

/* -------------------------------------------------------------------------------------------------
 * A Pane, opened by a Zord, ended by the exit
 * ---------------------------------------------------------------------------------------------- */

describe("a Pane opened through the mount", () => {
  it("runs in the Workspace, knows where the control plane is, and dies when the Cockpit closes", async () => {
    const workspace = temporary();
    const cockpit = await cockpitOn(workspace);
    const pidfile = join(workspace, "pane.pid");

    const opened = await frameTo(`${cockpit.controlUrl}/scout`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "pane_spawn",
        arguments: {
          paneId: "p-holdout",
          cli: BASH,
          argv: ["-c", `echo "control=\${MEGAZORD_CONTROL_URL}"; echo "cwd=$(pwd)"; echo $BASHPID > "${pidfile}"; ${FOREVER}`],
        },
      },
    });
    expect(resultIn(opened)).toMatchObject({ paneId: "p-holdout", status: "starting" });

    const said = await until(
      async () => {
        const read = await frameTo(`${cockpit.controlUrl}/scout`, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "pane_read", arguments: { paneId: "p-holdout" } },
        });
        const answer = resultIn(read) as { readonly output?: string };
        return answer.output !== undefined && answer.output.includes("cwd=") ? answer.output : undefined;
      },
      () => "the Pane never wrote what it was told to write",
    );

    // The Pane inherited the control URL, which is how a Zord opened in one reaches the control plane at
    // all. The environment is filled in after the port is bound and before anything can spawn; this is the
    // measurement that makes that ordering a mechanism rather than a sentence.
    expect(said).toContain(`control=${cockpit.controlUrl}`);
    expect(said).toContain(`cwd=${workspace}`);

    const leader = Number(readFileSync(pidfile, "utf8").trim());
    expect(isRunning(leader)).toBe(true);

    await cockpit.close();

    // Not "the Cockpit stopped showing it": the process is gone. A Cockpit that exited leaving Zords
    // running would leave them spending.
    await until(
      () => (isRunning(leader) ? undefined : true),
      () => `the Pane's process ${leader} outlived the Cockpit`,
    );
    expect(listedProcesses()).not.toContain(FOREVER);
  });
});

/* -------------------------------------------------------------------------------------------------
 * What the mount refuses to carry
 * ---------------------------------------------------------------------------------------------- */

describe("the control plane's mount", () => {
  it("refuses a page on another origin, which is the only thing standing in front of a fork", async () => {
    const cockpit = await cockpitOn(temporary());

    const foreign = await fetch(`${cockpit.controlUrl}/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(foreign.status).toBe(403);
    // And this Cockpit's own page is not a stranger.
    const own = await fetch(`${cockpit.controlUrl}/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: cockpit.url.replace(/\/$/u, "") },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(own.status).toBe(200);
  });

  it("refuses a media type a cross-origin form could have sent", async () => {
    const cockpit = await cockpitOn(temporary());

    // `text/plain` is a "simple" request: no browser preflights it, so the Origin check alone would be
    // reached only after the body had been carried. Refusing the media type closes the shape entirely.
    const posted = await fetch(`${cockpit.controlUrl}/scout`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(posted.status).toBe(415);
  });

  it("answers a GET with 405 and a notification with 202 and no body", async () => {
    const cockpit = await cockpitOn(temporary());

    expect((await fetch(`${cockpit.controlUrl}/scout`)).status).toBe(405);

    const notified = await fetch(`${cockpit.controlUrl}/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notified.status).toBe(202);
    expect(await notified.text()).toBe("");
  });

  it("refuses an oversized frame rather than truncating it", async () => {
    const cockpit = await cockpitOn(temporary());

    const huge = await fetch(`${cockpit.controlUrl}/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Past the server's own default of one mebibyte, which is what a real client would meet.
      body: `{"jsonrpc":"2.0","id":1,"method":"ping","padding":"${"x".repeat(1024 * 1024 + 1)}"}`,
    });

    expect(huge.status).toBe(413);
    expect(await huge.text()).toContain("refused rather than truncated");
  });

  it("is not there at all on a Cockpit built without one", async () => {
    // `cockpit/server.ts` gained an optional collaborator and no behaviour: with none, `/mcp` is a 404
    // like every other path that holds nothing.
    const { cockpitServer } = await import("./server");
    const workspace = temporary();
    const server = await cockpitServer({
      missionId: MISSION,
      writer: missionWriter({ store: missionStore({ workspace }) }),
      panes: NO_PANES,
      view: "<!doctype html>",
    });

    try {
      const missing = await fetch(`${server.url}mcp/scout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(missing.status).toBe(405);
      expect((await fetch(`${server.url}mcp/scout`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * One door to the Mission file — BUG-1, and the A/B that keeps the fix measurable
 *
 * This was a *pin*: two tests that asserted the lost update, written to go red the day it was fixed. It
 * is fixed — `runtime/mission-writer.ts` — so the assertion is now the other way round, and the A/B
 * shape is kept because it still says something true. One writer over a Workspace orders every gesture
 * of every transport; two writers over one Workspace do not, and that second half is the bound the fix
 * states rather than a defect it left behind.
 *
 * **What is asserted here and what is asserted elsewhere.** These two run the *composed* product, over
 * real transports: a human at a WebSocket and a Zord at the control plane, which `bin/mz.ts` calls "real
 * and ordinary" and which is the pair that bit. They are written around `open-mission`, whose Refusal
 * does not depend on which of the two gestures reaches the queue first — so nothing here rests on a
 * timing this test cannot control. The **expensive half** of the defect — an accrual that reaches the Cap
 * and a Delegation commissioned past it — needs the two gestures in a *known* order, which no transport
 * here can promise without a barrier holding one of them open. It is asserted in
 * `runtime/mission-writer.test.ts`, where the two Commands are two `record` calls and the order is the
 * call order.
 * ---------------------------------------------------------------------------------------------- */

/**
 * One control plane, built the way `mz` builds one, over a door the caller keeps.
 *
 * Nothing about it is a double: this is `runtime/mcp-server.ts` with a process table and a runner nothing
 * ever calls, because `mission_create` touches neither.
 */
function planeFor(zord: ZordId, workspace: string, writer: MissionWriter, now: () => Instant): ControlPlane {
  return controlPlane({
    missionId: MISSION,
    zordId: zord,
    workspace,
    writer,
    panes: NO_PANES,
    cortex: cortexStore({ workspace }),
    runner: NEVER_RUN,
    now,
    maxPaneBytes: 1_024,
  });
}

describe("one door to the Mission file", () => {
  it("orders two Zords' control planes, so the second Decision is made against what the first recorded", async () => {
    const workspace = temporary();
    // One store, one writer, two control planes: exactly the pair `mz` composes, and `missionWriter` would
    // answer this same writer to anybody else who asked for it over this store.
    const writer = missionWriter({ store: missionStore({ workspace }) });
    const now = clockFrom(Date.parse("2026-08-06T11:00:00.000Z"));

    const speaking = [SCOUT, BUILDER].map((zord) => planeFor(zord, workspace, writer, now));
    const [first, second] = await Promise.all(speaking.map((plane) => opening(plane)));

    // Which of the two won the queue is not this test's business — that one of them lost is. Before the
    // fix both were accepted, so the file carried an accepted Decision the fold drops on the floor.
    expect([first, second].sort()).toEqual(["accepted", "refused"]);

    const store = missionStore({ workspace });
    const replay = await store.load(MISSION);
    expect(replay).toHaveLength(2);
    expect(stepsOf(replay).map((step) => step.command.kind)).toEqual(["open-mission", "open-mission"]);
    // One Mission was opened, and the record says so — once as a fact, once as a Refusal.
    expect(eventsIn(stepsOf(replay), "mission-opened")).toHaveLength(1);
    expect(refusedIn(stepsOf(replay))).toHaveLength(1);
    expect(refusedIn(stepsOf(replay))[0]?.decision.refusal.reason).toBe("illegal-transition");
    expect(stateOf(replay).status).toBe("running");
  });

  it("orders a human at the WebSocket against a Zord at the control plane, on the Cockpit mz composes", async () => {
    const workspace = temporary();
    const now = clockFrom(Date.parse("2026-08-06T11:30:00.000Z"));
    // The whole program: one `startCockpit`, whose server and control planes share one door. Nothing here
    // reaches past a transport — one gesture is a WebSocket frame and the other is a POST.
    const cockpit = await cockpitOn(workspace, { now });

    const [human, zord] = await Promise.all([
      gestureOn(cockpit, {
        kind: "submit",
        command: {
          kind: "open-mission",
          occurredAt: now(),
          missionId: MISSION,
          briefing: BRIEFING,
          mode: "combination",
          cap: moneyFromCents(5_000),
          core: CORE,
        },
      }).then((entry) => entry.decision.kind),
      opening(`${cockpit.controlUrl}/scout`),
    ]);

    expect([human, zord].sort()).toEqual(["accepted", "refused"]);

    const replay = await missionStore({ workspace }).load(MISSION);
    expect(eventsIn(stepsOf(replay), "mission-opened")).toHaveLength(1);
    expect(refusedIn(stepsOf(replay))).toHaveLength(1);
  });

  it("does not order two stores over one Workspace, which is the bound the fix states", async () => {
    // The control, and it is what makes the two tests above evidence rather than a description of
    // concurrency. Two `missionStore` instances are two doors, because a writer's identity is its store's
    // — and two *processes* are the same thing seen from outside. Both Decisions are accepted, one Mission
    // is opened, so the file carries an accepted Decision that folds to nothing: precisely the lost update
    // BUG-1 was. Nothing in one process can see the second store, and **one Cockpit per Workspace** is the
    // assumption `mz` meets by construction — `runtime/mission-writer.ts` says so where it can be read.
    const workspace = temporary();
    const now = clockFrom(Date.parse("2026-08-06T12:00:00.000Z"));
    const doors = [SCOUT, BUILDER].map((zord) =>
      planeFor(zord, workspace, missionWriter({ store: missionStore({ workspace }) }), now),
    );

    const [first, second] = await Promise.all(doors.map((plane) => opening(plane)));

    expect([first, second]).toEqual(["accepted", "accepted"]);
    const replay = await missionStore({ workspace }).load(MISSION);
    expect(eventsIn(stepsOf(replay), "mission-opened")).toHaveLength(2);
    expect(refusedIn(stepsOf(replay))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The boundary, and what must not be left behind
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary the entry point keeps", () => {
  it("names the engine's public surface and nothing inside it — ADR 0008", () => {
    // Comments first, for the third time in this repository: a raw scan for `from "…"` finds the module
    // doc's own sentence about telling "run" from "imported" and reports it as a forbidden dependency.
    const source = withoutComments(readFileSync(MZ, "utf8"));
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/gu)].map((found) => found[1] ?? "");

    expect(specifiers.length).toBeGreaterThan(8);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        continue;
      }
      // Everything else is a Node builtin or the engine's front door. `@engine/domain/*` is not part of
      // the Contract, and a dependency would be a decision about which layer is allowed one.
      expect([specifier.startsWith("node:"), specifier === "@engine/index"]).toContain(true);
    }
  });

  it("leaves no Mission and no Cortex in the repository it ran from", () => {
    expect(existsSync(join(REPO, ".megazord"))).toBe(false);
  });

  it("leaves no process of its own alive", () => {
    expect(listedProcesses()).not.toContain(FOREVER);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Talking to a running Cockpit
 * ---------------------------------------------------------------------------------------------- */

/** One control frame over the mount, answered. Throws on anything that is not one answer. */
async function frameTo(url: string, frame: unknown): Promise<unknown> {
  const answered = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(frame),
  });
  const said = await answered.text();
  if (!answered.ok) {
    throw new Error(`${url} answered ${answered.status}: ${said}`);
  }
  return JSON.parse(said) as unknown;
}

/** The `result` of an answered frame, or a failure naming what came back instead. */
function resultIn(answered: unknown): unknown {
  const framed = answered as {
    readonly error?: { readonly message: string };
    readonly result?: { readonly content?: readonly { readonly text: string }[]; readonly isError?: boolean };
  };
  if (framed.error !== undefined || framed.result === undefined) {
    throw new Error(`the control plane refused the frame: ${JSON.stringify(answered)}`);
  }
  const content = framed.result.content;
  if (content === undefined) {
    return framed.result;
  }
  const said = JSON.parse(content[0]?.text ?? "null") as unknown;
  if (framed.result.isError === true) {
    throw new Error(`the tool failed: ${JSON.stringify(said)}`);
  }
  return said;
}

/** The tool names a `tools/list` answered with. */
function namesIn(answered: unknown): readonly string[] {
  const listed = resultIn(answered) as { readonly tools: readonly { readonly name: string }[] };
  return listed.tools.map((tool) => tool.name);
}

/**
 * Opens the Mission as a Zord does, and says how the domain answered.
 *
 * Takes a control plane **or** the URL of one mounted on a Cockpit: the frame is identical either way,
 * which is the point — `runtime/mcp-server.ts` is a protocol and no transport, so a test that drives it
 * directly and one that POSTs to it are asking the same thing of the same code.
 */
async function opening(at: ControlPlane | string): Promise<string> {
  const frame = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "mission_create",
      arguments: {
        briefing: "one file, and whoever gets to it first",
        mode: "combination",
        capCents: 5_000,
        capabilities: ["delegate"],
      },
    },
  };

  if (typeof at === "string") {
    return decisionIn(await frameTo(at, frame));
  }

  const answered = await at.handle(JSON.stringify(frame));
  if (answered === undefined) {
    throw new Error("mission_create answered nothing");
  }
  return decisionIn(JSON.parse(answered) as unknown);
}

/** Whether the entry a tool answered with was accepted or refused. */
function decisionIn(answered: unknown): string {
  const said = resultIn(answered) as { readonly entry: { readonly decision: { readonly kind: string } } };
  return said.entry.decision.kind;
}

/* -------------------------------------------------------------------------------------------------
 * The human's own path: a WebSocket into the running server
 * ---------------------------------------------------------------------------------------------- */

/** One gesture over the Cockpit's WebSocket, and the entry the server answered with. */
async function gestureOn(cockpit: RunningCockpit, sent: unknown): Promise<{ decision: { kind: string } }> {
  const socket = new WebSocket(cockpit.url.replace(/^http/u, "ws"));
  const heard: ToCockpit[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data === "string") {
      heard.push(JSON.parse(data) as ToCockpit);
    }
  });
  await new Promise<void>((open, failed) => {
    socket.addEventListener("open", () => open());
    socket.addEventListener("error", () => failed(new Error("the Cockpit's WebSocket did not open")));
  });

  socket.send(JSON.stringify(sent));
  const decided = await until(
    () => heard.find((said) => said.kind === "decided"),
    () => `the Cockpit answered no decision. It said: ${JSON.stringify(heard)}`,
  );
  socket.close();

  if (decided.kind !== "decided") {
    throw new Error("unreachable: it was just found by its kind");
  }
  return decided.entry as unknown as { decision: { kind: string } };
}

/** The `mission` reading a Cockpit pushes at a client the moment it connects. */
async function firstMissionReadingOn(
  cockpit: RunningCockpit,
): Promise<Extract<ToCockpit, { kind: "mission" }>> {
  const socket = new WebSocket(cockpit.url.replace(/^http/u, "ws"));
  const heard: ToCockpit[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data === "string") {
      heard.push(JSON.parse(data) as ToCockpit);
    }
  });

  const reading = await until(
    () => heard.find((said) => said.kind === "mission"),
    () => "the reopened Cockpit said nothing about its Mission",
  );
  socket.close();

  if (reading.kind !== "mission") {
    throw new Error("unreachable: it was just found by its kind");
  }
  return reading;
}

/* -------------------------------------------------------------------------------------------------
 * Reading the host
 * ---------------------------------------------------------------------------------------------- */

/**
 * Whether a pid is a live process, reading `/proc` rather than asking `process.kill(pid, 0)`.
 *
 * A zombie answers signal 0, so counting one as a survivor would call a working kill broken on any host
 * whose init is slow to reap. The same reading `pane-manager.ts` makes, for the same reason.
 */
function isRunning(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  const after = stat.slice(stat.lastIndexOf(")") + 2);
  return after.charAt(0) !== "Z";
}

/**
 * Source with its comments blanked, so a scan reads code and not prose.
 *
 * Block comments go whole; a line comment only counts when it **opens** its line, which keeps the stripper
 * away from the `//` inside a URL and the `/` inside a regular expression. Narrow on purpose: a stripper
 * that guessed at those would under-report, and a check that quietly reports nothing is the failure this
 * repository keeps refusing.
 */
function withoutComments(source: string): string {
  // Line comments **first**, and that order is the whole of why this works: a line comment mentioning
  // `@engine/*` carries a `/*`, so removing block comments first opens one there and swallows everything
  // up to the next `*/` — which is a later doc comment, taking six real imports with it. Found by
  // counting what the scan saw, which is what the vacuity guard below is for.
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//gu, "");
}

/** Every command line on this host, for the cleanliness checks. */
function listedProcesses(): string {
  return execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
}

/** Polls for something to arrive. Every wait in this file is bounded and says what it waited for. */
async function until<T>(read: () => T | undefined | Promise<T | undefined>, onGivingUp: () => string): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`gave up waiting: ${onGivingUp()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
