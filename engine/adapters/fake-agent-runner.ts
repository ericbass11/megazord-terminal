/**
 * A deterministic `AgentRunner`: scripted answers, and nothing else.
 *
 * It is what makes criterion 13 provable — a whole Mission from Briefing to Delivery — **with no CLI
 * installed and no network**. It reads no clock, rolls no dice, spawns nothing, opens no file and
 * reaches nothing: it answers the next line of the script it was built with, in order, and records what
 * it was asked. The domain is poison-tested against `Date.now` and `Math.random` (`mission.test.ts`),
 * and this module is held to the same standard, so a test can poison both and still drive a Mission end
 * to end.
 *
 * ## Scripted in order, not keyed by what it was asked
 *
 * The script is a list, consumed one entry per call. Keyed by instruction instead, the fake could not
 * answer the same question twice in two different ways — and that is exactly the loop criterion 3
 * promises: a Handoff is refused, the Zord is told what it broke, and it submits again. Real runs
 * differ on a retry; a fake that could not would make the one path most worth testing untestable.
 *
 * Being asked more times than it was scripted for **fails**, rather than repeating the last answer or
 * inventing an empty one. A test that runs one more Zord than it meant to should hear about it at the
 * call, not discover a Handoff full of nothing three assertions later. It fails as a rejected Promise,
 * because that is how every real runner fails and a fake that threw synchronously would let a Surface
 * get away with not handling it.
 *
 * ## What it does not pretend to be
 *
 * It does not read the instruction, does not check the Harness, and does not decide what a run should
 * cost. Judging a Harness is `harness()`; judging what a Zord delivered is `validateHandoff`; pricing a
 * run is the runtime's job and there is no price list in this PRD. A fake that formed opinions would be
 * a second implementation of rules that already have one home, and the tests would start passing
 * because of the fake.
 */

import type { AgentReport, AgentRun, AgentRunner } from "../ports/agent-runner";

/** Raised when a fake runner is asked to run more times than it was scripted for. */
export class UnscriptedRunError extends Error {
  constructor(scripted: number, asked: AgentRun) {
    super(
      `fake AgentRunner was scripted for ${scripted} run${scripted === 1 ? "" : "s"} and was asked ` +
        `for another one, with ${asked.harness.cli}/${asked.harness.model}: ` +
        `${JSON.stringify(asked.instruction)}`,
    );
    this.name = "UnscriptedRunError";
  }
}

/**
 * An `AgentRunner` that answers from a script, and remembers what it was asked.
 *
 * `calls` is the assertion surface: "which Zord was run with which Harness" is the promise the Replay
 * makes about the domain, and this is how a test proves the *runner* was handed the same bundle the
 * `Delegated` fact recorded. It is a fresh frozen list on every read, so an assertion cannot quietly
 * add to the history it is checking.
 */
export type FakeAgentRunner = AgentRunner & {
  readonly calls: readonly AgentRun[];
};

/**
 * Builds a fake runner from the answers it should give, in order.
 *
 * The script is a list of `AgentReport` — the port's own answer type, not a shape of its own: a fake
 * whose script drifted from the port's Contract would be a fake that proves nothing about the port.
 *
 * @throws {UnscriptedRunError} from the returned Promise, when asked for a run the script does not have.
 */
export function fakeAgentRunner(script: readonly AgentReport[]): FakeAgentRunner {
  const scripted = [...script];
  const asked: AgentRun[] = [];

  return {
    get calls(): readonly AgentRun[] {
      return Object.freeze([...asked]);
    },

    async run(run: AgentRun): Promise<AgentReport> {
      // Recorded before the script is consulted: an unscripted call is still a call, and a test that is
      // debugging one wants to see it in `calls`.
      asked.push(run);

      const answer = scripted[asked.length - 1];
      if (answer === undefined) {
        throw new UnscriptedRunError(scripted.length, run);
      }
      return answer;
    },
  };
}
