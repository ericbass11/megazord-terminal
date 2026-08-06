/**
 * The live process table: one `node-pty` child per Pane, streamed, written to, killed, with a status a
 * human watches.
 *
 * A Pane is an isolated terminal with one Zord inside, and this module is the server side of it. The
 * techspec calls it "the live process table, which is not state, because a process cannot be folded" —
 * everything else the Cockpit shows is derived from the Replay on disk, and this is the one thing that
 * is not derivable, because it is a handle on the operating system.
 *
 * ## A Pane is not an `AgentRunner`, and this is not the runner wearing a different name
 *
 * `ptyAgentRunner` and this module both spawn a pty, and that is the whole of their similarity. The port
 * is **one-shot and closed**: hand `run` an instruction, await one `AgentReport`, and the process is
 * gone. A Pane is **long-lived and open**:
 *
 * - it streams continuously, to whoever is watching, for as long as the process lives;
 * - it accepts keystrokes at **any** time, from a human, not one instruction at the start;
 * - it has a status somebody is looking at, which changes while nothing is being awaited;
 * - it has **no timeout**. A Zord in a Pane may work for an hour, and a deadline that ended it would be
 *   this module deciding a Mission was over — which is a Cap's job, or a human's.
 *
 * So a Pane is not implemented by wrapping the runner: there is nothing to await, no `output` to
 * accumulate, and no `AgentReport` to answer. What is deliberately **reused** is the runner's two hard
 * findings about processes, because they were paid for once and both are load-bearing here:
 *
 * - **`IPty.kill()` signals one pid.** It looks sufficient only because killing the session leader hangs
 *   up the terminal and an ordinary child dies of `SIGHUP`. A grandchild running `trap '' HUP` does not.
 *   The tree is killed by signalling the **process group** — `process.kill(-pid, …)`, valid because
 *   `node-pty` calls `setsid`, so the child's pid is also its process group id — with an escalation to
 *   `SIGKILL` after a grace period. `pane-manager.test.ts` proves the premise (`/proc` says the child's
 *   `pgrp` is its own pid), the escalation, and the control case that fails if a leader-only kill ever
 *   becomes enough.
 * - **Liveness is read from `/proc/<pid>/stat`, not with `process.kill(pid, 0)`**, because a zombie
 *   answers signal 0. This module needs the group-shaped version of that check and it has the identical
 *   trap: measured on this host, `process.kill(-pgid, 0)` still succeeds while the group's last member is
 *   an unreaped zombie. So the group's membership is read out of `/proc` — every numeric entry whose
 *   `pgrp` field is the group and whose state is not `Z` — and that is what `kill` waits on.
 *
 * ## `working` versus `idle` is a reading of output activity, and nothing more
 *
 * A pseudoterminal reports exactly two things: **bytes**, and **an exit**. It does not report what the
 * process on the far side is doing. So the honest definitions are:
 *
 * - **`working`** — the process wrote something within the last `idleAfterMs`.
 * - **`idle`** — it did not.
 * - **`starting`** — a process exists and neither of the two can be said yet: nothing has been written
 *   and the window has not elapsed.
 *
 * Every transition is driven by a real event — a byte, or a timer over a real silence — which is what
 * keeps this from being the always-zero field: nothing here is a status no rule can move.
 *
 * What must be said just as plainly is **what `idle` does not mean**, because the word invites the wrong
 * reading and a human acts on it:
 *
 * - It does not mean the Pane is **waiting for input**. A CLI blocked on a prompt is silent; so is one
 *   waiting three minutes for a model to answer. Both are `idle` here, and only one of them wants a
 *   keystroke.
 * - It does not mean the Pane is **doing nothing**. A Zord compiling a project in silence is `idle` by
 *   this reading and very much working by any other.
 *
 * The distinction a Cockpit would really like — *thinking* versus *waiting for you* — was looked for and
 * is not available, which is why it is not modelled:
 *
 * - **Process state does not carry it.** A process blocked reading the terminal and a process blocked on
 *   a socket are both `S` in `/proc`. The state field cannot tell "waiting for a human" from "waiting for
 *   an API".
 * - **The terminal's foreground process group does not carry it either.** A CLI that `poll`s its own
 *   input alongside its network socket is in the foreground the whole time, whether or not it wants a key.
 * - **`wchan` would carry a hint**, and reading it is a heuristic against kernel internals that differ
 *   between versions and are unreadable without privileges on hardened hosts. The pty runner already
 *   refused the same kind of move — "matching the helper's wording would be a heuristic against a
 *   dependency's internals" — and a status that is right on one kernel is worse than one that is modest
 *   on every kernel.
 * - **Reading the prompt out of the output** is parsing prose to infer intent, which is the thing the
 *   techspec forbids in the one place it matters most ("the Cockpit never parses prose"), and it would be
 *   wrong for every CLI nobody wrote a pattern for.
 *
 * So this is a **declared Gap**: "the Pane is waiting for you" is not observable here and is not
 * reported. The names `working` and `idle` are the techspec's, kept because the contract is binding; what
 * they are is written above. Whoever wants the finer reading brings a signal a pty does not have — a CLI
 * that says so on its own control channel is the obvious one, and it belongs to the control plane rather
 * than to this file.
 *
 * `idleAfterMs` is **required** for the same reason: the window is not a detail of the implementation, it
 * is half of what `idle` means. A default would be this module guessing how long a silence has to be
 * before it counts, and the guess would be invisible in the status a human reads.
 *
 * ## The terminal statuses are three, and they say who ended it
 *
 * - **`delivered`** — the process exited 0, of its own accord.
 * - **`failed`** — it exited non-zero, or a signal **this module did not send** ended it.
 * - **`killed`** — `kill` was called on this Pane. It wins over both, because "a human ended this" is the
 *   fact, and reporting `failed` for a Pane somebody killed would send a human looking for a bug. Same
 *   distinction the runner draws between its `timeout` and its `killed` failures, for the same reason.
 *
 * Signal before exit code, because a process killed by a signal reports `exitCode: 0` and reading the
 * code first would call a destroyed process a delivery.
 *
 * A Pane that already reached a terminal status is **never retold**. Killing a Pane that delivered a
 * minute ago does not rewrite its delivery into a kill: what `kill` does then is destroy whatever the
 * delivery left running, which is a real job — a leader can exit 0 while the grandchild it forked keeps
 * spending — and it is not a new fact about the leader.
 *
 * ## `kill` resolves when the tree is gone, or it rejects
 *
 * The promise is a claim a caller can build on: **when it resolves, no process of that Pane's group is
 * alive.** Not "a signal was sent", not "the leader exited". The sequence is
 *
 * 1. is the group already empty? Then nothing is signalled at all — see the pgid note below;
 * 2. `SIGTERM` to the group, then poll `/proc` for up to `graceMs`;
 * 3. `SIGKILL` to the group, then poll for up to `killTimeoutMs`;
 * 4. still there — **reject** with a `PaneKillTimeoutError` naming the survivors.
 *
 * Step 4 is why this is a promise and not a `void`. A process wedged in an uninterruptible read cannot be
 * killed by anybody, and resolving anyway would hand a caller a guarantee that is false exactly when it
 * matters. Rejecting says so, with pids a human can look at.
 *
 * Two mechanics worth stating:
 *
 * - **A group is never signalled when it is already empty.** A pgid is a small integer the kernel
 *   recycles, so signalling a long-dead Pane's group could reach whatever inherited the number. Checking
 *   first costs one `/proc` scan and removes the whole class. The residual risk is that the number is
 *   recycled *between* the check and the signal, which nothing in a user process can close; it is a
 *   declared Gap and it needs a Pane to have been dead long enough for a wrap-around.
 * - **A group is never signalled unless the child is its own group leader.** `groupOf` reads the pgid out
 *   of `/proc` and returns it only when it equals the child's pid. If that ever stopped being true — a
 *   `node-pty` that stopped calling `setsid` — then `process.kill(-pgid, …)` would signal *this* process's
 *   own group, which on a `SIGKILL` means the Cockpit killing itself and every Pane it holds. The guard
 *   is one comparison and it turns that from a catastrophe into a degraded kill.
 *
 * ## Two Panes share nothing
 *
 * Each Pane holds its own pty, its own status, its own silence timer and its own pair of `node-pty`
 * disposables. There is no buffer anywhere — see below — so there is nothing for two Panes to share and
 * nothing to keep apart. The listener lists are the manager's by contract (`onData` is told which Pane a
 * chunk came from), and every dispatch carries the originating `PaneId`, so a chunk cannot arrive under
 * another Pane's name. `pane-manager.test.ts` runs two different binaries at once and asserts each
 * stream contains only its own output.
 *
 * A listener that throws is **not** allowed to break the dispatch, and is not swallowed either: the
 * remaining listeners are still called and the error is rethrown on a later turn, where the runtime
 * reports it as an unhandled error. Swallowing it is the failure this project records twice about scans —
 * under-reporting gets believed.
 *
 * ## Nothing is inherited silently
 *
 * `env` is required, is a complete map, and this module never reads `process.env` on its own behalf. Same
 * rule and same reason as the runner: a CLI that inherits the parent environment inherits every
 * credential the parent holds, and a Zord is a process running text somebody else wrote. Two variables
 * reach the child that a caller did not list, both set by `node-pty`, both named so the list is complete:
 * `TERM` (from `term`) and `PWD` (set to the Pane's `cwd`).
 *
 * `env` is the **manager's**, not the Pane's, because the techspec's `spawn` takes `{ paneId, cli, argv,
 * cwd }` and that contract is binding. A per-Pane environment is additive the day something needs one.
 *
 * ## Declared Gaps
 *
 * 1. **Nothing is buffered.** A chunk is dispatched to whoever is listening and dropped. A listener
 *    registered after a Pane started misses what that Pane already wrote. This is not an oversight: the
 *    control plane's `pane_read` needs a scrollback, and a scrollback needs a bound nobody has chosen —
 *    so the buffer arrives with its first reader, rather than sitting here as a field no rule fills.
 *    Register listeners before spawning, which is what a Cockpit does anyway.
 * 2. **The status stream carries no exit code.** `onStatus` is `(paneId, status)` by contract, so a
 *    `failed` Pane's code is not in it. What the process wrote before failing did reach `onData`, which is
 *    where a human reads what happened. Widening the callback is the additive fix.
 * 3. **The table remembers every Pane of the session.** A killed Pane keeps a small record — its status,
 *    its pids — so that a `write` racing an exit is a no-op rather than an error, and so that `kill` is
 *    idempotent. Nothing reclaims it, because the contract has no `forget` and a method with no caller is
 *    the always-zero field wearing a function type. Whoever owns the Cockpit's Pane lifecycle adds it.
 * 4. **A listener cannot be removed.** `onData` and `onStatus` answer `void`, per the contract, so a
 *    listener lives as long as the manager. Fine for a Cockpit with one set of them; not fine for a caller
 *    that attaches per Pane.
 * 5. **Off Linux, `kill` claims less than it says.** The `/proc` scan is what makes "the tree is gone" an
 *    observation. Where there is no `/proc` the check degrades to the leader's own liveness, read through
 *    `process.kill(pid, 0)`, which counts a zombie as alive and knows nothing about a grandchild. The
 *    tests that read `/proc` are skipped elsewhere rather than quietly weakened, exactly as the runner's
 *    are.
 * 6. **A `cwd` that does not exist is a `failed` Pane, not a refusal**, and so is a `cli` that is not
 *    there. `node-pty` forks a helper that `chdir`s and `execvp`s, so both arrive as `exitCode: 1` with
 *    the reason written on the terminal (`chdir(2) failed.: No such file or directory`) — measured, and
 *    pinned by a test rather than guessed at. This module cannot tell either apart from the CLI itself
 *    exiting 1, and matching the helper's wording would be a heuristic against a dependency's internals:
 *    the same Gap `pty-agent-runner.ts` already declares for a missing binary. What `spawn` *can* refuse
 *    is a `cwd` that is blank or not a string, because that is this module's own reading and not the
 *    helper's.
 */

