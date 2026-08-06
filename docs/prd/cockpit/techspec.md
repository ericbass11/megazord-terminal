# Techspec — Cockpit

Technical spec for `docs/prd/cockpit/prd.md`. Read that first.

## Approach

Three layers, and the boundary between them is the whole design.

- **`engine/`** — untouched. Pure, no dependencies, and the e2e test asserts it. Every rule about
  Missions already lives there and none of it is reimplemented here.
- **`runtime/`** — the operating system: processes, disk, `PATH`. Allowed dependencies. Imports from
  `engine/`, never the reverse. `pty-agent-runner.ts` is already delivered here.
- **`cockpit/`** — a local HTTP + WebSocket server and the single view it serves. It owns no rule: it
  turns human gestures into Commands, hands them to `submit`, and draws what came back.

The Cockpit is served locally and opened in a browser, not packaged as a native app. `xterm.js`
draws each Pane and a WebSocket carries what the process wrote; a Pane is a `node-pty` child on the
server side, so what the browser shows is a real process, not a transcript.

**No state lives in the server that is not derivable.** The Mission is the Replay on disk, and the
state is `stateOf(replay)` — the same rule the engine already enforces, extended to a file. What the
server does hold is the live process table, which is not state, because a process cannot be folded.

## Structure

```
runtime/
  pty-agent-runner.ts     delivered — spawns a Zord CLI, reports the outcome
  pane-manager.ts         the live process table: spawn, stream, write, kill, status
  mission-store.ts        the Replay as JSONL under .megazord/, append and load
  providers.ts            which Zord CLIs exist in PATH
  cortex-store.ts         Facts on disk, Workspace-scoped
  mcp-server.ts           the embedded control plane, 8 tools
cockpit/
  server.ts               HTTP + WebSocket, the protocol, static serving
  protocol.ts             the message envelope both sides share
  view/                   the served view: the Cockpit, the Mission bar, the Gate answer
bin/
  mz.ts                   `mz .` — start the server, open the browser
```

## Contracts

```ts
// runtime/pane-manager.ts
type PaneId = Branded<"PaneId">;
type PaneStatus = "starting" | "working" | "idle" | "delivered" | "failed" | "killed";
interface PaneManager {
  spawn(open: { paneId: PaneId; cli: string; argv: readonly string[]; cwd: string }): void;
  write(paneId: PaneId, keystrokes: string): void;
  kill(paneId: PaneId): Promise<void>;      // resolves once the process tree is gone
  onData(listen: (paneId: PaneId, chunk: string) => void): void;
  onStatus(listen: (paneId: PaneId, status: PaneStatus) => void): void;
}

// runtime/mission-store.ts — the Replay is the file
interface MissionStore {
  append(missionId: MissionId, entry: ReplayEntry): Promise<void>;
  load(missionId: MissionId): Promise<Replay>;
  list(): Promise<readonly MissionId[]>;
}

// cockpit/protocol.ts — one envelope, discriminated, both directions
type FromCockpit =
  | { kind: "submit"; command: MissionCommand }        // decided by the engine, appended if accepted
  | { kind: "pane-write"; paneId: PaneId; keystrokes: string }
  | { kind: "pane-kill"; paneId: PaneId };
type ToCockpit =
  | { kind: "pane-data"; paneId: PaneId; chunk: string }
  | { kind: "pane-status"; paneId: PaneId; status: PaneStatus }
  | { kind: "decided"; entry: ReplayEntry }            // accepted Events or the Refusal, verbatim
  | { kind: "mission"; state: Mission; meter: Meter };
```

**The one rule the Cockpit may not break:** a human gesture becomes a `MissionCommand` and goes
through `submit`. It never mutates a Mission directly, and a Refusal is rendered rather than hidden —
the Replay is the record and the UI is a reading of it.

## Rejected alternatives

- **A native shell (Electron/Tauri) first.** It is what the site sells, and it is packaging. Nothing
  about a process in a Pane needs it, and it would consume the budget before a Zord ran once.
- **Parsing what a Zord wrote to build its Handoff.** The engine refuses to judge text, deliberately.
  The Zord submits its own Handoff through the control plane instead — which is also how the site
  describes it: the Zord finishes and reports through its Handoff.
- **A database.** The Replay is append-only and per Mission; JSONL is the shape the data already has.
- **Keeping Mission state in server memory.** It would be a second copy of a truth the file holds,
  and a hand-edited file could then disagree with it.
- **Reusing the Next.js app for the Cockpit view.** A WebSocket needs a custom server, and mixing the
  marketing site with the Cockpit couples two things with different lifetimes.

## Decisions worth an ADR

1. **Three layers with a one-way boundary**, `engine/` ← `runtime/` ← `cockpit/`, enforced by a test.
2. **The Replay on disk is the Mission**; server state is derived, never stored.
3. **A Zord submits its own Handoff** through the control plane; the Cockpit never parses prose.
4. **The Cockpit is browser-served, not a native app**, and why that is a deviation worth taking.

## Verification plan

| PRD criterion | Proof |
| --- | --- |
| 1 | a test starts the server on an ephemeral port and fetches the view |
| 2 | `pane-manager.test.ts`: real spawn, first byte under 2s, keystrokes echoed back |
| 3 | the process tree is gone after `kill`, read from `/proc`, with a SIGHUP-ignoring grandchild |
| 4 | two Panes, two CLIs, what each wrote interleaving from both |
| 5 | an end-to-end run: Briefing, Delegation, a Handoff refused then accepted |
| 6 | a Gate halts, a `decide-gate` from the protocol resumes it |
| 7 | an accrual past the Cap halts, the next commissioning Command is refused |
| 8 | `mission-store.test.ts`: append, reopen from disk, `stateOf` equals the pre-close state |
| 9 | `mcp-server.test.ts`: a client calls `pane_spawn` and `handoff_submit` and both take effect |
| 10 | `cortex-store.test.ts`: written in one process, read in another |
| 11 | `providers.test.ts`: a fixture `PATH` with and without a CLI |
| 12 | `npm test`, and the engine's own import assertion |
