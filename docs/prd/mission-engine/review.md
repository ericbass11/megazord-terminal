# Review — Mission Engine

Final review of `docs/prd/mission-engine/`, before any `PR`. QA asked "does it do what was asked?" and
answered yes over three rounds. This asks the other question: **should it have been done this way?**

- **Verdict**: **approved.** Three defects were found and **corrected in this same context**, with each fix
  falsified at its source; five decisions are left for a human, and every one of them is named below.
- **Date**: 2026-08-06
- **Tree reviewed**: `79239b9` (QA round 3). Corrections applied on top of it, working tree verified clean
  before each falsification and after each restore.
- **Not re-run**: QA's proofs. Every number below that repeats one of QA's was re-derived here only where a
  correction could have moved it.

| Item | Verdict |
| --- | --- |
| 1 — Rule adherence | **approved** |
| 2 — Domain integrity | **approved after correction** — two defects fixed here, one finding left for a human |
| 3 — Reuse and altitude | **approved** — one place named as ceremony, and it is a small one |
| 4 — Scope discipline | **approved** |
| 5 — What was left behind | **approved** — no Gap is a blocker in costume; one QA caveat closed here |
| 6 — Documentation | **approved after correction** — one wrong ADR example and three stale lines fixed here |

Suite after the corrections: **472 tests, 15 files, `tsc --noEmit` clean, `npm run build` exit 0, 28 static
routes.** 469 → 472 by pure addition: one test per correction. Nothing was removed, renamed or loosened.

---

## 1 — Rule adherence

**Approved.** Every convention in `CLAUDE.md` is not merely followed, it is *enforced* somewhere:

| Convention | How it is held |
| --- | --- |
| English on disk, PT-BR in conversation | every artifact and identifier is English; the spoken-form table is complete, 39 terms |
| Use the glossary's word for every domain concept | `tools/glossary-check.ts`, two scans, red on a planted word |
| Never name a concept with an `_Avoid_` word | same check, with the three exemption classes this file records |
| A new term goes into `CONTEXT.md` immediately | `Halt` arrived with Task 7's code and is in the glossary |
| Record an ADR only when all three hold | seven, one per techspec entry, each with a real trade-off |
| Falsify every type-level proof | 75 probes; QA broke five guarantees at the source and got `TS2578` each time |
| Declare your Gaps | five declared, all five found where the delivery says they are |
| One place per rule | `hasReachedCap`, `stoppedAtCap`, `formsOf`, `findDelegation`, `stateBlock` |

Two adherence calls worth stating, because both could read as violations and neither is:

- `AgentRunner`, `AgentRun`, `AgentReport` and `AgentRun.instruction` carry words the glossary avoids, and
  they are outside the name scan **by scope rather than by exemption**. That is the honest shape: a port is
  named after the boundary, and a scope cannot quietly excuse a domain file the way an exemption list would.
- `stepsOf` is the techspec's `project` renamed, because `project` is avoided under **Workspace**. Renaming
  the code rather than exempting the word is the precedent the PRD itself set when `core/` became `engine/`,
  and it is the right direction: an exemption outlives the sentence it was written for.

The three deviations from the techspec's file list (`Refusal` and `Decision` in `mission.ts`, `MissionEvent`
and `MissionCommand` prefixed, `Instant` in `events.ts`) are each argued where they land and each recorded in
`CLAUDE.md`. All three are right, and the `Event` one is more than a preference: `Event` is a global of the
`dom` lib this repo compiles against, so a domain type of that name would be a permanent trap.

## 2 — Domain integrity

**This is the item the review exists for, so it was answered by trying to break the model rather than by
reading it.** Eleven constructions were attempted through the public surface only (`@engine/index`), as a
consumer would, in a probe that `npx tsc --noEmit` accepted **while it sat in the tree** — the standard
`CLAUDE.md` sets for a reviewer probe, after it caught three false alarms in Task 4's review. The probe was
then deleted; what survives it is three permanent tests in the real files.

