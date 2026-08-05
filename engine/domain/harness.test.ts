import { describe, expect, it } from "vitest";

import {
  EFFORTS,
  InvalidHarnessError,
  harness,
  resolveHarness,
  type Effort,
  type Harness,
} from "@engine/domain/harness";

/**
 * Forces a value past the type system, the way a deserialiser, a boundary or a deliberate `as` would.
 * Every use of it below exists to prove the runtime check still catches what the compiler can no
 * longer see.
 */
function forced<TClaimed>(value: unknown): TClaimed {
  return value as TClaimed;
}

/** The floor: complete by type, and checked because it went through `harness()`. */
const CATALOG_DEFAULT: Harness = harness({
  cli: "claude",
  model: "sonnet-4-5",
  effort: "medium",
  skills: ["catalog-baseline"],
});

/** What the Roster declares for the Role being invoked. Outranks everything. */
const ROSTER_ENTRY: Partial<Harness> = {
  cli: "codex",
  model: "gpt-5-codex",
  effort: "max",
  skills: ["roster-reviewer"],
};

/** What this one call asks for. Outranks the catalog default only. */
const INVOCATION: Partial<Harness> = {
  cli: "gemini",
  model: "gemini-3-pro",
  effort: "low",
  skills: ["invocation-scout"],
};

