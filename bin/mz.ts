#!/usr/bin/env -S node --experimental-strip-types
/**
 * `mz` — the entry point. Two modes, and the second one exists because of where a Zord runs.
 *
 * ```
 * mz .                         start the Cockpit on this Workspace and say where it is
 * mz . --mission <id>          …on that Mission rather than the one the store holds
 * mz mcp --zord <id>           the control plane over stdio, for a CLI that spawns its MCP servers
 * ```
 *
 * ## The transport question, which is the part most likely to be wrong quietly
 *
 * `runtime/mcp-server.ts` is a protocol with **no transport**: `controlPlane(options).handle(frame)` takes
 * a JSON-RPC frame and answers one, and it says in its own module doc that both transports are this file's.
 * They are two halves of one path, and the constraint that decides their shape is where a Zord lives.
 *
 * **A Zord runs inside a Pane, so its own stdio is the pseudoterminal a human is watching.** That rules out
 * the reading of "stdio framing" that looks obvious: the Cockpit does *not* speak JSON-RPC down the
 * terminal at the CLI. Three separate reasons, any one of which is enough — the human would be watching
 * protocol scroll past instead of work; the CLI's own output is prose and ANSI and would arrive
 * interleaved into the frames; and the CLI is the MCP **client**, which by the specification talks to
 * servers *it* launches, not to whoever launched it.
 *
 * What a real CLI does is spawn its MCP server as a child and talk over that child's stdin and stdout —
 * clean pipes, private to the pair, untouched by the terminal. So `mz mcp` is that child. And a child is a
 * **second process**: it holds no Pane, no live process table, no queue over the Mission file. A control
 * plane built inside it would fork Panes into a table the Cockpit cannot see and append to a Replay
 * nothing orders against the Cockpit's own appends.
 *
 * So the two transports are not alternatives. There is **one** control plane, in the Cockpit's process,
 * reachable over the Cockpit's own port (`POST /mcp/<zord>`), and `mz mcp` is a **bridge**: a line of JSON
 * in on stdin, one POST, the answer back out on stdout. Nothing is interpreted on the way through — the
 * bridge does not know what a tool is, and it reads a frame only far enough to find the `id` it must
 * answer under when the POST itself fails.
 *
 * ```
 *   Zord CLI ──spawns──▶ mz mcp ──POST /mcp/<zord>──▶ Cockpit process
 *      │  (its MCP client)   (this file, bridging)      controlPlane(…).handle(frame)
 *      └── its stdio is the Pane's pty, and is left alone
 * ```
 *
 * A CLI that speaks MCP over HTTP directly needs no bridge at all: it points at the same URL. The bridge
 * exists for the ones that only speak stdio, which today is most of them.
 *
 * ## One control plane per Zord, chosen by the URL
 *
 * A control plane speaks for exactly one Zord — `zordId` is configuration there and never an argument,
 * because a Fact carries who wrote it and a Zord must not be able to say it was somebody else. A single
 * mount would therefore have to invent a `zordId` for the whole Cockpit, which is the unfalsifiable claim
 * `CLAUDE.md` records as worse than not being able to write one at all.
 *
 * So the mount routes: `/mcp/<zordId>` builds (once) and reuses a control plane for that Zord, and a POST
 * to `/mcp` with no Zord named is refused. The identity is *where you connect*, which is what an MCP
 * config entry per Zord already expresses. It is **not** authentication and nothing here pretends it is:
 * anything that can reach the port can name any Zord, exactly as anything that can reach the port can type
 * into a Pane. That is `cockpit/server.ts`'s declared Gap, inherited whole.
 *
 * ## What `mz .` composes, and the two things it refuses to guess
 *
 * Providers off `PATH`, the two stores over `.megazord/`, the process table, the view, the server, and the
 * control planes. Every number those modules deliberately made required — `idleAfterMs`, `maxPaneBytes`,
 * a run timeout — is chosen **here**, written down as a constant with its reason, because "the caller
 * states it" means somebody eventually has to be the caller.
 *
 * Two things are not chosen here:
 *
 * - **`argumentsFor`.** The Harness carries a model, an Effort and Skills, and there is no flag spelling
 *   true of `claude`, `codex` and `gemini` at once. A default of `[]` would run a Zord under a bundle the
 *   `Delegated` fact says it ran with, and the Replay must never be wrong about that. So `startCockpit`
 *   requires it, and the program passes `refusingArguments`, which **throws**: `agent_invoke` then answers
 *   a tool error naming the Harness it could not map, at the moment it matters, instead of a Mission's
 *   record quietly disagreeing with what ran. Guessing the flags of somebody else's CLI from a machine
 *   with no CLIs installed and no network is exactly the invention this repository refuses.
 * - **A Briefing to drive.** `mz .` opens the Cockpit; it does not start a Combination, because a
 *   Combination is data and no artifact in this PRD specifies a file format for one. `startCockpit` is
 *   exported so a caller that *has* a recipe composes the two — `cockpit/cockpit.e2e.test.ts` is that
 *   caller, and criterion 5 is proven through it. Declared Gap 1.
 *
 * ## Why the `@engine/*` alias needs a resolver here
 *
 * ADR 0008: every import from `runtime/` or `cockpit/` names `@engine/index`. That is a **tsconfig path
 * alias**, and Node implements none — nor does it resolve the extensionless relative specifiers the engine
 * uses internally. `vitest` and `tsc` both resolve them and a bare `node bin/mz.ts` does not, so the
 * program registers a synchronous resolve hook (`resolveEngineAlias`) before it loads anything, and every
 * cross-layer import in this file is dynamic so the hook is in place before it runs. A caller that imports
 * this module from a runtime that already resolves those specifiers — a test — never calls it.
 *
 * The alternative was compiling the tree first, which `runtime/mission-store.test.ts` does for its
 * separate-process proof and which works. It was rejected for the entry point because `cockpit/view.ts`
 * reads `view/client.ts` off the disk at serve time and states that a compiled tree moved elsewhere would
 * not carry it — so a compiled `mz` cannot serve the Cockpit without a second decision about shipping
 * sources beside output. A fifteen-line resolver keeps `mz .` a thing that runs from a clone.
 *
 * ## One door to the Mission file
 *
 * `cockpit/server.ts`, `runtime/mcp-server.ts` and `runtime/combination-driver.ts` each declared, in their
 * own words, that two writers on one Mission file were not ordered, and each said it belonged to whoever
 * composes them. This is that composition, and it **is** resolved here — by handing all of them the same
 * door rather than by holding a rule.
 *
 * What was actually wrong, because "unordered writes" was never the answer:
 *
 * - **Appends were already ordered.** All three writers get the *same* `MissionStore`, whose queue keeps
 *   its appends in call order, so no line is ever torn or interleaved.
 * - **The read-modify-write was not.** Each writer held a queue of its own around `load → submit → append`
 *   — the server one, each control plane one, the driver none — so two of them could load the same Replay,
 *   both decide against the same state, and both append. A `delegate` decided against a Mission that had
 *   spent nothing stays **accepted** after the concurrent accrual has closed the Cap, so work is
 *   commissioned that the same two gestures, ordered, refuse. server ↔ control plane is the ordinary pair
 *   — a human answering a Gate while a Zord submits its Handoff — and the Cap is the one promise this
 *   product makes about money.
 *
 * So there is one `missionStore` and one `missionWriter` per Workspace here, and the writer is what the
 * server, every control plane and any drive are given. `missionWriter` answers the same writer for the same
 * store, so a second call cannot produce a second queue; what is left unordered is a second *store* over
 * the same directory, or a second process, and one Cockpit per Workspace is the assumption this program
 * meets by construction. `runtime/mission-writer.ts` argues the shape in full, and
 * `cockpit/cockpit.e2e.test.ts` keeps the A/B — the same two concurrent gestures through one writer and
 * through two — so the boundary is measured rather than described.
 *
 * ## Declared Gaps
 *
 * 1. **Nothing here starts a drive.** See above. A human gets a Cockpit; a Combination gets driven by a
 *    caller that composes `startCockpit` with `drive`. The additive fix is a format for a Combination on
 *    disk, which is a decision rather than a task.
 * 2. **A Pane's environment is the same for every Pane, so it cannot carry a per-Pane identity.**
 *    `PaneOpening` has no `env`, so a Zord opened in a Pane learns its own ZordId from whoever configured
 *    its MCP entry (`mz mcp --zord …`) and not from the Cockpit. The additive fix is an `env` on
 *    `PaneOpening`.
 * 3. **A Zord inherits only `PANE_ENV_NAMES`**, and no credential is on that list. Most CLIs authenticate
 *    from a file under `HOME`, which *is* passed; one that reads an API key out of the environment does not
 *    get it until its variable is written into that list. Inheriting the parent's whole environment would
 *    hand every credential this process holds to a process running text somebody else wrote.
 * 4. **Two processes over one Workspace are not ordered.** ~~Two writers on one Mission file are still not
 *    ordered~~ — closed, see "One door to the Mission file": one store, one writer, three writers holding
 *    it. What no module in this process can see is a second `mz` on the same Workspace, and nothing here
 *    takes a lock on the directory to find out. One Cockpit per Workspace.
 * 5. **The mount is the JSON half of MCP's Streamable HTTP and no more.** One POST, one answer, `202` for
 *    a notification. There is no `text/event-stream`, no `GET` for a server-opened stream and no
 *    `Mcp-Session-Id`, because the control plane sends nothing a client did not ask for and holds no
 *    session — its lifetime is a Zord's, not a connection's, which `runtime/mcp-server.ts` decided when it
 *    refused to enforce the handshake as an order. A CLI that requires the streaming half of that
 *    transport therefore connects through `mz mcp` instead, which is what the bridge is for.
 * 6. **One control plane per Zord is never released.** Each attaches two listeners to the process table,
 *    which has no way to remove one (its Gap 4), and each keeps its own ring buffer of every Pane. N Zords
 *    in a session means N rings. That is `runtime/mcp-server.ts`'s Gap 2, inherited: the fix is one shared
 *    scrollback in the process table, not a second table here.
 */

