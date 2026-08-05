/**
 * The Mission: its lifecycle, and the two functions that are the whole model.
 *
 * ```
 * decide(state, command) -> Decision   // accepted Events, or a Refusal. Never throws.
 * evolve(state, event)   -> Mission    // total, deterministic. Never throws.
 * ```
 *
 * `decide` is the only place a rule lives, and `evolve` is the only place state changes. Neither
 * reads a clock, generates an id, calls out, or randomises anything: time arrives as `occurredAt` on
 * the Command, and everything else the rule needs is either in the Command or already in the state.
 * That is what makes a Mission reconstructible from its Events alone.
 *
 * **The lifecycle.** A Mission is `unopened` until it is opened from a Briefing with a Mode and a
 * Cap; then it is `running`; it may be `halted`, waiting for a human at a Gate or at its Cap; and it
 * ends either `delivered` or `killed`. The states are a discriminated union rather than a status
 * field on one record, so a state cannot carry what it has no business carrying: an unopened Mission
 * has no Cap and no Delegations to read, a delivered one has a Delivery, a halted one always says
 * what halted it, and only a Gate halt carries a GateId.
 *
 * **What TypeScript cannot refuse, `decide` does.** "The Mission is running" is not a property of a
 * Command, so `delegate` on a halted Mission type-checks; it is refused at runtime with reason
 * `"illegal-transition"` and a violation that names the state it was refused in.
 *
 * ## Scope of this task
 *
 * This file delivers the lifecycle skeleton, Delegation and the Contract judgement of a Handoff. The
 * remaining rule clusters are deliberately absent and are refused rather than guessed at — see
 * `unmodelled` below:
 *
 * | Cluster                          | Task | State  |
 * | -------------------------------- | ---- | ------ |
 * | Delegation mechanics             | 4    | here   |
 * | Harness resolution               | 5    | done   |
 * | Contract validation of a Handoff | 6    | here   |
 * | Cost accrual and Cap enforcement | 7    | absent |
 * | Gate decisions                   | 8    | absent |
 * | Replay projection                | 9    | absent |
 *
 * Consequently there is no `spent` on the state and no `cost-accrued` Event: an always-zero field
 * that no rule updates would be a lie, and Task 7 adds both together with the accrual that moves
 * them. For the same reason a Delegation carries no `status`: see `Delegation` below.
 */

import type { Core, OrchestrationCapabilityName } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
// A value import, unlike everything else here: `decide` calls `resolveHarness`. It is pure — no
// clock, no randomness, no I/O — so calling it keeps `decide` pure too. `harness.ts` imports nothing
// from this file, so there is no cycle to worry about.
import { InvalidHarnessError, resolveHarness, type Harness, type HarnessSources } from "./harness";
// A value import for the same reason: `decide` calls `validateHandoff`, which is pure and total and
// never throws. `contract.ts` imports nothing from this file.
import { validateHandoff, type Contract } from "./contract";
import type { Handoff } from "./handoff";
import type {
  Delegated,
  HandoffAccepted,
  Instant,
  MissionDelivered,
  MissionEvent,
  MissionHalted,
  MissionKilled,
  MissionOpened,
} from "./events";
import type {
  DecideGate,
  Delegate,
  DeliverMission,
  MissionCommand,
  OpenMission,
  OpenMissionFields,
  SubmitHandoff,
} from "./commands";

declare const brand: unique symbol;

/* -------------------------------------------------------------------------------------------------
 * The vocabulary a Mission is described in
 * ---------------------------------------------------------------------------------------------- */

/** Who leads a Mission and how much autonomy exists. */
export const MODES = ["free", "combination", "agentic"] as const;

/** Who leads a Mission and how much autonomy exists: Free, Combination or Agentic. */
export type Mode = (typeof MODES)[number];

/**
 * The description of the expected outcome that opens a Mission.
 *
 * Branded, so the text that opens a Mission has been through `briefing` — a Mission opened from an
 * empty string has no definition of done, and everything downstream would be measured against
 * nothing.
 */
export type Briefing = string & { readonly [brand]: "Briefing" };

/** Raised when a Briefing says nothing. */
export class InvalidBriefingError extends Error {
  constructor(outcome: string) {
    super(`Briefing must describe an expected outcome, received ${JSON.stringify(outcome)}`);
    this.name = "InvalidBriefingError";
  }
}

/**
 * Constructs a Briefing. Throws `InvalidBriefingError` on a blank one.
 *
 * Whether it states the end instead of the steps is a judgement no type can make; that it says
 * something at all is checkable, and is checked here.
 */
