/**
 * The Handoff: how a Zord answers a Delegation, and the Gaps it declares.
 *
 * A Handoff is the structured delivery of a Zord — which Delegation it answers, which Clauses of that
 * Delegation's Contract it satisfies, what it explicitly did not cover, and the artifacts that prove
 * the work exists. It is a **claim**, not a fact: the Core judges it against the Contract
 * (`validateHandoff` in `contract.ts`) and either accepts it or refuses it, and only the acceptance
 * becomes an Event.
 *
 * ## A Gap names the Clause it did not cover
 *
 * This is the decision that keeps the Gap rule from being a loophole. The Contract rule says an
 * optional Clause left unsatisfied passes *only when declared as a Gap*; if a Gap were free text with
 * no Clause attached, one Gap ("ran out of time") would excuse every optional Clause in the Contract
 * at once, and the declaration would carry no information at all — a Handoff could pass by admitting
 * to something unrelated. So `clauseId` is required, and it is required *at the type level*: a Gap
 * that does not say which Clause it is about does not compile.
 *
 * The `reason` is required too, and for a smaller reason: the value of a declared Gap over silence is
 * that a human can decide whether it matters, and that needs the why. A Gap with a blank reason is a
 * shrug dressed as a declaration.
 *
 * ## What is checked here, and what is checked against the Contract
 *
 * There are two different questions, and keeping them apart is what makes each one answerable:
 *
 * - **Is this Handoff well formed in itself?** `handoff()` answers it — no blank name, no Clause
 *   claimed twice, no Gap declared twice for one Clause. These are mistakes at the source, and a list
 *   that says the same thing twice is refused rather than quietly collapsed, exactly as `harness()`
 *   refuses a Skill listed twice.
 * - **Does it honour the Contract it answers?** `validateHandoff` answers it, and it needs the
 *   Contract to do so. It never throws and it never reads this file's constructors: a Handoff that
 *   arrived through a cast or a `JSON.parse` is still judged, just as it is.
 *
 * `Refusal` is *not* in this file, although the techspec's file list put it here. It is the return
 * type of `decide`, so it lives with `decide` in `mission.ts`; see the note in `CLAUDE.md`.
 */

import type { ClauseId, DelegationId } from "./ids";

/**
 * What a Handoff explicitly declares it did not cover, and which Clause it is about.
 *
 * Not modelled as a union with a "whole Handoff" variant: a Gap that is about nothing is the loophole
 * described at the top of this file, so there is no such variant to model.
 */
export type Gap = {
  /** The Clause this Gap is about. Required: a Gap that excuses nothing in particular excuses all. */
  readonly clauseId: ClauseId;
  /** Why it was not covered. Required: a Gap with no reason is a shrug. */
  readonly reason: string;
};

/** Raised when a Gap cannot say what it did not cover, or why. */
export class InvalidGapError extends Error {
  constructor(violations: readonly string[]) {
    super(`Gap is not a declaration: ${violations.join("; ")}`);
    this.name = "InvalidGapError";
  }
}

/**
 * Declares a Gap on one Clause.
 *
 * @throws {InvalidGapError} when the Clause is not named or the reason says nothing.
 */
export function gap(clauseId: ClauseId, reason: string): Gap {
  const violations = gapViolations(clauseId, reason);
  if (violations.length > 0) {
    throw new InvalidGapError(violations);
  }
  return Object.freeze({ clauseId, reason });
}

/**
 * The structured delivery of a Zord: what it answers, what it covered, what it did not, and the proof.
 *
 * Every field is required. A Handoff that does not say which Delegation it answers cannot be judged
 * against any Contract; one that omits `satisfies` or `gaps` is silent about the very thing the Core
 * has to read, and silence would then have to be interpreted — which is how "it passed" becomes an
 * accident. An **empty** list, on the other hand, is a perfectly good answer: `satisfies: []` claims
 * nothing was covered, and the Contract rule will say what that costs.
 */
export type Handoff = {
  /** The Delegation this Handoff answers. It is the only thing a Handoff can answer. */
  readonly delegationId: DelegationId;
  /** The Clauses of the reference Contract this Handoff claims to have covered. */
  readonly satisfies: readonly ClauseId[];
  /** What it declares it did not cover, one entry per Clause. */
  readonly gaps: readonly Gap[];
  /** What proves the work exists: paths, ids, references. The domain does not judge what they mean. */
  readonly artifacts: readonly string[];
};

/** Raised when a Handoff carries a value that cannot be read as a claim. */
export class InvalidHandoffError extends Error {
  constructor(violations: readonly string[]) {
    super(`Handoff is not a claim anybody can judge: ${violations.join("; ")}`);
    this.name = "InvalidHandoffError";
  }
}

