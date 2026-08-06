# QA — Mission Engine

Validation of `docs/prd/mission-engine/` against `prd.md`, `techspec.md`, `tasks.md`, `CONTEXT.md`,
`CLAUDE.md` and `docs/adr/0001..0007`. Judged by running the proofs, never by reading the diff.

- **Verdict**: **reproved**
- **Date**: 2026-08-06
- **Tree**: `1f2d709` (Task 10), working tree clean before and after every probe below
- **Open bugs**: 2 — see `bugs.md`

## Verdict in one paragraph

All thirteen acceptance criteria are proven, and every row of the techspec's verification plan was
really verified. Five type-level guarantees were falsified at their source and every one reported
`TS2578`; the three adherence checks were re-armed with violations planted in the real tree, not in a
fixture, and all three went red. The delivery is reproved on one thing only, and it is inside the
scope criterion 8 governs: two words `CONTEXT.md` says to avoid are live in `prd.md` prose, and the
scan does not see them because it matches whole words and they appear inflected. The delivery declares
that hole as a *class* in `CLAUDE.md`; it never swept the documents for live instances of it, so these
two are an undeclared instance of a declared limitation. Both are one reword each. Nothing else is
outstanding, and nothing in `engine/` is at fault.

## Evidence per criterion

### Criterion 1 — `npm test` passes and the site build stays green

```
$ npm test
 Test Files  15 passed (15)
      Tests  449 passed (449)
   Duration  2.55s

$ npm run build
EXIT=0
 ✓ Generating static pages (28/28)
Route (app)                                 Size  First Load JS
┌ ○ /                                      124 B         109 kB
...
```

Per-file counts, each run on its own so no file hides behind another: `capability` 19, `money` 16,
`ids` 6, `events` 6, `harness` 41, `contract` 25, `handoff` 20, `mission` 84, `meter` 63, `gate` 59,
`replay` 39, `mission.e2e` 11, `fake-agent-runner` 17, `glossary-check` 26, `prd-structure` 17 — 449.

**Proven.**

### Criterion 2 — a Core cannot hold an execution Capability, and the cast path throws

`engine/domain/capability.test.ts`, 19 tests. Four `@ts-expect-error` probes for the compile-time
half; nine runtime tests for the guard, covering a forced Capability, a hand-built object, a name in
neither of the two registered sets, and a bare string that spells a Capability.

Falsified at the source, replacing `CoreCapability = Exclude<Capability, ExecutionCapability>` with
`= Capability`:

```
$ npx tsc --noEmit
engine/domain/capability.test.ts(55,9): error TS2578: Unused '@ts-expect-error' directive.
engine/domain/capability.test.ts(64,5): error TS2578: Unused '@ts-expect-error' directive.
```

Restored, `tsc` clean. Independently re-checked from the public surface — a probe of my own,
typechecked with `npx tsc --noEmit` clean while it sat in the tree, then deleted:
`core([executionCapability("spawn-process") as unknown as CoreCapability])` throws
`ExecutionCapabilityError`.

**Proven.** Both halves, and the type-level half is falsifiable.

### Criterion 3 — a Handoff violating its Contract is refused with no human involved, stating what broke

`engine/domain/contract.test.ts` (25) for the required / optional / Gap rule, and
`engine/domain/mission.test.ts` for the refusal reaching a caller. The exact text a human would read:

```
refusal.reason    === "contract-violation"
refusal.violations === [
  'Clause "clause-tested" ("Every Pane has a test") is required and was not satisfied'
]
```

and, when the Zord tries to excuse a required Clause:

```
'Clause "clause-tested" ("Every Pane has a test") is required, so declaring it as a Gap does
 not excuse it: "no test harness was available"'
```

"No human involved" is proven as a property of the shape rather than as a promise: `decide` is
synchronous and pure, the Refusal *is* its return value, and my own probe asserts
`decide(state, bad)` deep-equals `{ kind: "refused", refusal }` — there is nothing to await and
nobody to ask. `mission.test.ts` also pins "never asks and never throws, whatever Handoff lands on
whatever state".

