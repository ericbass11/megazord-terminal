/**
 * These tests spawn real processes. There is no mock of `node-pty` anywhere in this file, and that is the
 * point, exactly as it is in `pty-agent-runner.test.ts`: whether the kill kills a tree, whether a
 * keystroke reaches a process, whether two Panes stay out of each other's stream — all of it is a property
 * of an operating system and not of a stub. A mocked pty would prove that this module calls the functions
 * this module calls.
 *
 * They are Linux-shaped where they say so: process groups, `/proc` and `bash -c` are not portable, and
 * neither is `node-pty`'s behaviour around them. The tests that read `/proc` are skipped elsewhere rather
 * than quietly weakened.
 *
 * **The holdout processes here sleep 297 seconds and not 300, deliberately.**
 * `pty-agent-runner.test.ts` ends with an assertion that no `sleep 300` exists anywhere on the host, and
 * Vitest runs test *files* in parallel workers — so a live holdout of this file spelled the same way would
 * fail that file's assertion, in a test that has nothing to do with this one and names no cause. Two files
 * that both leave deliberate processes behind need two spellings, or each one's cleanup check is the
 * other's flake.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawn as spawnPty } from "node-pty";
import { afterAll, afterEach, describe, expect, it } from "vitest";

// `inheritedEnv` rather than a second spelling of "what a child inherits": it is the delivered idiom of
// this layer, in this directory, and duplicating it here would give the repository two answers to one
// question. Nothing else of the runner is used — a Pane is not built on it.
import { inheritedEnv } from "./pty-agent-runner";

import {
  InvalidPaneIdError,
  PaneKillTimeoutError,
  PaneSpawnError,
  PaneWriteError,
  UnknownPaneError,
  paneId,
  paneManager,
  type PaneId,
  type PaneManager,
  type PaneManagerOptions,
  type PaneOpening,
  type PaneStatus,
} from "./pane-manager";

const BASH = "/bin/bash";
/** A genuinely different binary from bash, which is what criterion 4 asks for. `/bin/sh` is dash here. */
const DASH = "/bin/sh";
const ON_LINUX = process.platform === "linux";

/** Exactly the variables a shell needs to be itself. Nothing else of this process reaches a Pane. */
const ENV = inheritedEnv(["PATH", "HOME"]);

/** Long enough that nothing ends on its own, and spelled differently from the runner's — see the header. */
const FOREVER = "sleep 297";

/* -------------------------------------------------------------------------------------------------
 * Watching a manager
 * ---------------------------------------------------------------------------------------------- */

/** A manager with every stream recorded, and every Pane it opened remembered for the cleanup. */
type Watched = {
  readonly manager: PaneManager;
  /** Opens a Pane and remembers it. `cwd` defaults to the temporary directory. */
  open(named: string, cli: string, argv: readonly string[], cwd?: string): PaneId;
  /** Every Pane this manager opened, which is what the cleanup kills. */
  readonly opened: readonly PaneId[];
  /** Everything one Pane wrote, in order. */
  textOf(paneId: PaneId): string;
  /** Every status one Pane reached, in order. */
  statusesOf(paneId: PaneId): readonly PaneStatus[];
  /** Which Pane each chunk came from, in arrival order across every Pane. */
  readonly arrivals: readonly PaneId[];
  /** Resolves true once a Pane's output contains `wanted`. */
  awaitText(paneId: PaneId, wanted: string, withinMs?: number): Promise<boolean>;
  /** Resolves true once a Pane has reached `wanted`. */
  awaitStatus(paneId: PaneId, wanted: PaneStatus, withinMs?: number): Promise<boolean>;
};

let watched: Watched[] = [];
let workspaces: string[] = [];

afterEach(async () => {
  // Every Pane of every manager, killed through the module under test — which doubles as the check that
  // `kill` is safe on a Pane that already exited, since most tests leave one that has.
  for (const watch of watched) {
    for (const opened of watch.opened) {
      await watch.manager.kill(opened).catch(() => undefined);
    }
  }
  watched = [];
  for (const workspace of workspaces) {
    rmSync(workspace, { recursive: true, force: true });
  }
  workspaces = [];
});

