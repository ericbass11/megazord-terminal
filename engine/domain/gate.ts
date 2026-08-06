/**
 * The Gate: the checkpoint where a Mission stops and waits for a human, and the answer that lets it go
 * on.
 *
 * A Gate is the one place in this domain where the machine deliberately stops being autonomous. Nothing
 * here reads a clock, allocates an id or mutates its argument: a Gate is recorded on the Mission by
 * `evolve` from a `GateRaised` fact, and answered by a `GateDecided` one. This module owns the shape and
 * the readings; the rules about *when* a Gate may be raised and answered live in `decide`, beside every
 * other rule.
 *
 * ## One open Gate, and no list of concurrent ones
 *
 * A Mission halted at a Gate carries `halt.reason === "gate-open"` with the GateId it is waiting on —
 * the shape Task 3 chose — and **that halt is what makes a Gate open.** The `gates` list on the Mission
 * is the record of what was asked and what was answered, not a queue: `decide` refuses to raise a Gate on
 * a Mission that is not running, and raising one halts it, so a second Gate cannot be raised while the
 * first is unanswered.
 *
 * Concurrent Gates were rejected rather than forgotten. A Gate exists to stop the Mission and ask one
 * question; two open at once would mean the Mission is stopped twice, which the `Halt` union cannot say
 * and a human could not act on — "which of these am I answering, and does answering one resume anything?"
 * has no good answer. Whoever needs to ask two things asks them in one Gate's question, or one after the
 * other.
 *
 * ## Openness is the absence of an answer
 *
 * A Gate carries an **optional `decision`**, present exactly when it was answered, absent while it is
 * open — the same shape `Delegation` uses for its `handoff`, and rejected for the same alternatives: a
 * `status` field whose only value is `"open"` is a lie no rule can move, and a discriminated union of
 * `OpenGate | DecidedGate` needs a discriminant that would have to be that field.
 *
 * A Gate on a Mission that was **killed** stays open forever, and that is the truth: nobody answered it.
 * A kill is not an answer to a Gate — see `KillMission` in `commands.ts`.
 *
 * ## Two answers, and why `kill` is not one of them
 *
 * `GateDecision` has two members, and the PRD's third human answer — kill — is a Command of its own:
 *
 * - **approve**: the Mission resumes as it was.
 * - **revise, with a reason**: the Mission also resumes, carrying the reason as context. It has to
 *   resume, or nothing could act on the reason; and the reason is *not* a new Briefing, because a Mission
 *   is opened once from one Briefing and rewriting it would erase what the Mission was for.
 *
 * Killing is a decision about the **Mission**, not an answer to the Gate's question, and modelling it
 * here would have made ending a Mission depend on somebody having raised a checkpoint first — a running
 * Mission would be unstoppable, and a Mission halted at its Cap could never be abandoned. It is
 * `kill-mission`, accepted while a Mission is running or stopped, whichever stopped it.
 *
 * ## No authoriser, for the same reason a Cap authorisation has none
 *
 * A Gate decision is a human act, and nothing in `engine/` names a human: the Core is a capability set,
 * and a Zord is an id with a Harness. So `GateDecided` records **what** was decided and not **who**
 * decided it, exactly as `CapAuthorised` records the new Cap and no authoriser. A field nothing can check
 * is the always-zero lie `CLAUDE.md` warns about. Declared as a Gap of Task 7 and again of Task 8:
 * whoever adds an actor model adds it to both facts and to `MissionKilled`, in one change, or the three
 * will drift.
 */

import type { GateId } from "./ids";
// Type-only import, the arrangement `events.ts` and `meter.ts` both use: erased at compile time, so
// `events.ts` importing `GateDecision` back from here is not a module cycle at runtime.
import type { Instant } from "./events";

/**
 * The human answer to an open Gate.
 *
 * **An approval carries no reason, and `reason?: never` is not what enforces that.** Falsified, and the
 * result corrects what `CLAUDE.md` recorded for `Halt`'s `gateId?: never`: with the exclusion deleted
 * entirely, `{ kind: "approved", reason: "looks fine" }` *still* does not compile. Excess-property checking
 * accepts a property any member declares only for a union with no discriminant — where the members are
 * discriminated, TypeScript narrows to the member the discriminant selects and checks the excess property
 * against that member alone. So the guarantee is the `approved` member **not declaring** `reason`, and it is
 * falsified by widening the member to `reason?: string`, which is what makes the probe in `gate.test.ts`
 * report `TS2578`.
 *
 * What the `?: never` does buy is the same thing it buys on `Halt`: `decision.reason` can be read off the
 * un-narrowed union and is `undefined` on an approval, instead of being a compile error at every reading
 * site. It is kept for that, and for consistency with `Halt`, and not as the exclusion it looks like.
 *
 * The reason on a revision is **required**, and required at the type level: a revision that does not say
 * what to change is a rejection dressed as guidance, and the Core it goes back to would have nothing to
 * act on. Blank strings are refused by `decisionOf` at runtime, where a value forced past the compiler
 * arrives.
 */
