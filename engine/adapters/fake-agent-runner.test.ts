import { describe, expect, it } from "vitest";

import { harness, type Harness } from "@engine/domain/harness";
import { moneyFromDecimal, type Money } from "@engine/domain/money";
import type { AgentReport, AgentRun, AgentRunner } from "@engine/ports/agent-runner";
import {
  UnscriptedRunError,
  fakeAgentRunner,
  type FakeAgentRunner,
} from "@engine/adapters/fake-agent-runner";

/**
 * The fake runner: the reason criterion 13 is provable with **no CLI installed and no network**.
 *
 * Everything here is about determinism. A fake that read a clock, kept a random seed or fell back to a
 * default answer would make the end-to-end proof pass for reasons that have nothing to do with the
 * domain — and the domain is poison-tested against `Date.now` and `Math.random`, so its runner is held
 * to the same standard.
 */

const SCOUT_HARNESS: Harness = harness({
  cli: "claude",
  model: "sonnet-4-5",
  effort: "medium",
  skills: [],
});

const BUILDER_HARNESS: Harness = harness({
  cli: "claude",
  model: "opus-4-1",
  effort: "high",
  skills: ["tdd"],
});

const FIRST_COST: Money = moneyFromDecimal("12.00");
const SECOND_COST: Money = moneyFromDecimal("8.50");

const SCRIPT: readonly AgentReport[] = [
  { output: "mapped the Surfaces", cost: FIRST_COST },
  { output: "built the Cockpit shell", cost: SECOND_COST },
];

function asked(instruction: string, bundle: Harness = SCOUT_HARNESS): AgentRun {
  return { harness: bundle, instruction };
}

describe("the fake runner answers its script, in order", () => {
  it("answers each run with the next scripted answer", async () => {
    const runner = fakeAgentRunner(SCRIPT);

    expect(await runner.run(asked("map the Surfaces"))).toEqual(SCRIPT[0]);
    expect(await runner.run(asked("build the shell", BUILDER_HARNESS))).toEqual(SCRIPT[1]);
  });

  it("answers the same script the same way, always", async () => {
    const one = fakeAgentRunner(SCRIPT);
    const other = fakeAgentRunner(SCRIPT);

    expect(await one.run(asked("map the Surfaces"))).toEqual(
      // The same ask, a different runner, the same answer: no seed, no counter shared with anything.
      await other.run(asked("map the Surfaces")),
    );
  });

  it("answers the same question twice with two different answers, which is the point", async () => {
    const runner = fakeAgentRunner(SCRIPT);

    // A Handoff is refused, the Zord is told what it broke, and it submits again. Keyed by instruction
    // instead of by order, a fake could not express the one loop criterion 3 promises.
    expect((await runner.run(asked("answer the Slice"))).output).toBe("mapped the Surfaces");
    expect((await runner.run(asked("answer the Slice"))).output).toBe("built the Cockpit shell");
  });

  it("keeps answering the same script after the runner it was built from was mutated", async () => {
    const script: AgentReport[] = [...SCRIPT];
    const runner = fakeAgentRunner(script);
    script.length = 0;

    // The script is copied at construction: a caller cannot rewrite what a fake will answer later.
    expect((await runner.run(asked("map the Surfaces"))).cost).toBe(FIRST_COST);
  });

  it("is an AgentRunner and nothing more", async () => {
    // Typed as the port, so the e2e test drives the domain through the boundary rather than around it.
    const runner: AgentRunner = fakeAgentRunner(SCRIPT);

    expect(typeof runner.run).toBe("function");
    await expect(runner.run(asked("map the Surfaces"))).resolves.toEqual(SCRIPT[0]);
  });
});

describe("the fake runner remembers what it was asked", () => {
  it("records every run, with the Harness it was handed", async () => {
    const runner = fakeAgentRunner(SCRIPT);
    await runner.run(asked("map the Surfaces"));
    await runner.run(asked("build the shell", BUILDER_HARNESS));

    expect(runner.calls).toEqual([
      { harness: SCOUT_HARNESS, instruction: "map the Surfaces" },
      { harness: BUILDER_HARNESS, instruction: "build the shell" },
    ]);
    // The same object the domain resolved, not a copy of it: this is how a test proves the runner ran the
    // bundle the `Delegated` fact recorded.
    expect(runner.calls[1]?.harness).toBe(BUILDER_HARNESS);
  });

  it("hands out a frozen list, fresh each time", async () => {
    const runner = fakeAgentRunner(SCRIPT);
    await runner.run(asked("map the Surfaces"));
    const history = runner.calls;

    expect(Object.isFrozen(history)).toBe(true);
    expect(() => (history as AgentRun[]).push(asked("something nobody asked"))).toThrow(TypeError);
    await runner.run(asked("build the shell"));
    // The reading taken before the second run is not the reading taken after it.
    expect(history).toHaveLength(1);
    expect(runner.calls).toHaveLength(2);
  });
});

