/**
 * The Core, as software: the thing that turns a Briefing plus a Combination into a Delivery, in order,
 * deterministically, with nothing judged by a model on the way.
 *
 * ```
 * drive({ briefing, combination, store, runner, now, … }) -> { outcome, replay }
 * ```
 *
 * A Combination is **data**: a named formation with a declared Roster, the Gates that fall in it, and the
 * deliverable it produces. Nothing here infers one from a Briefing — PRD out-of-scope 3 pins this cut of
 * the Core to following a declared recipe, and a Core that planned would need a model call, a key and a
 * prompt Contract, which is precisely the thing that would make the first running version irreproducible.
 *
 * Every gesture goes through the engine's `submit`, against `stateOf` of what the store just handed over.
 * **This module holds no Mission state**, cached or otherwise, exactly as `cockpit/server.ts` and
 * `runtime/mcp-server.ts` hold none: the Mission is the file (ADR 0009), and a drive that remembered would
 * be a second copy of a truth the file already holds — the copy a human would be shown. It decides nothing
 * `decide` decides: it decides only *which Command to submit next*, which it reads off the state and the
 * recipe, and `nextGestureOf` is that reading, exported so it can be tested with no disk in the way.
 *
 * ## Who builds the Handoff — the question this module turns on
 *
 * **Nobody here.** ADR 0010: a Handoff is built by the Zord that delivers it and submitted as a Command
 * through the control plane, and nothing in `runtime/` reads what a Zord wrote and infers one. An
 * `AgentReport` is output and a cost; it is not a Handoff and cannot become one without judging text.
 *
 * So the drive delegates, invokes, and then **waits for the Delegation to be settled by another hand** —
 * by re-reading the Replay, because there is no event bus and nothing notifies. `isOpenDelegation` is the
 * whole test: a Delegation that carries an accepted Handoff is answered, and one that does not is still
 * open. The channel between the Zord and the Core is the file, which is also the only channel there is:
 * `handoff_submit` in the control plane loads the Replay, submits and appends, and this module loads it
 * back.
 *
 * **The rejected shape: an injected `handoffFrom(run, report) => Handoff`.** It reads like an honest
 * boundary — the caller owns the judgement, the driver owns the order — and it is ADR 0010 smuggled past
 * through a function parameter. The caller of a drive is a Surface (`mz`, a test), not the Zord; a function
 * it writes that turns `report.output` into a scope, a list of artifacts and a set of declared Gaps is the
 * prose heuristic the ADR refuses, relocated one stack frame. Worse, it would be *unfalsifiable* in exactly
 * the way the ADR names: nobody could tell a heuristic that missed a Gap from a Zord that did not declare
 * one. A `@ts-expect-error` probe in the test pins the absence of that option, so whoever adds one deletes
 * a directive and states the decision.
 *
 * What the drive does compose is the **instruction**, and the line is not blurred: it copies the text the
 * Combination declared, names the Delegation being answered, and quotes back the violations the *engine*
 * produced. Joining strings the domain wrote is not judging text; reading a Zord's prose is.
 *
 * ## What a Refusal does, and which one stops the drive
 *
 * A refused Handoff settles nothing — the Delegation stays open — so the Core invokes the Zord again with
 * the violations quoted, up to `maxAttemptsPerDelegation`. It has to be a *new* invocation rather than a
 * second submission by the same Zord: a Zord is born when invoked and dies after delivering, so the one
 * that was told what it broke is already gone by the time `run` resolves. How many times a Delegation has
 * been invoked is **counted from the record** — one accepted `cost-accrued` per invocation — and not held
 * in a field here, which is what makes a drive resumable across a restart of the process.
 *
 * A Refusal of a Command **this module submitted** ends the drive, with `outcome.kind === "refused"` and
 * the Step that carries it. The alternative — carry on and let the next turn decide — loops: a `delegate`
 * refused `unrunnable-harness` leaves the state untouched, so the recipe asks for the same Delegation
 * again, forever; and an accrual refused on a still-running Mission (the overflow case) would put the drive
 * straight back into invoking a Zord, spending real money each turn. Stopping is one sentence a reader can
 * check, and the Replay it hands back says which Command and why.
 *
 * ## Every stop is an outcome; only a caller's bug is a rejection
 *
 * `drive` rejects for a Combination it cannot follow and for options it cannot use — both checked **before
 * a single gesture**, so nothing has happened yet — and for a clock that stops answering Instants, because
 * a fact with no time is not a fact this module may write. Everything else is a `DriveOutcome`: a Gate to
 * answer, a Cap to authorise, a Zord that never delivered, a Handoff refused to the last attempt, a runner
 * that failed, a Mission somebody killed. None of them is a hang and none of them is an exception a caller
 * has to guess the meaning of.
 *
 * `Date.now()` is the only clock this module reads for itself, and it is read for the poll deadline alone —
 * it never enters the record. Every Instant in the Replay comes from the injected `now`, which is what
 * makes a drive **byte-for-byte reproducible**: the same Briefing, the same Combination and the same script
 * produce the same file, and the test asserts exactly that by comparing two of them.
 *
 * ## Declared Gaps
 *
 * 1. **A revision stops the drive, every time.** A human who asks for a revision at a Gate is asking for
 *    work to be redone, and a Combination declares a fixed Roster: redoing a Slice needs a Delegation under
 *    a new id that no recipe here carries, and a Delegation is answered once. So the drive stops with
 *    `revision-requested` and stops there again on the next call — which is determinism rather than a loop,
 *    since neither the state nor the recipe changed. Delivering anyway would deliver work a human said was
 *    not right. The additive fix is a Combination that declares what a revision retries, and it is
 *    planning-adjacent, which this cut is out of scope for.
 * 2. **A Gate cannot fall before the first Delegation.** `DeclaredGate.after` names the Delegation a Gate
 *    falls after, and it is required — an optional one would mean "at the start", and a field with two
 *    meanings is the shape this repository refuses. A checkpoint before any work has been commissioned is
 *    also the one a human already passed: they gave the Briefing.
 * 3. **Two writers on one Mission file are not ordered**, inherited from the control plane's Gap 4. This
 *    drive is safe by construction rather than by locking: it appends nothing while a run is in flight, and
 *    a Zord writes only while one is. A second driver on the same Mission is not something this module can
 *    order.
 * 4. **A failed run accrues nothing**, inherited from the pty runner's decision that an `AgentRunFailure`
 *    carries no cost. A Mission can spend money on a run that failed and the Meter will not show it.
 * 5. **No author on anything.** The sixth site of the Gap the engine records four times and the Cortex
 *    records once: this module submits Commands on behalf of the Core, and nothing in `engine/` names a
 *    human. Whoever adds an actor model adds it here too.
 * 6. **A hand-edited `handoff-accepted` fact whose `artifacts` are not a list of strings contributes no
 *    artifact to the Delivery.** The Delivery is consolidated from what the accepted Handoffs carried, read
 *    as `unknown` because it came off a file the store deliberately does not judge; an unreadable one is
 *    skipped rather than thrown on, which is the same degradation `validateHandoff` makes for the same
 *    reason.
 */