export type GateDecision =
  | { readonly kind: "approved"; readonly reason?: never }
  | { readonly kind: "revision-requested"; readonly reason: string };

/**
 * A checkpoint the Mission stopped at, as the Mission remembers it.
 *
 * `question` is what the human is being asked, and it is required: a Gate that asks nothing stops the
 * Mission for no stated purpose, and whoever is woken up by it has no way to answer. It is checked where
 * the Command is decided, like a Briefing and a Slice, and `decide` refuses a `raise-gate` that carries
 * none.
 *
 * `raisedAt` is the Instant the Gate stopped the Mission — the same field `Delegation` carries as
 * `delegatedAt`, and the answer to "how long has this been waiting on somebody". There is deliberately no
 * `decidedAt` beside `decision`: a pair of optionals is a state that can be half present and mean
 * nothing, so the Instant an answer arrived at lives on the `GateDecided` fact and the state keeps what a
 * rule reads.
 */
export type Gate = {
  readonly id: GateId;
  /** What the human is being asked. Required: a Gate that asks nothing stops the Mission for nothing. */
  readonly question: string;
  readonly raisedAt: Instant;
  /** The answer it got. Absent while it is open — openness is this field not being here. */
  readonly decision?: GateDecision;
};

/**
 * Whether a Gate is still waiting for an answer.
 *
 * The derived reading that replaces the `status` field this type does not have, exactly as
 * `isOpenDelegation` does for a Delegation.
 */
export function isOpenGate(gate: Gate): boolean {
  return gate.decision === undefined;
}

/**
 * The Gate a Mission is waiting to be told about, or `undefined` when every Gate it raised was answered.
 *
 * A reading for whoever has to show a human the question — the counterpart of `meterOf`, and like it, not
 * consulted by any rule: what makes a Gate *block* is the halt on the Mission, which is the fact, so
 * `decide` reads that and this cannot disagree with it. At most one Gate is ever open, because raising one
 * halts the Mission and a halted Mission raises none.
 */
export function openGateIn(gates: readonly Gate[]): Gate | undefined {
  return gates.find(isOpenGate);
}

/**
 * Every revision a human asked for, in the order the Gates that carried them were raised.
 *
 * This is what keeps "revise with a reason" from being theatre: the reason is on the state, so the Core
 * that resumes can read what it was told to change, and a Surface can show it beside the work. A list
 * rather than one latest value — a Mission may be sent back more than once, and the earlier reasons are
 * what explain the shape of what came after. The last one is `revisionsIn(gates).at(-1)`.
 */
export function revisionsIn(gates: readonly Gate[]): readonly string[] {
  return gates.flatMap((gate) =>
    gate.decision?.kind === "revision-requested" ? [gate.decision.reason] : [],
  );
}

/**
 * Reads a Gate decision without trusting its type, answering `undefined` when it is not one this domain
 * can record.
 *
 * The same threat model and the same shape as `amountOf` in `meter.ts`: a `GateDecision` can arrive
 * through a cast, a `JSON.parse` or a boundary this module cannot see, and both callers are contractually
 * non-throwing, so a value that is not a decision has to become an answer rather than an exception.
 * `decide` refuses it and `evolve` ignores it — the two agree, which is what keeps a fold equal to the
 * sequence of Decisions that produced it.
 *
 * It **rebuilds** what it returns, frozen, rather than passing its argument through. A decision forced
 * past the compiler can carry an extra field, and a fact is what a Replay reads months later: it records
 * the two shapes this domain has and nothing else.
 */
export function decisionOf(claimed: GateDecision): GateDecision | undefined {
  const value: unknown = claimed;
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const decision = value as GateDecision;

  switch (decision.kind) {
    case "approved":
      return Object.freeze({ kind: "approved" });

    case "revision-requested": {
      const reason: unknown = decision.reason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return undefined;
      }
      return Object.freeze({ kind: "revision-requested", reason });
    }

    default: {
      // The exhaustiveness check, inline. `exhausted` in `mission.ts` is the same mechanism, and it is
      // not imported here: `mission.ts` imports this module for its values, so importing a value back
      // would be a real module cycle at runtime. Add a member to `GateDecision` without handling it and
      // this assignment stops compiling.
      const unhandled: never = decision;
      void unhandled;
      return undefined;
    }
  }
}
