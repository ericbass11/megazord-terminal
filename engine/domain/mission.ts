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
 * This file delivers the lifecycle skeleton. Three rule clusters are deliberately absent and are
 * refused rather than guessed at — see `unmodelled` below:
 *
 * | Cluster                          | Task |
 * | -------------------------------- | ---- |
 * | Delegation mechanics             | 4    |
 * | Harness resolution               | 5    |
 * | Contract validation of a Handoff | 6    |
 * | Cost accrual and Cap enforcement | 7    |
 * | Gate decisions                   | 8    |
 * | Replay projection                | 9    |
 *
 * Consequently there is no `spent` on the state and no `cost-accrued` Event: an always-zero field
 * that no rule updates would be a lie, and Task 7 adds both together with the accrual that moves
 * them.
 */

import type { Core } from "./capability";
import type { DelegationId, GateId, MissionId, ZordId } from "./ids";
import type { Money } from "./money";
import type {
  Delegated,
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
 * The assignment of a slice of a Mission to a Zord, as the Mission remembers it.
 *
 * Identity only, for now: it is what makes "a Handoff for a Delegation that was never made"
 * answerable. Task 4 adds the slice and the resolved Harness.
 */
export type Delegation = {
  readonly id: DelegationId;
  readonly zordId: ZordId;
  readonly delegatedAt: Instant;
};

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

/** Why a Command was refused. */
export const REFUSAL_REASONS = [
  "illegal-transition",
  "contract-violation",
  "cap-reached",
  "missing-capability",
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

function decideDelegate(state: Mission, command: Delegate): Decision {
  if (state.status !== "running") {
    return refused("illegal-transition", [
      `a Mission that is ${describe(state)} admits no Delegation, ` +
        `so Zord "${command.zordId}" cannot be given one`,
    ]);
  }
  return unmodelled("delegate", state);
}

function decideSubmitHandoff(state: Mission, command: SubmitHandoff): Decision {
  const violations: string[] = [];

  if (state.status !== "running") {
    violations.push(`a Mission that is ${describe(state)} admits no Handoff`);
  }
  if (!delegationsOf(state).some((delegation) => delegation.id === command.delegationId)) {
    violations.push(
      `Delegation "${command.delegationId}" was never made in this Mission, ` +
        `so there is nothing to hand off`,
    );
  }

  if (violations.length > 0) {
    return refused("illegal-transition", violations);
  }
  return unmodelled("submit-handoff", state);
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

function applyDelegated(state: RunningMission, event: Delegated): RunningMission {
  return {
    ...state,
    delegations: [
      ...state.delegations,
      { id: event.delegationId, zordId: event.zordId, delegatedAt: event.occurredAt },
    ],
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
 * Delegation is Task 4, the Contract validation of a Handoff is Task 6, the Gate decision is Task 8.
 * Until one of those lands, the engine refuses rather than inventing an accept path that would have
 * to be rewritten — and a guessed acceptance is exactly the drift this domain exists to prevent.
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