describe("the fake runner fails rather than inventing an answer", () => {
  it("rejects a run its script does not have", async () => {
    const runner = fakeAgentRunner([SCRIPT[0] as AgentReport]);
    await runner.run(asked("map the Surfaces"));

    await expect(runner.run(asked("build the shell", BUILDER_HARNESS))).rejects.toThrow(
      UnscriptedRunError,
    );
  });

  it("says how many runs it was scripted for, and what it was asked for beyond that", async () => {
    const runner = fakeAgentRunner([SCRIPT[0] as AgentReport]);
    await runner.run(asked("map the Surfaces"));

    await expect(runner.run(asked("build the shell", BUILDER_HARNESS))).rejects.toThrow(
      `fake AgentRunner was scripted for 1 run and was asked for another one, ` +
        `with claude/opus-4-1: "build the shell"`,
    );
  });

  it("rejects the very first run when it was scripted for none", async () => {
    await expect(fakeAgentRunner([]).run(asked("map the Surfaces"))).rejects.toThrow(
      `fake AgentRunner was scripted for 0 runs and was asked for another one`,
    );
  });

  it("fails as a rejected Promise, the way a real runner fails", async () => {
    const runner = fakeAgentRunner([]);
    let pending: Promise<AgentReport> | undefined;

    // Not a synchronous throw: `run` returns a Promise by Contract, and a Surface that only handles
    // rejections must not be let off by a fake that throws where no real runner would.
    expect(() => {
      pending = runner.run(asked("map the Surfaces"));
    }).not.toThrow();
    await expect(pending).rejects.toThrow(UnscriptedRunError);
  });

  it("records the run it refused to answer", async () => {
    const runner = fakeAgentRunner([]);
    await expect(runner.run(asked("map the Surfaces"))).rejects.toThrow(UnscriptedRunError);

    // An unscripted call is still a call: whoever is debugging one wants to see it.
    expect(runner.calls).toEqual([{ harness: SCOUT_HARNESS, instruction: "map the Surfaces" }]);
  });
});

describe("the fake runner reads no clock and rolls no dice", () => {
  it("runs with Date and Math.random poisoned", async () => {
    const realNow = Date.now;
    const realParse = Date.parse;
    const realRandom = Math.random;
    Date.now = (): number => {
      throw new Error("a deterministic runner must not read a clock");
    };
    Date.parse = (): number => {
      throw new Error("a deterministic runner must not parse time");
    };
    Math.random = (): number => {
      throw new Error("a deterministic runner must not randomise");
    };

    try {
      const runner = fakeAgentRunner(SCRIPT);
      expect(await runner.run(asked("map the Surfaces"))).toEqual(SCRIPT[0]);
      expect(runner.calls).toHaveLength(1);
    } finally {
      Date.now = realNow;
      Date.parse = realParse;
      Math.random = realRandom;
    }
  });
});

/**
 * Every probe here was falsified by breaking the guarantee **at its source** — in
 * `engine/ports/agent-runner.ts`, not in this file — and confirming `tsc --noEmit` reports `TS2578:
 * Unused '@ts-expect-error' directive`.
 */
describe("what the type system refuses at the port", () => {
  it("refuses a cost that is a raw number of cents", () => {
    const rejected = (): FakeAgentRunner =>
      fakeAgentRunner([
        // @ts-expect-error a run costs Money — whole BRL cents through `moneyFromCents`, never a float
        { output: "mapped the Surfaces", cost: 12.5 },
      ]);

    expect(rejected().calls).toEqual([]);
  });

  it("refuses a run that names no Harness", async () => {
    const rejected = (): Promise<AgentReport> =>
      // @ts-expect-error a runner is handed the resolved bundle; it never resolves or defaults one
      fakeAgentRunner(SCRIPT).run({ instruction: "map the Surfaces" });

    // The type error is the whole proof, and the fake still answers: it does not read what it is handed,
    // because judging a Harness is `harness()`'s job and a fake with opinions is a second rule set.
    await expect(rejected()).resolves.toEqual(SCRIPT[0]);
  });

  it("refuses a run that carries Harness sources instead of a Harness", async () => {
    const rejected = (): Promise<AgentReport> =>
      fakeAgentRunner(SCRIPT).run({
        // @ts-expect-error precedence has one home, `resolveHarness`, and it is not behind this port
        harness: { catalogDefault: SCOUT_HARNESS },
        instruction: "map the Surfaces",
      });

    await expect(rejected()).resolves.toEqual(SCRIPT[0]);
  });

  it("refuses rewriting what a run answered", async () => {
    const answered: AgentReport = await fakeAgentRunner(SCRIPT).run(asked("map the Surfaces"));

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject it.
    // @ts-expect-error what a Zord wrote is what it wrote: the report is read, never edited
    const rejected = (): void => void (answered.output = answered.output);

    // No runtime claim: the script's entries are the caller's own objects and the fake does not freeze
    // them — freezing a caller's value would be the fake forming an opinion. The type is the guarantee.
    expect(rejected).not.toThrow();
  });
});
