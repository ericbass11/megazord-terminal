# QA — Mission Engine

Validation of `docs/prd/mission-engine/` against `prd.md`, `techspec.md`, `tasks.md`, `CONTEXT.md`,
`CLAUDE.md` and `docs/adr/0001..0007`. Judged by running the proofs, never by reading the diff.

**Current verdict: reproved — Round 2, one open bug (BUG-3).** Both rounds are kept below, oldest
first. Round 1 is the record of the delivery as Task 10 left it; Round 2 re-validates after
`/executar-bugfix` and is the verdict that stands.

| Round | Tree | Verdict | Open bugs |
| --- | --- | --- | --- |
| 1 | `1f2d709` (Task 10) | reproved | BUG-1, BUG-2 |
| 2 | `c4f2f5f` (bugfix) | reproved | BUG-3 — BUG-1 and BUG-2 verified fixed |

---

# Round 1 — the delivery as Task 10 left it

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

---

# Round 2 — after `/executar-bugfix`

- **Verdict**: **reproved**
- **Date**: 2026-08-06
- **Tree**: `c4f2f5f` (bugfix), working tree clean before and after every probe below
- **Open bugs**: 1 — BUG-3 in `bugs.md`. BUG-1 and BUG-2 are fixed, and both fixes were reproduced
  here rather than accepted from the handoff.

## Verdict in one paragraph

Both bugs are fixed, and both are fixed at the cause: the old matcher is green over the exact
documents that carried `agents` and `auditing`, and the strengthened one reports both at the exact
lines BUG-1 named; reinstating the exemption the bugfix deleted makes the new real-tree test fail
naming it, while the mechanical test it replaced passes with the dead entry sitting in the table. All
thirteen acceptance criteria still hold, three type-level guarantees were falsified again with the
same `TS2578`, and the strengthened scan produces **no false positive anywhere in the tree** — 135
exported names clean, every document clean, and all 57 hits that exist only because of inflection
fall under words that were already exempted for the right reason. Nothing was weakened to pass:
`CONTEXT.md` and `engine/` are byte-identical to Task 10, no test was removed or loosened, and the
exemption table shrank in substance even while its count stayed at 33. The delivery is reproved on
one thing, and it is precisely the risk this round existed to hunt: the fix widened the **avoided**
side of the name scan into every inflection and left the **term** exemption beside it un-widened, so
the plural of a glossary term is now a violation. `export type Deliveries` is reported for `delivery`
(`_Avoid_` under **Handoff**) although `Delivery` is a defined term whose plural is correct code, and
the name scan has no exemption table in which to excuse it. It is latent — nothing in the tree
triggers it — and one word wide, `Delivery` being the only term that also sits in an `_Avoid_` list.
See BUG-3.

## BUG-1 — fixed at the cause, reproduced three ways

**1. The old matcher against the pre-fix documents.** The strongest form of the proof, because it
holds the documents fixed and moves only the code. A worktree at `1f2d709` supplied the documents as
the delivery shipped them; the matcher transcribed from that same commit was run against them, and
then the current one:

```
pre-fix documents: 10

[A] OLD matcher over PRE-FIX documents (what the delivery shipped) -> 0 violations
[B] FIXED matcher over the SAME PRE-FIX documents -> 2 violations:
    docs/prd/mission-engine/prd.md:109 "agent" (_Avoid_ under Zord) :: real agents behave. Mitigated …
    docs/prd/mission-engine/prd.md:113 "audit" (_Avoid_ under Replay) :: … designed for auditing needs …
```

Same files, same glossary, same exemption table as the delivery shipped: green before, two hits
after, at the two lines BUG-1 named, with the two `_Avoid_` owners BUG-1 named. That is the cause, not
the symptom — the symptom was the two sentences, and they were reworded second.

**2. Planted in the real tree, in inflected forms only.** A plant richer than the bugfix's, so more
than one class of inflection is exercised — plural, past, present participle and the consonant-plus-`y`
form:

```
$ printf 'The maestros dispatched subtasks to workers inside squads, and the histories were audited by bots.\n' >> docs/prd/mission-engine/prd.md
$ printf 'export type SubagentWorkers = readonly string[];\n' >> engine/domain/mission.ts
$ npx vitest run tools/glossary-check.test.ts
 × passes clean over engine/domain
 × passes clean over docs/prd
engine/domain/mission.ts:1564 uses "worker" (_Avoid_ under Zord) in: SubagentWorkers
engine/domain/mission.ts:1564 uses "subagent" (_Avoid_ under Zord) in: SubagentWorkers
prd.md:154 "maestro" (Core)   "dispatch" (Delegation)   "subtask" (Slice)   "bot" (Zord)
prd.md:154 "worker" (Zord)    "squad" (Combination)     "history" (Cortex)  "history" (Replay)
prd.md:154 "audit" (Replay)
 Tests  2 failed | 33 passed (35)
```

Nine prose hits, every one of them from an inflected form, and `history` correctly twice because two
terms avoid it. The name scan caught `SubagentWorkers` for the exact word **and** for the plural, so
the widening reaches both scans as the docstring claims. Reverted by `git checkout`, tree verified
clean, suite green again at 35.

**3. The one thing that must not have happened.** The rewording is real and is the declared policy:
`prd.md:109` now reads "how real Zords behave" and `prd.md:113` "designed to answer questions no one
has asked yet". Exactly two lines of `prd.md` changed and neither is an acceptance criterion —
`git diff 1f2d709 c4f2f5f -- docs/prd/mission-engine/prd.md` touches only open risks 1 and 3.

## BUG-2 — fixed at the cause, and the corrected test falsified

The falsification the bug asks for, performed here rather than read: the exemption the bugfix deleted
was put back into `PROSE_EXEMPTIONS` verbatim, and the suite run.

```
$ npx vitest run tools/glossary-check.test.ts
 × carries at least one real line of the documents it governs, every entry
AssertionError: these exemptions excuse nothing in docs/prd or docs/adr: delete them, or say in
`because` what prose they are cover for and why that prose is not written yet:
expected [ 'output' ] to deeply equal []
 Tests  1 failed | 34 passed (35)
```

Two things in that red, and the second is what makes it a fix rather than a patch. The new test names
the dead entry, and **the mechanical test it replaced is among the 34 that passed** — with the dead
entry sitting in the table. That is the defect BUG-2 described, demonstrated from both sides in one
run. Reverted; tree verified clean.

The third new test — the one that falsifies the new test by deriving a genuinely carrier-less avoided
word from the tree — was re-read and holds: `uncarried` is non-empty by a wide margin (129 avoided
entries, 33 of them live in the documents), so it cannot pass vacuously.

## No false positive: the check does not reprove correct code

This was the real risk of BUG-1's fix, and it was measured rather than reasoned about. Reproduced
independently through the module's own exported readers, not through its tests:

```
terms: 39   avoided entries: 129   exemptions: 33
exported names in engine/domain: 135
naming violations: 0
documents scanned: 12
prose violations WITH the table: 0
total hits with NO exemptions: 316   distinct words: 33
exemptions with ZERO carriers: none
hits under words NOT exempted: none
```

The last two lines are the whole answer. Every one of the 316 hits the empty table exposes falls
under one of the 33 exempted words, and every one of the 33 has at least one carrier. There is no hit
the table does not cover and no entry the tree does not need.

**The three names the brief asks about, and how they are actually clean.** `validateHandoff` is a
real exported name and passes. `Catalog` and `catalogDefault` are **not** exported names of
`engine/domain/` at all — `Catalog` is a glossary term with no type yet and `catalogDefault` is a
field of `resolveHarness`'s argument, which no scan reads — so the guarantee about them can only be
tested by planting, which is what the delivery's own tests do and what I repeated:

```
CLEAN  export const Catalog = 1;
CLEAN  export const catalogDefault = 1;
CLEAN  export function validateHandoff(): void {}
CLEAN  export type CatalogEntry = never;          <- the term exemption cannot be what saves this one
CLEAN  export function resolveCatalogs(): void {}
CLEAN  export const validatedHandoffs = 1;
CLEAN  export function loggedIn(): void {}         <- `logged` is not derived; no doubled consonants
FIRES  export const catalogDefaults = 1;   "defaults"/Catalog
FIRES  export type Validation = never;     "validation"/Gate
```

