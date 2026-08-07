# Review — Cockpit

**Verdict: approved.**

QA asked "does it do what was asked?" and answered yes, twice, after one reprove. This review asks
"should it have been done this way?" — against the delivered tree at `dde85c6`, after two corrections
made in this same pass (below), landing at the commit this review closes on.

## What was checked, and how

Not a re-read of the ten task reports. Every claim below was run.

```
npx tsc --noEmit --incremental false     clean
npx vitest run                            29 files / 1122 tests, six consecutive runs, one transient (below)
npx vitest run tools/                     64/64, run after every edit this review made
npm run build                             site still static, 27 routes, no engine/runtime/cockpit code in it
node bin/mz.ts <workspace>                started by hand, the view fetched, the xterm route fetched
```

Plus targeted falsification, on top of what each task already falsified at delivery: the
`bin/mz.ts → xtermAssets()` wiring gap found below was proven both ways (planted the removal, watched
`/xterm/xterm.js` 404, reverted, watched it serve 200 with the real bundle's bytes).

## 1. Rule adherence

Clean. `tools/glossary-check.test.ts` and `tools/prd-structure.test.ts` both pass over the full
`docs/prd/cockpit/` and `docs/adr/` tree, including `qa.md` and `bugs.md` — which did **not** pass when
this review began (see Corrections, below).

Spot-checked the vocabulary discipline that is easiest to get wrong in a PRD this size: every exported
name in `runtime/mcp-server.ts` and `bin/mz.ts` that carries an `_Avoid_` word (`agent`, `memory`) is a
wire-name string literal (`pane_spawn`, `memory_write`, …), never a TypeScript identifier — the pattern
`CLAUDE.md` already records, still holding.

## 2. Domain integrity

Two things earned specific attention because they are exactly where a model can be decoration instead
of a guarantee.

**Can an invalid state be constructed?** `runtime/mission-writer.ts`'s central claim — one queue per
Mission, no way to reach the store's `append` around it — was checked past what its own tests assert:
the queue map drains and deletes its entry when idle (no leak across the life of a long-running `mz`),
and two Missions genuinely do not queue behind each other (`mission-writer.test.ts`'s own "does not
queue one Mission behind another" — read and confirmed it measures what it claims, not merely that two
calls return). The one remaining unsafe construction — two `MissionStore` instances over one Workspace —
is exactly the assumption `mz` meets by construction, kept as a measured control arm rather than a
sentence, which is the standard this repository has held itself to since Task 7.

**Is the Kill answer's guard invented or copied?** `killable(state)` in `cockpit/view/client.ts` was
checked line-for-line against `decideKillMission`'s condition in `engine/domain/mission.ts` — they
match exactly (`running` or `halted`, either Halt reason). A guard that drifted from the engine's own
would be a control that lies about what the domain will accept.

## 3. Reuse and altitude

No reimplementation found. The two most likely candidates were checked directly:

- `combination-driver.ts` no longer holds a queue of its own — it was migrated to `MissionWriter.record`
  end to end, so the ordering fix exists in exactly one place rather than two.
- `mcp-server.ts`'s private `textIn(Arguments, string): string` and `replay.ts`'s private
  `textIn(unknown, string): string | undefined` share a name and nothing else — one validates a
  required RPC argument and throws, the other defends a possibly-damaged fact and answers `undefined`.
  Different modules, different contracts, both unexported. Not a duplication; a naming coincidence
  worth writing down so nobody "deduplicates" them into a function with two conflicting throw contracts.

Nothing abstracted before it earned it: `TerminalFactory` is exactly the seam Task 10 needed and no
more, and it is the second injected factory this file has needed (`AgentRunner` was the first, at the
engine's own port).

## 4. Scope discipline

`git diff --stat` against the pre-Cockpit tree touches no file under `app/`, `components/`, `lib/`, or
`docs/PRODUTO.md`. `package.json` gained exactly one dependency (`@xterm/xterm`) and one `bin` entry,
both named in `tasks.md` before they were added. Nothing else in the diff is unaccounted for by a task.

## 5. What was left behind

Two Gaps stay open, both declared and both genuinely out of this PRD's reach rather than deferred work
wearing a Gap costume:

- **A Pane's OSC title is not shown.** `xterm.js` exposes it only through an event subscription; wiring
  it is real work outside "a Pane's bytes become pixels," which is what Task 10 was scoped to.
- **A real browser's rendering is unproven.** The DOM shim is faithful about markup and event delivery
  — proven faithful by the PaneId defect it caught — and deliberately not about painting, `getComputedStyle`,
  or canvas. No criterion depends on either: criterion 1 asks for the bytes a browser receives, which is
  proven; it does not ask for a screenshot.

Neither blocks a criterion. Both are named in `tasks.md` (Task 10) rather than only in a task's own
report, which is where a Gap has to live to survive past whoever found it.

**One observation, not a Gap**: across six full-suite runs during this review, one run showed two
failures that did not reproduce in five isolated re-runs of the same file and five more full-suite
runs. This matches the class of intermittent already declared — load-sensitive flakes in
`runtime/pty-agent-runner.test.ts` and `runtime/pane-manager.test.ts`, and QA's own second-pass line
that roughly one full run in ten shows unreproducible failures under this host's load. Recorded here
rather than chased, because chasing an unreproduced flake with no failing artifact left behind would be
guessing, and the two named intermittents already have their own findings on record.

## 6. Documentation

Two things did **not** reflect what was built, both corrected in this pass rather than left as review
comments:

1. **The techspec's "Decisions worth an ADR" list predated Task 11's finding.** The single-writer fix
   (`runtime/mission-writer.ts`) is hard to reverse, surprising without the read-modify-write context,
   and the result of a real trade-off (a lock deadlocks every reader; a wrapper cannot see the seam) —
   all three of `CLAUDE.md`'s own bar for an ADR. Added `docs/adr/0012-one-writer-per-mission-file.md`
   and appended item 5 to the techspec's list, in the same style the Mission Engine PRD used for
   decisions found mid-execution ("Added in Task 7", "Added in Task 9").
2. **`CLAUDE.md`'s "Current state of the repo" section described the tree as it stood after the Mission
   Engine PRD** — 406 engine tests, no `runtime/mcp-server.ts`, no `cockpit/`, no `bin/mz.ts`, ADRs
   `0001..0007` only. Rewritten to name every module this PRD added, with test counts verified by
   running each layer in isolation (engine 414, runtime 401, cockpit 243, tools 64, total 1122) rather
   than copied from a report.
3. **`README.md` still said the repository "contains the product site."** That sentence became false
   the moment `bin/mz.ts` could start a real Cockpit. Added a "Rodar o produto" section beside the
   existing "Rodar" (renamed "Rodar o site" for the distinction), naming `node bin/mz.ts <workspace>`
   and the verification commands, without touching the site's own section.

`CONTEXT.md`'s only change across the whole PRD is one sharpened definition (`Fact`, from the Cortex
task) — no new term slipped in undocumented, and the glossary's own adherence check would have caught
one that had.

## Corrections made in this pass

Per this command's own rule — a caveat is fixed now, in this pass, not left for someone else to find
twice:

- `bin/mz.ts` was never updated to call `xtermAssets()`. Task 10 could not touch `bin/mz.ts`; nobody
  after it did either. The real, running program would have 404'd on `/xterm/xterm.js` forever. Fixed,
  and verified by starting `mz` and fetching the route before and after.
- The second QA pass had not run `npx vitest run tools/` before finishing: `qa.md` and `bugs.md` carried
  ten glossary violations (`counter`, `job`, `output`, `audit`). Reworded; already committed separately
  at `b4299d7` before this review began, and re-verified clean here.
- `docs/adr/0012` and the techspec amendment, above.
- `CLAUDE.md`'s current-state section and `README.md`, above.

## What review did not touch

The task-by-task engineering — falsification tallies, plants, the specific shape of every guard — was
each task's own executor's evidence, already checked by whoever reviewed that task before committing.
This pass re-verified the outcomes (suite, types, build, the running program) and looked for what a
task-scoped review cannot see: drift across tasks, staleness in documents nobody re-reads, and a
techspec that stopped matching the tree it specified.