export function briefing(outcome: string): Briefing {
  if (outcome.trim().length === 0) {
    throw new InvalidBriefingError(outcome);
  }
  return outcome as Briefing;
}

/**
 * The portion of a Mission's outcome that one Delegation hands to a Zord.
 *
 * Branded for the same reason a Briefing is: a Zord handed an empty Slice has been told nothing, and
 * the Handoff that answers it would be measured against nothing. A Slice states the end of its
 * portion, not the steps — which is a judgement no type can make, so `slice` checks only what is
 * checkable, that it says something at all.
 */
export type Slice = string & { readonly [brand]: "Slice" };

/** Raised when a Slice says nothing. */
export class InvalidSliceError extends Error {
  constructor(portion: string) {
    super(`Slice must describe the portion assigned to a Zord, received ${JSON.stringify(portion)}`);
    this.name = "InvalidSliceError";
  }
}

/** Constructs a Slice. Throws `InvalidSliceError` on a blank one. */
export function slice(portion: string): Slice {
  if (portion.trim().length === 0) {
    throw new InvalidSliceError(portion);
  }
  return portion as Slice;
}

/**
 * The assignment of a slice of a Mission to a Zord, as the Mission remembers it.
 *
 * It carries the **resolved** Harness, not the sources it was resolved from. That is the whole point
 * of the Harness surface: months later, "which bundle did this Zord actually run with" has to have an
 * answer, and sources plus a resolution rule is not an answer — re-resolving them against a Catalog
 * that has moved on since would produce a different bundle and call it history. `decide` resolves
 * once, the `Delegated` fact carries the result, and `evolve` copies it.
 *
 * It also carries the **Contract** it is answerable against, recorded at the moment it was made. That
 * is where the Contract lives, and the two alternatives are both wrong: on the Mission, a Clause added
 * after this Delegation was made would retroactively fail a Zord that never saw it; on the Handoff, the
 * party being judged would pick the standard. Recorded here, `decide` judges once against the Contract
 * that was in force, and folding the log later re-judges nothing.
 *
 * ## Open, and what settled it
 *
 * A Delegation is **open** from the moment it is recorded. There is deliberately no `status` field
 * saying so: a field that only ever holds one value is a lie the type system endorses (see
 * `CLAUDE.md`). Openness is the *absence of an answer*, and the answer is a Handoff.
 *
 * So the settlement is the optional `handoff` — present exactly when a Handoff was accepted, absent
 * while nothing has answered. Two shapes were rejected:
 *
 * - a **discriminated union** of `OpenDelegation | AnsweredDelegation`, which would make reading the
 *   Handoff of an open Delegation a compile error. It needs a discriminant, and the only honest
 *   discriminant available is a `status` field — the very thing this type refuses to carry.
 * - a **pair of optional fields** (`handoff` plus a `settledAt`), which is a state that can be half
 *   present and mean nothing. The Instant a Handoff was accepted at is on the Event; the state keeps
 *   what a rule reads.
 *
 * A **refused** Handoff settles nothing: the field stays absent and the Zord may resubmit. See
 * `decideSubmitHandoff`.
 */
export type Delegation = {
  readonly id: DelegationId;
  readonly zordId: ZordId;
  readonly slice: Slice;
  readonly harness: Harness;
  /** What this Delegation is answerable against, as agreed when it was made. */
  readonly contract: Contract;
  readonly delegatedAt: Instant;
  /** The Handoff that answered it. Absent while it is open — openness is this field not being here. */
  readonly handoff?: Handoff;
};

/**
 * Whether a Delegation is still waiting for an answer.
 *
 * The derived reading that replaces the `status` field this type does not have. A Delegation is open
 * until a Handoff was accepted against its Contract; a refused Handoff leaves it open, which is what
 * makes "refuse and resubmit" the loop rather than a dead end.
 */
export function isOpenDelegation(delegation: Delegation): boolean {
  return delegation.handoff === undefined;
}

/** The consolidated outcome of a Mission, with the artifacts that prove it works. */
export type Delivery = {
  readonly summary: string;
  readonly artifacts: readonly string[];
};

/**
 * Why a Mission stopped and what it is waiting for.
 *
 * A union rather than a reason plus an optional GateId: a Cap halt has no Gate, and a Gate halt
 * always has one. Written flat, `{ reason: "cap-reached", gateId }` would be a representable state
 * with no meaning.
 *
 * `gateId?: never` on the Cap member is not decoration. Excess-property checking against a union
 * accepts a property that any member declares, so without it `{ reason: "cap-reached", gateId }`
 * would compile — the exclusion has to be written down to exist.
 */