import { readFileSync, readdirSync } from "node:fs";

import { spawn as spawnPty, type IDisposable, type IPty } from "node-pty";

/* -------------------------------------------------------------------------------------------------
 * The identity
 * ---------------------------------------------------------------------------------------------- */

declare const brand: unique symbol;

/** A `string` tagged with a phantom brand. Mirrors `engine/domain/ids.ts`, which does not export its own. */
type Branded<TBrand extends string> = string & { readonly [brand]: TBrand };

/**
 * Identifies a Pane.
 *
 * Branded for the reason every id in this repository is: a Pane's id is what every chunk of output, every
 * keystroke and every status is addressed by, and a raw string — or a `ZordId` — must not be passable
 * where one is required. The brand exists only in the type system; nothing is wrapped.
 */
export type PaneId = Branded<"PaneId">;

/** Raised when a PaneId is constructed from a value that cannot identify anything. */
export class InvalidPaneIdError extends Error {
  constructor(value: string) {
    super(`a PaneId must be a non-blank string, received ${JSON.stringify(value)}`);
    this.name = "InvalidPaneIdError";
  }
}

/** Constructs a PaneId. Throws `InvalidPaneIdError` on a blank value. */
export function paneId(value: string): PaneId {
  if (value.trim().length === 0) {
    throw new InvalidPaneIdError(value);
  }
  return value as PaneId;
}

