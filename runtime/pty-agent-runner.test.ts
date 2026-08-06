/**
 * These tests spawn real processes. There is no mock of `node-pty` anywhere in this file, and that is
 * the point: everything worth knowing about this adapter — whether the kill kills, whether the output
 * is complete, whether the environment leaked — is a property of an operating system and not of a
 * stub. A mocked pty would prove that the adapter calls the functions the adapter calls.
 *
 * They are Linux-shaped, and say so where they are: process groups, `/proc` and `bash -lc` are not
 * portable, and neither is `node-pty`'s behaviour around them. The two tests that read `/proc` are
 * skipped elsewhere rather than quietly weakened.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn as spawnPty } from "node-pty";
import { describe, expect, it } from "vitest";

import { ZERO_MONEY, centsOf, harness, type AgentRun, type AgentRunner } from "@engine/index";

import {
  AgentRunFailedError,
  inheritedEnv,
  ptyAgentRunner,
  type AgentRunFailure,
  type PtyAgentRunnerOptions,
} from "./pty-agent-runner";

const BASH = "/bin/bash";
const ON_LINUX = process.platform === "linux";

/** Exactly the variables a `bash -lc` needs to be itself. Nothing else of this process reaches a child. */
const ENV = inheritedEnv(["PATH", "HOME"]);

/** A run whose `instruction` is the shell script to execute. */
function asking(script: string): AgentRun {
  return {
    harness: harness({ cli: BASH, model: "none", effort: "min", skills: [] }),
    instruction: script,
  };
}

/**
 * A runner over `bash -lc <instruction>`.
 *
 * `instructionDelivery: "arguments"` because the instruction *is* the command line here — writing it
 * into the terminal as well would have bash execute it and then echo it back.
 */
function bashRunner(overrides: Partial<PtyAgentRunnerOptions> = {}): AgentRunner {
  return ptyAgentRunner({
    cwd: tmpdir(),
    env: ENV,
    timeoutMs: 15_000,
    argumentsFor: (asked) => ["-lc", asked.instruction],
    instructionDelivery: "arguments",
    ...overrides,
  });
}

/** The failure of a run that was supposed to fail. Fails the test loudly when it did not. */
async function failureOf(pending: Promise<unknown>): Promise<AgentRunFailedError> {
  try {
    const delivered = await pending;
    throw new Error(`expected the run to fail, it resolved with ${JSON.stringify(delivered)}`);
  } catch (caught) {
    if (!(caught instanceof AgentRunFailedError)) {
      throw caught;
    }
    return caught;
  }
}

/**
 * Whether a pid names a live process.
 *
 * `/proc` rather than `process.kill(pid, 0)`, because a zombie still answers signal 0 and a test that
 * counted zombies as survivors would report the kill as broken on any host whose init is slow to reap.
 */
function running(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  // `pid (comm) state …`, and `comm` may contain spaces and parentheses, so the state is the field
  // after the last `)`.
  const state = stat.slice(stat.lastIndexOf(")") + 1).trim().charAt(0);
  return state !== "Z";
}

async function eventually(condition: () => boolean, withinMs = 10_000): Promise<boolean> {
  const until = Date.now() + withinMs;
  while (Date.now() < until) {
    if (condition()) {
      return true;
    }
    await new Promise((wake) => setTimeout(wake, 50));
  }
  return condition();
}

/**
 * A script that leaves a grandchild ignoring `SIGHUP`, and writes that grandchild's pid where the test
 * can read it.
 *
 * `$BASHPID` and not `$$`: inside `( … )` the latter is still the parent shell's pid. `exec` keeps the
 * pid the subshell just reported, and POSIX carries an *ignored* signal across an `exec`, so the
 * `sleep` that ends up under that pid ignores `SIGHUP` too. That is what makes it survive the hangup
 * that killing the session leader causes — an ordinary child would die of that and prove nothing.
 */
function holdoutScript(pidfile: string): string {
  return `trap '' HUP\n( trap '' HUP; echo $BASHPID > "${pidfile}"; exec sleep 300 ) &\nsleep 300\n`;
}

function pidIn(pidfile: string): number | undefined {
  try {
    const written = readFileSync(pidfile, "utf8").trim();
    return written.length === 0 ? undefined : Number(written);
  } catch {
    return undefined;
  }
}

