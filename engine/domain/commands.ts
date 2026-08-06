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
 * Every member of this union now has a rule. `DecideGate` was the last one shaped for its refusal path
 * only — it was here from Task 3 because one of the illegal transitions the lifecycle refuses is a
 * transition *of that Command*, deciding a Gate that is not open — and Task 8 gave it the decision it
 * carries, plus the two Commands the Gate needed beside it: `RaiseGate` and `KillMission`.
 */

import type { Core } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type { Instant } from "./events";
import type { HarnessSources } from "./harness";
import type { Contract } from "./contract";
import type { Handoff } from "./handoff";
import type { GateDecision } from "./gate";
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

/**
 * Report what a Zord spent against one Delegation of this Mission.
 *
 * An accrual is a **report of money already gone**, not a request to spend it. That is what makes it
 * the one Command a Mission stopped at its Cap still accepts: refusing it would not un-spend the money,
 * it would only make the Meter understate what the Mission cost — and the Cap would then be compared
 * against a total that is too low, so the Mission would stop late or not at all. See
 * `decideAccrueCost` in `mission.ts`.
 *
 * The `delegationId` is required and has no default. Cost is accounted per Pane as well as per Mission,
 * and a Pane is what a Delegation runs in; an accrual naming no Delegation would be an amount the
 * per-Pane half of the Meter could not place. Every cost this PRD can produce comes from a Zord
 * invocation, which is always a Delegation.
 */
export type AccrueCost = CommandAt & {
  readonly kind: "accrue-cost";
  readonly delegationId: DelegationId;
  readonly cost: Money;
};

/**
 * Authorise a Mission stopped at its Cap to carry on, at a new Cap.
 *
 * The **new Cap**, absolute, and higher than what the Mission has already spent. Authorising at the same
 * Cap would authorise nothing: the Mission would resume with its limit already reached and refuse the
 * very next Command, so "the Mission stops and asks for authorisation" would be a loop rather than a
 * question. What the human is asked is not "carry on?" but "how much more may it spend?", and the answer
 * is a number.
 *
 * It carries no reason and no authoriser — see `CapAuthorised` in `events.ts` for why the second one is
 * absent rather than merely unused.
 */
export type AuthoriseCap = CommandAt & {
  readonly kind: "authorise-cap";
  readonly cap: Money;
};

/**
 * Raise a Gate on the Mission: stop it, and ask a human the question this Command carries.
 *
 * **Who submits it, and what this PRD does not model.** A Gate is declared by a Combination — the glossary
 * says a Combination has "a declared Roster, Gates and deliverable" — and there is no Combination
 * aggregate in `engine/`, so the domain has no way to *derive* that a Gate is due. It does not have to:
 * whoever runs the Mission submits the intent, and the domain owns what happens next, which is the same
 * split `accrue-cost` lives with. The domain does not decide what a Zord's run cost either; it decides
 * what a cost does.
 *
 * The `question` is required and has no default. A Gate that asks nothing stops the Mission for no stated
 * purpose, and the human it wakes up would have nothing to answer. It is checked when the Command is
 * decided, so a blank one is refused rather than recorded.
 *
 * It carries no Capability requirement, unlike `delegate`. Raising a checkpoint is not the Core's own act
 * — it is the Combination's declared stopping point, and `capability.ts` names no permission for it. A
 * capability check against a name nobody registered would be a rule with no registry behind it.
 */
export type RaiseGate = CommandAt & {
  readonly kind: "raise-gate";
  readonly gateId: GateId;
  readonly question: string;
};

/**
 * Decide the Gate the Mission is waiting on: approve it, or ask for a revision that says why.
 *
 * The `gateId` says **which** Gate is being answered even though only one can be open, and that is the
 * point: an answer that did not name its Gate would silently apply to whatever the Mission happened to be
 * waiting on by the time it arrived, and a human who answered a question ten minutes ago must not
 * accidentally approve a different one. `decide` refuses a `gateId` that is not the open Gate.
 *
 * The `decision` is required. A `decide-gate` that carries no decision decides nothing, and defaulting it
 * either way would make approval — or rejection — happen by omission.
 *
 * Killing is **not** one of the decisions here: see `KillMission` below.
 */
export type DecideGate = CommandAt & {
  readonly kind: "decide-gate";
  readonly gateId: GateId;
  readonly decision: GateDecision;
};

/**
 * End the Mission with no Delivery.
 *
 * ## Why this is not a Gate decision
 *
 * The PRD lists three human answers at a Gate — approve, revise with a reason, kill — and the first two
 * are answers to the Gate's *question*. Killing is not: it is a decision about the **Mission**, and
 * routing it through `decide-gate` would have made ending a Mission depend on somebody having raised a
 * checkpoint first. Two consequences make that untenable rather than merely inelegant:
 *
 * - a Mission that is **running** away, delegating and spending, could not be stopped at all;
 * - a Mission halted at its **Cap** could never be ended. Task 7 left it exactly one exit — an
 *   authorisation that raises the Cap — so a human who does not want to spend more had nothing to say.
 *   This is the other answer to "how much more?": none, and stop.
 *
 * So all three answers remain available to a human at a Gate, and the third one is available everywhere
 * else too. A kill does not *answer* the open Gate: the Gate stays unanswered on the record, which is the
 * truth — the Mission it was asked about no longer exists.
 *
 * ## What it carries
 *
 * The `reason` is required, and it is the one thing that survives a Mission nobody delivered: "why did
 * this stop" is the question a Replay of a killed Mission exists to answer, and an optional reason would
 * make silence the easiest answer at the one moment it costs the most. No author, for the reason
 * `CapAuthorised` has none — see `gate.ts`.
 *
 * It is accepted while the Mission is running or stopped, whichever stopped it, and refused on a Mission
 * that is not open yet or already over. Ending what has already ended changes only the record of why.
 */
export type KillMission = CommandAt & {
  readonly kind: "kill-mission";
  readonly reason: string;
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
  | AccrueCost
  | AuthoriseCap
  | RaiseGate
  | DecideGate
  | KillMission;
