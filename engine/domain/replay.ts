/**
 * The Replay: what a Mission was asked, what the domain answered, and the state that follows from it.
 *
 * Two readings of one history, and the difference between them is the whole of this module:
 *
 * ```
 * replay(events)   -> Mission                 // the fold. State is the Events and nothing else.
 * stepsOf(replay)  -> readonly Step[]         // the audit surface. Includes what was refused.
 * ```
 *
 * `replay` is `events.reduce(evolve, UNOPENED_MISSION)` and deliberately nothing more. It is not a
 * feature: it is the property the whole design exists for, that a Mission folded from its log is the
 * Mission that was built Command by Command. Nothing here re-decides, re-resolves or re-judges
 * anything — see `evolve` in `mission.ts` for why a fold that re-runs a rule is not a fold.
 *
 * Pure, total and deterministic, like everything in `engine/domain`: no clock, no ids, no randomness,
 * no I/O. Time arrives on the Commands the Replay records.
 *
 * ## The Replay is the sequence of Decisions, not the Event log
 *
 * Criterion 7 says the Replay contains every delegation, **refusal**, gate decision and cost. A
 * Refusal is not an Event and never will be: `Decision`'s refused member carries a Refusal and no
 * Events, which is exactly what makes "refused with no human involved" a property of the shape rather
 * than a claim about behaviour (criterion 3). Tasks 6 and 8 left the resolution open, with two
 * admissible shapes. This module takes the second one.
 *
 * **Rejected — widen `Decision`'s refused member so a Refusal carries facts of its own.** Three
 * reasons, and the first is structural rather than a matter of taste:
 *
 * 1. **A refusal is not always attributable to a Mission.** Every `MissionEvent` carries a
 *    `missionId`, and `decide(UNOPENED_MISSION, anything)` refuses without one existing — a
 *    `submit-handoff` against a Mission nobody opened is precisely one of criterion 12's illegal
 *    transitions. A fact about a Mission that does not exist cannot be written, so this shape could
 *    only ever hold *some* refusals, and a Replay that silently drops the rest is worse than one with
 *    a home for all of them.
 * 2. **The fact would have to change state, or it is the lie this repo forbids.** An Event `evolve`
 *    ignores is the always-zero field in another costume, so the refused attempt would have to be
 *    folded onto the Mission — a list of failed attempts that no rule reads. That puts history inside
 *    the state, which is the one thing event sourcing exists to avoid: the state answers "where is
 *    this Mission", the log answers "how did it get here".
 * 3. **It changes the shape criterion 3 rests on.** The techspec pins `refused` as carrying a Refusal
 *    and nothing else, and a Refusal that is the *whole* answer is what makes it impossible for the
 *    domain to involve a human in one.
 *
 * So a Replay is a list of `ReplayEntry` — one Command, one Decision — and `submit` is what appends
 * one. `evolve` is untouched, `Decision` is untouched, and **the fold stays the source of truth for
 * state**: `stateOf(replay)` is `replay(eventsOf(replay))`, with no cached state anywhere for a
 * hand-written Replay to contradict.
 *
 * ## What the projection answers, and why exactly that
 *
 * The Replay is the audit surface, and the product has already promised what it shows —
 * `lib/surfaces.ts` line 641: "qual zord recebeu o quê com qual harness, o que cada um entregou, o que
 * foi recusado e por quê, onde você aprovou, quanto custou cada passo", and `docs/PRODUTO.md` line 99:
 * "quem decidiu o quê, com qual harness, a que custo". Every one of those is a Step's Command plus its
 * Decision, so the projection adds exactly two things the recorded history does not carry: the
 * **position** of a Step and the **line a human reads**. The four things criterion 7 names come out of
 * `eventsIn` and `refusedIn`, which read Steps rather than re-deriving anything.
 *
 * A summary is a *reading* and not a field: written into the Replay it would freeze today's wording
 * into the record, and be a second copy of what the Command and the Decision already say. Same reason
 * `meterOf` derives `reached` instead of storing it.
 *
 * **The reading is `stepsOf`, and the techspec called it `project`.** One deviation, for one reason:
 * `project` is an `_Avoid_` term under **Workspace** in `CONTEXT.md`, and the adherence check Task 10
 * writes scans exported domain symbol names in `engine/domain/` for exactly that. It is not a violation
 * of the rule — this function names a reading of a Replay, not a Workspace — but the PRD's own precedent
 * is to resolve a glossary collision by renaming the code: the module was going to be `core/` and became
 * `engine/` so that `Core` stays the orchestrator. Renaming is cheap, an exemption is forever, and
 * `stepsOf` reads like the four readings beside it — `eventsOf`, `stateOf`, `eventsIn`, `refusedIn`.
 *
 * **Totals are not here.** What a Mission and each of its Panes spent is `meterOf`, from the state; a
 * Step reports what *that* step cost. Two readings of one truth is the trap `CLAUDE.md` records, and
 * the Meter got there first.
 *
 * **Who decided is not here either.** Nothing in `engine/` names a human — the Core is a capability
 * set, a Zord is an id with a Harness — so a Step says what was decided and not who decided it,
 * exactly as `CapAuthorised`, `GateDecided` and `MissionKilled` record no author. That is now one
 * declared Gap with four sites, and `PRODUTO.md`'s "quem decidiu o quê" is answered only as far as the
 * domain can: the Core delegates, a Zord answers, a human decides a Gate. Whoever adds an actor model
 * adds it to all four.
 */

