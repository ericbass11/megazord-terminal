# Tasks — Cockpit

Derived from `techspec.md`. Read the PRD and the techspec first.

## Granularity

**11 tasks** for 12 acceptance criteria. One is already delivered (`pty-agent-runner.ts`, ahead of
this PRD being written), so eight remain.

Justified: four are independent runtime modules with proofs that do not touch each other (Panes,
Replay on disk, providers, Cortex), and three are the Cockpit itself, which cannot be split further
without a half-server nobody can run. The end-to-end run is its own task because it is the criterion
that proves the product exists.

**Amended after Task 5, and the reason is recorded rather than silently absorbed.** The list was
written with eight, and Task 8 carried two things: the Core that drives a Combination, and `mz` with
the run that proves the product. Neither the techspec's structure list nor any task named the driver,
so it would have arrived as an unnamed half of the entry point — the largest body of logic in this
PRD, delivered with the least attention, in the task whose verification is about something else.
Splitting it gives each half a proof that can fail on its own: the driver is provable against the
fake runner with no process at all, and `mz` is provable by starting it. The count changed; no
criterion did.

## Task 1 — Mission store on disk

- **Status**: done
- **Goal**: the Replay persisted as JSONL under `.megazord/`, appended per entry, loaded back whole.
- **Touches**: `runtime/mission-store.ts` and test
- **Depends on**: none
- **Verification**: criterion 8 — append a Replay containing a Refusal and a Gate decision, reopen
  from disk in a fresh process, and `stateOf` equals the state before closing.

## Task 2 — Provider detection

- **Status**: done
- **Goal**: which Zord CLIs exist in `PATH`, with the Catalog default for each.
- **Touches**: `runtime/providers.ts` and test
- **Depends on**: none
- **Verification**: criterion 11 — a fixture `PATH` with a CLI present and absent, and the list changes.

## Task 3 — Pane manager

- **Status**: done
- **Goal**: the live process table: spawn, stream what the process wrote, deliver keystrokes, kill the
  tree, report status.
- **Touches**: `runtime/pane-manager.ts` and test
- **Depends on**: none — it reuses the kill and timeout mechanics already proven in `pty-agent-runner.ts`
- **Verification**: criteria 2, 3 and 4 — first byte under 2s, keystrokes echoed, the tree gone after
  kill with a SIGHUP-ignoring grandchild, two Panes interleaving.

## Task 4 — Cortex on disk

- **Status**: done
- **Goal**: `memory_write` / `memory_read` against a Workspace-scoped file, a Fact carrying who wrote
  it and the Mission it came from.
- **Touches**: `runtime/cortex-store.ts` and test
- **Depends on**: none
- **Verification**: criterion 10 — written in one process, read in another.

## Task 5 — Cockpit server and protocol

- **Status**: done
- **Goal**: HTTP + WebSocket, the discriminated envelope, `submit` wired so a gesture becomes a
  Command and a Refusal is sent back verbatim.
- **Touches**: `cockpit/server.ts`, `cockpit/protocol.ts` and tests
- **Depends on**: 1, 3
- **Verification**: criterion 1 — the view is fetched from an ephemeral port; a `submit` that the
  engine refuses returns the Refusal rather than silence.

## Task 6 — The Cockpit view

- **Status**: done
- **Goal**: the Cockpit drawing each Pane with `xterm.js`, per-Pane status and cost, the Mission bar with the Meter,
  and the two human answers: a Gate decision and a Cap authorisation.
- **Touches**: `cockpit/view/**` and tests
- **Depends on**: 5
- **Verification**: criteria 6 and 7 — a Gate halts and answering resumes; the Cap halts and nothing
  is commissioned until authorised.

## Task 7 — Control plane

- **Status**: done
- **Goal**: the embedded MCP server with `pane_spawn`, `pane_write`, `pane_read`, `handoff_submit`,
  `mission_create`, `memory_write`, `memory_read`, `agent_invoke`.
- **Touches**: `runtime/mcp-server.ts` and test
- **Depends on**: 1, 3, 4, 5
- **Verification**: criterion 9 — a client calls `pane_spawn` and `handoff_submit`, and both take
  effect in the Cockpit.

## Task 8 — The Core that drives a Combination

- **Status**: done
- **Goal**: the deterministic driver: given a Briefing and a Combination, it opens the Mission,
  delegates each Slice in the declared order, invokes the Zord for each, submits the Handoff it gets
  back, resubmits after a Refusal, raises the Combination's Gates, and delivers.
- **Touches**: `runtime/combination-driver.ts` and test
- **Depends on**: 1, 3, 7
- **Verification**: criterion 5, against `fakeAgentRunner` — one Briefing, a Delegation per Slice, a
  Handoff refused and then accepted, a Gate raised and answered, ending in a Delivery, with the whole
  Replay on disk. Every gesture goes through `submit`; the driver decides nothing the engine decides.
- **Out of scope, stated because it is the tempting part**: planning with a model. PRD out-of-scope 3
  pins the driver to following a declared Roster in order. A Combination is data, not something judged.

## Task 9 — `mz` and the run against real processes

- **Status**: done
- **Goal**: `mz .` starts everything and opens the Cockpit; the same drive, with the real runner, ends
  in a Delivery.
- **Touches**: `bin/mz.ts`, `package.json` bin entry, `cockpit/cockpit.e2e.test.ts`
- **Depends on**: 6, 7, 8
- **Verification**: criteria 1 and 5 — the Cockpit is reachable with no further steps, and one
  Briefing produces at least one real Delegation to a real process, with the Replay on disk. It also
  carries the two transports Task 7 deliberately did not write: the control plane's stdio framing and
  its mount on the Cockpit's port.