export type Halt =
  | { readonly reason: "cap-reached"; readonly gateId?: never }
  | { readonly reason: "gate-open"; readonly gateId: GateId };

/* -------------------------------------------------------------------------------------------------
 * The states
 * ---------------------------------------------------------------------------------------------- */

/** What a Mission carries from the moment it is opened onwards, whatever becomes of it. */
type OpenedFields = {
  readonly id: MissionId;
  readonly briefing: Briefing;
  readonly mode: Mode;
  readonly cap: Money;
  /**
   * The Core that leads this Mission.
   *
   * Reused from `capability.ts`, where both halves of its invariant live: the parameter type of
   * `core()` refuses an `ExecutionCapability` and `assertNoExecution` refuses one that was forced
   * through a cast. This file does not re-check it, because `decide` and `evolve` never throw and a
   * Core is only constructible through `core()`.
   */
  readonly core: Core;
  readonly openedAt: Instant;
  readonly delegations: readonly Delegation[];
};

/** A Mission that does not exist yet: the state every Event log starts from. */
export type UnopenedMission = {
  readonly status: "unopened";
};

/** A Mission that is open for work. */
export type RunningMission = OpenedFields & {
  readonly status: "running";
};

/** A Mission stopped, waiting for a human — at a Gate, or at its Cap. */
export type HaltedMission = OpenedFields & {
  readonly status: "halted";
  readonly halt: Halt;
};

/** A Mission consolidated into its Delivery. Terminal. */
export type DeliveredMission = OpenedFields & {
  readonly status: "delivered";
  readonly delivery: Delivery;
};

/** A Mission terminated without a Delivery. Terminal. */
export type KilledMission = OpenedFields & {
  readonly status: "killed";
  readonly reason: string;
};

/** A Mission that has been opened, in any of the states that follow from that. */
export type OpenedMission = RunningMission | HaltedMission | DeliveredMission | KilledMission;

/** A Mission, in every state it can be in. */
export type Mission = UnopenedMission | OpenedMission;

/** The states of the lifecycle. */
export type MissionStatus = Mission["status"];

/** The state before anything happened. Frozen: it is shared by every fold that starts from scratch. */
export const UNOPENED_MISSION: UnopenedMission = Object.freeze({ status: "unopened" });

/** Whether a Mission has been opened, narrowing away the state that carries nothing. */
export function isOpened(state: Mission): state is OpenedMission {
  return state.status !== "unopened";
}

/* -------------------------------------------------------------------------------------------------
 * The Decision
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a Command was refused.
 *
 * `"unrunnable-harness"` is a fifth reason the techspec's four did not have, added by Task 4 rather
 * than folded into one of them. A Delegation whose resolved Harness cannot run is not an illegal
 * transition — the Mission is running and the Core may delegate, so the transition is perfectly
 * legal — and it is neither a Contract violation, nor the Cap, nor a missing Capability. Reusing any
 * of those would put a wrong reason on a Refusal that a Surface is going to show a human.
 */
export const REFUSAL_REASONS = [
  "illegal-transition",
  "contract-violation",
  "cap-reached",
  "missing-capability",
  "unrunnable-harness",
] as const;

/** Why a Command was refused. */
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/**
 * The rejection of a Command, with what it broke.
 *
 * `violations` carries one human-readable line per broken rule — plural on purpose: a Command can be
 * wrong in more than one way at once, and reporting only the first would send the caller round the
 * loop twice.
 */
export type Refusal = {
  readonly reason: RefusalReason;
  readonly violations: readonly string[];
};

/** The result of deciding a Command: the Events it produced, or the Refusal that stopped it. */
export type Decision =
  | { readonly kind: "accepted"; readonly events: readonly MissionEvent[] }
  | { readonly kind: "refused"; readonly refusal: Refusal };

/* -------------------------------------------------------------------------------------------------
 * Opening a Mission
 * ---------------------------------------------------------------------------------------------- */

/**
 * Opens a Mission from a Briefing, with a Mode, a Cap and the Core that leads it.
 *
 * A convenience over `decide` plus `evolve` for the one Command that cannot be refused on a Mission
 * that does not exist yet. It builds the same `MissionOpened` Event and folds it through the same
 * code path, so the two ways of opening a Mission cannot drift.
 */
export function openMission(fields: OpenMissionFields): RunningMission {
  return applyOpened(missionOpenedFrom(fields));
}

