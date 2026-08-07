/**
 * The Harness: the resolved bundle of CLI, model, Effort and Skills a Zord runs a given task with,
 * and the one function that resolves it.
 *
 * A Zord is born when invoked and dies after delivering, so its Harness is decided once, at
 * invocation, out of three sources that may each have an opinion:
 *
 * - the **roster entry** — what the Combination's Roster declares for the Role being invoked;
 * - the **invocation** — what this one call asks for;
 * - the **catalog default** — the bundle the CLI catalog falls back to.
 *
 * Precedence is `rosterEntry > invocation > catalogDefault`, **field by field**. A Combination
 * declared a Roster because it wants that Role run that way, so the Roster outranks a one-off ask;
 * an ask outranks a default because a default is what you get when nobody said anything.
 *
 * ## Deterministic, and that is the whole point
 *
 * `resolveHarness` is a pure function of its argument: no clock, no randomness, no environment, no
 * I/O, no mutation of what it was given. The same sources always resolve to the same Harness, and
 * the resolved bundle is frozen, so nothing downstream can quietly rewrite what a Zord was told to
 * run with. "Sometimes it picks the good model" is the failure this function exists to make
 * impossible.
 *
 * Two consequences worth stating, because both are decisions and not accidents:
 *
 * ## Skills **replace**; they never merge
 *
 * A roster entry that specifies `skills` replaces the invocation's list entirely, and the
 * invocation's replaces the catalog default's. There is no union, no de-duplication across sources,
 * and no ordering rule between sources to learn.
 *
 * The reason is asymmetry, not taste. A caller who wants the union can always write it: put the
 * whole list at the source that wins. A caller who wants a *replacement* has no way to express it if
 * resolution always merges — there would be no way to invoke a Role **without** the Skill its Roster
 * declares, short of editing the Combination. A merge also destroys the property that makes this
 * function auditable: with replacement, every field of a resolved Harness came from exactly one
 * source and can be pointed at; with a merge, `skills` comes from all three at once and "why does
 * this Zord have that Skill" stops having an answer.
 *
 * The list is taken **verbatim**: same entries, same order. Order is not decoration — instruction
 * blocks are read in order — so silently sorting or de-duplicating across sources would hand a Zord
 * a Harness nobody asked for.
 *
 * ## An **absent** field falls through; an **empty** one is an answer
 *
 * A field is *specified* when the source carries it, and *absent* when it does not. Specified is not
 * the same as non-empty:
 *
 * - `skills: []` in a roster entry means **no Skills**, and it wins — it is how a Role is invoked
 *   bare, overriding a catalog default that installs three. Treating `[]` as "not specified" would
 *   make a deliberate override indistinguishable from silence, and there would be no way left to say
 *   "none".
 * - an **omitted** `skills` means "not specified" and falls through to the next source.
 * - `skills: undefined` is treated as **absent**, the same as omitted. Under this project's
 *   `tsconfig` (no `exactOptionalPropertyTypes`), `{ skills: undefined }` and `{}` both satisfy
 *   `Partial<Harness>`, so the type system draws no line between them; neither does `JSON`, which
 *   drops `undefined` on the way out. Reading a difference the sources cannot reliably express would
 *   make resolution depend on how a Roster happened to be serialised.
 * - `cli: ""` is **not** a way to say "not specified", and is not accepted either. `cli`, `model` and
 *   a Skill name have no empty value that means anything — an empty one is a bug at its source, so
 *   it is refused loudly instead of being read as silence or passed on to a Zord that cannot run.
 *
 * That is also why resolution never trims, never lower-cases and never normalises: `"claude "` is
 * either a typo or a different CLI, and both deserve to be seen rather than absorbed.
 *
 * ## The type level is not enough
 *
 * `catalogDefault` is a complete `Harness` by type, which is what makes the resolved bundle complete
 * by construction. A cast defeats that, exactly as it does the Core invariant in `capability.ts`, so
 * `harness()` checks the same rule at runtime — against the Effort registry and the shape of the
 * values, not against the erased type — and every resolution goes through it. A catalog default
 * forced past the compiler with a missing `model` throws `InvalidHarnessError` instead of producing a
 * Harness whose model is `undefined`.
 */

/** The Efforts a Zord can be invoked with, from least reasoning budget to most. */
export const EFFORTS = ["min", "low", "medium", "high", "max"] as const;

/** How much reasoning budget a Zord spends on one invocation. */
export type Effort = (typeof EFFORTS)[number];

/**
 * The resolved bundle of CLI, model, Effort and Skills a Zord runs a given task with.
 *
 * Complete on purpose: no optional field, so a resolved Harness cannot be half a Harness. What is
 * partially specified is a *source* — see `HarnessSources`, where each source is a `Partial<Harness>`
 * and only the catalog default is whole.
 */
export type Harness = {
  readonly cli: string;
  readonly model: string;
  readonly effort: Effort;
  readonly skills: readonly string[];
};

/**
 * The three sources a Harness is resolved from, in the order that decides which one wins:
 * `rosterEntry > invocation > catalogDefault`, field by field.
 *
 * The roster entry and the invocation are partial — each speaks only about the fields it cares
 * about. The catalog default is whole, which is what makes the result whole.
 */
export type HarnessSources = {
  /** What the Combination's Roster declares for the Role being invoked. Outranks everything. */
  readonly rosterEntry?: Partial<Harness>;
  /** What this one call asks for. Outranks the catalog default only. */
  readonly invocation?: Partial<Harness>;
  /** What the CLI catalog falls back to when nobody said anything. Complete by type. */
  readonly catalogDefault: Harness;
};

