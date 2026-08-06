/**
 * A real `AgentRunner`: it spawns a CLI in a pseudoterminal, feeds it the instruction, collects what
 * the terminal produced, and answers the port's `AgentReport`.
 *
 * ## Why this file is not in `engine/`
 *
 * The engine has **no dependency of any kind** — `engine/mission.e2e.test.ts` reads every non-test
 * source under `engine/` and asserts that every `from "…"` specifier is a relative path, which is the
 * structural half of "no network, no CLI". This module imports `node-pty`, a native dependency that
 * forks processes. Putting it under `engine/adapters/` would fail that test, and rightly: it would mean
 * the domain could no longer be typechecked, tested or reasoned about without a compiler toolchain and
 * a pty on the machine.
 *
 * So `runtime/` exists, and the dependency runs one way. `runtime/` may import `engine/`; `engine/`
 * must never import `runtime/`. The only things crossing are the port's three types and `ZERO_MONEY`.
 *
 * ## A pty is not a pipe, and this module does not pretend otherwise
 *
 * A pseudoterminal is used rather than a pipe because a CLI behaves differently when it is talking to
 * one: it is what makes a Zord's process interactive, and the Cockpit is a grid of terminals. Three
 * consequences fall out of that, and all three are left visible rather than papered over:
 *
 * - **There is one stream, not two.** stdout and stderr arrive interleaved on the same terminal, in the
 *   order the child wrote them. `AgentReport` has one `output` field, so this matches the port; what it
 *   costs is that a runner cannot tell the caller which half a line came from.
 * - **The terminal echoes what is written to it.** An instruction delivered through the terminal comes
 *   back in `output` before the CLI has said anything. That is what a terminal does, and hiding it would
 *   mean guessing which prefix of the output was ours.
 * - **The output carries terminal artifacts** — `\r\n` line endings from `ONLCR`, ANSI escapes, cursor
 *   moves. Nothing here trims, normalises or strips them. Turning what a Zord wrote into a Handoff is a
 *   judgement about text and it belongs to the Surface that builds the Handoff, exactly as the port says;
 *   and `resolveHarness` sets the precedent — `"claude "` is either a typo or a different CLI, and both
 *   deserve to be seen rather than absorbed.
 *
 * ## Cost is a declared zero, and that is not a measurement
 *
 * Every run answers `cost: ZERO_MONEY`, and it means **"no price source exists"** rather than "this run
 * was free". Three things would have to be true before a number here could be honest, and none of them
 * is:
 *
 * - the process is not trusted to report what it cost — it is the party being billed;
 * - `node-pty` reports an exit code and a signal, and nothing about tokens or money;
 * - there is no price list anywhere in this repository, so there is nothing to multiply a token count by.
 *
 * What is left is wall-clock time, and turning seconds into cents would be **inventing money**: a
 * plausible-looking number that a Meter would total and a Cap would halt a Mission against. `money.ts`
 * is built to refuse exactly that kind of value — no fractions, no negatives, no subtraction — and the
 * one amount that makes no claim is zero. So this is a **declared Gap**, additive the day a CLI reports
 * its usage and somebody writes a price list down: the conversion belongs here, at this boundary, which
 * is what the port's comment about `moneyFromCents` refusing a fraction loudly is for.
 *
 * There is deliberately no `priceOf` hook waiting for that day. A field no rule fills is the always-zero
 * lie this project keeps warning about, and an option only a test would ever pass is the same thing
 * wearing a function type.
 *
 * ## Failure is a rejected Promise
 *
 * A non-zero exit, a kill and a timeout all **reject**, with an `AgentRunFailedError` that names which
 * one happened and carries the output collected so far. The alternative — resolving with an
 * `AgentReport` that carries an outcome — was rejected for three reasons, in order of weight:
 *
 * 1. **`AgentReport` is a claim that a Zord delivered something.** A Surface awaits `run`, and then
 *    submits what came back as Commands: `accrue-cost` for the amount, `submit-handoff` for the claim.
 *    Hand it a crash log in `output` and it submits a Handoff built from a stack trace; `decide` then
 *    judges that against the Contract and answers a Refusal, which is recorded in the Replay forever as
 *    "the Zord delivered and broke its Contract". It did not deliver. That is the runner lying about
 *    failure, in the one record a human reads to find out what happened.
 * 2. **Widening the resolved value means widening the port**, which lives in `engine/` and is consumed
 *    by the fake and by the end-to-end drive. Every existing implementation would carry a field it
 *    cannot fill.
 * 3. **The fake already rejects.** `fakeAgentRunner` answers an unscripted call with a rejected
 *    `UnscriptedRunError`, for the stated reason that it is how every real runner fails. Two failure
 *    channels for one port would mean a Surface that handles the fake correctly and drops a real one.
 *
 * The error carries `output` and no `cost`: what was collected is real, and a zero cost on a failure
 * would be the always-zero field again — the run may well have burned money, and this module has no way
 * to know.
 *
 * ## Nothing is inherited silently
 *
 * `cwd`, `env` and the argument vector are all required inputs. `env` is a complete map, and this module
 * never reads `process.env` on its own behalf: a CLI that inherits the whole parent environment inherits
 * every credential the parent holds, and a Zord is a process running text somebody else wrote.
 * `inheritedEnv` is how a caller passes a variable through, by writing its name down.
 *
 * Two variables reach the child that a caller did not list, both set by `node-pty` and both named here
 * so the list is complete: `TERM` (from the `term` option) and `PWD` (set to `cwd`).
 */