`CatalogEntry` matters more than `Catalog` does: `Catalog` is a defined term and would be excused by
the term exemption whatever the matcher did, while `CatalogEntry` goes through the avoided loop and
still passes. So `catalog` genuinely does not reach `log`, `logs`, `loged` or `loging`, and the
distinction between growing a word forwards and cutting it back holds under test.

**Where the widening actually landed.** Of the 316 hits, 57 exist only because of inflection — the
line does not contain the bare entry. Grouped by the form that matched:

| Entry → form | Hits | Reading |
| --- | --- | --- |
| `block` → `blocks`, `blocked`, `blocking` | 10 | what the Cap blocks; a fenced code block |
| `document` → `documents`, `documented`, `documenting` | 14 | "the documents this check governs" |
| `task` → `tasks` | 7 | `tasks.md` and this flow's own vocabulary |
| `function` → `functions` | 5 | "a `library` of pure functions" |
| `type` → `typed` | 5 | "the Core is typed as an actor whose…" |
| `rule` → `rules` | 4 | "the rules the product promises" |
| `level` → `levels` | 4 | precedence levels of a Harness resolution |
| `interface` → `interfaces` | 3 | "the interfaces agreed before any code" |
| `context` → `contexts` | 2 | candidate bounded contexts |
| `directive` → `directives` | 2 | compiler directives, `@ts-expect-error` |
| `folder` → `folders` | 1 | criterion 9's own wording |

Every one is ordinary English, a TypeScript keyword or this flow talking about itself. **Not one is a
domain concept being named**, so the widening did not smuggle a real violation past the table. The
words are the same eleven `CLAUDE.md` already recorded as ordinary vocabulary, plus the one arrival
judged below.

**The classes the closed set deliberately leaves out have no live instance either.** This is the
failure mode Round 1 reproved: a hole declared as a class, with instances of it sitting in the tree
and nobody having looked. So the same sweep was run against a **deliberately wider** derivation than
`inflectionsOf` — doubled consonants and the British `-lled` this repository's spelling would produce,
`-al`, `-ally`, `-ly`, `-ation`, `-ment`, `-er`, `-ors`, `-ical`, and the irregular plurals of `-is`
and `-x`:

```
avoided entries the prose scan actually enforces: 93
wider-inflection hits on ENFORCED entries in docs/prd + docs/adr: 0
wider-inflection hits on exported engine/domain names: 0
```

Zero, both scans. The closed set is incomplete by decision and the incompleteness is declared, and
this time there is nothing live behind the declaration. That is the difference between Round 1's
`CLAUDE.md` and this one.

## Nothing was weakened to pass

| Claim | How it was checked | Found |
| --- | --- | --- |
| No `_Avoid_` entry was deleted | `git diff e65ef6f c4f2f5f -- CONTEXT.md` | empty — byte-identical, 39 terms, 129 avoided entries |
| The engine was not touched | `git diff 1f2d709 HEAD -- engine/ docs/adr/ techspec.md tasks.md tools/prd-structure.test.ts` | empty — all byte-identical |
| No test was removed | every `it(` title, pre-fix versus now | one renamed (`is load-bearing, every entry` → `excuses the word it names, mechanically`), nine added, none removed |
| No assertion was loosened | the renamed test's body in the diff; `expect(` count | body unchanged; 42 → 62 assertions |
| No test was switched off | `grep -rE '\.(skip\|todo\|only)\(' engine/ tools/` | nothing |
| The suite grew where it should | per-file counts, each file run alone | 458 total; only `glossary-check` changed, 26 → 35 |
| Only six files changed at all | `git diff --name-only 1f2d709 HEAD` | `CLAUDE.md`, `bugs.md`, `prd.md`, `qa.md`, `glossary-check.ts`, `glossary-check.test.ts` |

**The table went 33 → 33, and the two moves are not equivalent.** What left is `output`: no carrier in
any form, in any document, so the module's own rule applies and the deletion is correct — I confirmed
the word appears in the scanned documents only inside code spans and inside `techspec.md`'s fenced
`AgentReport`, neither of which the prose scan reads. What arrived is `directive`, avoided under
**Command**, carried by `qa.md:227` and `qa.md:361`, both of them about the `@ts-expect-error`
compiler directive. **The arrival is legitimate**: it is category one of the table's own taxonomy, a
compiler word rather than a domain intent, and it became visible for the same reason `interfaces` did.
It is also not the table absorbing a hit it should have reworded — the two carriers are in QA's own
document, which a bugfix has no standing to rewrite. The count staying at 33 hides a table that is
strictly more honest than before: three entries excused nothing and now none does.