/** Raised when a Harness carries a value a Zord cannot be invoked with. */
export class InvalidHarnessError extends Error {
  constructor(violations: readonly string[]) {
    super(`Harness is not runnable: ${violations.join("; ")}`);
    this.name = "InvalidHarnessError";
  }
}

const efforts: ReadonlySet<string> = new Set(EFFORTS);

/**
 * Checks a Harness and freezes it.
 *
 * The runtime half of the completeness guarantee, and the only way a `Harness` in this engine is
 * built. It does not trust its parameter type: a value may have arrived through a cast, a
 * `JSON.parse` or a boundary this module cannot see, so every field is read as `unknown` and decided
 * on its own terms.
 *
 * Every violation is reported at once, for the same reason a `Refusal` carries a list: a Harness can
 * be wrong in more than one way, and naming only the first sends the caller round the loop twice.
 *
 * The `skills` list is copied before it is frozen, so the caller cannot add a Skill to a Harness
 * after handing it over.
 *
 * @throws {InvalidHarnessError} on a blank `cli`, a blank `model`, an Effort outside the registry, a
 *   blank Skill name, a Skill listed twice, or a field that is not of its type at all.
 */
export function harness(fields: Harness): Harness {
  const violations: string[] = [];

  checkText("cli", fields.cli, violations);
  checkText("model", fields.model, violations);
  checkEffort(fields.effort, violations);
  const skills = checkSkills(fields.skills, violations);

  if (violations.length > 0) {
    throw new InvalidHarnessError(violations);
  }

  return Object.freeze({
    cli: fields.cli,
    model: fields.model,
    effort: fields.effort,
    skills: Object.freeze(skills),
  });
}

/**
 * Resolves the Harness a Zord runs with, field by field, from the sources that have an opinion.
 *
 * Precedence is `rosterEntry > invocation > catalogDefault`. Each field is decided independently, so
 * a roster entry that speaks only about the Effort does not drag the CLI, the model or the Skills
 * along with it. A field absent from the roster entry falls through to the invocation; one absent
 * from both falls through to the catalog default, which is complete — so the result always is too.
 *
 * Pure: same sources, same Harness, always. Nothing about the sources is mutated.
 *
 * @throws {InvalidHarnessError} when the resolved bundle is not runnable — which, given a catalog
 *   default that went through `harness()`, can only happen through a value forced past the compiler.
 */
export function resolveHarness(sources: HarnessSources): Harness {
  return harness({
    cli: specified("cli", sources),
    model: specified("model", sources),
    effort: specified("effort", sources),
    skills: specified("skills", sources),
  });
}

/**
 * The value of one field, taken from the first source that specifies it.
 *
 * One ordered walk shared by every field, so two fields cannot end up resolving by different
 * precedence. `undefined` counts as *not specified*, whether the key is missing or present and
 * empty-valued — see the note on absent versus empty at the top of this file.
 *
 * Written as an explicit walk rather than as a spread: `{ ...catalogDefault, ...invocation,
 * ...rosterEntry }` copies a key whose value is `undefined` over the value below it, so a roster
 * entry carrying `{ model: undefined }` would erase the catalog default's model and produce a Harness
 * with no model at all.
 */
function specified<TField extends keyof Harness>(
  field: TField,
  sources: HarnessSources,
): Harness[TField] {
  // Highest precedence first. The catalog default is not in this list: it is the floor, and it is
  // the only source that cannot be silent.
  for (const source of [sources.rosterEntry, sources.invocation]) {
    const value = source?.[field];
    if (value !== undefined) {
      return value;
    }
  }
  return sources.catalogDefault[field];
}

/** A `cli` or a `model`: a string that names something. Never trimmed, never normalised. */
function checkText(field: string, claimed: string, violations: string[]): void {
  const value: unknown = claimed;

  if (typeof value !== "string") {
    violations.push(`${field} must be a string, received ${shown(value)}`);
    return;
  }
  if (value.trim().length === 0) {
    violations.push(`${field} must name something, received ${shown(value)}`);
  }
}

/** An Effort, decided against the registry rather than against the erased type. */
function checkEffort(claimed: Effort, violations: string[]): void {
  const value: unknown = claimed;

  if (typeof value !== "string" || !efforts.has(value)) {
    violations.push(
      `effort must be one of ${EFFORTS.join(", ")}, received ${shown(value)}`,
    );
  }
}

/**
 * The Skill list: a list of names, each naming something, none listed twice.
 *
 * A Skill listed twice is refused rather than de-duplicated. The same instruction block installed
 * twice is not more Skill, it is a mistake in a Roster or in an invocation, and quietly collapsing it
 * would hide the mistake at the one moment somebody is looking at the bundle.
 *
 * Returns the list as a fresh array, so `harness()` freezes a copy and not the caller's.
 */
function checkSkills(claimed: readonly string[], violations: string[]): string[] {
  const value: unknown = claimed;

  if (!Array.isArray(value)) {
    violations.push(`skills must be a list of Skill names, received ${shown(value)}`);
    return [];
  }

  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const listed: readonly unknown[] = value;
  const names: string[] = [];
  const seen = new Set<string>();
  const duplicated: string[] = [];

  listed.forEach((entry, position) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      violations.push(`skills[${position}] must name a Skill, received ${shown(entry)}`);
      return;
    }
    if (seen.has(entry)) {
      duplicated.push(entry);
      return;
    }
    seen.add(entry);
    names.push(entry);
  });

  if (duplicated.length > 0) {
    violations.push(`skills must list each Skill once, received ${duplicated.join(", ")} twice`);
  }

  return names;
}

/** How a rejected value reads inside a violation. */
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
