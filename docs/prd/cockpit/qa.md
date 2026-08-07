# QA — Cockpit

**Verdict: reproved.** Eleven of the twelve acceptance criteria hold; criterion 7 does not, because the
composed Cockpit commissions work past a Cap that a concurrent accrual had already closed. Two bugs are
open — see `bugs.md`.

I wrote none of this code. Everything below was run, and where I doubted the evidence I ran the criterion
myself against real processes, real files and the real served document.

## What I ran

Baseline, verified rather than taken on trust:

```
npx vitest run              28 files, 1078 tests, all passing, 16.6s
npx tsc --noEmit --incremental false   clean, exit 0
npm run build               green (18 static routes)
```

Beyond the suite, on this host:

```
node bin/mz.ts <workspace>          started, printed its banner, served the view
curl <url>                          200, 66294 bytes, text/html, <title>Cockpit — Megazord Terminal</title>
curl <url>/nope                     404
POST /mcp/scout tools/list          the eight tools, in the order the PRD names them
POST /mcp/scout pane_spawn          a real process, read back with pane_read
WebSocket pane-write                keystrokes reached /bin/cat, which echoed them
WebSocket pane-kill                 /proc emptied, grandchild included
POST /mcp/scout mission_create      one line in .megazord/missions/mission-1.jsonl
POST /mcp/scout memory_write        one line in .megazord/cortex.jsonl
kill -INT; node bin/mz.ts again     the Mission and the Fact both read back in the second process
```

And one thing the suite cannot do: I executed the served document's own bootstrap and its `attach` under a
hand-written shim of the four browser objects it touches, so the click that answers a Gate and the keypress
that reaches a Pane were driven through the listeners the served bytes really register.

## Criterion by criterion

### 1. `mz .` starts the Cockpit and it is reachable in a browser with no further steps — **holds**

