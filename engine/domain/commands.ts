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
 * Three members of this union are shaped for their refusal path only, and their payloads grow in the
 * task that owns their rule:
 *
 * - `Delegate` — Task 4 (the slice and the resolved Harness);
 * - `SubmitHandoff` — Task 6 (the Handoff itself, validated against its Contract);
 * - `DecideGate` — Task 8 (approve, revise with a reason, kill).
 *
 * They exist here because the illegal transitions this task must refuse are transitions *of these
 * Commands*: delegating on a halted Mission, handing off a Delegation that was never made, and
 * deciding a Gate that is not open.
 */

import type { Core } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type { Instant } from "./events";
// Type-only import: erased at compile time, so there is no module cycle at runtime.
import type { Briefing, Delivery, Mode } from "./mission";

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

/** Assign a slice of the Mission to a Zord. Rules: Task 4. */
export type Delegate = CommandAt & {
  readonly kind: "delegate";
  readonly delegationId: DelegationId;
  readonly zordId: ZordId;
};

/** Answer a Delegation with a Handoff. Contract validation: Task 6. */
export type SubmitHandoff = CommandAt & {
  readonly kind: "submit-handoff";
  readonly delegationId: DelegationId;
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
