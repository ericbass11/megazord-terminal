# Bugs — Cockpit

Open bugs from `qa.md`. Both must be closed before this ships; a caveat is not here.

## BUG-1 — the Cockpit commissions work past a Cap, because the three writers of a Mission file are not ordered

**Criterion**: 7 — "Reaching the Cap halts the Mission and no further work is commissioned until
authorised."

### What is wrong

`load → submit → append` is the atom, and nothing holds it. `cockpit/server.ts` has one queue of its own,
every `controlPlane` has one of its own, and `runtime/combination-driver.ts` has none. `startCockpit` hands
all of them the same `MissionStore`, which orders the **appends** — so no line is ever torn — and orders
nothing else. Two writers therefore load the same Replay, both decide against a Mission that has not moved
yet, and both append.

The engine is not at fault and neither is any one writer. `decide` answers truthfully about the state it was
handed; the state it was handed is stale.

The cost is not a duplicated record. A Delegation decided against a Mission that had spent nothing is
**accepted**, and it stays accepted after the concurrent accrual has closed the Cap. Work is commissioned
that the same two gestures, ordered, refuse.

### How to reproduce it

One `cockpitServer` and one `controlPlane` over one `missionStore` on one Workspace — the pair
`bin/mz.ts` builds and calls "real and ordinary" in its own module doc. Open a Mission with a Cap of 100
cents, make one Delegation, then run these two at the same moment:

- through the WebSocket, a `submit` carrying a second `delegate`;
- through the control plane, an `agent_invoke` on the first Delegation whose runner answers a cost of 100
  cents.

```
concurrent   open-mission:accepted | delegate:accepted | delegate:accepted | accrue-cost:accepted
             stateOf → 2 Delegations, spent 100, cap 100, reached: true, refusedIn → 0

ordered      open-mission:accepted | delegate:accepted | accrue-cost:accepted | delegate:refused
             stateOf → 1 Delegation, the second refused cap-reached
```

The second row is the counterfactual, run over the same store and the same gestures with the accrual
awaited first. The only variable is how many queues sit in front of the file.

A smaller reproduction already lives in the tree and passes today because it pins the defect:
`cockpit/cockpit.e2e.test.ts > Finding — two writers on one Mission file are not ordered`. It opens one
Mission twice through two control planes and asserts both Decisions are accepted. Its neighbour is the
control that shows one queue refusing the second.

### What it costs

The Cap is the only promise this product makes about money, and it is the promise a human relies on when
they leave a Combination running. Past it, a Mission commissions a Slice nobody authorised, and a Zord runs
and spends against it. The record is worse than the money: the Replay carries an accepted Decision that
would have been refused, so reading the file afterwards cannot tell you it happened.

Two of the three pairs are safe and only one is ordinary, which is why this has not been seen: the driver
appends nothing while a run is in flight, and a drive stops at every Halt. The pair that bites is the server
and a control plane — a human answering a Gate while a Zord reports — and that is the ordinary case in a
running Cockpit.

### Where the fix belongs

Task 11, whose shape is already worked out and correct. A new `runtime/mission-writer.ts` owning one queue
and exposing `record(missionId, command): Promise<ReplayEntry>`, injected in place of the `MissionStore`
into `cockpit/server.ts`, `runtime/mcp-server.ts` and `runtime/combination-driver.ts`.

It cannot be done by wrapping the store: a wrapper sees `load` and `append` as two calls with nothing
between them, and a lock taken at `load` and given up at `append` deadlocks on every reader that loads and
never appends — `waitForHandoff` polling, `delegationUnder`, and each new WebSocket rendering where the
Mission stands.

When it lands, `cockpit/cockpit.e2e.test.ts > Finding — two writers on one Mission file are not ordered`
goes red. It was written to. Replace it with the assertion the fix earns rather than deleting it, and add the
Cap case above — the current pin is about a duplicated `open-mission`, which is the cheap half of the
defect, and no test anywhere asserts the expensive half.

