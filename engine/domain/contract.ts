/**
 * The Contract: what a Handoff is accepted or refused against, and the one rule that decides.
 *
 * A Contract is the interface agreed between Zords before code exists. It is a list of Clauses, each
 * of which a Handoff either satisfies or does not, and each of which is either **required** or
 * optional. Nothing else: no payload shape, no schema, no types. That is why there is no schema
 * library here — a Contract is not a shape a value conforms to, it is an agreement a delivery is held
 * to, and the two have different rules.
 *
 * ## The rule
 *
 * ```
 * required, satisfied            -> fine
 * required, not satisfied        -> violation, EVEN IF declared as a Gap
 * optional, satisfied            -> fine
 * optional, not satisfied, Gap   -> fine
 * optional, not satisfied, no Gap-> violation
 * ```
 *
 * The asymmetry is the whole product promise. A Gap is an honest declaration, and honesty is worth
 * something: on an optional Clause it turns "silently missing" into "deliberately not covered", and
 * that is enough to accept the Handoff. On a **required** Clause it is worth nothing, because a
 * required Clause is not a preference — declaring it as a Gap is a Zord announcing it did not do the
 * job, and announcing it does not make the job done. A model where a Gap excused anything would let
 * every Handoff pass by declaring every Clause as a Gap, and the Refusal would become decoration.
 *
 * Two more violations fall out of taking the claim seriously, and neither is scope creep — each is a
 * Handoff that cannot be read at all:
 *
 * - **Satisfied and declared as a Gap at the same time.** The Handoff says both "I covered it" and "I
 *   did not". There is no reading of that which a human should have to guess at.
 * - **A ClauseId the Contract does not have.** The Handoff is answering some other Contract, or has a
 *   typo. Accepting it would mean the Core read a claim about a Clause nobody agreed to and counted it
 *   as progress — which is the silent drift this engine exists to prevent.
 *
 * `validateHandoff` **never throws**: it is called from `decide`, which is contractually non-throwing,
 * and it must be able to judge a Handoff that arrived through a cast or a `JSON.parse` rather than
 * through `handoff()`. It returns the violations, in Contract order, and an empty list means valid.
 */

import type { ClauseId } from "./ids";
import type { Gap, Handoff } from "./handoff";

/** One thing a Contract asks for, which a Handoff either satisfies or does not. */
export type Clause = {
  /** Identifies the Clause. What a Handoff points at when it claims to have covered it. */
  readonly id: ClauseId;
  /** What it asks for, in words a human can hold a delivery to. */
  readonly description: string;
  /** Whether a Gap can excuse it. `false` means it can; `true` means nothing can. */
  readonly required: boolean;
};

/** The interface agreed between Zords, and the reference a Handoff is accepted or refused against. */
export type Contract = {
  readonly clauses: readonly Clause[];
};

/** Raised when a Clause or a Contract carries a value nothing can be held to. */
export class InvalidContractError extends Error {
  constructor(violations: readonly string[]) {
    super(`Contract cannot hold a delivery to anything: ${violations.join("; ")}`);
    this.name = "InvalidContractError";
  }
}

/**
 * Checks a Clause and freezes it.
 *
 * `required` is checked at runtime as well as typed, because it is the field the whole rule turns on:
 * a Clause that arrived through a cast with `required: undefined` would be read as falsy and silently
 * become optional — the one mistake in this file that would weaken the promise without failing
 * anywhere.
 *
 * @throws {InvalidContractError} on a blank id, a blank description, or a `required` that is not a
 *   boolean.
 */
export function clause(fields: Clause): Clause {
  const violations: string[] = [];

  checkName("id", fields.id, violations);

  const description: unknown = fields.description;
  if (typeof description !== "string") {
    violations.push(`description must be a string, received ${shown(description)}`);
  } else if (description.trim().length === 0) {
    violations.push(
      `description must say what the Clause asks for, received ${shown(description)}`,
    );
  }

  const required: unknown = fields.required;
  if (typeof required !== "boolean") {
    violations.push(
      `required must be true or false — a Clause is required or it is not — received ${shown(required)}`,
    );
  }

  if (violations.length > 0) {
    throw new InvalidContractError(violations);
  }

  return Object.freeze({
    id: fields.id,
    description: fields.description,
    required: fields.required,
  });
}

/**
 * Checks a Contract and freezes it, Clauses and all.
 *
 * Two Clauses under one ClauseId are refused: a Handoff satisfying that id would not say which of the
 * two it covered, and a violation naming it would not say which one it broke.
 *
 * An **empty** Contract is accepted. It is how a Delegation says "there is nothing here to be held
 * to" — an exploratory Slice whose whole outcome is a report has no verifiable Clause, and forcing a
 * fake one in would put a lie in the Contract to satisfy a rule. Empty is an answer; it is just not
 * the default, because a Delegation must state its Contract explicitly (see `Delegate`).
 *
 * @throws {InvalidContractError} on a Clause that is not one, or a ClauseId used twice.
 */