| Attempt | Outcome |
| --- | --- |
| Spend past a Cap nobody authorised | **refused.** The accrual is recorded and halts; `delegate`, a same-Cap `authorise-cap` and `deliver-mission` are then refused `cap-reached`, three times over |
| Settle one Delegation twice | **refused** in `decide`, and **ignored** in the fold when the fact is handed over twice by hand — the state is byte-equal either way |
| Excuse a required Clause with a Gap | **refused** `contract-violation`; the Delegation stays open, so the loop is refuse-and-resubmit and not a dead end |
| Fold an Event onto the unopened state | **ignored**; only an opening applies, and every Command on it is refused |
| Delegate with a Core that holds an execution Capability | **accepted.** See the finding below |
| Read a Core the Command did not really carry | **threw `TypeError` out of `decide`.** Fixed here |
| Read back a Refusal the Replay had recorded | **threw `TypeError` out of `stepsOf`.** Fixed here |
| Halt a Mission at a Gate it never raised, from a hand-written log | **accepted by the fold**, and then answerable only by `kill-mission`. Recorded below |
| Fold a log that mixes two Missions | **nonsense, as PRD open risk 4 says.** Declared, pinned by a test, unchanged |

The model is **not** decoration. Four invariants in particular carry real load, and each one is load-bearing
in the structural sense — remove it and the source stops compiling, not just the test:

- the states are a discriminated union, so an unopened Mission has no Cap to read and a Cap halt cannot
  carry a GateId;
- `Money` is branded, so no float path exists and the Cap comparison is exact;
- `CoreCapability = Exclude<Capability, ExecutionCapability>` is derived, so a Capability added to the
  executing side is excluded without this file being remembered;
- `exhausted(value: never)` means a Command or an Event added without a rule fails the build.

### Defect 1, corrected — `decide` could throw, on the one field a rule reaches into

`core` is the one required field of `open-mission` that a rule **dereferences**: `holds` read
`core.capabilities`. `Core` is a structural type with no brand, so a Surface that deserialised a payload and
handed it in — the exact path ADR 0002 exists for — produced `undefined.some` and threw out of `decide`,
which promises never to throw. `CLAUDE.md` already records the three grades of cast-tolerance and says the
third one needs code; this field was on the wrong side of its own rule.

Corrected in `engine/domain/mission.ts`: the set is read as `unknown`, a Core nobody can read holds nothing,
and the Command is refused `missing-capability` with the violation that already existed. No new vocabulary,
no rule change, no state change. Falsified by restoring the old one-liner: the new test reports
`TypeError: Cannot read properties of undefined (reading 'some')`.

### Defect 2, corrected — the reading a human is shown threw on a Refusal the domain had handled perfectly

The sharpest of the three, because everything before it was right. Task 6 hardened `decide` to *refuse* a
`submit-handoff` whose Handoff was lost to a `cast` rather than throw on it; `submit` records that Refusal;
and `stepsOf` — reading it back — dereferenced `command.handoff.delegationId` and threw. A Replay that
cannot be read cannot be shown to a human, which is the only reason the Replay exists.

Corrected in `engine/domain/replay.ts`: the id is read as `unknown` and the line says *"answering a
Delegation this Command does not name with a Handoff was refused (illegal-transition): …"*. Falsified the
same way. The general form is now in `CLAUDE.md`: the non-throwing contract governs every **reading** over a
recorded Command too, because a Replay records intentions the domain refused *for being* malformed.

### Finding, left for a human — the Core invariant is enforced at construction, not at the boundary

A Core forced past the compiler and handed to `open-mission` leads a Mission, and its Delegations are
accepted. `decide` never re-checks. That is defensible as a boundary — `assertNoExecution` throws and
`decide` must not, and refusing the Command would need a `RefusalReason` this PRD's union does not carry, so
inventing one inside a review is precisely the scope creep this repo forbids. What was **not** defensible is
the reason the code gave for it: `mission.ts` said the invariant needs no re-check "because a Core is only
constructible through `core()`", and `{ capabilities: [] }` satisfies `Core` without ever meeting the guard.