import {
  eventsIn,
  isOpenDelegation,
  isOpened,
  refusedIn,
  revisionsIn,
  stateOf,
  stepsOf,
  submit,
  type AgentReport,
  type AgentRunner,
  type Contract,
  type DelegationId,
  type Delegation,
  type Delivery,
  type GateId,
  type Handoff,
  type Harness,
  type HarnessSources,
  type Instant,
  type MissionCommand,
  type MissionId,
  type Mode,
  type Money,
  type RefusedStep,
  type Replay,
  type ReplayEntry,
  type RunningMission,
  type Slice,
  type Briefing,
  type Core,
  type Step,
  type ZordId,
} from "@engine/index";

// Type-only: this module opens no file and forks nothing. It is handed a store and a runner.
import type { MissionStore } from "./mission-store";

/* -------------------------------------------------------------------------------------------------
 * The recipe
 * ---------------------------------------------------------------------------------------------- */

/**
 * One entry of a Combination's Roster: one Delegation, declared in full before anything runs.
 *
 * The glossary defines a Roster as the list of **Roles** in a Combination with the Harness of each. An
 * entry here names a `ZordId` instead, and that is not a shortcut: `Role` has no type in `engine/`, there
 * is no Zord registry to resolve one against, and `CLAUDE.md` records that a `role` field nothing validates
 * against would be the always-zero field. A Delegation names a Zord; so does a Roster entry.
 *
 * `instruction` is the word the port uses (`AgentRun.instruction`) and it is `_Avoid_` for **Skill** in the
 * glossary: it is the text a runner is handed, not an installable instruction block. Reusing the port's
 * name is what keeps the two readable together.
 */
export type RosterEntry = {
  /** The id this Delegation is made under. Used once in a Combination, and once in a Mission. */
  readonly delegationId: DelegationId;
  /** The Zord it is given to. Two entries may name one Zord; two may not share a DelegationId. */
  readonly zordId: ZordId;
  /** The portion of the Mission's outcome this Delegation hands over. */
  readonly slice: Slice;
  /** The three sources the Harness is resolved from. `decide` resolves it; nothing here does. */
  readonly harnessSources: HarnessSources;
  /** What the Handoff answering this Delegation is judged against. Empty is an answer; absent is not. */
  readonly contract: Contract;
  /** What the Zord is asked to do. The drive names the Delegation beside it and quotes refusals. */
  readonly instruction: string;
};

/**
 * A Gate the Combination declares, and where it falls.
 *
 * `after` is required and names a Roster entry: a Gate falls once that Delegation is settled, and a Gate
 * after the last entry is the Gate before the Delivery. See Gap 2 for the checkpoint this cannot express.
 */
export type DeclaredGate = {
  readonly gateId: GateId;
  /** What the human is asked. Non-blank: `decide` refuses a Gate that asks nothing. */
  readonly question: string;
  /** The Delegation this Gate falls after. Must be one of the Roster's. */
  readonly after: DelegationId;
};

/**
 * A named formation of Zords, with a declared Roster, Gates and deliverable.
 *
 * Data, from end to end. Everything a drive needs to run it is here before it starts, which is what makes
 * the whole thing reproducible: no field is filled in from a model's answer, and no order is chosen at run
 * time — the Roster's order is the order.
 */
