import { describe, expect, it } from "vitest";

import {
  EXECUTION_CAPABILITY_NAMES,
  ExecutionCapabilityError,
  ORCHESTRATION_CAPABILITY_NAMES,
  UnknownCapabilityError,
  assertNoExecution,
  core,
  executionCapability,
  isExecutionCapability,
  orchestrationCapability,
  type Capability,
  type CoreCapability,
  type ExecutionCapability,
} from "@engine/domain/capability";

/**
 * Forces a value past the type system, the way a deserialiser, a boundary or a deliberate `as`
 * would. Every use of it below exists to prove the runtime guard still catches what the compiler
 * can no longer see.
 */
function forced<TClaimed>(value: unknown): TClaimed {
  return value as TClaimed;
}

describe("Capability", () => {
  it("constructs both sides and keeps the name at runtime", () => {
    expect(orchestrationCapability("delegate").name).toBe("delegate");
    expect(executionCapability("spawn-process").name).toBe("spawn-process");
  });

  it("tells the executing capabilities apart by name", () => {
    for (const name of EXECUTION_CAPABILITY_NAMES) {
      expect(isExecutionCapability(executionCapability(name)), name).toBe(true);
    }
    for (const name of ORCHESTRATION_CAPABILITY_NAMES) {
      expect(isExecutionCapability(orchestrationCapability(name)), name).toBe(false);
    }
  });

  it("keeps the two registries disjoint", () => {
    const executing: readonly string[] = EXECUTION_CAPABILITY_NAMES;
    const orchestrating: readonly string[] = ORCHESTRATION_CAPABILITY_NAMES;

    expect(orchestrating.filter((name) => executing.includes(name))).toEqual([]);
  });
});

describe("the Core holds no execution capability — type level", () => {
  it("does not compile when a Core is built with an ExecutionCapability", () => {
    const build = (): unknown =>
      core([
        orchestrationCapability("delegate"),
        // @ts-expect-error an ExecutionCapability is excluded from a Core's capability set
        executionCapability("spawn-process"),
      ]);

    // The type error above is the proof. At runtime the guard is what stops it, and it does:
    expect(build).toThrow(ExecutionCapabilityError);
  });

  it("does not compile when an ExecutionCapability is assigned to a CoreCapability", () => {
    // @ts-expect-error the brand of an executing capability is not the brand a Core may hold
    const held: CoreCapability = executionCapability("edit-files");

    expect(held.name).toBe("edit-files");
  });

  it("does not compile when an executing name is asked of the orchestrating constructor", () => {
    // @ts-expect-error "spawn-process" belongs to the executing registry, not the orchestrating one
    const held = orchestrationCapability("spawn-process");

    expect(held.name).toBe("spawn-process");
  });

  it("does not compile when a Capability is written as a plain literal", () => {
    // @ts-expect-error the brand is phantom and cannot be written by hand: use the constructors
    const forgedByHand: Capability = { name: "delegate" };

    expect(forgedByHand.name).toBe("delegate");
  });
});

describe("the Core holds no execution capability — runtime guard", () => {
  it("builds a Core from orchestrating capabilities", () => {
    const orchestrator = core([
      orchestrationCapability("delegate"),
      orchestrationCapability("chase"),
      orchestrationCapability("consolidate"),
    ]);

    expect(orchestrator.capabilities.map((held) => held.name)).toEqual([
      "delegate",
      "chase",
      "consolidate",
    ]);
  });

  it("throws when an ExecutionCapability is forced past the type system", () => {
    const smuggled = forced<CoreCapability>(executionCapability("spawn-process"));

    expect(() => core([smuggled])).toThrow(ExecutionCapabilityError);
    expect(() => core([smuggled])).toThrow(/Core must hold no execution capability/);
  });

  it("throws for every executing capability, not just the first one it learned about", () => {
    for (const name of EXECUTION_CAPABILITY_NAMES) {
      const smuggled = forced<CoreCapability>(executionCapability(name));

      expect(() => core([smuggled]), name).toThrow(ExecutionCapabilityError);
    }
  });

  it("names every executing capability it found", () => {
    const held = [
      orchestrationCapability("delegate"),
      forced<CoreCapability>(executionCapability("edit-files")),
      forced<CoreCapability>(executionCapability("reach-network")),
    ];

    expect(() => assertNoExecution(held)).toThrow(/found edit-files, reach-network/);
  });

  it("throws for a hand-built object that never went through a constructor", () => {
    const handBuilt = forced<CoreCapability>({ name: "spawn-process" });

    expect(() => core([handBuilt])).toThrow(ExecutionCapabilityError);
  });

  it("refuses a capability whose name is in neither registry", () => {
    const unrecognised = forced<CoreCapability>({ name: "mint-money" });

    expect(() => core([unrecognised])).toThrow(UnknownCapabilityError);
    expect(() => core([unrecognised])).toThrow(/mint-money/);
  });

  it("refuses a value that is not a capability at all", () => {
    // A bare string is not a Capability, not even when it spells one: the guard wants an object
    // with a `name`, so `"delegate"` is refused as unrecognised rather than waved through.
    for (const nonsense of [null, undefined, 42, "delegate", "spawn-process", {}, { name: 7 }]) {
      expect(() => core([forced<CoreCapability>(nonsense)]), String(nonsense)).toThrow(
        UnknownCapabilityError,
      );
    }
  });

  it("reports the holder it was given, so the message is not always about the Core", () => {
    const held = [forced<Capability>(executionCapability("spawn-process"))];

    expect(() => assertNoExecution(held, "Zord scout")).toThrow(
      /Zord scout must hold no execution capability/,
    );
  });

  it("accepts an empty capability set", () => {
    expect(core([]).capabilities).toEqual([]);
    expect(() => assertNoExecution([])).not.toThrow();
  });

  it("does not let a Core's capability set be mutated after construction", () => {
    const orchestrator = core([orchestrationCapability("delegate")]);
    const smuggled = forced<CoreCapability>(executionCapability("spawn-process"));

    expect(() => forced<CoreCapability[]>(orchestrator.capabilities).push(smuggled)).toThrow(
      TypeError,
    );
    expect(orchestrator.capabilities).toHaveLength(1);
  });

  it("copies the capabilities it was given, so the caller cannot add one later", () => {
    const granted: CoreCapability[] = [orchestrationCapability("delegate")];
    const orchestrator = core(granted);

    granted.push(forced<CoreCapability>(executionCapability("spawn-process")));

    expect(orchestrator.capabilities).toHaveLength(1);
  });

  it("lets an executing Zord hold what the Core cannot", () => {
    const held: readonly ExecutionCapability[] = EXECUTION_CAPABILITY_NAMES.map(
      executionCapability,
    );

    expect(held.map((capability) => capability.name)).toEqual([...EXECUTION_CAPABILITY_NAMES]);
    expect(() => assertNoExecution(held, "Zord builder")).toThrow(ExecutionCapabilityError);
  });
});
