import { describe, expect, it } from "vitest";

import { clauseId, delegationId } from "@engine/domain/ids";
import {
  InvalidGapError,
  InvalidHandoffError,
  gap,
  handoff,
  type Gap,
  type Handoff,
} from "@engine/domain/handoff";

const DELEGATION = delegationId("delegation-1");
const RENDERS = clauseId("clause-renders");
const TESTED = clauseId("clause-tested");
const NOTES = clauseId("clause-notes");

function answering(overrides: Partial<Handoff> = {}): Handoff {
  return handoff({
    delegationId: DELEGATION,
    satisfies: [RENDERS, TESTED],
    gaps: [gap(NOTES, "the Surfaces are still moving")],
    artifacts: ["cockpit.tsx", "cockpit.test.tsx"],
    ...overrides,
  });
}

describe("declaring a Gap", () => {
  it("names the Clause it did not cover, and why", () => {
    const declared = gap(NOTES, "the Surfaces are still moving");

    expect(declared.clauseId).toBe(NOTES);
    expect(declared.reason).toBe("the Surfaces are still moving");
    expect(Object.isFrozen(declared)).toBe(true);
  });

  it("refuses a Gap that says nothing about why", () => {
    expect(() => gap(NOTES, "")).toThrow(InvalidGapError);
    expect(() => gap(NOTES, "   ")).toThrow(/reason must say why the Clause was not covered/);
  });

  it("refuses a Gap that names no Clause, even when the type was bypassed", () => {
    // Cast rather than `clauseId(" ")`, which would throw in the id constructor and prove nothing here.
    expect(() => gap(" " as typeof NOTES, "no time")).toThrow(/clauseId must name something/);
    expect(() => gap(undefined as unknown as typeof NOTES, "no time")).toThrow(
      /clauseId must be a string/,
    );
  });
});

describe("handing off", () => {
  it("carries what it answers, what it covered, what it did not, and the proof", () => {
    const submitted = answering();

    expect(submitted.delegationId).toBe(DELEGATION);
    expect(submitted.satisfies).toEqual([RENDERS, TESTED]);
    expect(submitted.gaps).toEqual([{ clauseId: NOTES, reason: "the Surfaces are still moving" }]);
    expect(submitted.artifacts).toEqual(["cockpit.tsx", "cockpit.test.tsx"]);
  });

  it("hands over a claim nobody can add to afterwards", () => {
    const submitted = answering();

    expect(Object.isFrozen(submitted)).toBe(true);
    expect(Object.isFrozen(submitted.satisfies)).toBe(true);
    expect(Object.isFrozen(submitted.gaps)).toBe(true);
    expect(Object.isFrozen(submitted.gaps[0])).toBe(true);
    expect(Object.isFrozen(submitted.artifacts)).toBe(true);
  });

  it("copies the lists it was given, so the caller cannot change the claim after the fact", () => {
    const satisfies = [RENDERS];
    const submitted = handoff({
      delegationId: DELEGATION,
      satisfies,
      gaps: [],
      artifacts: [],
    });

    satisfies.push(TESTED);

    expect(submitted.satisfies).toEqual([RENDERS]);
  });

  /** Empty is an answer: a Handoff that claims nothing is a claim, and the Contract says what it costs. */
  it("accepts a Handoff that claims nothing and declares nothing", () => {
    const submitted = answering({ satisfies: [], gaps: [], artifacts: [] });

    expect(submitted.satisfies).toEqual([]);
    expect(submitted.gaps).toEqual([]);
  });

  it("refuses a Handoff that does not say which Delegation it answers", () => {
    expect(() =>
      handoff({ delegationId: " " as typeof DELEGATION, satisfies: [], gaps: [], artifacts: [] }),
    ).toThrow(/delegationId must name something/);
  });

  it("refuses a Clause claimed twice, rather than collapsing the mistake", () => {
    expect(() => answering({ satisfies: [RENDERS, TESTED, RENDERS] })).toThrow(
      /satisfies must list each Clause once, received clause-renders twice/,
    );
  });

  it("refuses two Gaps about one Clause, which do not say which excuse applies", () => {
    expect(() =>
      answering({ gaps: [gap(NOTES, "still moving"), gap(NOTES, "ran out of time")] }),
    ).toThrow(/gaps must declare each Clause once, received clause-notes twice/);
  });

  it("refuses an artifact that names nothing, and one offered twice", () => {
    expect(() => answering({ artifacts: ["cockpit.tsx", "  "] })).toThrow(
      /artifacts\[1\] must name a artifact/,
    );
    expect(() => answering({ artifacts: ["cockpit.tsx", "cockpit.tsx"] })).toThrow(
      /artifacts must list each artifact once/,
    );
  });

  it("reports every malformed field at once rather than the first", () => {
    let message = "";
    try {
      handoff({
        delegationId: "" as typeof DELEGATION,
        satisfies: ["" as typeof RENDERS],
        gaps: [{ clauseId: NOTES, reason: "" } as Gap],
        artifacts: [" "],
      });
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : String(thrown);
    }

    expect(message).toMatch(/delegationId must name something/);
    expect(message).toMatch(/satisfies\[0\]/);
    expect(message).toMatch(/gaps\[0\]/);
    expect(message).toMatch(/artifacts\[0\]/);
  });

  it("does not trust its parameter type, because a Handoff comes from outside the domain", () => {
    const forced = {
      delegationId: DELEGATION,
      satisfies: "clause-renders",
      gaps: [],
      artifacts: [],
    } as unknown as Handoff;

    expect(() => handoff(forced)).toThrow(InvalidHandoffError);
    expect(() => handoff(forced)).toThrow(/satisfies must be a list of Clause names/);
  });

  it("refuses a gaps entry that is not a Gap at all", () => {
    const forced = {
      delegationId: DELEGATION,
      satisfies: [],
      gaps: ["clause-notes"],
      artifacts: [],
    } as unknown as Handoff;

    expect(() => handoff(forced)).toThrow(/gaps\[0\] must declare a Gap, received "clause-notes"/);
  });

  it("refuses a gaps entry shaped like a Gap but carrying nothing", () => {
    const forced = {
      delegationId: DELEGATION,
      satisfies: [],
      gaps: [{}],
      artifacts: [],
    } as unknown as Handoff;

    expect(() => handoff(forced)).toThrow(/gaps\[0\]: clauseId must be a string/);
  });
});