describe("a command that prints and exits 0", () => {
  it("resolves with what the terminal produced", async () => {
    const report = await bashRunner().run(asking(`echo "hello from a real process"; exit 0`));

    expect(report.output).toContain("hello from a real process");
    // A pty, not a pipe: the line discipline turns every `\n` into `\r\n` and nothing here undoes it.
    expect(report.output).toContain("hello from a real process\r\n");
  });

  it("costs zero, and that is the absence of a price source", async () => {
    const report = await bashRunner().run(asking(`echo priced-by-nobody`));

    expect(report.cost).toBe(ZERO_MONEY);
    expect(centsOf(report.cost)).toBe(0);
  });

  it("runs in the cwd it was given, not in this process's", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "megazord-cwd-"));
    try {
      const report = await bashRunner({ cwd: elsewhere }).run(asking(`pwd`));
      expect(report.output).toContain(elsewhere);
      expect(report.output).not.toContain(process.cwd());
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("merges what the process wrote to stderr into the one stream a terminal has", async () => {
    const report = await bashRunner().run(
      asking(`echo to-stdout; echo to-stderr >&2; echo after-both`),
    );

    expect(report.output).toContain("to-stdout");
    expect(report.output).toContain("to-stderr");
    expect(report.output).toContain("after-both");
  });

  it("builds its argument vector from argumentsFor and from nothing else", async () => {
    const report = await ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 15_000,
      argumentsFor: () => ["-lc", 'echo "first=[$1] second=[$2]"', "bash", "alpha", "beta"],
      instructionDelivery: "arguments",
    }).run(asking("this instruction is never used"));

    expect(report.output).toContain("first=[alpha] second=[beta]");
  });

  it("runs two Zords at once without crossing their output", async () => {
    const runner = bashRunner();
    const [one, other] = await Promise.all([
      runner.run(asking(`echo mission-one`)),
      runner.run(asking(`echo mission-two`)),
    ]);

    expect(one?.output).toContain("mission-one");
    expect(one?.output).not.toContain("mission-two");
    expect(other?.output).toContain("mission-two");
    expect(other?.output).not.toContain("mission-one");
  });
});

describe("a command that exits non-zero", () => {
  it("rejects, and names the exit code", async () => {
    const failed = await failureOf(bashRunner().run(asking(`echo about-to-fail >&2; exit 7`)));

    expect(failed.failure).toEqual({ reason: "exit", exitCode: 7 });
    expect(failed.message).toContain("exited with code 7");
  });

  it("carries what the process managed to write before it failed", async () => {
    const failed = await failureOf(bashRunner().run(asking(`echo half-a-delivery; exit 2`)));

    expect(failed.output).toContain("half-a-delivery");
  });

  it("carries no cost, because a failed run may still have spent money", async () => {
    const failed = await failureOf(bashRunner().run(asking(`exit 1`)));

    expect(Object.keys(failed.failure)).toEqual(["reason", "exitCode"]);
    expect("cost" in failed).toBe(false);
  });

  it("reports a CLI that does not exist the way node-pty reports it: a spawn-helper exit", async () => {
    // A declared Gap, pinned rather than guessed at. `node-pty` forks a helper that `execvp`s the
    // file, so a missing binary arrives as exit code 1 with a message on the terminal — this adapter
    // cannot tell it apart from the CLI itself exiting 1, and matching the helper's wording would be
    // a heuristic against a dependency's internals.
    const failed = await failureOf(
      bashRunner().run({
        harness: harness({ cli: "/definitely/not/here", model: "none", effort: "min", skills: [] }),
        instruction: "anything",
      }),
    );

    expect(failed.failure).toEqual({ reason: "exit", exitCode: 1 });
    expect(failed.output).toContain("No such file or directory");
  });
});