Evidence: `cockpit/cockpit.e2e.test.ts > criterion 1 — mz starts the Cockpit and it is reachable with no
further steps` spawns `bin/mz.ts` as a child exactly as a human runs it, reads the URL out of the banner,
fetches the view from it and lists the control plane's tools on the same port. `cockpit/server.test.ts > the
view, over HTTP (criterion 1)` covers the ephemeral port, `/index.html`, HEAD, and 404 everywhere else.

The evidence holds and it is not adjacent: the child is the program, not `startCockpit`, so the resolver
`mz` installs for the `@engine/*` alias is exercised — Vitest resolves that alias itself and would
otherwise hide the question. My own run agrees, first try, on a Workspace that did not exist a second
earlier. Plant 5 confirms the check can fail.

Unproven: that a browser renders it. Nothing in this repository can open one — see "What I could not
check".

### 2. A Pane spawns a real process in under 2 seconds, streams live, and accepts keystrokes — **holds**

Evidence: `runtime/pane-manager.test.ts > a Pane is a real process, streamed` — `streams its first byte in
well under two seconds` measures the wall clock and asserts under 2000ms with the elapsed time in the
failure message; `delivers a typed keystroke to the process, which says what it heard`; `runs in the cwd it
was given, not in this process's`; `streams a Pane that keeps writing, chunk after chunk`. All 39 of that
file's spawns are real, with no double of the pty anywhere.

I drove both halves myself through the Cockpit's own envelope rather than through the process table's
`interface`: a `pane-write` of `typed-by-a-human\r` into a `/bin/cat` Pane came back twice — once from the
pty's echo, once from `cat` — and Ctrl+C typed into a Pane's element produced
`{"kind":"pane-write","keystrokes":""}` on the socket, through the real keydown listener.

Worth knowing rather than unproven: nothing is buffered, so a client that connects after a Pane has written
sees only what arrives from then on. That is the process table's declared Gap 1 and I measured it — my
second WebSocket saw `sh-line-4` and none of the four before it.

### 3. Killing a Pane kills the child process, proven by the process no longer existing — **holds**

Evidence: `runtime/pane-manager.test.ts > the kill kills the whole tree` — `resolves only once the tree is
gone, grandchild that ignores SIGHUP included`, `escalates to SIGKILL for a tree that ignores SIGTERM as
well`, `buries a grandchild whose leader already exited on its own`, and the one that makes the rest
evidence: `would not have, had it signalled only the leader — the falsification`.

This is the strongest-proven criterion in the delivery and I confirmed it end to end rather than at the
process table: a Pane spawned through the control plane whose grandchild ran `trap '' HUP TERM; exec sleep
411`, ended by a `pane-kill` over the WebSocket. Afterwards `/proc/<leader>` and `/proc/<grandchild>` were
both gone and `ps` listed neither. Reading `/proc` and not `process.kill(pid, 0)` matters and the delivery
gets it right — a zombie still answers `kill -0`.

Plant 1 is the important one: making the module reach the leader alone rather than its process group turned
three kill tests red, plus the file's own cleanliness check.

### 4. Two Panes run at once with different CLIs and neither blocks the other — **holds**

Evidence: `runtime/pane-manager.test.ts > two Panes run at once and stay out of each other's way` — `runs
two different CLIs at the same time, interleaving, neither blocked`, `keeps each stream to its own Pane`,
`keeps a keystroke to the Pane it was typed into`, `leaves the other Pane streaming when one is killed`.

Confirmed myself with `/bin/cat` and `/bin/sh` live at the same moment, both streaming onto one socket,
each stream attributed to its own PaneId, and a `pane-write` reaching only the Pane it named.

### 5. A Mission driven from a Briefing produces at least one real Delegation to a real process, and its Handoff is accepted or refused by the engine, with the Refusal visible — **holds**

Evidence: `cockpit/cockpit.e2e.test.ts > criterion 5 — one Briefing drives real processes to a Delivery`.
Nothing in the chain is a double: the Core delegates two Slices, a real `bash` process reads its Delegation
out of the text it was handed, submits its own Handoff through `mz mcp` over the control plane, is refused
against its Contract with **both** violations, reads them, fixes what it claimed and is accepted. A Gate is
raised, halts the Mission, and is answered over a real WebSocket. The drive is then re-entered with a fresh
store and delivers. The whole record is read back through a store nothing above ever held.

The evidence proves the criterion and more than it: the resolved Harness on each `Delegated` fact is
asserted (`cli` `bash` twice, Effort `medium` then `low`), so what the Replay says a process ran with is
what it ran with. The Refusal being visible is covered twice over — `refusedIn` finds it on disk, and
`cockpit/view/client.test.ts > a Refusal is rendered, with its reason and every violation` draws its reason
and every line of its list, pinned against `refusedIn(stepsOf(replay))` so the two readings agree.

I saw a Refusal travel the whole way myself while checking criterion 9: a Zord inside a Pane submitted a
Handoff for a Delegation nobody made, the engine's Refusal came back to that Zord with its violation, and
the refused Step was on disk.

What this leaves unproven, and it is declared rather than hidden: **nothing starts a drive from the
Cockpit.** `bin/mz.ts` Gap 1 says so, and the program hands its runner `refusingArguments`, which throws by
design — so `mz .` on its own can neither open a Mission from a Briefing nor invoke a Zord. Criterion 5 is
proven through `startCockpit` composed by the end-to-end test with an argument mapping and a Combination of
its own. The criterion does not ask for the gesture to come from the Cockpit, so it holds; the PRD's Outcome
sentence — a person gives one Briefing and watches a Combination deliver — is not reachable today. See the
caveats.

### 6. A Gate halts the Mission in the Cockpit and a human answer there resumes it — **holds**

Evidence, three layers of it. `cockpit/view.test.ts > criterion 6, over the real server` drives a real
store on a real Workspace, a real server on an ephemeral port and Node's own WebSocket: the Cockpit is
offered the Gate with the Gate's own question, the client's `answerFor` builds the Gate decision, it goes out,
the Mission is running again, the offer is gone, and a second test asserts the resumption **on disk** so it
is resumed and not merely redrawn. `cockpit/view/client.test.ts > criterion 6` adds seven, among them
`answers the Gate the halt names, not the first one on the record` — which exists because a plant in Task 6
found a fixture with one Gate could not tell those two rules apart. `cockpit/cockpit.e2e.test.ts` answers
the Gate of a real drive over a real socket.

I checked the one join none of that covers. `attach` — the delegated click listener — is executed by no
test, so I executed the served bytes myself. The bootstrap runs, registers `click` and `keydown` on the
root and `message` on the socket; a `mission` frame naming an open Gate redraws the bar with the Gate's
question and the Briefing; and a click on Approve put exactly this on the socket:

```
{"kind":"submit","command":{"kind":"decide-gate","occurredAt":"…","gateId":"g1","decision":{"kind":"approved"}}}
```

So the criterion holds in fact. What it leaves unproven is that it will keep holding: plant 7 removed the
one line that sends the gesture and all 1078 tests stayed green. That is Task 10 item 2, declared and open.

### 7. Reaching the Cap halts the Mission and no further work is commissioned until authorised — **does not hold**

For a single writer the evidence is strong and real. `cockpit/view.test.ts > criterion 7, over the real
server > halts at the Cap, refuses work, and commissions again once authorised` accrues past a Cap of R$
10,00, sees the Cockpit offer the Authorisation with what was spent, submits a second Delegation and reads
back `cap-reached`, authorises R$ 30,00 through the client's own gesture, and only then is the Delegation
accepted. `cockpit/view/client.test.ts > criterion 7` adds seven more, including an Authorisation at or
below what was already spent being refused.

It does not hold for the Cockpit that `startCockpit` actually composes. The server holds one queue over
`load → submit → append`, each control plane holds its own, and nothing orders the three across one Mission
file. I built the pair `bin/mz.ts` itself calls "real and ordinary" — one `cockpitServer` and one
`controlPlane` over one `missionStore` — and ran two gestures at the same moment: a human commissioning a
second Slice through the WebSocket, and a Zord's run reporting a cost equal to the whole Cap through
`agent_invoke`.

```
concurrent   open-mission:accepted | delegate:accepted | delegate:accepted | accrue-cost:accepted
             2 Delegations, spent 100 of a Cap of 100, reached: true, 0 Refusals

ordered      open-mission:accepted | delegate:accepted | accrue-cost:accepted | delegate:refused
             1 Delegation, the second refused cap-reached
```

Same store, same gestures, same engine. The only difference is how many queues sit in front of the file, and
the difference is a Slice commissioned on a Mission whose Cap was reached — the one promise this product
makes about money. That is BUG-1, and it is Task 11, which `tasks.md` marks `todo` and labels a correctness
hole in its own words.

The criterion says "no further work is commissioned". Work is commissioned. It fails.

### 8. Closing the app and running `mz .` again restores the Mission from disk with its Replay intact — **holds**

Evidence: `runtime/mission-store.test.ts > closing the app and reopening it (criterion 8) > restores the
Mission from disk in a separate process, Replay intact`, which does the hard version — spawns `tsc` over the
tree and then a plain `node` reader that calls `load`, folds with `stateOf` and reads with `stepsOf`,
`refusedIn` and `eventsIn`, so the loaded value is proven to still be a Replay rather than equal bytes.
`cockpit/cockpit.e2e.test.ts` closes a Cockpit and reopens one on the same Workspace at the end of the
criterion 5 run.

I ran the literal criterion: `mz .`, a Mission opened through the control plane, `kill -INT`, `mz .` again —
a different process on a different port — and the first WebSocket frame carried `status: "running"`, the
Briefing, the Cap and the Meter, read off the file. Plant 2 turned 13 tests red.

Worth knowing: the file is deliberately not re-validated on load (ADR 0009), which is right, and BUG-2 is
what the layer above does with the damage that lets through.

### 9. A Zord running inside a Pane can call `pane_spawn` and `handoff_submit` through the embedded control plane, and the Cockpit reacts — **holds**

Evidence: `runtime/mcp-server.test.ts > pane_spawn (criterion 9) > forks a real process, in the Workspace,
and the Cockpit can see it`, and the `handoff_submit` family beside it. `cockpit/cockpit.e2e.test.ts` has a
real process submitting its own Handoff through `mz mcp`.

The word in the criterion is *inside a Pane*, and no test puts the caller there, so I did. A Pane running a
`bash` script piped three frames into `node bin/mz.ts mcp --zord inner`:

- `pane_spawn` — the Cockpit forked a second Pane whose parent process is the Cockpit itself, and which the
  Cockpit could then `pane_read`. Not a claim: I read the parent pid off `ps`.
- `handoff_submit` — answered with the engine's Refusal, verbatim, violation included, and the refused Step
  was appended to `mission-1.jsonl`.
- `memory_write` — attributed to `inner`, the Zord the mount routes by, and not to whoever forked it.

Plant 6 — a `pane_spawn` that answers success without forking — turned 7 tests red.

### 10. A Fact written with `memory_write` in one session is read by `memory_read` in the next — **holds**

Evidence: `runtime/cortex-store.test.ts > a Fact written in one session, read in the next (criterion 10)`,
three tests, one of which spawns a separate process so the reader never saw the writer.

I did it across two runs of the program: written through a live Cockpit, the Cockpit ended, and read back
through a second Cockpit's control plane under a different ZordId. Plant 4 — a per-process Cortex file —
turned 24 tests red.

### 11. The provider list is discovered from `PATH`, proven by it changing when a CLI is removed — **holds**

Evidence: `runtime/providers.test.ts > criterion 11: the list is discovered from PATH`, four tests, one of
which removes the file and one of which moves the `PATH` while leaving the file on disk. The file also
proves the two things a naive detector gets wrong: a folder carrying the execute bit is not a program, and
`access(X_OK)` alone reports one as installed.

`cockpit/cockpit.e2e.test.ts > discovers its providers from the PATH it was started with` proves the program
is wired to the lookup rather than to a list of its own. My own run reported `claude
(/opt/node22/bin/claude)` and `Not found  codex, gemini` — the truth on this host. Plant 3 — every Catalog
entry reported present — turned 12 tests red.

### 12. `npm test` stays green and `engine/` still has zero dependencies — **holds on substance, with a deviation stated below**

`npm test` is green at 1078, `tsc --noEmit --incremental false` is clean, `npm run build` is green.
`engine/mission.e2e.test.ts > imports nothing but itself, so there is no CLI to install and nothing to reach`
passes, and I checked the tree directly: no non-test file under `engine/` carries a specifier that is not
relative.

The deviation, because the criterion's own words are "nothing in this PRD may be added inside `engine/`":
commit `7904a49` (Task 8) changed `engine/domain/replay.ts` and its test, +204/-21. It added no dependency
and no import — it hardened `added()`, which dereferenced `event.harness.cli` off a fact nothing validated,
a real defect the driver found and could not fix from its own scope. `CLAUDE.md` records the reasoning at
length. The measurable half of the criterion is untouched by it, so I read the criterion as holding, but
`tasks.md` Task 8 lists only `runtime/combination-driver.ts` under "Touches" and the change is invisible
there.

## The plants, and what each one turned red

Each was made in the real tree, run, reverted, and the revert checked with `diff` against a copy taken
before anything was touched. `git status --porcelain` is empty and every file matches its pristine copy.

| # | criterion | what I broke | what went red |
| --- | --- | --- | --- |
| 1 | 3 | the process table sends `SIGTERM` to the leader only, not to the group | 4: the two kill tests, the leader-only falsification, and the file's own holdout check |
| 2 | 8 | `load` drops the last Step of the file | 13, criterion 8's own two among them |
| 3 | 11 | every Catalog entry reported present whatever the `PATH` holds | 12, all four of criterion 11's |
| 4 | 10 | the Cortex file named per process, so a Fact cannot cross a session | 24, all three of criterion 10's |
| 5 | 1 | the view served at `/cockpit` instead of `/` | 4, including the end-to-end criterion 1 |
| 6 | 9 | `pane_spawn` answers success and forks nothing | 7, criterion 9's own among them |
| 7 | 6, 7 | `attach` never sends the gesture a click means | **nothing. 1078/1078 still green, `tsc` clean** |
| 8 | 1, 5 | the server appends only accepted Steps, the bug the control plane once caught | 3 |
| 9 | 5 | the driver carries on past a Refusal of its own `open-mission` | **nothing. 41/41 still green** |

Plants 7 and 9 are the valuable ones.

Plant 7 measures Task 10 item 2 exactly: the whole click-to-gesture path can be severed without a single
test noticing. The path is correct today — I drove it — so this is a hole in the proof, not in the code.

Plant 9 found something nobody wrote down. `runtime/combination-driver.ts` has three exits on a Refusal of
a Command the driver itself submitted, and the module doc says the rule is "proven by plant". Two of them
are: `delegate` refused `missing-capability` and `accrue-cost` refused on a killed Mission each have a test
that asserts the drive stops and the refused Step is on the record once. The third — a refused
`open-mission` — has none, and removing it changes nothing that runs. I checked how reachable it is: the
engine accepts `open-mission` even with a Core forced past the compiler to `{}` (the capability is read at
the Delegation, not at the opening), so the live route into it is a second writer opening the Mission
between this drive's `load` and its `submit` — which is BUG-1's own shape. Without the exit the drive asks
the same question forever. The guard is right; nothing would tell you if it stopped being.

## Caveats — true, worth knowing, not bugs

1. **`mz .` cannot start a Mission.** The view offers four gestures — approve a Gate, ask for a revision,
   authorise a Cap, end a Pane — and none of them opens a Mission or delegates. `mission_create` exists only
   for a Zord, and the program hands its runner `refusingArguments`, which throws by design rather than
   guess a CLI's flags. So a human running `mz .` on a fresh Workspace is told "no Mission has been opened
   in this Workspace yet" and has nothing to do about it. Declared as `bin/mz.ts` Gap 1 and argued well; it
   is the distance between the twelve criteria and the PRD's Outcome sentence, and it is the thing I would
   put in front of the war-room first.
2. **The techspec and ADR 0011 describe `xterm.js` as the thing drawing a Pane, and it is not installed.**
   The techspec's Approach says "`xterm.js` draws each Pane"; ADR 0011's Consequences say it "reaches the
   browser through the served document". Neither is true today — `package.json` holds `next`, `node-pty`,
   `react` and `react-dom` — and the hand-written emulator's limits are written out honestly at the foot of
   `cockpit/view/client.ts`. Task 10 item 1 owns it. Two documents state a mechanism that does not exist,
   which is the kind of prose that outlives the reason for it.
3. **A Zord CLI that paints the whole Pane rather than printing lines draws over the scrollback.** No alternate buffer, no
   scroll region, no insert or delete line, one column per code point. Declared, and it is the reason Task
   10 exists.
4. **The Meter is real and always says zero.** The pty runner answers `ZERO_MONEY` meaning "no price source
   exists", the end-to-end run asserts three accruals of zero, and PRD risk 3 asks for exactly that rather
   than an estimate. Honest, and it means the Cap cannot be reached by anything `mz .` runs today.
5. **`mz .` prints two warnings to stderr on every start.** One is the experimental type stripper, declared
   in `cockpit/view.ts` cost 1. The other is `MODULE_TYPELESS_PACKAGE_JSON`, which appears nowhere in this
   repository's prose: Node reparses `bin/mz.ts` as a module and says the reparse costs performance. It is
   the first thing a human sees under a banner that otherwise reads cleanly.
6. **The Cockpit has no authentication and its own documents say so twice.** Anything that can reach the
   port can type into a live process and POST to the control plane, which forks. Loopback and the `Origin`
   refusal are the whole of what stands there. I confirmed the `Origin` refusal (403) and the media
   `type` refusal (415) against a running Cockpit. Declared in `cockpit/server.ts` and inherited by
   `bin/mz.ts`.
7. **Nothing checks that the Steps of `<id>.jsonl` are about the Mission that names the file**, so a server
   opened on one Mission will record a Command that names another into that file. The store's declared Gap,
   the server's declared Gap 3, and a finding about `evolve` — three layers naming one hole, correctly left
   to whoever changes the rule.
8. **One control plane per Zord is built on first contact and never let go**, each with its own stored copy
   of every Pane's bytes. N Zords in one run means N of them. Declared as `bin/mz.ts` Gap 6.
9. **One run in ten was red, and I could not name it.** Ten full runs of the suite: nine green at 1078, and
   one that reported three failures in one file, which I failed to capture before it scrolled and could not
   reproduce in nine further attempts. `CLAUDE.md` already records a pre-existing intermittent failure of
   this shape — `runtime/pty-agent-runner.test.ts > collects all of it, losing nothing to the pty buffer`,
   a pty discarding its tail when a child exits on top of a burst — and this repository's wall-clock work
   is where I would look first. It is not a defect of this delivery and it is not nothing: a suite that is
   red one run in ten stops being read, which costs more than the flake.
10. **A per-gesture failure has no home in the envelope**, so a `pane-kill` that cannot be carried out ends
   the connection with a 1011 rather than reporting on it. Declared; the additive fix changes a contract the
   techspec pins.

## What I could not check

1. **A browser.** No DOM implementation and no browser binary is installed — I checked `node_modules` and
   `node_modules/.bin` — and `package.json` is outside what I may touch. So "reachable in a browser" is
   proven as far as the bytes a browser receives, and the behaviour of those bytes is proven under a shim I
   wrote for the four objects `attach` touches (a root element, `document`, `location`, `WebSocket`). That
   is better than nothing and it is not a browser: layout, the stylesheet, `innerHTML` parsing and event
   the way an event reaches a listener are all mine rather than a vendor's.
2. **A real Zord CLI.** `claude` is on this host's `PATH` and there is no network and no account, so every
   Delegation I drove ran `bash` standing in for a Zord. PRD risk 1 is the open one here and only a real run
   closes it: a CLI that asks an interactive question, paints over the whole Pane, or answers prose
   where a Handoff was asked for.
3. **The `win32` platform.** The `PATH` and `PATHEXT` string rules are proven as pure functions on this host; the
   file-system half is not, and `providers.ts` declares it.
4. **Durability against power loss.** `append` fsyncs the file and then the folder that holds it, which I
   read but cannot test — it relies on the platform honouring fsync.
5. **Two Cockpits on one Workspace.** Out of every writer's declared scope ("one Cockpit per Workspace is
   the assumption `mz` meets by construction") and I did not try to break it. BUG-1 is the same family
   inside one process, and it is enough to be getting on with.