**Proven.**

### Criterion 4 — Harness resolution follows roster > invocation > catalog default

`engine/domain/harness.test.ts`, 41 tests. One case per level winning, one where different fields
resolve from different levels, one per field in isolation, plus the absent-versus-empty rule
(`skills: []` wins, an omitted or `undefined` key falls through) and Skills replacing rather than
merging.

Falsified twice at the source:

```
# catalogDefault widened to Partial<Harness>
engine/domain/harness.test.ts(493,9): error TS2578: Unused '@ts-expect-error' directive.
engine/domain/harness.ts(205,3): error TS2322: Type 'Partial<Harness>[TField]' is not assignable …

# readonly dropped from Harness
engine/domain/harness.test.ts(526,5): error TS2578: Unused '@ts-expect-error' directive.
engine/domain/harness.test.ts(537,5): error TS2578: Unused '@ts-expect-error' directive.
engine/domain/harness.ts(151,3): error TS2322: … not assignable to type 'Harness'.
```

The collateral errors inside `harness.ts` itself are the good sign `CLAUDE.md` describes: the
guarantee is structural load, not an annotation the probe merely observes.

**Proven.**

### Criterion 5 — reaching the Cap halts, and nothing continues without an Authorisation

`engine/domain/meter.test.ts`, 63 tests: the boundary read at equality, the exact-boundary accrual,
one cent short, past the Cap, a Cap of zero, the halt as the second fact of the same Decision, the
three commissioning Commands refused `cap-reached`, `accrue-cost` still accepted because the money
was already gone, and the Authorisation path with its refusal at or below `spent`.

Reproduced independently from the public surface (my probe, typechecked, then deleted): a Cap of
1000 cents with 1000 accrued halts; `delegate` is then refused `cap-reached`; `authorise-cap` at
1000 is refused `cap-reached`; at 2000 the Mission returns to running and `delegate` is accepted.

**Proven.**

### Criterion 6 — a Gate blocks progress until decided, and a Kill stops the Mission

`engine/domain/gate.test.ts`, 59 tests. Blocked: every commissioning Command refused while the Gate
is open, `authorise-cap` refused because a Gate is not answered with money, an answer to the wrong
GateId refused. Decided: approve resumes, revise resumes carrying the reason as context and keeps the
Briefing untouched. Kill: routed as its own Command, ends a running Mission, one halted at a Gate and
one halted at its Cap, leaves the Gate unanswered, and refuses everything afterwards.

My probe confirms the ending independently: after `kill-mission` the status is `killed`, and both
`delegate` and `deliver-mission` are refused.

**Proven.**

### Criterion 7 — the Replay holds every delegation, refusal, gate decision and cost in order, and folds back to the same state

`engine/domain/replay.test.ts`, 39 tests. Fold equality over a run containing a Refusal, a Gate
decision, a Cap halt and an Authorisation; equality for **every prefix** of the log against the state
those Commands had reached; `refusedIn(stepsOf(...))` for the refusals, with what each one broke; one
test per kind the criterion names, and one that the two facts of a single Decision keep their order.

My probe rebuilds it from the public surface: five Commands through `submit`, one of them refused,
`stepsOf` gives five Steps, `refusedIn` gives exactly one whose reason is `contract-violation`, and
`replay(eventsOf(recording))` deep-equals `stateOf(recording)`.

**Proven.**

### Criterion 8 — a test fails when an `_Avoid_` word is used to name a domain concept

`tools/glossary-check.test.ts`, 26 tests. The check is a library of pure functions plus four readers,
which is what lets a violation be planted rather than the test only ever asserting a clean tree.

I did not trust the fixtures. Planted in the real tree, run, reverted:

```
$ printf 'export type SquadRoster = { readonly maestro: string };' >> engine/domain/mission.ts
$ printf 'The maestro hands a subtask to a worker inside a squad.' >> docs/prd/mission-engine/prd.md
$ npx vitest run tools/glossary-check.test.ts
 × passes clean over engine/domain
 × passes clean over docs/prd
engine/domain/mission.ts:1564 uses "squad" (_Avoid_ under Combination) in: SquadRoster
docs/prd/mission-engine/prd.md:154 uses "maestro" (_Avoid_ under Core) in: …
docs/prd/mission-engine/prd.md:154 uses "subtask" (_Avoid_ under Slice) in: …
docs/prd/mission-engine/prd.md:154 uses "worker" (_Avoid_ under Zord) in: …
docs/prd/mission-engine/prd.md:154 uses "squad" (_Avoid_ under Combination) in: …
 Tests  2 failed | 24 passed (26)
```

The check is armed, it points at the tree, and it names file, line, word and the term that owns the
`_Avoid_` entry. Worth seeing: `maestro` was flagged in the prose and **not** in `SquadRoster`'s property
name — correct: only exported declaration names claim to be a concept.

**The test is proven. The documents it governs are not clean.** Two `_Avoid_` words are live in
`prd.md` prose and escape the matcher through inflection — see `bugs.md` BUG-1. A second, smaller
defect in the same check is BUG-2.

### Criterion 9 — a PRD folder missing one of the three documents fails

`tools/prd-structure.test.ts`. Planted in the real tree, run, reverted:

```
$ mkdir -p docs/prd/half-thought && printf '# nothing\n' > docs/prd/half-thought/prd.md
$ npx vitest run tools/prd-structure.test.ts
 × passes clean over docs/prd
missing PRD artifacts: half-thought/techspec.md, half-thought/tasks.md
```

`qa.md`, `bugs.md` and `review.md` are correctly not required — they arrive later in the flow.

**Proven.**

### Criterion 10 — strict TypeScript, no `any`, no stray suppression

```
$ npx tsc --noEmit
EXIT=0
```

`tsconfig.json` has `strict: true`; the effective flags include `noImplicitAny`, `strictNullChecks`,
`strictFunctionTypes` and `useUnknownInCatchVariables`. `engine/**` is inside `include`.

Both scans planted in the real tree, run, reverted:

```
$ printf 'export const loose: any = 1;' >> engine/domain/money.ts
$ printf '// @ts-expect-error\nconst bare = 1;' >> engine/domain/money.test.ts
$ npx vitest run tools/prd-structure.test.ts
 × passes clean over engine/, tests included
 × passes clean over engine/
engine/domain/money.ts:159 export const loose: any = 1;
engine/domain/money.test.ts:141 // @ts-expect-error
 Tests  3 failed | 14 passed (17)
```

Counted by hand as well: 75 directives in `engine/` open their comment, which is the only form
TypeScript honours, and **none** of the 75 is in a non-test file. There is no `@ts-ignore` and no
`@ts-nocheck` anywhere in `engine/` or `tools/` outside the two lines of `prd-structure.test.ts` that
exist to refuse them. The scan blanks comments, string literals and regular-expression literals first,
which is load-bearing: every mention of `any` in `engine/` is prose.

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are **off**. That is not a miss —
`harness.ts` documents the first as the reason resolution walks fields explicitly instead of
spreading — but it is worth knowing that "strict" here means the `strict` family and not every
strictness flag TypeScript offers. Recorded as a caveat, not a bug: the criterion says strict, and
strict is on.

**Proven.**

### Criterion 11 — every new term is in `CONTEXT.md`, and every ADR passes the three-part test

This is the one criterion with no executable proof by nature, so I checked it two ways.

**Terms.** I read all 135 exported names out of `engine/domain/` and split each into words, then
compared against the words of every `CONTEXT.md` term. Nothing names a concept the glossary does not
carry. What is left over is verbs and states around glossary terms (`Delegated`, `HaltedMission`,
`RefusalReason`, `MeteredDelegation`, `ReplayEntry`), plus `Money` and `Instant`. Those two are
deliberately out, and the reason is the glossary's own admission criterion: a branded amount and a
branded timestamp are general programming concepts, and what is domain-specific about `Money` lives
in ADR 0004. `Halt` was the one term the engine had and the glossary lacked; Task 10 added it, with
its spoken form `parada`. The glossary's own test pins that every term has a spoken form and every
spoken form has a term.