## The thirteen criteria, re-run

Re-run rather than inherited, because a change to `tools/` and two reworded PRD lines are still a
change. `engine/` being byte-identical to `1f2d709` is a fact I verified, not an assumption, and it is
why the behavioural criteria could be re-proven by re-running their proofs instead of re-deriving
their reasoning.

```
$ npm test        Test Files 15 passed (15)   Tests 458 passed (458)
$ npx tsc --noEmit   EXIT=0
$ npm run build      EXIT=0   ✓ Generating static pages (28/28)
```

Per-file, each run on its own: `capability` 19, `money` 16, `ids` 6, `events` 6, `harness` 41,
`contract` 25, `handoff` 20, `mission` 84, `meter` 63, `gate` 59, `replay` 39, `mission.e2e` 11,
`fake-agent-runner` 17, `glossary-check` 35, `prd-structure` 17 — 458. Every count is Round 1's except
`glossary-check`, which gained the nine tests the fix brought.

**Three type-level guarantees falsified again at their source**, each restored and the tree verified
clean between them:

| Guarantee | Break | Result |
| --- | --- | --- |
| `Money` is branded | `type Money = number` | `TS2578` ×4 — `money.test.ts:117,128`, `meter.test.ts:996`, `fake-agent-runner.test.ts:204` |
| A Core excludes execution Capabilities | `CoreCapability = Capability` | `TS2578` ×2 — `capability.test.ts:55,64` |
| Exhaustiveness over both unions | `exhausted(value: unknown)` | `TS2578` — `mission.test.ts:1620` |

Identical to Round 1, line for line.

**Criteria 8, 9 and 10 re-armed against the real tree**, not against fixtures:

- 8 — the plant above; both scans went red.
- 9 — `mkdir docs/prd/half-thought` with only a `prd.md`: `missing PRD artifacts:
  half-thought/techspec.md, half-thought/tasks.md`, `1 failed | 16 passed (17)`.
- 10 — `export const loose: any = 1;` into `money.ts` and a bare `@ts-expect-error` into
  `money.test.ts`: `engine/domain/money.ts:158`, `engine/domain/money.test.ts:140`,
  `2 failed | 15 passed (17)`. Round 1 recorded three failures for the same plant; the third is not
  reproducible, because `counts the deliberate probes` asserts `toBeGreaterThan(60)` and a plant adds
  a probe rather than removing one. Round 1's own count was one too high; the two scans that matter
  both fired. The honoured-probe count is still 75, which is what `qa.md:227` claims.

**Criteria 2, 3, 5, 6, 7 and 12 reproduced from the public surface.** A probe of my own, five tests,
importing only from `@engine/index` — `npx tsc --noEmit` clean **with the probe still in the tree**,
which is the standard `CLAUDE.md` sets for a reviewer probe, then deleted:

- a Core handed an execution Capability through a cast throws `ExecutionCapabilityError`;
- a Handoff excusing a required Clause as a Gap is refused `contract-violation`, the violation says
  "is required", the Refusal is the return value, **no fact is recorded** and the Delegation stays
  open — `eventsOf` is unchanged and `refusedIn(stepsOf(…))` holds exactly one;
- accruing the whole Cap halts; `delegate` is then refused `cap-reached`; `authorise-cap` at the same
  amount is refused `cap-reached`; above it the Mission returns to `running`;
- an open Gate refuses `deliver-mission`, and `kill-mission` ends the Mission and refuses everything
  after;
- `replay(eventsOf(run))` deep-equals `stateOf(run)` over a run containing a Refusal and a Gate.

Criteria 1, 4, 11 and 13 rest on the same evidence as Round 1, re-run: the suite, the build, the
`harness.test.ts` falsifications recorded above in Round 1, the 135 exported names compared against
the glossary again by script, and `mission.e2e.test.ts` passing with its clock, dice and network
stubbed. `docs/adr/` is byte-identical, so the seven-row reading in Round 1 stands unchanged.

