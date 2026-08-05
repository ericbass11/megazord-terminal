# Tasks — Mission Engine

Derived from `techspec.md`. Read the PRD and the techspec before executing any of these.

## Granularity

**10 tasks** for 13 acceptance criteria and 13 source files.

Justified against the size of the techspec: the domain has five independent rule clusters
(capability, harness, contract, meter, gate) and each is one reviewable delivery with its own
executable proof — splitting them further would produce diffs too small to carry a decision, and
merging any two would hide two rule sets in one review. The three infrastructure tasks (1, 9, 10)
exist because their verifications are independent of the domain: a test runner that runs, a fake
runner that drives the whole lifecycle, and adherence checks that police the glossary.

Task 3 is deliberately the largest — the state machine is one atomic decision and cannot be half
delivered. Tasks 4 through 8 each extend `decide` with one rule cluster and its refusal path.

Order: dependencies first, and every task leaves the repo green.

---

## Task 1 — Test runner and engine scaffolding

- **Status**: done
- **Goal**: `npm test` runs Vitest against `engine/`, `@engine/*` resolves, `npm run build` for the
  site still passes.
- **Touches**: `package.json`, `tsconfig.json`, `vitest.config.mts`, `engine/index.ts`, `engine/domain/ids.ts`
- **Depends on**: none
- **Verification**: `npm test` green with one real test (a branded id rejects a raw string at type
  level); `npm run build` green.

## Task 2 — Money and Capability value objects

- **Status**: done
- **Goal**: `Money` as integer BRL cents with add/compare and no float path; `Capability` with
  `ExecutionCapability` and `assertNoExecution`.
- **Touches**: `engine/domain/money.ts`, `engine/domain/capability.ts` and their tests
- **Depends on**: 1
- **Verification**: `money.test.ts` proves cents arithmetic and rejects fractional input;
  `capability.test.ts` proves criterion 2 — a Core given an ExecutionCapability fails to compile
  (`@ts-expect-error`) and the cast path throws at runtime.

## Task 3 — Mission state machine: decide, evolve, events, commands

- **Status**: done
- **Goal**: the Mission lifecycle as `decide`/`evolve`, with the Event and Command unions, opening
  a Mission from a Briefing with a Mode and a Cap, and refusal of illegal transitions.
- **Touches**: `engine/domain/events.ts`, `commands.ts`, `mission.ts` and tests
- **Depends on**: 2
- **Verification**: `mission.test.ts` covers criterion 12 — delegating on a halted Mission, a
  Handoff for an unknown Delegation, deciding a Gate that is not open — each returning
  `refused` with `illegal-transition`.

## Task 4 — Delegation

- **Status**: todo
- **Goal**: the Core delegates a slice of the Mission to a Zord with a resolved Harness; the
  Delegation is recorded as an event and is the only thing a Handoff can answer.
- **Touches**: `engine/domain/mission.ts`, `events.ts`, `commands.ts` and tests
- **Depends on**: 3, and 5 — a Delegation carries a resolved Harness, so `harness.ts` must exist
  first. Corrected during Task 3's review; the original list said 3 only.
- **Verification**: a Delegation produces `Delegated`; a Handoff referencing it is admissible and
  one referencing an unknown Delegation is refused.

## Task 5 — Harness resolution

- **Status**: todo
- **Goal**: `resolveHarness` with deterministic precedence roster > invocation > catalog default,
  resolved field by field.
- **Touches**: `engine/domain/harness.ts` and test
- **Depends on**: 2
- **Verification**: `harness.test.ts` covers criterion 4 with one case per level winning, plus a
  mixed case where different fields resolve from different levels.

## Task 6 — Contract, Handoff, Refusal

- **Status**: todo
- **Goal**: `validateHandoff` implementing the required/optional/Gap rule; a violating Handoff is
  refused by the domain with the violations listed, no human involved.
- **Touches**: `engine/domain/contract.ts`, `handoff.ts`, `mission.ts` and tests
- **Depends on**: 4
- **Verification**: `contract.test.ts` and `mission.test.ts` cover criterion 3: required clause
  unsatisfied is a violation even when declared as a Gap; optional clause unsatisfied passes only
  when declared as a Gap.

## Task 7 — Meter and Cap

- **Status**: todo
- **Goal**: cost accrues per Pane and per Mission; crossing the Cap halts the Mission and every
  subsequent command is refused with `cap-reached` until authorised.
- **Touches**: `engine/domain/meter.ts`, `mission.ts` and tests
- **Depends on**: 3
- **Verification**: `meter.test.ts` covers criterion 5, including the exact-boundary case (cost
  equal to the Cap) and the authorisation path that resumes the Mission.

## Task 8 — Gate

- **Status**: todo
- **Goal**: a Gate blocks progress until decided; approve, revise-with-reason and kill paths.
- **Touches**: `engine/domain/gate.ts`, `mission.ts` and tests
- **Depends on**: 3
- **Verification**: `gate.test.ts` covers criterion 6: commands refused while a Gate is open,
  approval resumes, revise returns the reason as context, kill terminates the Mission.

## Task 9 — Replay, AgentRunner port and fake adapter, end-to-end

- **Status**: todo
- **Goal**: `replay(events)` folds to the same state built command by command; the `AgentRunner`
  port with a deterministic fake drives a whole Mission from Briefing to Delivery.
- **Touches**: `engine/domain/replay.ts`, `engine/ports/agent-runner.ts`,
  `engine/adapters/fake-agent-runner.ts`, `engine/index.ts` and tests
- **Depends on**: 6, 7, 8
- **Verification**: `replay.test.ts` covers criterion 7 (fold equality, including a run containing
  a Refusal and a Gate decision); `mission.e2e.test.ts` covers criterion 13 with no network and no
  CLI installed.

## Task 10 — Adherence checks and documentation

- **Status**: todo
- **Goal**: the glossary and the SDD layout police themselves; `CONTEXT.md` carries the new terms
  and `docs/adr/` carries the four decisions from the techspec.
- **Touches**: `tools/glossary-check.ts` and test, `tools/prd-structure.test.ts`, `CONTEXT.md`,
  `CLAUDE.md`, `docs/adr/0001..0004`
- **Depends on**: 9
- **Verification**: criterion 8 — an `_Avoid_` term planted in a fixture fails the check; the
  glossary file itself, fenced code blocks and the structural vocabulary listed in `CLAUDE.md`
  ("Glossary checks are about naming") are excluded, proven by a test that the current tree passes
  clean; criterion 9 — a PRD folder missing `techspec.md`
  fails; criterion 10 — no `any` and no stray `@ts-expect-error` in `engine/`.