/**
 * The compile-time half. Each probe is falsified by breaking the guarantee at its source and confirming
 * `tsc` reports `TS2578: Unused '@ts-expect-error' directive`.
 */
describe("what the type system refuses", () => {
  /**
   * The type-level half of the judgement call in `contract.test.ts`: a Gap that is about nothing would
   * excuse every optional Clause at once, so a Gap cannot be built without naming its Clause.
   */
  it("refuses a Gap that does not say which Clause it is about", () => {
    const rejected = (): Gap => {
      // @ts-expect-error a Gap about nothing in particular would excuse everything: name the Clause
      const declared: Gap = { reason: "ran out of time" };
      return declared;
    };

    expect(rejected().reason).toBe("ran out of time");
  });

  it("refuses a Gap with no reason", () => {
    const rejected = (): Gap => {
      // @ts-expect-error a Gap with no reason is a shrug: a human cannot decide whether it matters
      const declared: Gap = { clauseId: NOTES };
      return declared;
    };

    expect(rejected().clauseId).toBe(NOTES);
  });

  it("refuses a Handoff that is silent about what it did not cover", () => {
    const rejected = (): Handoff => {
      // @ts-expect-error silence about Gaps would have to be interpreted: declare an empty list instead
      const submitted: Handoff = {
        delegationId: DELEGATION,
        satisfies: [RENDERS],
        artifacts: [],
      };
      return submitted;
    };

    expect(rejected().satisfies).toEqual([RENDERS]);
  });

  it("refuses a raw string where a ClauseId is claimed", () => {
    const rejected = (): Handoff =>
      handoff({
        delegationId: DELEGATION,
        // @ts-expect-error an unchecked string is not a ClauseId: it may identify nothing
        satisfies: ["clause-renders"],
        gaps: [],
        artifacts: [],
      });

    expect(rejected().satisfies).toEqual(["clause-renders"]);
  });

  it("refuses adding a Clause to a Handoff that was already handed over", () => {
    const submitted = answering();

    // @ts-expect-error a Handoff is a claim, recorded as made: nothing is appended to it afterwards
    const rejected = (): number => submitted.satisfies.push(NOTES);

    // Frozen as well as readonly, so the claim cannot grow at runtime either.
    expect(rejected).toThrow(TypeError);
    expect(submitted.satisfies).toEqual([RENDERS, TESTED]);
  });
});