/* -------------------------------------------------------------------------------------------------
 * The status
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a Pane is doing, as far as a pseudoterminal can honestly report it.
 *
 * `working` and `idle` are a reading of **output activity** over `idleAfterMs`, not of intent — read the
 * module doc before showing either to a human, because `idle` does not mean "waiting for you".
 */
export type PaneStatus =
  /** A process exists, it has written nothing, and the silence is not yet long enough to be called one. */
  | "starting"
  /** It wrote something within the last `idleAfterMs`. */
  | "working"
  /** It wrote nothing within the last `idleAfterMs`. Not "waiting for input" — see the module doc. */
  | "idle"
  /** It exited 0, of its own accord. */
  | "delivered"
  /** It exited non-zero, or a signal this module did not send ended it. */
  | "failed"
  /** `kill` was called on this Pane. Wins over the other two terminal readings. */
  | "killed";

/** Whether a status is the last thing this Pane will ever say. */
function isFinal(status: PaneStatus): boolean {
  return status === "delivered" || status === "failed" || status === "killed";
}

/* -------------------------------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------------------------------- */

/**
 * No process was started, and no Pane exists under that id.
 *
 * Only for what this module reads for itself — a blank `cli`, a blank `cwd`, an id already open, an `argv`
 * that is not a list of strings, a fork that failed. A `cli` or a `cwd` that names something *absent* is
 * not here: `node-pty`'s helper `chdir`s and `execvp`s inside the forked child, so both come back as an
 * ordinary exit and the Pane is `failed` with the reason on its terminal. Gap 6 in the module doc.
 *
 * Thrown out of `spawn` rather than reported as a `failed` status, and the choice is the runner's
 * argument restated: a status is a claim about a process, so announcing `failed` for a Pane that was
 * never forked would put a process that never ran into the record a human reads. Staying silent is worse
 * still — a Cockpit would draw an empty Pane forever with nothing to say about it. So the caller hears
 * about its own bug at the call site, and the status stream stays true.
 */