import { stat } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Types only, all of them: nothing crossing a layer boundary is imported as a value at load time, because
// the resolver below has to be in place first. See "Why the `@engine/*` alias needs a resolver here".
import type { AgentRun, AgentRunner, Instant, MissionId } from "@engine/index";
import type { ControlTransport } from "../cockpit/server";
import type { ControlPlane } from "../runtime/mcp-server";
import type { MissionWriter } from "../runtime/mission-writer";
import type { PaneId, PaneStatus } from "../runtime/pane-manager";
import type { PresentProvider, Provider } from "../runtime/providers";

/* -------------------------------------------------------------------------------------------------
 * The choices this file makes, because somebody has to
 * ---------------------------------------------------------------------------------------------- */

/**
 * How long a Pane may write nothing before the Cockpit calls it `idle`. Two seconds.
 *
 * The window is half of what `idle` *means*, so the process table refuses to default it. Two seconds is
 * chosen against what a human reads it as: a CLI that has stopped printing for two seconds has stopped
 * doing something visible. A Zord waiting on a model reads as `idle` here, which the process table already
 * declares it cannot distinguish from waiting on a human.
 */
export const IDLE_AFTER_MS = 2_000;

/**
 * How much of each Pane's output a control plane keeps for `pane_read`. 256 KiB per Pane per Zord.
 *
 * Enough that a Zord reading a colleague's Pane sees a screen's worth of scrollback many times over, and
 * small enough that the Gap above — one ring per Zord per Pane — cannot become this process's memory
 * problem. What was evicted is always reported, so a reader is never quietly short.
 */