import { spawn as spawnPty, type IPty } from "node-pty";

import { ZERO_MONEY } from "@engine/domain/money";
import type { AgentReport, AgentRun, AgentRunner } from "@engine/ports/agent-runner";

/** How the instruction reaches the CLI. */
export type InstructionDelivery =
  /**
   * Written into the terminal, then `EOT`, so a CLI reading its prompt from standard input sees a
   * complete line and then end-of-input. The terminal echoes it, so it appears in `output` too.
   */
  | "terminal"
  /** Not written at all: `argumentsFor` already placed it on the command line. */
  | "arguments";

/** What a runner is built with. Every field that touches the world is here, and none has a hidden default. */
export type PtyAgentRunnerOptions = {
  /** The directory the CLI runs in. Required: a Zord runs inside a Workspace, never wherever this process happens to be. */
  readonly cwd: string;
  /**
   * The child's entire environment, as a complete map.
   *
   * Required and never merged with `process.env`. Build it with `inheritedEnv` for the variables a CLI
   * genuinely needs — `PATH` to find its binary, `HOME` for its own configuration — and add the rest
   * explicitly. `node-pty` sets `TERM` and `PWD` on top of it, and nothing else does.
   */
  readonly env: Readonly<Record<string, string>>;
  /**
   * How long the run may take before it is abandoned and the process tree is destroyed.
   *
   * Required, because there is no timeout that is right for every CLI and a default would be a guess
   * that silently becomes a hang.
   */
  readonly timeoutMs: number;
  /**
   * The argument vector, built from the run.
   *
   * Required, and deliberately not defaulted to `[]`. The Harness carries `model`, `effort` and
   * `skills`, and there is no flag spelling that is true of `claude`, `codex` and `gemini` at once — so
   * a default would drop those three fields on the floor and run a Zord under a bundle the `Delegated`
   * fact says it ran with. That is the one thing the Replay must never be wrong about, so the mapping
   * is the caller's to state.
   */
  readonly argumentsFor: (asked: AgentRun) => readonly string[];
  /** Default `"terminal"`. */
  readonly instructionDelivery?: InstructionDelivery;
  /**
   * The point at which collected output stops being a delivery and starts being a runaway. Default 4 MiB.
   *
   * Exceeding it **fails** rather than truncating. A truncated `output` handed back as an `AgentReport`
   * is a delivery missing its end, and nothing downstream can tell; failing says so.
   */
  readonly maxOutputBytes?: number;
  /** How long a doomed process gets between `SIGTERM` and `SIGKILL`. Default 2000ms. */
  readonly graceMs?: number;
  /** `TERM` for the child. Default `"xterm-256color"`. */
  readonly term?: string;
  /** Terminal size. Defaults 120×40. A CLI wraps its output to these, so they are part of what it produces. */
  readonly cols?: number;
  readonly rows?: number;
};

/**
 * Which way a run failed.
 *
 * `timeout` and `killed` are separate members although both end with a dead process, because they are
 * different facts about different parties: `timeout` is *this runner* giving up and destroying the
 * process tree, `killed` is somebody else — an operator, an OOM killer, the CLI's own supervisor —
 * ending it while we were waiting. Collapsing them would tell a human to raise a timeout that was never
 * reached.
 */
export type AgentRunFailure =
  /** The CLI ran to completion and reported failure. */
  | { readonly reason: "exit"; readonly exitCode: number }
  /** The process died from a signal this runner did not send. */
  | { readonly reason: "killed"; readonly signal: number }
  /** `timeoutMs` elapsed. The process tree is being destroyed; see `terminate` below. */
  | { readonly reason: "timeout"; readonly timeoutMs: number }
  /** The CLI produced more than `maxOutputBytes`. Same destruction as a timeout. */
  | { readonly reason: "output-overflow"; readonly maxOutputBytes: number }
  /** There was never a process: the CLI could not be named, or the fork itself failed. */
  | { readonly reason: "not-spawned"; readonly detail: string };

