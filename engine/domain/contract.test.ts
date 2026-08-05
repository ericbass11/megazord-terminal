import { describe, expect, it } from "vitest";

import { clauseId, delegationId } from "@engine/domain/ids";
import { gap, handoff, type Gap, type Handoff } from "@engine/domain/handoff";
import {
  InvalidContractError,
  clause,
  contract,
  validateHandoff,
  type Clause,
  type Contract,
} from "@engine/domain/contract";

const DELEGATION = delegationId("delegation-1");

const RENDERS = clauseId("clause-renders");
const TESTED = clauseId("clause-tested");
const NOTES = clauseId("clause-notes");

/** Two required Clauses and one optional: the smallest Contract that tells the two rules apart. */
const REFERENCE: Contract = contract([
  clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required: true }),
  clause({ id: TESTED, description: "Every Pane has a test", required: true }),
  clause({ id: NOTES, description: "The Surfaces it touched are listed", required: false }),
]);

function answering(overrides: Partial<Handoff> = {}): Handoff {
  return handoff({
    delegationId: DELEGATION,
    satisfies: [RENDERS, TESTED],
    gaps: [gap(NOTES, "the Surfaces are still moving")],
    artifacts: ["cockpit.tsx"],
    ...overrides,
  });
}

/** A Handoff as it may arrive from outside: not built by `handoff()`, so nothing was checked. */
function raw(fields: Handoff): Handoff {
  return fields;
}

describe("stating a Contract", () => {
  it("states each Clause with what it asks for and whether anything can excuse it", () => {
    expect(REFERENCE.clauses).toHaveLength(3);
    expect(REFERENCE.clauses.map((agreed) => agreed.required)).toEqual([true, true, false]);
  });

  it("hands over a Contract nobody can rewrite afterwards", () => {
    expect(Object.isFrozen(REFERENCE)).toBe(true);
    expect(Object.isFrozen(REFERENCE.clauses)).toBe(true);
    expect(Object.isFrozen(REFERENCE.clauses[0])).toBe(true);
  });

  it("refuses a Clause that asks for nothing anybody can be held to", () => {
    expect(() => clause({ id: RENDERS, description: "  ", required: true })).toThrow(
      InvalidContractError,
    );
    expect(() => clause({ id: clauseId("c"), description: "", required: false })).toThrow(
      /description must say what the Clause asks for/,
    );
  });

  /**
   * `required` is the field the whole rule turns on, so it is checked at runtime and not only typed. A
   * Clause forced past the compiler with `required: undefined` would be read as falsy and quietly
   * become optional — the one mistake in this file that would weaken the promise without failing
   * anywhere.
   */
  it("refuses a Clause that does not say whether it is required", () => {
    const forced = { id: RENDERS, description: "The Cockpit renders" } as Clause;

    expect(() => clause(forced)).toThrow(/required must be true or false/);
  });

  it("refuses two Clauses under one ClauseId, which no violation could name unambiguously", () => {
    expect(() =>
      contract([
        clause({ id: RENDERS, description: "renders one Pane per Zord", required: true }),
        clause({ id: RENDERS, description: "renders fast", required: false }),
      ]),
    ).toThrow(/clauses must state each Clause once, received clause-renders twice/);
  });

  it("reports every malformed Clause at once rather than the first", () => {
    let message = "";
    try {
      contract([
        { id: clauseId("a"), description: "  ", required: true },
        { id: clauseId("b"), description: "fine", required: undefined } as unknown as Clause,
      ]);
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : String(thrown);
    }

    expect(message).toMatch(/clauses\[0\]/);
    expect(message).toMatch(/clauses\[1\]/);
  });

  /**
   * Empty is an answer. An exploratory Slice whose whole outcome is a report has no verifiable Clause,
   * and forcing a fake one in would put a lie in the Contract to satisfy a rule. What is *not* allowed
   * is leaving the Contract off a Delegation — see the `Delegate` Command.
   */
  it("accepts a Contract with no Clauses, which holds a delivery to nothing", () => {
    expect(contract([]).clauses).toEqual([]);
    expect(validateHandoff(contract([]), answering({ satisfies: [], gaps: [] }))).toEqual([]);
  });
});

/**
 * Criterion 3's rule, in isolation.
 *
 * ```
 * required, not satisfied         -> violation, EVEN IF declared as a Gap
 * optional, not satisfied, Gap    -> fine
 * optional, not satisfied, no Gap -> violation
 * ```
 */
