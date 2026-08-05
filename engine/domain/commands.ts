/**
 * The Commands of a Mission: what someone intends, before the domain has agreed to it.
 *
 * A Command is an intent, not a fact. It is submitted to `decide`, which either accepts it — turning
 * it into Events — or refuses it. A Command therefore carries everything the rule needs, including
 * the Instant it was submitted at: **time enters the domain here and nowhere else.**
 *
 * The union is called `MissionCommand` for the same reason `MissionEvent` is not `Event`, and for
 * the same reason a plain `Command` would read badly at an import site next to a CLI's command
 * types. The glossary term is `Command`.
 *
 * Only `open-mission` carries a `missionId`: it is the Command that establishes one. Every other
 * Command is decided against a Mission that already exists, and its id comes from that state — a
 * Command that had to repeat the id could disagree with it, which is a state nobody should have to
 * handle.
 *
 * One member of this union is still shaped for its refusal path only, and its payload grows in the task
 * that owns its rule:
 *
 * - `DecideGate` — Task 8 (approve, revise with a reason, kill).
 *
 * It is already here because one of the illegal transitions the lifecycle refuses is a transition *of
 * that Command*: deciding a Gate that is not open.
 */

import type { Core } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type { Instant } from "./events";
import type { HarnessSources } from "./harness";
import type { Contract } from "./contract";
import type { Handoff } from "./handoff";
// Type-only import: erased at compile time, so there is no module cycle at runtime.
import type { Briefing, Delivery, Mode, Slice } from "./mission";

/** What every Command carries. */
type CommandAt = {
  readonly occurredAt: Instant;
};

/**
 * What opening a Mission needs. Separated from the Command so `openMission` can take exactly these
 * fields without a caller having to write `kind: "open-mission"` to construct a Mission.
 */
export type OpenMissionFields = CommandAt & {
  readonly missionId: MissionId;
  readonly briefing: Briefing;
  readonly mode: Mode;
  readonly cap: Money;
  readonly core: Core;
};

/** Open a Mission from a Briefing, with a Mode, a Cap and the Core that will lead it. */
export type OpenMission = OpenMissionFields & {
  readonly kind: "open-mission";
};

/** Consolidate the Mission into its Delivery. */
export type DeliverMission = CommandAt & {
  readonly kind: "deliver-mission";
  readonly delivery: Delivery;
};

/**
 * Assign a Slice of the Mission to a Zord.
 *
 * It carries the Harness **sources**, not a resolved Harness, and the asymmetry with `Delegated` is
 * the point. A Command is an intent: the caller says which Roster entry applies, what this one
 * invocation asks for and which Catalog default is the floor, and the domain applies the precedence
 * rule. Accepting a finished bundle instead would move the one rule `harness.ts` exists to own out to
 * every caller, and two callers would eventually resolve it differently.
 *
 * The `contract` is **required**, and there is no default. A Delegation with no Contract is a Slice
 * nobody can be held to, and an *optional* Contract would mean the product's loudest promise switches
 * itself off by omission — every Handoff would pass, and nobody would have written anything down to
 * say so. A Delegation that genuinely asks for nothing verifiable says it out loud, with a Contract
 * that has no Clauses: empty is an answer, absent is not.
 */
export type Delegate = CommandAt & {
  readonly kind: "delegate";
  readonly delegationId: DelegationId;
  readonly zordId: ZordId;
  readonly slice: Slice;
  readonly harnessSources: HarnessSources;
  readonly contract: Contract;
};

/**
 * Answer a Delegation with a Handoff.
 *
 * It carries the Handoff and **nothing else** — no separate `delegationId`, although Task 3's shape had
 * one. A Handoff already says which Delegation it answers, and a Command that repeated the id could
 * disagree with it, which is a state nobody should have to handle. It is the same rule that keeps
 * `missionId` off every Command but `open-mission`.
 *
 * It does **not** carry a Contract either. The Contract is on the Delegation, recorded when the
 * Delegation was made: a party that chooses the standard it is judged against has not signed a
 * Contract, it has signed a formality. See `Delegated` in `events.ts`.
 */
export type SubmitHandoff = CommandAt & {
  readonly kind: "submit-handoff";
  readonly handoff: Handoff;
};

/** Decide the Gate the Mission is waiting on. Approve, revise and kill: Task 8. */
export type DecideGate = CommandAt & {
  readonly kind: "decide-gate";
  readonly gateId: GateId;
};

/**
 * An intent submitted to a Mission, which the domain accepts or refuses.
 *
 * Adding a member here without handling it in `decide` fails the build: the `default` branch hands
 * the unhandled member to `exhausted`, whose parameter is `never`.
 */
export type MissionCommand =
  | OpenMission
  | DeliverMission
  | Delegate
  | SubmitHandoff
  | DecideGate;