## BUG-2 — a Halt read off a damaged Mission file throws in the browser, and the Cockpit then draws nothing at all

**Criterion**: bears on 6, 7 and 8 — the Cockpit is where a Gate is answered, where a Cap is authorised, and
what a human looks at after reopening a Mission.

### What is wrong

`cockpit/view/client.ts` reads a Mission that arrived over the socket, and it is careful about it
everywhere but one place. `renderMission` wraps the Briefing in `String(...)`, `renderMeter` checks
`typeof meter.spent === "number"`, `renderEntry` reads `entry.command?.kind` as `unknown` and guards
`refusal?.violations` with `Array.isArray`, and `haltingGate` itself guards `state.gates` with
`Array.isArray`.

The exception is the Halt. Both of these dereference a field no rule validated:

```ts
// haltingGate
if (state === undefined || state.status !== "halted" || state.halt.reason !== "gate-open") {
// stoppedAtCap
return state !== undefined && state.status === "halted" && state.halt.reason === "cap-reached";
```

`runtime/mission-store.ts` deliberately does not judge what it loads, and ADR 0009 argues why. Its own
declared Gap names this exact family — "the skeleton check guarantees an entry can be read, not that the
inside of a fact is well-formed" — and cites `added()` in `engine/domain/replay.ts` reading
`event.harness.cli` without reading it as `unknown` first. **That half was closed in this PRD**: commit
`7904a49` hardened the engine's reading and its test covers a `mission-halted` fact with no `halt` at all.
The same damage, one layer up, in the layer whose whole purpose is to be looked at, is still open.

### How to reproduce it

Write a Mission file whose halting fact lost its Halt — one line, the shape a hand-edited or recovered file
carries:

```
{"kind":"mission-halted","missionId":"m","occurredAt":"…","halt":null}
```

`stateOf` folds it to `{ status: "halted", halt: null }`, without complaint and correctly — that is what
the log says. `cockpitServer` then serves it: the first frame a client receives carries that state, with
its Meter, and the connection is not closed. In the browser the frame reaches `attach`'s redraw,
`renderMission` calls `renderAnswers`, and:

```
TypeError: Cannot read properties of null (reading 'reason')
```

I drove this through the served document's own bootstrap and its socket listener. The throw is inside the
`message` handler, so nothing catches it: the region keeps whatever it last held — "waiting for the Mission"
on a first connection — and every later frame throws in the same place. The Cockpit never draws the Mission,
the Meter, the Panes or the record, and says nothing about why.

### What it costs

The Cockpit is unusable for that Mission, silently, with no way in from the browser: no Gate can be
answered, no Cap authorised, no Pane ended, and the record nobody can read is the record a human opened the
Cockpit to read. It is the failure this repository keeps choosing against — under-reporting gets believed —
in the one place a human is looking.

It needs a damaged file, so it is not the ordinary path, and that is why it is second rather than first.
What makes it a bug rather than something to live with is that a damaged file is exactly when a human most
needs the record, that the engine hardened the same fact against the same damage inside this PRD, and that
the fix is two lines.

### Where the fix belongs

`cockpit/view/client.ts`, in `haltingGate` and `stoppedAtCap`. Read the Halt as `unknown` before its
`reason`, the way `renderEntry` already reads a Refusal — every condition inline in its `if`, because
TypeScript does not narrow through an aliased compound condition that uses `in`. A Mission whose Halt cannot
be read is waiting for nothing this view can name, so both should answer "nothing to offer" rather than
throw, and the rest of the Cockpit draws.

Two things belong with it:

- A test in `cockpit/view/client.test.ts` beside `draws a Refusal whose fields were lost to a cast, instead
  of throwing in the tab`, which is the same rule stated for the other half of a Step.
- The Gap in `runtime/mission-store.ts` that cites `added()` should be reworded: the engine's half is
  closed, and after this fix so is the view's.