export const MAX_PANE_BYTES = 256 * 1024;

/**
 * How long an `agent_invoke` run may take. Ten minutes.
 *
 * There is no timeout right for every CLI, which is why the runner refuses to default it. Ten minutes is
 * long enough for a real model call with tools and short enough that a wedged CLI is not a Mission that
 * never ends. It bounds one *invocation*, not a Mission.
 */
export const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * The variables of this process that reach a Zord, and the whole of it.
 *
 * Written down rather than inherited, because a Zord is a process running text somebody else wrote. See
 * Gap 3 for what that costs.
 */
export const PANE_ENV_NAMES: readonly string[] = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"];

/** Where a Zord finds the control plane. Set on every child this process forks. */
export const CONTROL_URL_VARIABLE = "MEGAZORD_CONTROL_URL";

/** Who a bridge says it is, when `--zord` is not given. */
export const ZORD_VARIABLE = "MEGAZORD_ZORD_ID";

/**
 * The Mission a Cockpit opens on when the store holds none and nothing was asked for.
 *
 * A constant rather than a timestamp: a name derived from the clock would make two `mz .` runs on an empty
 * Workspace open two different Missions, and neither of them the one a human meant.
 */
export const DEFAULT_MISSION = "mission-1";

/** JSON-RPC 2.0 §5.1, the two codes this file answers under when it cannot reach the control plane. */
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

/** The largest single frame the bridge will read off stdin. Refused, never truncated. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export const USAGE = `mz — the Megazord Terminal

  mz <workspace> [--mission <id>] [--port <n>]
      Start the Cockpit on a Workspace and print where it is. "." is the current directory.

  mz mcp [--zord <id>] [--url <control url>]
      Bridge one MCP stdio client to a running Cockpit's control plane. A Zord CLI spawns this;
      a human rarely does. Falls back to ${ZORD_VARIABLE} and ${CONTROL_URL_VARIABLE}.
`;

/* -------------------------------------------------------------------------------------------------
 * What was asked for
 * ---------------------------------------------------------------------------------------------- */

/** What one invocation of `mz` means. Pure: nothing here touches a disk, a clock or the environment. */
export type Invocation =
  | {
      readonly kind: "cockpit";
      /** As it was written. `main` resolves it against the current directory and checks it. */
      readonly workspace: string;
      readonly missionId: string | undefined;
      readonly port: number | undefined;
    }
  | { readonly kind: "bridge"; readonly url: string; readonly zordId: string }
  /** Nothing to do but say how it is used. */
  | { readonly kind: "usage" }
  /** It cannot be read, and this says why. Never a throw: a CLI answers, it does not stack-trace. */
  | { readonly kind: "refused"; readonly detail: string };

/**
 * Reads an argument list and an environment into an Invocation.
 *
 * Separate from doing anything, and pure, so every branch is provable with no server, no disk and no
 * process. `args` is everything after the program's own name.
 */
