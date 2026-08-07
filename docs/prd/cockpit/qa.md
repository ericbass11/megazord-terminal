# QA — Cockpit (second pass, after the bugfix)

**Verdict: approved.** All twelve acceptance criteria hold. BUG-1 is closed at its cause and criterion 7 —
the one that failed the first pass — now holds on the composed Cockpit, which I reproved by running the
previous pass's own scenario and four harder ones. BUG-2 is closed, and so are the four readings of its
class the bugfix swept up beside it. One open item remains and it is Task 10, which no criterion depends
on; one finding is recorded that nobody has declared, and it is not a criterion either. Both are argued
below rather than hedged.

I wrote none of this code and none of the previous verdict. Everything below was run in this pass. Where
the first pass's evidence was a claim about the composed Cockpit, I built the composition myself and
measured it; where a check could only pass, I broke the thing it watches and made it go red.

## What I ran

The baseline, verified rather than taken from the commit message:

```
npx vitest run                          29 files, 1124 tests, all passing, 11.25s
npx tsc --noEmit --incremental false    exit 0, no diagnostics
npm run build                           exit 0, Compiled successfully, 28 static pages
```

Twelve full runs of the suite over the session: nine green at 1124, three with failures. See caveat 8 —
the two failures I could name are both recorded in `CLAUDE.md` as intermittent and neither belongs to this
change.

On the running program, twice started as a human starts it:

```
node bin/mz.ts <workspace>              banner, ephemeral port, Workspace, Mission, Providers, Control
curl <url>/                             200, 72435 bytes, text/html
curl <url>/nope                         404
POST /mcp/scout mission_create          accepted, one line in .megazord/missions/mission-1.jsonl
two concurrent POSTs, /mcp/one /mcp/two accepted once; both duplicates refused illegal-transition
WebSocket delegate + accrue-cost        accrual accepted, the next Slice refused cap-reached
mz mcp --zord inner  pane_spawn         a real /bin/sh forked, parent pid = the mz process
                     pane_read          "from-a-real-process\r\n", 21 bytes, status working
                     memory_write       attributed to inner
kill -INT; mz . again; memory_read      the Fact read back by a different Zord in the second process
                     first frame        running, "the bridge run", cap 500, spent 0
WebSocket pane-kill                     a grandchild that traps HUP and TERM gone from /proc
PATH without claude                     "Providers none on PATH / Not found claude, codex, gemini"
```

And in this process, over the real transports, five concurrency scenarios plus a control arm — the pair
`bin/mz.ts` calls real and ordinary, one `cockpitServer` and one `controlPlane` over one `missionWriter`.
Every one of them is judged by the same reading, which is the strongest thing I built this pass:

> **Re-decide every recorded Command against the state folded from the entries before it.** An accepted
> Decision that re-decides as refused is a lost update, whatever the gestures were. It reports `[]` on
> every scenario below, and it reports the defect when the queue is taken away (plant 1).

## Criterion by criterion

### 1. `mz .` starts the Cockpit and it is reachable in a browser with no further steps — **holds**

