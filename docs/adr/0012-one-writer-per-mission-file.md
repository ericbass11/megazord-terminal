# 0012 — One writer per Mission file, and reading stays outside it

- **Status**: accepted
- **Date**: 2026-08-07
- **PRD**: `docs/prd/cockpit/`

## Decision

Every write to a Mission's Replay goes through exactly one collaborator: `runtime/mission-writer.ts`.
`load → submit → append` is held as one call, `record(missionId, command)`, queued **per Mission**, and
the three writers — `cockpit/server.ts`, `runtime/mcp-server.ts`, `runtime/combination-driver.ts` — take
a `MissionWriter` in place of a `MissionStore`. The interface has no `append`, so a caller cannot reach
around the door it was handed.

`load` is not queued. A reader never blocks behind a write, however long that write's `agent_invoke`
takes to answer.

## Trade-off

This corrects a defect ADR 0009 did not anticipate: `MissionStore.append` was already ordered — one
store, one internal queue, so no line is ever torn — which is precisely what made the deeper problem
invisible. What was not ordered is the **read-modify-write around it**. Each of the three writers held a
queue of its own gesture, so two could load the same Replay, both decide against a Mission that had not
moved, and both append. `evolve` tolerates the resulting duplication in the *state* — a second
`Delegated` under one id is ignored, a second halt is ignored — so nothing crashed and every existing
state assertion passed. What did not survive is the promise: two `accrue-cost` decided against the same
stale total were both compared against the Cap, and a Mission could commission work the same two
gestures, in order, would have refused.

The fix was not to lock around the store. A lock taken at `load` and given up at `append` cannot tell
"this load is half of a write" from "this load is a reader that will never append" — and this product
has readers that hold a Mission open indefinitely: a Cockpit redrawing on every frame, a drive polling
for a Handoff. Locking at `load` deadlocks all of them. The atom had to become a single call with no
seam a caller could split, which is what ruled out a wrapper and required a new collaborator.

The queue is per Mission, not global, because a Workspace running two Combinations must not make every
gesture of one wait behind the other's ten-minute `agent_invoke`. The cost of that choice is stated
rather than hidden: two `MissionStore` instances over one Workspace — two processes, or two constructions
in one — are still unordered, because neither `mission-writer.ts` nor anything else can see across that
boundary. `missionWriter` memoises per store instance specifically so this remaining unsafe construction
requires an unusual act (building a second store) rather than an easy one (asking twice), and
`cockpit/cockpit.e2e.test.ts` keeps the difference measured as two tests that must disagree, rather than
as a sentence.

## Consequences

- `bin/mz.ts` builds one `MissionStore` and one `MissionWriter` per Workspace and hands that single
  writer to the server, to every per-Zord control plane, and to any drive — the safe construction is the
  only one the entry point performs.
- Criterion 7 (the Cap halts a Mission and nothing is commissioned past it) is provable on the *composed*
  Cockpit for the first time: two genuinely concurrent gestures through one writer are decided in the
  order `record` serialises them in, one accepted and the next refused against the state the first
  produced — verified against the real, running program, not only against a test.
- A caller's **choice** of Command can still be stale — the driver decides its next gesture is `delegate`
  and another writer moves the Mission first — and that stays representable on purpose: `decide` refuses
  it, and a Refusal of a Command the driver itself submitted is what ends a drive. What this ADR makes
  unrepresentable is an **accepted** Decision made against a state that had already moved.
- ADR 0009's claim that no state lives above the file is unchanged: the writer holds no Mission state,
  only a queue of gestures still waiting on one, which drains and is dropped between them.