The comment now states the boundary truthfully and names the durable fix: **brand `Core`**, so the
constructor really is the only way in, exactly as `Money`, `Briefing`, `Slice`, `Instant` and the five ids
already are. That changes the public surface, so it is a human's call and not a reviewer's. It is the sharpest
thing in this review, and it is why acceptance criterion 2's second verb — a Core cannot be constructed **or
used** with an execution Capability — is proven for construction and, at the boundary, only by convention.

### Recorded, not fixed — a hand-written log can halt a Mission at a Gate that does not exist

`applyHalted` copies the `Halt` off the fact without asking whether the Mission holds that Gate, while
`applyGateDecided` and `applyCapAuthorised` both do ask. So a fold of an invented log can reach a Mission
stopped at a Gate nobody raised, which no sequence of Commands produces, and only `kill-mission` gets it out.
It is the same class as PRD open risk 4 — a hand-written log is a Surface's mistake — and closing it is a rule
change in the fold, which deserves its own decision rather than a quiet patch in a review. Recorded here so
it is not rediscovered.

## 3 — Reuse and altitude

**Approved.** Nothing is reimplemented: one Cap boundary (`hasReachedCap`), one precedence walk
(`specified`), one Contract rule (`validateHandoff`), one lookup per collection (`findDelegation`,
`findGate`), one derivation of "the same word" (`formsOf`, which is what closed BUG-3), one place where a
state refuses a Command (`stateBlock`). Money arithmetic exists in `money.ts` and nowhere else, and the
`Intl` refusal is right for a reason that is about testability rather than taste.

Nothing is abstracted early either, and the delivery says **no** in the places that matter: no repository, no
event store, no `Pane` type, no `Combination` aggregate, no actor model, no schema `library`, no dependency at
all. The `AgentRunner` port has one method because a Zord is invoked and answers.

**Is thirteen modules and 469 tests ceremony for one aggregate?** No, and the count is the wrong measure. The
modules are five independent rule clusters plus their value objects, and each one is where its invariant is
enforced — collapsing them would put five rule sets in one file and one review. Of the tests, roughly a third
are *falsifiable type-level probes* rather than behaviour, which is what makes the compile-time half of this
delivery real rather than asserted, and the two heaviest files (`mission.test.ts` 85, `meter.test.ts` 63) are
sweeps across every Command against every state — the thing that catches a rule cluster breaking a neighbour.

Two honest observations:

- **`money.ts`'s `formatMoney` and `groupThousands` are the one bit of altitude the domain did not need.**
  Formatting for display is a Surface's concern; it is here because a violation quotes an amount a human
  reads. That is a real user, so it stays — but it is the one helper in the engine whose home is arguable.
- **`meterOf`, `openGateIn` and `revisionsIn` are readings no rule reads**, by decision, for a Cockpit that
  does not exist yet. Three readings for a Surface nobody has built is close to the line the PRD's own open
  risk 3 draws about the Replay. It is the right side of it: each answers something the site already promises,
  and `revisionsIn` is what keeps "revise with a reason" from being theatre.

## 4 — Scope discipline

**Approved.** All eight out-of-scope entries hold. There is no real CLI adapter, no Cockpit UI, no
persistence of any sort, no MCP server, no provider or credential, no site refactor, no retro-documentation,
and no token counting. The engine imports nothing — proven structurally, by asserting every `from "…"` in
every non-test file is relative — so there is no `node:child_process`, no `node:fs`, no HTTP client anywhere
near the domain.

What the delivery contains beyond the letter of the scope is **five additions, all inside it**:

| Addition | Reading |
| --- | --- |
| `kill-mission` as its own Command | in scope: PRD scope 6 names kill as one of the three human answers, and routing it through `decide-gate` would have made a running Mission unstoppable |
| `raise-gate` as its own Command | required, not extra: without it no sequence of Commands reaches a Gate, and criteria 6 and 13 would be proven only against a state the engine cannot arrive at |
| `unrunnable-harness`, a fifth `RefusalReason` | in scope and better than the alternative: a wrong reason on a Refusal sends a human to the wrong remedy |
| Seven ADRs where the techspec listed four | under-described over-delivery: Tasks 4, 7 and 9 each met a decision that passes the three-part test |
| `stepsOf`, `eventsIn`, `refusedIn`, `meterOf`, `revisionsIn`, `openGateIn` | readings criterion 7 and the Gate's "revise with a reason" require; none is stored, all are derived |