export type Combination = {
  /** What this formation is called. Non-blank, and recorded nowhere: it names the recipe, not a Mission. */
  readonly name: string;
  /** The Delegations, in the order they are made. At least one: a formation of nobody is not one. */
  readonly roster: readonly RosterEntry[];
  /** Where the Gates fall. May be empty — a Combination that stops for nobody is a legitimate recipe. */
  readonly gates: readonly DeclaredGate[];
  /** What the Mission delivers. The summary of the Delivery; its artifacts come from the Handoffs. */
  readonly deliverable: string;
};

/** Raised when a Combination is not a recipe anybody could follow. */
export class InvalidCombinationError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Combination cannot be driven: ${violations.join("; ")}`);
    this.name = "InvalidCombinationError";
    this.violations = violations;
  }
}

/**
 * Checks a Combination and freezes it.
 *
 * The runtime half of the shape, in the idiom every value object here uses: the parameter type is a claim,
 * and a Combination can arrive from a `JSON.parse`, a cast or a file. Every violation is reported at once —
 * a recipe can be wrong in more than one way and naming only the first sends its author round twice.
 *
 * It stops where another constructor owns the rule. A `Contract` is checked by `contract()`, a `Harness` by
 * `harness()` through `resolveHarness` inside `decide`; re-checking either here would be a second home for
 * one rule, and the deeper one would be the one that had the last word. What is checked is what **this**
 * module computes with: the ids it builds Commands out of, and the cross-reference between a Gate and the
 * Roster, which nothing downstream can check because nothing downstream has both.
 *
 * `drive` runs this over its own input, so a Combination forced past the compiler is refused before a
 * single gesture rather than half-followed.
 *
 * @throws {InvalidCombinationError} listing everything wrong with it.
 */
export function combination(fields: Combination): Combination {
  const violations: string[] = [];

  const named: unknown = fields;
  if (typeof named !== "object" || named === null) {
    throw new InvalidCombinationError([`a Combination is an object, received ${shown(named)}`]);
  }

  checkSaid("name", fields.name, "what this formation is called", violations);
  checkSaid("deliverable", fields.deliverable, "what the Mission delivers", violations);

  const roster = asList<RosterEntry>(fields.roster, "roster", violations);
  if (roster.length === 0) {
    violations.push("roster must declare at least one Delegation: a formation of nobody delegates nothing");
  }

  const declared = new Set<string>();
  roster.forEach((entry, position) => {
    const at = `roster[${position}]`;
    if (typeof entry !== "object" || entry === null) {
      violations.push(`${at} must be a Roster entry, received ${shown(entry)}`);
      return;
    }
    checkSaid(`${at}.delegationId`, entry.delegationId, "the id this Delegation is made under", violations);
    checkSaid(`${at}.zordId`, entry.zordId, "the Zord this Slice is given to", violations);
    checkSaid(`${at}.slice`, entry.slice, "the portion of the outcome this Delegation hands over", violations);
    // A Zord invoked with nothing to act on cannot deliver a Handoff, and the drive would spend a run
    // per attempt discovering that. The pty adapter lets a blank instruction through because refusing one
    // is not an adapter's judgement; a recipe is exactly where that judgement belongs.
    checkSaid(`${at}.instruction`, entry.instruction, "what the Zord is asked to do", violations);

    const sources: unknown = entry.harnessSources;
    if (typeof sources !== "object" || sources === null) {
      violations.push(`${at}.harnessSources must carry the sources a Harness is resolved from, received ${shown(sources)}`);
    } else if (!("catalogDefault" in sources) || typeof sources.catalogDefault !== "object" || sources.catalogDefault === null) {
      violations.push(`${at}.harnessSources.catalogDefault must be the complete Harness resolution falls back to`);
    }

    const agreed: unknown = entry.contract;
    if (typeof agreed !== "object" || agreed === null) {
      violations.push(`${at}.contract must be the Contract this Delegation is judged against, received ${shown(agreed)}`);
    } else if (!("clauses" in agreed) || !Array.isArray(agreed.clauses)) {
      violations.push(`${at}.contract must state its list of Clauses — an empty Contract is an answer, an absent one is not`);
    }

    const id: unknown = entry.delegationId;
    if (typeof id === "string") {
      if (declared.has(id)) {
        violations.push(`${at}.delegationId ${JSON.stringify(id)} is declared twice, and a Mission makes each Delegation once`);
      }
      declared.add(id);
    }
  });

  const gates = asList<DeclaredGate>(fields.gates, "gates", violations);
  const raised = new Set<string>();
  gates.forEach((gate, position) => {
    const at = `gates[${position}]`;
    if (typeof gate !== "object" || gate === null) {
      violations.push(`${at} must be a declared Gate, received ${shown(gate)}`);
      return;
    }
    checkSaid(`${at}.gateId`, gate.gateId, "the id this Gate is raised under", violations);
    checkSaid(`${at}.question`, gate.question, "what the human is asked", violations);

    const id: unknown = gate.gateId;
    if (typeof id === "string") {
      if (raised.has(id)) {
        violations.push(`${at}.gateId ${JSON.stringify(id)} is declared twice, and a Mission raises each Gate once`);
      }
      raised.add(id);
    }

    const after: unknown = gate.after;
    if (typeof after !== "string" || after.trim().length === 0) {
      violations.push(`${at}.after must name the Delegation this Gate falls after, received ${shown(after)}`);
    } else if (!declared.has(after)) {
      violations.push(`${at}.after names Delegation ${JSON.stringify(after)}, which this Roster does not declare`);
    }
  });

  if (violations.length > 0) {
    throw new InvalidCombinationError(violations);
  }

  // Frozen one level into each list, exactly as `handoff()` and `contract()` freeze what they hand out.
  // It deliberately does not reach into `harnessSources` or `contract`: those are value objects with
  // constructors of their own, and freezing somebody else's value is claiming their invariant.
  return Object.freeze({
    name: fields.name,
    roster: Object.freeze(roster.map((entry) => Object.freeze({ ...entry }))),
    gates: Object.freeze(gates.map((gate) => Object.freeze({ ...gate }))),
    deliverable: fields.deliverable,
  });
}

/* -------------------------------------------------------------------------------------------------
 * What the recipe asks for next
 * ---------------------------------------------------------------------------------------------- */

/**
 * The next thing a Combination asks of a running Mission.
 *
 * Pure, total and deterministic — a function of the recipe and the folded state, and of nothing else. That
 * is what "the Core follows a recipe deterministically" reduces to: the same state and the same Combination
 * always answer the same gesture, which is why a drive resumed from disk in another process continues
 * exactly where the last one stopped, and why a drive stopped by a revision stops there again.
 *
 * The walk is the Roster's order: each entry is delegated, then run until it is settled, then the Gates
 * declared after it are raised in declaration order. When every entry is settled and every Gate it carries
 * has been raised, the Mission is delivered.
 */
export type Gesture =
  /** Nothing has been delegated under this entry's id yet. */
  | { readonly kind: "delegate"; readonly entry: RosterEntry }
  /** The Delegation exists and is still open: invoke its Zord and wait for a Handoff. */
  | { readonly kind: "invoke"; readonly entry: RosterEntry; readonly delegation: Delegation }
  /** This Gate falls here and the Mission has not raised it. */
  | { readonly kind: "raise-gate"; readonly gate: DeclaredGate }
  /** Every Slice is settled and every Gate was raised. */
  | { readonly kind: "deliver" };

/**
 * What this Combination asks of this Mission next.
 *
 * Takes a `RunningMission` and not a `Mission`: a Mission that is halted is waiting for a human and a
 * terminal one is over, so "what next" is not a recipe question there — the drive answers those from the
 * state before it ever gets here, and narrowing the parameter is what stops this function from having to
 * invent an answer for them.
 */
export function nextGestureOf(recipe: Combination, state: RunningMission): Gesture {
  for (const entry of recipe.roster) {
    const made = state.delegations.find((delegation) => delegation.id === entry.delegationId);
    if (made === undefined) {
      return { kind: "delegate", entry };
    }
    if (isOpenDelegation(made)) {
      return { kind: "invoke", entry, delegation: made };
    }
    for (const gate of recipe.gates) {
      if (gate.after !== entry.delegationId) {
        continue;
      }
      if (state.gates.some((held) => held.id === gate.gateId)) {
        continue;
      }
      return { kind: "raise-gate", gate };
    }
  }
  return { kind: "deliver" };
}

/**
 * What a Zord is handed for one invocation: the Roster entry's own text, which Delegation it answers, and
 * what its last Handoff broke.
 *
 * Three parts, and every one of them is quotation rather than judgement — the declared text verbatim, an
 * id the recipe wrote, and the violations `decide` produced word for word. A Zord that is not told which
 * Delegation it answers cannot submit a Handoff at all, and one that is not told what it broke is being
 * asked to guess: it is a **new** Zord each time, so the Refusal the control plane handed the last one died
 * with it.
 *
 * The control plane's tool is named, because the eight wire names are pinned by the PRD and a Zord left to
 * guess which tool answers a Delegation will not find it.
 */
export function instructionFor(entry: RosterEntry, violations: readonly string[]): string {
  const said = [
    entry.instruction,
    "",
    `You are answering Delegation "${entry.delegationId}" of this Mission. When you are done, submit ` +
      `your Handoff with the control plane's "handoff_submit" tool, naming that Delegation.`,
  ];
  if (violations.length > 0) {
    said.push(
      "",
      "Your last Handoff was refused against its Contract. Fix these and submit again:",
      ...violations.map((violation) => `- ${violation}`),
    );
  }
  return said.join("\n");
}

