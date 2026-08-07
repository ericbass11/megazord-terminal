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
 * Every rule cluster the lifecycle refuses on behalf of a later task is now here. There is no
 * `unmodelled` helper any more: Task 3 shipped one, which refused `illegal-transition` for a Command the
 * lifecycle admitted but whose rule nobody had written yet, and Tasks 4, 6 and 8 each replaced exactly one
 * of its calls with an accept path. Task 8 replaced the last one, so the helper was removed — a function
 * with no callers is dead weight, and leaving it would invite the next task to reach for it instead of
 * modelling something.
 *
 * | Cluster                          | Task | State |
 * | -------------------------------- | ---- | ----- |
 * | Delegation mechanics             | 4    | here  |
 * | Harness resolution               | 5    | done  |
 * | Contract validation of a Handoff | 6    | here  |
 * | Cost accrual and Cap enforcement | 7    | here  |
 * | Gate, and the kill that ends a Mission | 8 | here |
 * | Replay projection                | 9    | `replay.ts` |
 *
 * A Delegation still carries no `status`, for the reason recorded under `Delegation` below, and neither
 * does a Gate: both are open exactly while nothing has answered them. What a Delegation does carry, since
 * Task 7, is `spent` — and the Mission carries one too: the field and the accrual that moves it arrived
 * together, which is why neither existed before. Task 8's `gates` arrived with `raise-gate` for the same
 * reason.
 */

