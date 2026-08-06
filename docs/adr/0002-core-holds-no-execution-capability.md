# 0002 — The Core's lack of an execution Capability is enforced twice

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/`

## Decision

"The Core orchestrates and never executes" is enforced at two levels, in `engine/domain/capability.ts`:

- **At the type level.** `Capability` is a union of `OrchestrationCapability` and
  `ExecutionCapability`, and a Core holds `CoreCapability = Exclude<Capability, ExecutionCapability>`.
  Handing `core()` an execution Capability does not compile.
- **At runtime.** `assertNoExecution` re-checks the set and throws `ExecutionCapabilityError`, so the
  same mistake forced through with `as` fails loudly instead of passing silently.

`Core` and `core()` live next to the invariant they exist to enforce, and every later task reuses them.
A second `Core` definition in `mission.ts` would split one invariant across two places, and one of them
would rot.

## Trade-off

The two levels overlap, and a reader meeting the runtime guard will read it as redundant with the
compiler and delete it — which is exactly why this is recorded. A cast defeats any type-level
guarantee, and the values reaching this domain will eventually come from a deserialiser or a Surface
written in JavaScript; a type-only guard would then be a comment. A runtime-only guard would be worse
in the other direction: the mistake would compile, and the product's central claim would be a test
somebody remembered to write.

## Consequences

- Criterion 2 is provable as two facts: a `@ts-expect-error` probe that the compiler refuses the
  Capability, and a test that the cast path throws.
- The guarantee is falsifiable, per `CLAUDE.md`: replacing `Exclude<Capability, ExecutionCapability>`
  with `Capability` makes both type-level probes report `TS2578`, and `npm run build` fails.
- Delegation is the one user of the `missing-capability` Refusal: delegating is the Core's own act, and
  `capability.ts` already names the permission it needs.