/* -------------------------------------------------------------------------------------------------
 * decide
 * ---------------------------------------------------------------------------------------------- */

/**
 * Decides a Command against a Mission: the accepted Events, or the Refusal.
 *
 * Never throws, never reads a clock, never asks anybody. A Refusal is an ordinary return value —
 * which is precisely why the domain cannot accidentally involve a human in one.
 */
export function decide(state: Mission, command: MissionCommand): Decision {
  switch (command.kind) {
    case "open-mission":
      return decideOpenMission(state, command);
    case "deliver-mission":
      return decideDeliverMission(state, command);
    case "delegate":
      return decideDelegate(state, command);
    case "submit-handoff":
      return decideSubmitHandoff(state, command);
    case "decide-gate":
      return decideDecideGate(state, command);
    default:
      // Unreachable while every member of `MissionCommand` is handled above — which is what the
      // `never` parameter enforces at compile time. A value that got here was forced past the type
      // system, and the safe answer to an intent nobody wrote a rule for is no.
      exhausted(command);
      return refused("illegal-transition", [
        "a Command this engine does not recognise cannot be accepted",
      ]);
  }
}

function decideOpenMission(state: Mission, command: OpenMission): Decision {
  if (isOpened(state)) {
    return refused("illegal-transition", [
      `a Mission is opened once, and this one is already ${describe(state)}`,
    ]);
  }
  return accepted([missionOpenedFrom(command)]);
}

function decideDeliverMission(state: Mission, command: DeliverMission): Decision {
  if (state.status !== "running") {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} cannot be delivered`,
    ]);
  }
  const delivered: MissionDelivered = {
    kind: "mission-delivered",
    missionId: state.id,
    occurredAt: command.occurredAt,
    delivery: command.delivery,
  };
  return accepted([delivered]);
}

/**
 * Delegates a Slice of the Mission to a Zord, with the Harness resolved here and now.
 *
 * Four rules, checked in this order, and the order is a decision:
 *
 * 1. **The Mission must be running.** A Mission that is halted, over or not open yet admits no
 *    Delegation. Refused `illegal-transition`.
 * 2. **The DelegationId must be free.** Two different Delegations under one id cannot be folded
 *    deterministically — the Replay would carry two contradictory facts about the same thing and the
 *    Handoff that answers "that" Delegation would not know which one it answered. Refused
 *    `illegal-transition`: the Mission has already made that Delegation, and it makes it once.
 * 3. **The Core must hold the `delegate` capability.** Delegating is the Core's own act, and
 *    `capability.ts` already names the permission for it. Refused `missing-capability` — the reason
 *    the techspec put in the union for exactly this.
 * 4. **The resolved Harness must be runnable.** Refused `unrunnable-harness`, carrying what was
 *    wrong with the bundle.
 *
 * Rules 1 and 2 are both `illegal-transition`, so a Command that breaks both is refused once with
 * both violations listed. Rules 3 and 4 carry reasons of their own, so they are answered one at a
 * time — a Refusal has one reason, and the truthful thing to do with two different ones is to report
 * the more fundamental first: a Core that may not delegate at all is a bigger problem than a bundle
 * that will not start.
 *
 * **The Harness is resolved here, not later.** `decide` produces the fact, and a fact has to be
 * complete: `Delegated` carries the resolved bundle so a Replay can say what the Zord ran with
 * without re-deriving it. Deferring the resolution to whoever reads the Event would make the answer a
 * function of the Catalog *at reading time*, so the same log would tell a different story next month.
 * Resolving here costs nothing in purity — `resolveHarness` reads no clock and rolls no dice — and it
 * is what makes the Delegation auditable at all.
 */
function decideDelegate(state: Mission, command: Delegate): Decision {
  const alreadyUsed =
    findDelegation(state, command.delegationId) === undefined
      ? []
      : [
          `Delegation "${command.delegationId}" was already made in this Mission, ` +
            `and a Mission makes each one once`,
        ];

  if (state.status !== "running") {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} admits no Delegation, ` +
        `so Zord "${command.zordId}" cannot be given one`,
      ...alreadyUsed,
    ]);
  }
  if (alreadyUsed.length > 0) {
    return refused("illegal-transition", alreadyUsed);
  }
  if (!holds(state.core, DELEGATE_CAPABILITY)) {
    return refused("missing-capability", [
      `the Core of this Mission holds no "${DELEGATE_CAPABILITY}" capability, ` +
        `so Zord "${command.zordId}" cannot be given a Delegation`,
    ]);
  }

  const resolved = resolvedHarnessOf(command.harnessSources);
  if (resolved.kind === "unrunnable") {
    return refused("unrunnable-harness", resolved.violations);
  }

  const delegated: Delegated = {
    kind: "delegated",
    missionId: state.id,
    occurredAt: command.occurredAt,
    delegationId: command.delegationId,
    zordId: command.zordId,
    slice: command.slice,
    harness: resolved.harness,
    contract: command.contract,
  };
  return accepted([delegated]);
}

