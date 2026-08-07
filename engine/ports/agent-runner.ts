/**
 * The `AgentRunner` port: the boundary where a real CLI would live, and the reason the domain does not
 * know one exists.
 *
 * A Zord is born when invoked and dies after delivering, and invoking it means spawning a process —
 * `claude`, `codex`, `gemini` — with the Harness the Mission resolved for it. That is the one thing in
 * this product that touches the world: it reads a clock, it reaches the network, it costs money, and it
 * fails in ways no rule can enumerate. So it is a **port**, and this file is the whole of it.
 *
 * ## What the domain is protected from
 *
 * Nothing in `engine/domain` imports this file, and nothing here imports `decide` or `evolve`. The
 * dependency runs one way: a runner is handed a `Harness` the domain resolved and answers with an
 * amount the domain records as a `CostAccrued`. That is the entire contact surface, and it is what
 * keeps the PRD's first open risk cheap — modelling invariants before the runtime exists costs an
 * adapter to correct, not a domain.
 *
 * It also means the loop that reads a runner's answer and submits the next Command is **not** in the
 * engine. Turning what a Zord wrote into a Handoff is a judgement about text, and the domain judges a
 * Handoff against a Contract rather than deciding what one says; `mission.e2e.test.ts` stands in for
 * the Surface that will do it. The real adapter is out of scope by decision (PRD, out of scope 1); the
 * deterministic fake beside it in `engine/adapters/` is what makes criterion 13 provable with no CLI
 * installed.
 *
 * ## Why `run` is the only method
 *
 * A Zord has no lifecycle here to manage: it is invoked and it answers. Streaming, cancellation and
 * process supervision are all real and all belong to whoever implements this port for a real CLI — the
 * Cockpit needs them and the domain does not, so putting them here now would be a Contract written
 * against a Surface nobody has built.
 *
 * `AgentRunner` keeps the name the techspec pinned, and `agent` sits under `_Avoid_` for **Zord** in
 * `CONTEXT.md`. That is not a violation of the glossary rule: the `_Avoid_` list governs how the
 * **domain** is named, and this is a port at its edge, named after the boundary rather than after the
 * concept. A Zord is what the domain calls the thing on the other side of it. The same applies to the
 * `instruction` field below, which is `_Avoid_` for **Skill**: it is the text a runner is given, not an
 * installable instruction block.
 */

import type { Harness } from "../domain/harness";
import type { Money } from "../domain/money";

/**
 * What a runner is asked to do: run this Harness against this text.
 *
 * The Harness is the **resolved** bundle, exactly as the `Delegated` fact recorded it. A runner is
 * never handed the sources and never resolves anything — precedence is one rule with one home
 * (`resolveHarness`), and a runner that re-resolved could run a Zord under a bundle the Replay does not
 * show.
 */
export type AgentRun = {
  readonly harness: Harness;
  /** What the Zord is being asked to do. A Surface builds it from the Slice and the Contract. */
  readonly instruction: string;
};

/**
 * What came back: what the Zord wrote, and what the run cost.
 *
 * `cost` is `Money` — whole BRL cents — because it is destined for an `accrue-cost` Command and the
 * Meter compares it against a Cap. A runner that only knows a float converts at this boundary, which is
 * the point of having one: `moneyFromCents` refuses a fraction loudly here instead of a Cap being one
 * cent wrong forever.
 *
 * There is no token count, and that is a declared Gap of this PRD rather than an omission: the glossary
 * defines the Meter as the accounting of tokens *and* cost, and nothing in this PRD produces the first.
 * A `tokens` field no runner filled and no rule read would be the always-zero lie. Additive the day a
 * runner reports them.
 */
export type AgentReport = {
  readonly output: string;
  readonly cost: Money;
};

/**
 * The boundary a Zord runs behind.
 *
 * One method, asynchronous because every real implementation is. The domain never awaits it: a Surface
 * does, and then submits what came back as Commands — `accrue-cost` for the amount, `submit-handoff`
 * for the claim.
 */
export interface AgentRunner {
  run(asked: AgentRun): Promise<AgentReport>;
}