Nothing was found that the PRD did not ask for. The `Delegation`'s `spent`, the Mission's `spent` and the
`gates` list all arrived **with** the rule that moves them, which is this repo's own standard for when a field
may exist.

## 5 — What was left behind

**Approved. No declared Gap is a blocker wearing a Gap costume**, and the reason is structural rather than a
promise: four of the five are *absences* the type system cannot fill in silently, and the fifth is pinned by a
test that asserts the current behaviour.

| Gap | Blocker? |
| --- | --- |
| tokens | no. The port answers a cost and there is no price list; a `tokens` field would be the always-zero lie. Additive |
| per Combination | no. There is no Combination aggregate to sum across. Additive |
| no actor model | no, and it is refused at the type level in three places, so whoever adds one visits all of them in one change |
| `evolve` does not check an Event's Mission | no. Pinned by a test, and the fix is a rule change in the fold |
| inflections escape the scan | closed by BUG-1's fix; what remains is a declared closed set with **zero** live instances |

### The four caveats QA left to a human, judged

1. **Task 10 amended acceptance criterion 8** — see the section below. **I would let it through.** It is a
   legitimate correction, and the process point is real enough to be worth one minute of the war-room.
2. **Caveat 13, the fence-crossing span** — **closed here, so nothing is left to answer.** I reproduced it
   first, and it was worse than described: the planted `squad` between the two ticks was **not reported at
   all**. An adherence check that quietly says a tree is clean makes every green run meaningless, so this
   was mine to fix rather than to hand on. Fixed at the cause — a fenced line is emptied instead of dropped,
   so it *is* the paragraph bound the span search already has — with a test, falsified by restoring the drop.
3. **Caveat 14, `wordsOf` cannot see `PRs` or `TODOs` as names** — **I would let it through without it being
   answered.** The two forms are caught in prose, which is where a document would write them, and the remedy
   touches the one `function` every other rule reads. That is a change worth doing deliberately, on its own,
   not as a rider to this delivery.
4. **Caveat 15, `delivery` is enforced nowhere** — **I would let it through, and the decision is genuinely not
   mine.** The reading is right for the reason the source gives: no rule over names can excuse `DeliveryId`
   while refusing `ZordDelivery`, since they differ only in word order. And the collision is *inside*
   `CONTEXT.md`, where **Handoff** is defined using the very word its `_Avoid_` line forbids. Resolving it
   means editing the glossary — either rewording that definition and dropping the entry, or keeping both and
   accepting that one word of 129 is advice rather than a `rule`. Whoever owns the ubiquitous language owns
   that, and a tool change would be the wrong place for it. I also confirmed the loss is bounded: the other
   three words avoided under **Handoff** still fire as names.

## 6 — Documentation

**Approved after correction.** `CONTEXT.md` reflects what was built: 39 terms, every one with a spoken form,
every new term the techspec promised present, and `Halt` added when the engine grew it. `Money` and `Instant`
are deliberately out, by the glossary's own admission test — a branded amount and a branded timestamp are
general programming concepts — and what is domain-specific about the first lives in ADR 0004.

The seven ADRs describe what exists. I re-read each against the code it claims to govern rather than against
the techspec, which is where the one wrong line was:

| ADR | Still true of the code? |
| --- | --- |
| 0001 event-sourced pure domain | yes — and its "every collaborator that can throw is wrapped" is exactly what defects 1 and 2 were exceptions to; both are now wrapped |
| 0002 Core enforced twice | yes at construction. Its consequence list is silent about the boundary, which is the finding in item 2 |
| 0003 one bounded `context` | yes — nothing in `engine/` is arranged by the four candidates, as it says |
| 0004 Money is integer cents | **corrected here.** It gave `moneyFromDecimal("12,34")` as the way reais arrive, and `money.ts` **refuses** a comma by design. An example the code rejects is worse than no example |
| 0005 Harness resolved in `decide` | yes — `evolve` copies the bundle and re-resolves nothing |
| 0006 Cap at equality, raised absolutely | yes, down to `spent >= cap` living in one place |
| 0007 Replay is the sequence of Decisions | yes — `stateOf` is `replay(eventsOf(…))`, with no stored state |