Evidence: `cockpit/cockpit.e2e.test.ts > criterion 1 — mz starts the Cockpit and it is reachable with no
further steps` spawns `bin/mz.ts` as a child, reads the URL out of its own banner, fetches the view and
lists the control plane's tools on the same port. `cockpit/server.test.ts > the view, over HTTP
(criterion 1)` covers the ephemeral port, `/index.html`, HEAD and 404 elsewhere.

`bin/mz.ts` was rewritten by this bugfix (+97/−?), so I re-ran the criterion myself three times on three
Workspaces that did not exist a second earlier: banner, 200 with 72435 bytes, 404 everywhere else, and the
control mount answering on the same port. The resolver `mz` installs for the `@engine/*` alias still
works, which only a child process can show.

Unproven: that a browser renders it. Nothing here can open one — see "What I could not check".

### 2. A Pane spawns a real process in under 2 seconds, streams live, and accepts keystrokes — **holds**

Evidence: `runtime/pane-manager.test.ts > a Pane is a real process, streamed` — `streams its first byte in
well under two seconds` measures the wall clock, `delivers a typed keystroke to the process, which says
what it heard`, `runs in the cwd it was given`, `streams a Pane that keeps writing, chunk after chunk`.
All 39 spawns in that file are real, with no double of the pty.

Confirmed on the running program: `pane_spawn` through the bridge, then `pane_read` returning what the
process wrote within a second, with `status: "working"`.

Worth knowing rather than unproven: nothing is buffered, so a client that connects after a Pane has
written sees only what arrives from then on. That is the process table's declared Gap 1.

### 3. Killing a Pane kills the child process, proven by the process no longer existing — **holds**

Evidence: `runtime/pane-manager.test.ts > the kill kills the whole tree` — four tests, including
`escalates to SIGKILL for a tree that ignores SIGTERM as well` and the one that makes the rest evidence:
`would not have, had it signalled only the leader — the falsification`.

Confirmed end to end this pass. A Pane opened through the control plane ran
`( trap '' HUP TERM; exec sleep 389 ) & echo LEADER $$; wait`; a `pane-kill` over the WebSocket answered
`pane-status: killed`, and afterwards neither the leader nor the grandchild was in `/proc` and `pgrep -x
sleep` counted zero. Reading `/proc` rather than `process.kill(pid, 0)` is what makes that true, and the
module gets it right.

### 4. Two Panes run at once with different CLIs and neither blocks the other — **holds**

Evidence: `runtime/pane-manager.test.ts > two Panes run at once and stay out of each other's way` — four
tests: two CLIs interleaving, each stream kept to its own Pane, a keystroke kept to the Pane it was typed
into, and the other Pane still streaming when one is killed. All real processes. I did not re-drive this
one; nothing in the bugfix touches `pane-manager.ts`, and its file is untouched since Task 3.

### 5. A Mission driven from a Briefing produces at least one real Delegation to a real process, and its Handoff is accepted or refused by the engine, with the Refusal visible — **holds**

Evidence: `cockpit/cockpit.e2e.test.ts > criterion 5 — one Briefing drives real processes to a Delivery`,
which this bugfix rewrote to take the writer. Nothing in the chain is a double: the Core delegates two
Slices, a real `bash` process reads its Delegation out of the text it was handed and submits its own
Handoff through `mz mcp`, is refused against its Contract with both violations, fixes what it claimed and
is accepted; a Gate is raised, halts the Mission, and is answered over a real WebSocket; the drive is
re-entered with a fresh store and delivers.

I re-checked the two halves this change could have broken. The drive now writes through the shared door,
so I ran a real `drive` of a two-Slice Combination while a human answered through the server's WebSocket
at the same moment: the Combination halted at its Cap, the human's `authorise-cap` was refused
`illegal-transition` (the Mission was running, not stopped at its Cap, which is the engine's rule and not
a race), a later `kill-mission` was accepted, and the next drive answered `killed`. Re-deciding the whole
file reported `[]`.

Unproven, declared rather than hidden: **nothing starts a drive from the Cockpit.** `bin/mz.ts` Gap 1 says
so and the program hands its runner `refusingArguments`, which throws by design. The criterion does not
ask for the gesture to come from the Cockpit, so it holds; the PRD's Outcome sentence is not reachable
today. See caveat 1.

### 6. A Gate halts the Mission in the Cockpit and a human answer there resumes it — **holds**

Evidence, three layers. `cockpit/view.test.ts > criterion 6, over the real server` drives a real store, a
real server on an ephemeral port and Node's own WebSocket: the Gate is offered with its own question, the
client's `answerFor` builds the Gate decision, the Mission is running again, the offer is gone, and a
second test asserts the resumption **on disk**. `cockpit/view/client.test.ts > criterion 6` adds seven,
among them `answers the Gate the halt names, not the first one on the record`.
`cockpit/cockpit.e2e.test.ts` answers the Gate of a real drive over a real socket.

What changed here is the half the first pass could not prove. `attach` — the delegated click listener —
was executed by no test, and severing the one line that sends a gesture left 1078 tests green. It is now
driven by the shim in `client.test.ts`, and my plant 7 turned **6 tests red**. So the wire from a click to
a Command is held by something that can fail.

What it still leaves unproven is a vendor's own `closest`, `dataset`, event delivery and markup parsing.
And one thing nobody has written down: a Cockpit **already open** is never told that a Gate was raised by
anybody but its own clients. The Gate does halt the Mission, and the Cockpit does offer it and resume it —
which is the criterion, and is how every proof of it connects — but a human watching while a Combination
runs learns nothing until they gesture or reload. Measured, and argued as caveat 2 rather than as a bug,
for the reasons there.

### 7. Reaching the Cap halts the Mission and no further work is commissioned until authorised — **holds** (it did not, last pass)

This is where I spent the pass. The first verdict failed it because the *composed* Cockpit — one server
and one control plane over one Mission file — commissioned a Slice against a Mission whose Cap a
concurrent accrual had already closed. Each writer held a queue around its own `load → submit → append`,
and nothing ordered the three.

`runtime/mission-writer.ts` is now the one door: `record(missionId, command)` is that atom as one queue per
Mission, `load` is unqueued, and the writer has no `append`, so the three writers cannot write an entry
they decided against a Replay they loaded themselves. `bin/mz.ts` builds one store and one writer and hands
that writer to the server, to every control plane and to any drive; `missionWriter` answers the same writer
for the same store.

I rebuilt the previous pass's scenario and four more. Every one is judged by re-deciding the whole file,
and every one reported `[]`:

```
one server + one control plane, one writer, Cap 100 cents
  human delegate ‖ agent_invoke costing the whole Cap
      open-mission:accepted | delegate:accepted | delegate:accepted | accrue-cost:accepted
      2 Delegations, spent 100 of 100, reached — and re-deciding says every one of those was right:
      the second Slice was commissioned before the accrual reached the queue, which is a legitimate
      order and not a lost update. The next Slice, asked over the same socket:
                                                    delegate:refused (cap-reached)

  two Zords' control planes, both accruing 60 of a Cap of 100, plus a human delegating
      … accrue-cost:accepted | delegate:accepted | accrue-cost:accepted     re-deciding: []

  six gestures at once, two sockets and three POSTs, runs costing 40 each
      open-mission | delegate | delegate | accrue | accrue | accrue | delegate:REFUSED cap-reached | accrue
      the Slice that arrived after the Cap was reached is refused, and every accrual is kept, which is
      the engine's own rule about money already gone

  a Cap of zero
      both Slices refused cap-reached, nothing delegated

  the counter-arm: two stores over one Workspace, same gestures, same file
      "#3 delegate: file says accepted, re-deciding says refused"   ← the defect, still there
```

That last line matters twice. It is the bound the fix states rather than a hole it left — two stores is
what two processes look like from inside one — and it is what proves my reading is not blind: the same
reading that reports `[]` through one door reports the lost update through two.

On the running program: two genuinely concurrent gestures over two WebSockets, an accrual reaching the Cap
and a second Slice, landed `accepted` then `refused cap-reached`, and a third Slice was refused too. The
file afterwards is a clean serial record: `open-mission accepted | open-mission refused | open-mission
refused | delegate accepted | accrue-cost accepted | delegate refused cap-reached | delegate refused
cap-reached`.

The delivery's own proof of the expensive half is at the `record` level
(`runtime/mission-writer.test.ts > refuses work commissioned past a Cap a concurrent accrual has just
reached`), and it says in the file why it is not asserted through transports: the two gestures would need a
known order that no transport can promise. My measurements agree with that reason — through the transports
the human's Slice wins the race every time on this host, because `agent_invoke` waits for a run before it
accrues — so the pair of arms is the honest shape. It is what plant 1 falsifies.

### 8. Closing the app and running `mz .` again restores the Mission from disk with its Replay intact — **holds**

Evidence: `runtime/mission-store.test.ts > closing the app and reopening it (criterion 8) > restores the
Mission from disk in a separate process, Replay intact`, which spawns `tsc` over the tree and then a plain
`node` reader that calls `load`, folds with `stateOf` and reads with `stepsOf`, `refusedIn` and `eventsIn`.

I ran the literal criterion: `mz .`, a Mission opened and a Fact written through the bridge, `kill -INT`,
`mz .` again on the same Workspace — a different process on a different port — and the first frame carried
`running`, the Briefing, the Cap and the Meter, read off the file. The Pane's process tree was gone after
the first program exited.

### 9. A Zord running inside a Pane can call `pane_spawn` and `handoff_submit` through the embedded control plane, and the Cockpit reacts — **holds**

Evidence: `runtime/mcp-server.test.ts > pane_spawn (criterion 9)` and the `handoff_submit` family;
`cockpit/cockpit.e2e.test.ts` has a real process submitting its own Handoff through `mz mcp`.

Re-driven live, through the bridge this bugfix touched: `mission_create` accepted,
`pane_spawn` forking a `/bin/sh` whose parent pid is the `mz` process (read off `ps`, not claimed),
`pane_read` answering what it wrote, `memory_write` attributed to `inner` and not to whoever forked it.
A malformed call — `pane_spawn` with no `paneId` — came back as `-32602` with the missing field named,
which is the closed schema doing what it is there to do.

"The Cockpit reacts" is read as the techspec's verification plan words it — "a client calls `pane_spawn`
and `handoff_submit` and both take effect" — and both do. The other reading, that the drawn Cockpit reacts,
is true of `pane_spawn` (a Pane's bytes and status are broadcast) and false of `handoff_submit`, which
sends no frame at all. That is caveat 2, and it is the reading I did not take.

### 10. A Fact written with `memory_write` in one session is read by `memory_read` in the next — **holds**

Evidence: `runtime/cortex-store.test.ts > a Fact written in one session, read in the next (criterion 10)`,
three tests, one of which spawns a separate process so the reader never saw the writer.

Done live across two runs of the program: written by `inner` through the bridge in the first, read by
`other` in the second, with `subjects` and `unreadable` beside it.

### 11. The provider list is discovered from `PATH`, proven by it changing when a CLI is removed — **holds**

Evidence: `runtime/providers.test.ts > criterion 11: the list is discovered from PATH`, four tests, one
removing the file and one moving the `PATH` while the file stays. It also proves the two things a naive
detector gets wrong: a folder carrying the execute bit is not a program.

Proven live on the same program, which is the criterion's own words: with `claude` on the `PATH`,
`Providers claude (/opt/node22/bin/claude)`; with a `PATH` holding `node` and not `claude`,
`Providers none on PATH / Not found claude, codex, gemini`.

### 12. `npm test` stays green and `engine/` still has zero dependencies — **holds on substance, with the same deviation the first pass stated**

`npm test` is green at 1124, `tsc --noEmit --incremental false` is clean, `npm run build` is green.
`engine/mission.e2e.test.ts > imports nothing but itself` passes. This bugfix touched no file under
`engine/`: the change is `runtime/mission-writer.ts` (new), `cockpit/server.ts`, `runtime/mcp-server.ts`,
`runtime/combination-driver.ts`, `bin/mz.ts`, `cockpit/view/client.ts`, one doc comment in
`runtime/mission-store.ts`, and tests.

The deviation is inherited and unchanged: commit `7904a49` (Task 8) changed `engine/domain/replay.ts` and
its test, hardening `added()`, which dereferenced `event.harness.cli` off a fact nothing had checked. It
added no dependency and no import, so the measurable half of the criterion is untouched, and I read the
criterion as holding. `tasks.md` Task 8 still lists only `runtime/combination-driver.ts` under "Touches",
so the change is invisible there.

## The plants, and what each one turned red

Thirteen, each made in the real tree, run, reverted, and the revert checked with `diff` against a copy
taken before anything was touched. Six of them are on code that had never been through QA — the writer, the
six hardened readings, and the shim itself. `git status --porcelain` is empty and every file matches its
pristine copy.

| # | what I broke | what went red |
| --- | --- | --- |
| 1 | `missionWriter.record` runs with no queue at all | **5**: two in `mission-writer.test.ts`, two in `cockpit.e2e.test.ts`, and my own re-deciding reading, which reported `#6 delegate: file says accepted, re-deciding says refused`. The two "two doors" control arms stayed green, as they must |
| 2 | `missionWriter` builds a new writer on every ask, so a second queue can be made by asking twice | 1: `answers the same writer for the same store`. Nothing else — the memo is proven by identity alone, which is enough, because identity is what makes one queue |
| 3 | `load` put inside the queue | **3**, two of them by timing out at 30s: a drive polling for a Handoff behind a write is the deadlock the module's design argues about. "Reading stays free" is load-bearing, not a preference |
| 4 | `haltingGate` dereferences the Halt again — BUG-2 itself | 3, including `draws a Mission whose Halt was lost, instead of throwing in the socket listener — BUG-2` |
| 5 | `renderMission` counts `state.delegations.length` raw | 1: `draws a Mission whose delegation list was lost, instead of counting it` |
| 6 | the Kill control carries its PaneId as `data-value-paneId` again — the third defect | 3, one of them the shim's own click test. The fidelity that found the defect is what keeps it found |
| 7 | `attach` never sends the gesture a click means — the first pass's green plant | **6**. It was 0 before the bugfix |
| 8 | the drive carries on past a Refusal of its own `open-mission` — the first pass's other green plant | 1, `stops on it, rather than commissioning work into a Mission it did not open`. It was 0 before |
| 9 | the shim's parser silently drops every `<input>` | 6, and the **count guard fired first**: `the parser sees every control the markup carries`. A shim that quietly read an empty tree cannot happen |
| 10 | `haltingGate` dereferences a Gate list's elements | 1: `offers no Gate when the list holds something that is not one` |
| 11 | `delegationFor` dereferences a Delegation list's elements | 1: `attributes nothing to a Pane when the Delegation list holds something that is not one` |
| 12 | `renderEntry` dereferences `entry.decision.kind` | 1: `draws an entry whose Decision was lost, and says that is what is missing` |
| 13 | `stoppedAtCap` dereferences the Halt | 3, including `does not read a lost Halt as a Cap, because that is a different fact and a different remedy` |

No plant stayed green. Plants 4, 5, 10, 11, 12 and 13 are the six readings the bugfix hardened, one each:
every one of them is held by a test that fails when it is undone, which is what makes "swept the file" a
measurement rather than a claim.

## The shim, checked on its own terms

A hand-written double is exactly what this repository warns can make tests pass because of it. Its three
claims check out, and I looked for the fourth thing — where being permissive would hide a defect.

- **It carries no verdict of its own.** It parses, it delivers an event to the listeners `attach` really
  registered, and it records what was sent. Every assertion about meaning compares against the module's own
  `answerFor`, `keystrokesOf` and `ACTIONS`, so a frame spelled out by hand cannot agree with a severed
  wire. Plant 7 is the proof: six of those tests fail when the wire goes.
- **The markup is the view's.** The tree is parsed from what `renderCockpit` actually drew, everywhere but one test,
  which says at the point of use that it writes markup no renderer can emit — the case for an unknown
  control, which by construction cannot come from a renderer.
- **The count guard is load-bearing**, and plant 9 is what says so: it fires before any other test in the
  file. It counts the raw string's `data-action`, `data-value` and `data-pane` against the parsed tree,
  with a floor on the first.
- **It is strict where a browser is strict and refuses to be lenient where it cannot be sure.** `matches`
  **throws** on a selector it does not implement rather than answering "no match", which is the right
  direction: a renamed selector fails loudly instead of passing quietly. Attribute names are lowercased,
  which is the fidelity that found the third defect. `closest` starts at the element itself and
  `querySelector` does not, as a browser has it. An unparseable tag becomes text, which the count guard
  then catches.

Where it is unfaithful, and none of it can hide the class of defect it exists to catch: `scrollHeight`
answers 0, so a scroll that does not follow what was drawn cannot be seen here; `innerHTML` has no getter, which is
deliberate (a serialiser would be a rule of the shim's own); and `decodeEntities` is the exact inverse of
`escapeHtml`, so a character `escapeHtml` fails to escape would be invisible to the shim as well — that one
is worth knowing, and the escaping itself has its own tests.

The floor on the count guard is on `data-action` only, so a rendering that emitted no `data-value` box at
all would satisfy `0 === 0`. It cannot happen silently for the fixtures in the file, because `boxFor`
throws when a box is missing, and plant 6 shows it. Worth a second floor if anyone touches it.

## Caveats — true, worth knowing, not bugs

1. **`mz .` cannot start a Mission.** The view offers four gestures — approve a Gate, ask for a revision,
   authorise a Cap, end a Pane — and none opens a Mission or delegates. So a human on a fresh Workspace is
   told "no Mission has been opened in this Workspace yet" and has nothing to do about it; a Combination is
   driven by a caller that composes `startCockpit` with `drive`. Declared as `bin/mz.ts` Gap 1, unchanged
   by this bugfix, and still the distance between the twelve criteria and the PRD's Outcome sentence.
2. **A Cockpit already open is never told that the Mission moved, unless it moved it.** Measured this pass
   and declared nowhere, which is why I am putting it first among the findings. A `mission` frame is sent
   on connect and after a `submit` this server carried; a write through a control plane or a drive sends
   nothing, and the client has no reconnect and no poll. So with a Zord working through `mz mcp`, a human
   watches Panes stream live while the Mission bar, the Meter and the record stay at the values they had
   when the browser connected:

   ```
   on connect                                  ["mission"]
   after a Zord accrued the whole Cap           []
   after a Gate was raised through the writer    []
   what the view still shows                    running, spent 0 of 100, reached: false
   (on disk: halted at its Cap, and a Gate open)
   ```

   It is not a criterion. Criterion 9's own verification plan says "both take effect", which they do;
   criterion 6 asks that a Gate halt the Mission in the Cockpit and that an answer there resume it, and
   every proof of it — including the one I re-drove — connects and is offered the Gate. Nor is it new: no
   frame was ever sent for a write this server did not carry. What makes it worth a war-room minute rather
   than a shrug is that the view shows a state that is untrue while showing live bytes beside it, which is
   the "believed because it under-reports" shape this repository keeps choosing against. The additive fix
   is small and it is not a rule change: the writer can announce what it recorded and the server can
   broadcast the reading. **My recommendation: declare it where `cockpit/server.ts` declares its Gaps, and
   schedule it with Task 10 — the same three-Gaps-one-remedy argument applies, because both are about what
   a human actually sees.**
3. **The techspec and ADR 0011 still describe `xterm.js` as the thing drawing a Pane, and it is not
   installed.** Task 10 item 1 owns it. A Zord CLI that paints a whole Pane rather than printing lines
   draws over the scrollback: no alternate buffer, no scroll region, no insert or delete line, one column
   per code point. Declared at the foot of `cockpit/view/client.ts`, and two documents state a mechanism
   that does not exist.
4. **The Meter is real and always says zero.** The pty runner answers `ZERO_MONEY` meaning "no price source
   exists", which PRD risk 3 asks for. So the Cap cannot be reached by anything `mz .` runs today: every
   Cap I reached this pass was reached by a runner I wrote, or by an accrual submitted as a Command.
5. **`mz .` prints two warnings to stderr on every start** — the experimental type stripper (declared in
   `cockpit/view.ts`) and `MODULE_TYPELESS_PACKAGE_JSON`, which is Node saying it reparsed `bin/mz.ts`.
   Both are the first thing a human sees under a banner that otherwise reads cleanly.
6. **The Cockpit has no authentication.** Anything that can reach the port can type into a live process and
   POST to the control plane, which forks. Loopback and the `Origin` refusal are the whole of what stands
   there. Declared twice.
7. **Nothing checks that the entries of `<id>.jsonl` are about the Mission that names the file.** Three
   layers declare it — the store, the server's Gap 3, and Task 9's finding about `evolve` — and it is
   correctly left to whoever changes the rule.
8. **One run in four to one in ten is red, and both names I caught are already recorded.** Twelve full runs:
   nine green at 1124. One failed on `runtime/pty-agent-runner.test.ts > collects all of it, losing nothing
   to the pty buffer`, which `CLAUDE.md` records as a pty discarding its tail when a child exits on top of a
   burst. One failed on `runtime/pane-manager.test.ts > resolves only once the tree is gone, grandchild that
   ignores SIGHUP included`, which `CLAUDE.md` records as intermittent under load. A third run had two
   failures whose names I did not capture and could not reproduce in nine further attempts, including two
   full suites run in parallel to double the load — both of those were green. Neither named failure belongs
   to this change, and a suite that is red one run in ten stops being read, which costs more than the flake.
9. **A per-gesture failure has no home in the envelope**, so a `pane-kill` that cannot be carried out ends
   the connection with a 1011 rather than reporting on it. Declared.
10. **A doc comment lost its leading `*`.** `runtime/mcp-server.ts:211` now reads ` 4. **Two *stores* over
    one Workspace…` inside the module's block comment. Cosmetic, introduced by this change, and one
    character to fix.
11. **`MissionWriter.record` rejects with a `TypeError` if a caller hands it something that is not a
    Command**, although its own doc says it rejects only for the reasons the store rejects. No Surface can
    do it: `cockpit/protocol.ts` checks the skeleton of a `submit`'s Command before the server ever sees it,
    and the control plane and the drive build their own. It is the same standard as `MissionWriterOptions`
    not being read as `unknown` — a caller's own bug, loud, in the caller's own code — and the sentence is
    slightly wider than the truth.
12. **Two stores over one Workspace in one process is silent.** `missionWriter` memoises per store, so
    nobody can make a second queue by asking twice, and `RunningCockpit.writer` hands the door to whoever
    composes a drive. But two `missionStore({workspace})` calls produce two doors with no warning of any
    kind — I checked: no `console.warn`, no `console.error`, two different writers. That is the declared
    bound and the e2e keeps it as a control arm; it is worth knowing that nothing detects it.

## The open item, and what it means

**Task 10 is `todo` and no criterion depends on it.** Its three items are `@xterm/xterm` in place of the
hand-written emulator, a real DOM, and the Kill answer in the view. Item 2 was closed by this bugfix and
`tasks.md` records it with the excuse disproved. Of the other two: item 1 is fidelity, which criterion 2
does not ask for — the criterion is that a Pane streams what a process writes, and it does; item 3 is a
gesture the PRD's Scope lists among three human answers but which no criterion names. Neither is covered by
the PRD's out-of-scope list, so this is not "out of scope" — it is scheduled work with no criterion behind
it.

So: **the twelve criteria are met and one task is open.** `CLAUDE.md` says nothing is shipped with a known
open item, and that rule is what makes the answer a war-room decision rather than mine: the honest statement
is that this passes its own contract and does not yet do two things its authors wrote down and scheduled.
I would put caveat 2 next to Task 10 when that is decided, because both are about what a human watching
the Cockpit actually sees, and one remedy each.

## What I could not check

1. **A browser.** No DOM implementation and no browser binary is installed and `package.json` is outside
   what I may touch. "Reachable in a browser" is proven as far as the bytes a browser receives, and the
   behaviour of those bytes is proven under the shim checked above. That is much better than the first
   pass had, and it is not a browser: layout, the stylesheet, markup parsing and event delivery are all the
   shim's rather than a vendor's.
2. **A real Zord CLI.** `claude` is on this host's `PATH`, and there is no network and no account, so every
   Delegation I drove ran `bash` or `sh` standing in for a Zord. PRD risk 1 is open and only a real run
   closes it: a CLI that asks an interactive question, paints over a whole Pane, or answers prose where a
   Handoff was asked for.
3. **The `win32` platform.** The `PATH` and `PATHEXT` string rules are proven as pure functions on this
   host; the file-system half is not, and `providers.ts` declares it.
4. **Durability against power loss.** `append` fsyncs the file and then the folder that holds it, which I
   read but cannot test.
5. **Two processes over one Workspace.** Out of every writer's declared scope, and I did not try to break
   it. What I did measure is the same shape inside one process — two stores, caveat 12 — which is the bound
   the fix states.
6. **Whether the two unnamed failures of the red run are the two intermittents already recorded.** I could
   not reproduce them, so I cannot say more than caveat 8 says.