/* -------------------------------------------------------------------------------------------------
 * The drive
 * ---------------------------------------------------------------------------------------------- */

/** Raised when a drive is asked for with options it cannot be run with. Thrown before any gesture. */
export class InvalidDriveError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`this drive cannot be run: ${violations.join("; ")}`);
    this.name = "InvalidDriveError";
    this.violations = violations;
  }
}

/**
 * Raised when the injected clock stops answering Instants.
 *
 * The one failure that rejects mid-drive, and it rejects rather than becoming an outcome because every
 * Command carries the Instant it was submitted at: a fact with no time is not a fact this module may write,
 * and inventing one would put a claim in the record that no rule can check.
 */
export class BrokenClockError extends Error {
  constructor(detail: string) {
    super(`the clock this drive was given ${detail}`);
    this.name = "BrokenClockError";
  }
}

/** What a drive is run with. Every collaborator is handed in; nothing has a hidden default. */
export type DriveOptions = {
  /** The Mission this drive opens and advances. Its Replay is the file the store keeps under this id. */
  readonly missionId: MissionId;
  /** The outcome the Mission is opened for. States the end, not the steps. */
  readonly briefing: Briefing;
  /**
   * Who leads the Mission and how much autonomy exists.
   *
   * An input rather than `"combination"` fixed here: the Mode is data the engine copies verbatim, and a
   * module that overrode it would be deciding something about a Mission that its opener already decided.
   */
  readonly mode: Mode;
  /** The spending limit. Reaching it halts the Mission, and the drive stops and says so. */
  readonly cap: Money;
  /** The Core that leads it. It needs the `delegate` capability, and `decide` is what checks that. */
  readonly core: Core;
  /** The recipe. Checked with `combination()` before the first gesture. */
  readonly combination: Combination;
  /** Where the Replay lives. The Mission is that file; nothing about it is cached here. */
  readonly store: MissionStore;
  /**
   * What runs a Zord.
   *
   * It answers what the Zord wrote and what the run cost, and **not** a Handoff — see the module doc. The
   * fake is what makes a whole drive provable with no CLI installed and no process anywhere.
   */
  readonly runner: AgentRunner;
  /**
   * Where time comes from.
   *
   * Required, with no default and no clock read for it anywhere in this module. Every Instant in the
   * Replay comes from here, which is what makes two drives of one recipe byte-identical.
   */
  readonly now: () => Instant;
  /**
   * How long to wait for a Handoff to arrive after a Zord's run resolved, in milliseconds.
   *
   * Required: it is half of what "a Zord never delivered" means, and a default would be this module
   * choosing invisibly how long a Mission waits. Zero is an answer — it checks once and does not wait.
   */
  readonly settleTimeoutMs: number;
  /**
   * How often to re-read the Replay while waiting, in milliseconds. At least 1: there is no event bus,
   * and a poll with no interval is a busy loop.
   */
  readonly pollEveryMs: number;
  /**
   * How many times one Delegation may be invoked before the drive gives up on it.
   *
   * Required, because it bounds how much money a refused Handoff can cost. At least 1 — zero attempts is
   * a Delegation made and never run.
   */
  readonly maxAttemptsPerDelegation: number;
};