The five terms the techspec promised to introduce — `Command`, `Event`, `Decision`, `Clause`,
`Capability` — are all present, each under a heading with an `_Avoid_` list.

**ADRs.** Seven on disk, one per entry of the techspec's "Decisions worth an ADR". Judged against
hard-to-reverse, surprising-without-context and a real trade-off:

| ADR | Hard to reverse | Surprising | Real trade-off | Passes |
| --- | --- | --- | --- | --- |
| 0001 event-sourced pure domain | every invariant is written as a rule of `decide`/`evolve` | yes | mutable aggregate is shorter and easier to hire for | yes |
| 0002 Core invariant enforced twice | the guarantee is load-bearing across the engine | yes — a reader deletes the runtime guard as redundant | the two layers overlap on purpose | yes |
| 0003 one bounded context now | an invented seam is the most expensive DDD mistake | yes — it records a **no** | a glossary that will get long | yes |
| 0004 Money is integer BRL cents | every amount in the engine | yes | conversion at every boundary, no arithmetic beyond add and compare | yes |
| 0005 Harness resolved in `decide` | recorded facts cannot be re-derived later | yes | fatter fact, no way to retro-fix a bad catalog default | yes |
| 0006 Cap reached at equality, raised absolutely | changes what every recorded Cap meant | yes — a Cap of zero halts a Mission that spent nothing | absolute loses the legibility of "+R$ 30" | yes |
| 0007 Replay is the sequence of Decisions | the Replay's shape is its whole value | yes — the obvious shape is the Event log | a second structure a Surface must hold, `submit` re-folds on every call | yes |

None is ceremony, and 0003 is the strongest of the seven precisely because it records a refusal.

**Proven.**

### Criterion 12 — an illegal Mission transition is rejected

`engine/domain/mission.test.ts`, the `illegal transitions` block, with the three cases the criterion
names and the exact text each returns:

- delegating on a halted Mission — `cap-reached` on a Cap halt ("…until its Cap is authorised"),
  `illegal-transition` on a Gate halt, because a Gate is not answered with money;
- a Handoff for a Delegation never made — `'Delegation "delegation-2" was never made in this
  Mission, so there is nothing to hand off'`;
- deciding a Gate that is not open — swept across every state, plus the wrong-GateId case.

Two sweeps make the block more than three examples: every Command against every state always refuses
with a reason the union carries and at least one violation, and never throws. My own probe reproduced
all three refusals from the public surface.

The reason drift is deliberate and recorded: Task 7 moved three Commands from `illegal-transition` to
`cap-reached` because a wrong reason on a Refusal sends a human to the wrong remedy. `tasks.md`
Task 3 still says all three return `illegal-transition`; ADR 0006 and `CLAUDE.md` both explain the
change, and the test comments state it inline. Stale task text, not a defect.

**Proven.**

### Criterion 13 — a whole Mission end to end against the fake runner, no CLI, no network

`engine/mission.e2e.test.ts`, 11 tests, driving Briefing → two Delegations → a refused and
resubmitted Handoff → a Gate → a Cap halt and an Authorisation → Delivery, then folding its own log
back to the state it drove and running the whole thing twice identically.

"No network, no CLI" is proven twice, structurally and behaviourally:

- `Date.now`, `Date.parse`, `Math.random` and `globalThis.fetch` are all replaced with functions that
  throw, and the Mission still reaches `delivered`;
- every `from "…"` in every non-test file of `engine/` is asserted to be a relative path. No
  `node:child_process`, no `node:fs`, no HTTP client, no dependency — so there is nothing that could
  have been reached around the stubs.

**Proven.**

## Techspec verification plan, row by row

