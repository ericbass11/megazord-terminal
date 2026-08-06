/**
 * The Meter and the Cap: what a Mission has spent, per Pane and in total, and the one comparison
 * that decides when it must stop.
 *
 * The Meter is the **live accounting** of a Mission's cost. It is not state of its own: every amount
 * it reports is folded onto the Mission by `evolve` from a `CostAccrued` fact, and `meterOf` is a
 * reading of that state. Nothing here reads a clock, allocates an id or mutates its argument.
 *
 * ## Per Pane, recorded per Delegation
 *
 * A Pane is an isolated terminal with one Zord inside, and this domain has no Pane type — there is no
 * Cockpit here, no terminal, and no rule a Pane aggregate could enforce. What the domain *does* have
 * is the Delegation: the assignment of a Slice to a Zord, which is exactly the thing a Pane shows
 * running. So per-Pane accrual is recorded **per Delegation**, on the Delegation itself.
 *
 * That is the finer grain of the two available, and the finer grain keeps the coarser: a per-Zord
 * reading is the sum of the Delegations that name the Zord, while the reverse cannot be recovered —
 * a Mission legitimately gives one Zord two Slices (see `Delegation` in `mission.ts`), and summing
 * them first would throw away which Slice cost what. Whether the runtime reuses one process for both
 * or births a second Zord is behind `AgentRunner` and is not a Mission rule, so the domain records the
 * thing it can name.
 *
 * ## The Cap is reached at equality
 *
 * `hasReachedCap` is `spent >= cap`, and that is a decision. The glossary says a Cap is "the spending
 * limit of a Mission. Once **reached**, the Mission stops" — reached, not exceeded. A limit of
 * R$ 50,00 with R$ 50,00 spent has been reached: there is nothing left to spend, and the next cent is
 * already over. Read as `>`, a Cap would have to be *breached* before the product kept its promise,
 * so every Mission would overspend its limit by at least one cent and the number a human typed would
 * not be the limit — it would be one cent below the limit. The one place this comparison lives is
 * here, so no rule can disagree with another about the boundary.
 *
 * ## Money, and the arithmetic that must not throw
 *
 * Amounts are `Money`: whole BRL cents, never negative, with no subtraction anywhere in the model —
 * `money.ts` exposes none, and this module needs none. "How much is left under the Cap" is not asked:
 * the rules ask "has it been reached", which is a comparison. The Meter never subtracts, so it never
 * needs an amount below zero.
 *
 * `addMoney` throws past the exactly-representable range, and both `decide` and `evolve` are
 * contractually non-throwing. So the two collaborators that could throw are wrapped here, once:
 * `amountOf` for an amount that arrived through a cast or a deserialiser, and `accrued` for a total
 * that would stop being exact. Both answer with `undefined` instead of an exception, and the two
 * callers do the truthful thing with it: `decide` refuses, `evolve` ignores.
 *
 * ## What this module deliberately does not account for
 *
 * The glossary defines the Meter as the accounting of **tokens and cost**, per Pane, per Mission and
 * per **Combination**. Two of those are absent, and absent rather than half-built:
 *
 * - **tokens.** Nothing in this PRD produces a token count: the `AgentRunner` port reports a `cost`
 *   and nothing else, and there is no price list in the domain. A `tokens` field no rule could fill is
 *   the always-zero lie `CLAUDE.md` warns about, so there is none.
 * - **per Combination.** There is no Combination aggregate in `engine/`, so a Mission has no way to
 *   know which Combination it belongs to. Summing across Missions needs a holder of Missions, which
 *   this PRD does not model.
 *
 * Both are declared Gaps of Task 7, not oversights.
 */

import { addMoney, compareMoney, moneyFromCents, type Money } from "./money";
import type { DelegationId } from "./ids";
// Type-only import, the same arrangement `events.ts` uses: it is erased at compile time, so
// `mission.ts` importing this module for `hasReachedCap` and `accrued` is not a cycle at runtime.
// The Meter reads a Mission; the Mission owns the state.
import type { OpenedMission } from "./mission";

/**
 * What one Pane cost: the Delegation it is running, and what has been accrued against it.
 *
 * Named after the Delegation and not after the Pane, because the Delegation is what the domain can
 * identify. A Surface renders one of these as a Pane.
 */
export type MeteredDelegation = {
  readonly delegationId: DelegationId;
  readonly spent: Money;
};

/**
 * The live accounting of a Mission: its Cap, what it has spent in total, and what each Pane cost.
 *
 * A reading, derived at read time and frozen — including `reached`, which is `hasReachedCap` applied
 * to the two amounts beside it rather than a field anybody stores. Storing it would be a second copy
 * of a decision that already has one home.
 */
export type Meter = {
  readonly cap: Money;
  readonly spent: Money;
  /** One entry per Delegation the Mission made, in the order it made them. Zero is an entry. */
  readonly perDelegation: readonly MeteredDelegation[];
  /** Whether the Cap has been reached, and therefore whether the Mission is stopped by it. */
  readonly reached: boolean;
};

/**
 * Whether a Mission that has spent `spent` against a Cap of `cap` has reached it.
 *
 * Equality counts as reached — see the note at the top of this file. This is the only place the
 * boundary is decided, and `compareMoney` is what decides it, so the comparison stays in the
 * vocabulary of the amount rather than in raw numbers.
 */
export function hasReachedCap(spent: Money, cap: Money): boolean {
  return compareMoney(spent, cap) >= 0;
}

/**
 * The Meter of a Mission that has been opened.
 *
 * Takes an `OpenedMission` rather than a `Mission`: a Mission that has not been opened has no Cap and
 * no Delegations, so it has no accounting to report, and inventing a zero Cap for it would put a
 * number in front of a human that nobody set. Callers narrow with `isOpened` first — the same shape
 * the rest of the engine uses.
 */
export function meterOf(state: OpenedMission): Meter {
  return Object.freeze({
    cap: state.cap,
    spent: state.spent,
    perDelegation: Object.freeze(
      state.delegations.map((delegation) =>
        Object.freeze({ delegationId: delegation.id, spent: delegation.spent }),
      ),
    ),
    reached: hasReachedCap(state.spent, state.cap),
  });
}

/**
 * Reads an amount without trusting its type, answering `undefined` when it is not one.
 *
 * The same threat model as `assertNoExecution` and `harness()`: a `Money` can arrive through a cast,
 * a `JSON.parse` or a boundary this module cannot see, and `decide` computes *with* this value rather
 * than copying it — `undefined` cents would reach `addMoney` and throw where `decide` promised not to.
 *
 * The rule itself is not restated here: `moneyFromCents` owns it (whole, non-negative, exactly
 * representable), and this function turns its exception into an answer.
 */
export function amountOf(claimed: Money): Money | undefined {
  const value: unknown = claimed;
  if (typeof value !== "number") {
    return undefined;
  }
  try {
    return moneyFromCents(value);
  } catch {
    return undefined;
  }
}

/**
 * The new total after an accrual, or `undefined` when it would stop being exact.
 *
 * `addMoney` throws past `Number.MAX_SAFE_INTEGER` cents, which is where a total would start losing
 * cents silently. Both callers are non-throwing by contract and each does the truthful thing with the
 * `undefined`: `decide` refuses the accrual, and `evolve` leaves the state untouched. They agree, which
 * is what keeps a fold equal to the sequence of Decisions that produced it.
 */
export function accrued(spent: Money, cost: Money): Money | undefined {
  try {
    return addMoney(spent, cost);
  } catch {
    return undefined;
  }
}