/**
 * Checks a Handoff and freezes it.
 *
 * The runtime half of the shape: like `harness()`, it does not trust its parameter type, because a
 * Handoff can arrive from a Zord's output, from `JSON.parse` or through a cast. Every field is read as
 * `unknown` and decided on its own terms, and every violation is reported at once — a Handoff can be
 * malformed in more than one way, and naming only the first sends the Zord round the loop twice.
 *
 * The lists are copied before being frozen, so nothing can be added to a Handoff after it was handed
 * over. This is *not* where the Contract is consulted: see `validateHandoff`.
 *
 * @throws {InvalidHandoffError} on a blank DelegationId, a blank or repeated ClauseId in `satisfies`,
 *   a Gap that names no Clause or gives no reason, two Gaps about one Clause, or a blank or repeated
 *   artifact.
 */
export function handoff(fields: Handoff): Handoff {
  const violations: string[] = [];

  checkName("delegationId", fields.delegationId, violations);
  checkList("satisfies", fields.satisfies, "Clause", violations);
  const gaps = checkGaps(fields.gaps, violations);
  checkList("artifacts", fields.artifacts, "artifact", violations);

  if (violations.length > 0) {
    throw new InvalidHandoffError(violations);
  }

  return Object.freeze({
    delegationId: fields.delegationId,
    satisfies: Object.freeze([...fields.satisfies]),
    gaps: Object.freeze(gaps),
    artifacts: Object.freeze([...fields.artifacts]),
  });
}

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

/** The violations of one Gap, collected rather than thrown, so `handoff()` can report all of them. */
function gapViolations(clauseId: ClauseId, reason: string): readonly string[] {
  const violations: string[] = [];
  checkName("clauseId", clauseId, violations);

  const value: unknown = reason;
  if (typeof value !== "string") {
    violations.push(`reason must be a string, received ${shown(value)}`);
  } else if (value.trim().length === 0) {
    violations.push(`reason must say why the Clause was not covered, received ${shown(value)}`);
  }
  return violations;
}

/** A single id or name: a string that names something. Never trimmed, never normalised. */
function checkName(field: string, claimed: string, violations: string[]): void {
  const value: unknown = claimed;

  if (typeof value !== "string") {
    violations.push(`${field} must be a string, received ${shown(value)}`);
    return;
  }
  if (value.trim().length === 0) {
    violations.push(`${field} must name something, received ${shown(value)}`);
  }
}

/**
 * A list of names, each naming something, none listed twice.
 *
 * A repeat is refused rather than de-duplicated: claiming one Clause twice, or offering one artifact
 * twice, is a mistake in whatever produced the Handoff, and collapsing it would hide the mistake at
 * the one moment somebody is looking at the claim.
 */
function checkList(
  field: string,
  claimed: readonly string[],
  noun: string,
  violations: string[],
): void {
  const value: unknown = claimed;

  if (!Array.isArray(value)) {
    violations.push(`${field} must be a list of ${noun} names, received ${shown(value)}`);
    return;
  }

  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const listed: readonly unknown[] = value;
  const seen = new Set<string>();
  const repeated: string[] = [];

  listed.forEach((entry, position) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      violations.push(`${field}[${position}] must name a ${noun}, received ${shown(entry)}`);
      return;
    }
    if (seen.has(entry)) {
      repeated.push(entry);
      return;
    }
    seen.add(entry);
  });

  if (repeated.length > 0) {
    violations.push(`${field} must list each ${noun} once, received ${repeated.join(", ")} twice`);
  }
}

/** The declared Gaps, each checked and frozen. Two Gaps about one Clause are refused. */
function checkGaps(claimed: readonly Gap[], violations: string[]): Gap[] {
  const value: unknown = claimed;

  if (!Array.isArray(value)) {
    violations.push(`gaps must be a list of declared Gaps, received ${shown(value)}`);
    return [];
  }

  const listed: readonly unknown[] = value;
  const declared: Gap[] = [];
  const about = new Set<string>();
  const repeated: string[] = [];

  listed.forEach((entry, position) => {
    if (typeof entry !== "object" || entry === null) {
      violations.push(`gaps[${position}] must declare a Gap, received ${shown(entry)}`);
      return;
    }
    const claimedGap = entry as Gap;
    const own = gapViolations(claimedGap.clauseId, claimedGap.reason);
    if (own.length > 0) {
      own.forEach((violation) => violations.push(`gaps[${position}]: ${violation}`));
      return;
    }
    if (about.has(claimedGap.clauseId)) {
      repeated.push(claimedGap.clauseId);
      return;
    }
    about.add(claimedGap.clauseId);
    declared.push(Object.freeze({ clauseId: claimedGap.clauseId, reason: claimedGap.reason }));
  });

  if (repeated.length > 0) {
    violations.push(
      `gaps must declare each Clause once, received ${repeated.join(", ")} twice`,
    );
  }

  return declared;
}

/** How a refused value reads inside a violation. */
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