/**
 * Answers a Delegation with a Handoff, and refuses it when it violates its Contract.
 *
 * **This is the promise.** A Handoff that breaks its Contract is refused here, by a pure function, with
 * the violations listed — no human is asked, and the domain has no way to ask one. The Refusal is the
 * ordinary return value of `decide`, which is exactly why criterion 3 is a property of the shape rather
 * than a claim about behaviour.
 *
 * Four rules, in this order:
 *
 * 1. **The Mission must be running**, and **the Delegation must exist**. Both are
 *    `illegal-transition`, so a Command that breaks both is refused once with both violations, state
 *    first — a Handoff for a Delegation nobody made is not a Contract question at all.
 * 2. **The Delegation must still be open.** A Delegation is answered once: two accepted Handoffs under
 *    one id would leave the Mission unable to say which one it holds, and a Zord could quietly overwrite
 *    a colleague's accepted delivery. Refused `illegal-transition` — the answered Delegation genuinely
 *    has no second transition.
 * 3. **The Handoff must honour the Contract recorded on the Delegation.** Refused
 *    `contract-violation`, carrying every violation `validateHandoff` found.
 *
 * ## Refused, then resubmitted
 *
 * A Refusal settles nothing. The Delegation stays open, so the Zord fixes what was named and submits
 * again, as many times as it takes, with no human in the loop. The alternative — a Refusal that closes
 * the Delegation — would make automatic refusal *more* expensive than a human review: the only recovery
 * would be a fresh Delegation under a new id, and the Replay would then claim the first Zord never
 * delivered anything.
 *
 * ## What a refused attempt leaves behind, and what it does not
 *
 * Nothing, in the log. A Refusal is a return value and produces no Event, because `Decision` says
 * `refused` carries a Refusal and no Events — the shape the techspec pins and criterion 3 requires.
 *
 * The glossary says a Replay includes what was refused, and this file does not deliver that. It is left
 * whole, not half-built, and it is **Task 9's** decision, because Task 9 owns `replay.ts` and is the
 * first thing that would read such a fact. Recording a `handoff-refused` Event now would be an Event no
 * rule folds and nothing projects — the same lie as an always-zero `spent`. Two shapes are available to
 * Task 9, and both are additive:
 *
 * - let the `refused` member of `Decision` carry facts as well as the Refusal, and fold a
 *   `handoff-refused` Event that appends the attempt to its Delegation; or
 * - build the Replay from the sequence of Decisions rather than from the Event log, leaving the fold
 *   untouched.
 *
 * Declared as a Gap in this task's Handoff either way.
 */
function decideSubmitHandoff(state: Mission, command: SubmitHandoff): Decision {
  // Read as `unknown` before anything is taken off it. This is the first Command in the engine whose
  // required field is *dereferenced* rather than copied, so a Command that lost it on the way in — a
  // cast, a `JSON.parse` of a truncated payload — would throw where `decide` promised not to. Every
  // other Command survives that by accident; this one survives it on purpose.
  const claimed: unknown = command.handoff;
  if (typeof claimed !== "object" || claimed === null) {
    return refused("illegal-transition", [
      `a Handoff is what a submit-handoff Command submits, and this one carries none`,
    ]);
  }
  const submitted = claimed as Handoff;
  const wrongState =
    state.status === "running" ? [] : [`a Mission that is ${describe(state)} admits no Handoff`];
  const delegation = findDelegation(state, submitted.delegationId);

  // Checked before the state, so the narrowing below is the compiler's and not a cast — and reported
  // after it, so the violations read state first, as they did before this rule existed.
  if (delegation === undefined) {
    return refused("illegal-transition", [
      ...wrongState,
      `Delegation "${submitted.delegationId}" was never made in this Mission, ` +
        `so there is nothing to hand off`,
    ]);
  }
  // The same condition as `wrongState`, written out again rather than read off its length: an aliased
  // check does not narrow, and `state.id` below has to be the compiler's knowledge, not a cast.
  if (state.status !== "running") {
    return refused("illegal-transition", wrongState);
  }
  if (!isOpenDelegation(delegation)) {
    return refused("illegal-transition", [
      `Delegation "${submitted.delegationId}" was already answered by an accepted Handoff, ` +
        `and a Delegation is answered once`,
    ]);
  }

  const violations = contractViolationsOf(delegation.contract, submitted);
  if (violations.length > 0) {
    return refused("contract-violation", violations);
  }

  const answered: HandoffAccepted = {
    kind: "handoff-accepted",
    missionId: state.id,
    occurredAt: command.occurredAt,
    delegationId: submitted.delegationId,
    handoff: submitted,
  };
  return accepted([answered]);
}