import { decide, evolve, exhausted, UNOPENED_MISSION, type Decision, type Mission } from "./mission";
import { formatMoney } from "./money";
import type { MissionEvent } from "./events";
import type { Handoff } from "./handoff";
import type { MissionCommand } from "./commands";

/* -------------------------------------------------------------------------------------------------
 * The fold
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Mission a log of Events adds up to.
 *
 * `events.reduce(evolve, UNOPENED_MISSION)` — the whole implementation, and that is the point.
 * Criterion 7 asks that replaying reconstructs the same final state, and with `decide` producing the
 * Events and `evolve` folding them, "the same state" is not a feature to build but a property to
 * check: `replay.test.ts` builds a Mission Command by Command and asserts the fold equals it.
 *
 * Total: every Event applies to every state, and one that cannot apply leaves the state untouched
 * rather than throwing mid-Replay. An empty log is an unopened Mission.
 *
 * It deliberately does **not** filter by `missionId`. `evolve` does not check that an Event belongs to
 * the Mission it is folded into, so a filter here would make `replay(events)` disagree with
 * `events.reduce(evolve, …)` — the very equality this function exists to have. A log that mixes two
 * Missions is a Surface's mistake to avoid, and it is recorded as a finding of Task 9 rather than
 * fixed from inside it.
 */
export function replay(events: readonly MissionEvent[]): Mission {
  return events.reduce<Mission>(evolve, UNOPENED_MISSION);
}

/* -------------------------------------------------------------------------------------------------
 * The record
 * ---------------------------------------------------------------------------------------------- */

/**
 * One Command a Mission was given, and the Decision it got.
 *
 * Both halves are kept whole. The Command is what somebody intended — including the amount of an
 * accrual that was refused, which no Event records — and the Decision is either the facts it produced
 * or the Refusal that stopped it. Nothing is summarised at record time; summarising is `stepsOf`.
 */
export type ReplayEntry = {
  readonly command: MissionCommand;
  readonly decision: Decision;
};

/**
 * The auditable sequence of a Mission's Decisions, in the order they were made.
 *
 * A plain list, and not a record carrying a `missionId`: a Replay can begin with a Command that was
 * refused before any Mission existed, so an id field would have to be filled before there was one to
 * fill it with. Which Mission a Replay is about is `stateOf(replay)`.
 */
export type Replay = readonly ReplayEntry[];

/** The Replay of a Mission nothing has been submitted to yet. Frozen: it is shared by every start. */
export const EMPTY_REPLAY: Replay = Object.freeze([]);

/**
 * Submits a Command to the Mission a Replay adds up to, and records what the domain answered.
 *
 * This is the only place a Replay grows, and it exists in the engine rather than in each Surface for
 * the reason the PRD opens with: the moment a second Surface exists, each one would implement its own
 * reading of these rules and they would drift. A Surface that recorded only what it accepted would
 * lose every Refusal, which is the half criterion 7 names and the half a human most needs.
 *
 * It cannot record a Decision that did not happen: it calls `decide` itself, against the state the
 * Replay folds to. `decide` never throws, so neither does this.
 *
 * The state is re-folded on every call rather than carried along. That is deliberate, not an oversight
 * — a stored state would be a second copy of a truth the log already holds, and a hand-written Replay
 * could then carry a state its own facts do not fold to. A Mission's Replay is tens of entries and
 * this module has no persistence to answer to; when that stops being true, the answer is a Surface
 * that keeps `stateOf` beside its Replay, not a Replay that remembers.
 */
export function submit(into: Replay, command: MissionCommand): Replay {
  const decision = decide(stateOf(into), command);
  return Object.freeze([...into, Object.freeze({ command, decision })]);
}

/**
 * The Events a Replay accepted, in order — the log of the Mission it records.
 *
 * A refused Decision contributes none, which is what makes this the Event log rather than the Replay:
 * `eventsOf` is history as the state sees it, and the Replay is history as a human reads it.
 */
export function eventsOf(recorded: Replay): readonly MissionEvent[] {
  return recorded.flatMap((entry) =>
    entry.decision.kind === "accepted" ? entry.decision.events : [],
  );
}