import type { Core, OrchestrationCapabilityName } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
// A value import: `formatMoney` is how an amount reads inside a violation a human will see, and
// `ZERO_MONEY` is what a Meter starts from. Both are pure.
import { ZERO_MONEY, compareMoney, formatMoney, type Money } from "./money";
// A value import: the Cap boundary and the non-throwing arithmetic live in `meter.ts`, so no rule here
// can disagree with another about when a Cap is reached. It imports nothing from this file at runtime.
import { accrued, amountOf, hasReachedCap } from "./meter";
// A value import, unlike everything else here: `decide` calls `resolveHarness`. It is pure — no
// clock, no randomness, no I/O — so calling it keeps `decide` pure too. `harness.ts` imports nothing
// from this file, so there is no cycle to worry about.
import { InvalidHarnessError, resolveHarness, type Harness, type HarnessSources } from "./harness";
// A value import for the same reason: `decide` calls `validateHandoff`, which is pure and total and
// never throws. `contract.ts` imports nothing from this file.
import { validateHandoff, type Contract } from "./contract";
import type { Handoff } from "./handoff";
// A value import: `decisionOf` reads a Gate decision that may have arrived through a cast, and both
// `decide` and `evolve` consult it so they cannot disagree about what they will not record. `gate.ts`
// imports nothing from this file at runtime.
import { decisionOf, isOpenGate, type Gate } from "./gate";
import type {
  CapAuthorised,
  CostAccrued,
  Delegated,
  GateDecided,
  GateRaised,
  HandoffAccepted,
  Instant,
  MissionDelivered,
  MissionEvent,
  MissionHalted,
  MissionKilled,
  MissionOpened,
} from "./events";
import type {
  AccrueCost,
  AuthoriseCap,
  DecideGate,
  Delegate,
  DeliverMission,
  KillMission,
  MissionCommand,
  OpenMission,
  OpenMissionFields,
  RaiseGate,
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
 *
 * ## What this Pane cost
 *
 * `spent` is the per-Pane half of the Meter, and it lives here because the Delegation is the only thing
 * the domain can name that a Pane corresponds to — one Pane, one Zord, one Slice. A parallel map on the
 * Mission keyed by DelegationId was rejected: it could hold an id the Mission never delegated, and "what
 * was this Zord asked to do" and "what did it cost" would sit in two places that can disagree.
 *
 * It starts at zero and is moved by the accrual rule, which is why it did not exist before Task 7: a
 * field no rule updates is a lie whatever its value.
 */
export type Delegation = {
  readonly id: DelegationId;
  readonly zordId: ZordId;
  readonly slice: Slice;
  readonly harness: Harness;
  /** What this Delegation is answerable against, as agreed when it was made. */
  readonly contract: Contract;
  readonly delegatedAt: Instant;
  /** What this Pane has cost so far, in whole BRL cents. Zero until the first accrual. */
  readonly spent: Money;
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
 * with no meaning. The two halts are answered by different things — a Cap halt by an authorisation
 * that raises the Cap, a Gate halt by a Gate decision — which is the second reason they are not one
 * shape with a field that is sometimes there.
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
   * through a cast.
   *
   * **This file does not re-check the invariant, and that is a boundary rather than a guarantee.**
   * `Core` is a structural type with no brand, so `{ capabilities: [] }` satisfies it without ever
   * going through `core()`, and a Core deserialised by a Surface and cast into an `open-mission`
   * Command therefore enters the aggregate unchecked — a Mission can be led by a Core the type
   * system would have refused. Re-checking here is not available at the price `decide` pays for
   * everything else: `assertNoExecution` throws, `decide` never does, and refusing the Command
   * would need a Refusal reason this PRD's union does not carry. So the rule stands where it is
   * built, a Surface builds a Core with `core()`, and the alternative — branding `Core` so the
   * constructor is the only way in — is recorded as a finding of the review rather than decided
   * here. What this file does guarantee is that reading the set never *throws*: see `holds`.
   */
  readonly core: Core;
  readonly openedAt: Instant;
  readonly delegations: readonly Delegation[];
  /**
   * What this Mission has spent in total, in whole BRL cents. The per-Mission half of the Meter.
   *
   * It is the sum of what its Delegations spent — every accrual names one — and it is folded here as
   * well as onto the Delegation rather than summed on demand, because the Cap comparison must never
   * throw: `addMoney` does, past the exactly-representable range, and summing a list on every read
   * would put that throw inside `decide`. Both copies are written in one place, by one rule, from the
   * same fact, so they cannot drift; `meter.test.ts` pins that they agree.
   */
  readonly spent: Money;
  /**
   * The Gates this Mission raised, in the order it raised them, each carrying the answer it got.
   *
   * The **record** of what was asked and answered — not a queue of pending checkpoints. What makes a Gate
   * block is the halt on the Mission (`halt.reason === "gate-open"`), and at most one Gate is ever open
   * because raising one halts the Mission and a halted Mission raises none. See `gate.ts` for why
   * concurrent Gates were rejected rather than forgotten.
   *
   * It is here rather than only in the Event log because a revision reason has to be *readable* by
   * whoever resumes: "revise with a reason" is theatre if the reason only exists in a fold nobody has
   * run. `revisionsIn` is that reading.
   */
  readonly gates: readonly Gate[];
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
    case "accrue-cost":
      return decideAccrueCost(state, command);
    case "authorise-cap":
      return decideAuthoriseCap(state, command);
    case "raise-gate":
      return decideRaiseGate(state, command);
    case "decide-gate":
      return decideDecideGate(state, command);
    case "kill-mission":
      return decideKillMission(state, command);
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

/**
 * Consolidates the Mission into its Delivery.
 *
 * Refused at the Cap like every other commissioning Command, and that is a decision rather than an
 * oversight: consolidating is not free. A Core reading every Handoff and writing the Delivery spends
 * tokens, so a Mission that concluded itself while stopped at its Cap would spend money nobody
 * authorised — and the halt would not be a halt if the Mission could still perform its one terminal
 * transition. A human who wants a Mission at its Cap to end either authorises enough Cap to consolidate
 * it, or kills it — `kill-mission`, which Task 8 added for exactly this dead end.
 */
function decideDeliverMission(state: Mission, command: DeliverMission): Decision {
  if (state.status !== "running" || stoppedAtCap(state)) {
    const blocked = stateBlock(state, "cannot be delivered");
    return refused(blocked.reason, [blocked.violation]);
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
 * 1. **The Mission must be running, and not stopped at its Cap.** A Mission that is halted, over or not
 *    open yet admits no Delegation. Refused `illegal-transition` — except when what stops it is the Cap,
 *    which is refused `cap-reached`: see `stateBlock`.
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

  if (state.status !== "running" || stoppedAtCap(state)) {
    const blocked = stateBlock(
      state,
      `admits no Delegation, so Zord "${command.zordId}" cannot be given one`,
    );
    // The used id is still reported beside the state: a Command can be wrong in more than one way at
    // once, and the Cap being the headline does not make the second problem go away.
    return refused(blocked.reason, [blocked.violation, ...alreadyUsed]);
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
 * The glossary says a Replay includes what was refused, and this file still does not deliver that —
 * because **it is not this file's to deliver.** Task 9 answered the question it left open, and it took the
 * second of the two shapes: the Replay is the sequence of **Decisions** (`replay.ts`), so a Refusal is
 * recorded where it is returned, and neither `Decision` nor `evolve` had to change. The rejected shape —
 * a `refused` member carrying facts — is argued at the head of `replay.ts`, and the decisive reason is
 * visible from here: `decide(UNOPENED_MISSION, command)` refuses with no Mission in existence, so some
 * refusals could never have been written as facts at all.
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
  const admissible = state.status === "running" && !stoppedAtCap(state);
  const delegation = findDelegation(state, submitted.delegationId);

  // Checked before the state, so the narrowing below is the compiler's and not a cast — and reported
  // after it, so the violations read state first, as they did before this rule existed.
  if (delegation === undefined) {
    const unknown =
      `Delegation "${submitted.delegationId}" was never made in this Mission, ` +
      `so there is nothing to hand off`;
    if (admissible) {
      return refused("illegal-transition", [unknown]);
    }
    const blocked = stateBlock(state, "admits no Handoff");
    return refused(blocked.reason, [blocked.violation, unknown]);
  }
  // The same condition as the one behind `admissible`, written out again rather than read off it: an
  // aliased check does not narrow, and `state.id` below has to be the compiler's knowledge, not a cast.
  if (state.status !== "running" || stoppedAtCap(state)) {
    const blocked = stateBlock(state, "admits no Handoff");
    return refused(blocked.reason, [blocked.violation]);
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

/**
 * Records what a Zord spent against one Delegation, and halts the Mission when that reaches the Cap.
 *
 * ## Recorded, then halted — never refused for crossing
 *
 * The accrual that crosses the Cap is **accepted**, and the halt is the second Event of the same
 * Decision. The money was already spent by the runtime before anybody told the domain about it:
 * refusing to record it would not un-spend it, it would only make the Meter understate what the Mission
 * cost — and the Cap is compared against that total, so an understated total means a Mission that stops
 * late, or never. `Decision`'s accepted member carries a list of Events for exactly this: one Command,
 * two facts, in the order they happened.
 *
 * ## The one Command a Mission at its Cap still accepts
 *
 * An accrual is a report of the past, not an intent to spend, so the halt does not stop it: a Zord that
 * was mid-run when the Cap was reached — which is how the Cap gets reached at all — keeps reporting, and
 * the Meter keeps telling the truth about what the Mission cost. It does not halt a Mission that is
 * already halted: `evolve` keeps the first halt, so a second `MissionHalted` would be a fact that folds
 * to nothing, which is the same lie as an always-zero field. So the halt Event is produced only from
 * `running`, the one state where halting is a real transition.
 *
 * ## What it refuses, and why those are not the same case
 *
 * - **A Command carrying no amount this domain can record.** The first Command in the engine that does
 *   *arithmetic* with a required field, so a `cost` forced past the compiler would reach `addMoney` and
 *   throw where `decide` promised not to. Refused `illegal-transition`, like Task 6's Handoff-less
 *   `submit-handoff`.
 * - **A Mission that is not open yet, or is over.** A terminal Mission has no Zord left running — they
 *   die after delivering — so there is no in-flight spend to report, and recording one would change what
 *   a closed Mission cost after the fact. Refused `illegal-transition`.
 * - **A Delegation this Mission never made.** Per-Pane accounting has nowhere to put it, and the Mission
 *   cannot attribute money to a Pane it never opened. Refused `illegal-transition`, state first when both
 *   are wrong, exactly as a Handoff for an unknown Delegation is.
 * - **A total that would stop being exactly representable.** Refused `cap-reached`: a total past
 *   `Number.MAX_SAFE_INTEGER` cents is beyond any Cap a Mission could have been opened with, so the Cap
 *   has certainly been reached — and the domain cannot record the amount truthfully either way.
 */
function decideAccrueCost(state: Mission, command: AccrueCost): Decision {
  const cost = amountOf(command.cost);
  if (cost === undefined) {
    return refused("illegal-transition", [
      `an accrual reports what a Zord spent, so an accrue-cost Command must carry a cost in whole ` +
        `BRL cents, and this one does not`,
    ]);
  }

  const spendable = isOpened(state) && (state.status === "running" || state.status === "halted");
  const delegation = findDelegation(state, command.delegationId);
  const wrongState = spendable ? [] : [`a Mission that is ${describe(state)} accrues no cost`];

  if (delegation === undefined) {
    return refused("illegal-transition", [
      ...wrongState,
      `Delegation "${command.delegationId}" was never made in this Mission, ` +
        `so there is nothing to charge the cost to`,
    ]);
  }
  // Written out again rather than read off `spendable`: an aliased check does not narrow, and `state.id`
  // below has to be the compiler's knowledge.
  if (!isOpened(state) || (state.status !== "running" && state.status !== "halted")) {
    return refused("illegal-transition", wrongState);
  }

  const total = accrued(state.spent, cost);
  if (total === undefined) {
    return refused("cap-reached", [
      `accruing ${formatMoney(cost)} on top of ${formatMoney(state.spent)} would exceed the largest ` +
        `amount this domain can record exactly, so it is past any Cap`,
    ]);
  }

  const accrual: CostAccrued = {
    kind: "cost-accrued",
    missionId: state.id,
    occurredAt: command.occurredAt,
    delegationId: command.delegationId,
    cost,
  };
  if (state.status === "running" && hasReachedCap(total, state.cap)) {
    const halt: MissionHalted = {
      kind: "mission-halted",
      missionId: state.id,
      occurredAt: command.occurredAt,
      halt: { reason: "cap-reached" },
    };
    return accepted([accrual, halt]);
  }
  return accepted([accrual]);
}

/**
 * Authorises a Mission stopped at its Cap to carry on, at a new Cap.
 *
 * **This is the exit Task 3 deliberately left off `halted`.** A Cap halt is answered by money and a Gate
 * halt is answered by a Gate decision (Task 8); a Mission halted at a Gate is therefore refused here,
 * because raising a Cap does not answer a question a human was asked about the work.
 *
 * ## Authorising raises the Cap. It cannot merely permit continuing
 *
 * Resuming at the same Cap would resume a Mission whose limit is still reached, so the very next
 * commissioning Command would be refused `cap-reached` again and the authorisation would have changed
 * nothing at all — "the Mission stops and asks for authorisation" would be a loop instead of a question.
 * So the Command carries a new Cap, and it must be **strictly above what was already spent**: at or below
 * it, the Mission would resume already stopped, which is why that is refused `cap-reached` rather than
 * accepted as a no-op. The question a human is answering is not "carry on?" but "how much more?".
 *
 * ## What it does not do
 *
 * It does not touch `spent`. The money is gone; there is nothing to give back, and `money.ts` has no
 * subtraction for the domain to reach for. Raising the Cap is the whole of the change, which is why a
 * Replay of the two amounts still adds up afterwards.
 *
 * It is also **not** a way to edit a Mission's budget mid-flight. On a Mission the Cap is not stopping,
 * it is refused: revising a Cap that nothing has reached is a different act, with a different rule
 * (who may lower it, and what happens to work already commissioned), and this PRD models none of that.
 */
function decideAuthoriseCap(state: Mission, command: AuthoriseCap): Decision {
  const raised = amountOf(command.cap);
  if (raised === undefined) {
    return refused("illegal-transition", [
      `an authorisation sets a new Cap, so an authorise-cap Command must carry one in whole BRL ` +
        `cents, and this one does not`,
    ]);
  }
  if (!isOpened(state) || !stoppedAtCap(state)) {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} is waiting on no Cap authorisation`,
    ]);
  }
  if (compareMoney(raised, state.spent) <= 0) {
    return refused("cap-reached", [
      `a Cap of ${formatMoney(raised)} is already spent by a Mission that has spent ` +
        `${formatMoney(state.spent)}, so authorising it would authorise nothing`,
    ]);
  }

  const authorised: CapAuthorised = {
    kind: "cap-authorised",
    missionId: state.id,
    occurredAt: command.occurredAt,
    cap: raised,
  };
  return accepted([authorised]);
}

/**
 * Raises a Gate: stops the Mission, and records the question a human is being asked.
 *
 * Two facts, in one Decision: the `GateRaised` that records the question, and the `MissionHalted` that
 * stops the Mission at it. The same shape an accrual that reaches the Cap produces, and for the same
 * reason — halting is one fact kind whatever caused it, so the fold has one place where a Mission stops.
 *
 * Three rules:
 *
 * 1. **The question must say something.** A Gate that asks nothing stops the Mission for no stated
 *    purpose, and the human it wakes up has nothing to answer. Refused `illegal-transition`, like Task 6's
 *    Handoff-less `submit-handoff` and Task 7's cost-less `accrue-cost`.
 * 2. **The GateId must be free.** Two Gates under one id cannot be folded deterministically, and an answer
 *    naming that id could not say which question it answered. Refused `illegal-transition`, exactly as a
 *    reused DelegationId is.
 * 3. **The Mission must be running.** A Mission that is already stopped is already waiting for a human, and
 *    raising a Gate on it would replace one question with another — the Cap halt would vanish and the
 *    money nobody authorised would never be asked about again. A terminal Mission has nothing left to
 *    stop.
 *
 * **The Cap is deliberately not consulted.** `stoppedAtCap` guards the Commands that *commission* work;
 * raising a Gate commissions nothing and spends nothing, so a running Mission that has spent its whole Cap
 * may still be stopped and asked a question. That is also why a Cap-halted Mission is refused
 * `illegal-transition` here rather than `cap-reached`: what stands in the way is that the Mission is
 * already stopped, not the Cap — and Task 7's rule is that `cap-reached` is right only when the Cap is what
 * stands in the way.
 */
function decideRaiseGate(state: Mission, command: RaiseGate): Decision {
  const question = saidOf(command.question);
  if (question === undefined) {
    return refused("illegal-transition", [
      `a Gate stops the Mission to ask a human something, so a raise-gate Command must carry the ` +
        `question it asks, and this one does not`,
    ]);
  }

  const alreadyUsed =
    findGate(state, command.gateId) === undefined
      ? []
      : [
          `Gate "${command.gateId}" was already raised in this Mission, ` +
            `and a Mission raises each one once`,
        ];

  if (state.status !== "running") {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} raises no Gate`,
      ...alreadyUsed,
    ]);
  }
  if (alreadyUsed.length > 0) {
    return refused("illegal-transition", alreadyUsed);
  }

  const raised: GateRaised = {
    kind: "gate-raised",
    missionId: state.id,
    occurredAt: command.occurredAt,
    gateId: command.gateId,
    question,
  };
  const halt: MissionHalted = {
    kind: "mission-halted",
    missionId: state.id,
    occurredAt: command.occurredAt,
    halt: { reason: "gate-open", gateId: command.gateId },
  };
  return accepted([raised, halt]);
}

/**
 * Answers the Gate the Mission is waiting on, and lets it go on.
 *
 * Both answers resume the Mission, and they differ only in what is recorded:
 *
 * - **approve** — it carries on as it was.
 * - **revise, with a reason** — it carries on too, with the reason on the record. It has to resume, or
 *   nothing could act on the reason; and the reason is context, not a new Briefing, because a Mission is
 *   opened once from one Briefing and rewriting it would erase what the Mission was for. `revisionsIn` is
 *   how whoever resumes reads what it was told.
 *
 * Four rules, and the first two are Task 3's, unchanged:
 *
 * 1. **A Gate must be open**, which is the halt saying so. Refused `illegal-transition` — and *not*
 *    `cap-reached` on a Mission stopped at its Cap, which Task 7 argued and this task keeps: a Cap halt
 *    carries no GateId, so there is genuinely no Gate to decide, and answering "the Cap" would send a
 *    human to the wrong remedy.
 * 2. **It must be the Gate this Command names.** An answer that applied to whatever the Mission happened
 *    to be waiting on would let a human approve a question they never read.
 * 3. **The Mission must hold that Gate, open.** The halt and the `gates` record have to agree; when they do
 *    not, only a hand-written log put them that way, and `evolve` would have nowhere to record the answer.
 * 4. **The decision must be one this domain can record.** Checked after the three above, because those are
 *    about *which* Gate and this is about the answer: read through `decisionOf`, which never throws and
 *    which `evolve` consults too, so a decision one of them would drop is dropped by both.
 *
 * Killing is not here: it ends the Mission rather than answering the question, and it is a Command of its
 * own for the reasons in `KillMission`. A killed Mission leaves its Gate unanswered, which is the truth.
 */
function decideDecideGate(state: Mission, command: DecideGate): Decision {
  // "A Gate is open" is the halt saying so, and the condition is written out here rather than read off a
  // helper: an aliased compound check does not narrow, and `state.id` below has to be the compiler's
  // knowledge rather than a cast. Task 3 could afford the helper because its refusal path never touched
  // the state; the accept path does.
  if (state.status !== "halted" || state.halt.reason !== "gate-open") {
    return refused("illegal-transition", [
      `no Gate is open on a Mission that is ${describe(state)}, ` +
        `so Gate "${command.gateId}" cannot be decided`,
    ]);
  }
  if (state.halt.gateId !== command.gateId) {
    return refused("illegal-transition", [
      `Gate "${command.gateId}" is not open: ` +
        `this Mission is waiting on Gate "${state.halt.gateId}"`,
    ]);
  }
  // The halt and the record have to agree, and this is what makes them. A halt naming a Gate the Mission
  // never raised — or one it already answered — is reachable only from a hand-written log, and `evolve` has
  // nowhere to put the answer, so accepting it here would produce a Decision the fold drops on the floor.
  // `decide` and `evolve` refusing the same thing is what keeps a fold equal to the sequence of Decisions
  // that produced it, and it is why the record is load-bearing rather than decorative.
  const open = findGate(state, command.gateId);
  if (open === undefined || !isOpenGate(open)) {
    return refused("illegal-transition", [
      `Gate "${command.gateId}" is not recorded as open on this Mission, so there is nothing to decide`,
    ]);
  }

  const decision = decisionOf(command.decision);
  if (decision === undefined) {
    return refused("illegal-transition", [
      `a Gate is decided by approving it or by asking for a revision that says why, ` +
        `and this decide-gate Command carries neither`,
    ]);
  }

  const decided: GateDecided = {
    kind: "gate-decided",
    missionId: state.id,
    occurredAt: command.occurredAt,
    gateId: command.gateId,
    decision,
  };
  return accepted([decided]);
}

/**
 * Ends the Mission with no Delivery.
 *
 * ## The exit a Mission stopped at its Cap did not have
 *
 * Task 7 left a Cap halt exactly one way out — an authorisation that raises the Cap — so a human who did
 * not want to spend more had nothing to say. This is the other answer to "how much more?": none, and stop.
 * It is therefore accepted on a **halted** Mission whichever halt stopped it, and on a running one, which
 * is what makes a Mission that is delegating and spending stoppable at all.
 *
 * That makes two Commands a Mission stopped at its Cap still accepts, for opposite reasons, and the pair is
 * coherent: `accrue-cost` because the money is already gone and refusing the report would only make the
 * Meter lie, and `kill-mission` because ending the Mission spends nothing. Neither commissions work, which
 * is the line `stoppedAtCap` draws — and it is why the Cap is not consulted here at all.
 *
 * ## What it refuses
 *
 * - **A Command carrying no reason.** "Why did this stop" is the one question a Replay of a killed Mission
 *   exists to answer. Refused `illegal-transition`.
 * - **A Mission that is not open yet, or already over.** There is nothing to end, and a second kill would
 *   only rewrite why the first one happened. Refused `illegal-transition` — the Cap is not what blocks it,
 *   and neither is a Gate.
 */
function decideKillMission(state: Mission, command: KillMission): Decision {
  const reason = saidOf(command.reason);
  if (reason === undefined) {
    return refused("illegal-transition", [
      `ending a Mission with no Delivery is worth recording, so a kill-mission Command must carry ` +
        `the reason it was ended for, and this one does not`,
    ]);
  }
  if (state.status !== "running" && state.status !== "halted") {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} cannot be killed`,
    ]);
  }

  const killed: MissionKilled = {
    kind: "mission-killed",
    missionId: state.id,
    occurredAt: command.occurredAt,
    reason,
  };
  return accepted([killed]);
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

    // Folded on a halted Mission as well as on a running one: a Zord that was mid-run when the Mission
    // stopped keeps reporting what it spent, and the Meter has to keep telling the truth about it. A
    // terminal Mission is ignored — nothing is running in it any more.
    case "cost-accrued":
      return state.status === "running" || state.status === "halted"
        ? applyCostAccrued(state, event)
        : state;

    case "cap-authorised":
      return state.status === "running" || state.status === "halted"
        ? applyCapAuthorised(state, event)
        : state;

    // A Gate is raised on a running Mission and nothing else. The halt that stops it is the other fact of
    // the same Decision, so this one only records the question.
    case "gate-raised":
      return state.status === "running" ? applyGateRaised(state, event) : state;

    case "gate-decided":
      return state.status === "halted" ? applyGateDecided(state, event) : state;

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
    spent: ZERO_MONEY,
    gates: [],
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
        spent: ZERO_MONEY,
      },
    ],
  };
}

/**
 * Charges an accrual to the Delegation it names, and to the Mission's total.
 *
 * Both amounts move here, in one place, from one fact — which is what keeps the Mission's total equal to
 * the sum of its Panes. Nothing is re-derived and nothing is compared against the Cap: halting is
 * `decide`'s judgement, recorded as its own fact, and a fold that decided things for itself would let the
 * same log fold to two different states as the rule changed.
 *
 * Three facts are ignored rather than applied, because `evolve` is total and folds whatever log it is
 * handed while `decide` produces none of them:
 *
 * - an accrual for a Delegation this Mission never made — there is no Pane to charge it to;
 * - an accrual whose amount is not one this domain can record;
 * - an accrual that would push either total past the exactly-representable range. `decide` refuses that
 *   one, so the two agree, and a fold stays equal to the sequence of Decisions that produced it.
 */
function applyCostAccrued(
  state: RunningMission | HaltedMission,
  event: CostAccrued,
): RunningMission | HaltedMission {
  const charged = findDelegation(state, event.delegationId);
  if (charged === undefined) {
    return state;
  }
  const cost = amountOf(event.cost);
  if (cost === undefined) {
    return state;
  }

  const total = accrued(state.spent, cost);
  const pane = accrued(charged.spent, cost);
  if (total === undefined || pane === undefined) {
    return state;
  }

  const metered: OpenedFields = {
    ...openedFieldsOf(state),
    spent: total,
    delegations: state.delegations.map((delegation) =>
      delegation.id === event.delegationId ? { ...delegation, spent: pane } : delegation,
    ),
  };
  // Written out per state rather than spread over the union, so neither state ends up carrying what it
  // has no business carrying — the same reason `openedFieldsOf` exists.
  return state.status === "running"
    ? { ...metered, status: "running" }
    : { ...metered, status: "halted", halt: state.halt };
}

/**
 * Raises the Cap the fact names, and resumes a Mission that was halted because it reached it.
 *
 * `spent` is untouched: the money was spent, there is nothing to give back, and the model has no
 * subtraction to reach for. One authorisation, one change — the Cap.
 *
 * A Mission halted at a **Gate** is left alone: that halt is answered by a Gate decision (Task 8), and
 * resuming it here would silently discard a question a human was asked. `decide` refuses to produce this
 * fact there; the fold refuses to apply it, so a hand-written log cannot bypass the rule either.
 */
function applyCapAuthorised(
  state: RunningMission | HaltedMission,
  event: CapAuthorised,
): RunningMission | HaltedMission {
  if (state.status === "halted" && state.halt.reason !== "cap-reached") {
    return state;
  }
  const raised = amountOf(event.cap);
  if (raised === undefined) {
    return state;
  }
  return { ...openedFieldsOf(state), cap: raised, status: "running" };
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

/**
 * Records the Gate the fact describes, still open.
 *
 * Two facts are ignored rather than applied, because `evolve` is total and folds whatever log it is handed
 * while `decide` produces neither: a second Gate under an id the Mission already holds — the same rule
 * `applyDelegated` follows, so the fold cannot depend on how many copies of a fact the log carried — and a
 * Gate whose question says nothing, which `decide` refuses, so the two agree.
 *
 * It does not halt the Mission. The `MissionHalted` beside it does, which is what keeps every halt in one
 * place in the fold.
 */
function applyGateRaised(state: RunningMission, event: GateRaised): RunningMission {
  if (findGate(state, event.gateId) !== undefined) {
    return state;
  }
  const question = saidOf(event.question);
  if (question === undefined) {
    return state;
  }
  return {
    ...state,
    gates: [...state.gates, { id: event.gateId, question, raisedAt: event.occurredAt }],
  };
}

/**
 * Records the answer on the Gate it answers, and returns the Mission to running.
 *
 * One fact, two changes, in one place — the arrangement `applyCapAuthorised` uses for the Cap halt, and the
 * reason a decided Gate cannot end up recorded on a Mission that is still stopped.
 *
 * It applies **only** to the Gate halt this Mission is actually waiting on, and it re-checks the decision
 * through `decisionOf`. Three facts are therefore ignored, and each of them is a way a hand-written log
 * could otherwise walk a Mission somewhere `decide` would never take it:
 *
 * - a decision for a Gate that is not the open one, or on a Mission halted at its **Cap** — a Cap halt is
 *   answered by money, and this is the mirror of `applyCapAuthorised` leaving a Gate halt alone;
 * - a decision for a Gate that was already answered, which would let the second answer overwrite the first;
 * - a decision this domain cannot record, which `decide` refuses too.
 */
function applyGateDecided(
  state: HaltedMission,
  event: GateDecided,
): RunningMission | HaltedMission {
  if (state.halt.reason !== "gate-open" || state.halt.gateId !== event.gateId) {
    return state;
  }
  const answered = findGate(state, event.gateId);
  if (answered === undefined || !isOpenGate(answered)) {
    return state;
  }
  const decision = decisionOf(event.decision);
  if (decision === undefined) {
    return state;
  }

  return {
    ...openedFieldsOf(state),
    gates: state.gates.map((gate) => (gate.id === event.gateId ? { ...gate, decision } : gate)),
    status: "running",
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
 * Reads a required piece of text without trusting its type, answering `undefined` when it says nothing.
 *
 * The same threat model and the same shape as `amountOf` in `meter.ts` and `decisionOf` in `gate.ts`: a
 * `string` field can arrive blank from a human, or as something that is not a string at all through a cast
 * or a `JSON.parse`, and `decide` and `evolve` are both contractually non-throwing. Three fields go
 * through it — a Gate's question, and the reason on a kill — and the two callers do the truthful thing with
 * the `undefined`: `decide` refuses, `evolve` ignores.
 *
 * Blankness is refused for the reason `briefing()` and `slice()` refuse it: a question nobody can read
 * stops a Mission for nothing, and a kill with no reason is the one fact a killed Mission's Replay is read
 * for. Neither is trimmed — what a human wrote is what is recorded.
 */
function saidOf(claimed: string): string | undefined {
  const value: unknown = claimed;
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
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

/** The Gates a Mission remembers. None, before it was opened. */
function gatesOf(state: Mission): readonly Gate[] {
  return isOpened(state) ? state.gates : [];
}

/**
 * The Gate a Mission remembers under an id, or `undefined` when it raised none.
 *
 * One lookup, shared by the rule that refuses a reused GateId and the folds that record an answer or ignore
 * a duplicated `GateRaised`. It is **not** what decides whether a Gate is open: that is the halt, so a
 * Gate answered while the Mission was somehow not halted cannot be answered twice by two different
 * readings.
 */
function findGate(state: Mission, id: GateId): Gate | undefined {
  return gatesOf(state).find((gate) => gate.id === id);
}

/** The Capability a Core must hold to delegate. Typed against the registry, so a rename breaks here. */
const DELEGATE_CAPABILITY: OrchestrationCapabilityName = "delegate";

/**
 * Whether a Core holds a capability, decided by name.
 *
 * The brand on a Capability is phantom, so the name is the only thing that survives to runtime — the
 * same reason `assertNoExecution` matches on names. This does not re-check the Core invariant, for the
 * reason recorded on `OpenedFields.core`; what it does is refuse to throw while reading it.
 *
 * **It reads the set as `unknown` first.** This is the third grade of cast-tolerance `CLAUDE.md`
 * records — the value is *dereferenced*, not copied — and `core` is the one required field of
 * `open-mission` that a rule reaches into. A Surface that deserialised a payload and cast it would
 * otherwise reach `undefined.some` here and throw where `decide` promised not to, so a Core nobody can
 * read holds nothing, and the Command is refused `missing-capability` with the violation that already
 * exists. `decide` refusing is the truthful answer: a Core whose permissions cannot be read cannot be
 * shown to have the one it needs.
 */
function holds(held: Core, capability: OrchestrationCapabilityName): boolean {
  const granted: unknown = held?.capabilities;
  if (!Array.isArray(granted)) {
    return false;
  }
  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const capabilities: readonly unknown[] = granted;
  return capabilities.some(
    (each) =>
      typeof each === "object" && each !== null && "name" in each && each.name === capability,
  );
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

/**
 * Whether the **Cap** is what is stopping this Mission.
 *
 * Two states qualify, and they are not the same thing:
 *
 * - **halted because it reached its Cap** — the halt the accrual rule produces, whatever the amounts on
 *   the state say. A log written by hand can halt a Mission at its Cap without any accrual behind it, and
 *   the Mission is still stopped by its Cap: the halt is the fact, not the arithmetic.
 * - **running with its whole Cap spent** — reachable two ways, neither hypothetical. A Mission opened
 *   with a Cap of zero has nothing to spend from the start, and a Mission whose Gate halt is approved
 *   (Task 8) resumes with whatever it spent while stopped. Both must refuse to commission work, or the
 *   Cap would be enforceable only through the halt and a Mission could walk around it.
 *
 * A Mission halted at a **Gate** is deliberately not included, even when its Meter has passed the Cap: the
 * Gate is the nearer question, and a Gate is not answered with money. Once a Gate decision resumes it, the
 * second case above catches it on the next Command — `gate.test.ts` proves that hand-over.
 *
 * This is the one predicate `cap-reached` refusals and `authorise-cap` both consult, so what the Cap
 * blocks and what an authorisation unblocks cannot drift apart.
 */
function stoppedAtCap(state: Mission): boolean {
  if (state.status === "halted") {
    return state.halt.reason === "cap-reached";
  }
  if (state.status === "running") {
    return hasReachedCap(state.spent, state.cap);
  }
  return false;
}

/** How a Mission stopped at its Cap reads inside a violation, truthfully for either way it got there. */
function atCap(state: Mission): string {
  return state.status === "running"
    ? `a Mission that has spent its whole Cap of ${formatMoney(state.cap)}`
    : "a Mission that is halted because it reached its Cap";
}

/** Why a Mission's own state refuses a Command: the reason to report, and the violation that says it. */
type StateBlock = {
  readonly reason: RefusalReason;
  readonly violation: string;
};

/**
 * The Refusal a Mission's state produces for a Command it does not admit, given how the Command reads —
 * `"admits no Delegation, so Zord \"x\" cannot be given one"`, `"admits no Handoff"`, `"cannot be
 * delivered"`.
 *
 * One place, so the three commissioning Commands cannot disagree about which state refuses what. The Cap
 * is checked first and reported as `cap-reached`, because that is the reason a human can act on: it names
 * the Cap and names the remedy, where `illegal-transition` would truthfully say "this transition does not
 * exist" and leave the reader to guess that authorising the Cap is what brings it back. It is the same
 * judgement Task 4 made adding `unrunnable-harness` — a wrong reason on a Refusal is worse than a right
 * one — except that here no new reason is needed: `cap-reached` has been in the union since the techspec
 * and this is its first user.
 *
 * Called only where the state genuinely blocks the Command; on a running Mission under its Cap it would
 * produce a sentence about nothing, the same way `openedFieldsOf` would on an unopened one.
 */
function stateBlock(state: Mission, admits: string): StateBlock {
  if (stoppedAtCap(state)) {
    return {
      reason: "cap-reached",
      violation: `${atCap(state)} ${admits} until its Cap is authorised`,
    };
  }
  return {
    reason: "illegal-transition",
    violation: `a Mission that is ${describe(state)} ${admits}`,
  };
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
    spent: state.spent,
    gates: state.gates,
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