export function contract(clauses: readonly Clause[]): Contract {
  const value: unknown = clauses;

  if (!Array.isArray(value)) {
    throw new InvalidContractError([`clauses must be a list of Clauses, received ${shown(value)}`]);
  }

  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const listed: readonly unknown[] = value;
  const checked: Clause[] = [];
  const violations: string[] = [];
  const seen = new Set<string>();
  const repeated: string[] = [];

  listed.forEach((entry, position) => {
    if (typeof entry !== "object" || entry === null) {
      violations.push(`clauses[${position}] must be a Clause, received ${shown(entry)}`);
      return;
    }
    let agreed: Clause;
    try {
      agreed = clause(entry as Clause);
    } catch (thrown) {
      violations.push(
        `clauses[${position}]: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
      return;
    }
    if (seen.has(agreed.id)) {
      repeated.push(agreed.id);
      return;
    }
    seen.add(agreed.id);
    checked.push(agreed);
  });

  if (repeated.length > 0) {
    violations.push(`clauses must state each Clause once, received ${repeated.join(", ")} twice`);
  }
  if (violations.length > 0) {
    throw new InvalidContractError(violations);
  }

  return Object.freeze({ clauses: Object.freeze(checked) });
}

/**
 * Judges a Handoff against the Contract it answers, and returns what it broke. Empty means valid.
 *
 * Pure, total, and non-throwing. It reads two records and returns strings — there is no way for this
 * function to ask a human anything, which is what makes criterion 3 ("refused with no human
 * involvement") a property of the shape rather than a promise about behaviour.
 *
 * The violations come out in Contract order, so a Refusal reads like the Contract it is about, and the
 * unrecognised ClauseIds come last, in the order the Handoff listed them. Deterministic either way: the
 * same pair always produces the same list.
 */
export function validateHandoff(reference: Contract, submitted: Handoff): readonly string[] {
  const violations: string[] = [];

  // The three lists are read as `unknown` first. Their types are a claim: a Handoff can arrive from a
  // Zord's output or a `JSON.parse`, and a field that is not a list would make the loops below throw —
  // which `decide` has promised never to do. An unreadable field is reported as a violation and then
  // read as empty, so the Handoff is still judged rather than blowing up mid-Replay.
  const clauses = asList<Clause>(
    reference.clauses,
    "the Contract this Handoff answers states no list of Clauses",
    violations,
  );
  const claimed = asList<ClauseId>(
    submitted.satisfies,
    "this Handoff does not say which Clauses it satisfies",
    violations,
  );
  const gaps = asList<Gap>(
    submitted.gaps,
    "this Handoff does not say which Clauses it declares as Gaps",
    violations,
  );

  const satisfied: ReadonlySet<string> = new Set<string>(claimed);
  const declared = gapsByClause(gaps);
  const agreed: ReadonlySet<string> = new Set<string>(clauses.map((eachClause) => eachClause.id));

  for (const eachClause of clauses) {
    const asGap = declared.get(eachClause.id);
    const covered = satisfied.has(eachClause.id);

    if (covered && asGap !== undefined) {
      violations.push(
        `Clause ${named(eachClause.id, eachClause.description)} is satisfied and declared as a Gap ` +
          `at the same time, so this Handoff does not say whether it was covered`,
      );
      continue;
    }
    if (covered) {
      continue;
    }
    if (eachClause.required) {
      violations.push(
        asGap === undefined
          ? `Clause ${named(eachClause.id, eachClause.description)} is required and was not satisfied`
          : `Clause ${named(eachClause.id, eachClause.description)} is required, so declaring it ` +
            `as a Gap does not excuse it: ${JSON.stringify(asGap.reason)}`,
      );
      continue;
    }
    if (asGap === undefined) {
      violations.push(
        `Clause ${named(eachClause.id, eachClause.description)} was not satisfied and was not ` +
          `declared as a Gap`,
      );
    }
  }

  for (const claim of claimed) {
    if (!agreed.has(claim)) {
      violations.push(
        `Clause "${claim}" is not part of the Contract this Handoff answers, ` +
          `so satisfying it means nothing`,
      );
    }
  }
  for (const [clauseIdentifier] of declared) {
    if (!agreed.has(clauseIdentifier)) {
      violations.push(
        `Clause "${clauseIdentifier}" is not part of the Contract this Handoff answers, ` +
          `so declaring it as a Gap means nothing`,
      );
    }
  }

  return violations;
}

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

/**
 * A field read as a list, whatever it turned out to be.
 *
 * Returns the entries when it is one, and an empty list plus a violation when it is not. The cast is
 * the point: this function checks that the value *is* a list, and the entries keep the type the field
 * claims — checking every entry too would make this a parser, and the deeper cases are what the
 * `try` around `validateHandoff` in `mission.ts` is for.
 */
function asList<TEntry>(value: unknown, unreadable: string, violations: string[]): readonly TEntry[] {
  if (Array.isArray(value)) {
    return value as readonly TEntry[];
  }
  violations.push(`${unreadable}, received ${shown(value)}`);
  return [];
}

/**
 * The declared Gaps, indexed by the Clause each one is about.
 *
 * A Map rather than a Set, because a required Clause's violation quotes the reason the Gap gave — the
 * human reading the Refusal should see what the Zord said, not just that it said something. The first
 * Gap about a Clause wins: `handoff()` refuses a repeat outright, and a Handoff that skipped that
 * check is folded deterministically rather than judged twice.
 */
function gapsByClause(gaps: readonly Gap[]): ReadonlyMap<string, Gap> {
  const declared = new Map<string, Gap>();
  for (const declaration of gaps) {
    if (!declared.has(declaration.clauseId)) {
      declared.set(declaration.clauseId, declaration);
    }
  }
  return declared;
}

/** How a Clause reads inside a violation: its id, and what it asked for. */
function named(id: ClauseId, description: string): string {
  return `"${id}" (${JSON.stringify(description)})`;
}

/** An id: a string that names something. Never trimmed, never normalised. */
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
