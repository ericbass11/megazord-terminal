# Tasks — Cockpit

Derived from `techspec.md`. Read the PRD and the techspec first.

## Granularity

**9 tasks** for 12 acceptance criteria. One is already delivered (`pty-agent-runner.ts`, ahead of
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

- **Status**: todo
- **Goal**: the Cockpit drawing each Pane with `xterm.js`, per-Pane status and cost, the Mission bar with the Meter,
  and the two human answers: a Gate decision and a Cap authorisation.
- **Touches**: `cockpit/view/**` and tests
- **Depends on**: 5
- **Verification**: criteria 6 and 7 — a Gate halts and answering resumes; the Cap halts and nothing
  is commissioned until authorised.

## Task 7 — Control plane

- **Status**: todo
- **Goal**: the embedded MCP server with `pane_spawn`, `pane_write`, `pane_read`, `handoff_submit`,
  `mission_create`, `memory_write`, `memory_read`, `agent_invoke`.
- **Touches**: `runtime/mcp-server.ts` and test
- **Depends on**: 1, 3, 4, 5
- **Verification**: criterion 9 — a client calls `pane_spawn` and `handoff_submit`, and both take
  effect in the Cockpit.

## Task 8 — The Core that drives a Combination

- **Status**: todo
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
