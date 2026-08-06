# 0004 — Money is integer BRL cents

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/`

## Decision

Every amount in the engine is a `Money`: a branded `number` holding whole BRL cents, defined in
`engine/domain/money.ts`. `moneyFromCents` refuses a fraction, a negative, a non-finite value and
anything past `Number.MAX_SAFE_INTEGER`, where addition would start losing cents. Reais arrive as text
through `moneyFromDecimal("12,34")`; a float has no way in. There is `addMoney` and `compareMoney`, and
deliberately no subtraction and no division — nothing in this domain un-spends money, and an operation
nobody needs is an operation somebody will misuse.

## Trade-off

Cents cost something at every boundary: a runner that knows a float must convert at the port, a Surface
must format for display, and there is no arithmetic beyond addition and comparison. In exchange, the one
comparison this product's central promise rests on — `spent >= cap` — is exact. Cost accrues in many
small increments and is then compared against a limit a human typed, and with floats those two facts
combine into a Cap that is silently off by a fraction of a cent and a Mission that halts a little late,
or never. The bug would appear in production, in money, and would be untraceable.

## Consequences

- The `AgentRunner` port answers with `Money`, so the conversion happens once, at the edge, where
  `moneyFromCents` can refuse a fraction loudly.
- `addMoney` throws past the exactly-representable range, which is why `decide` wraps it: an accrual it
  cannot record exactly is refused `cap-reached`, truthfully, since such a total is beyond any Cap.
- An Authorisation raises the Cap and never touches `spent` — there is no subtraction to reach for
  (ADR 0006).