export class PaneSpawnError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this Pane cannot be opened: ${detail}`);
    this.name = "PaneSpawnError";
    this.detail = detail;
  }
}

/** `write` or `kill` named a Pane this table does not hold. A wrong id is not a race; it is a bug. */
export class UnknownPaneError extends Error {
  readonly named: string;

  constructor(named: string) {
    super(`there is no Pane under ${named}`);
    this.name = "UnknownPaneError";
    this.named = named;
  }
}

/**
 * The keystrokes are not text.
 *
 * Only reachable through a cast, and that is the ordinary path here rather than an exotic one: the
 * techspec's `pane-write` arrives as a WebSocket frame and a frame is whatever the far side sent.
 * `IPty.write` throws from inside `node-pty` on a non-string, so it is read as `unknown` first — the
 * grade this project calls *computing with* a field.
 */
export class PaneWriteError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this Pane cannot be written to: ${detail}`);
    this.name = "PaneWriteError";
    this.detail = detail;
  }
}

/**
 * The process tree outlived `SIGKILL`, so `kill` cannot claim what it promises.
 *
 * `survivors` is what was still in the group when the last poll gave up — an uninterruptible read is the
 * ordinary cause, and it is a fact about the host rather than about this module, which is exactly why it
 * is handed to the caller instead of being absorbed.
 */
export class PaneKillTimeoutError extends Error {
  readonly survivors: readonly number[];

  constructor(named: string, survivors: readonly number[]) {
    super(
      `the process tree of ${named} outlived SIGKILL: ${survivors.join(", ")} ` +
        `${survivors.length === 1 ? "is" : "are"} still alive`,
    );
    this.name = "PaneKillTimeoutError";
    this.survivors = Object.freeze([...survivors]);
  }
}

/* -------------------------------------------------------------------------------------------------
 * The contract
 * ---------------------------------------------------------------------------------------------- */

/** What one Pane is opened with. The techspec's shape, unchanged. */
export type PaneOpening = {
  /** The Pane's identity, in every chunk, status and keystroke that follows. */
  readonly paneId: PaneId;
  /** The program to run. Never blank: `node-pty` substitutes `sh` for an empty file. */
  readonly cli: string;
  /**
   * Its argument vector.
   *
   * Required, and deliberately not defaulted to `[]`: the flags that carry a Harness's model, effort and
   * skills have no spelling that is true of `claude`, `codex` and `gemini` at once, so a default would run
   * a Zord under a bundle nobody chose. The mapping is the caller's to state, exactly as the runner's
   * `argumentsFor` is.
   */
  readonly argv: readonly string[];
  /** The directory it runs in. A Zord runs inside a Workspace, never wherever this process started. */
  readonly cwd: string;
};

/** What a manager is built with. Every input that touches the world is here, and none has a hidden default. */
export type PaneManagerOptions = {
  /**
   * Every Pane's entire environment, as a complete map.
   *
   * Required and never merged with `process.env`. `node-pty` sets `TERM` and `PWD` on top of it, and
   * nothing else does. Build it by writing the pass-through list down — `inheritedEnv` in
   * `pty-agent-runner.ts` is that idiom.
   */
  readonly env: Readonly<Record<string, string>>;
  /**
   * How long a Pane may write nothing before it is reported `idle`.
   *
   * Required, because the window is half of what `idle` *means* and a default would be this module
   * guessing how long a silence counts — invisibly, inside a status a human acts on.
   */
  readonly idleAfterMs: number;
  /** How long a doomed tree gets between `SIGTERM` and `SIGKILL`. Default 2000ms. */
  readonly graceMs?: number;
  /** How long after `SIGKILL` before `kill` rejects rather than claiming the tree is gone. Default 2000ms. */
  readonly killTimeoutMs?: number;
  /** `TERM` for every Pane. Default `"xterm-256color"`. */
  readonly term?: string;
  /** Terminal size. Defaults 120×40. A CLI wraps its output to these, so they are part of what it writes. */
  readonly cols?: number;
  readonly rows?: number;
};

/**
 * The live process table.
 *
 * Deliberately **not** a wrapper over `AgentRunner`: there is no instruction, no awaited answer and no
 * timeout here. See the module doc.
 */
export interface PaneManager {
  /**
   * Opens a Pane: forks the process, announces `starting`, and starts streaming.
   *
   * Synchronous, and `starting` is announced synchronously with it, so listeners registered before the
   * first `spawn` see every status a Pane ever has.
   *
   * @throws {PaneSpawnError} when nothing was forked — a blank `cli`, an id already in use, a blank
   * `cwd`, an `argv` that is not a list of strings, or a fork that failed. A `cli` or a `cwd` that names
   * something absent is **not** one of these: `node-pty`'s helper reports both as an exit, so they are a
   * `failed` Pane with the reason on the terminal. See Gap 6.
   */
  spawn(open: PaneOpening): void;
  /**
   * Delivers keystrokes to a Pane, exactly as a human typing into it would.
   *
   * A Pane that has already exited **ignores** them: a human types into a Pane whose process died a
   * millisecond ago and no caller can avoid that race.
   *
   * @throws {UnknownPaneError} when no Pane holds that id.
   * @throws {PaneWriteError} when the keystrokes are not a string.
   */
  write(paneId: PaneId, keystrokes: string): void;
  /**
   * Destroys a Pane's process tree.
   *
   * Resolves **once no process of that Pane's group is alive** — that is the whole point of the promise,
   * and a caller may build on it. Idempotent: a second call joins the kill already in flight rather than
   * signalling a second time, and a call after the tree is gone resolves without signalling at all.
   *
   * @throws {UnknownPaneError} as a rejection, when no Pane holds that id.
   * @throws {PaneKillTimeoutError} as a rejection, when the tree outlived `SIGKILL`.
   */
  kill(paneId: PaneId): Promise<void>;
  /** Watches every Pane's output. Told which Pane wrote each chunk. Nothing is buffered for a late listener. */
  onData(listen: (paneId: PaneId, chunk: string) => void): void;
  /** Watches every Pane's status. Only changes are announced; a status is never repeated. */
  onStatus(listen: (paneId: PaneId, status: PaneStatus) => void): void;
}

