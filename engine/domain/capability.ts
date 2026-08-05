/**
 * Capabilities, and the one invariant this product cannot lose: **the Core holds no execution
 * capability.**
 *
 * A Capability is a permission a Zord holds. Capabilities split in two, and the split is the whole
 * point:
 *
 * - an `OrchestrationCapability` delegates, chases, consolidates and reads or writes the Cortex;
 * - an `ExecutionCapability` touches the world — spawns a process, edits files, reaches the
 *   network.
 *
 * The Core is the orchestrator of a Mission. Its capability set is typed as `CoreCapability`, which
 * is derived by *excluding* every executing member from `Capability`, so handing a Core an
 * `ExecutionCapability` does not compile — and a capability added to the executing side later is
 * excluded automatically instead of needing this file to be remembered.
 *
 * The type level is not enough. A single `as` defeats any compile-time guarantee, and the guarantee
 * that matters here is the one an attacker, a deserialiser or a tired afternoon will try to bypass.
 * So `assertNoExecution` checks the same rule at runtime, against the registry of names below
 * rather than against the type — the type is erased, the name is not. Nothing constructed by hand
 * or forced through a conversion gets past it:
 *
 * - a known executing name is refused;
 * - a name that is not in the registry at all is refused too, because a capability nobody can
 *   recognise cannot be proven harmless.
 */

declare const brand: unique symbol;

/** The executing capabilities: everything that can touch the world outside the Mission. */
export const EXECUTION_CAPABILITY_NAMES = ["spawn-process", "edit-files", "reach-network"] as const;

/** The orchestrating capabilities: everything the Core needs in order to lead without executing. */
export const ORCHESTRATION_CAPABILITY_NAMES = [
  "delegate",
  "chase",
  "consolidate",
  "read-cortex",
  "write-cortex",
] as const;

/** The name of a capability that touches the world. */
export type ExecutionCapabilityName = (typeof EXECUTION_CAPABILITY_NAMES)[number];

/** The name of a capability that leads a Mission without touching the world. */
export type OrchestrationCapabilityName = (typeof ORCHESTRATION_CAPABILITY_NAMES)[number];

/**
 * A permission to touch the world. A Zord in an executing Role holds these; the Core never does.
 *
 * The brand is phantom — it exists only in the type system, which is exactly why
 * `assertNoExecution` matches on `name` instead.
 */
export type ExecutionCapability = {
  readonly [brand]: "execution";
  readonly name: ExecutionCapabilityName;
};

/** A permission to lead a Mission: delegate, chase, consolidate, read and write the Cortex. */
export type OrchestrationCapability = {
  readonly [brand]: "orchestration";
  readonly name: OrchestrationCapabilityName;
};

/** A permission a Zord holds. */
export type Capability = OrchestrationCapability | ExecutionCapability;

/**
 * What a Core may hold.
 *
 * Written as an exclusion rather than as `OrchestrationCapability` on purpose: the rule is "no
 * executing capability", so it must keep holding when a third member joins `Capability`.
 */
export type CoreCapability = Exclude<Capability, ExecutionCapability>;

/**
 * The orchestrator of a Mission, from the capability side: a capability set with every
 * `ExecutionCapability` excluded by construction. Build one with `core`, never as a literal.
 */
export type Core = {
  readonly capabilities: readonly CoreCapability[];
};

/** Raised when something that must not execute is found holding an executing capability. */
export class ExecutionCapabilityError extends Error {
  constructor(holder: string, found: readonly string[]) {
    super(`${holder} must hold no execution capability, found ${found.join(", ")}`);
    this.name = "ExecutionCapabilityError";
  }
}

/** Raised when a capability's name is in neither registry, so it cannot be proven non-executing. */
export class UnknownCapabilityError extends Error {
  constructor(holder: string, found: readonly string[]) {
    super(
      `${holder} holds unrecognised capabilities, which cannot be proven ` +
        `non-executing: ${found.join(", ")}`,
    );
    this.name = "UnknownCapabilityError";
  }
}

/** Constructs an executing capability. */
export function executionCapability(name: ExecutionCapabilityName): ExecutionCapability {
  return { name } as ExecutionCapability;
}

/** Constructs an orchestrating capability. */
export function orchestrationCapability(
  name: OrchestrationCapabilityName,
): OrchestrationCapability {
  return { name } as OrchestrationCapability;
}

const executionNames: ReadonlySet<string> = new Set(EXECUTION_CAPABILITY_NAMES);
const orchestrationNames: ReadonlySet<string> = new Set(ORCHESTRATION_CAPABILITY_NAMES);

/** Whether a capability touches the world, decided by its name and not by its erased brand. */
export function isExecutionCapability(candidate: Capability): boolean {
  return executionNames.has(nameOf(candidate));
}

/**
 * Throws unless every capability in `held` is a known, non-executing one.
 *
 * This is the runtime half of the Core invariant. It deliberately does not trust its own parameter
 * type: the caller may have arrived through a conversion, through `JSON.parse`, or through a
 * boundary this module cannot see. It reads `name` as `unknown` and decides from the registries.
 *
 * @param held the capabilities to check.
 * @param holder what is being checked, for the message. The Core by default — it is the reason
 *   this function exists.
 * @throws {ExecutionCapabilityError} when an executing capability is present.
 * @throws {UnknownCapabilityError} when a name is in neither registry.
 */
export function assertNoExecution(held: readonly Capability[], holder = "Core"): void {
  const names = held.map(nameOf);
  const executing = names.filter((name) => executionNames.has(name));
  if (executing.length > 0) {
    throw new ExecutionCapabilityError(holder, executing);
  }

  const unknown = names.filter((name) => !orchestrationNames.has(name));
  if (unknown.length > 0) {
    throw new UnknownCapabilityError(holder, unknown);
  }
}

/**
 * Builds a Core's capability set.
 *
 * Both halves of the invariant meet here: the parameter type refuses an `ExecutionCapability` at
 * compile time, and `assertNoExecution` refuses one that was forced past the type system.
 */
export function core(capabilities: readonly CoreCapability[]): Core {
  assertNoExecution(capabilities);
  return { capabilities: Object.freeze([...capabilities]) };
}

/**
 * Reads a capability's name without trusting the type. Anything that is not a string becomes a
 * name no registry contains, so it is refused as unrecognised rather than skipped.
 */
function nameOf(candidate: Capability): string {
  // Widened to `unknown` first: the parameter type is a claim, and this function's job is to check
  // the claim rather than to rely on it.
  const held: unknown = candidate;
  if (
    typeof held === "object" &&
    held !== null &&
    "name" in held &&
    typeof held.name === "string"
  ) {
    return held.name;
  }
  // Anything that is not a `{ name: string }` gets a label no registry can contain, so it is
  // refused as unrecognised rather than skipped. A bare `"delegate"` string is not a Capability.
  return `<${held === null ? "null" : typeof held} is not a capability>`;
}
