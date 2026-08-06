# Tasks — Cockpit

Derived from `techspec.md`. Read the PRD and the techspec first.

## Granularity

**10 tasks** for 12 acceptance criteria. One is already delivered (`pty-agent-runner.ts`, ahead of
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

- **Status**: todo
- **Goal**: `mz .` starts everything and opens the Cockpit; the same drive, with the real runner, ends
  in a Delivery.
- **Touches**: `bin/mz.ts`, `package.json` bin entry, `cockpit/cockpit.e2e.test.ts`
- **Depends on**: 6, 7, 8
- **Verification**: criteria 1 and 5 — the Cockpit is reachable with no further steps, and one
  Briefing produces at least one real Delegation to a real process, with the Replay on disk. It also
  carries the two transports Task 7 deliberately did not write: the control plane's stdio framing and
  its mount on the Cockpit's port.

## Task 10 — Emulator fidelity and a real DOM

- **Status**: todo
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
  2. `jsdom` as a dev dependency, so `attach` is executed by a test. Today nothing runs it: what a
     click decides is a pure function with its own test, and that a click reaches the delegated
     listener is unproven.
  3. The Kill answer. The PRD names three human answers and Task 6 was asked for two. A Mission
     stopped at its Cap whose human does not want to spend more currently has nothing to say.
- **Verification**: a Pane running a TUI renders it; a click drives a Gate decision under a
  real DOM; `kill-mission` from the view ends a Mission halted at its Cap.
- **Why it is a task and not a caveat fixed in place**: all three need `package.json`, and two need
  `cockpit/server.ts` — a route that does not exist and is Task 5's delivered code. Installing a
  dependency inside a task that was told not to have one is the scope creep this flow exists to stop.
  Both packages were confirmed installable from this environment before the task was written.
