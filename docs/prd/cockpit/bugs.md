# Bugs — Cockpit

Both bugs the first QA pass registered are **closed**. This file is the record of that, not a work list:
nothing here is open. The second pass's verdict, its evidence and its findings are in `qa.md`.

## BUG-1 — the Cockpit commissioned work past a Cap, because the three writers of a Mission file were not ordered — **closed**

**Criterion**: 7. Fixed by Task 11, commit `ee44937`.

`load → submit → append` was the atom and nothing held it. Appends were already ordered — one store, one
queue — so no line was ever torn, which is why this looked fine; each writer held a queue around its own
gesture, so two loaded the same Replay, both decided against a Mission that had not moved, and both wrote.

`runtime/mission-writer.ts` is the door. `record(missionId, command)` is the atom as one queue per Mission,
`load` is an unqueued relay so a Cockpit does not stop drawing behind a run that takes minutes, and the
writer has **no `append`** — the server, every control plane and every drive take it in place of the store,
so nothing can write an entry it decided against a Replay it loaded itself. `missionWriter` answers the same
writer for the same store, so a second queue cannot be made by asking twice.

What closes it:

- `runtime/mission-writer.test.ts > two gestures at once, through one door > refuses work commissioned past
  a Cap a concurrent accrual has just reached` — the expensive half, at the one level where the order of the
  two Commands is the call order.
- `cockpit/cockpit.e2e.test.ts > one door to the Mission file` — the composed product over real transports:
  two Zords' control planes, and a human at a WebSocket against a Zord at a control plane. Both were the
  pin that asserted the defect; both now assert the fix.
- The counter-arm beside them, `does not order two stores over one Workspace`, which keeps the bound of the
  fix measured rather than described.
- QA's own five scenarios through the transports plus the running program, all judged by re-deciding every
  recorded Command against the state folded from the entries before it — `[]` through one door, and the lost
  update through two. See `qa.md` criterion 7.
- Plant 1 of the second pass: with the queue taken away, 4 of the delivered tests and QA's own reading go
  red, and the two counter-arms stay green.

## BUG-2 — a Halt read off a damaged Mission file threw in the browser, and the Cockpit then drew nothing at all — **closed**

**Criterion**: bears on 6, 7 and 8. Fixed in `cockpit/view/client.ts` by commit `ee44937`.

`haltingGate` and `stoppedAtCap` dereferenced `state.halt.reason` on a Mission folded from a file the store
deliberately does not judge, one line above a guard that read `state.gates` as `unknown`. The throw was
inside the socket's own handler, so nothing caught it: the Cockpit drew nothing, for that frame and every
later one, and said nothing about why.

Both now read the Halt as `unknown` and answer nothing-to-offer rather than a plausible default — a Halt
whose reason was lost must not read as a Cap, because that would send a human to the wrong remedy. Four more
readings of the same class were swept up with it: `renderMission` on `delegations.length`, `haltingGate` and
`delegationFor` dereferencing list *elements* after guarding the list, and `renderEntry` on
`entry.decision.kind`.

What closes it: `cockpit/view/client.test.ts > a Halt no rule validated is read, never dereferenced` and
`> a frame from the server redraws the region that moved > draws a Mission whose Halt was lost, instead of
throwing in the socket listener — BUG-2`. Each of the six readings is held by a test that fails when that
reading alone is undone — plants 4, 5, 10, 11, 12 and 13 of the second pass, one per reading, none of them
green.

The stale Gap in `runtime/mission-store.ts` that cited `added()` was reworded in the same commit, so the
store no longer names a hole that two layers have since closed.

## And one the bugfix found itself, which nobody had registered — **closed**

The Kill control carried its PaneId as `data-value-paneId`, and an HTML parser lowercases attribute names,
so a browser's `dataset` key is `valuePaneid` and the name the view derived was `paneid` — which
`answerFor` does not read. The control would have sent an empty PaneId, which `cockpit/protocol.ts` refuses
and the server answers by ending the connection. So the Kill control could never have worked in a browser,
and every test agreed with the markup because nothing here parsed HTML.

The PaneId now travels as the value of a `data-value` box, like every other answer, and the `data-value-*`
reading is gone rather than fixed. What closes it: the shim in `cockpit/view/client.test.ts`, which
lowercases attribute names as a parser does — plant 6 of the second pass restores the old spelling and turns
three tests red, one of them the shim's own click test.

## Not bugs, and where they live instead

The second pass registered no new bug. It did register one finding nobody had declared — a Cockpit already
open is never told that the Mission moved unless it moved it — and it is argued as caveat 2 of `qa.md`, with
a recommendation to declare it beside the server's own Gaps and schedule it with Task 10. Task 10 itself is
open and no criterion depends on it; `qa.md` says what that means.