/**
 * Why a drive stopped.
 *
 * It carries what the state does **not** already say, and nothing that would be a second copy of it:
 * `delivered`, `killed` and `halted-at-cap` carry nothing at all, because `stateOf(drive.replay)` answers
 * every question about them. What is here is what lives in the Replay rather than in the fold — how many
 * times a Zord was invoked, what its last Handoff broke — plus the id of whatever a human now has to
 * answer.
 */
export type DriveOutcome =
  /** Every Slice was settled, every Gate was answered, and the Mission was delivered. */
  | { readonly kind: "delivered" }
  /** A Gate is open. A human decides it, and then the Mission is driven again. */
  | { readonly kind: "halted-at-gate"; readonly gateId: GateId }
  /** The Cap was reached. A human authorises a higher one, and then the Mission is driven again. */
  | { readonly kind: "halted-at-cap" }
  /** Somebody ended the Mission. Why is `stateOf(replay).reason`. */
  | { readonly kind: "killed" }
  /** A human asked for a revision this Core cannot act on. See Gap 1. */
  | { readonly kind: "revision-requested"; readonly reasons: readonly string[] }
  /**
   * A Zord was invoked and no Handoff arrived before the timeout, or every attempt it was allowed was
   * spent and none of them answered at all. The Delegation is still open either way.
   */
  | {
      readonly kind: "awaiting-handoff";
      readonly delegationId: DelegationId;
      readonly attempts: number;
    }
  /** Every attempt this drive was allowed was refused against the Contract. */
  | {
      readonly kind: "handoff-refused";
      readonly delegationId: DelegationId;
      readonly attempts: number;
      readonly violations: readonly string[];
    }
  /** A Command this drive submitted was refused. The Step says which one and why. */
  | { readonly kind: "refused"; readonly step: RefusedStep }
  /** The Harness recorded on a Delegation cannot be handed to a runner. Only a hand-edited log has one. */
  | {
      readonly kind: "unrunnable-harness";
      readonly delegationId: DelegationId;
      readonly detail: string;
    }
  /** The runner failed. It reports no cost when it does, so nothing was accrued for it. */
  | { readonly kind: "run-failed"; readonly delegationId: DelegationId; readonly detail: string };

/**
 * What one drive did: why it stopped, and the Replay as it stands afterwards.
 *
 * There is no `state` field and there will not be one: `stateOf(drive.replay)` is the state, and a copy
 * beside the Replay is the second reading of one truth this repository refuses everywhere else. The same
 * goes for the Meter, which is `meterOf` of that state.
 */
export type Drive = {
  readonly outcome: DriveOutcome;
  /** The Replay, re-read from the store after the last gesture. Frozen by the store. */
  readonly replay: Replay;
};

/**
 * Drives a Mission through a Combination, as far as it goes.
 *
 * Resumable and idempotent by construction: it opens the Mission only if the Replay says it is unopened,
 * delegates only what has no Delegation, invokes only what is open, raises only Gates the Mission has not
 * raised, and delivers only when the recipe is exhausted. Driving a delivered Mission appends nothing and
 * answers `delivered`.
 *
 * @throws {InvalidCombinationError} before any gesture, when the recipe cannot be followed.
 * @throws {InvalidDriveError} before any gesture, when the options cannot be used.
 * @throws {BrokenClockError} when `now` stops answering Instants.
 */