describe("a command that outruns its timeout", () => {
  it("rejects with a timeout rather than waiting for the process", async () => {
    const started = Date.now();
    const failed = await failureOf(
      bashRunner({ timeoutMs: 700 }).run(asking(`echo starting; sleep 300`)),
    );

    expect(failed.failure).toEqual({ reason: "timeout", timeoutMs: 700 });
    // Settled on the timer, not on the child: nowhere near the 300 seconds the script asked for.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(failed.output).toContain("starting");
  });

  it("tells a timeout apart from a kill somebody else performed", async () => {
    // The script kills itself: nothing here fired a timer, so it must not be reported as a timeout.
    const failed = await failureOf(bashRunner().run(asking(`kill -TERM $$; sleep 300`)));

    expect(failed.failure).toEqual({ reason: "killed", signal: 15 });
    expect(failed.message).toContain("killed by signal 15");
  });
});

describe.skipIf(!ON_LINUX)("the kill actually kills", () => {
  it("destroys the whole process tree, including a grandchild that ignores SIGHUP", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "megazord-kill-"));
    const pidfile = join(workspace, "holdout.pid");
    try {
      const failed = await failureOf(
        bashRunner({ timeoutMs: 1_000, graceMs: 300 }).run(asking(holdoutScript(pidfile))),
      );
      expect(failed.failure.reason).toBe("timeout");

      const holdout = pidIn(pidfile);
      expect(holdout, "the script never recorded its grandchild's pid").toBeTypeOf("number");

      expect(
        await eventually(() => !running(holdout ?? 0)),
        `pid ${holdout} was still running after the run was abandoned`,
      ).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("escalates to SIGKILL for a tree that ignores SIGTERM as well", async () => {
    // The grace period is the load-bearing half of `terminate`, and a grandchild that dies of the
    // first `SIGTERM` never exercises it. This one ignores both signals a process is allowed to
    // ignore, so only the escalation can end it.
    const workspace = mkdtempSync(join(tmpdir(), "megazord-grace-"));
    const pidfile = join(workspace, "holdout.pid");
    const stubborn =
      `trap '' HUP TERM\n( trap '' HUP TERM; echo $BASHPID > "${pidfile}"; exec sleep 300 ) &\nsleep 300\n`;
    try {
      const failed = await failureOf(
        bashRunner({ timeoutMs: 1_000, graceMs: 2_000 }).run(asking(stubborn)),
      );
      expect(failed.failure.reason).toBe("timeout");

      const holdout = pidIn(pidfile) ?? 0;
      expect(holdout).toBeGreaterThan(0);

      // Still there well after the SIGTERM, because it ignored it.
      await new Promise((wake) => setTimeout(wake, 400));
      expect(running(holdout), "SIGTERM was enough, so this proves nothing about the escalation").toBe(
        true,
      );

      expect(
        await eventually(() => !running(holdout)),
        `pid ${holdout} outlived the SIGKILL escalation`,
      ).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("would not have, had it signalled only the leader — the falsification", async () => {
    // The control for the test above. Same script, killed the way `IPty.kill` kills: `process.kill`
    // on the leader's own pid. The grandchild ignores the hangup that follows, is reparented to init
    // and keeps running — which is exactly the process this adapter must not leave behind, and the
    // reason `signalTree` sends to `-pid`.
    const workspace = mkdtempSync(join(tmpdir(), "megazord-leak-"));
    const pidfile = join(workspace, "holdout.pid");
    let leader: number | undefined;
    try {
      const child = spawnPty(BASH, ["-lc", holdoutScript(pidfile)], {
        cwd: workspace,
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

      expect(await eventually(() => pidIn(pidfile) !== undefined, 5_000)).toBe(true);
      const holdout = pidIn(pidfile) ?? 0;

      child.kill("SIGKILL");
      expect(await eventually(() => !running(leader ?? 0))).toBe(true);

      // Half a second after the leader is gone, the grandchild is still there.
      await new Promise((wake) => setTimeout(wake, 500));
      expect(running(holdout), "the leader-only kill was enough after all").toBe(true);

      // Now clean it up the way the adapter would have.
      process.kill(-(leader ?? 0), "SIGKILL");
      expect(await eventually(() => !running(holdout))).toBe(true);
    } finally {
      if (leader !== undefined) {
        try {
          process.kill(-leader, "SIGKILL");
        } catch {
          /* already gone, which is the point of the test */
        }
      }
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("a command that produces a lot of output", () => {
  const LINES = 20_000;
  const LOUD = `seq 1 ${LINES} | awk '{ print "line " $1 ": " "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }'`;

  it("collects all of it, losing nothing to the pty buffer", async () => {
    const report = await bashRunner({ timeoutMs: 60_000 }).run(asking(LOUD));

    expect(report.output).toContain("line 1: ");
    expect(report.output).toContain(`line ${LINES}: `);
    // Every line arrived, exactly once — the count is the proof that nothing was dropped when the
    // terminal's buffer filled, and nothing was duplicated when a chunk straddled a read.
    expect(report.output.match(/^line \d+: a{40}\r$/gm)?.length).toBe(LINES);
    expect(Buffer.byteLength(report.output, "utf8")).toBeGreaterThan(1_000_000);
  });

  it("fails rather than truncating when it runs past maxOutputBytes", async () => {
    const failed = await failureOf(
      bashRunner({ timeoutMs: 60_000, maxOutputBytes: 50_000, graceMs: 300 }).run(asking(LOUD)),
    );

    expect(failed.failure).toEqual({ reason: "output-overflow", maxOutputBytes: 50_000 });
    // What it did collect is still handed over — bounded by the cap plus the chunk that crossed it.
    expect(failed.output).toContain("line 1: ");
    expect(Buffer.byteLength(failed.output, "utf8")).toBeGreaterThan(50_000);
  });
});

describe("feeding the instruction through the terminal", () => {
  it("writes it, and the terminal echoes it, so it appears twice", async () => {
    const report = await ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 15_000,
      argumentsFor: () => [],
      instructionDelivery: "terminal",
    }).run({
      harness: harness({ cli: "/bin/cat", model: "none", effort: "min", skills: [] }),
      instruction: "read this and deliver",
    });

    // Once because the terminal echoed what was written to it, once because `cat` read it back. Both
    // are real, and the adapter does not try to guess which prefix of the output was its own.
    expect(report.output.match(/read this and deliver/g)?.length).toBe(2);
  });

  it("ends the input, so a CLI reading stdin stops reading", async () => {
    // `cat` with no EOT would never exit and the run would time out instead of resolving.
    const report = await ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 5_000,
      argumentsFor: () => [],
      instructionDelivery: "terminal",
    }).run({
      harness: harness({ cli: "/bin/cat", model: "none", effort: "min", skills: [] }),
      instruction: "the end of input is a control character",
    });

    expect(report.output).toContain("the end of input is a control character");
  });

  it('writes nothing when the delivery is "arguments"', async () => {
    // The script asks the terminal for a line and gives up after a second. Written as a pair with the
    // test below, which is the same script under `"terminal"` — one of them must see the instruction
    // and the other must not, or neither says anything about delivery.
    const listening = `read -t 1 -r line; echo "heard=[\${line:-nothing}]"`;

    const report = await bashRunner().run(asking(listening));
    expect(report.output).toContain("heard=[nothing]");
  });

  it("writes it when the delivery is the terminal — the other half of the pair", async () => {
    const listening = `read -t 5 -r line; echo "heard=[\${line:-nothing}]"`;

    const report = await ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 15_000,
      argumentsFor: () => ["-lc", listening],
      instructionDelivery: "terminal",
    }).run(asking("spoken into the terminal"));

    expect(report.output).toContain("heard=[spoken into the terminal]");
  });
});

describe("the environment is a list somebody wrote down", () => {
  it("passes through only what inheritedEnv was asked for", () => {
    const passed = inheritedEnv(["KEPT", "ABSENT"], { KEPT: "yes", DROPPED: "no" });

    expect(passed).toEqual({ KEPT: "yes" });
  });

  it("leaves an unset name out rather than passing it as an empty string", () => {
    expect(inheritedEnv(["NOWHERE"], {})).toEqual({});
    expect("NOWHERE" in inheritedEnv(["NOWHERE"], {})).toBe(false);
  });

  it("does not leak a variable of this process that nobody listed", async () => {
    const secret = "megazord-should-never-reach-a-zord";
    process.env["MEGAZORD_TEST_SECRET"] = secret;
    try {
      const report = await bashRunner().run(
        asking(`echo "secret=[\${MEGAZORD_TEST_SECRET:-unset}]"`),
      );
      expect(report.output).toContain("secret=[unset]");
      expect(report.output).not.toContain(secret);
    } finally {
      delete process.env["MEGAZORD_TEST_SECRET"];
    }
  });

  it("passes what it was given, and TERM and PWD on top — and names both", async () => {
    const report = await bashRunner({
      env: { ...ENV, MEGAZORD_DECLARED: "declared" },
      term: "dumb",
    }).run(asking(`echo "declared=[$MEGAZORD_DECLARED] term=[$TERM] pwd=[$PWD]"`));

    expect(report.output).toContain("declared=[declared]");
    expect(report.output).toContain("term=[dumb]");
    expect(report.output).toContain(`pwd=[${tmpdir()}]`);
  });
});

describe("run never throws, it only rejects", () => {
  it("rejects a Harness that names no cli, instead of falling back to a shell", async () => {
    // `node-pty` substitutes `sh` for an empty file, which would run a program the Harness does not
    // name and put that in the Replay. Forced past the compiler, because that is how it arrives: a
    // deserialised Delegation, a cast at a Surface boundary.
    const asked = {
      harness: { cli: "", model: "none", effort: "min", skills: [] },
      instruction: "anything",
    } as unknown as AgentRun;

    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = bashRunner().run(asked);
    }).not.toThrow();

    const failed = await failureOf(pending ?? Promise.resolve());
    expect(failed.failure).toEqual({
      reason: "not-spawned",
      detail: 'the Harness names no cli, received ""',
    });
  });

  it("rejects a Harness whose cli is not a string at all", async () => {
    const asked = { harness: { cli: 42 }, instruction: "anything" } as unknown as AgentRun;

    const failed = await failureOf(bashRunner().run(asked));
    expect(failed.failure).toEqual({
      reason: "not-spawned",
      detail: "the Harness names no cli, received 42",
    });
  });

  it("rejects a run with no instruction to write, before anything is forked", async () => {
    const asked = {
      harness: harness({ cli: "/bin/cat", model: "none", effort: "min", skills: [] }),
    } as unknown as AgentRun;

    const failed = await failureOf(
      ptyAgentRunner({
        cwd: tmpdir(),
        env: ENV,
        timeoutMs: 5_000,
        argumentsFor: () => [],
        instructionDelivery: "terminal",
      }).run(asked),
    );

    expect(failed.failure).toEqual({
      reason: "not-spawned",
      detail: "the run carries no instruction to write, received undefined",
    });
  });

  it('accepts a blank instruction, because "nothing to say" is not this module\'s judgement', async () => {
    const report = await ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 5_000,
      argumentsFor: () => ["-lc", `read -t 2 -r line; echo "heard=[\${line:-nothing}]"`],
      instructionDelivery: "terminal",
    }).run(asking(""));

    expect(report.output).toContain("heard=[nothing]");
  });

  it('does not read the instruction at all under "arguments"', async () => {
    const asked = {
      harness: harness({ cli: BASH, model: "none", effort: "min", skills: [] }),
    } as unknown as AgentRun;

    const report = await bashRunner({ argumentsFor: () => ["-lc", "echo no-instruction-needed"] }).run(
      asked,
    );

    expect(report.output).toContain("no-instruction-needed");
  });

  it("rejects when argumentsFor throws, rather than throwing out of run", async () => {
    const runner = bashRunner({
      argumentsFor: () => {
        throw new Error("no argv for this Harness");
      },
    });

    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = runner.run(asking(`echo never`));
    }).not.toThrow();

    const failed = await failureOf(pending ?? Promise.resolve());
    expect(failed.failure).toEqual({
      reason: "not-spawned",
      detail: "argumentsFor threw: no argv for this Harness",
    });
  });
});