/* -------------------------------------------------------------------------------------------------
 * Defaults and constants
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_GRACE_MS = 2_000;
const DEFAULT_KILL_TIMEOUT_MS = 2_000;
const DEFAULT_TERM = "xterm-256color";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

/**
 * How often the group is re-read from `/proc` while waiting for it to empty.
 *
 * A `/proc` scan is a few hundred stat reads out of a virtual filesystem, so 25ms is cheap and it is only
 * ever paid during a kill. Polling rather than waiting on an event because there is no event: the kernel
 * tells a parent about *its own* children, and a grandchild reparented to init is nobody's child here.
 */
const POLL_MS = 25;

/* -------------------------------------------------------------------------------------------------
 * The manager
 * ---------------------------------------------------------------------------------------------- */

/** One Pane's row in the table. Nothing here is shared with another Pane. */
type Pane = {
  readonly paneId: PaneId;
  readonly pty: IPty;
  /** The pid of the process that was forked. */
  readonly leader: number;
  /** The process group to signal, or `undefined` when signalling one would be unsafe. See `groupOf`. */
  readonly group: number | undefined;
  status: PaneStatus;
  /** Fires when the Pane has been silent for `idleAfterMs`. Cleared by every chunk and by the exit. */
  quiet: ReturnType<typeof setTimeout> | undefined;
  /** Whether `kill` was called on this Pane, which is what makes its exit a `killed` rather than a `failed`. */
  killRequested: boolean;
  /** The one in-flight kill, so two calls are one kill. */
  killing: Promise<void> | undefined;
  readonly listening: readonly IDisposable[];
};

/**
 * Builds a manager over one environment.
 *
 * It holds the Panes it opened and nothing else: no Mission, no state a Replay could hold, no buffer.
 */
