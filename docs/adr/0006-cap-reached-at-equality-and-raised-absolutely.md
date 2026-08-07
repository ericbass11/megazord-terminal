# 0006 — The Cap is reached at equality, and an Authorisation raises it to a new absolute amount

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/` (decided during Task 7)

## Decision

`hasReachedCap` in `engine/domain/meter.ts` is `spent >= cap`, and it is the only place the boundary
exists. The Cap is **reached**, not exceeded: a Cap of R$ 50,00 with R$ 50,00 spent has nothing left in
it, and a Mission with a Cap of zero has reached it before spending anything.

An `authorise-cap` Command carries a **new, absolute** Cap, which must be strictly above what was
already spent. It raises the Cap and leaves `spent` alone. It is not a Cap editor: on a Mission whose Cap
is not what stopped it, it is refused `illegal-transition`, and on a Mission halted at a Gate it is
refused in `decide` *and* ignored in `evolve`, so a hand-written log cannot walk a Mission past a Gate by
raising its Cap.

## Trade-off

Read as "exceeded", the product would have to breach the limit before honouring it: every Mission would
overspend by at least one cent and the number a human typed would not be the limit. Read at equality, a
Cap of zero halts a Mission that has spent nothing — awkward-looking, and correct, since a Mission with
no money commissions no work.

Resuming at the same Cap was rejected for the same kind of reason: the limit would still be reached, the
next commissioning Command would be refused again, and "the Mission stops and asks for authorisation"
would be a loop instead of a question. What a human answers is not "carry on?" but "how much more?".
Absolute rather than an increment, because an increment applies to a `spent` the authoriser read a minute
ago, so two authorisations from stale readings produce a Cap nobody chose — and "+R$ 30" needs a second
fact to be legible in a Replay.

## Consequences

- An accrual that crosses the Cap is **accepted**, and the halt is the second Event of the same Decision.
  The money was already gone; refusing the report would only make the Meter understate what the Mission
  cost, and the Cap is compared against that total.
- `accrue-cost` stays accepted on a Mission halted at its Cap — a Zord mid-run keeps reporting, which is
  how a Cap gets reached — and is refused only once the Mission has ended.
- `cap-reached` is a state's reason, not a Command's: `delegate`, `submit-handoff` and `deliver-mission`
  are refused with it, while `open-mission` and `decide-gate` keep their own more specific answers,
  because sending a human to the wrong remedy is worse than a vague one.
