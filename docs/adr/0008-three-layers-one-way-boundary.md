# 0008 — Three layers, and the boundary between them points one way

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/cockpit/`

## Decision

The source tree has three top-level layers, and imports cross between them in exactly one direction:

```
engine/    the rules. Pure, total, deterministic. No dependency of any kind.
runtime/   the operating system: processes, disk, PATH. May import engine/.
cockpit/   HTTP and WebSocket. Holds no rule. May import engine/ and runtime/.
```

`engine/` must never import `runtime/` or `cockpit/`, and both halves of that are pinned by a test
rather than remembered. `engine/mission.e2e.test.ts` reads every non-test file under `engine/` and
asserts every `from "…"` specifier is a relative path — so the engine cannot acquire a dependency, and
it cannot name a layer above it either. `runtime/pty-agent-runner.test.ts` asserts from the other side
that no specifier under `engine/` contains `runtime`.

Every import from `runtime/` or `cockpit/` names `@engine/index`, never `@engine/domain/*`.

## Trade-off

The cost is a third top-level folder and a rule to remember, when two would have read as enough — the pty
adapter would sit naturally in `engine/adapters/` beside the fake, next to the port it implements. It
cannot: the real `AgentRunner` needs `node-pty`, a native dependency, and putting it there would fail
the engine's own import assertion and stop the rules being typecheckable, testable and readable on a
machine with no native toolchain.

That is the trade-off stated properly. The question a new capability raises is not how to hide its
dependency but which layer is allowed to have one, and the answer has to exist before the capability
arrives, or the first native dependency decides it by accident.

The `@engine/index`-only rule has its own cost: the public surface has to carry everything the layers
above need, and widening it is a decision rather than an import. Two live precedents pointing opposite
ways — two of the first three `runtime/` modules reached into `@engine/domain/*` and a third obeyed —
is how the next five deliveries each pick one at random.

## Consequences

- The engine stays installable-free and its whole test suite runs with no network and no toolchain.
- A dependency is a location decision. `node-pty` lives in `runtime/`; the hand-rolled RFC 6455
  implementation in `cockpit/server.ts` exists because the layer that is allowed a dependency is not the
  layer that needed a WebSocket.
- The store goes further than the boundary requires and imports the engine **only as types**, so no
  engine code runs inside it. That is ADR 0009's subject, not this one's.
- Criterion 12 of the Cockpit PRD is this ADR's proof: `npm test` green, and the engine's import
  assertion still passing.