export function invocationIn(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Invocation {
  const first = args[0];
  if (first === undefined || first === "--help" || first === "-h") {
    return { kind: "usage" };
  }

  if (first === "mcp") {
    const flags = flagsIn(args.slice(1), ["--zord", "--url"]);
    if ("detail" in flags) {
      return { kind: "refused", detail: flags.detail };
    }
    const url = flags.given["--url"] ?? env[CONTROL_URL_VARIABLE];
    if (url === undefined || url.trim().length === 0) {
      return {
        kind: "refused",
        detail: `mz mcp needs the control plane's URL: pass --url, or set ${CONTROL_URL_VARIABLE}, which every child a Cockpit forks already carries`,
      };
    }
    const zord = flags.given["--zord"] ?? env[ZORD_VARIABLE];
    if (zord === undefined || zord.trim().length === 0) {
      return {
        kind: "refused",
        detail: `mz mcp needs to know which Zord it speaks for: pass --zord, or set ${ZORD_VARIABLE}. It is never invented — a Fact carries who wrote it`,
      };
    }
    return { kind: "bridge", url, zordId: zord };
  }

  if (first.startsWith("-")) {
    return { kind: "refused", detail: `mz starts with a Workspace or with "mcp", and this starts with ${JSON.stringify(first)}` };
  }

  const flags = flagsIn(args.slice(1), ["--mission", "--port"]);
  if ("detail" in flags) {
    return { kind: "refused", detail: flags.detail };
  }
  const asked = flags.given["--port"];
  if (asked !== undefined && !/^\d+$/u.test(asked)) {
    return { kind: "refused", detail: `--port takes a whole number of at least 0, and this one is ${JSON.stringify(asked)}` };
  }
  return {
    kind: "cockpit",
    workspace: first,
    missionId: flags.given["--mission"],
    port: asked === undefined ? undefined : Number(asked),
  };
}

/** The named flags of an argument list, or why it cannot be read. Every flag here takes a value. */
function flagsIn(
  args: readonly string[],
  known: readonly string[],
): { readonly given: Readonly<Record<string, string>> } | { readonly detail: string } {
  const given: Record<string, string> = {};
  for (let at = 0; at < args.length; at += 1) {
    const named = args[at] ?? "";
    if (!known.includes(named)) {
      return { detail: `${JSON.stringify(named)} is not one of ${known.join(", ")}` };
    }
    const value = args[at + 1];
    if (value === undefined) {
      return { detail: `${named} takes a value and this call gives none` };
    }
    given[named] = value;
    at += 1;
  }
  return { given };
}

/* -------------------------------------------------------------------------------------------------
 * The Cockpit
 * ---------------------------------------------------------------------------------------------- */

/** What a Cockpit is started with. Everything without a default is something nobody may guess. */
export type CockpitOptions = {
  /** The Workspace root, absolute. `.megazord/` is created inside it and every Pane runs in it. */
  readonly workspace: string;
  /** The Mission this Cockpit is opened on. Its Replay is the file the store keeps under this id. */
  readonly missionId: MissionId;
  /**
   * How a Harness becomes an argument vector for its CLI.
   *
   * Required, with no default, for the reason the module doc gives at length: a default would run a Zord
   * under a bundle the Replay says it ran with. `refusingArguments` is the honest one when nobody knows.
   */
  readonly argumentsFor: (asked: AgentRun) => readonly string[];
  /** 0, or absent, asks for an ephemeral port — which is what `url` then reports. */
  readonly port?: number;
  /** Where time comes from. Default: this host's clock, read once per Command. */
  readonly now?: () => Instant;
  /** The variables every child this Cockpit forks inherits, before the control URL is added. */
  readonly env?: Readonly<Record<string, string>>;
  readonly idleAfterMs?: number;
  readonly maxPaneBytes?: number;
  readonly runTimeoutMs?: number;
};

/** A Cockpit that is up. */
export type RunningCockpit = {
  /** The view, ready to hand to a browser. */
  readonly url: string;
  /** What a Zord's bridge posts to, with its own ZordId appended as one more path segment. */
  readonly controlUrl: string;
  readonly workspace: string;
  readonly missionId: MissionId;
  /** Which Zord CLIs were found on this host's `PATH`, and which were looked for and not found. */
  readonly providers: readonly Provider[];
  /**
   * The one door to the Mission's file, so a caller that drives a Combination writes through it too.
   *
   * Handed out for exactly one reason, and it is the reason BUG-1 existed: a caller with a recipe composes
   * `startCockpit` with `drive` (Gap 1), and the only thing it could build for itself is a **second** store
   * over the same Workspace — a second queue, and the lost update back. Reading is free through it, and it
   * has no `append`, so what a caller can do with this is exactly what the server and every control plane
   * can do: record a Command, and read the Replay.
   *
   * Still no store, deliberately: a store could append an entry decided against a Replay the caller loaded
   * itself, which is the shape this whole change exists to make unrepresentable.
   */
  readonly writer: MissionWriter;
  /**
   * Ends every Pane this Cockpit opened, then stops serving. Idempotent.
   *
   * The Panes go **first** and the promise waits for their process trees, because a Cockpit that exited
   * leaving Zords running would leave them spending. Nothing else in this repository owns that: the
   * process table has no "all", so the set is kept here off the status stream.
   */
  close(): Promise<void>;
};

/** Raised by `refusingArguments`, which is what the program hands a runner when nobody wrote a mapping. */
export class UnmappedHarnessError extends Error {
  constructor(cli: string) {
    super(
      `no argument mapping is written down for ${JSON.stringify(cli)}: mz will not guess the flags that ` +
        `carry a Harness's model, effort and skills, because a Zord run under a bundle nobody chose makes ` +
        `the Replay wrong about the one thing it must not be wrong about. Compose startCockpit with an ` +
        `argumentsFor of your own.`,
    );
    this.name = "UnmappedHarnessError";
  }
}

/**
 * An `argumentsFor` that refuses, loudly, at the moment it would have guessed.
 *
 * The runner turns a throwing `argumentsFor` into a `not-spawned` failure carrying this message, so
 * `agent_invoke` answers a tool error a human can act on and **nothing is forked**. A silent `[]` would
 * have run the CLI under its own defaults while the `Delegated` fact recorded a model, an Effort and a set
 * of Skills that never reached it.
 */
export function refusingArguments(asked: AgentRun): readonly string[] {
  const named: unknown = asked.harness?.cli;
  throw new UnmappedHarnessError(typeof named === "string" ? named : "a Zord");
}

/** The three statuses a Pane never comes back from. Nothing is killed twice on the way out. */
const ENDED: readonly PaneStatus[] = ["delivered", "failed", "killed"];

/**
 * Starts everything: providers, both stores, the process table, the control planes, the view, the server.
 *
 * Exported, and the program is a thin caller of it, so the thing criterion 1 starts and the thing
 * criterion 5 drives are the same composition rather than two that resemble each other.
 */
export async function startCockpit(options: CockpitOptions): Promise<RunningCockpit> {
  // Dynamic, so `resolveEngineAlias` can be in place first when this runs as a program. Under a runtime
  // that already resolves `@engine/*` these are ordinary imports that happen a little later than usual.
  const { instantFromDate, zordId } = await import("@engine/index");
  const { cockpitServer, CONTROL_PATH } = await import("../cockpit/server");
  const { cockpitView, xtermAssets } = await import("../cockpit/view");
  const { controlPlane } = await import("../runtime/mcp-server");
  const { cortexStore } = await import("../runtime/cortex-store");
  const { missionStore } = await import("../runtime/mission-store");
  const { missionWriter } = await import("../runtime/mission-writer");
  const { paneManager } = await import("../runtime/pane-manager");
  const { hostLookup, providersIn } = await import("../runtime/providers");
  const { inheritedEnv, ptyAgentRunner } = await import("../runtime/pty-agent-runner");

  const now = options.now ?? ((): Instant => instantFromDate(new Date()));
  const providers = await providersIn(hostLookup());

  const store = missionStore({ workspace: options.workspace });
  /**
   * The one door every writer of this Workspace goes through. See "One door to the Mission file".
   *
   * One store, one writer, and it is handed to the server, to every control plane and to whatever drives a
   * Combination — `missionWriter` would answer this same writer to any of them that asked for it, which is
   * the point of it being keyed on the store.
   */
  const writer = missionWriter({ store });
  const cortex = cortexStore({ workspace: options.workspace });

  /**
   * The environment every child of this process gets.
   *
   * Mutable in exactly one field and exactly once: the control URL is not knowable until the server has
   * bound, and the process table has to exist before the server can be built. `paneManager` and
   * `ptyAgentRunner` both spread this map **at spawn time**, and nothing can spawn before this function
   * returns — the only way to open a Pane is through a control plane, which is reached through the port
   * this is waiting on. The e2e reads the variable back out of a live Pane, so the premise is a
   * measurement rather than a sentence.
   */
  const env: Record<string, string> = { ...(options.env ?? inheritedEnv(PANE_ENV_NAMES)) };

  const panes = paneManager({ env, idleAfterMs: options.idleAfterMs ?? IDLE_AFTER_MS });

  /** Every Pane that has not reached a final status. The process table keeps no list; `close` needs one. */
  const live = new Set<string>();
  panes.onStatus((paneId: PaneId, status: PaneStatus) => {
    if (ENDED.includes(status)) {
      live.delete(paneId);
      return;
    }
    live.add(paneId);
  });

  const runner: AgentRunner = ptyAgentRunner({
    cwd: options.workspace,
    env,
    timeoutMs: options.runTimeoutMs ?? RUN_TIMEOUT_MS,
    argumentsFor: options.argumentsFor,
  });

  /** One control plane per Zord, built on first contact and kept. See "One control plane per Zord". */
  const speaking = new Map<string, ControlPlane>();

  function planeFor(named: string): ControlPlane {
    const held = speaking.get(named);
    if (held !== undefined) {
      return held;
    }
    const made = controlPlane({
      missionId: options.missionId,
      // Throws `InvalidIdError` on a blank name, which the mount turns into a JSON-RPC fault.
      zordId: zordId(named),
      workspace: options.workspace,
      writer,
      panes,
      cortex,
      runner,
      now,
      maxPaneBytes: options.maxPaneBytes ?? MAX_PANE_BYTES,
    });
    speaking.set(named, made);
    return made;
  }

  const control: ControlTransport = {
    async handle(frame: string, at: string): Promise<string | undefined> {
      const named = zordNameIn(at);
      if (named === undefined) {
        return faultFrameFor(
          frame,
          INVALID_REQUEST,
          `a control frame names the Zord it speaks for in its path: POST ${CONTROL_PATH}/<zordId>`,
        );
      }
      let plane: ControlPlane;
      try {
        plane = planeFor(named);
      } catch (cause) {
        return faultFrameFor(frame, INVALID_REQUEST, messageOf(cause));
      }
      // From here it is the control plane's, which never throws and never rejects.
      return plane.handle(frame);
    },
  };

  const server = await cockpitServer({
    missionId: options.missionId,
    writer,
    panes,
    view: await cockpitView(),
    // A real terminal, not the hand-rolled one Task 6 shipped and Task 10 deleted: the route is
    // optional on the server (Gap, declared in both `server.ts` and `view.ts`) precisely so this is
    // the one line that turns it on for the program a human runs.
    xterm: await xtermAssets(),
    control,
    ...(options.port === undefined ? {} : { port: options.port }),
  });

  const controlUrl = new URL(CONTROL_PATH, server.url).href;
  env[CONTROL_URL_VARIABLE] = controlUrl;

  let closed: Promise<void> | undefined;

  return Object.freeze({
    url: server.url,
    controlUrl,
    workspace: options.workspace,
    missionId: options.missionId,
    providers,
    writer,
    close(): Promise<void> {
      closed ??= (async (): Promise<void> => {
        // `allSettled`: a Pane whose tree outlived `SIGKILL` rejects, and one Pane that will not die must
        // not stop the rest from dying or the server from closing.
        await Promise.allSettled([...live].map((paneId) => panes.kill(paneId as PaneId)));
        await server.close();
      })();
      return closed;
    },
  });
}

/**
 * The Zord a control path names, or `undefined` when it names none.
 *
 * Pure and exported, because it is the whole of the mount's routing rule and it deserves to fail in a test
 * rather than in a Zord's first tool call. One segment, non-blank once decoded: `/mcp/scout` is the scout's
 * and `/mcp` is nobody's.
 */
export function zordNameIn(at: string): string | undefined {
  if (!at.startsWith("/")) {
    return undefined;
  }
  const segment = at.slice(1);
  if (segment.length === 0 || segment.includes("/")) {
    return undefined;
  }
  let named: string;
  try {
    named = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return named.trim().length === 0 ? undefined : named;
}

/* -------------------------------------------------------------------------------------------------
 * The bridge
 * ---------------------------------------------------------------------------------------------- */

/** What a bridge is run with. */
export type BridgeOptions = {
  /** Where frames arrive, newline-delimited. The client's stdout, which is this process's stdin. */
  readonly input: NodeJS.ReadableStream;
  /** Where answers go, newline-delimited, and nothing else ever does. */
  readonly output: NodeJS.WritableStream;
  /** How one frame is answered. `postingTo` is the one the program uses. */
  readonly send: (frame: string) => Promise<string | undefined>;
  /** Where a fault nobody can be told about in-band goes. Default: nowhere. */
  readonly report?: (detail: string) => void;
  readonly maxFrameBytes?: number;
};

/**
 * Newline-delimited JSON in, newline-delimited JSON out, until the input ends.
 *
 * The MCP stdio transport, and the whole of it: one JSON object per line, UTF-8, no embedded newlines,
 * nothing but frames on the stream. Everything this process wants to say to a human goes to stderr, because
 * one stray line on stdout desynchronises a client permanently.
 *
 * Frames are answered **concurrently and answers are written as they arrive**, not in the order they were
 * asked for. JSON-RPC matches by `id`, and serialising would put a `pane_read` behind an `agent_invoke`
 * that is running a model for a minute.
 *
 * A POST that fails is answered with a JSON-RPC error carrying the request's own id, rather than nothing: a
 * transport that goes quiet leaves a client waiting for an answer that can never come. A frame that was a
 * notification is not answered at all, whatever became of it.
 */
export async function bridge(options: BridgeOptions): Promise<void> {
  const maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  const answering: Promise<void>[] = [];
  let pending = "";
  let overflowed = false;

  async function answer(frame: string): Promise<void> {
    let answered: string | undefined;
    try {
      answered = await options.send(frame);
    } catch (cause) {
      const detail = `the control plane could not be reached: ${messageOf(cause)}`;
      options.report?.(detail);
      answered = faultFrameFor(frame, INTERNAL_ERROR, detail);
    }
    if (answered === undefined) {
      return;
    }
    if (answered.includes("\n")) {
      // One frame is one line. An answer carrying a newline would split into two frames, and the client
      // would read the second half as a frame of its own — the silent desynchronisation this framing
      // exists to make impossible. Refused and reported, never written.
      const detail = "the control plane answered a frame containing a newline, which cannot be framed";
      options.report?.(detail);
      const fault = faultFrameFor(frame, INTERNAL_ERROR, detail);
      if (fault !== undefined) {
        options.output.write(`${fault}\n`);
      }
      return;
    }
    options.output.write(`${answered}\n`);
  }

  options.input.setEncoding("utf8");
  for await (const chunk of options.input) {
    pending += String(chunk);

    for (;;) {
      const at = pending.indexOf("\n");
      if (at < 0) {
        break;
      }
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      // A `\r` is not part of the frame. Nothing here should produce one, and a client behind a terminal
      // or a Windows pipe does.
      const frame = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (frame.trim().length === 0) {
        continue;
      }
      answering.push(answer(frame));
    }

    if (Buffer.byteLength(pending, "utf8") > maxFrameBytes) {
      // The stream is no longer trustworthy: there is no frame boundary in sight and discarding what has
      // arrived would turn the tail of this frame into a frame of its own. Say so under a null id, which is
      // what JSON-RPC prescribes when the id cannot be read, and stop.
      overflowed = true;
      options.report?.(`a frame of more than ${maxFrameBytes} bytes arrived with no newline in it`);
      options.output.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: INVALID_REQUEST, message: `a frame of more than ${maxFrameBytes} bytes: refused rather than truncated` },
        })}\n`,
      );
      break;
    }
  }

  if (!overflowed && pending.trim().length > 0) {
    // The last line arrived with no newline after it. A client that closed its pipe mid-frame gets that
    // frame answered anyway: the bytes are all here.
    answering.push(answer(pending.trim()));
  }

  await Promise.all(answering);
}

/**
 * A `send` that POSTs one frame to a control plane and answers what came back.
 *
 * `202` is a notification the control plane had nothing to say about. Any other non-2xx is a transport
 * fault and **throws**, which the bridge turns into a JSON-RPC error under the caller's own id — the
 * status and the body are what a human needs to see there, so they travel in the message.
 */
export function postingTo(url: string): (frame: string) => Promise<string | undefined> {
  return async (frame: string): Promise<string | undefined> => {
    const answered = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: frame,
    });
    const said = await answered.text();
    if (answered.status === 202) {
      return undefined;
    }
    if (!answered.ok) {
      throw new Error(`${url} answered ${answered.status}: ${said.trim()}`);
    }
    return said;
  };
}

/**
 * A JSON-RPC error frame answering whatever this frame asked, or `undefined` when it asked nothing.
 *
 * The one place this file reads a frame at all, and it reads exactly one field. A frame that is not JSON,
 * or is not an object, is answered under `id: null` — JSON-RPC 2.0 §5, for an id that cannot be
 * determined — while a well-formed **notification** is answered with nothing, because answering one is
 * forbidden. Every condition stays inline in its `if`: TypeScript does not narrow through an aliased
 * compound condition that uses `in`.
 */
export function faultFrameFor(frame: string, code: number, message: string): string | undefined {
  let id: string | number | null = null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    if (!("id" in parsed)) {
      return undefined;
    }
    const claimed: unknown = parsed.id;
    id = typeof claimed === "string" || typeof claimed === "number" ? claimed : null;
  }

  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/* -------------------------------------------------------------------------------------------------
 * Running as a program
 * ---------------------------------------------------------------------------------------------- */

/** Where a run of `mz` writes and reads. Injected so `main` is drivable without a terminal. */
export type Io = {
  readonly out: NodeJS.WritableStream;
  readonly err: NodeJS.WritableStream;
  /**
   * Where frames arrive, asked for only by the mode that reads them.
   *
   * A function and not a stream, so a Cockpit never creates a stdin it will not read — `process.stdin` is
   * built on first access. **This is hygiene and not a fix, and that distinction was measured rather than
   * assumed**: both spellings exit about 10ms after `SIGINT`, because Node does not hold the loop open for
   * a stdin nobody has resumed. The hang that suggested otherwise was a `$!` in the shell naming a
   * subshell instead of the program.
   */
  readonly input: () => NodeJS.ReadableStream;
  /** What ends the Cockpit. Default: the first `SIGINT` or `SIGTERM` this process is sent. */
  readonly until?: () => Promise<string>;
};

/**
 * One run of `mz`, as an exit code.
 *
 * `0` for a Cockpit that was asked to stop and a bridge whose client hung up, `1` for something that
 * failed, `2` for a call nobody can read. Never throws: a CLI answers.
 */
export async function main(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
): Promise<number> {
  const asked = invocationIn(args, env);

  if (asked.kind === "usage") {
    io.out.write(USAGE);
    return 0;
  }
  if (asked.kind === "refused") {
    io.err.write(`mz: ${asked.detail}\n\n${USAGE}`);
    return 2;
  }

  if (asked.kind === "bridge") {
    const url = `${asked.url.replace(/\/+$/u, "")}/${encodeURIComponent(asked.zordId)}`;
    try {
      await bridge({
        input: io.input(),
        output: io.out,
        send: postingTo(url),
        report: (detail: string) => {
          io.err.write(`mz mcp: ${detail}\n`);
        },
      });
    } catch (cause) {
      io.err.write(`mz mcp: ${messageOf(cause)}\n`);
      return 1;
    }
    return 0;
  }

  const workspace = resolvePath(asked.workspace);
  const held = await stat(workspace).catch(() => undefined);
  if (held === undefined || !held.isDirectory()) {
    io.err.write(`mz: ${workspace} is not a directory, and a Workspace is one\n`);
    return 2;
  }

  const { missionId } = await import("@engine/index");
  const { missionStore } = await import("../runtime/mission-store");

  let chosen: string;
  try {
    chosen = asked.missionId ?? missionOf(await missionStore({ workspace }).list());
  } catch (cause) {
    io.err.write(`mz: ${messageOf(cause)}\n`);
    return 2;
  }

  let cockpit: RunningCockpit;
  try {
    cockpit = await startCockpit({
      workspace,
      missionId: missionId(chosen),
      argumentsFor: refusingArguments,
      ...(asked.port === undefined ? {} : { port: asked.port }),
    });
  } catch (cause) {
    io.err.write(`mz: the Cockpit did not start — ${messageOf(cause)}\n`);
    return 1;
  }

  io.out.write(announcementOf(cockpit));

  const stopped = await (io.until ?? untilSignalled)();
  io.out.write(`\nmz: ${stopped} — ending every Pane and closing\n`);
  try {
    await cockpit.close();
  } catch (cause) {
    io.err.write(`mz: something did not close cleanly — ${messageOf(cause)}\n`);
    return 1;
  }
  return 0;
}

/**
 * Which Mission a Cockpit opens on when nobody said.
 *
 * The one this Workspace holds, or a first one when it holds none. **More than one is refused**, naming
 * them: the store lists ids in ascending order and not by time, so "the latest" is not something anything
 * here can honestly answer, and picking the first alphabetically would open the wrong Mission silently.
 */
function missionOf(held: readonly string[]): string {
  if (held.length === 0) {
    return DEFAULT_MISSION;
  }
  const only = held[0];
  if (held.length === 1 && only !== undefined) {
    return only;
  }
  throw new Error(
    `this Workspace holds ${held.length} Missions and nothing here can tell which one you meant — ` +
      `say which with --mission: ${held.join(", ")}`,
  );
}

/** What `mz .` prints. One fact per line, so a human and a `grep` read the same thing. */
function announcementOf(cockpit: RunningCockpit): string {
  // A type guard rather than a bare predicate: `filter` does not narrow on its own, and without the
  // narrowing the line below would need a branch for a path that cannot be absent.
  const found = cockpit.providers.filter((provider): provider is PresentProvider => provider.present);
  const missing = cockpit.providers.filter((provider) => !provider.present);

  return [
    `Cockpit    ${cockpit.url}`,
    `Workspace  ${cockpit.workspace}`,
    `Mission    ${cockpit.missionId}`,
    `Providers  ${found.length === 0 ? "none on PATH" : found.map((provider) => `${provider.id} (${provider.path})`).join(", ")}`,
    ...(missing.length === 0 ? [] : [`Not found  ${missing.map((provider) => provider.cli).join(", ")}`]),
    `Control    ${cockpit.controlUrl}/<zordId>`,
    `           a Zord reaches it with: mz mcp --zord <zordId>`,
    "",
  ].join("\n");
}

/** Resolves on the first `SIGINT` or `SIGTERM`, and stops listening for the other. */
function untilSignalled(): Promise<string> {
  return new Promise<string>((stopped) => {
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const heard = (signal: NodeJS.Signals): void => {
      for (const named of signals) {
        process.off(named, heard);
      }
      stopped(signal);
    };
    for (const named of signals) {
      process.on(named, heard);
    }
  });
}

/**
 * Teaches this process to resolve what `tsc` and `vitest` resolve: `@engine/*`, and the extensionless
 * relative specifiers the engine uses inside itself.
 *
 * Synchronous hooks, in this thread, installed before anything crossing a layer is imported. It rewrites
 * one prefix and otherwise only *adds a fallback*: whatever Node would have resolved, it still resolves,
 * and a specifier that fails is retried with `.ts` before the original failure is re-thrown. So a genuine
 * missing module still reports itself as missing, at the specifier the author wrote.
 */
export function resolveEngineAlias(): void {
  const engine = new URL("../engine/", import.meta.url);

  registerHooks({
    // Unannotated on purpose: the parameter types are `registerHooks`'s own, read off the call.
    resolve(specifier, context, nextResolve) {
      const asked = specifier.startsWith("@engine/")
        ? new URL(specifier.slice("@engine/".length), engine).href
        : specifier;
      try {
        return nextResolve(asked, context);
      } catch (cause) {
        try {
          return nextResolve(`${asked}.ts`, context);
        } catch {
          throw cause;
        }
      }
    },
  });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The program.
 *
 * Guarded, so importing this module — which every test of it does — starts nothing. `process.argv[1]` is
 * the path Node was pointed at; comparing it with this file's own is what tells "run" from "imported".
 */
if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  resolveEngineAlias();
  void main(process.argv.slice(2), process.env, {
    out: process.stdout,
    err: process.stderr,
    // A function, so the Cockpit never creates it. See `Io`.
    input: () => process.stdin,
  }).then(
    (code: number) => {
      process.exitCode = code;
    },
    (cause: unknown) => {
      process.stderr.write(`mz: ${messageOf(cause)}\n`);
      process.exitCode = 1;
    },
  );
}