export function paneManager(options: PaneManagerOptions): PaneManager {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;

  const panes = new Map<string, Pane>();
  const dataListeners: ((paneId: PaneId, chunk: string) => void)[] = [];
  const statusListeners: ((paneId: PaneId, status: PaneStatus) => void)[] = [];

  /** Announces a status unconditionally. `announce` is the deduplicating one. */
  function tell(pane: Pane, status: PaneStatus): void {
    pane.status = status;
    for (const listen of statusListeners) {
      safely(() => {
        listen(pane.paneId, status);
      });
    }
  }

  /** Announces a status only when it is a change. A stream that repeats itself is noise, not a fact. */
  function announce(pane: Pane, status: PaneStatus): void {
    if (pane.status === status) {
      return;
    }
    tell(pane, status);
  }

  /**
   * Restarts the silence timer.
   *
   * `unref`'d, so a watched Pane's pending `idle` never keeps a process alive at the end of a test run or
   * a CLI session. The pty's own descriptor is what holds the loop open while a Pane lives.
   */
  function armQuiet(pane: Pane): void {
    clearTimeout(pane.quiet);
    const quiet = setTimeout(() => {
      // Belt to the `clearTimeout` on the exit's braces, and the test proves the **pair**: breaking either
      // one alone leaves the file green, breaking both lets a window armed by the last chunk announce
      // `idle` over a Pane that has already delivered. Neither is individually necessary; do not delete
      // both, and see "says nothing more once a Pane has reached a terminal status".
      if (!isFinal(pane.status)) {
        announce(pane, "idle");
      }
    }, options.idleAfterMs);
    quiet.unref();
    pane.quiet = quiet;
  }

  return {
    spawn(open: PaneOpening): void {
      // Everything a fork would silently absorb is read as `unknown` first. A Pane arrives from a
      // WebSocket frame or an MCP call as readily as from a constructor, so the types are not the
      // guarantee — the same standard the runner holds `cli` to, for the same three reasons: a blank
      // `cli` runs `sh` under the Harness's name, a blank `cwd` runs a Zord wherever this process
      // happens to be, and a blank `paneId` opens a Pane nobody can address, write to or kill.
      const named: unknown = open.paneId;
      if (typeof named !== "string" || named.trim().length === 0) {
        throw new PaneSpawnError(`a Pane is opened under its id, which must be a non-blank string, received ${shown(named)}`);
      }
      if (panes.has(named)) {
        // Refused rather than allowed, for the reason a reused DelegationId is refused: two processes
        // under one id cannot be told apart in the data stream, and `write` and `kill` would have to
        // guess which one a human meant.
        throw new PaneSpawnError(`${JSON.stringify(named)} is already open`);
      }

      const cli: unknown = open.cli;
      if (typeof cli !== "string" || cli.trim().length === 0) {
        throw new PaneSpawnError(`it names no cli, received ${shown(cli)}`);
      }

      const cwd: unknown = open.cwd;
      if (typeof cwd !== "string" || cwd.trim().length === 0) {
        throw new PaneSpawnError(`it names no cwd, received ${shown(cwd)}`);
      }

      const argv: unknown = open.argv;
      if (!Array.isArray(argv)) {
        throw new PaneSpawnError(`its argv is ${shown(argv)}, not a list`);
      }
      // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to, and then walked
      // element by element rather than cast: `spawnPty` throws from inside `node-pty` on a non-string
      // argument, and a cast would have made the type a claim instead of a check.
      const listed: readonly unknown[] = argv;
      const argumentsGiven: string[] = [];
      for (const [at, argument] of listed.entries()) {
        if (typeof argument !== "string") {
          throw new PaneSpawnError(
            `its argv holds ${shown(argument)} at position ${at}, which is not text`,
          );
        }
        argumentsGiven.push(argument);
      }

      let pty: IPty;
      try {
        pty = spawnPty(cli, argumentsGiven, {
          cwd,
          env: { ...options.env },
          name: options.term ?? DEFAULT_TERM,
          cols: options.cols ?? DEFAULT_COLS,
          rows: options.rows ?? DEFAULT_ROWS,
          encoding: "utf8",
        });
      } catch (cause) {
        throw new PaneSpawnError(messageOf(cause));
      }

      const listening: IDisposable[] = [];
      const pane: Pane = {
        // The one cast this needs, and what makes it safe is the check above it: a PaneId is a non-blank
        // string and nothing else, and `named` has just been shown to be one.
        paneId: named as PaneId,
        pty,
        leader: pty.pid,
        group: groupOf(pty.pid),
        status: "starting",
        quiet: undefined,
        killRequested: false,
        killing: undefined,
        listening,
      };

      listening.push(
        pty.onData((chunk: string) => {
          // The status moves only while the Pane is still speaking for itself. `node-pty` can deliver a
          // trailing chunk around the exit, and those bytes are real and still dispatched — what must not
          // happen is a Pane that delivered being retold as `working`.
          if (!isFinal(pane.status)) {
            announce(pane, "working");
            armQuiet(pane);
          }
          for (const listen of dataListeners) {
            safely(() => {
              listen(pane.paneId, chunk);
            });
          }
        }),
      );

      listening.push(
        pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
          clearTimeout(pane.quiet);
          pane.quiet = undefined;
          // A Pane that already said something final keeps saying it: nothing rewrites a delivery.
          //
          // **Defensive, and unexercisable from the public surface — measured, not assumed.** Removing this
          // guard left the whole file green, because `node-pty` emits `onExit` once and this handler
          // disposes its own listener, so the status is always `starting`, `working` or `idle` when it
          // runs. The "already delivered, then killed" case never reaches here at all: `kill` finds the
          // exit long gone and only reaps the tree. Kept because the invariant it states — a terminal
          // status is final — is what every exact-sequence assertion in the test file rests on, and the
          // day a second exit path exists this is the line that keeps it true. The *other* `isFinal` check,
          // in `onData`, is the reachable one.
          if (!isFinal(pane.status)) {
            announce(pane, endingOf(pane, exitCode, signal));
          }
          for (const disposable of pane.listening) {
            disposable.dispose();
          }
        }),
      );

      panes.set(named, pane);
      // After the record exists, so a listener that reacts to `starting` by writing or killing finds the
      // Pane it was told about. Synchronous, which is what makes `starting` the first thing said about
      // every Pane.
      tell(pane, "starting");
      armQuiet(pane);
    },

    write(claimed: PaneId, keystrokes: string): void {
      const pane = paneUnder(panes, claimed);

      const typed: unknown = keystrokes;
      if (typeof typed !== "string") {
        throw new PaneWriteError(`keystrokes must be text, received ${shown(typed)}`);
      }

      if (isFinal(pane.status)) {
        // The documented race: the process died between the human's keystroke and this call. There is
        // nothing to deliver it to and nothing anybody did wrong.
        return;
      }

      try {
        pane.pty.write(typed);
      } catch {
        // The process died between the check above and this write. Its exit is already on its way with
        // the real reason, and inventing a second one here would race it — the same call the runner makes
        // when its instruction cannot be delivered.
      }
    },

    async kill(claimed: PaneId): Promise<void> {
      // An `async` function, so an unknown id arrives as a rejection rather than as a synchronous throw:
      // a caller that gets a Promise back must not have to guard the call as well.
      const pane = paneUnder(panes, claimed);

      // A **rejection is not a permanent answer**, so it does not stay cached. `PaneKillTimeoutError`
      // means the tree was still there when the polling gave up, and the `SIGKILL` that was sent is still
      // pending — a process in an uninterruptible read comes out of it and dies of the queued signal. So
      // a second `kill` must be able to look again and report the truth. Caching the rejection instead
      // would make one timed-out kill the last word on that Pane forever, which is the worst possible
      // moment to stop answering: a stuck Pane is exactly the one a human is trying to end.
      //
      // Unexercisable for the same reason the rejection itself is — see the test that pins the error's
      // wording — and written this way deliberately rather than left as the shorter `??=` alone.
      pane.killing ??= reap(pane, graceMs, killTimeoutMs).catch((thrown: unknown) => {
        pane.killing = undefined;
        throw thrown;
      });
      return pane.killing;
    },

    onData(listen: (paneId: PaneId, chunk: string) => void): void {
      dataListeners.push(listen);
    },

    onStatus(listen: (paneId: PaneId, status: PaneStatus) => void): void {
      statusListeners.push(listen);
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the table
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Pane under an id, or a refusal.
 *
 * The id is read as `unknown` because it is a `Map` key here: `panes.get(undefined)` answers `undefined`
 * happily, so without this the failure would be an `UnknownPaneError` naming nothing rather than one that
 * says what arrived.
 */
function paneUnder(panes: ReadonlyMap<string, Pane>, claimed: PaneId): Pane {
  const named: unknown = claimed;
  if (typeof named !== "string") {
    throw new UnknownPaneError(shown(named));
  }

  const pane = panes.get(named);
  if (pane === undefined) {
    throw new UnknownPaneError(JSON.stringify(named));
  }
  return pane;
}

/**
 * Which terminal status an exit is.
 *
 * Signal before exit code: a process killed by a signal reports `exitCode: 0`, so reading the code first
 * would report a delivery for a process that was destroyed.
 */
function endingOf(pane: Pane, exitCode: number, signal: number | undefined): PaneStatus {
  if (pane.killRequested) {
    return "killed";
  }
  if (signal !== undefined && signal !== 0) {
    return "failed";
  }
  return exitCode === 0 ? "delivered" : "failed";
}

/**
 * Calls a listener, and never lets it break the dispatch.
 *
 * Rethrown on a later turn rather than swallowed: the remaining listeners still get their chunk, and the
 * runtime reports the failure as an unhandled error instead of it disappearing. A dropped exception in a
 * data path is the under-reporting failure this project keeps refusing.
 */
function safely(call: () => void): void {
  try {
    call();
  } catch (thrown) {
    setTimeout(() => {
      throw thrown;
    }, 0);
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: killing a tree
 * ---------------------------------------------------------------------------------------------- */

/**
 * `SIGTERM`, then `SIGKILL`, and resolves only once the group is empty.
 *
 * The order matters and each step is there for a stated reason — see "kill resolves when the tree is
 * gone" in the module doc.
 */
async function reap(pane: Pane, graceMs: number, killTimeoutMs: number): Promise<void> {
  // Before anything is signalled, so the exit that follows is read as a kill and not as a failure.
  pane.killRequested = true;

  // Nothing is signalled at a group that is already empty: a pgid is a recycled integer and a dead
  // Pane's number may belong to somebody else by now.
  if (livePidsOf(pane).length === 0) {
    return;
  }

  signalTree(pane, "SIGTERM");
  if (await goneWithin(pane, graceMs)) {
    return;
  }

  signalTree(pane, "SIGKILL");
  if (await goneWithin(pane, killTimeoutMs)) {
    return;
  }

  throw new PaneKillTimeoutError(JSON.stringify(pane.paneId), livePidsOf(pane));
}

/**
 * Whether the group emptied within `withinMs`. Polls, because a grandchild is nobody's child here.
 *
 * The poll timer is deliberately **not** `unref`'d, unlike the silence timer. A pending promise does not
 * keep an event loop alive on its own, and once the leader has exited its pty descriptor no longer does
 * either — so an `unref`'d poll would let the process exit with a `kill` still in flight, leaving the
 * caller's `await` unresolved and the grandchild this function exists to bury still running. A kill is
 * bounded by `graceMs + killTimeoutMs`, so holding the loop open until it answers cannot hang anything.
 */
async function goneWithin(pane: Pane, withinMs: number): Promise<boolean> {
  const until = Date.now() + withinMs;
  while (Date.now() < until) {
    await new Promise((wake) => setTimeout(wake, POLL_MS));
    if (livePidsOf(pane).length === 0) {
      return true;
    }
  }
  return livePidsOf(pane).length === 0;
}

/**
 * Sends one signal to a Pane's process group, falling back to the leader alone.
 *
 * The group and not the pid, because that is the only thing that reaches a grandchild running
 * `trap '' HUP` — the finding this module inherits from `pty-agent-runner.ts`. The first attempt is
 * skipped entirely when the child is not its own group leader, because then a negative pid would name a
 * group this process may itself be in. The remaining fallbacks are for the platforms where a negative pid
 * means nothing and for the ordinary case of everything being gone already, where every attempt throws
 * `ESRCH` and there is nothing left to do about it.
 */
function signalTree(pane: Pane, signal: NodeJS.Signals): void {
  const group = pane.group;
  const attempts: readonly (() => void)[] = [
    ...(group === undefined
      ? []
      : [
          (): void => {
            process.kill(-group, signal);
          },
        ]),
    (): void => {
      pane.pty.kill(signal);
    },
    (): void => {
      pane.pty.kill();
    },
  ];

  for (const attempt of attempts) {
    try {
      attempt();
      return;
    } catch {
      // Try the next one. All of them failing means the process is already gone.
    }
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: what the operating system says is alive
 * ---------------------------------------------------------------------------------------------- */

/**
 * The process group a child should be signalled through, or `undefined` when signalling one is unsafe.
 *
 * `node-pty` calls `setsid`, so a child is the leader of its own new session and its pid is also its
 * process group id — which is what makes `process.kill(-pid, …)` reach the whole tree. That premise is
 * **read back out of `/proc` rather than assumed**, and the group is returned only when it holds. If it
 * ever stops holding, signalling the group would signal *this* process's own group, and a `SIGKILL` there
 * takes the Cockpit and every other Pane with it. One comparison turns that into a degraded kill.
 *
 * Where `/proc` cannot be read at all — every non-Linux host — the pid is returned on the strength of the
 * POSIX `setsid` call, which is the same assumption the runner already ships. Declared Gap 5 in the module
 * doc is the honest statement of what is lost there.
 */
function groupOf(leader: number): number | undefined {
  const pgrp = pgrpOf(leader);
  if (pgrp === undefined) {
    return leader;
  }
  return pgrp === leader ? leader : undefined;
}

/**
 * Every live process of a Pane's group.
 *
 * Read out of `/proc` and **not** with `process.kill(-pgid, 0)`, which is the group-shaped version of the
 * trap `pty-agent-runner.ts` records for a single pid: a zombie still answers signal 0. Measured on this
 * host — `process.kill(-pgid, 0)` succeeded after the group's every member had been `SIGKILL`ed, because
 * the leader was an unreaped zombie at that instant. A kill that waited on that check would resolve for a
 * tree it could still see, or never resolve at all on a host whose init is slow to reap.
 *
 * Falls back to the leader's own liveness where there is no `/proc`, which knows nothing about a
 * grandchild. Synchronous reads on purpose: `/proc` is a virtual filesystem answered out of kernel
 * memory, there is no disk to wait for, and a poll loop that awaited a few hundred file handles would
 * cost more than it saves.
 */
function livePidsOf(pane: Pane): readonly number[] {
  const group = pane.group;
  if (group !== undefined) {
    const scanned = pidsInGroup(group);
    if (scanned !== undefined) {
      return scanned;
    }
  }
  return isRunning(pane.leader) ? [pane.leader] : [];
}

/**
 * The pids whose process group is `pgid` and which are not zombies, or `undefined` where `/proc` is not
 * readable.
 *
 * `undefined` and not `[]`: an unreadable `/proc` is "no answer", and answering "the group is empty"
 * would make `kill` resolve on a tree nobody looked at. The distinction is the whole difference between
 * a degraded guarantee and a false one.
 *
 * **The `Z` exclusion is a guard no test here forces, and that is recorded rather than implied.** Removing
 * it was tried and the whole file still passed: after a group `SIGKILL` the survivors become zombies whose
 * parent is dead, so init reparents and reaps them well inside `graceMs`, and the wait ends either way.
 * What it protects is the host where that is not true — a slow or busy reaper — on which `kill` would sit
 * on an already-dead tree and eventually **reject**, reporting a kill that in fact worked. It is the same
 * reading `pty-agent-runner.ts` states for a single pid, where it *is* decisive because the assertion comes
 * immediately after the kill with no grace. Kept for that reason, and measured as unreachable from here:
 * holding a group open with a zombie as its *only* member needs that zombie's parent to be alive and
 * outside the group, which nothing in a test can arrange.
 */
function pidsInGroup(pgid: number): readonly number[] | undefined {
  let entries: readonly string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }

  const held: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const stat = statFieldsOf(entry);
    // A process that vanished between the readdir and the read is gone, which is the answer wanted.
    if (stat !== undefined && stat.pgrp === pgid && stat.state !== "Z") {
      held.push(Number(entry));
    }
  }
  return held;
}

/** The process group of one pid, or `undefined` when `/proc` does not answer for it. */
function pgrpOf(pid: number): number | undefined {
  return statFieldsOf(String(pid))?.pgrp;
}

/**
 * The state character and the process group out of `/proc/<pid>/stat`.
 *
 * The fields are read from **after the last `)`**, because `comm` is the second field, is not escaped,
 * and may itself contain spaces and parentheses — a process named `(evil) R 1 1` would otherwise shift
 * every field after it. What follows that parenthesis is `state ppid pgrp …`.
 */
function statFieldsOf(pid: string): { readonly state: string; readonly pgrp: number } | undefined {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }

  const after = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
  const state = after[0];
  const pgrp = Number(after[2]);
  if (state === undefined || !Number.isInteger(pgrp)) {
    return undefined;
  }
  return { state, pgrp };
}

/**
 * Whether a pid names a live process.
 *
 * `/proc` where it exists, for the reason above; `process.kill(pid, 0)` where it does not, which is the
 * weaker reading Gap 5 declares.
 */
function isRunning(pid: number): boolean {
  const stat = statFieldsOf(String(pid));
  if (stat !== undefined) {
    return stat.state !== "Z";
  }

  try {
    // Reachable two ways, and they need opposite answers: on a host with no `/proc` this is the only
    // check there is, and on Linux an unreadable `/proc/<pid>` means the process is gone. `ESRCH` from
    // here is the same answer either way.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure. Mirrors `harness.ts`, the pty runner and the store. */
function shown(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? "a list" : "an object";
  }
  return String(value);
}