Two more stale lines, both corrected here: **PRD scope item 10** still described the check as firing when an
avoided word "appears in `engine/` or in `docs/prd/`", which is the wording criterion 8 was narrowed away
from in the same document — so the PRD contradicted itself, and the scope entry is the half a reader meets
first. And the **techspec's verification row 8** claimed a scope the check does not have. Both now say what
the two scans really read.

`tasks.md` is **left stale on purpose**: Task 10's text still says four ADRs and Task 3's still says three
`illegal-transition` refusals where Task 7 changed two to `cap-reached`. Both are QA caveats 3 and 4, both are
accurate as a record of what was *asked*, and editing a task list after the fact would erase the evidence that
the delivery grew. A human should read them as a record of what was asked, not of what stands.

---

## The two questions this review was asked to answer independently

### Did the reviewer amending acceptance criterion 8 hollow out QA?

**No. It is a legitimate correction of an unimplementable criterion, and the safeguards that make it so are
worth naming, because the pattern is genuinely dangerous.**

The original wording made the check fire when an avoided word "appears in `engine/`". That is not a narrower
or a stricter reading of the rule — it is a **different rule**, and an impossible one: twelve of the avoided
entries are TypeScript keywords or ordinary technical vocabulary (`type`, `interface`, `function`, `kind`,
`input`, `result`, `module`, `context`, `level`, `log`, `block`), the techspec's own contracts use them
thirteen times, and the techspec-pinned `AgentRunner` contains one in its name. A criterion that cannot pass
without deleting correct code is not a criterion anybody keeps; it is a criterion somebody switches off. The
`CLAUDE.md` entry that argues this ("a check that fails on `export type` is a check nobody will keep") was
written from the same finding.

Four things stop it being scope moved to fit the delivery, and I checked each:

- **The amendment is narrower in scope and *not* weaker where it counts.** It names the two things that can
  actually claim a concept — an exported symbol name, and prose — and it **widened** the second one beyond
  the criterion, to `docs/adr/`, which is prose about the domain by definition.
- **It is declared in the criterion itself**, in the commit, and in `CLAUDE.md`, with the reason. A silent
  amendment is the failure mode; this one is impossible to meet without reading why.
- **It survived being attacked.** QA reproved the delivery on this very criterion and opened three bugs
  inside its scope. A criterion rewritten to be passable would not have gone red three times.
- **It did not touch the criterion's teeth.** Both scans are armed against the real tree, not fixtures, and
  planting a word turns them red today.

What I would still say to the two peers: **the amendment was the right call and the wrong hand made it.** A
criterion is the PRD's, and the PRD is the human's; the correct shape is the task reporting "criterion 8
cannot be implemented as written, here is why, here is the narrowing I propose" and a human editing `prd.md`.
The outcome was identical here, and the only thing that made it safe was that the executor declared it. Worth
one minute of the war-room, and worth a rule in `CLAUDE.md` if it ever happens twice.

### Is `CLAUDE.md` still an asset, or a document nobody will read?

**Still an asset, and closer to the edge than it looks.** The check I ran on it was not about length:

- **Is any of it wrong?** One entry was superseded mid-flight, and the file **already corrects it in place
  and says so** — "A `?: never` on a discriminated union is not the exclusion it looks like" reverses the
  earlier claim about excess-property checking, with the falsification that decided it. The BUG-1 fix
  likewise supersedes "add the inflected form to the `_Avoid_` list", and that entry opens by saying so in
  bold. Correcting in place rather than deleting is the right convention: the wrong version is part of the
  evidence. I found no third case, and no entry that contradicts the code as it stands.
