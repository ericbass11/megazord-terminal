# PRD — Cockpit: the ADE actually running

The product the engine was built for. Real terminals, real agent processes, a real orchestrator.

## Problem

Everything delivered so far is either a description of the product or its rule layer. The site
states what an ADE does; `engine/` enforces the rules an ADE must obey. Neither opens a terminal.
`AgentRunner` has one adapter and it is a fake that answers from a scripted list.

So the product cannot be used. A user cannot give a Briefing and watch a Zord work, because no
process is ever spawned, no Pane exists, nothing survives closing the process, and the orchestrator
orchestrates nothing.

## Outcome

`mz .` in a project directory opens a Cockpit where **real agent CLIs run in real terminals**,
coordinated by the rules the engine already enforces, with cost and status visible per Pane and the
whole Mission recorded to disk and resumable.

The measure is not a feature list. It is: **a person gives one Briefing and watches a team of
processes deliver, without touching another window.**

## Scope

1. **Real Pane** — a `node-pty` process per Zord, its output streamed live, input accepted, killed
   and hibernated on demand. Boot under 2s.
2. **Pane grid** — a Cockpit view rendering N live Panes at once, each with status, provider and
   running cost.
3. **Real `AgentRunner`** — spawns the Harness's `cli`, feeds the instruction, collects output,
   reports outcome. Replaces the fake outside tests.
4. **Mission on disk** — the Replay persisted as JSONL under `.megazord/`, one file per Mission,
   resumable after the app is closed.
5. **Orchestration that runs** — the Core drives a Combination: delegates Slices to Zords, receives
   Handoffs, refuses what breaks the Contract, halts at Gates and at the Cap. All of it is the
   existing engine; this PRD wires it to processes.
6. **Meter that is real** — token and cost per Pane and per Mission, read from what the CLI reports,
   and honest about what it cannot measure.
7. **Control plane** — an embedded MCP server exposing the cockpit to the agents themselves:
   `pane_spawn`, `pane_write`, `pane_read`, `handoff_submit`, `mission_create`, `memory_write`,
   `memory_read`, `agent_invoke`. The subset that makes the cockpit operable from inside.
8. **Cortex on disk** — `memory_write` / `memory_read`, workspace-scoped, surviving the session.
9. **Provider detection** — find the agent CLIs present in `PATH` and offer them per Pane, rather
   than hardcoding one.
10. **`mz` CLI** — `mz .` opens the Cockpit on the current directory.

## Out of scope, and why

1. **Native desktop shell** (Electron/Tauri, menubar, global shortcuts). The Cockpit is served
   locally and opened in a browser. Packaging is a distribution problem, not a product one, and it
   would eat the whole budget before anything runs.
2. **Media generation, Voice, Jarvis, Shot, Redline, Marketplace.** Each is a surface the site
   sells and none is needed for a team of Zords to deliver. They are additive once the loop runs.
3. **LLM-driven planning inside the Core.** The Core follows a Combination recipe deterministically
   in this cut. Having it *decide* the roster from a free-text Briefing needs a model call, a key
   and a prompt contract, and it would make the first running version non-reproducible.
4. **Git worktree per Mission.** The engine has no rule about it and it is orthogonal to seeing the
   loop run.
5. **Editor and file tree.** The Cockpit is for watching a team, and the user already has an editor
   open — that is the whole ADE thesis.
6. **Multi-account, proxies, rate-limit reading.** One account per provider.
7. **Hibernation and the 370 MB reclaim.** Kill and respawn is enough at this size.

## Acceptance criteria

1. `mz .` starts the Cockpit and it is reachable in a browser with no further steps.
2. A Pane spawns a real process in under 2 seconds, streams its output live, and accepts typed
   input that reaches the process.
3. Killing a Pane kills the child process — proven by the process no longer existing, not by the UI
   hiding it.
4. Two Panes run at the same time with different CLIs, and neither blocks the other.
5. A Mission driven from a Briefing produces at least one real Delegation to a real process, and its
   Handoff is accepted or refused by the existing engine rules, with the refusal visible.
6. A Gate halts the Mission in the Cockpit and a human answer in the UI resumes it.
7. Reaching the Cap halts the Mission and no further work is commissioned until authorised.
8. Closing the app and running `mz .` again restores the Mission from disk with its Replay intact.
9. An agent running inside a Pane can call `pane_spawn` and `handoff_submit` through the embedded
   MCP server and the Cockpit reacts.
10. A fact written with `memory_write` in one session is read by `memory_read` in the next.
11. The provider list is discovered from `PATH`, not hardcoded — proven by it changing when a CLI is
    removed.
12. `npm test` stays green, and `engine/` still has zero dependencies: the e2e import assertion must
    keep passing, so nothing in this PRD may be added inside `engine/`.

## Open risks

1. **A real CLI is not a scripted answer.** It hangs, asks interactive questions, prints ANSI, and
   returns prose where a Handoff was expected. The engine's rules were proven against a fake; the
   first real run will find rules that are wrong. That is the point of running it.
2. **Turning a Zord's prose into a Handoff is unsolved here.** The engine deliberately does not judge
   text. This PRD needs *some* answer — the narrowest one that works is that the agent submits its
   own Handoff through the MCP tool rather than the cockpit parsing its output.
3. **Cost may be unavailable.** If the CLI does not report tokens, the Meter must say zero and say
   why, never estimate.
4. **Browser-based Cockpit is a deliberate deviation** from the native app the site sells.