/**
 * Raised — as a rejection, never synchronously — when a run did not produce a delivery.
 *
 * It carries the output collected up to the failure, because that is the only evidence of what the CLI
 * was doing, and it carries **no cost**: a failed run may well have spent money and this module has no
 * way to know how much, so a zero here would be a measurement nobody took.
 */
export class AgentRunFailedError extends Error {
  readonly failure: AgentRunFailure;
  readonly output: string;

  constructor(failure: AgentRunFailure, output: string, cli: string) {
    super(`${cli} did not deliver: ${describe(failure)}`);
    this.name = "AgentRunFailedError";
    this.failure = failure;
    this.output = output;
  }
}

function describe(failure: AgentRunFailure): string {
  switch (failure.reason) {
    case "exit":
      return `it exited with code ${failure.exitCode}`;
    case "killed":
      return `it was killed by signal ${failure.signal}`;
    case "timeout":
      return `it was still running after ${failure.timeoutMs}ms and was terminated`;
    case "output-overflow":
      return `it produced more than ${failure.maxOutputBytes} bytes of output and was terminated`;
    case "not-spawned":
      return `it was never started — ${failure.detail}`;
  }
}

/**
 * The variables of `from` named in `names`, and nothing else.
 *
 * The point is that the pass-through list is **written down at the call site**. A variable that is not
 * set is left out rather than passed as an empty string, because an empty `HOME` is not the same
 * question as an absent one and a CLI is allowed to treat them differently.
 */
export function inheritedEnv(
  names: readonly string[],
  from: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const passed: Record<string, string> = {};
  for (const name of names) {
    const value = from[name];
    if (value !== undefined) {
      passed[name] = value;
    }
  }
  return passed;
}

/**
 * Written after the instruction so a CLI reading standard input sees end-of-input.
 *
 * A terminal has no EOF the way a pipe does: EOT is what the line discipline turns into one, and it is
 * why a CLI that reads its prompt from standard input ever stops reading. Written as an escape rather
 * than as the literal control character, which no editor shows and every diff mangles.
 */
const END_OF_TRANSMISSION = "\u0004";

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_GRACE_MS = 2_000;
const DEFAULT_TERM = "xterm-256color";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

/**
 * Builds a runner that spawns the Harness's `cli` in a pseudoterminal.
 *
 * `run` never throws synchronously and never resolves for a run that failed — see the two sections at
 * the top of this file. It holds no state between runs: two concurrent calls are two independent
 * processes.
 */