- **Is any of it dead weight?** Very little. I checked a sample against the tree and each one is either
  enforced by a test or is a decision a future task would otherwise re-argue. The two process entries
  (`npm run lint` broken, `git checkout` on a planted file) have both already cost somebody a redo.
- **So what is the real cost?** **Retrieval, and context on every task, forever.** It was 1,144 lines
  before this review and is 1,213 after it, with about sixty rule headings in chronological order — and the
  rules that matter most on the next task are not the ones nearest the top.

So I made the cheap correction and left the expensive one alone. Added at the head of the ledger: how to read
it, the convention that a superseded rule is corrected in place, and the five entries that carry the most
load if somebody reads nothing else. **Not** done: splitting the ledger into a second file. A rule nobody
loads is a rule nobody applies, and moving sixty of them out of the one file every task reads is a
process decision for the war-room, not for a review — but it is the decision to take before this file passes
two thousand lines.

---

## What was corrected in this context

Every change is additive to the tests and falsified at its source. `npm test`, `npx tsc --noEmit` and
`npm run build` are green after all of them.

| # | Change | Test that goes red when it is undone |
| --- | --- | --- |
| 1 | `holds` in `engine/domain/mission.ts` reads the Core's capability set as `unknown`, so `decide` refuses instead of throwing | `mission.test.ts` — "refuses instead of throwing when the Core cannot be read at all" reports `TypeError … reading 'some'` |
| 2 | The comment on `OpenedFields.core` states the boundary truthfully and names the branding fix, replacing the false claim that a Core is only constructible through `core()` | (prose) |
| 3 | `asked` in `engine/domain/replay.ts` reads a `submit-handoff`'s Handoff as `unknown`, so `stepsOf` cannot throw on a Refusal it recorded | `replay.test.ts` — "reads back a refused Handoff that carried none, instead of throwing" reports `TypeError … reading 'delegationId'` |
| 4 | `proseLinesOf` in `tools/glossary-check.ts` empties a fenced line instead of dropping it, so two unmatched backticks cannot pair across a fence (QA caveat 13) | `glossary-check.test.ts` — "does not let a span pair across a fence…" reports `expected [] to deeply equal [ 'squad' ]` |
| 5 | ADR 0004's decimal example, PRD scope item 10, techspec verification row 8 and the techspec's structure line | (prose; the `tools/` suite proves no exemption lost its carrier) |
| 6 | `CLAUDE.md`: three new entries from this review, the ledger's reading guide, and the `any` count | (prose) |

Per-file counts, each file run on its own: `capability` 19, `money` 16, `ids` 6, `events` 6, `harness` 41,
`contract` 25, `handoff` 20, `mission` **85**, `meter` 63, `gate` 59, `replay` **40**, `mission.e2e` 11,
`fake-agent-runner` 17, `glossary-check` **47**, `prd-structure` 17 — **472**. The three bold counts are the
three additions; every other count is QA round 3's, unchanged.

## Decisions that are a human's, not mine

1. **Brand `Core`, or leave the invariant enforced only at construction.** It changes the public surface, and
   it is the one thing in this review that touches this product's loudest promise. My recommendation: brand
   it, in its own small PRD, together with whatever else the Surface boundary needs.
2. **The `delivery` collision inside `CONTEXT.md`** (QA caveat 15). Glossary owners', and the answer sets the
   precedent for the next collision.
3. **`wordsOf` and the capitalised entries** (QA caveat 14). A change to the one helper every other rule reads.
4. **Whether a task may amend the criterion it is measured by**, and if so how it must be declared. The
   amendment here was right; the convention is missing.
5. **`npm run lint` has not worked since before this flow existed** — `next lint` is deprecated in Next 15
   and there is no ESLint configuration. Pre-existing, out of this PRD's scope, and it means every review step
   including this one ran with no linter. It deserves an entry of its own on somebody's list.

## Next

The `PR` may be opened. It still goes through manual evaluation by **two peers** and through the weekly
war-room: automation speeds execution up, it does not replace human conference. The five decisions above are
what those two conversations are for.