function decideDecideGate(state: Mission, command: DecideGate): Decision {
  const open = openGateOf(state);

  if (open === undefined) {
    return refused("illegal-transition", [
      `no Gate is open on a Mission that is ${describe(state)}, ` +
        `so Gate "${command.gateId}" cannot be decided`,
    ]);
  }
  if (open !== command.gateId) {
    return refused("illegal-transition", [
      `Gate "${command.gateId}" is not open: this Mission is waiting on Gate "${open}"`,
    ]);
  }
  return unmodelled("decide-gate", state);
}

/* -------------------------------------------------------------------------------------------------
 * evolve
 * ---------------------------------------------------------------------------------------------- */

/**
 * Folds an Event into a Mission.
 *
 * **Total and deterministic.** Every Event applies to every state, and the same pair always produces
 * the same result. It never throws, so an Event that cannot apply — a `MissionOpened` on a Mission
 * that is already open, anything at all on a terminal one — leaves the state untouched rather than
 * blowing up in the middle of a Replay. Guarding transitions is `decide`'s job, and a log produced
 * by `decide` never contains one of those.
 *
 * The state is never mutated: every branch returns a new object.
 */
export function evolve(state: Mission, event: MissionEvent): Mission {
  switch (event.kind) {
    case "mission-opened":
      return isOpened(state) ? state : applyOpened(event);

    case "delegated":
      return state.status === "running" ? applyDelegated(state, event) : state;

    case "handoff-accepted":
      return state.status === "running" ? applyHandoffAccepted(state, event) : state;

    case "mission-halted":
      return state.status === "running" ? applyHalted(state, event) : state;

    case "mission-delivered":
      return state.status === "running" ? applyDelivered(state, event) : state;

    case "mission-killed":
      return state.status === "running" || state.status === "halted"
        ? applyKilled(state, event)
        : state;

    default:
      // Unreachable while every member of `MissionEvent` is handled above. `evolve` is total by
      // contract, so the impossible branch returns the state rather than throwing.
      exhausted(event);
      return state;
  }
}

function applyOpened(event: MissionOpened): RunningMission {
  return {
    status: "running",
    id: event.missionId,
    briefing: event.briefing,
    mode: event.mode,
    cap: event.cap,
    core: event.core,
    openedAt: event.occurredAt,
    delegations: [],
  };
}

/**
 * Records the Delegation the fact describes, **copying** the resolved Harness rather than resolving
 * anything.
 *
 * `evolve` derives state from Events and never re-runs a rule: if it called `resolveHarness` again,
 * folding the same log twice against a Catalog that had changed would produce two different states,
 * and the Replay would stop being a Replay.
 *
 * A second `Delegated` under an id the Mission already holds is ignored, the same way a second halt
 * leaves the first one standing. `decide` never produces one — it refuses it — but `evolve` is total
 * and folds whatever log it is handed, and appending a duplicate would make the fold depend on how
 * many copies of the fact the log happened to carry.
 */
function applyDelegated(state: RunningMission, event: Delegated): RunningMission {
  if (findDelegation(state, event.delegationId) !== undefined) {
    return state;
  }
  return {
    ...state,
    delegations: [
      ...state.delegations,
      {
        id: event.delegationId,
        zordId: event.zordId,
        slice: event.slice,
        harness: event.harness,
        contract: event.contract,
        delegatedAt: event.occurredAt,
      },
    ],
  };
}

/**
 * Settles the Delegation the accepted Handoff answered, by recording the Handoff on it.
 *
 * The `handoff` key is written **only** here, which is what makes its absence mean "open" rather than
 * "not filled in yet". No re-judgement: `decide` already validated this Handoff against the Contract
 * recorded on the Delegation, and a fold that re-runs a rule is not a fold — it would also make the
 * state depend on a `validateHandoff` that may have been tightened since the fact was written.
 *
 * A fact for a Delegation the Mission does not hold, or for one that is already answered, is ignored.
 * `decide` produces neither, but `evolve` is total and folds whatever log it is handed: overwriting on
 * the second one would make the state depend on how many copies of the fact the log happened to carry,
 * and the rule "a Delegation is answered once" would hold in `decide` and not in the fold.
 */
