# PRD — Cockpit: the ADE actually running

The product the engine was built for. Real Panes, real Zord processes, a Core that really delegates.

## Problem

Everything delivered so far is either a description of the product or its rule layer. The site
states what an ADE does; `engine/` enforces the rules an ADE must obey. Neither opens a Pane.
`AgentRunner` has one adapter and it is a fake that answers from a scripted list.

So the product cannot be used. Nobody can give a Briefing and watch a Zord work, because no process
is ever spawned, no Pane exists, nothing survives closing the app, and the Core coordinates nothing.

## Outcome

`mz .` inside a Workspace opens a Cockpit where **real Zord CLIs run in real Panes**, coordinated by
the rules the engine already enforces, with cost visible per Pane and the whole Mission recorded to
disk and resumable.

The measure is not a list of Surfaces. It is: **a person gives one Briefing and watches a Combination
of processes deliver, without switching to anything else.**

## Scope

1. **Real Pane** — a `node-pty` process per Zord, streamed live, accepting typed keystrokes, killed
   and respawned on demand. Ready in under 2 seconds.
2. **The Cockpit** — a view rendering N live Panes at once, each with its status, its provider and
   its running cost.
3. **Real `AgentRunner`** — spawns the Harness's CLI, hands it the text it must act on, collects what
   it wrote, and reports the outcome. Replaces the fake outside tests.
4. **Mission on disk** — the Replay persisted as JSONL under `.megazord/`, one file per Mission,
   resumable after the app is closed.
5. **Coordination that runs** — the Core drives a Combination: delegates Slices to Zords, receives
   Handoffs, refuses what breaks the Contract, halts at Gates and at the Cap. All of that is the
   existing engine; this PRD wires it to processes.
6. **A Meter that is real** — cost per Pane and per Mission, read from what the CLI reports, and
   honest about what it cannot measure.
7. **Control plane** — an embedded MCP server exposing the Cockpit to the Zords themselves:
   `pane_spawn`, `pane_write`, `pane_read`, `handoff_submit`, `mission_create`, `memory_write`,
   `memory_read`, `agent_invoke`. The subset that makes the Cockpit operable from inside.
8. **Cortex on disk** — `memory_write` / `memory_read`, Workspace-scoped, surviving the session.
9. **Provider detection** — find the Zord CLIs present in `PATH` and offer them per Pane, rather
   than hardcoding one.
10. **`mz` CLI** — `mz .` opens the Cockpit on the current Workspace.

## Out of scope, and why

1. **A native desktop shell** (Electron/Tauri, menubar, global shortcuts). The Cockpit is served
   locally and opened in a browser. Packaging is a distribution problem, not a product one, and it
   would eat the whole budget before anything runs.
2. **Media, Voice, Jarvis, Shot, Redline, the Mercado.** Each is a Surface the site sells and none is
   needed for a Combination to deliver. They are additive once the loop runs.
3. **A Core that plans with a model.** The Core follows a Combination recipe deterministically in
   this cut. Having it *decide* the Roster from a free-text Briefing needs a model call, a key and a
   prompt contract, and it would make the first running version non-reproducible.
4. **A git worktree per Mission.** The engine has no rule about it and it is orthogonal to seeing the
   loop run.
5. **An editor and a file tree.** The Cockpit is for watching a Combination, and the user already has
   an editor open — that is the whole ADE thesis.
6. **Multi-account, proxies, rate-limit reading.** One account per provider.
7. **Hibernation and the 370 MB reclaim.** Kill and respawn is enough at this size.
8. **Token counting.** Carried over from the Mission Engine PRD: the port reports a cost and there is
   no price list, so a `tokens` field no rule could fill would be the always-zero lie.

## Acceptance criteria

1. `mz .` starts the Cockpit and it is reachable in a browser with no further steps.
2. A Pane spawns a real process in under 2 seconds, streams what it writes live, and accepts typed
   keystrokes that reach the process.
3. Killing a Pane kills the child process — proven by the process no longer existing, not by the
   Cockpit hiding it.
4. Two Panes run at the same time with different CLIs, and neither blocks the other.
5. A Mission driven from a Briefing produces at least one real Delegation to a real process, and its
   Handoff is accepted or refused by the existing engine rules, with the Refusal visible.
6. A Gate halts the Mission in the Cockpit and a human answer there resumes it.
7. Reaching the Cap halts the Mission and no further work is commissioned until authorised.
8. Closing the app and running `mz .` again restores the Mission from disk with its Replay intact.
9. A Zord running inside a Pane can call `pane_spawn` and `handoff_submit` through the embedded MCP
   server and the Cockpit reacts.
10. A Fact written with `memory_write` in one session is read by `memory_read` in the next.
11. The provider list is discovered from `PATH`, not hardcoded — proven by it changing when a CLI is
    removed.
12. `npm test` stays green, and `engine/` still has zero dependencies: the e2e import assertion must
    keep passing, so nothing in this PRD may be added inside `engine/`.

## Open risks

1. **A real CLI is not a scripted answer.** It hangs, asks interactive questions, prints ANSI, and
   returns prose where a Handoff was expected. The engine's rules were proven against a fake; the
   first real run will find rules that are wrong. That is the point of running it.
2. **Turning what a Zord wrote into a Handoff is unsolved here.** The engine deliberately does not
   judge text. This PRD needs *some* answer — the narrowest one that works is that the Zord submits
   its own Handoff through the MCP tool rather than the Cockpit parsing what it wrote.
3. **Cost may be unavailable.** The real runner already declares zero and says why; if the CLI does
   not report spending, the Meter must keep saying zero rather than estimate.
4. **A browser-served Cockpit is a deliberate deviation** from the native app the site sells.
5. **This PRD was written before its own adherence check ran on it**, which is how it landed with 26
   naming violations against `CONTEXT.md`. Recorded because the flow's own rule — every artifact
   passes the checks — was broken by the artifact that describes the next product.