/**
 * The Mission a Replay adds up to: the fold of the Events it accepted.
 *
 * Written as `replay(eventsOf(recorded))` and not as a second fold, so there is exactly one way state
 * is derived in this module and no chance of two answers.
 */
export function stateOf(recorded: Replay): Mission {
  return replay(eventsOf(recorded));
}

/* -------------------------------------------------------------------------------------------------
 * The projection
 * ---------------------------------------------------------------------------------------------- */

/**
 * One Step of a Replay as a human reads it: what was asked, what came of it, where it sits, and the
 * line that says so.
 *
 * A `ReplayEntry` plus the two things a reading adds. `ordinal` is 1-based, because a Step is
 * something a human counts rather than an index into an array, and it is what still says *where* a Step
 * sat once a list has been filtered — which is why `refusedIn` answers with Steps and not with bare
 * Refusals. `eventsIn` cannot carry it, because it answers with facts; what it preserves is the order.
 *
 * There is no `occurredAt`: `step.command.occurredAt` is the Instant it was submitted at, already
 * there, and copying it would be a second place for it to be wrong.
 */
export type Step = ReplayEntry & {
  /** Where this Step sits in the Replay, counting from one. */
  readonly ordinal: number;
  /** What happened, in one line: the intent, the outcome, and what the facts add. */
  readonly summary: string;
};

/** A Step whose Command was refused, with the Refusal narrowed so `refusal` can be read off it. */
export type RefusedStep = Step & {
  readonly decision: Extract<Decision, { readonly kind: "refused" }>;
};

/**
 * The Replay as a reading: every Step in order, numbered, with the line that describes it.
 *
 * Frozen, entries and all — the same treatment `meterOf`, `harness()` and `handoff()` give a value
 * handed out. Derived at read time and stored nowhere.
 */
export function stepsOf(recorded: Replay): readonly Step[] {
  return Object.freeze(
    recorded.map((entry, index) =>
      Object.freeze({
        command: entry.command,
        decision: entry.decision,
        ordinal: index + 1,
        summary: summaryOf(entry.command, entry.decision),
      }),
    ),
  );
}

/**
 * Every accepted fact of one kind, in the order the Replay accepted them.
 *
 * The typed answer to three of the four things criterion 7 names — `eventsIn(steps, "delegated")` for
 * every delegation with the Harness it resolved to, `"gate-decided"` for every human answer,
 * `"cost-accrued"` for what each Step cost. One function rather than three readings, so an Event added
 * to the union is readable the day it exists instead of needing a reading written for it.
 *
 * Order is the Replay's order, and facts within one Step keep the order `decide` produced them in: an
 * accrual that reached the Cap comes before the halt it caused.
 */
export function eventsIn<TKind extends MissionEvent["kind"]>(
  steps: readonly Step[],
  kind: TKind,
): readonly Extract<MissionEvent, { readonly kind: TKind }>[] {
  return steps.flatMap((step) =>
    step.decision.kind === "accepted"
      ? step.decision.events.filter(
          (event): event is Extract<MissionEvent, { readonly kind: TKind }> => event.kind === kind,
        )
      : [],
  );
}

/**
 * Every Step that was refused, in order, each carrying what it broke.
 *
 * The fourth thing criterion 7 names, and the one that is not a fact — which is the whole reason this
 * module records Decisions rather than Events. It returns the Steps and not bare Refusals, because
 * "o que foi recusado e por quê" needs both halves: the Refusal says why, and the Command says what.
 */