describe("the boundary", () => {
  it("is one-way: nothing in engine/ imports runtime/", () => {
    const engine = fileURLToPath(new URL("../engine/", import.meta.url));
    const sources = readdirSync(engine, { recursive: true, encoding: "utf8" }).filter((entry) =>
      entry.endsWith(".ts"),
    );

    expect(sources.length).toBeGreaterThan(10);
    for (const source of sources) {
      const imported = [...readFileSync(`${engine}${source}`, "utf8").matchAll(/from "([^"]+)"/g)];
      expect(
        imported.map(([, specifier]) => specifier).filter((specifier) => specifier?.includes("runtime")),
        source,
      ).toEqual([]);
    }
  });

  it("keeps node-pty on this side of it", () => {
    // The other half of the same claim, from the dependency's direction: the engine's own end-to-end
    // test asserts every import under `engine/` is relative, so this is where the one non-relative
    // import lives.
    const here = readFileSync(fileURLToPath(new URL("./pty-agent-runner.ts", import.meta.url)), "utf8");
    const imported = [...here.matchAll(/from "([^"]+)"/g)].map(([, specifier]) => specifier);

    expect(imported).toContain("node-pty");
    expect(imported.filter((specifier) => specifier?.startsWith("@engine/")).sort()).toEqual([
      "@engine/domain/money",
      "@engine/ports/agent-runner",
    ]);
  });

  it("declares node-pty as a dependency, not as a devDependency", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    const dependencies =
      typeof manifest === "object" && manifest !== null && "dependencies" in manifest
        ? manifest.dependencies
        : undefined;

    expect(
      typeof dependencies === "object" && dependencies !== null && "node-pty" in dependencies,
    ).toBe(true);
  });
});