describe("validating a Handoff against its Contract", () => {
  it("returns nothing when every required Clause is satisfied and the rest are declared", () => {
    expect(validateHandoff(REFERENCE, answering())).toEqual([]);
  });

  it("accepts a Handoff that satisfies the optional Clause too", () => {
    expect(
      validateHandoff(REFERENCE, answering({ satisfies: [RENDERS, TESTED, NOTES], gaps: [] })),
    ).toEqual([]);
  });

  it("reports a required Clause left unsatisfied", () => {
    expect(validateHandoff(REFERENCE, answering({ satisfies: [RENDERS] }))).toEqual([
      'Clause "clause-tested" ("Every Pane has a test") is required and was not satisfied',
    ]);
  });

  /** The rule that makes a Refusal mean something: a Gap does not excuse a required Clause. */
  it("reports a required Clause even when it is declared as a Gap, and quotes the excuse", () => {
    const excused = answering({
      satisfies: [RENDERS],
      gaps: [gap(TESTED, "no test harness was available"), gap(NOTES, "still moving")],
    });

    expect(validateHandoff(REFERENCE, excused)).toEqual([
      'Clause "clause-tested" ("Every Pane has a test") is required, so declaring it as a Gap does ' +
        'not excuse it: "no test harness was available"',
    ]);
  });

  it("accepts an optional Clause left unsatisfied when it is declared as a Gap", () => {
    expect(validateHandoff(REFERENCE, answering({ gaps: [gap(NOTES, "not stable yet")] }))).toEqual(
      [],
    );
  });

  it("reports an optional Clause left unsatisfied and undeclared", () => {
    expect(validateHandoff(REFERENCE, answering({ gaps: [] }))).toEqual([
      'Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was not ' +
        "declared as a Gap",
    ]);
  });

  /**
   * Judgement call: **a Gap must be about the Clause it excuses.** If any declared Gap were enough, one
   * Gap would excuse every optional Clause in the Contract at once and the declaration would carry no
   * information — a Handoff could pass by admitting to something unrelated. `Gap.clauseId` is required
   * at the type level, so a Gap about nothing cannot be built; this proves a Gap about *another* Clause
   * does not carry over to this one.
   */
  it("does not let a Gap on one Clause excuse a different one", () => {
    const lenient = contract([
      clause({ id: TESTED, description: "Every Pane has a test", required: false }),
      clause({ id: NOTES, description: "The Surfaces it touched are listed", required: false }),
    ]);
    const misdirected = answering({
      satisfies: [],
      gaps: [gap(TESTED, "no test harness was available")],
    });

    // TESTED is excused; NOTES is not, although the Handoff does declare a Gap.
    expect(validateHandoff(lenient, misdirected)).toEqual([
      'Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was not ' +
        "declared as a Gap",
    ]);
  });

  it("reports a Clause claimed and declared as a Gap at once, whatever its required flag", () => {
    for (const required of [true, false]) {
      const single = contract([
        clause({ id: RENDERS, description: "The Cockpit renders one Pane per Zord", required }),
      ]);
      const contradictory = answering({
        satisfies: [RENDERS],
        gaps: [gap(RENDERS, "half of it, really")],
      });

      expect(validateHandoff(single, contradictory), String(required)).toEqual([
        'Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is satisfied and ' +
          "declared as a Gap at the same time, so this Handoff does not say whether it was covered",
      ]);
    }
  });

  it("reports a ClauseId the Contract does not have, claimed or declared", () => {
    const invented = clauseId("clause-invented");

    expect(
      validateHandoff(REFERENCE, answering({ satisfies: [RENDERS, TESTED, invented] })),
    ).toEqual([
      'Clause "clause-invented" is not part of the Contract this Handoff answers, ' +
        "so satisfying it means nothing",
    ]);

    expect(
      validateHandoff(
        REFERENCE,
        answering({ gaps: [gap(NOTES, "still moving"), gap(invented, "never existed")] }),
      ),
    ).toEqual([
      'Clause "clause-invented" is not part of the Contract this Handoff answers, ' +
        "so declaring it as a Gap means nothing",
    ]);
  });

  it("reports every violation at once, in Contract order, with the unknown ones last", () => {
    const wrong = answering({
      satisfies: [clauseId("clause-invented")],
      gaps: [],
    });

    expect(validateHandoff(REFERENCE, wrong)).toEqual([
      'Clause "clause-renders" ("The Cockpit renders one Pane per Zord") is required and was not ' +
        "satisfied",
      'Clause "clause-tested" ("Every Pane has a test") is required and was not satisfied',
      'Clause "clause-notes" ("The Surfaces it touched are listed") was not satisfied and was not ' +
        "declared as a Gap",
      'Clause "clause-invented" is not part of the Contract this Handoff answers, ' +
        "so satisfying it means nothing",
    ]);
  });

  it("is deterministic and pure: same pair, same list, and neither side is touched", () => {
    const submitted = answering({ satisfies: [] });
    const beforeContract = structuredClone(REFERENCE);
    const beforeHandoff = structuredClone(submitted);

    expect(validateHandoff(REFERENCE, submitted)).toEqual(validateHandoff(REFERENCE, submitted));
    expect(REFERENCE).toEqual(beforeContract);
    expect(submitted).toEqual(beforeHandoff);
  });

  /**
   * It is called from `decide`, which is contractually non-throwing, and it must judge a Handoff that
   * arrived through a cast or a `JSON.parse` rather than through `handoff()`. So it never throws, and it
   * never consults this module's constructors.
   */
  it("never throws on a Handoff that never went through handoff()", () => {
    const malformed = raw({
      delegationId: DELEGATION,
      satisfies: [RENDERS, RENDERS],
      gaps: [{ clauseId: NOTES, reason: "one" } as Gap, { clauseId: NOTES, reason: "two" } as Gap],
      artifacts: [],
    });

    expect(() => validateHandoff(REFERENCE, malformed)).not.toThrow();
    // The repeated claim is idempotent and the first Gap about a Clause is the one that answers, so a
    // Handoff that skipped `handoff()` is still judged deterministically.
    expect(validateHandoff(REFERENCE, malformed)).toEqual([
      'Clause "clause-tested" ("Every Pane has a test") is required and was not satisfied',
    ]);
  });

  it("reports an unreadable field instead of throwing on it", () => {
    const silent = { delegationId: DELEGATION, artifacts: [] } as unknown as Handoff;

    expect(() => validateHandoff(REFERENCE, silent)).not.toThrow();
    expect(validateHandoff(REFERENCE, silent).slice(0, 2)).toEqual([
      "this Handoff does not say which Clauses it satisfies, received undefined",
      "this Handoff does not say which Clauses it declares as Gaps, received undefined",
    ]);
  });

  it("reports a Contract that states no list of Clauses", () => {
    const unreadable = { clauses: "everything" } as unknown as Contract;

    expect(validateHandoff(unreadable, answering())).toEqual([
      'the Contract this Handoff answers states no list of Clauses, received "everything"',
      'Clause "clause-renders" is not part of the Contract this Handoff answers, ' +
        "so satisfying it means nothing",
      'Clause "clause-tested" is not part of the Contract this Handoff answers, ' +
        "so satisfying it means nothing",
      'Clause "clause-notes" is not part of the Contract this Handoff answers, ' +
        "so declaring it as a Gap means nothing",
    ]);
  });

  it("reads no clock and rolls no dice", () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = (): number => {
      throw new Error("validateHandoff must not read a clock");
    };
    Math.random = (): number => {
      throw new Error("validateHandoff must not randomise");
    };

    try {
      expect(() => validateHandoff(REFERENCE, answering({ satisfies: [] }))).not.toThrow();
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });
});

