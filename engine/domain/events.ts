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
 * Two facts in this union have no Command behind them yet, and that is deliberate:
 *
 * - `MissionHalted` is produced by the Cap (Task 7) and by a Gate opening (Task 8);
 * - `MissionKilled` is produced by a Gate decision (Task 8).
 *
 * The lifecycle folds them today because a state machine that cannot represent a halted Mission
 * cannot refuse anything on one, and refusing on one is what this task delivers. `Delegated`
 * likewise carries no Harness: resolving a Harness is Task 5 and the Delegation rules are Task 4.
 */

import type { DelegationId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type { Core } from "./capability";
// Type-only import. It is erased at compile time, so `mission.ts` importing this file back is not a
// module cycle at runtime: the Mission vocabulary belongs to the aggregate, and a fact is written in
// that vocabulary.
import type { Briefing, Delivery, Halt, Mode } from "./mission";

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
 * A slice of the Mission was assigned to a Zord.
 *
 * The payload is the identity of the Delegation and nothing else. Task 4 adds the slice and the
 * resolved Harness; this task needs the fact to exist so a Handoff can be checked against the
 * Delegations that were actually made.
 */
export type Delegated = EventOf & {
  readonly kind: "delegated";
  readonly delegationId: DelegationId;
  readonly zordId: ZordId;
};

/** The Mission stopped and is waiting for a human. Produced by Task 7 (Cap) and Task 8 (Gate). */
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
  | MissionHalted
  | MissionDelivered
  | MissionKilled;
