# 0001 — The domain is event-sourced and pure

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/`

## Decision

The whole Mission model is two functions. `decide(state, command)` answers a Decision — the Events it
accepts, or a Refusal — and `evolve(state, event)` folds one fact into the state. State is never
mutated: it is `events.reduce(evolve, UNOPENED_MISSION)`. No classes hold state, and nothing in
`engine/domain/` reads a clock, a random number or a file. Time enters as the `occurredAt` Instant on
the Command; process execution stays behind the `AgentRunner` port.

## Trade-off

A mutable aggregate class with methods is shorter, more idiomatic and easier to hire for. It was
rejected because the Replay (acceptance criterion 7) would then need a parallel event-recording
mechanism beside the mutation, and the two would drift: the first time somebody changes state without
appending, the Replay quietly stops being true. Event sourcing makes the recorded facts the source
of truth and the state a derivation of them, so there is nothing for them to disagree about.

## Consequences

- Illegal transitions (criterion 12) are refusals from one function instead of guard clauses scattered
  across methods.
- A Refusal is the ordinary return value of `decide`, which is what makes "refused with no human
  involved" (criterion 3) a property of the shape rather than a promise: the domain has no way to ask
  a human, so it cannot accidentally do so.
- `evolve` must be **total** — an Event that cannot apply leaves the state untouched — and `decide` must
  **never throw**, so every collaborator that can throw is wrapped (`resolvedHarnessOf`,
  `contractViolationsOf`, `amountOf`). "Never throws, except" is not a contract a Surface can build on.
- A fold that re-runs a rule is not a fold, which is why a fact carries what a rule computed rather
  than the recipe for it (ADR 0005) and why totals are the fold's answer rather than a field on a fact.

Reversing this is not a refactor: every invariant in the engine is written as a rule of `decide` or
`evolve`, and the Replay, the refusal model and the illegal-transition proofs all rest on the shape.