## Task 10 — Emulator fidelity and a real DOM

- **Status**: done
- **Goal**: the three things Task 6 could not reach because it was not allowed a dependency, plus the
  human answer it was not asked for.
- **Touches**: `package.json`, `cockpit/server.ts`, `cockpit/view/**`, and their tests
- **Depends on**: 6
- **Scope**, each item declared by Task 6 as a Gap and each verified by the reviewer as real:
  1. `@xterm/xterm` as a dependency, served from a second route, replacing the emulator Task 6 wrote
     by hand. What the hand-written one cannot do is written into its own module: no alternate
     buffer (the `1049` mode a TUI switches into), no insert or delete line, no scroll region, no
     reflow on resize, one column per code point, no mouse. A Zord CLI that runs as a TUI therefore
     draws over the scrollback instead of into a buffer of its own, and most of them run as one.
  2. ~~`jsdom` as a dev dependency, so `attach` is executed by a test.~~ **Closed by the bugfix, and
     the excuse was wrong.** QA severed the one wire between a click and a Command and 1078 tests
     stayed green, then disproved the premise by executing the served bootstrap under a shim it wrote.
     `attach` is now driven by a shim that decides nothing of its own — it parses the markup the
     renderers really emitted and delivers events to the listeners really registered, and every
     assertion about meaning compares against the module's own exported `answerFor`/`keystrokesOf`.
     It found a live defect on its first run. What `jsdom` would still buy is a real browser's own
     `closest`, `dataset`, real event delivery and `innerHTML` parsing, which stays this item's scope.
  3. The Kill answer. The PRD names three human answers and Task 6 was asked for two. A Mission
     stopped at its Cap whose human does not want to spend more currently has nothing to say.
- **Verification**: a Pane running a TUI renders it; a click drives a Gate decision under a
  real DOM; `kill-mission` from the view ends a Mission halted at its Cap.
- **Delivered.** `@xterm/xterm` is a real dependency, served same-origin from `${XTERM_PATH}` on the
  Cockpit's own server; the hand-rolled emulator (`Screen`, `feed`, the CSI/OSC parser) is deleted
  rather than kept as a fallback, because the library implements every one of the six things it
  declared missing. Kill is wired the same way every other answer is — through `submit` — and its
  guard (`killable`) is copied from `decideKillMission`'s own condition rather than approximated.
  `bin/mz.ts` was one line short of using the new route (`xterm: await xtermAssets()`); added and
  verified against the real, running program, not only against a test.
- **Declared Gap carried forward**: a Pane's OSC title (`ESC ] 0 ; text BEL`) is no longer
  shown anywhere. `xterm.js` exposes it only through an event subscription (`onTitleChange`), which
  is a small addition outside "bytes become pixels" and belongs to whoever next touches the Pane
  chrome. And a real browser's `.open()` — painting, `getComputedStyle`, canvas — stays unproven, as
  it was after Task 6: the DOM shim is faithful about markup and event delivery, deliberately not
  about rendering a browser does not delegate to a library.
- **Why it is a task and not a caveat fixed in place**: all three need `package.json`, and two need
  `cockpit/server.ts` — a route that does not exist and is Task 5's delivered code. Installing a
  dependency inside a task that was told not to have one is the scope creep this flow exists to stop.
  Both packages were confirmed installable from this environment before the task was written.

## Task 11 — One door to the Mission file

- **Status**: done
- **Severity**: this is a correctness hole, not a tidy-up. Read the second bullet before scheduling it.
- **Goal**: one queue in front of `load → submit → append`, so the three writers of a Mission cannot
  decide against a state another one has already moved.
- **Touches**: `runtime/mission-writer.ts` (new), and the options of `cockpit/server.ts`,
  `runtime/mcp-server.ts` and `runtime/combination-driver.ts`
- **Depends on**: 9
- **What is actually wrong**, declared by Task 9 and confirmed in review:
  - Appends **are** ordered — all three writers share one `MissionStore`, so no line is ever torn.
  - The **read-modify-write is not**. The server, each control plane and the driver each decide against
    a Replay they loaded a moment ago, and nothing orders the three.
  - driver ↔ control plane is safe by construction: the driver appends nothing while a run is in
    flight. server ↔ driver is narrow, because a drive stops at every Halt. **server ↔ control plane is
    real and ordinary** — a human answering a Gate while a Zord submits a Handoff.
  - The worst case is not a duplicated record. Two `accrue-cost` decided against the same stale total
    are **both** compared against the Cap, so a Mission can be allowed to commission work past a Cap
    that the second accrual would have closed. That is the one promise this product makes about money.
- **The fix, and why it cannot be done from above**: the atom is `load → submit → append`, so it needs
  one door — a module owning one queue and exposing `record(missionId, command)`, injected in place of
  the store into all three. A wrapper around the store cannot do it: it sees `load` and `append` as two
  calls with nothing between them, and a lock taken at `load` deadlocks every reader that never appends
  (the driver polling for a Handoff, a new WebSocket rendering, `delegationUnder`).
- **Verification**: the A/B already in `cockpit/cockpit.e2e.test.ts` — the same two concurrent Commands
  through two writers are both accepted, and through one are accepted-then-refused. It is written to go
  red the day this is fixed, so the pin is replaced by the real assertion rather than deleted.
