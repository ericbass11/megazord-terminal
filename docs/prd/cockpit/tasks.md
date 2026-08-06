# Tasks — Cockpit

Derived from `techspec.md`. Read the PRD and the techspec first.

## Granularity

**8 tasks** for 12 acceptance criteria. One is already delivered (`pty-agent-runner.ts`, ahead of
this PRD being written), so seven remain.

Justified: four are independent runtime modules with proofs that do not touch each other (Panes,
Replay on disk, providers, Cortex), and three are the Cockpit itself, which cannot be split further
without a half-server nobody can run. The end-to-end run is its own task because it is the criterion
that proves the product exists.

## Task 1 — Mission store on disk

- **Status**: done
- **Goal**: the Replay persisted as JSONL under `.megazord/`, appended per entry, loaded back whole.
- **Touches**: `runtime/mission-store.ts` and test
- **Depends on**: none
- **Verification**: criterion 8 — append a Replay containing a Refusal and a Gate decision, reopen
  from disk in a fresh process, and `stateOf` equals the state before closing.

## Task 2 — Provider detection

- **Status**: todo
- **Goal**: which Zord CLIs exist in `PATH`, with the Catalog default for each.
- **Touches**: `runtime/providers.ts` and test
- **Depends on**: none
- **Verification**: criterion 11 — a fixture `PATH` with a CLI present and absent, and the list changes.

## Task 3 — Pane manager

- **Status**: todo
- **Goal**: the live process table: spawn, stream what the process wrote, deliver keystrokes, kill the
  tree, report status.
- **Touches**: `runtime/pane-manager.ts` and test
- **Depends on**: none — it reuses the kill and timeout mechanics already proven in `pty-agent-runner.ts`
- **Verification**: criteria 2, 3 and 4 — first byte under 2s, keystrokes echoed, the tree gone after
  kill with a SIGHUP-ignoring grandchild, two Panes interleaving.

## Task 4 — Cortex on disk

- **Status**: todo
- **Goal**: `memory_write` / `memory_read` against a Workspace-scoped file, a Fact carrying who wrote
  it and the Mission it came from.
- **Touches**: `runtime/cortex-store.ts` and test
- **Depends on**: none
- **Verification**: criterion 10 — written in one process, read in another.

## Task 5 — Cockpit server and protocol

- **Status**: todo
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

## Task 8 — `mz` and the end-to-end run

- **Status**: todo
- **Goal**: `mz .` starts everything and opens the Cockpit; a Briefing drives a Combination of real
  processes to a Delivery.
- **Touches**: `bin/mz.ts`, `package.json` bin entry, `cockpit/cockpit.e2e.test.ts`
- **Depends on**: 6, 7
- **Verification**: criterion 5 — one Briefing, at least one real Delegation to a real process, a
  Handoff refused and then accepted, ending in a Delivery, with the Replay on disk.