export function ptyAgentRunner(options: PtyAgentRunnerOptions): AgentRunner {
  const delivery = options.instructionDelivery ?? "terminal";
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;

  return {
    run(asked: AgentRun): Promise<AgentReport> {
      return new Promise<AgentReport>((resolve, reject) => {
        // Read as `unknown` before it is used, in the grade this project calls *computing with* a
        // field: `spawn("")` silently falls back to `sh`, which would run the wrong program under the
        // Harness's name and put that in the Replay. A cast, a `JSON.parse` or a deserialised
        // Delegation all reach here, so the type is not the guarantee.
        const named: unknown = asked.harness?.cli;
        if (typeof named !== "string" || named.trim().length === 0) {
          reject(
            new AgentRunFailedError(
              { reason: "not-spawned", detail: `the Harness names no cli, received ${shown(named)}` },
              "",
              "a Zord",
            ),
          );
          return;
        }
        const cli = named;

        // Checked here rather than at the write below, so the answer is still `not-spawned` and still
        // true: nothing has been forked yet. Only the delivery that reads it cares — under
        // `"arguments"` the instruction is `argumentsFor`'s business and this module never touches it.
        // A **blank** instruction is allowed through: "nothing to say" is a thing a caller can mean,
        // and it is not this module's judgement to make. A non-string is not.
        const instruction: unknown = asked.instruction;
        if (delivery === "terminal" && typeof instruction !== "string") {
          reject(
            new AgentRunFailedError(
              {
                reason: "not-spawned",
                detail: `the run carries no instruction to write, received ${shown(instruction)}`,
              },
              "",
              cli,
            ),
          );
          return;
        }

        let argv: readonly string[];
        try {
          argv = options.argumentsFor(asked);
        } catch (cause) {
          reject(
            new AgentRunFailedError(
              { reason: "not-spawned", detail: `argumentsFor threw: ${messageOf(cause)}` },
              "",
              cli,
            ),
          );
          return;
        }

        let child: IPty;
        try {
          child = spawnPty(cli, [...argv], {
            cwd: options.cwd,
            env: { ...options.env },
            name: options.term ?? DEFAULT_TERM,
            cols: options.cols ?? DEFAULT_COLS,
            rows: options.rows ?? DEFAULT_ROWS,
            encoding: "utf8",
          });
        } catch (cause) {
          reject(
            new AgentRunFailedError(
              { reason: "not-spawned", detail: messageOf(cause) },
              "",
              cli,
            ),
          );
          return;
        }

        let output = "";
        let bytes = 0;
        let settled = false;
        // Declared before the listeners because both settle paths clear it, and `onData` can fire
        // before the executor has finished running. `clearTimeout(undefined)` is a no-op, so the
        // ordering costs nothing and removes a temporal-dead-zone throw from inside a listener.
        let deadline: ReturnType<typeof setTimeout> | undefined;

        const onData = child.onData((chunk: string) => {
          if (settled) {
            return;
          }
          output += chunk;
          bytes += Buffer.byteLength(chunk, "utf8");
          if (bytes > maxOutputBytes) {
            abandon({ reason: "output-overflow", maxOutputBytes });
          }
        });

        const onExit = child.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(deadline);
          onData.dispose();
          onExit.dispose();

          // Signal first: a process killed by a signal reports `exitCode: 0` here, so reading the code
          // first would report a clean run for a process that was destroyed.
          if (signal !== undefined && signal !== 0) {
            reject(new AgentRunFailedError({ reason: "killed", signal }, output, cli));
            return;
          }
          if (exitCode !== 0) {
            reject(new AgentRunFailedError({ reason: "exit", exitCode }, output, cli));
            return;
          }
          resolve({ output, cost: ZERO_MONEY });
        });

        /**
         * Give up on the run *now* and destroy the process tree in the background.
         *
         * Settling before the process is confirmed dead is the whole reason `run` cannot hang: the
         * caller's answer depends on a timer that has already fired, not on a child that may be
         * ignoring `SIGTERM` or wedged in an uninterruptible read. Destruction still happens — it just
         * is not something the caller waits for.
         */
        function abandon(failure: AgentRunFailure): void {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(deadline);
          onData.dispose();
          onExit.dispose();
          terminate(child, graceMs);
          reject(new AgentRunFailedError(failure, output, cli));
        }

        deadline = setTimeout(() => {
          abandon({ reason: "timeout", timeoutMs: options.timeoutMs });
        }, options.timeoutMs);

        if (delivery === "terminal") {
          try {
            // `\r` and not `\n`: `ICRNL` on the line discipline turns it into the newline that
            // completes the line, which is what a terminal delivers when a human presses return.
            child.write(`${String(instruction)}\r`);
            child.write(END_OF_TRANSMISSION);
          } catch {
            // The child died before it could be handed anything. Its `onExit` is already on its way
            // with the real reason, and inventing a second one here would race it.
          }
        }
      });
    },
  };
}

/**
 * Destroys a process tree: `SIGTERM`, then `SIGKILL` after `graceMs`.
 *
 * The signal goes to the **process group**, not to the pid. `node-pty` puts the child in a new session,
 * so its pid is also its process group id, and a negative pid reaches the CLI *and* every process it
 * spawned. Signalling only the leader is not enough, and it is not a theoretical gap: a child that traps
 * `SIGHUP` survives the hangup that killing the leader causes and is reparented to init, still running,
 * still spending. `pty-agent-runner.test.ts` proves both halves.
 *
 * The escalation timer is `unref`'d, so a pending `SIGKILL` never keeps a process alive at the end of a
 * test run or a CLI session, and it is cleared the moment the child is gone.
 */
function terminate(child: IPty, graceMs: number): void {
  signalTree(child, "SIGTERM");

  const escalation = setTimeout(() => {
    signalTree(child, "SIGKILL");
  }, graceMs);
  escalation.unref();

  const gone = child.onExit(() => {
    clearTimeout(escalation);
    gone.dispose();
  });
}

/**
 * Sends one signal to the child's process group, falling back to the child alone.
 *
 * The fallbacks are for the platforms where a negative pid means nothing (Windows) and for the ordinary
 * case of the process already being gone, where every attempt throws `ESRCH` and there is nothing left
 * to do about it.
 */
function signalTree(child: IPty, signal: NodeJS.Signals): void {
  const attempts: readonly (() => void)[] = [
    () => {
      process.kill(-child.pid, signal);
    },
    () => {
      child.kill(signal);
    },
    () => {
      child.kill();
    },
  ];

  for (const attempt of attempts) {
    try {
      attempt();
      return;
    } catch {
      // Try the next one. All three failing means the process is already gone.
    }
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure detail. Mirrors `harness.ts`, for one vocabulary. */
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
