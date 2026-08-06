/**
 * The Events of a Mission: what happened, in the order it happened.
 *
 * An Event is a **fact**. It is never revised and never deleted, it carries the Instant it happened
 * at, and it is the only thing that can change a Mission: `decide` produces Events and `evolve`
 * folds them into state. Nothing in this domain mutates.
 *
 * The union is called `MissionEvent` and not `Event`, which is the glossary term for the concept.
 * `Event` is a global type in the `dom` lib this project compiles against, and a domain type that
 * shadows it would confuse every import site — a Cockpit importing `Event` from the engine into a
 * browser file is a bug waiting to happen. The term stays `Event` in prose; the symbol is
 * `MissionEvent`. The same applies to `MissionCommand` in `commands.ts`.
 *
 * One fact in this union has no Command behind it yet, and that is deliberate:
 *
 * - `MissionKilled` is produced by a Gate decision (Task 8).
 *
 * The lifecycle folds it today because a state machine that cannot represent a killed Mission cannot
 * refuse anything on one, and refusing on one is what the lifecycle task delivered. `MissionHalted`
 * was in the same position until Task 7 gave it its first producer: an accrual that reaches the Cap.
 * A Gate opening (Task 8) will be its second.
 */

import type { DelegationId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type { Core } from "./capability";
import type { Harness } from "./harness";
import type { Contract } from "./contract";
import type { Handoff } from "./handoff";
// Type-only import. It is erased at compile time, so `mission.ts` importing this file back is not a
// module cycle at runtime: the Mission vocabulary belongs to the aggregate, and a fact is written in
// that vocabulary.
import type { Briefing, Delivery, Halt, Mode, Slice } from "./mission";

declare const brand: unique symbol;

/**
 * A point in time, as a UTC ISO-8601 string: `2026-08-05T13:45:00.000Z`.
 *
 * Branded so a hand-written string cannot stand in for a checked one. UTC and `Z` only — a local
 * offset would make two Events from two machines impossible to order, and ordering is the whole
 * value of the Replay.
 *
 * The domain never reads a clock. An Instant enters on a Command, is copied onto the Event it
 * produces, and is never generated here.
 */
export type Instant = string & { readonly [brand]: "Instant" };

/** `2026-08-05T13:45:00Z` or `2026-08-05T13:45:00.000Z`, always UTC. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** Raised when a value cannot be a UTC ISO-8601 instant. */
export class InvalidInstantError extends Error {
  constructor(value: string) {
    super(
      `Instant must be a UTC ISO-8601 timestamp such as 2026-08-05T13:45:00.000Z, ` +
        `received ${JSON.stringify(value)}`,
    );
    this.name = "InvalidInstantError";
  }
}

/**
 * Constructs an Instant from a UTC ISO-8601 string.
 *
 * Throws `InvalidInstantError` on anything else, including a local-offset timestamp and a
 * syntactically valid string that is not a real date (`2026-02-30T00:00:00Z`).
 */
export function instant(value: string): Instant {
  if (!ISO_INSTANT.test(value)) {
    throw new InvalidInstantError(value);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new InvalidInstantError(value);
  }
  // A real date survives the round trip: `2026-02-30` parses in some engines and shifts to March.
  if (!new Date(parsed).toISOString().startsWith(value.slice(0, 19))) {
    throw new InvalidInstantError(value);
  }
  return value as Instant;
}

/**
 * Constructs an Instant from a `Date` the caller already has.
 *
 * This is the edge's helper: the caller reads the clock, the domain receives the reading. Nothing in
 * `engine/domain` calls it.
 */
export function instantFromDate(when: Date): Instant {
  const time = when.getTime();
  if (!Number.isFinite(time)) {
    throw new InvalidInstantError(String(when));
  }
  return when.toISOString() as Instant;
}

/** What every Event carries: which Mission it belongs to, and when it happened. */
type EventOf = {
  readonly missionId: MissionId;
  readonly occurredAt: Instant;
};

/** A Mission was opened from a Briefing, with a Mode, a Cap and the Core that leads it. */
export type MissionOpened = EventOf & {
  readonly kind: "mission-opened";
  readonly briefing: Briefing;
  readonly mode: Mode;
  readonly cap: Money;
  readonly core: Core;
};

/**
 * A Slice of the Mission was assigned to a Zord, with the Harness it runs under.
 *
 * The `harness` is the **resolved** bundle, not the sources it came from, and that is what makes this
 * fact a fact. A Replay has to be able to answer "what did this Zord actually run with", and an Event
 * carrying sources could only answer it by re-resolving them against a Catalog that has moved on —
 * producing a bundle nobody ever ran and calling it history. `decide` resolves once, here it is
 * recorded, and `evolve` copies it.
 *
 * The `contract` is here for exactly the same reason, and it is the one place it can be. A Handoff is
 * accepted or refused against the Contract that was **in force when the Delegation was made**. Left
 * anywhere else, the judgement would move: a Contract read from a Mission-level field at submit time
 * would let a Clause added after the fact retroactively fail a Zord, and a Contract carried on the
 * Handoff itself would let the party being judged choose the standard. Recorded here, folding the log
 * next month judges nothing again — `decide` already judged, once, against this.
 *
 * Every field is required. A `Delegated` that does not say which Slice was assigned, under which
 * bundle, or against which Contract, is not a fact anybody can act on.
 */
export type Delegated = EventOf & {
  readonly kind: "delegated";
  readonly delegationId: DelegationId;
  readonly zordId: ZordId;
  readonly slice: Slice;
  readonly harness: Harness;
  readonly contract: Contract;
};

/**
 * A Handoff answered a Delegation, and the Core accepted it against its Contract.
 *
 * Only the **acceptance** is a fact here. A Handoff that violated its Contract is refused as the
 * return value of `decide` and produces no Event: the Delegation stays open, the Zord fixes and
 * resubmits, and no human is involved at any point. What that costs the Replay — which the glossary
 * says includes what was refused — is stated in `mission.ts` under `decideSubmitHandoff` and is Task
 * 9's decision, because Task 9 owns the Replay and is the first reader such a fact would have.
 *
 * It carries the whole Handoff rather than a summary, because "what did this Zord claim, and what did
 * it admit it left out" is precisely what a Replay is asked months later.
 */
export type HandoffAccepted = EventOf & {
  readonly kind: "handoff-accepted";
  readonly delegationId: DelegationId;
  readonly handoff: Handoff;
};

/**
 * A Zord spent money against a Delegation of this Mission.
 *
 * It carries **what this one accrual cost**, not the totals it produces. The totals are the fold's
 * answer, computed from inside the aggregate by `evolve`, and recording them here would put the same
 * number in two places: a hand-written log could then claim a total its own accruals do not add up to,
 * and the Replay would have to decide which of the two to believe.
 *
 * That is not a contradiction of the rule `Delegated` follows — a fact carries the resolved value,
 * never the recipe. `cost` comes from **outside** the aggregate (the runtime spent it) so it is on the
 * fact; a total is computed from the facts themselves, so it belongs to the fold.
 *
 * The `delegationId` is required, because a cost with no Pane behind it is an amount nobody can show
 * anywhere. Every cost in this PRD comes from a Zord invocation, which is a Delegation: the
 * `AgentRunner` port reports a `cost` for a `Harness` it ran, and nothing else in the domain spends.
 */
export type CostAccrued = EventOf & {
  readonly kind: "cost-accrued";
  readonly delegationId: DelegationId;
  readonly cost: Money;
};

/**
 * A human authorised a Mission stopped at its Cap to carry on, at a new and higher Cap.
 *
 * The fact carries the **new Cap** as an absolute amount rather than an increment. A Mission's Cap is
 * the number a human set, so raising it is setting it again: an increment would have to be added to a
 * `spent` the authoriser may have read a minute ago, and two authorisations racing on a stale reading
 * would produce a Cap nobody chose. Absolute is also what a Replay can answer months later — "the Cap
 * was raised to R$ 80,00" needs no other fact to be legible.
 *
 * There is deliberately no authoriser on it: this domain has no actor or identity model — the Core is
 * a capability set, and nothing else in `engine/` names a person — so a field recording who authorised
 * would be a claim no rule could check. Recorded as a Gap of Task 7; a Gate decision (Task 8) faces
 * exactly the same question and should answer it the same way, or the two will drift.
 */
export type CapAuthorised = EventOf & {
  readonly kind: "cap-authorised";
  readonly cap: Money;
};

/**
 * The Mission stopped and is waiting for a human.
 *
 * Produced by an accrual that reached the Cap (Task 7) and by a Gate opening (Task 8). Which of the two
 * it was is in the `Halt`, which is a union precisely so a Cap halt cannot carry a GateId.
 */
export type MissionHalted = EventOf & {
  readonly kind: "mission-halted";
  readonly halt: Halt;
};

/** The Mission was consolidated into its Delivery. Terminal. */
export type MissionDelivered = EventOf & {
  readonly kind: "mission-delivered";
  readonly delivery: Delivery;
};

/** The Mission was terminated without a Delivery. Terminal. Produced by a Gate kill (Task 8). */
export type MissionKilled = EventOf & {
  readonly kind: "mission-killed";
  readonly reason: string;
};

/**
 * A fact that happened to a Mission.
 *
 * Adding a member here without handling it in `evolve` fails the build: the `default` branch of the
 * fold hands the unhandled member to `exhausted`, whose parameter is `never`.
 */
export type MissionEvent =
  | MissionOpened
  | Delegated
  | HandoffAccepted
  | CostAccrued
  | CapAuthorised
  | MissionHalted
  | MissionDelivered
  | MissionKilled;