function applyHandoffAccepted(state: RunningMission, event: HandoffAccepted): RunningMission {
  const answered = findDelegation(state, event.delegationId);
  if (answered === undefined || !isOpenDelegation(answered)) {
    return state;
  }
  return {
    ...state,
    delegations: state.delegations.map((delegation) =>
      delegation.id === event.delegationId ? { ...delegation, handoff: event.handoff } : delegation,
    ),
  };
}

function applyHalted(state: RunningMission, event: MissionHalted): HaltedMission {
  return { ...openedFieldsOf(state), status: "halted", halt: event.halt };
}

function applyDelivered(state: RunningMission, event: MissionDelivered): DeliveredMission {
  return { ...openedFieldsOf(state), status: "delivered", delivery: event.delivery };
}

function applyKilled(state: RunningMission | HaltedMission, event: MissionKilled): KilledMission {
  return { ...openedFieldsOf(state), status: "killed", reason: event.reason };
}

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

/**
 * The exhaustiveness check, and the reason adding a Command or an Event without handling it fails
 * the build.
 *
 * Its parameter is `never`, so it accepts only a value the compiler has narrowed to nothing. Leave a
 * member of `MissionCommand` or `MissionEvent` unhandled and the `default` branch of that switch
 * still holds it, so this call stops compiling. A comment would not do that.
 *
 * It does not throw: both callers are contractually non-throwing, and blowing up in production over
 * a case the type system already proved impossible trades a compile-time guarantee for a runtime
 * crash. Each caller returns its own safe answer instead.
 *
 * Exported so a test can falsify the guarantee itself — widen this parameter and the probe in
 * `mission.test.ts` reports `TS2578`. It is not part of the engine's public surface in `index.ts`.
 */
export function exhausted(value: never): void {
  void value;
}

/** The Events this task accepts are built here, so `openMission` and `decide` cannot disagree. */
function missionOpenedFrom(fields: OpenMissionFields): MissionOpened {
  return {
    kind: "mission-opened",
    missionId: fields.missionId,
    occurredAt: fields.occurredAt,
    briefing: fields.briefing,
    mode: fields.mode,
    cap: fields.cap,
    core: fields.core,
  };
}

function accepted(events: readonly MissionEvent[]): Decision {
  return { kind: "accepted", events };
}

function refused(reason: RefusalReason, violations: readonly string[]): Decision {
  return { kind: "refused", refusal: { reason, violations } };
}

/**
 * Refuses a Command the lifecycle admits but whose rule is not modelled yet.
 *
 * Only the Gate decision is left: Task 4 replaced the `delegate` call with its accept path, Task 6
 * replaced the `submit-handoff` one, and each changed nothing else. Until Task 8 lands, the engine
 * refuses rather than inventing an accept path that would have to be rewritten — and a guessed
 * acceptance is exactly the drift this domain exists to prevent.
 *
 * `"illegal-transition"` is the truthful reason: the state machine has no such transition. When the
 * owning task adds one, it replaces this call with its accept path, and the Refusal stops being
 * reachable from the states that now admit the Command. Nothing else about this file changes.
 */
function unmodelled(kind: MissionCommand["kind"], state: Mission): Decision {
  return refused("illegal-transition", [
    `a Mission that is ${describe(state)} has no "${kind}" transition in this engine yet`,
  ]);
}

/** The Delegations a Mission remembers. None, before it was opened. */
function delegationsOf(state: Mission): readonly Delegation[] {
  return isOpened(state) ? state.delegations : [];
}

/**
 * The Delegation a Mission remembers under an id, or `undefined` when it made none.
 *
 * One lookup, shared by every rule that needs it: refusing a DelegationId that is already used,
 * refusing a Handoff for a Delegation that was never made, finding the Contract a Handoff is judged
 * against, refusing a second Handoff for an answered Delegation, and ignoring a duplicated `Delegated`
 * or `HandoffAccepted` while folding.
 */
function findDelegation(state: Mission, id: DelegationId): Delegation | undefined {
  return delegationsOf(state).find((delegation) => delegation.id === id);
}

/** The Capability a Core must hold to delegate. Typed against the registry, so a rename breaks here. */
const DELEGATE_CAPABILITY: OrchestrationCapabilityName = "delegate";