| Row | Named proof | Verified |
| --- | --- | --- |
| 1 | `npm test` + `npm run build` | yes — 449 tests, build exit 0 |
| 2 | `capability.test.ts` type-level plus a throwing cast | yes — and falsified at the source |
| 3 | `contract.test.ts` + `mission.test.ts` | yes — violations quoted above |
| 4 | `harness.test.ts` one case per level | yes — plus a mixed case and per-field sweep |
| 5 | `meter.test.ts` accrual crossing the Cap, next Command `cap-reached` | yes — including the exact boundary |
| 6 | `gate.test.ts` blocked, proceed, revise, kill as its own Command | yes — `kill-mission` is its own member of the Command union |
| 7 | `replay.test.ts` fold equality plus `refusedIn(stepsOf(...))` | yes — over a log with all four ingredients |
| 8 | `tools/glossary-check.test.ts` | yes — re-armed with real plants |
| 9 | `tools/prd-structure.test.ts` | yes — re-armed with a real broken folder |
| 10 | `tsc --noEmit` plus scans for `any` and stray suppression | yes — both scans re-armed |
| 11 | review item by nature | done here: terms compared, seven ADRs judged |
| 12 | `mission.test.ts` one case per illegal transition | yes — plus two exhaustive sweeps |
| 13 | `mission.e2e.test.ts` | yes — clock, dice and network stubbed, import graph asserted |