export async function drive(options: DriveOptions): Promise<Drive> {
  // Both before the first gesture: a recipe nobody can follow and a timeout that is not a number are the
  // caller's bugs, and neither should be discovered halfway through a Mission that is already spending.
  const recipe = combination(options.combination);
  checkOptions(options);

  for (;;) {
    const recorded = await options.store.load(options.missionId);
    const state = stateOf(recorded);

    if (!isOpened(state)) {
      const refusal = await record(options, {
        kind: "open-mission",
        occurredAt: instantAt(options),
        missionId: options.missionId,
        briefing: options.briefing,
        mode: options.mode,
        cap: options.cap,
        core: options.core,
      });
      if (refusal !== undefined) {
        return done(options, { kind: "refused", step: refusal });
      }
      continue;
    }

    if (state.status === "delivered") {
      return done(options, { kind: "delivered" });
    }
    if (state.status === "killed") {
      return done(options, { kind: "killed" });
    }
    if (state.status === "halted") {
      return done(
        options,
        state.halt.reason === "gate-open"
          ? { kind: "halted-at-gate", gateId: state.halt.gateId }
          : { kind: "halted-at-cap" },
      );
    }

    // A revision is read before the recipe is consulted, because it is an answer about work that is
    // already done: carrying on would deliver what a human said was not right. See Gap 1.
    const revisions = revisionsIn(state.gates);
    if (revisions.length > 0) {
      return done(options, { kind: "revision-requested", reasons: revisions });
    }

    const gesture = nextGestureOf(recipe, state);

    if (gesture.kind === "delegate") {
      const refusal = await record(options, {
        kind: "delegate",
        occurredAt: instantAt(options),
        delegationId: gesture.entry.delegationId,
        zordId: gesture.entry.zordId,
        slice: gesture.entry.slice,
        harnessSources: gesture.entry.harnessSources,
        contract: gesture.entry.contract,
      });
      if (refusal !== undefined) {
        return done(options, { kind: "refused", step: refusal });
      }
      continue;
    }

    if (gesture.kind === "raise-gate") {
      const refusal = await record(options, {
        kind: "raise-gate",
        occurredAt: instantAt(options),
        gateId: gesture.gate.gateId,
        question: gesture.gate.question,
      });
      if (refusal !== undefined) {
        return done(options, { kind: "refused", step: refusal });
      }
      continue;
    }

    if (gesture.kind === "deliver") {
      const refusal = await record(options, {
        kind: "deliver-mission",
        occurredAt: instantAt(options),
        delivery: deliveryOf(recipe, state),
      });
      if (refusal !== undefined) {
        return done(options, { kind: "refused", step: refusal });
      }
      continue;
    }

    const invoked = await invoke(options, recorded, gesture.entry, gesture.delegation);
    if (invoked !== undefined) {
      return done(options, invoked);
    }
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: one invocation
 * ---------------------------------------------------------------------------------------------- */

/**
 * Runs the Zord of one open Delegation, accrues what it cost, and waits for a Handoff to arrive.
 *
 * Answers `undefined` when the drive should carry on — the Delegation was settled by somebody else's hand,
 * or the Handoff was refused and there may be an attempt left, or the Mission moved on while we waited —
 * and a `DriveOutcome` when it should stop.
 *
 * The attempt count is read off the record rather than held: one accepted `cost-accrued` per invocation,
 * counted from the Replay this turn loaded. That is what survives the process being restarted.
 */
async function invoke(
  options: DriveOptions,
  recorded: Replay,
  entry: RosterEntry,
  delegation: Delegation,
): Promise<DriveOutcome | undefined> {
  const steps = stepsOf(recorded);
  const attempts = attemptsOn(steps, entry.delegationId);
  const violations = lastViolationsOn(steps, entry.delegationId);

  if (attempts >= options.maxAttemptsPerDelegation) {
    // Out of attempts, and the two ways of getting here are not the same thing to a human. A Zord whose
    // Handoffs were refused broke a Contract and the violations say how; a Zord that answered nothing
    // simply never delivered, and reporting *that* as a Refusal with an empty list of violations would
    // name a Contract failure nobody committed.
    return violations.length > 0
      ? { kind: "handoff-refused", delegationId: entry.delegationId, attempts, violations }
      : { kind: "awaiting-handoff", delegationId: entry.delegationId, attempts };
  }

  // The Harness came off a file the store deliberately does not judge, and a runner is an implementation
  // of a port: the fake reads `asked.harness.cli` in its own error and the real one forks with it. Read as
  // `unknown` before it is handed over, exactly as `agent_invoke` does — same file, same threat model.
  const held: unknown = delegation.harness;
  if (typeof held !== "object" || held === null) {
    return {
      kind: "unrunnable-harness",
      delegationId: entry.delegationId,
      detail: `the Delegation records ${shown(held)} where its Harness should be`,
    };
  }
  if (!("cli" in held) || typeof held.cli !== "string" || held.cli.trim().length === 0) {
    return {
      kind: "unrunnable-harness",
      delegationId: entry.delegationId,
      detail: "the Harness recorded on this Delegation names no cli",
    };
  }

  // The position the wait watches from. Entries are only ever appended, so an index taken now still names
  // the same entry afterwards, and a Refusal at or after it is one that arrived during this attempt.
  const from = recorded.length;

  let report: AgentReport;
  try {
    report = await options.runner.run({
      harness: held as Harness,
      instruction: instructionFor(entry, violations),
    });
  } catch (cause) {
    // A failed run carries no cost — the pty runner's decision, inherited — so there is nothing to accrue
    // and the Meter cannot show what it spent. Gap 4.
    return { kind: "run-failed", delegationId: entry.delegationId, detail: messageOf(cause) };
  }

  const refusal = await record(options, {
    kind: "accrue-cost",
    occurredAt: instantAt(options),
    delegationId: entry.delegationId,
    cost: report.cost,
  });
  if (refusal !== undefined) {
    return { kind: "refused", step: refusal };
  }

  const waited = await waitForHandoff(options, entry.delegationId, from);
  if (waited === "silent") {
    return {
      kind: "awaiting-handoff",
      delegationId: entry.delegationId,
      attempts: attempts + 1,
    };
  }
  return undefined;
}

/** Whether anything happened while the drive waited, or the wait ran out. */
type Waited = "moved-on" | "silent";

/**
 * Waits for the Delegation to be answered by another hand.
 *
 * There is no event bus and nothing notifies, so this re-reads the Replay: the file is the channel between
 * a Zord and the Core, and `handoff_submit` in the control plane writes to it. It checks **before** it
 * waits, so a Handoff the Zord submitted during its own run — the ordinary case — costs no delay at all,
 * and `settleTimeoutMs: 0` is a single check rather than no check.
 *
 * Three things end it early and all three mean the same thing to the caller, which is why they are one
 * answer: the Delegation was settled, a `submit-handoff` for it was refused during this attempt (so there
 * is nothing left to wait for and the next turn decides whether to invoke again), or the Mission stopped
 * being one that runs. Only running out is distinguished.
 */
async function waitForHandoff(
  options: DriveOptions,
  id: DelegationId,
  from: number,
): Promise<Waited> {
  const deadline = Date.now() + options.settleTimeoutMs;

  for (;;) {
    const recorded = await options.store.load(options.missionId);
    const state = stateOf(recorded);
    if (!isOpened(state) || state.status !== "running") {
      return "moved-on";
    }
    const made = state.delegations.find((delegation) => delegation.id === id);
    if (made === undefined || !isOpenDelegation(made)) {
      return "moved-on";
    }
    if (refusalsOn(stepsOf(recorded.slice(from)), id).length > 0) {
      return "moved-on";
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return "silent";
    }
    await sleep(Math.min(options.pollEveryMs, remaining));
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: readings of the record
 * ---------------------------------------------------------------------------------------------- */

/**
 * How many times a Delegation has been invoked, counted from what each invocation recorded.
 *
 * One accepted `cost-accrued` per run — this drive submits one after every run, and so does the control
 * plane's `agent_invoke`, so an invocation somebody else made counts too, which is the truth: it is a run
 * that happened and a Handoff that could have come from it.
 */
function attemptsOn(steps: readonly Step[], id: DelegationId): number {
  return eventsIn(steps, "cost-accrued").filter((accrual) => accrual.delegationId === id).length;
}

/** Every refused `submit-handoff` that names this Delegation, in order. */
function refusalsOn(steps: readonly Step[], id: DelegationId): readonly RefusedStep[] {
  return refusedIn(steps).filter(
    (step) => step.command.kind === "submit-handoff" && answeredBy(step.command.handoff) === id,
  );
}

/** What the most recent refused Handoff for this Delegation broke, or nothing when none was refused. */
function lastViolationsOn(steps: readonly Step[], id: DelegationId): readonly string[] {
  const refused = refusalsOn(steps, id);
  const last = refused[refused.length - 1];
  return last === undefined ? [] : last.decision.refusal.violations;
}

/**
 * Which Delegation a recorded `submit-handoff` says it answers, without trusting that it says anything.
 *
 * A Replay records what somebody intended, including intentions the domain refused **because** they were
 * malformed — `decide` refuses a `submit-handoff` whose Handoff was lost to a cast, and `submit` records
 * that Refusal with its Command. So a reading over one is handed values no rule validated, and it reads
 * them as `unknown`, exactly as `stepsOf` does in the engine. The condition stays inline in the `if`,
 * because TypeScript does not narrow through an aliased compound condition that uses `in`.
 */
function answeredBy(claimed: Handoff): string | undefined {
  const value: unknown = claimed;
  if (
    typeof value === "object" &&
    value !== null &&
    "delegationId" in value &&
    typeof value.delegationId === "string"
  ) {
    return value.delegationId;
  }
  return undefined;
}

/**
 * The Delivery a settled Mission consolidates to: the Combination's deliverable, and every artifact its
 * accepted Handoffs carried.
 *
 * Consolidating is the Core's own job — the glossary says it delegates, chases and consolidates — and this
 * is the whole of it: the summary is declared data, and the proof is what the Zords actually handed over
 * rather than what the recipe hoped for. A Combination that declared its own artifacts could promise proof
 * nobody produced.
 *
 * One artifact is one proof, so a path two Zords both name is listed once, first occurrence first. Keeping
 * both would inflate what a human is shown as proof of the same thing.
 */
function deliveryOf(recipe: Combination, state: RunningMission): Delivery {
  const proof: string[] = [];
  const seen = new Set<string>();

  for (const delegation of state.delegations) {
    // Read as `unknown`: this came off a file the store does not judge, and the Delivery is computed with
    // it. An unreadable list contributes nothing rather than throwing — Gap 6.
    const artifacts: unknown = delegation.handoff?.artifacts;
    if (!Array.isArray(artifacts)) {
      continue;
    }
    const listed: readonly unknown[] = artifacts;
    for (const artifact of listed) {
      if (typeof artifact !== "string" || seen.has(artifact)) {
        continue;
      }
      seen.add(artifact);
      proof.push(artifact);
    }
  }

  return { summary: recipe.deliverable, artifacts: proof };
}

/* -------------------------------------------------------------------------------------------------
 * Internals: one gesture
 * ---------------------------------------------------------------------------------------------- */

/**
 * Submits one Command and records what the domain answered.
 *
 * Every line is the engine's or the store's, and the path is the one `cockpit/server.ts` and
 * `runtime/mcp-server.ts` both take: load the Replay with no cache, `submit` against `stateOf` of it,
 * append the entry. **Refused as well as accepted**, because a Surface that recorded only what it accepted
 * would lose every Refusal, which is the half of the Replay a human most needs — and the drive's own
 * Refusals are exactly the ones that explain why it stopped.
 *
 * Answers the refused Step when the Command was refused, and `undefined` when it was accepted.
 */
async function record(options: DriveOptions, command: MissionCommand): Promise<RefusedStep | undefined> {
  const recorded = await options.store.load(options.missionId);
  const next = submit(recorded, command);
  // `submit` appends exactly one entry and never throws, so the last one is this Command's.
  const entry: ReplayEntry = next[next.length - 1];
  await options.store.append(options.missionId, entry);

  if (entry.decision.kind === "accepted") {
    return undefined;
  }
  // The entry just appended is the last one and it was refused, so the last refused Step is this
  // Command's. Read through `refusedIn` rather than cast, so the narrowing is the compiler's.
  const refused = refusedIn(stepsOf(next));
  return refused[refused.length - 1];
}

/** The drive's answer, with the Replay re-read so what it hands back includes its own last gesture. */
async function done(options: DriveOptions, outcome: DriveOutcome): Promise<Drive> {
  return { outcome, replay: await options.store.load(options.missionId) };
}

/**
 * The Instant a Command is submitted at, read off the injected clock without trusting it.
 *
 * A clock that answers something that is not an Instant would write an unreadable moment into the record
 * permanently, and unlike every other failure here there is no honest outcome to answer with: the drive
 * cannot make its next gesture without a time, so it rejects.
 */
function instantAt(options: DriveOptions): Instant {
  let answered: unknown;
  try {
    answered = options.now();
  } catch (cause) {
    throw new BrokenClockError(`failed: ${messageOf(cause)}`);
  }
  if (typeof answered !== "string" || answered.trim().length === 0) {
    throw new BrokenClockError(`answered ${shown(answered)}, which is not an Instant`);
  }
  return answered as Instant;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: checks and shapes
 * ---------------------------------------------------------------------------------------------- */

/** The numeric options, checked before the first gesture. Every violation at once, like everything here. */
function checkOptions(options: DriveOptions): void {
  const violations: string[] = [];

  checkWhole("settleTimeoutMs", options.settleTimeoutMs, 0, violations);
  checkWhole("pollEveryMs", options.pollEveryMs, 1, violations);
  checkWhole("maxAttemptsPerDelegation", options.maxAttemptsPerDelegation, 1, violations);

  const runner: unknown = options.runner;
  if (typeof runner !== "object" || runner === null || !("run" in runner) || typeof runner.run !== "function") {
    violations.push("runner must be an AgentRunner, and this one has no run");
  }
  if (typeof options.now !== "function") {
    violations.push(`now must be the function this drive reads time from, received ${shown(options.now)}`);
  }

  if (violations.length > 0) {
    throw new InvalidDriveError(violations);
  }
}

function checkWhole(field: string, claimed: number, least: number, violations: string[]): void {
  const value: unknown = claimed;
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    violations.push(`${field} must be a whole number of at least ${least}, received ${shown(value)}`);
  }
}

/** A required piece of text that has to say something. Never trimmed: what was written is what is used. */
function checkSaid(field: string, claimed: string, says: string, violations: string[]): void {
  const value: unknown = claimed;
  if (typeof value !== "string") {
    violations.push(`${field} must be a string, received ${shown(value)}`);
    return;
  }
  if (value.trim().length === 0) {
    violations.push(`${field} must say ${says}, received ${shown(value)}`);
  }
}

/**
 * A field read as a list, whatever it turned out to be.
 *
 * The same shape `validateHandoff` uses: a violation and an empty list, so the rest of the check still
 * runs and the author hears about everything at once rather than one thing per attempt.
 */
function asList<TEntry>(claimed: readonly TEntry[], field: string, violations: string[]): readonly TEntry[] {
  const value: unknown = claimed;
  if (!Array.isArray(value)) {
    violations.push(`${field} must be a list, received ${shown(value)}`);
    return [];
  }
  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const listed: readonly TEntry[] = value;
  return listed;
}

/** Waits, and nothing else. The only reason this module touches a timer at all. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure. Mirrors the engine, both stores and the control plane. */
function shown(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? "a list" : "an object";
  }
  return String(value);
}