/**
 * The compile-time half. Each probe is falsified by breaking the guarantee at its source and confirming
 * `tsc` reports `TS2578: Unused '@ts-expect-error' directive`.
 */
describe("what the type system refuses", () => {
  it("refuses a Clause that does not say whether it is required", () => {
    const rejected = (): Clause => {
      // @ts-expect-error required or optional is the rule: a Clause that omits it has no rule at all
      const agreed: Clause = { id: RENDERS, description: "The Cockpit renders" };
      return agreed;
    };

    expect(rejected().description).toBe("The Cockpit renders");
  });

  it("refuses a raw string where a ClauseId is required", () => {
    const rejected = (): Clause =>
      clause({
        // @ts-expect-error an unchecked string is not a ClauseId: it may identify nothing
        id: "clause-renders",
        description: "The Cockpit renders one Pane per Zord",
        required: true,
      });

    expect(rejected().id).toBe("clause-renders");
  });

  it("refuses rewriting a Clause of an agreed Contract", () => {
    const agreed: Clause = REFERENCE.clauses[0];

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject it.
    // @ts-expect-error a Contract is agreed before code exists and is not rewritten afterwards
    const rejected = (): void => void (agreed.required = agreed.required);

    // Frozen as well as readonly, so a Clause cannot be turned optional at runtime either.
    expect(rejected).toThrow(TypeError);
    expect(REFERENCE.clauses[0].required).toBe(true);
  });
});
