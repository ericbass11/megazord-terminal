# Techspec — Mission Engine

Technical spec for `docs/prd/mission-engine/prd.md`. Read that first: this document answers *how*,
and refuses to restate *what*.

## Approach

A **pure, event-sourced domain**. No classes holding mutable state, no I/O, no clock, no
randomness inside the domain.

Two functions carry the whole model:

```
decide(state: Mission, command: Command): Decision   // Decision = Accepted(Event[]) | Refused(Refusal)
evolve(state: Mission, event: Event): Mission        // total, deterministic
```

State is never mutated: it is folded from the event log. Three PRD criteria fall out of this shape
instead of needing machinery of their own:

- **Replay** (criterion 7) *is* the event log. Replaying is `events.reduce(evolve, initial)`, and
  "reconstructs the same final state" becomes a property test rather than a feature.
- **Illegal transitions** (criterion 12) are refusals from `decide`, in one place, not scattered
  guard clauses.
- **Refusal without human involvement** (criterion 3) is the ordinary return value of `decide` —
  the domain has no way to ask a human, so it cannot accidentally do so.

The engine is a library. Time, cost prices, ids and agent execution enter through the edges:
`decide` takes an `occurredAt` on the command, and process execution sits behind `AgentRunner`.

## Domain impact

Single context, as decided in the grill. New terms introduced by this work, to be added to
`CONTEXT.md` in the task that introduces them:

| Term         | Definition                                                                       |
| ------------ | -------------------------------------------------------------------------------- |
| `Command`    | An intent submitted to a Mission, which the domain accepts or refuses.           |
| `Event`      | A fact that happened to a Mission. Append-only, never revised.                   |
| `Decision`   | The result of `decide`: accepted events, or a Refusal.                           |
| `Clause`     | One obligation of a Contract, which a Handoff either satisfies or does not.       |
| `Capability` | A permission a Zord holds. The Core holds none of the executing kind.            |

`Core` is the orchestrator and nothing else — never a folder, never a module. The module is
`engine/`.

## Structure

```
engine/
  domain/
    ids.ts          Branded MissionId, ZordId, DelegationId, GateId, ClauseId
    money.ts        Money — integer BRL cents, no floats
    capability.ts   Capability, ExecutionCapability, assertNoExecution
    harness.ts      Harness + resolveHarness (precedence)
    contract.ts     Contract, Clause, validateHandoff
    handoff.ts      Handoff, Gap, Refusal
    meter.ts        Meter — cost accrual per Pane and Mission, Cap check
    gate.ts         Gate, GateDecision
    events.ts       Event union
    commands.ts     Command union
    mission.ts      Mission state, decide, evolve, openMission
    replay.ts       replay(events), project(events)
  ports/
    agent-runner.ts AgentRunner port
  adapters/
    fake-agent-runner.ts  deterministic, scripted, no I/O
  index.ts          public surface of the module
tools/
  glossary-check.ts  reads CONTEXT.md, scans engine/ and docs/prd/
```

Tests live beside their subject as `*.test.ts`. Path alias `@engine/*` → `engine/*`, added to
`tsconfig.json` next to the existing `@/*`. Nothing in `app/`, `components/` or `lib/` moves.

## Contracts

The interfaces agreed before any code is written.

```ts
type Decision =
  | { readonly kind: "accepted"; readonly events: readonly Event[] }
  | { readonly kind: "refused"; readonly refusal: Refusal };

type Refusal = {
  readonly reason: RefusalReason;      // "illegal-transition" | "contract-violation" | "cap-reached" | "missing-capability" | "unrunnable-harness"
  readonly violations: readonly string[];  // human-readable, one per broken rule
};

type Harness = {
  readonly cli: string;
  readonly model: string;
  readonly effort: Effort;             // "min" | "low" | "medium" | "high" | "max"
  readonly skills: readonly string[];
};

// precedence: roster > invocation > catalogDefault, field by field
resolveHarness(sources: {
  readonly rosterEntry?: Partial<Harness>;
  readonly invocation?: Partial<Harness>;
  readonly catalogDefault: Harness;
}): Harness;

type Clause = { readonly id: ClauseId; readonly description: string; readonly required: boolean };
type Contract = { readonly clauses: readonly Clause[] };

type Handoff = {
  readonly delegationId: DelegationId;
  readonly satisfies: readonly ClauseId[];
  readonly gaps: readonly Gap[];      // what it declares it did not cover
  readonly artifacts: readonly string[];
};

// a required Clause left unsatisfied is a violation, even when declared as a Gap;
// an optional Clause left unsatisfied is accepted only when declared as a Gap.
validateHandoff(contract: Contract, handoff: Handoff): readonly string[];  // empty = valid

interface AgentRunner {
  run(input: { harness: Harness; instruction: string }): Promise<{
    readonly output: string;
    readonly cost: Money;
  }>;
}
```