## The declared leftovers, judged

The bugfix declared four things it found and did not fix. My reading of each, and one of them is the
bug.

1. **The closed set derives no irregular plural, no doubled consonant and no `-al`/`-ly` form, and a
   form it cannot derive goes beside the set rather than into `CONTEXT.md`.** *Accepted cost, and
   correctly placed.* The wider sweep above found zero live instances across 93 enforced entries, so
   unlike Round 1 this declaration has nothing hiding behind it. Keeping the mechanics out of
   `CONTEXT.md` is right for the reason given: the glossary is shared vocabulary, and "the plural of an
   avoided word is also avoided" is not vocabulary. Worth knowing that this repository writes British
   English (`modelled`, `authorised`, `over-modelled`), so `cancelled` and `signalled` are the two
   forms most likely to be the first real gap — neither word is exempted, and neither is live today.
2. **Five exemptions hang on a single line of prose each, and `directive`'s only carrier is `qa.md`.**
   *Accepted cost, with a caveat, and it is the sharpest of the four.* Confirmed exactly:
   `spec` → `techspec.md:3`, `setup` → `prd.md:99`, `conversation` → `prd.md:79`, `rejection` →
   `techspec.md:189`, `feature` → `techspec.md:22`; `directive` had exactly two carriers when this round
   began, both in this file and nowhere else. Three more sit at two carriers with one of them in
   `qa.md`: `result`, `config`, `validation`. Writing this round moved the numbers without changing the
   shape — `directive` now has four carriers and `result` three, and **all four of `directive`'s are
   still in this one file**, which is the point rather than a mitigation. The sweep with the table
   emptied now gives 367 hits across the same 33 words. The consequence is real and worth stating
   plainly — **a future QA round that
   rewrites this document instead of appending to it turns `npm test` red on a `tools/` test**, and the
   same is true of anyone tidying one sentence of the techspec. I judge it an accepted cost rather than
   a defect for three reasons: the failure message names the entry and prescribes the remedy, the
   remedy is deleting one line, and the alternative — an exemption nobody can tell is dead — is the
   defect BUG-2 was. What must never happen is the inverse, planting a sentence somewhere to keep an
   entry alive, and `CLAUDE.md` now says so. It is recorded as a caveat below.
3. **Deleting `output` makes the word live in prose for every future document.** *Accepted, and it is
   the right direction.* `output` is `_Avoid_` under **Handoff**, and a PRD writing "the Zord's own
   `output`" is naming a Handoff with the wrong word. The check will say so, and the answer will be
   `Handoff` or a code span. The cost is that ordinary technical English about what a command prints
   now needs a code span — this document was written under that constraint, as Round 1 was written
   under the constraint that it is scanned at all.
4. **`git checkout <file>` on a planted file discards your own edits to it.** *Accepted, and useful.*
   A process lesson rather than a leftover in the delivery. It applied to me in the other direction: I
   had no edits to `prd.md` or `mission.ts`, so `git checkout` was safe, and I verified the tree clean
   after every revert rather than trusting it.

And the fifth thing, which the bugfix did **not** declare and which is why this round reproves:
widening the avoided side of the name scan without widening the term exemption beside it. `Delivery`
is a defined term that also sits under `_Avoid_` for **Handoff** — the exact case the name scan's one
exemption exists for — and the exemption compares a name against the term set as an exact word join,
while the avoided side now matches every inflection. So the singular passes and the plural does not:

```
clean  export type Delivery = never;
FIRES  export type Deliveries = readonly Delivery[];   "delivery"/Handoff
FIRES  export function deliveriesOf(): void {}         "delivery"/Handoff
```

The delivery's own docstring says the widening "was measured against `engine/domain/` before it was
turned on — all 135 exported names stay clean". True, and that is a measurement of the names that
exist, which is exactly the weakness BUG-2 was about in another form: it cannot see a name nobody has
written yet. See BUG-3.

## Caveats — non-blocking, recorded

Round 1's eight caveats all still hold; `engine/`, `CONTEXT.md` and `docs/adr/` are byte-identical, so
nothing in them was addressed or worsened. Caveat 8 in particular is now sharper rather than merely
true. Three more from this round:

9. **`npm test` now depends on the wording of documents.** A `tools/` test fails when a document is
   reworded such that an exemption loses its last carrier — five entries are one line from that, and
   every line that carries `directive` is in this file. That is the price of an honest table and it is the
   right price, but it means acceptance criterion 1 can be broken by prose that touches no code, and
   whoever hits it should delete the entry the message names rather than argue with it.
10. **The prose scan's exemptions widened with the matcher, silently and symmetrically.** An exempted
    entry is dropped from the avoided list entirely, so exempting `cast` now also excuses `casts`,
    `casted` and `casting`. That is coherent — the reason a word is ordinary English does not stop
    applying in its plural — but it is a second-order effect of the fix that no test states, and the
    `because` strings are all written in the singular.
11. **Latent false-positive pressure grew, in a way that is bounded but real.** Every derived form
    still carries the avoided word, so nothing unrelated can match; what can match is an inflection of
    an avoided word used as ordinary English, and several are one sentence away — `noted` and `noting`
    (`note`, under **Fact**), `requested` (`request`, under **Briefing**), `released` (`release`, under
    **Delivery**), `deployed`, `positioned`, `traced`, `staged`. None is exempted and none is live. The
    remedy is the machinery that already exists — reword, or an exemption with its reason — so this is
    a cost of the check working, not a fault in it. It is recorded because the first person to meet one
    will otherwise think the matcher is broken.
12. **An inline code span that wraps across a line break defeats the span stripping.** Pre-existing —
    `proseLinesOf` is byte-identical to Task 10 — and found the hard way while writing this round's
    documents. The stripping is applied line by line, so a span opened on one line and closed on the
    next leaves an unmatched backtick on each. The closing one then pairs with the *next* opening
    backtick on its line, which blanks the ordinary prose between them and leaves the following code
    span exposed. Both error directions follow: a quoted word is read as naming something, and a real
    violation between two spans can be blanked away. It cost me one reproved run on a word that was
    quoted in intent. The remedy is to keep a code span on one line, and it is worth a test —
    `proseLinesOf` currently has none for a wrapped span. Not raised as a bug because it predates both
    fixes and nothing in the tree is mis-scanned today, but it is the kind of hole BUG-1 was.

## Reproduced, versus taken on trust

Stated plainly, because a handoff's claim is not evidence.

**Reproduced from scratch**: both fixes at the cause, by three independent routes for BUG-1 and by
falsification for BUG-2; the clean state of both scans through the module's own readers rather than
through its tests; the 316-hit sweep with the table emptied and its grouping by word; the 57
inflection-only hits and the reading of each; the wider-inflection sweep over 93 enforced entries and
135 names; the three spot-check names and six more of my own; the term-collision hunt that found
BUG-3; the single-carrier locations of all five entries the bugfix declared, and `directive`'s two;
`CONTEXT.md` and `engine/` byte-identity; the test-title and assertion-count comparison; the full
suite, per-file counts, `tsc` and the site build; three type-level falsifications; criteria 8, 9 and 10
re-armed in the real tree; criteria 2, 3, 5, 6, 7 and 12 from the public surface with a typechecked
probe. And, unintentionally, the wrapped-code-span hole of caveat 12, by tripping the check twice on
this document's own prose — which is the second time this round that the check has reproved the person
holding it.

**Taken on trust, and why**: Round 1's reading of the seven ADRs against the three-part test, and its
comparison of the 135 exported names against the glossary term by term. Both are readings rather than
runs, `docs/adr/` and `engine/` are byte-identical, and re-deriving a reading I made three hours ago
against unchanged files would produce the same answer without adding evidence. Round 1's own
statement that the criterion-10 plant produced three failures is the one thing I found and could not
reproduce, and I recorded the correction above rather than repeating it. Whether the 33 exemptions are
the calls the people who own the glossary would make remains a war-room question, unchanged. And the
real runtime is still unreachable by QA, by design.

## Next

Run `/executar-bugfix` for BUG-3, then `/executar-qa` a third time. It is one asymmetry in one
function and the fix is small, but nothing advances with an open bug, and a check that reproves
correct code is the one defect that gets a check deleted.