Every row holds. Row 8's scope is narrower than the techspec's wording ("over `engine/` and
`docs/prd/`"): the real scan reads exported names in `engine/domain/` and prose in `docs/prd/` **and**
`docs/adr/`. Criterion 8 was amended in the same commit to say so — see the caveat below.

## Tasks marked done

All ten are `done`, and each one's stated verification exists and runs.

| Task | Verification claimed | Found |
| --- | --- | --- |
| 1 | branded id rejects a raw string at type level | `ids.test.ts`, 6 tests; falsified — brand made optional gives `TS2578` at `ids.test.ts:32` |
| 2 | cents arithmetic, fractional refused; Core compile-time and cast | `money.test.ts` 16, `capability.test.ts` 19; both falsified |
| 3 | three illegal transitions | `mission.test.ts` `illegal transitions` block |
| 4 | `Delegated` produced, unknown Delegation refused | `mission.test.ts` `delegating a Slice` and `answering a Delegation` |
| 5 | one case per precedence level plus a mixed case | `harness.test.ts` 41 |
| 6 | required Clause not excused by a Gap, optional excused only by one | `contract.test.ts` 25 + `mission.test.ts` |
| 7 | exact boundary and the Authorisation path | `meter.test.ts` 63 |
| 8 | blocked, proceed, revise, kill | `gate.test.ts` 59 |
| 9 | fold equality with a Refusal and a Gate decision; end to end | `replay.test.ts` 39, `mission.e2e.test.ts` 11, `fake-agent-runner.test.ts` 17 |
| 10 | planted `_Avoid_` word fails; missing techspec fails; no `any`, no stray suppression | `glossary-check.test.ts` 26, `prd-structure.test.ts` 17 — all re-armed with real plants |

**Declared Gaps, all of them found where the delivery says they are.** None is undeclared:

- **tokens.** `meter.ts` states it, `CLAUDE.md` states it, and it was promoted into the PRD as
  out-of-scope item 8. The `AgentRunner` port answers a cost and there is no price list, so a `tokens`
  field would be the always-zero lie. Correctly absent rather than half-built.
- **per Combination.** `meter.ts` states it: there is no Combination aggregate, so a Mission cannot
  know which one it belongs to. Declared in code and in `CLAUDE.md`, *not* promoted into the PRD.
- **no actor model.** Declared in `CLAUDE.md` ("No identity model, so no authoriser on the fact") and
  in Task 8's commit: "One Gap, three sites, each pinned by a type-level probe so an actor model
  deletes all three directives in one change." `gate.test.ts` carries two of those probes — "refuses
  an author on a Gate decision, because nothing here names a human" and "refuses an author on a kill".
- **`evolve` does not check an Event belongs to its Mission.** PRD open risk 4, ADR 0007's
  consequences, `CLAUDE.md`, and pinned by `replay.test.ts` "does not filter by MissionId, because
  evolve does not either".
- **inflections escape the adherence scan.** Declared as a class in `CLAUDE.md` and in Task 10's
  commit. The live instances of it were never looked for — that is BUG-1.

## The five risky spots, judged

The delivery was asked to be examined at five specific places. My reading of each:

1. **`evolve` does not check that an Event belongs to its Mission.** *Acceptable.* `replay` cannot
   filter without breaking the `replay(events) === events.reduce(evolve, …)` equality that is its
   whole value, so the two functions must agree, and they do. A log mixing two Missions is a Surface's
   mistake; the current behaviour is pinned by a test rather than left to be discovered. The fix is a
   change to which Events a Mission accepts, which is a rule change and deserves its own decision —
   the right call was to record it, not to patch it inside a task that did not own it.
2. **No author on `CapAuthorised`, `GateDecided`, `MissionKilled` or a `Step`.** *Acceptable, and
   better than the alternative.* Nothing in `engine/` names a person — a Core is a set of Capabilities
   — so an `authorisedBy` would be a claim no rule could check: the always-zero field this repository
   keeps warning about. It is not merely absent, it is **refused at the type level** in two places, so
   whoever adds an actor model is forced to visit all three sites in one change. One caveat: the PRD
   itself never mentions it, so a reader of `prd.md` alone would not know. Token counting got promoted
   into out-of-scope item 8; this Gap and the per-Combination Gap did not.
3. **The Meter accounts cost and not tokens.** *Acceptable.* Out of scope item 8 of the PRD, stated
   with its reason, and the reason is sound — the port reports a cost and no price list exists to
   derive one from a token count. Additive the moment a runner reports them.
4. **33 prose exemptions — is any excusing a real violation?** *No, and I checked all 33 against the
   real documents.* I scanned `docs/prd/` and `docs/adr/` with the exemption table emptied: 175 hits
   across 30 distinct words. Every hit under an exempted word is ordinary English, a TypeScript
   keyword, or this flow's vocabulary about itself — `"state lives in memory"` is RAM, `cast` is a
   type assertion, `limit` is the word `CONTEXT.md` uses to define the Cap itself, `folder` is
   criterion 9's own wording, `context` names both a bounded context and the glossary file. The
   closest call is `agreement` in ADR 0005 ("judged against the agreement that existed when the
   Delegation was made"), where the word stands in for the Contract named in the same sentence; it is
   apposition rather than naming, and the glossary's own Contract entry reads "the interface
   **agreed** between Zords", so I let it stand. What I did find is the opposite problem: three
   exemptions excuse nothing at all — BUG-2.
5. **The scan matches whole words, so inflections escape.** *Real, declared as a class, and live in
   the tree.* This is the one thing that reproves the delivery. See BUG-1. I also confirmed the trade
   itself is right: a stem scan would flag `validateHandoff` for `validation` and `Catalog` for `log`,
   which is how a check gets switched off in its second week. The matcher should not get smarter; the
   two sentences should be reworded.

## Caveats — non-blocking, recorded

None of these blocks the PRD. They are stated so that nobody rediscovers them.

1. **Task 10 amended acceptance criterion 8, the criterion it was itself measured by.** Openly, in
   the commit message and in the criterion text, and for a defensible reason: the original wording
   ("appears in `engine/` source") is unimplementable, since twelve `_Avoid_` words are TypeScript
   keywords and the techspec-pinned `AgentRunner` legitimately carries one. The narrowing is right.
   The pattern is worth naming anyway — a task rewriting the criterion it will be judged against is
   the one move that can make QA vacuous, and the only thing that stopped it here is that the change
   was declared and the reason survives review. Worth a human's eye before this goes to peer evaluation.
2. **The narrowing dropped `engine/ports/` and `engine/adapters/` from the name scan entirely.**
   By decision, and the decision is defended in the module and pinned by a test that shows the word
   is still live if the port's text is handed to the scan. But nothing now guards a name in those two
   folders, and a future adapter is where domain vocabulary is most likely to leak back in.
3. **`tasks.md` Task 10 still says `docs/adr/` carries "the four decisions from the techspec" and
   touches `docs/adr/0001..0004`.** Seven exist, one per techspec entry, because Tasks 4, 7 and 9
   each added one. This is under-described over-delivery, not a Gap — but the task text is stale.
4. **`tasks.md` Task 3 still says the three illegal transitions each return `illegal-transition`.**
   Task 7 changed two of them to `cap-reached` on a Cap halt, deliberately and with an ADR. The tests
   and `CLAUDE.md` are current; the task text is not.
5. **The per-Combination Gap and the no-actor-model Gap live only in code and in `CLAUDE.md`.** Token
   counting was promoted into the PRD's out-of-scope list; these two were not, so `prd.md` read alone
   overstates what the Meter and the governance facts carry.
6. **"Strict TypeScript" is the `strict` family, not every strictness flag.**
   `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are off. The first is documented in
   `harness.ts` as the reason resolution walks fields explicitly rather than spreading them, so it is
   a known condition the code is written for, not an oversight.
7. **`npm run lint` still does not work.** Pre-existing and recorded in `CLAUDE.md`: `next lint` is
   deprecated in Next 15 and there is no ESLint config. The repository has no working linter, which
   matters for `/executar-review`.
8. **`qa.md` and `bugs.md` are themselves scanned by the glossary check.** Confirmed: `prdDocuments()`
   reads every `.md` under `docs/prd/`. This document was written under that constraint and passes.

## Falsifications performed by QA

Five type-level guarantees broken at their source, `tsc` run, then restored. Every one reported
`TS2578`, and the working tree was verified clean after each.

| Guarantee | Break | Result |
| --- | --- | --- |
| `Money` is branded | `type Money = number` | `TS2578` ×4: `money.test.ts:117,128`, `meter.test.ts:996`, `fake-agent-runner.test.ts:204` |
| A Core excludes execution Capabilities | `CoreCapability = Capability` | `TS2578` ×2 at `capability.test.ts:55,64` |
| Exhaustiveness over the Command and Event unions | `exhausted(value: unknown)` | `TS2578` at `mission.test.ts:1620` |
| An id is branded | brand made optional | `TS2578` at `ids.test.ts:32` (+ `contract`, `handoff`) |
| A catalog default is complete, a Harness is `readonly` | `Partial<Harness>`; `readonly` dropped | `TS2578` at `harness.test.ts:493`, `526`, `537`, each with collateral errors inside `harness.ts` |

The collateral damage is the point: a probe that reports `TS2578` and breaks nothing else deserves a
second look, and here four of the five broke their own source as well.

## What I could not verify

- **Nothing about criterion 11 is machine-checkable**, by the techspec's own admission. I judged the
  seven ADRs against the three-part test myself and compared the exported names against the glossary
  by script, but "does this ADR record a real trade-off" is a reading, not a run. A second human
  should agree with the table above before this goes to peer evaluation.
- **Whether the `_Avoid_` calls in the exemption table are the ones the people who own the glossary
  would make.** I can prove each entry names a word `CONTEXT.md` really avoids and check what it lets
  through; I cannot prove they agree that, say, `limit` in prose is acceptable. That is a war-room
  question.
- **The real runtime.** By design: no CLI is spawned anywhere, and PRD open risk 1 is that modelling
  invariants before the runtime exists can bake in wrong assumptions. QA cannot close that risk; only
  a real adapter can.

## Next

Run `/executar-bugfix` for the two entries in `bugs.md`, then `/executar-qa` again. Nothing advances
with an open bug, and automation does not replace the human conference that follows it.