export function refusedIn(steps: readonly Step[]): readonly RefusedStep[] {
  return steps.filter((step): step is RefusedStep => step.decision.kind === "refused");
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the line a human reads
 * ---------------------------------------------------------------------------------------------- */

/**
 * One Step in one sentence: the intent, whether it was accepted, and what its facts add.
 *
 * Built from the intent rather than from the outcome, so an accepted and a refused Step of the same
 * Command read the same way up to the verb. A refused Step names its reason and every violation — a
 * Refusal carries a list because a Command can be wrong in more than one way, and the audit surface is
 * the last place to report only the first one.
 */
function summaryOf(command: MissionCommand, decision: Decision): string {
  const intent = asked(command);
  if (decision.kind === "refused") {
    return (
      `${intent} was refused (${decision.refusal.reason}): ` +
      `${decision.refusal.violations.join("; ")}`
    );
  }
  return [`${intent} was accepted`, ...decision.events.map(added).filter(said)].join(", ");
}

/**
 * What a Command intended, in words, whether or not it was accepted.
 *
 * Exhaustive: add a member to `MissionCommand` without a phrase here and the `default` branch hands it
 * to `exhausted`, whose parameter is `never`, and the build fails. The fall-through answer is truthful
 * rather than clever — a Command this engine cannot describe is described as one.
 */
function asked(command: MissionCommand): string {
  switch (command.kind) {
    case "open-mission":
      return `opening Mission "${command.missionId}"`;
    case "delegate":
      return (
        `delegating a Slice to Zord "${command.zordId}" ` +
        `as Delegation "${command.delegationId}"`
      );
    case "submit-handoff":
      return `answering ${delegationAnsweredBy(command.handoff)} with a Handoff`;
    case "accrue-cost":
      return (
        `accruing ${formatMoney(command.cost)} against Delegation "${command.delegationId}"`
      );
    case "authorise-cap":
      return `authorising a Cap of ${formatMoney(command.cap)}`;
    case "raise-gate":
      return `raising Gate "${command.gateId}"`;
    case "decide-gate":
      return `deciding Gate "${command.gateId}"`;
    case "kill-mission":
      return `killing this Mission because ${JSON.stringify(command.reason)}`;
    case "deliver-mission":
      return "delivering this Mission";
    default:
      exhausted(command);
      return "a Command this engine does not recognise";
  }
}

/**
 * What one accepted fact adds to the line, or nothing when the intent already said it.
 *
 * Exhaustive over `MissionEvent` for the same reason `asked` is over `MissionCommand`: a fact nobody
 * wrote a clause for would otherwise vanish from the audit surface silently. An empty clause is a
 * decision each time, not a default — `cost-accrued` has one because `asked` already names the amount
 * and the Delegation, and repeating them would make every accrual read twice.
 */
function added(event: MissionEvent): string {
  switch (event.kind) {
    case "mission-opened":
      return `in ${event.mode} Mode with a Cap of ${formatMoney(event.cap)}`;
    case "delegated":
      return (
        `running ${event.harness.cli}/${event.harness.model} ` +
        `at ${event.harness.effort} effort`
      );
    case "handoff-accepted":
      return (
        `covering ${count(event.handoff.satisfies.length, "Clause")} ` +
        `and declaring ${count(event.handoff.gaps.length, "Gap")}`
      );
    // The amount and the Pane are already in the intent. Repeating them here would print every accrual
    // twice on one line.
    case "cost-accrued":
      return "";
    case "cap-authorised":
      return `and the Mission may now spend up to ${formatMoney(event.cap)}`;
    case "gate-raised":
      return `asking ${JSON.stringify(event.question)}`;
    case "gate-decided":
      return event.decision.kind === "approved"
        ? "and a human approved it"
        : `and a human asked for a revision: ${JSON.stringify(event.decision.reason)}`;
    case "mission-halted":
      return event.halt.reason === "gate-open"
        ? `and the Mission stopped at Gate "${event.halt.gateId}"`
        : "and the Mission stopped because it reached its Cap";
    case "mission-delivered":
      return (
        `with ${count(event.delivery.artifacts.length, "artifact")} as proof: ` +
        `${JSON.stringify(event.delivery.summary)}`
      );
    // The reason is already in the intent, and it is the only thing this fact carries.
    case "mission-killed":
      return "";
    default:
      exhausted(event);
      return "and something happened this engine does not recognise";
  }
}

/**
 * Which Delegation a `submit-handoff` says it answers, without trusting that it says anything.
 *
 * The one place a reading *dereferences* a Command's field, so it is the one place a reading could throw
 * — and precisely on the Command `decide` goes out of its way to refuse rather than throw on: a
 * `submit-handoff` whose Handoff was lost to a cast or a truncated payload is refused
 * `illegal-transition` ("this one carries none"), that Refusal is recorded in the Replay by `submit`, and
 * reading it back must not be what finally throws. A Replay that cannot be read is a Replay that cannot
 * be shown to a human, which is the whole of what it is for.
 *
 * Same shape as `amountOf`, `saidOf` and `decisionOf`: read as `unknown`, answer truthfully. The
 * condition stays inline in the `if`, because TypeScript does not narrow through an aliased compound
 * condition that uses `in`.
 */
function delegationAnsweredBy(claimed: Handoff): string {
  const value: unknown = claimed;
  if (
    typeof value === "object" &&
    value !== null &&
    "delegationId" in value &&
    typeof value.delegationId === "string"
  ) {
    return `Delegation "${value.delegationId}"`;
  }
  return "a Delegation this Command does not name";
}

/** `1 Clause`, `2 Clauses`, `no Gap` — a count a human reads, without a bare zero. */
function count(many: number, noun: string): string {
  if (many === 0) {
    return `no ${noun}`;
  }
  return `${many} ${noun}${many === 1 ? "" : "s"}`;
}

/** Whether a phrase said anything, so an empty one does not leave a dangling comma behind it. */
function said(phrase: string): boolean {
  return phrase.length > 0;
}