describe("Effort", () => {
  it("is the five reasoning budgets, ordered from least to most", () => {
    expect(EFFORTS).toEqual(["min", "low", "medium", "high", "max"]);
  });

  it("accepts every registered Effort as a Harness Effort", () => {
    for (const effort of EFFORTS) {
      const resolved = resolveHarness({
        invocation: { effort },
        catalogDefault: CATALOG_DEFAULT,
      });

      expect(resolved.effort, effort).toBe(effort);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 4: roster > invocation > catalog default, field by field
 * ---------------------------------------------------------------------------------------------- */

describe("resolveHarness — precedence", () => {
  it("lets the roster entry win every field it specifies", () => {
    const resolved = resolveHarness({
      rosterEntry: ROSTER_ENTRY,
      invocation: INVOCATION,
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved).toEqual({
      cli: "codex",
      model: "gpt-5-codex",
      effort: "max",
      skills: ["roster-reviewer"],
    });
  });

  it("lets the invocation win every field the roster entry leaves out", () => {
    const resolved = resolveHarness({
      rosterEntry: {},
      invocation: INVOCATION,
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved).toEqual({
      cli: "gemini",
      model: "gemini-3-pro",
      effort: "low",
      skills: ["invocation-scout"],
    });
  });

  it("treats a missing roster entry the same as an empty one", () => {
    expect(resolveHarness({ invocation: INVOCATION, catalogDefault: CATALOG_DEFAULT })).toEqual(
      resolveHarness({ rosterEntry: {}, invocation: INVOCATION, catalogDefault: CATALOG_DEFAULT }),
    );
  });

  it("falls through to the catalog default when neither source speaks", () => {
    expect(
      resolveHarness({ rosterEntry: {}, invocation: {}, catalogDefault: CATALOG_DEFAULT }),
    ).toEqual(CATALOG_DEFAULT);
    expect(resolveHarness({ catalogDefault: CATALOG_DEFAULT })).toEqual(CATALOG_DEFAULT);
  });

  it("resolves field by field, so different fields come from different sources", () => {
    const resolved = resolveHarness({
      // cli from the Roster, which outranks the "gemini" this call asked for.
      rosterEntry: { cli: "codex" },
      // model and skills from the invocation, which the Roster says nothing about.
      invocation: { cli: "gemini", model: "gpt-5-codex", skills: ["invocation-scout"] },
      // effort from the catalog default: nobody else mentioned it.
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved).toEqual({
      cli: "codex",
      model: "gpt-5-codex",
      effort: "medium",
      skills: ["invocation-scout"],
    });
  });

  it("does not let one specified field drag the others along with it", () => {
    const resolved = resolveHarness({
      rosterEntry: { effort: "max" },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved).toEqual({ ...CATALOG_DEFAULT, effort: "max" });
  });

  it("keeps the same precedence for every field, one field at a time", () => {
    const fields: readonly (keyof Harness)[] = ["cli", "model", "effort", "skills"];

    for (const field of fields) {
      const fromRoster = resolveHarness({
        rosterEntry: { [field]: ROSTER_ENTRY[field] },
        invocation: INVOCATION,
        catalogDefault: CATALOG_DEFAULT,
      });
      const fromInvocation = resolveHarness({
        invocation: { [field]: INVOCATION[field] },
        catalogDefault: CATALOG_DEFAULT,
      });

      expect(fromRoster[field], `${field} from the roster entry`).toEqual(ROSTER_ENTRY[field]);
      expect(fromInvocation[field], `${field} from the invocation`).toEqual(INVOCATION[field]);
      expect(
        resolveHarness({ catalogDefault: CATALOG_DEFAULT })[field],
        `${field} from the catalog default`,
      ).toEqual(CATALOG_DEFAULT[field]);
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * The two judgement calls: absent versus empty, and replace versus merge
 * ---------------------------------------------------------------------------------------------- */

describe("resolveHarness — an absent field falls through, an empty one is an answer", () => {
  it("reads `skills: []` in a roster entry as 'no Skills', not as 'not specified'", () => {
    const resolved = resolveHarness({
      rosterEntry: { skills: [] },
      invocation: { skills: ["invocation-scout"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual([]);
  });

  it("reads `skills: []` in the invocation as 'no Skills' when the Roster is silent", () => {
    const resolved = resolveHarness({
      invocation: { skills: [] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual([]);
  });

  it("falls through when the key is omitted", () => {
    const resolved = resolveHarness({
      rosterEntry: { cli: "codex" },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual(["catalog-baseline"]);
  });

  it("treats an explicit `undefined` as absent, exactly like an omitted key", () => {
    const withUndefined = resolveHarness({
      rosterEntry: { cli: undefined, model: undefined, effort: undefined, skills: undefined },
      invocation: INVOCATION,
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(withUndefined).toEqual(
      resolveHarness({ rosterEntry: {}, invocation: INVOCATION, catalogDefault: CATALOG_DEFAULT }),
    );
  });

  it("does not let an `undefined` in a high-precedence source erase the value below it", () => {
    // The spread-based resolution this function refuses to use would produce `model: undefined` here.
    const resolved = resolveHarness({
      rosterEntry: { model: undefined },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.model).toBe("sonnet-4-5");
  });

  it("refuses a blank cli instead of reading it as silence", () => {
    const blank = (): Harness =>
      resolveHarness({ rosterEntry: { cli: "   " }, catalogDefault: CATALOG_DEFAULT });

    expect(blank).toThrow(InvalidHarnessError);
    expect(blank).toThrow(/cli must name something/);
  });

  it("refuses a blank model instead of reading it as silence", () => {
    const blank = (): Harness =>
      resolveHarness({ invocation: { model: "" }, catalogDefault: CATALOG_DEFAULT });

    expect(blank).toThrow(/model must name something/);
  });

  it("refuses a blank Skill name, naming the position it sat in", () => {
    const blank = (): Harness =>
      resolveHarness({
        invocation: { skills: ["invocation-scout", " "] },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(blank).toThrow(InvalidHarnessError);
    expect(blank).toThrow(/skills\[1\] must name a Skill/);
  });

  it("does not normalise what it was given: a value is kept verbatim or refused", () => {
    const resolved = resolveHarness({
      invocation: { cli: "Claude ", model: "Sonnet-4-5" },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.cli).toBe("Claude ");
    expect(resolved.model).toBe("Sonnet-4-5");
  });
});

describe("resolveHarness — Skills replace, they never merge", () => {
  it("replaces the invocation's Skills with the Roster's, without merging them", () => {
    const resolved = resolveHarness({
      rosterEntry: { skills: ["roster-reviewer"] },
      invocation: { skills: ["invocation-scout", "invocation-builder"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual(["roster-reviewer"]);
    expect(resolved.skills).not.toContain("invocation-scout");
    expect(resolved.skills).not.toContain("catalog-baseline");
  });

  it("replaces the catalog default's Skills with the invocation's", () => {
    const resolved = resolveHarness({
      invocation: { skills: ["invocation-scout"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual(["invocation-scout"]);
  });

  it("lets a Roster invoke a Role bare, erasing the Skills every other source installs", () => {
    const resolved = resolveHarness({
      rosterEntry: { skills: [] },
      invocation: { skills: ["invocation-scout"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual([]);
  });

  it("keeps the winning list verbatim: same entries, same order", () => {
    const resolved = resolveHarness({
      invocation: { skills: ["zord-writer", "alpha-reader", "mid-checker"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual(["zord-writer", "alpha-reader", "mid-checker"]);
  });

  it("refuses a Skill listed twice rather than de-duplicating it", () => {
    const twice = (): Harness =>
      resolveHarness({
        invocation: { skills: ["invocation-scout", "invocation-scout"] },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(twice).toThrow(InvalidHarnessError);
    expect(twice).toThrow(/skills must list each Skill once, received invocation-scout twice/);
  });

  it("accepts the same Skill name appearing in two different sources", () => {
    // Not a duplicate: only one source wins, so the resolved list holds it once.
    const resolved = resolveHarness({
      rosterEntry: { skills: ["shared-skill"] },
      invocation: { skills: ["shared-skill"] },
      catalogDefault: CATALOG_DEFAULT,
    });

    expect(resolved.skills).toEqual(["shared-skill"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Determinism and purity
 * ---------------------------------------------------------------------------------------------- */

describe("resolveHarness — deterministic and pure", () => {
  it("resolves the same sources to the same Harness, every time", () => {
    const sources = {
      rosterEntry: { cli: "codex" },
      invocation: { model: "gpt-5-codex", skills: ["invocation-scout"] },
      catalogDefault: CATALOG_DEFAULT,
    };
    const first = resolveHarness(sources);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(resolveHarness(sources), `attempt ${attempt}`).toEqual(first);
    }
  });

  it("does not care in which order the sources were written", () => {
    expect(
      resolveHarness({
        catalogDefault: CATALOG_DEFAULT,
        invocation: INVOCATION,
        rosterEntry: { cli: "codex" },
      }),
    ).toEqual(
      resolveHarness({
        rosterEntry: { cli: "codex" },
        invocation: INVOCATION,
        catalogDefault: CATALOG_DEFAULT,
      }),
    );
  });

  it("does not touch the sources it was given", () => {
    const declared = ["roster-reviewer"];
    const rosterEntry: Partial<Harness> = { skills: declared };

    const resolved = resolveHarness({ rosterEntry, catalogDefault: CATALOG_DEFAULT });

    expect(Object.keys(rosterEntry)).toEqual(["skills"]);
    expect(declared).toEqual(["roster-reviewer"]);

    // And the resolved Harness is a copy: growing the source's list afterwards changes nothing.
    declared.push("smuggled-skill");
    expect(resolved.skills).toEqual(["roster-reviewer"]);
  });

  it("hands out a frozen bundle, so nothing downstream can rewrite what a Zord runs with", () => {
    const resolved = resolveHarness({ catalogDefault: CATALOG_DEFAULT });

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.skills)).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The runtime half: what a cast cannot get past
 * ---------------------------------------------------------------------------------------------- */

describe("harness — the runtime check behind the completeness guarantee", () => {
  it("builds, copies and freezes", () => {
    const granted = ["reviewer"];
    const built = harness({ cli: "claude", model: "opus-4-1", effort: "high", skills: granted });

    granted.push("smuggled-skill");

    expect(built).toEqual({
      cli: "claude",
      model: "opus-4-1",
      effort: "high",
      skills: ["reviewer"],
    });
    expect(() => forced<string[]>(built.skills).push("smuggled-skill")).toThrow(TypeError);
  });

  it("refuses a catalog default forced past the compiler with a field missing", () => {
    const incomplete = (): Harness =>
      resolveHarness({
        catalogDefault: forced<Harness>({ cli: "claude", effort: "medium", skills: [] }),
      });

    expect(incomplete).toThrow(InvalidHarnessError);
    expect(incomplete).toThrow(/model must be a string, received undefined/);
  });

  it("refuses an Effort forced past the compiler", () => {
    const smuggled = (): Harness =>
      resolveHarness({
        rosterEntry: { effort: forced<Effort>("turbo") },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(smuggled).toThrow(InvalidHarnessError);
    expect(smuggled).toThrow(/effort must be one of min, low, medium, high, max/);
  });

  it("refuses a Skill list that is not a list", () => {
    const smuggled = (): Harness =>
      resolveHarness({
        invocation: { skills: forced<readonly string[]>("invocation-scout") },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(smuggled).toThrow(/skills must be a list of Skill names, received "invocation-scout"/);
  });

  it("refuses a Skill entry that is not a name", () => {
    const smuggled = (): Harness =>
      resolveHarness({
        invocation: { skills: forced<readonly string[]>([7, null]) },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(smuggled).toThrow(/skills\[0\] must name a Skill, received 7/);
    expect(smuggled).toThrow(/skills\[1\] must name a Skill, received null/);
  });

  it("reports every violation at once, not just the first one it met", () => {
    const wrongInEveryWay = (): Harness =>
      resolveHarness({
        catalogDefault: forced<Harness>({
          cli: "",
          model: " ",
          effort: "turbo",
          skills: ["dup", "dup"],
        }),
      });

    expect(wrongInEveryWay).toThrow(
      /cli must name something.*model must name something.*effort must be one of.*skills must list each Skill once/,
    );
  });
});

/* -------------------------------------------------------------------------------------------------
 * The compile-time half
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every probe here is falsified by breaking the guarantee at its **source** — the `EFFORTS` registry
 * behind `Effort`, the `readonly` modifiers on `Harness`, the shape of `HarnessSources` — and
 * confirming `tsc --noEmit` reports `TS2578: Unused '@ts-expect-error' directive`, as `CLAUDE.md`
 * requires.
 */
describe("what the type system refuses", () => {
  it("refuses an Effort the registry does not carry, in a roster entry", () => {
    const rejected = (): Harness =>
      resolveHarness({
        rosterEntry: {
          // @ts-expect-error a Zord is invoked at min, low, medium, high or max Effort, nothing else
          effort: "turbo",
        },
        catalogDefault: CATALOG_DEFAULT,
      });

    // The type error above is the proof. At runtime the check is what stops it, and it does:
    expect(rejected).toThrow(InvalidHarnessError);
  });

  it("refuses an Effort the registry does not carry, in the catalog default", () => {
    const rejected = (): Harness =>
      resolveHarness({
        catalogDefault: {
          ...CATALOG_DEFAULT,
          // @ts-expect-error the catalog default is a Harness too, and holds no invented Effort
          effort: "turbo",
        },
      });

    expect(rejected).toThrow(InvalidHarnessError);
  });

  it("refuses a partial catalog default: the floor cannot be silent", () => {
    const rejected = (): Harness =>
      resolveHarness({
        // @ts-expect-error the catalog default is complete by type — that is what completes the result
        catalogDefault: { cli: "claude", model: "sonnet-4-5" },
      });

    expect(rejected).toThrow(InvalidHarnessError);
  });

  it("refuses resolving with no catalog default at all", () => {
    // @ts-expect-error there is nothing to fall through to without a catalog default
    const rejected = (): Harness => resolveHarness({ rosterEntry: { effort: "high" } });

    expect(rejected).toThrow();
  });

  it("refuses a source that smuggles in a field a Harness does not have", () => {
    const rejected = (): Harness =>
      resolveHarness({
        invocation: {
          effort: "high",
          // @ts-expect-error a Harness is CLI, model, Effort and Skills, and nothing else
          temperature: 0.7,
        },
        catalogDefault: CATALOG_DEFAULT,
      });

    expect(rejected().effort).toBe("high");
  });

  it("refuses rewriting a resolved Harness in place", () => {
    const resolved = resolveHarness({ catalogDefault: CATALOG_DEFAULT });

    // Assigning the value the field already holds, so `readonly` is the only thing that can reject
    // it: writing another CLI here would also fail on nothing, and prove nothing about immutability.
    // @ts-expect-error a Harness is resolved once and never rewritten: resolve a new one
    const rejected = (): void => void (resolved.cli = resolved.cli);

    // Frozen as well as readonly, so a cast does not get past it either.
    expect(rejected).toThrow(TypeError);
    expect(resolved.cli).toBe("claude");
  });

  it("refuses growing the Skill list of a resolved Harness", () => {
    const resolved = resolveHarness({ catalogDefault: CATALOG_DEFAULT });

    // @ts-expect-error the Skill list of a Harness is readonly: resolve a new Harness instead
    const rejected = (): number => resolved.skills.push("smuggled-skill");

    expect(rejected).toThrow(TypeError);
    expect(resolved.skills).toEqual(["catalog-baseline"]);
  });
});