**The Core invariant.** `Capability` is a branded union; `ExecutionCapability` is one member. The
Core is typed as an actor whose capability set excludes it, so handing it one does not compile.
Because a cast defeats any type-level guarantee, `assertNoExecution` also checks at runtime and
throws — and a test proves the cast path throws rather than silently passing.

## Rejected alternatives

- **Mutable aggregate class with methods.** Idiomatic and shorter, but the Replay criterion would
  need a parallel event-recording mechanism, and the two would drift. Event sourcing makes the
  audit trail the source of truth instead of a side effect.
- **Zod (or any schema library) for contract validation.** A Contract here is a domain concept
  with its own required/optional/gap rule, not a payload shape. A schema library would model the
  wrong thing and add a dependency to a module whose value is having none.
- **`Cost` as a float.** Rejected outright: cost accumulates across many small increments and
  compares against a Cap. Integer cents, no exceptions.
- **npm workspaces with `apps/` and `packages/`.** Recorded in the PRD: the site is already
  running in the user's editor, and the restructure buys nothing for the domain right now.
- **A real CLI adapter in this PRD.** Out of scope by decision; the port is the boundary.

## Decisions worth an ADR

All three of hard-to-reverse, surprising-without-context and real-trade-off:

1. **The domain is event-sourced and pure.** Reversing it later means rewriting every invariant.
2. **The Core's lack of execution capability is enforced by the type system plus a runtime guard.**
   A reader would otherwise assume a code review convention and "simplify" it away.
3. **One bounded context now, with Orchestration / Execution / Agreement / Governance recorded as
   candidates.** The explicit *no* matters more than the yes.
4. **Money is integer BRL cents.** Cheap to record, expensive to discover the hard way.
5. **A Delegation's Harness is resolved inside `decide`, and the Event carries the resolved bundle**
   rather than the sources. Added during Task 4: carrying sources would make "what did this Zord run
   with" a function of the Catalog *at reading time*, so folding the same log after a Catalog change
   would describe a bundle nobody ever ran.

`RefusalReason` carries a fifth member, `unrunnable-harness`, added in Task 4 and accepted in
review: the transition is legal, the Core may delegate, no Contract was broken and the Cap was not
reached, so every existing reason would have put a wrong reason in front of a human.

`engine/` living inside the site project and Vitest as the runner are both easy to reverse — no
ADR.

## Verification plan

| PRD criterion | Proof |
| ------------- | ----- |
| 1  | `npm test` (vitest run) and `npm run build` in CI-equivalent local run |
| 2  | `capability.test.ts`: type-level rejection via `@ts-expect-error`, plus a cast that throws |
| 3  | `contract.test.ts` + `mission.test.ts`: refused Handoff, with violations listed |
| 4  | `harness.test.ts`: one case per precedence level winning, field by field |
| 5  | `meter.test.ts`: accrual crossing the Cap halts; next command refused `cap-reached` |
| 6  | `gate.test.ts`: blocked until decided; approve, revise, kill paths |
| 7  | `replay.test.ts`: fold equality — `replay(events)` equals the state built command by command |
| 8  | `tools/glossary-check.test.ts` over `engine/` and `docs/prd/` |
| 9  | `tools/prd-structure.test.ts` over `docs/prd/*/` |
| 10 | `tsc --noEmit` on the engine, plus a grep-based test for `any` and stray `@ts-expect-error` |
| 11 | `/executar-review` checks `CONTEXT.md` and the ADRs against what was built |
| 12 | `mission.test.ts`: one case per illegal transition |
| 13 | `mission.e2e.test.ts`: Briefing to Delivery against the fake runner, no network |

Every criterion has an executable proof except 11, which is a review item by nature.