/**
 * Whether a Core holds a capability, decided by name.
 *
 * The brand on a Capability is phantom, so the name is the only thing that survives to runtime — the
 * same reason `assertNoExecution` matches on names. This does not re-check the Core invariant: a Core
 * is only constructible through `core()`, which already refused every executing capability, and
 * `decide` never throws.
 */
function holds(held: Core, capability: OrchestrationCapabilityName): boolean {
  return held.capabilities.some((granted) => granted.name === capability);
}

/** A Harness resolved from a Command's sources, or the reasons it cannot run. */
type ResolvedHarness =
  | { readonly kind: "resolved"; readonly harness: Harness }
  | { readonly kind: "unrunnable"; readonly violations: readonly string[] };

/**
 * Resolves a Harness without ever throwing, so `decide` keeps its promise.
 *
 * `resolveHarness` throws `InvalidHarnessError` on a bundle a Zord cannot be invoked with, and it can
 * still be reached: `catalogDefault` is a complete `Harness` *by type*, and `cli: ""` satisfies that
 * type while naming no CLI. `decide` is contractually non-throwing, so the throw is turned into the
 * Refusal it should always have been at this boundary.
 *
 * Anything else that comes out of the call is turned into the same Refusal rather than rethrown. The
 * alternative — rethrow what is not an `InvalidHarnessError` — would leave `decide` throwing on a path
 * nobody can enumerate, and "never throws" with an exception is not a contract a Surface can build on.
 */
function resolvedHarnessOf(sources: HarnessSources): ResolvedHarness {
  try {
    return { kind: "resolved", harness: resolveHarness(sources) };
  } catch (thrown) {
    return {
      kind: "unrunnable",
      violations: [
        thrown instanceof InvalidHarnessError
          ? thrown.message
          : `resolving the Harness of this Delegation failed: ${String(thrown)}`,
      ],
    };
  }
}

/**
 * What a Handoff broke, without ever throwing, so `decide` keeps its promise.
 *
 * `validateHandoff` is total for every Handoff and Contract the types describe, and it guards the three
 * lists it reads. What it deliberately does not do is parse *inside* those lists: a Contract whose
 * `clauses` hold something that is not a Clause — reachable only through a cast or a deserialiser — would
 * make it throw, and `decide` is contractually non-throwing.
 *
 * Same rule as `resolvedHarnessOf`: catch everything, rethrow nothing. A Contract nobody can read is
 * reported as the Contract violation it is, because the Handoff genuinely cannot be shown to honour it.
 *
 * What `decide` deliberately does **not** do is re-check the Contract when the Delegation is made. A
 * Contract is a value object with its own constructor, `contract()`, checked where it is built — exactly
 * like a `Briefing`, a `Slice` or a `Money` cap, none of which `decide` re-validates either. A Harness is
 * the one thing it checks, and only because `decide` is what *resolves* it, so the throw is its own to
 * catch.
 */
function contractViolationsOf(reference: Contract, submitted: Handoff): readonly string[] {
  try {
    return validateHandoff(reference, submitted);
  } catch (thrown) {
    return [
      `the Contract this Delegation was made against cannot be read, ` +
        `so this Handoff cannot be shown to honour it: ${String(thrown)}`,
    ];
  }
}

/** The Gate a Mission is waiting on, or `undefined` when none is open. */
function openGateOf(state: Mission): GateId | undefined {
  if (state.status === "halted" && state.halt.reason === "gate-open") {
    return state.halt.gateId;
  }
  return undefined;
}

/**
 * The state's shared fields, copied out by name.
 *
 * Spreading the whole state would carry a `halt` into a killed Mission — a field that state has no
 * business holding. Naming the fields keeps every state carrying only what it means.
 */
function openedFieldsOf(state: OpenedMission): OpenedFields {
  return {
    id: state.id,
    briefing: state.briefing,
    mode: state.mode,
    cap: state.cap,
    core: state.core,
    openedAt: state.openedAt,
    delegations: state.delegations,
  };
}

/** How a state reads inside a violation: `running`, `halted at Gate "gate-1"`, `delivered`. */
function describe(state: Mission): string {
  switch (state.status) {
    case "unopened":
      return "not open yet";
    case "running":
      return "running";
    case "halted":
      return state.halt.reason === "gate-open"
        ? `halted at Gate "${state.halt.gateId}"`
        : "halted because it reached its Cap";
    case "delivered":
      return "delivered";
    case "killed":
      return "killed";
    default:
      exhausted(state);
      return "in a state this engine does not recognise";
  }
}
