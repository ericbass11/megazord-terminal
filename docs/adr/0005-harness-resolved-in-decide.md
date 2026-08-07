# 0005 — A Delegation's Harness is resolved in `decide`, and the fact carries the resolved bundle

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/` (decided during Task 4)

## Decision

`resolveHarness` runs inside `decide`, and the `Delegated` fact carries the **resolved** Harness — one
`cli`, one `model`, one `effort`, one list of Skills. It does not carry the three sources the precedence
rule read (Roster entry, invocation, Catalog default). `evolve` copies the bundle out of the Event and
never re-resolves.

## Trade-off

Recording the sources is smaller, and it keeps the Catalog authoritative: change a default and every
past Delegation "inherits" the fix. That is precisely the failure. It would make "what did this Zord run
with" a function of the Catalog *at reading time*, so folding the same log next month — after the default
model moved — would describe a bundle nobody ever ran, and the Replay would answer a question about the
present while claiming to describe the past. The price paid is a fatter Event, and no way to retro-fix a
bad default: the only honest correction is a new Delegation.

## Consequences

- **General form**: anything a rule computes from outside the aggregate is computed once, in `decide`,
  and recorded in the fact. Its counterpart is the other half of the rule — a total computed *from* the
  facts belongs to the fold, which is why `CostAccrued` carries a cost and no running totals.
- `decide` gained a throwing collaborator, since `resolveHarness` throws `InvalidHarnessError` and is
  reachable from a well-typed Command (`cli: ""` satisfies `Harness`). It is wrapped, and the Refusal
  reason `unrunnable-harness` was added rather than reusing a reason that would have been a lie.
- A fold that re-runs a rule is not a fold, so `evolve` re-derives nothing. The same reasoning puts the
  Contract in force on the `Delegated` fact: a Handoff is judged against the agreement that existed when
  the Delegation was made.