describe("the type level", () => {
  it("answers the port exactly, with nothing widened", () => {
    // Not expressible as a `@ts-expect-error`: what is being claimed is assignability, so the proof is
    // the annotation. Widen `run`'s answer or its parameter and this line stops compiling, which
    // fails `npm run build`.
    const asPort: AgentRunner = bashRunner();
    expect(typeof asPort.run).toBe("function");
  });

  it("requires every input that touches the world", () => {
    const shared = { cwd: tmpdir(), env: ENV, argumentsFor: (): readonly string[] => [] };

    // @ts-expect-error — timeoutMs has no default: a runner with no deadline is a runner that hangs.
    const noDeadline = (): AgentRunner => ptyAgentRunner({ ...shared });
    // @ts-expect-error — argumentsFor has no default: `[]` would silently drop model, effort and skills.
    const noArgv = (): AgentRunner => ptyAgentRunner({ cwd: tmpdir(), env: ENV, timeoutMs: 1 });
    // @ts-expect-error — cwd is required: a Zord runs inside a Workspace, not wherever this process is.
    const noCwd = (): AgentRunner => ptyAgentRunner({ env: ENV, timeoutMs: 1, argumentsFor: () => [] });
    // @ts-expect-error — env is required: nothing is inherited silently.
    const noEnv = (): AgentRunner => ptyAgentRunner({ cwd: tmpdir(), timeoutMs: 1, argumentsFor: () => [] });

    expect([noDeadline, noArgv, noCwd, noEnv].every((build) => typeof build === "function")).toBe(true);
  });

  it("keeps the failure members apart", () => {
    // Read off the un-narrowed union and the field of another member is not there at all.
    const failures: readonly AgentRunFailure[] = [
      { reason: "exit", exitCode: 1 },
      // @ts-expect-error — the exit member carries no signal: a signalled process is `killed`.
      { reason: "exit", exitCode: 1, signal: 9 },
      // @ts-expect-error — the timeout member carries no exitCode: nothing reported one.
      { reason: "timeout", timeoutMs: 1, exitCode: 0 },
    ];

    expect(failures.map((failure) => failure.reason)).toEqual(["exit", "exit", "timeout"]);
  });

  it("does not let a runner be built with an unknown option", () => {
    const built = ptyAgentRunner({
      cwd: tmpdir(),
      env: ENV,
      timeoutMs: 1_000,
      argumentsFor: () => [],
      // @ts-expect-error — there is no priceOf hook, deliberately: an option only a test would pass
      // is the always-zero field wearing a function type.
      priceOf: () => ZERO_MONEY,
    });

    expect(typeof built.run).toBe("function");
  });
});

describe("nothing is left behind", () => {
  it.skipIf(!ON_LINUX)("leaves no stray sleep from any test in this file", () => {
    const listed = execFileSync("ps", ["-e", "-o", "args="], { encoding: "utf8" });
    expect(listed).not.toContain("sleep 300");
  });
});