function cockpit(overrides: Partial<PaneManagerOptions> = {}): Watched {
  const manager = paneManager({ env: ENV, idleAfterMs: 400, ...overrides });

  const text = new Map<string, string>();
  const statuses = new Map<string, PaneStatus[]>();
  const arrivals: PaneId[] = [];
  const opened: PaneId[] = [];

  // Registered before any Pane is opened, which is the documented order: nothing is buffered for a
  // listener that arrives late, and `starting` is announced synchronously with the spawn.
  // The parameters are named `pane` and not `paneId`, which would shadow the imported constructor —
  // `CLAUDE.md` records what a shadow of `describe` costs, and this is the same trap one import along.
  manager.onData((pane, chunk) => {
    text.set(pane, (text.get(pane) ?? "") + chunk);
    arrivals.push(pane);
  });
  manager.onStatus((pane, status) => {
    const held = statuses.get(pane) ?? [];
    held.push(status);
    statuses.set(pane, held);
  });

  const watch: Watched = {
    manager,
    arrivals,
    opened,
    open(named, cli, argv, cwd = tmpdir()) {
      const pane = paneId(named);
      opened.push(pane);
      manager.spawn({ paneId: pane, cli, argv, cwd });
      return pane;
    },
    textOf: (pane) => text.get(pane) ?? "",
    statusesOf: (pane) => statuses.get(pane) ?? [],
    awaitText: (pane, wanted, withinMs) =>
      until(() => (text.get(pane) ?? "").includes(wanted), withinMs),
    awaitStatus: (pane, wanted, withinMs) =>
      until(() => (statuses.get(pane) ?? []).includes(wanted), withinMs),
  };

  watched.push(watch);
  return watch;
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

/** A directory of this test's own, removed afterwards. */
function workspace(label: string): string {
  const made = mkdtempSync(join(tmpdir(), `megazord-pane-${label}-`));
  workspaces.push(made);
  return made;
}

/* -------------------------------------------------------------------------------------------------
 * Reading the process table directly
 * ---------------------------------------------------------------------------------------------- */

/** The state character and process group of a pid, straight out of `/proc`. */
function statOf(pid: number): { readonly state: string; readonly pgrp: number } | undefined {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
  // `comm` is unescaped and may hold spaces and parentheses, so the fields start after the last `)`.
  const after = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
  const state = after[0] ?? "";
  return { state, pgrp: Number(after[2]) };
}

/**
 * Whether a pid names a live process.
 *
 * `/proc` and not `process.kill(pid, 0)`, because a zombie still answers signal 0 and this file's whole
 * subject is whether something is *gone*.
 */
function running(pid: number): boolean {
  const stat = statOf(pid);
  return stat !== undefined && stat.state !== "Z";
}

/**
 * A script that leaves a grandchild ignoring `SIGHUP`, writes that grandchild's pid where the test can
 * read it, and reports its own pid on the terminal.
 *
 * `$BASHPID` and not `$$`: inside `( … )` the latter is still the parent shell's pid. `exec` keeps the pid
 * the subshell just reported, and POSIX carries an *ignored* signal across an `exec`, so the `sleep` that
 * ends up under that pid ignores `SIGHUP` too. That is what makes it survive the hangup that killing the
 * session leader causes — an ordinary child would die of that and prove nothing.
 */
function holdoutScript(pidfile: string, alsoIgnoring = ""): string {
  return (
    `echo leader=$$\n` +
    `trap '' HUP ${alsoIgnoring}\n` +
    `( trap '' HUP ${alsoIgnoring}; echo $BASHPID > "${pidfile}"; exec ${FOREVER} ) &\n` +
    `${FOREVER}\n`
  );
}

function pidIn(pidfile: string): number | undefined {
  try {
    const written = readFileSync(pidfile, "utf8").trim();
    return written.length === 0 ? undefined : Number(written);
  } catch {
    return undefined;
  }
}

/** The leader's pid, as the script itself reported it. The manager exposes no pids, and does not need to. */
function leaderIn(output: string): number {
  const said = /leader=(\d+)/.exec(output);
  return Number(said?.[1] ?? 0);
}

/* -------------------------------------------------------------------------------------------------
 * Criterion 2 — a Pane spawns a real process, streams it, and takes keystrokes
 * ---------------------------------------------------------------------------------------------- */

describe("a Pane is a real process, streamed", () => {
  it("streams its first byte in well under two seconds", async () => {
    const watch = cockpit();

    const at = Date.now();
    const pane = watch.open("first-byte", BASH, ["-c", `echo the-first-byte; ${FOREVER}`]);
    expect(await watch.awaitText(pane, "the-first-byte", 5_000)).toBe(true);
    const firstByte = Date.now() - at;

    expect(firstByte, `the first byte took ${firstByte}ms`).toBeLessThan(2_000);
  });

  it("makes the status stream the measurement: starting, then working at the first byte", async () => {
    const watch = cockpit();

    const pane = watch.open("first-status", BASH, ["-c", `echo speaking; ${FOREVER}`]);
    // Announced synchronously with the spawn, so it is already there before anything is awaited.
    expect(watch.statusesOf(pane)).toEqual(["starting"]);

    expect(await watch.awaitStatus(pane, "working", 5_000)).toBe(true);
    expect(watch.statusesOf(pane)).toEqual(["starting", "working"]);
  });

  it("delivers a typed keystroke to the process, which says what it heard", async () => {
    const watch = cockpit();
    const pane = watch.open("keystrokes", BASH, [
      "-c",
      `echo ready-for-input; read -r line; echo "heard=[$line]"`,
    ]);

    expect(await watch.awaitText(pane, "ready-for-input")).toBe(true);
    // `\r` and not `\n`: `ICRNL` on the line discipline turns it into the newline that completes the
    // line, which is what a terminal delivers when a human presses return.
    watch.manager.write(pane, "typed-by-a-human\r");

    expect(await watch.awaitText(pane, "heard=[typed-by-a-human]")).toBe(true);
    // Twice: once because the terminal echoed what was written to it, once because the process read it
    // back. Both are real, and nothing here tries to guess which was which.
    expect(watch.textOf(pane).match(/typed-by-a-human/g)?.length).toBe(2);
  });

  it("runs in the cwd it was given, not in this process's", async () => {
    const elsewhere = workspace("cwd");
    const watch = cockpit();
    const pane = watch.open("cwd", BASH, ["-c", "pwd"], elsewhere);

    expect(await watch.awaitText(pane, elsewhere)).toBe(true);
    expect(watch.textOf(pane)).not.toContain(process.cwd());
  });

  it("streams a Pane that keeps writing, chunk after chunk", async () => {
    const watch = cockpit();
    const pane = watch.open("streaming", BASH, [
      "-c",
      `for i in 1 2 3 4 5; do echo chunk-$i; sleep 0.05; done`,
    ]);

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    for (const at of [1, 2, 3, 4, 5]) {
      expect(watch.textOf(pane)).toContain(`chunk-${at}`);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * What a status can honestly say
 * ---------------------------------------------------------------------------------------------- */

describe("what a status can honestly say", () => {
  it("reads working and idle off output activity, and moves both ways", async () => {
    // The whole of what `working` and `idle` mean: a byte arrived inside the window, or it did not. The
    // script is silent for a second in the middle, which is four times the window.
    // 700ms and not 250: the assertion is an exact sequence, so it breaks if the *first byte* lands
    // outside the window — which turns a loaded machine into a red test that names nothing. The measured
    // first byte is 28ms, the silence below is more than twice the window, and both margins are wide on
    // purpose.
    const watch = cockpit({ idleAfterMs: 700 });
    const pane = watch.open("quiet", BASH, [
      "-c",
      "echo before-the-silence; sleep 1.6; echo after-the-silence",
    ]);

    expect(await watch.awaitStatus(pane, "idle")).toBe(true);
    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "idle"]);

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    expect(watch.statusesOf(pane)).toEqual([
      "starting",
      "working",
      "idle",
      "working",
      "delivered",
    ]);
  });

  it("measures the window from the last byte, not from the spawn", async () => {
    // Decisive about the **re-arming**, which the test above cannot see: it goes quiet for long enough to
    // reach `idle` whether the window restarts on every chunk or only runs once from the spawn. Here a
    // Pane writes every 100ms inside a 400ms window for two seconds, so a window that started at the
    // spawn and never restarted would call a busy Pane quiet 400ms in. Found by falsifying the re-arm and
    // watching the whole file still pass.
    // The window is eight times the cadence, so a loaded machine does not turn this red; a window anchored
    // to the spawn still expires 800ms in, well inside the two seconds the Pane keeps writing.
    const watch = cockpit({ idleAfterMs: 800 });
    const pane = watch.open("steady", BASH, [
      "-c",
      `for i in $(seq 1 20); do echo tick-$i; sleep 0.1; done`,
    ]);

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    expect(watch.textOf(pane)).toContain("tick-20");
    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "delivered"]);
  });

  it("goes idle from starting when a Pane has written nothing at all", async () => {
    // A process that says nothing is quiet, not eternally starting. Silence is silence whether or not
    // anything came before it — which is also the honest reading of a CLI that prints nothing until it
    // is asked something.
    const watch = cockpit({ idleAfterMs: 150 });
    const pane = watch.open("silent", BASH, ["-c", FOREVER]);

    expect(await watch.awaitStatus(pane, "idle")).toBe(true);
    expect(watch.statusesOf(pane)).toEqual(["starting", "idle"]);
  });

  it("never repeats a status, however many chunks arrive", async () => {
    const watch = cockpit({ idleAfterMs: 2_000 });
    const pane = watch.open("chatty", BASH, [
      "-c",
      `for i in 1 2 3 4 5 6 7 8; do echo chunk-$i; sleep 0.05; done`,
    ]);

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "delivered"]);
  });

  it("says nothing more once a Pane has reached a terminal status", async () => {
    // Decisive about **finality**, which none of the exact-sequence assertions above can see: each of them
    // runs the instant the terminal status arrives, and the window armed by the last chunk expires *after*
    // that — so a stray `idle` landing on a delivered Pane would never be looked at. Found by falsifying
    // both halves of the guard at once (the `clearTimeout` on the exit and the finality check inside the
    // timer) and watching the whole file stay green.
    const watch = cockpit({ idleAfterMs: 200 });
    const pane = watch.open("final", BASH, ["-c", "echo the-last-word; exit 0"]);
    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);

    const saidByThen = [...watch.statusesOf(pane)];
    // Three windows. A timer armed by the last chunk would have fired twice over by now.
    await rested(600);

    expect(watch.statusesOf(pane)).toEqual(saidByThen);
    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "delivered"]);
  });

  it("says delivered for a process that exited 0 of its own accord", async () => {
    const watch = cockpit();
    const pane = watch.open("delivering", BASH, ["-c", "echo done; exit 0"]);

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    expect(watch.statusesOf(pane)).not.toContain("failed");
  });

  it("says failed for a non-zero exit", async () => {
    const watch = cockpit();
    const pane = watch.open("failing", BASH, ["-c", "echo about-to-fail >&2; exit 7"]);

    expect(await watch.awaitStatus(pane, "failed")).toBe(true);
    // The stream is where the reason is: the contract's `onStatus` carries no exit code, which is a
    // declared Gap of this module rather than something the test papers over.
    expect(watch.textOf(pane)).toContain("about-to-fail");
  });

  it("says failed when a signal nobody here sent ended it", async () => {
    // The script kills itself. Nothing in this module signalled anything, so it must not be read as a
    // kill — the same distinction the runner draws between its `timeout` and its `killed`.
    const watch = cockpit();
    const pane = watch.open("self-signalled", BASH, ["-c", `echo dying; kill -TERM $$; ${FOREVER}`]);

    expect(await watch.awaitStatus(pane, "failed")).toBe(true);
    expect(watch.statusesOf(pane)).not.toContain("killed");
  });

  it("says killed, not failed, when the kill came from here", async () => {
    const watch = cockpit();
    const pane = watch.open("killed", BASH, ["-c", `echo alive; ${FOREVER}`]);
    expect(await watch.awaitText(pane, "alive")).toBe(true);

    await watch.manager.kill(pane);

    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "killed"]);
  });

  it("does not retell a Pane that already delivered as killed", async () => {
    // A delivery is a fact about the leader, and a later kill destroys what the delivery left behind
    // rather than rewriting it.
    const watch = cockpit();
    const pane = watch.open("delivered-then-killed", BASH, ["-c", "echo done-already"]);
    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);

    await watch.manager.kill(pane);

    expect(watch.statusesOf(pane)).toEqual(["starting", "working", "delivered"]);
  });

  it("pins what node-pty does with a cli that is not there: an exit, not a refusal", async () => {
    // Declared Gap 6, pinned rather than guessed at, exactly as the runner pins the same case. The helper
    // `execvp`s inside the forked child, so a missing binary is an ordinary failed Pane.
    const watch = cockpit();
    const pane = watch.open("no-such-cli", "/definitely/not/here", []);

    expect(await watch.awaitStatus(pane, "failed")).toBe(true);
    expect(watch.textOf(pane)).toContain("No such file or directory");
  });

  it("pins what node-pty does with a cwd that is not there: the same", async () => {
    const watch = cockpit();
    const pane = watch.open("no-such-cwd", BASH, ["-c", "echo never"], "/definitely/not/a/directory");

    expect(await watch.awaitStatus(pane, "failed")).toBe(true);
    expect(watch.textOf(pane)).toContain("chdir");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 3 — the kill kills the tree
 * ---------------------------------------------------------------------------------------------- */

describe.skipIf(!ON_LINUX)("the kill kills the whole tree", () => {
  it("rests on a premise, and here it is: each Pane is its own process group leader", async () => {
    // `node-pty` calls `setsid`, so the child's pid is also its process group id — which is the only
    // reason `process.kill(-pid, …)` reaches a grandchild instead of this process's own group. Read back
    // out of `/proc` rather than assumed, because the whole kill design rests on it and a `SIGKILL` to
    // the wrong group would take the Cockpit with it.
    const watch = cockpit();
    const pane = watch.open("premise", BASH, ["-c", `echo leader=$$; ${FOREVER}`]);
    expect(await watch.awaitText(pane, "leader=")).toBe(true);

    const leader = leaderIn(watch.textOf(pane));
    expect(leader).toBeGreaterThan(0);

    const stat = statOf(leader);
    expect(stat?.pgrp, `pid ${leader} is not its own process group leader`).toBe(leader);
    // And it is not our group, which is what the guard in `groupOf` exists to keep true.
    expect(stat?.pgrp).not.toBe(statOf(process.pid)?.pgrp);
  });

  it("resolves only once the tree is gone, grandchild that ignores SIGHUP included", async () => {
    const room = workspace("kill");
    const pidfile = join(room, "holdout.pid");
    const watch = cockpit();

    const pane = watch.open("holdout", BASH, ["-c", holdoutScript(pidfile)], room);
    expect(await until(() => pidIn(pidfile) !== undefined, 5_000)).toBe(true);
    const holdout = pidIn(pidfile) ?? 0;
    const leader = leaderIn(watch.textOf(pane));
    expect(holdout).toBeGreaterThan(0);
    expect(leader).toBeGreaterThan(0);
    expect(running(holdout)).toBe(true);

    await watch.manager.kill(pane);

    // No polling, deliberately: the promise having resolved *is* the claim, so anything still alive here
    // is the claim being false.
    expect(running(holdout), `pid ${holdout} outlived a kill that said the tree was gone`).toBe(false);
    expect(running(leader), `pid ${leader} outlived a kill that said the tree was gone`).toBe(false);
    expect(watch.statusesOf(pane)).toContain("killed");
  });

  it("escalates to SIGKILL for a tree that ignores SIGTERM as well", async () => {
    // The grace period is the load-bearing half, and a grandchild that dies of the first `SIGTERM` never
    // exercises it. This one ignores both signals a process is allowed to ignore, so only the escalation
    // can end it.
    const room = workspace("grace");
    const pidfile = join(room, "holdout.pid");
    const graceMs = 800;
    const watch = cockpit({ graceMs });

    const pane = watch.open("stubborn", BASH, ["-c", holdoutScript(pidfile, "TERM")], room);
    expect(await until(() => pidIn(pidfile) !== undefined, 5_000)).toBe(true);
    const holdout = pidIn(pidfile) ?? 0;
    expect(holdout).toBeGreaterThan(0);

    const at = Date.now();
    const killing = watch.manager.kill(pane);

    // Halfway through the grace period it is still there, because it ignored the SIGTERM. Without this,
    // a tree that died of the first signal would pass the test and say nothing about the escalation.
    await rested(graceMs / 2);
    expect(running(holdout), "SIGTERM was enough, so this proves nothing about the escalation").toBe(
      true,
    );

    await killing;
    const took = Date.now() - at;

    expect(running(holdout), `pid ${holdout} outlived the SIGKILL escalation`).toBe(false);
    expect(took, `the kill answered in ${took}ms, which is inside the grace period`).toBeGreaterThanOrEqual(
      graceMs,
    );
  });

  it("would not have, had it signalled only the leader — the falsification", async () => {
    // The control for the two tests above, and it is what makes them fail if the operating system ever
    // stops behaving this way. Same script, killed the way `IPty.kill` kills: `process.kill` on the
    // leader's own pid. The grandchild ignores the hangup that follows, is reparented to init and keeps
    // running — which is exactly the process this module must not leave behind, and the reason it signals
    // the group.
    const room = workspace("leak");
    const pidfile = join(room, "holdout.pid");
    let leader: number | undefined;
    try {
      const child = spawnPty(BASH, ["-c", holdoutScript(pidfile)], {
        cwd: room,
        env: { ...ENV },
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        encoding: "utf8",
      });
      leader = child.pid;
      child.onData(() => {
        /* drained, so the pty never blocks on a full buffer */
      });

      expect(await until(() => pidIn(pidfile) !== undefined, 5_000)).toBe(true);
      const holdout = pidIn(pidfile) ?? 0;

      child.kill("SIGKILL");
      expect(await until(() => !running(leader ?? 0))).toBe(true);

      // Half a second after the leader is gone, the grandchild is still there.
      await rested(500);
      expect(running(holdout), "the leader-only kill was enough after all").toBe(true);

      // Now clean it up the way the manager would have.
      process.kill(-(leader ?? 0), "SIGKILL");
      expect(await until(() => !running(holdout))).toBe(true);
    } finally {
      if (leader !== undefined) {
        try {
          process.kill(-leader, "SIGKILL");
        } catch {
          /* already gone, which is the point of the test */
        }
      }
    }
  });

  it("buries a grandchild whose leader already exited on its own", async () => {
    // The case a status cannot see: the leader exits 0 — the Pane *delivered* — and the grandchild it
    // forked keeps running, and keeps spending. `kill` on a delivered Pane is not a no-op.
    const room = workspace("orphan");
    const pidfile = join(room, "holdout.pid");
    const watch = cockpit();

    const pane = watch.open(
      "orphan",
      BASH,
      [
        "-c",
        `( trap '' HUP; echo $BASHPID > "${pidfile}"; exec ${FOREVER} ) &\n` +
          `while [ ! -s "${pidfile}" ]; do sleep 0.05; done\nexit 0\n`,
      ],
      room,
    );

    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);
    const holdout = pidIn(pidfile) ?? 0;
    expect(holdout).toBeGreaterThan(0);
    expect(running(holdout), "the grandchild died with its parent, so this proves nothing").toBe(true);

    await watch.manager.kill(pane);

    expect(running(holdout), `pid ${holdout} outlived the kill of a delivered Pane`).toBe(false);
    // Still a delivery. The kill reaped what the delivery left behind; it did not rewrite it.
    expect(watch.statusesOf(pane)).toEqual(["starting", "delivered"]);
  });

  it("has an answer for a tree it could not kill, and here is what it says", () => {
    // **Declared Gap, and it is a gap in the *proof*, not in the code.** The path that raises this cannot
    // be driven from a test: nothing in userspace outlives `SIGKILL` except a process wedged in an
    // uninterruptible read, which needs a contrived device and root to arrange. Shrinking `graceMs` and
    // `killTimeoutMs` to zero was measured as the alternative and rejected — it rejected in 6 of 8 runs,
    // because whether the group has emptied by the next `/proc` read is the scheduler's business. A test
    // that passes six times in eight is worse than a declared Gap, so what is pinned here is the value a
    // caller would receive, and the sequence that leads to it is pinned by the escalation test above.
    const failed = new PaneKillTimeoutError('"stuck"', [4_001, 4_002]);

    expect(failed.name).toBe("PaneKillTimeoutError");
    expect(failed.message).toBe(
      `the process tree of "stuck" outlived SIGKILL: 4001, 4002 are still alive`,
    );
    expect(new PaneKillTimeoutError('"stuck"', [4_001]).message).toContain("4001 is still alive");
    // Frozen, like every list this repository hands out.
    expect(Object.isFrozen(failed.survivors)).toBe(true);
  });

  it("is one kill however many times it is asked for", async () => {
    const watch = cockpit();
    const pane = watch.open("killed-twice", BASH, ["-c", `echo alive; ${FOREVER}`]);
    expect(await watch.awaitText(pane, "alive")).toBe(true);

    await Promise.all([
      watch.manager.kill(pane),
      watch.manager.kill(pane),
      watch.manager.kill(pane),
    ]);
    // And once more, well after the tree is gone: nothing is signalled at an empty group.
    await watch.manager.kill(pane);

    expect(watch.statusesOf(pane).filter((status) => status === "killed")).toEqual(["killed"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 4 — two Panes at once
 * ---------------------------------------------------------------------------------------------- */

/** How many times the arrival order crossed from one Pane to another. Interleaving, counted. */
function switchesIn(arrivals: readonly PaneId[]): number {
  let switches = 0;
  for (const [at, arrived] of arrivals.entries()) {
    if (at > 0 && arrivals[at - 1] !== arrived) {
      switches += 1;
    }
  }
  return switches;
}

describe("two Panes run at once and stay out of each other's way", () => {
  /** One bash Pane and one dash Pane, each counting to twenty half a tenth of a second at a time. */
  function twoPanes(watch: Watched): { readonly alpha: PaneId; readonly beta: PaneId } {
    const alpha = watch.open("alpha", BASH, [
      "-c",
      `echo "alpha-shell=[\${BASH_VERSION:-none}]"; for i in $(seq 1 20); do echo alpha-$i; sleep 0.05; done`,
    ]);
    const beta = watch.open("beta", DASH, [
      "-c",
      `echo "beta-shell=[\${BASH_VERSION:-none}]"; i=1; while [ $i -le 20 ]; do echo beta-$i; sleep 0.05; i=$((i+1)); done`,
    ]);
    return { alpha, beta };
  }

  it("runs two different CLIs at the same time, interleaving, neither blocked", async () => {
    const watch = cockpit({ idleAfterMs: 2_000 });
    const { alpha, beta } = twoPanes(watch);

    expect(await watch.awaitStatus(alpha, "delivered")).toBe(true);
    expect(await watch.awaitStatus(beta, "delivered")).toBe(true);

    // Two different binaries, and the output says so rather than the spawn arguments: only one of them
    // is bash. Pinning a version would tie the test to this host.
    expect(watch.textOf(alpha)).not.toContain("alpha-shell=[none]");
    expect(watch.textOf(beta)).toContain("beta-shell=[none]");

    // Neither was blocked: both reached their last line.
    expect(watch.textOf(alpha)).toContain("alpha-20");
    expect(watch.textOf(beta)).toContain("beta-20");

    // And they were genuinely concurrent, which read off a stream rather than off a clock means the
    // arrival order crossed between them again and again.
    expect(switchesIn(watch.arrivals)).toBeGreaterThanOrEqual(4);
  });

  it("keeps each stream to its own Pane", async () => {
    const watch = cockpit({ idleAfterMs: 2_000 });
    const { alpha, beta } = twoPanes(watch);

    expect(await watch.awaitStatus(alpha, "delivered")).toBe(true);
    expect(await watch.awaitStatus(beta, "delivered")).toBe(true);

    expect(watch.textOf(alpha)).not.toContain("beta");
    expect(watch.textOf(beta)).not.toContain("alpha");
    // Both really did produce plenty, so "no crossing" is not "nothing arrived".
    expect(watch.textOf(alpha).length).toBeGreaterThan(100);
    expect(watch.textOf(beta).length).toBeGreaterThan(100);
  });

  it("keeps a keystroke to the Pane it was typed into", async () => {
    const watch = cockpit();
    const listening = ["-c", `read -r line; echo "heard=[$line]"`];
    const one = watch.open("one", BASH, listening);
    const other = watch.open("other", BASH, listening);

    watch.manager.write(one, "for-one-only\r");

    expect(await watch.awaitText(one, "heard=[for-one-only]")).toBe(true);
    expect(watch.textOf(other)).not.toContain("for-one-only");
    // The other is still waiting for its own line, not blocked and not finished.
    expect(watch.statusesOf(other)).not.toContain("delivered");
  });

  it("leaves the other Pane streaming when one is killed", async () => {
    const watch = cockpit({ idleAfterMs: 2_000 });
    const counting = (label: string): readonly string[] => [
      "-c",
      `while true; do echo ${label}-tick; sleep 0.05; done`,
    ];
    const doomed = watch.open("doomed", BASH, counting("doomed"));
    const survivor = watch.open("survivor", BASH, counting("survivor"));

    expect(await watch.awaitText(doomed, "doomed-tick")).toBe(true);
    expect(await watch.awaitText(survivor, "survivor-tick")).toBe(true);

    await watch.manager.kill(doomed);
    const wroteBefore = watch.textOf(survivor).length;

    expect(await until(() => watch.textOf(survivor).length > wroteBefore, 3_000)).toBe(true);
    expect(watch.statusesOf(doomed)).toContain("killed");
    expect(watch.statusesOf(survivor)).not.toContain("killed");
    expect(watch.textOf(survivor)).not.toContain("doomed");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing is inherited silently
 * ---------------------------------------------------------------------------------------------- */

describe("the environment is a list somebody wrote down", () => {
  it("does not leak a variable of this process that nobody listed", async () => {
    const secret = "megazord-should-never-reach-a-Pane";
    process.env["MEGAZORD_PANE_SECRET"] = secret;
    try {
      const watch = cockpit();
      const pane = watch.open("no-leak", BASH, [
        "-c",
        `echo "secret=[\${MEGAZORD_PANE_SECRET:-unset}]"`,
      ]);

      expect(await watch.awaitText(pane, "secret=[")).toBe(true);
      expect(watch.textOf(pane)).toContain("secret=[unset]");
      expect(watch.textOf(pane)).not.toContain(secret);
    } finally {
      delete process.env["MEGAZORD_PANE_SECRET"];
    }
  });

  it("passes what it was given, and TERM and PWD on top — and names both", async () => {
    const room = workspace("env");
    const watch = cockpit({ env: { ...ENV, MEGAZORD_DECLARED: "declared" }, term: "dumb" });
    const pane = watch.open(
      "declared",
      BASH,
      ["-c", `echo "declared=[$MEGAZORD_DECLARED] term=[$TERM] pwd=[$PWD]"`],
      room,
    );

    expect(await watch.awaitText(pane, "declared=[")).toBe(true);
    expect(watch.textOf(pane)).toContain("declared=[declared]");
    expect(watch.textOf(pane)).toContain("term=[dumb]");
    expect(watch.textOf(pane)).toContain(`pwd=[${room}]`);
  });

  it("gives every Pane the size it was told to, because a CLI wraps its output to it", async () => {
    const watch = cockpit({ cols: 40, rows: 12 });
    const pane = watch.open("size", BASH, ["-c", `echo "size=[$(tput cols)x$(tput lines)]"`]);

    expect(await watch.awaitText(pane, "size=[")).toBe(true);
    expect(watch.textOf(pane)).toContain("size=[40x12]");
  });
});

/* -------------------------------------------------------------------------------------------------
 * A Pane that cannot be opened is refused, and nothing is forked
 * ---------------------------------------------------------------------------------------------- */

/** An opening forced past the compiler, which is how one arrives from a WebSocket frame or an MCP call. */
function forced(open: Partial<Record<keyof PaneOpening, unknown>>): PaneOpening {
  return open as unknown as PaneOpening;
}

describe("a Pane that cannot be opened is refused, and nothing is forked", () => {
  it("refuses a blank cli rather than falling back to a shell", () => {
    // `node-pty` substitutes `sh` for an empty file, which would run a program nobody named and stream it
    // to a human as though it were the Zord they asked for.
    const watch = cockpit();

    // No cast here on purpose: `cli: ""` satisfies the type, exactly as `harness()` accepts one and
    // `resolveHarness` refuses it. A well-typed opening reaching this refusal is the point.
    expect(() =>
      watch.manager.spawn({ paneId: paneId("blank-cli"), cli: "", argv: [], cwd: tmpdir() }),
    ).toThrow(PaneSpawnError);
    // And no Pane was left behind under that id.
    expect(() => watch.manager.write(paneId("blank-cli"), "x")).toThrow(UnknownPaneError);
  });

  it("refuses a cli that is not a string at all", () => {
    const watch = cockpit();

    expect(() =>
      watch.manager.spawn(forced({ paneId: paneId("odd-cli"), cli: 42, argv: [], cwd: tmpdir() })),
    ).toThrow("it names no cli, received 42");
  });

  it("refuses a Pane nobody could name, because it could never be written to or killed", () => {
    const watch = cockpit();

    expect(() =>
      watch.manager.spawn(forced({ paneId: "  ", cli: BASH, argv: [], cwd: tmpdir() })),
    ).toThrow(/must be a non-blank string/);
    expect(() =>
      watch.manager.spawn(forced({ cli: BASH, argv: [], cwd: tmpdir() })),
    ).toThrow("received undefined");
  });

  it("refuses a second Pane under an id that is already open, and leaves the first alone", async () => {
    const watch = cockpit();
    const pane = watch.open("taken", BASH, ["-c", `echo the-first-one; ${FOREVER}`]);

    expect(() =>
      watch.manager.spawn({ paneId: pane, cli: BASH, argv: ["-c", "echo the-second"], cwd: tmpdir() }),
    ).toThrow(/is already open/);

    expect(await watch.awaitText(pane, "the-first-one")).toBe(true);
    expect(watch.textOf(pane)).not.toContain("the-second");
  });

  it("refuses a blank cwd, because a Zord runs inside a Workspace", () => {
    const watch = cockpit();

    expect(() =>
      watch.manager.spawn({ paneId: paneId("no-cwd"), cli: BASH, argv: [], cwd: "" }),
    ).toThrow(`it names no cwd, received ""`);
  });

  it("refuses an argv that is not a list of text", () => {
    const watch = cockpit();

    expect(() =>
      watch.manager.spawn(
        forced({ paneId: paneId("odd-argv"), cli: BASH, argv: "-c echo", cwd: tmpdir() }),
      ),
    ).toThrow(`its argv is "-c echo", not a list`);
    expect(() =>
      watch.manager.spawn(
        forced({ paneId: paneId("odder-argv"), cli: BASH, argv: ["-c", 7], cwd: tmpdir() }),
      ),
    ).toThrow("its argv holds 7 at position 1, which is not text");
  });

  it("refuses a PaneId that identifies nothing, at the constructor", () => {
    expect(() => paneId("")).toThrow(InvalidPaneIdError);
    expect(() => paneId("   ")).toThrow(/must be a non-blank string/);
    expect(paneId("a-pane")).toBe("a-pane");
  });
});

/* -------------------------------------------------------------------------------------------------
 * write and kill against a Pane that is not there
 * ---------------------------------------------------------------------------------------------- */

describe("write and kill answer honestly about a Pane they do not hold", () => {
  it("refuses a write to a Pane that was never opened", () => {
    const watch = cockpit();

    expect(() => watch.manager.write(paneId("never-opened"), "hello")).toThrow(
      `there is no Pane under "never-opened"`,
    );
  });

  it("rejects a kill of a Pane that was never opened, rather than throwing", async () => {
    const watch = cockpit();

    let pending: Promise<void> | undefined;
    expect(() => {
      pending = watch.manager.kill(paneId("never-opened"));
    }).not.toThrow();

    await expect(pending).rejects.toThrow(`there is no Pane under "never-opened"`);
  });

  it("refuses keystrokes that are not text", async () => {
    const watch = cockpit();
    const pane = watch.open("odd-keystrokes", BASH, ["-c", FOREVER]);

    // `IPty.write` throws from inside node-pty on a non-string, and a WebSocket frame is whatever the far
    // side sent — so it is read as `unknown` before it is handed over.
    expect(() => watch.manager.write(pane, undefined as unknown as string)).toThrow(PaneWriteError);
    expect(() => watch.manager.write(pane, 7 as unknown as string)).toThrow(
      "keystrokes must be text, received 7",
    );
    // The Pane is untouched by the refusal.
    expect(watch.statusesOf(pane)).not.toContain("failed");
  });

  it("ignores keystrokes typed into a Pane that has already exited", async () => {
    // The documented race, and it is unavoidable from outside: a human presses a key while the process is
    // exiting. Throwing would make a caller guard against something it cannot see coming.
    const watch = cockpit();
    const pane = watch.open("already-gone", BASH, ["-c", "echo leaving; exit 0"]);
    expect(await watch.awaitStatus(pane, "delivered")).toBe(true);

    expect(() => watch.manager.write(pane, "into-the-void\r")).not.toThrow();
    expect(watch.textOf(pane)).not.toContain("into-the-void");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The listeners
 * ---------------------------------------------------------------------------------------------- */

describe("the listeners", () => {
  it("tells every listener, and tells each which Pane it is about", async () => {
    const manager = paneManager({ env: ENV, idleAfterMs: 400 });
    const first: string[] = [];
    const second: string[] = [];
    manager.onData((paneId, chunk) => first.push(`${paneId}:${chunk}`));
    manager.onData((paneId, chunk) => second.push(`${paneId}:${chunk}`));

    const pane = paneId("two-listeners");
    manager.spawn({ paneId: pane, cli: BASH, argv: ["-c", "echo heard-by-both"], cwd: tmpdir() });
    try {
      expect(await until(() => first.join("").includes("heard-by-both"))).toBe(true);
      expect(second.join("")).toEqual(first.join(""));
      expect(first.join("")).toContain("two-listeners:");
    } finally {
      await manager.kill(pane);
    }
  });

  it("announces starting only to a listener that was already there", async () => {
    // Gap 1, stated as a test rather than only in a comment: nothing is buffered, and `starting` is
    // announced synchronously with the spawn. A Cockpit registers its listeners once, at startup.
    const manager = paneManager({ env: ENV, idleAfterMs: 400 });
    const pane = paneId("late-listener");
    manager.spawn({ paneId: pane, cli: BASH, argv: ["-c", `echo too-late; ${FOREVER}`], cwd: tmpdir() });

    const late: PaneStatus[] = [];
    manager.onStatus((_, status) => late.push(status));
    try {
      expect(await until(() => late.includes("working"))).toBe(true);
      expect(late).not.toContain("starting");
    } finally {
      await manager.kill(pane);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 * ---------------------------------------------------------------------------------------------- */

describe("the type level", () => {
  it("answers the techspec's contract exactly, with nothing widened", () => {
    // Not expressible as a `@ts-expect-error`: what is claimed is assignability, so the proof is the
    // annotation. Change a signature and this line stops compiling, which fails `npm run build`.
    const asContract: PaneManager = paneManager({ env: ENV, idleAfterMs: 100 });

    expect(typeof asContract.spawn).toBe("function");
    expect(typeof asContract.write).toBe("function");
    expect(typeof asContract.kill).toBe("function");
    expect(typeof asContract.onData).toBe("function");
    expect(typeof asContract.onStatus).toBe("function");
  });

  it("keeps kill a promise, because resolving is the claim that the tree is gone", () => {
    const manager = paneManager({ env: ENV, idleAfterMs: 100 });
    // The annotation is the proof again: make `kill` return `void` and this stops compiling.
    const answers: (paneId: PaneId) => Promise<void> = manager.kill;

    expect(typeof answers).toBe("function");
  });

  it("does not let a raw string be a PaneId", () => {
    const manager = paneManager({ env: ENV, idleAfterMs: 100 });

    // @ts-expect-error — a PaneId is branded: a plain string names no Pane, and a Pane's id is what every
    // chunk, keystroke and status is addressed by.
    const written = (): void => manager.write("just-a-string", "keys");
    // @ts-expect-error — same brand, same reason, on the other end of the contract.
    const killed = (): Promise<void> => manager.kill("just-a-string");

    expect([written, killed].every((call) => typeof call === "function")).toBe(true);
  });

  it("has exactly the six statuses the techspec names", () => {
    // The exhaustive record is the proof: add a seventh member to `PaneStatus` and this annotation is
    // incomplete, which fails the build. Remove one and the key below is an excess property.
    const drawn: Record<PaneStatus, string> = {
      starting: "a process exists and has said nothing yet",
      working: "it wrote something inside the window",
      idle: "it did not — which is not the same as waiting for you",
      delivered: "it exited 0",
      failed: "it exited non-zero, or a signal nobody here sent ended it",
      killed: "the kill came from here",
    };

    expect(Object.keys(drawn).sort()).toEqual([
      "delivered",
      "failed",
      "idle",
      "killed",
      "starting",
      "working",
    ]);
  });

  it("has no seventh status, however plausible it sounds", () => {
    const statuses: readonly PaneStatus[] = [
      "starting",
      // @ts-expect-error — there is no `waiting`: "the Pane wants a keystroke" is not observable in a pty
      // and inventing it is the always-zero lie. See the module doc.
      "waiting",
      // @ts-expect-error — and no `running` either: what a Pane says is `working`, read off output.
      "running",
    ];

    expect(statuses).toHaveLength(3);
  });

  it("requires every input that decides what a status means or what a child inherits", () => {
    // @ts-expect-error — idleAfterMs has no default: the window is half of what `idle` means, and a
    // default would be this module guessing invisibly.
    const noWindow = (): PaneManager => paneManager({ env: ENV });
    // @ts-expect-error — env is required: nothing is inherited silently.
    const noEnv = (): PaneManager => paneManager({ idleAfterMs: 100 });

    expect([noWindow, noEnv].every((build) => typeof build === "function")).toBe(true);
  });

  it("does not let a manager be built with an unknown option", () => {
    const built = paneManager({
      env: ENV,
      idleAfterMs: 100,
      // @ts-expect-error — there is no timeout for a Pane, deliberately: a Zord in a Pane may work for an
      // hour, and a deadline here would be this module deciding a Mission was over.
      timeoutMs: 5_000,
    });

    expect(typeof built.spawn).toBe("function");
  });

  it("keeps env the manager's, not the Pane's", () => {
    const manager = paneManager({ env: ENV, idleAfterMs: 100 });

    // Never called, so no process is forked. The excess-property check needs the object literal to be in
    // a position with a contextual type, and `spawn`'s parameter is one; holding the literal in a `const`
    // first would infer a wider type and the directive would report nothing.
    const withEnv = (): void =>
      manager.spawn({
        paneId: paneId("no-env-here"),
        cli: BASH,
        argv: [],
        cwd: tmpdir(),
        // @ts-expect-error — a PaneOpening carries no env: the techspec's spawn takes four fields, and a
        // per-Pane environment is additive the day something needs one.
        env: ENV,
      });

    expect(typeof withEnv).toBe("function");
  });

  it("hands out nothing a caller can rewrite", () => {
    const opening: PaneOpening = { paneId: paneId("frozen"), cli: BASH, argv: ["-c", ":"], cwd: tmpdir() };

    // @ts-expect-error — a PaneOpening's cli is readonly: it is what the Replay will say a Zord ran.
    const rewritten = (): void => void (opening.cli = "/bin/sh");
    // @ts-expect-error — and its argv is a readonly list, for the same reason.
    const appended = (): void => void opening.argv.push("--force");

    expect([rewritten, appended].every((call) => typeof call === "function")).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing is left behind
 * ---------------------------------------------------------------------------------------------- */

describe("nothing is left behind", () => {
  it.skipIf(!ON_LINUX)("leaves no stray holdout from any test in this file", () => {
    const listed = execFileSync("ps", ["-e", "-o", "args="], { encoding: "utf8" });

    expect(listed).not.toContain(FOREVER);
  });
});

/**
 * Sweeps up whatever this file left running, **after** the check above has already judged it.
 *
 * Found in review of Task 9, and it is about the suite rather than about a Pane. The kill escalation
 * test is intermittent on a loaded host, and when it flakes it leaves a live `sleep 297` behind — which
 * then fails the check above on **every subsequent run**, in perpetuity, until a human notices and kills
 * a process by hand. One flake became a permanent red, and a permanent red is how a suite stops being
 * read.
 *
 * The order is the whole design. `afterAll` runs after every test in the file, so a run that leaked
 * still **fails loudly** for the run in which it leaked, and only then is the leak cleared so the next
 * run starts from a clean host. Sweeping in a `beforeAll` instead would have hidden the flake
 * completely, which is the under-reporting failure this repo keeps choosing against.
 *
 * `pgrep -f` is deliberately not used: `CLAUDE.md` records twice that it matches the shell running it.
 * The process list is read and matched by hand, and each pid is signalled directly.
 */
afterAll(() => {
  if (!ON_LINUX) {
    return;
  }
  const listed = execFileSync("ps", ["-e", "-o", "pid=,args="], { encoding: "utf8" });
  for (const line of listed.split("\n")) {
    const at = line.indexOf(" ");
    if (at < 0 || !line.slice(at + 1).trim().startsWith(FOREVER)) {
      continue;
    }
    const pid = Number(line.slice(0, at).trim());
    if (!Number.isInteger(pid) || pid <= 1) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, or not ours to signal. Sweeping is best effort by definition — the assertion
      // above is what reports, and this only stops one run's mess becoming every run's.
    }
  }
});
