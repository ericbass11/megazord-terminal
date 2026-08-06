# CLAUDE.md

Working rules for this repository. Read this before touching anything. Every task appends the
rules it discovers here, so this file gets sharper with each round.

## Language policy

- **Conversation with the user: PT-BR.** Questions, reports, verdicts, explanations.
- **Everything written to disk: English.** Code, identifiers, comments, commits, PRDs,
  techspecs, tasks, ADRs, `CONTEXT.md`, this file.
- Translate at the boundary. The user says "recusa"; the code says `refusal`. The mapping is the
  [Spoken form](./CONTEXT.md#spoken-form) table in `CONTEXT.md` — it is the single source of
  truth for that bridge, and speaking one term while writing another is how a ubiquitous
  language dies.
- Reason internally in English: it is the LLMs' native ground and it costs fewer tokens.

## Ubiquitous language

`CONTEXT.md` is the glossary and **only** the glossary — no specs, no implementation notes, no
scratch space.

- Use the English term from `CONTEXT.md` for every domain concept.
- Never use a term listed under `_Avoid_` **to name a domain concept**. `Squad` is not a
  Combination; `agent` is not a Zord; `memory` is not the Cortex. The same word may be perfectly
  correct as ordinary technical vocabulary — see "Glossary checks are about naming" below.
- Found a new domain term, or a term that conflicts with the glossary? Resolve it and write it
  into `CONTEXT.md` **immediately** — not at the end of the task. Batching glossary updates is
  how the model drifts from the code.
- A term is only in the glossary if it is specific to this domain. General programming concepts
  do not belong there.

## Architectural documentation

- Decisions live in `docs/adr/`, numbered sequentially (`0001-slug.md`).
- Record an ADR only when all three hold: hard to reverse, surprising without context, and the
  result of a real trade-off. If any is missing, skip it.
- An ADR can be one paragraph. The value is recording *that* the decision happened and *why*.

## The flow

Every demand passes through the grill. No exception — it is precisely in the "obvious" task that
the unseen nuance costs most.

**Simple task**

```
/grill-with-docs → TDD → manual validation → PR
```

**Complex task**

```
/grill-with-docs → /criar-prd → /criar-techspec → /criar-tasks → /executar-task <prd> <n>
```

Then, until the task list is finished:

```
/executar-qa → (reproved? bugs.md → /executar-bugfix → /executar-qa) → /executar-review → PR
```

Rules that hold across the whole flow:

1. **One task at a time.** `/executar-task` stops after one task so a human validates it.
   `/orquestrar-tasks` is only allowed once this file is mature enough — see its maturity gate.
2. **The QA ↔ bugfix loop is mandatory.** QA reproves and writes `bugs.md`; bugfix fixes; QA runs
   again. It repeats until approval. Nothing is ever released with a known pending item.
3. **A caveat is fixed in the same context, by the same agent.** It does not become someone
   else's doubt later.
4. **Review runs last**, and never over an open bug.
5. **The PR is not the finish line.** It still goes through manual evaluation by two peers and
   through the weekly war-room. Automation speeds execution up; it does not replace human
   conference.

## Artifact layout

```
CONTEXT.md                     glossary (ubiquitous language)
CLAUDE.md                      this file — working rules
docs/adr/NNNN-slug.md          architectural decisions
docs/prd/<slug>/prd.md         problem, outcome, scope, acceptance criteria
docs/prd/<slug>/techspec.md    approach, contracts, verification plan
docs/prd/<slug>/tasks.md       numbered tasks with status and verification
docs/prd/<slug>/qa.md          QA verdict with evidence per criterion
docs/prd/<slug>/bugs.md        open bugs from QA (only when reproved)
docs/prd/<slug>/review.md      final review verdict
docs/PRODUTO.md                product design of the site (pre-dates this flow)
```

PRD slugs are kebab-case English. The folder name is what `/executar-task <folder> <n>` takes.

## Delivery discipline

- **Handoffs declare their Gaps.** Never report a task as complete when part of it was skipped —
  say what was skipped and why. An undeclared Gap is worse than an open bug, because nobody is
  looking for it.
- **Verification over inspection.** Prefer proof that runs. "I read the diff and it looks right"
  is not verification.
- **Scope is the contract.** Anything outside the task's goal is recorded as a finding, not
  quietly implemented.
- **Report failures faithfully.** If a check fails, say so with the output. If a step was
  skipped, say that.

## Rules learned while building

Appended by each task, so the next one does not rediscover them.

**How to read this ledger**, because it is now the longest part of this file. It is **chronological**, one
or more entries per task, and it is not a summary: every entry exists because something was got wrong or
nearly got wrong once. Two conventions make that survivable:

- **A rule that was superseded is corrected in place and says so**, rather than being deleted — the wrong
  version is part of the evidence. There is one so far: "A `?: never` on a discriminated union is not the
  exclusion it looks like" corrects the earlier claim about excess-property checking, and "Grow the avoided
  word forwards" supersedes "add the inflected form to the `_Avoid_` list". Read the later entry.
- **The load-bearing ones, if you read nothing else**: do not add a field or an Event variant no rule
  updates; falsify every type-level proof at the guarantee, never at the test; `decide` and `evolve` never
  throw, so a value that arrives through a cast is read as `unknown` and answered truthfully; a fact
  carries what a rule computed, and a total belongs to the fold; and a check that can only pass proves
  nothing.

Keeping the ledger here rather than in a document of its own is deliberate: a rule nobody loads is a rule
nobody applies. If it outgrows that, the split is a decision for the war-room, not for a task.

### Glossary checks are about naming, not banned words

An `_Avoid_` entry in `CONTEXT.md` means **"do not use this word to name this concept"** — it is
not a banned-word list. Twelve of the current `_Avoid_` terms are ordinary technical vocabulary or
TypeScript keywords: `type`, `interface`, `function`, `kind`, `input`, `output`, `result`, `module`,
`context`, `level`, `log`, `block`. `interface AgentRunner` and `kind: "accepted"` are both correct
code and both would trip a naive scan — the techspec itself uses them 13 times.

So the adherence check (Task 10) scans:

- **exported domain symbol names** in `engine/domain/` — the names that claim to *be* a concept;
- **PRD and techspec prose**, excluding fenced code blocks and excluding `CONTEXT.md` itself.

It never scans raw code tokens. A check that fails on `export type` is a check nobody will keep.

### Type-level guarantees must be falsified, not asserted

A passing test suite proves nothing about a compile-time guarantee: `@ts-expect-error` passes just
as happily when the error it expects has disappeared. Every type-level proof is verified by
**temporarily breaking it** and confirming `tsc --noEmit` reports `TS2578: Unused
'@ts-expect-error' directive`, then restoring. If the guarantee stops holding, `npm run build`
must fail — a comment is not enforcement.

### Falsify at the guarantee, not at the test

When breaking a type-level proof, edit the **source of the guarantee**, not the test that consumes
it. Removing the brand from `Money` made both probes in `money.test.ts` report `TS2578` in a single
`tsc` run; replacing `CoreCapability = Exclude<Capability, ExecutionCapability>` with `= Capability`
did the same for both Core probes. Falsifying by widening a helper inside the test file proves only
that the scaffolding is wired up — it says nothing about the invariant.

Two mechanics worth not rediscovering:

- `@ts-expect-error` on an element of an array-literal argument anchors to that element, so a probe
  can sit inside a call's argument list.
- TypeScript does **not** narrow through an aliased compound condition that uses `in` — extracting
  `typeof x === "object" && x !== null && "name" in x && typeof x.name === "string"` into a `const`
  loses the narrowing and `x.name` goes back to `unknown`. Keep that condition inline in the `if`.

### The Core lives in capability.ts

`Core` (the type) and `core()` (its constructor) are defined in `engine/domain/capability.ts`,
next to the invariant they exist to enforce — acceptance criterion 2 cannot be proven without a
Core-shaped holder to hand a capability to. Later tasks **reuse** that `Core`; a second definition
in `mission.ts` would split the invariant across two places and one of them would rot.

`core()` is where the two layers meet: the parameter type refuses an `ExecutionCapability` at
compile time, and `assertNoExecution` refuses one that was forced through a cast at runtime.

### The lifecycle skeleton, and what it deliberately refuses

`decide` and `evolve` live in `engine/domain/mission.ts`, with the Mission vocabulary — `Briefing`,
`Mode`, `Delegation`, `Delivery`, `Halt`, the state union, `Refusal`, `Decision`. The Event and
Command unions live in `events.ts` and `commands.ts` and import those types back **with `import
type`**: erased at compile time, so there is no module cycle at runtime and the vocabulary stays with
the aggregate it describes.

Three deviations from the techspec, made on purpose:

- **`Refusal` and `Decision` are in `mission.ts`, not `handoff.ts`.** They are the return type of
  `decide`, which Task 3 needs and Task 6 does not: `validateHandoff` returns `readonly string[]`.
  Putting them in `handoff.ts` would have made `mission.ts ↔ handoff.ts` a two-way dependency for no
  gain.
- **The unions are `MissionEvent` and `MissionCommand`, not `Event` and `Command`.** `Event` is a
  global in the `dom` lib this project compiles against; a domain type shadowing it is a permanent
  trap at every import site. The glossary terms stay `Event` and `Command` in prose.
- **`Instant` (branded UTC ISO-8601) lives in `events.ts`.** The techspec's file list has no home for
  time. A fact happens at an Instant, so it lives with the facts, and Commands import the type.

A Command whose rule cluster belongs to a later task is **refused, never guessed**. `delegate`,
`submit-handoff` and `decide-gate` exist in the union today with their state guards implemented and
their accept path replaced by `unmodelled()`, which refuses with `illegal-transition` — truthfully,
because the machine has no such transition yet. Task 4, 6 and 8 each replace one `unmodelled` call
with their accept path and change nothing else. The same rule kept `spent` off the state and
`cost-accrued` out of the Event union: an always-zero field no rule updates is a lie, so Task 7 adds
the field and the accrual together.

### Type-level probes have three ways of proving nothing

Found while falsifying Task 3's probes, each one a probe that passed for the wrong reason:

- **Excess-property checking against a union accepts a property any member declares.** `{ reason:
  "cap-reached", gateId }` compiles against `{reason:"cap-reached"} | {reason:"gate-open"; gateId}`.
  The exclusion has to be written down — `gateId?: never` on the member that must not carry one.
- **A `const` annotated with a union but initialised from a known member is narrowed to that
  member.** `const state: Mission = running()` silently kills a probe about the union; launder the
  value through a function whose *return type* is the union.
- **A mutation probe must assign the value the field already holds.** `state.status = "killed"` fails
  on the literal type as well as on `readonly`, so removing `readonly` leaves it failing and the
  probe never reports `TS2578`. `state.status = "unopened"` isolates the guarantee. At runtime a
  frozen object throws `TypeError` even for a same-value write.

### Exhaustiveness is a `never` parameter that does not throw

`exhausted(value: never): void` in `mission.ts` is the whole enforcement: leave a member of
`MissionEvent` or `MissionCommand` unhandled and the `default` branch still holds it, so the call
stops compiling (`TS2345: Argument of type … is not assignable to parameter of type 'never'`). It
returns `void` and each caller returns its own safe answer, because `decide` and `evolve` are
contractually non-throwing — an `assertNever` that throws would trade a compile-time guarantee for a
production crash. Falsify it by widening the parameter to `unknown`: the probe in `mission.test.ts`
reports `TS2578`.

### The adherence check has three exemptions, not one

Mapped while reviewing Task 3, so Task 10 does not discover it by failing:

1. **A word that is itself a glossary term is never a violation.** `Delivery` is a defined term and
   also sits in `_Avoid_` of **Handoff**. `type Delivery` is correct code; a naive scan reproves it.
2. **Process vocabulary is not domain naming.** `task`, `review`, `context`, `document`, `log` and
   `result` all appear in some `_Avoid_` list, and all six are unavoidable in this repo's own
   process: `tasks.md`, `/executar-review`, `CONTEXT.md`. The `_Avoid_` list governs how the
   **domain** is named, not how the flow talks about itself.
3. **Fenced code blocks and the glossary file itself are out of scope**, as already recorded above.

Two live examples Task 10 will meet, found while adding `Clause` in Task 6:

- `techspec.md` defines `Clause` as "One **requirement** of a Contract", and `requirement` is an
  `_Avoid_` term under **Briefing** — it was already one before `Clause` existed, so this is a
  pre-existing hit in PRD-folder prose, not something Task 6 introduced. Whoever writes the check
  decides whether to exempt the line or reword the techspec; it cannot be edited from inside a task
  whose scope is the engine.
- `validateHandoff` is the name the techspec pins, and **Gate** lists `validation` under `_Avoid_`. It
  is not a violation: the function names a judgement of a Handoff, not a Gate. A stem-based scan would
  flag it; a substring scan does not, because `validateHandoff` does not contain `validation`. Do not
  make the scan smarter than the rule.
- `tasks.md` line 104 reads "approval resumes", and **Gate** has listed `approval` under `_Avoid_` since
  before Task 8 — another pre-existing hit in PRD-folder prose, found while adding **Gate decision**, and
  not editable from inside a task whose scope is the engine. It is the *right* word to avoid, too: only one
  of the two Gate decisions is an approval, so calling the pair "approval" hides the other one. Reword the
  line or exempt it; do not resolve it by deleting the `_Avoid_` entry.

Task 8 added two glossary terms whose `_Avoid_` lists were checked against the tree before being written:
**Gate decision** (`sign-off`, `gate result`) and **Kill** (`cancel`, `abort`). None of the four appears
anywhere in `engine/` or `docs/prd/` today. Worth copying as a habit — grep the tree before adding an
`_Avoid_` term, or the term arrives with a failing check attached.

### Domain unions are prefixed when the bare name is a DOM global

`Event` and `Command` are the glossary terms, and the code uses `MissionEvent` and `MissionCommand`.
Reason: `Event` is a global type from the `dom` lib this project loads, and a domain type shadowing
it is a permanent trap — the shadow only bites in files that also touch the DOM. The prose keeps the
glossary terms; the identifier carries the aggregate prefix.

### Commands whose rules belong to a later task refuse, they do not pretend

Task 3 needed `delegate`, `submit-handoff` and `decide-gate` to exist for its illegal-transition
proofs, while their accept paths belong to Tasks 4, 6 and 8. The pattern used: implement the state
guard, and route the accept path to `unmodelled()`, which refuses with `illegal-transition`. The
machine genuinely does not have the transition yet, instead of having a stub that fakes success.
Each owning task replaces exactly one `unmodelled` call.

**Task 8 replaced the last one and deleted the helper.** A function with no callers is dead weight, and
leaving it in place would invite the next task to reach for it instead of modelling something. The pattern
worked exactly as designed across three tasks, and the record of it is this entry — not a function nobody
calls.

One thing the last replacement could not keep: `decideDecideGate` read the open Gate through a helper
(`openGateOf`), which was fine while its only job was to refuse, and stopped being fine the moment the accept
path needed `state.id`. A helper returning `GateId | undefined` is not a type guard, so the state was never
narrowed. The condition is now written out inline — `state.status !== "halted" || state.halt.reason !==
"gate-open"` — exactly as `decideSubmitHandoff` and `decideAccrueCost` already write theirs out, and the
helper was deleted rather than left with one caller. The pinned violation texts are byte-identical either way.

Corollary, learned the hard way in review: **do not add a field or an Event variant a rule does not
yet update.** An always-zero `spent` is a lie the type system endorses; Task 7 brings the field and
its accrual together.

### Field-by-field precedence is never written with a spread

`{ ...catalogDefault, ...invocation, ...rosterEntry }` looks like precedence and is not. A spread
copies a key that is *present with value `undefined`* over the value below it, so a Roster carrying
`{ model: undefined }` erases the Catalog's model and yields an incomplete Harness. Without
`exactOptionalPropertyTypes`, the type cannot tell an absent key from a key present as `undefined`,
so the compiler will not catch it. Resolution walks the fields explicitly and tests `!== undefined`.

Corollary from the same task: **absent falls through, empty is an answer.** `skills: []` in a Roster
entry means "no Skills" and wins; reading it as "unspecified" would make a deliberate override
indistinguishable from silence and leave no way to say "none". And `skills` **replace** rather than
merge — whoever wants the union can write it in the winning source, but nobody could express
replacement if resolution always merged, and with merge "why does this Zord have this Skill" stops
having an answer.

### A load-bearing type guarantee breaks its own source when removed

Every falsification in Task 5 produced collateral errors inside `harness.ts` itself — dropping
`readonly` broke the `Object.freeze` return (`TS2322`), making `catalogDefault` optional produced
`TS18048`, widening it to `Partial` produced `TS2322` on the indexed access. That is a positive
signal: the guarantee is structural load, not an annotation the probe merely observes. A probe that
reports `TS2578` with no collateral damage is worth a second look.

### A fact carries the resolved value, never the recipe for it

The `Delegated` Event carries the **resolved** Harness, and `decide` is where `resolveHarness` runs.
Carrying the three sources instead would have made "what did this Zord run with" a function of the
Catalog *at reading time*: fold the same log next month against a Catalog whose default model moved
and the Replay tells a different story, about a bundle nobody ever ran. `evolve` therefore copies the
bundle out of the Event and never re-resolves — a fold that re-runs a rule is not a fold.

The general form: **anything a rule computes from outside the aggregate is computed once, in `decide`,
and recorded in the fact.** Task 7 met the other half of it and it is worth reading beside this one —
see "A fact carries what happened; the totals belong to the fold": there was no price list to meet,
because a cost arrives already priced on the Command, and what a fact must *not* carry is the total
computed from the facts themselves.

### `decide` never throws, so a throwing collaborator is wrapped

`resolveHarness` throws `InvalidHarnessError`, and it is reachable from a well-typed Command:
`catalogDefault` is a complete `Harness` by type and `cli: ""` satisfies that type. So `decide` calls
it inside `resolvedHarnessOf`, which turns the throw into a Refusal. Two rules came out of that:

- **Catch everything, rethrow nothing.** Rethrowing "unexpected" errors would leave `decide` throwing
  on a path nobody can enumerate, and "never throws, except" is not a contract a Surface can build on.
- **A wrong reason on a Refusal is worse than a new reason.** `unrunnable-harness` is a fifth
  `RefusalReason` the techspec's four did not have. The transition is legal, the Core may delegate, no
  Contract was broken and the Cap was not reached — reusing `illegal-transition` would have put a lie
  in front of a human. Adding the member is cheap; the exhaustiveness machinery does the rest.

`missing-capability`, by contrast, was already in the union and had no user: Delegation is its one
user, because delegating is the Core's own act and `capability.ts` already names the permission.

### "Recorded as open" is the absence of an answer, not a field

A Delegation carries no `status`. A field whose only value is `"open"` is the same lie as an
always-zero `spent`: the type system endorses it and no rule can move it. Openness is *nothing having
answered yet*, and the answer is a Handoff (Task 6). The test that guards this asserts the exact key
set of a recorded Delegation, so adding a field without a rule that fills it in fails.

Same reasoning in the other direction: `evolve` **ignores** a second `Delegated` under an id it
already holds, the way it keeps the first halt. `decide` refuses the duplicate, but `evolve` is total
and folds whatever log it is handed, and appending would make the state depend on how many copies of
a fact the log happened to carry.

### Two Delegations to one Zord are legal; two under one DelegationId are not

The answerable thing is the **Delegation**, not the Zord: a Handoff answers a `DelegationId`. So the
same Zord may be given two Slices, each with its own resolved Harness — which is how one Slice runs at
a higher Effort than another, and refusing the repeat would make that unexpressible. Whether the
runtime reuses a process or births a second Zord is behind `AgentRunner` and is not a Mission rule.

A reused `DelegationId` is refused, because two different facts under one id cannot be folded
deterministically.

### Role does not constrain a Delegation, and that is not a Gap in this PRD

`Role` is a glossary term with no type in `engine/`: there is no Zord aggregate and no Roster in the
domain, so a Mission has no way to know the Role of the `ZordId` it is handed. A `role` field on
`Delegate` that nothing validates against would be exactly the always-zero field this file warns
about. Role-based permission needs a Zord registry, which is a later PRD — not a later task.

### A reviewer probe that is not typechecked proves nothing

Vitest does not typecheck. A throwaway probe written to audit a delivery can therefore pass a field
the type does not declare — it is an excess property, silently dropped at runtime — and then "fail"
for a reason that has nothing to do with the code under review. This happened three times while
reviewing Task 4: calling `openMission()` with no argument when it takes fields, and passing a
`core` on a `Delegate` command that carries none, which made a real and working capability check
look absent.

So a reviewer probe is only evidence once `npx tsc --noEmit` is clean **with the probe still in the
tree**. Delete it after, not before. And when a probe contradicts a Handoff, suspect the probe first:
the executor ran the real suite, the reviewer just wrote fresh code.

### The Contract lives on the Delegation, and that is a rule about time

A Handoff is judged against the Contract that was in force **when the Delegation was made**, so the
Contract is recorded in the `Delegated` fact and copied onto the `Delegation`. The two alternatives both
break the same way, in opposite directions: on the **Mission**, a Clause added after a Delegation was
made would reach back and fail a Zord that never saw it, and one Mission would hold one standard for
every Slice; on the **Handoff**, the party being judged would choose the standard it is judged by. This
is the Task 4 rule ("a fact carries the resolved value, never the recipe for it") applied to an
agreement instead of a bundle — and it is why `evolve` records the accepted Handoff without re-running
`validateHandoff`. A fold that re-judges is not a fold: tighten the rule next month and the same log
would tell a different story.

### Absence is the settlement, and a Gap must name its Clause

Two shapes that came out of Task 6, both of them "do not add a field a rule cannot fill":

- A `Delegation` carries an **optional `handoff`**, present exactly when one was accepted. A
  discriminated union of `OpenDelegation | AnsweredDelegation` was rejected because the only honest
  discriminant is the `status` field Task 4 refused to carry; a pair of optionals (`handoff` plus
  `settledAt`) was rejected because half of it can be present and mean nothing. The Instant lives on
  the Event; the state keeps what a rule reads.
- A `Gap` carries a **required `clauseId`**. A Gap with no Clause attached would excuse every optional
  Clause in the Contract at once — one "ran out of time" and the whole optional half of the agreement
  passes — so the declaration would carry no information at all. Required at the type level, which
  makes "a Gap about nothing" unrepresentable rather than merely refused.

And the reverse of the excuse rule, which is the promise itself: a Gap on a **required** Clause is
worth nothing. Declaring that you did not do the job does not make the job done, and a model where a
Gap excused anything would let every Handoff pass by declaring everything.

### A Refusal is a return value, so a refused attempt is not in the log

`Decision` says `refused` carries a Refusal and no Events, and criterion 3 requires the Refusal to *be*
the return value of `decide` — that is precisely what makes "no human involved" a property of the shape.
So a refused Handoff produces no fact, and it settles nothing: the Delegation stays open and the Zord
resubmits. Closing it on a Refusal would make automatic refusal **more** expensive than a human review,
because the only recovery would be a new Delegation under a new id.

The glossary says a Replay includes what was refused, and that is **not** delivered by Task 6 and is
not half-built either. Recording a `handoff-refused` Event that `evolve` ignores and nothing projects
is the same lie as an always-zero `spent`. Task 9 owns `replay.ts` and is the first reader such a fact
would have; two additive shapes are open to it — let the `refused` member of `Decision` carry facts as
well, or build the Replay from the sequence of Decisions rather than from the Event log.

### `decide` never throws: dereferencing a field is different from copying one

Task 3's and Task 4's Commands survive a cast-forced missing field by accident — they *copy* it onto
an Event, so `delivery: undefined` produces a useless fact instead of an exception. `submit-handoff` is
the first Command that **reads through** its required field (`command.handoff.delegationId`), so it
reads it as `unknown` first and refuses when it is not an object. The standard for the wrapper around a
throwing collaborator is different, and worth keeping straight:

- `resolvedHarnessOf` wraps `resolveHarness` because the throw is reachable from a **well-typed**
  Command (`cli: ""` satisfies `Harness`).
- `contractViolationsOf` wraps `validateHandoff` because a Contract can arrive through a cast or a
  deserialiser, which is the same threat model `assertNoExecution` and `harness()` exist for.

`decide` does **not** re-check a Contract when a Delegation is made. A Contract is a value object with
its own constructor, checked where it is built, exactly like a `Briefing`, a `Slice` or a `Money` cap.
A Harness is the one thing `decide` validates, and only because `decide` is what resolves it.

### Falsifying a probe that guards an *absence* produces no collateral, by construction

Of Task 6's twelve falsifications, eight broke something inside the source as well as reporting
`TS2578`; four reported `TS2578` alone, and in each case that is the correct signal rather than a weak
probe:

- `SubmitHandoff` carries **no** `delegationId` — nothing in the source can depend on a field that is
  not there, so adding one back breaks nothing but the probe.
- `readonly handoff` on `Delegation` and `readonly required` on `Clause` — nothing in the source
  mutates them (`evolve` builds a new object), which is the point; both probes pair the type claim with
  a runtime `Object.freeze` assertion, and the freeze is what actually stops a write.
- `Clause.required` being non-optional — `clause()` reads it as `unknown` and refuses a non-boolean at
  runtime, so widening the type moves the enforcement rather than removing it. The runtime half has its
  own test.

So the rule from Task 5 stands, with a rider: no collateral damage is worth a second look, and the
answer is either "the guarantee is the absence of something" or "the runtime half is carrying the load,
and it is tested".

### The Cap is reached at equality, and reaching it is not the same as crossing it

`hasReachedCap` is `spent >= cap`, in `meter.ts`, and it is the only place the boundary exists. The
glossary word is **reached**, not exceeded: a Cap of R$ 50,00 with R$ 50,00 spent has nothing left in
it. Read as `>`, the product would have to *breach* the limit before keeping its promise, so every
Mission would overspend by at least one cent and the number a human typed would be one cent below the
real limit.

Two consequences that are not obvious until the comparison is written down:

- A Cap of **zero** is reached by a Mission that has spent nothing. That is coherent rather than
  awkward — a Mission with no money commissions no work — and it is why the Cap guard consults the
  Meter and not only the halt: a Mission can be *running* and stopped by its Cap, which also happens
  the moment Task 8 approves a Gate on a Mission that spent past its Cap while halted.
- The same comparison decides an authorisation: a new Cap at or below `spent` is already reached, so
  authorising it authorises nothing and is refused `cap-reached`.

### An accrual is a report of the past, so it is recorded and then halts

The accrual that crosses the Cap is **accepted**, and the halt is the second Event of the same
Decision — `Decision`'s accepted member carries a list for exactly this. The money was gone before the
domain heard about it: refusing the report would not un-spend it, it would only make the Meter
understate what the Mission cost, and since the Cap is compared against that total, an understated
total means a Mission that stops late or never.

Corollary, and the one exception to "every subsequent Command is refused": `accrue-cost` is still
accepted on a Mission halted at its Cap, because a Zord that was mid-run when the Cap was reached —
which is how a Cap gets reached — keeps reporting. It is refused only once the Mission is **terminal**,
where no Zord is left running and recording would change what a closed Mission cost. `evolve` folds it
on `halted` for the same reason, and produces **no second halt**: `evolve` keeps the first halt, so a
second `MissionHalted` would be a fact that folds to nothing.

### `cap-reached` is a state's reason, not a Command's

Task 7 changed the *reason* three Commands are refused with on a Mission stopped at its Cap —
`delegate`, `submit-handoff` and `deliver-mission` now say `cap-reached` where Task 3 said
`illegal-transition`. Same rule as `unrunnable-harness`: a wrong reason on a Refusal is worse than a
right one, and here the right one was already in the union with no user, like `missing-capability`
before Task 4. The violation names the Cap **and** the remedy ("until its Cap is authorised"), which
`illegal-transition` cannot.

Two Commands deliberately keep the more specific answer, and this is the line: `cap-reached` is right
only when the Cap is what stands in the way. `open-mission` is refused because the Mission is already
open, whatever it spent; `decide-gate` is refused because **no Gate is open** — a Cap halt carries no
GateId — and answering "the Cap" would send a human to the wrong remedy. So `decideDecideGate` was not
touched at all, which also left Task 8's `unmodelled` call byte-identical.

The one place all of this is decided is `stoppedAtCap` plus `stateBlock` in `mission.ts`: what the Cap
blocks and what an authorisation unblocks read the same predicate, so they cannot drift apart. A
`state.status !== "running" || stoppedAtCap(state)` written **inline** still narrows to
`RunningMission` in the fall-through; the same condition read off a `const` does not — the aliasing
trap this file already records for `in`.

### Authorising raises the Cap; permission to continue would be a loop

Task 3 left `halted` with no exit, and this is the Cap's: `authorise-cap` carries a **new, absolute
Cap**, strictly above what was already spent. Resuming at the same Cap would resume a Mission whose
limit is still reached, so the next commissioning Command would be refused again and nothing would
have changed — "the Mission stops and asks for authorisation" would be a loop instead of a question.
What the human answers is not "carry on?" but "how much more?".

Absolute rather than an increment: an increment has to be added to a `spent` the authoriser read a
minute ago, so two authorisations on a stale reading produce a Cap nobody chose, and "+R$ 30" needs a
second fact to be legible in a Replay. It touches `spent` only by leaving it alone — the money is gone,
and `money.ts` still has no subtraction for anyone to reach for.

It is also **not** a Cap editor: on a Mission the Cap is not stopping, it is refused
`illegal-transition`. Revising a budget mid-flight is a different act with rules this PRD does not
model (who may lower it, what happens to work already commissioned). And a Mission halted at a **Gate**
refuses it too, in `decide` *and* in `evolve` — a Gate is answered by a Gate decision, and a
hand-written log must not be able to walk a Mission past a Gate by raising its Cap.

### Per Pane means per Delegation, and the finer grain keeps the coarser

There is no Pane type and Task 7 did not invent one. A Pane is one terminal with one Zord inside; the
thing the domain can name is the Delegation that Zord is running, so `spent` lives on the Delegation.
A per-Zord reading is the sum of its Delegations, while the reverse cannot be recovered — one Zord may
hold two Slices — so the finer grain is the only one that loses nothing. A parallel map on the Mission
keyed by DelegationId was rejected: it can hold an id the Mission never delegated.

The Mission carries a `spent` **as well**, which looks like the same number twice and is deliberate:
the Cap comparison must never throw, and summing a list of `Money` on every read would put
`addMoney`'s overflow throw inside `decide`. Both copies are written by one rule from one fact, and
`meter.test.ts` pins that the total equals the sum of the Panes.

### A fact carries what happened; the totals belong to the fold

`CostAccrued` carries `cost` and **not** the running totals. That is not the opposite of "a fact
carries the resolved value, never the recipe": `cost` comes from **outside** the aggregate, so it is on
the fact, while a total is computed from the facts themselves, so it is the fold's answer. Recording
totals too would put the same number in two places and let a hand-written log claim a total its own
accruals do not add up to.

### Computing with a field is a third threat level, above dereferencing it

The engine now has three grades of cast-tolerance, and they need different code:

- Task 3 and Task 4 **copy** a required field onto an Event — a missing one produces a useless fact.
- Task 6 **dereferences** one (`command.handoff.delegationId`) — a missing one throws, so it reads it
  as `unknown` first.
- Task 7 **computes** with one — `addMoney(spent, cost)` on a `cost` that is `undefined`, a string or a
  float throws inside `money.ts`. So `amountOf` in `meter.ts` wraps `moneyFromCents` and answers
  `undefined`, and both callers do the truthful thing with it: `decide` refuses, `evolve` ignores.

`decide` and `evolve` must agree about what they will not record, or a fold stops equalling the
sequence of Decisions that produced it. The overflow case is the live example: `decide` refuses it
`cap-reached` (a total past the exactly-representable range is beyond any Cap), `evolve` returns the
state untouched.

### No identity model, so no authoriser on the fact

`CapAuthorised` records the new Cap and not who authorised it. Nothing in `engine/` names a person —
the Core is a capability set — so an `authorisedBy` would be a claim no rule could check, which is the
always-zero field again. It is a **declared Gap**, not a shape: a Gate decision (Task 8) faces exactly
the same question and should answer it the same way, or the two will drift. Whoever adds an actor model
adds both.

The Meter's other two Gaps are the same kind and are recorded at the top of `meter.ts`: the glossary
says the Meter accounts **tokens** and cost, per Pane, per Mission and per **Combination**, and neither
tokens nor Combination has a source in this PRD — the `AgentRunner` port reports a cost and nothing
else, and there is no Combination aggregate.

### A `?: never` on a discriminated union is not the exclusion it looks like

Recorded above, from Task 3: "the exclusion has to be written down — `gateId?: never` on the member that
must not carry one". **Falsified in Task 8 and it is wrong.** Delete `gateId?: never` from `Halt` and
`{ reason: "cap-reached", gateId }` *still* fails to compile; the same holds for `reason?: never` on
`GateDecision`'s `approved`. Excess-property checking accepts a property any member declares only when the
union has no discriminant — where the members are discriminated, TypeScript narrows to the member the
discriminant selects and checks the excess property against **that member alone**.

So the guarantee is **the member not declaring the field**, and it is falsified by widening the member
(`reason?: never` → `reason?: string`; `gateId?: never` → `gateId?: GateId`), which is what makes both probes
report `TS2578`. Deleting the `?: never` instead produces either nothing at all (`GateDecision`) or
unrelated collateral (`Halt`, because two tests read `halt.gateId` off the un-narrowed union).

Both `?: never` members are kept, for the one thing they do buy: the field can be *read* off the un-narrowed
union and is `undefined` on the member that has none, instead of being a compile error at every reading site.
That is a convenience, not an invariant, and the comment on each now says so.

The general lesson is the one this file already teaches about probes, applied to a falsification: **a
falsification that reports nothing has not proven the guarantee absent — it has proven you broke the wrong
thing.** Find what actually carries the load before concluding either way.

### A Command that is only reachable from a hand-written log is not delivered

Nothing produced a `gate-open` halt before Task 8: Task 3's tests folded the fact by hand. Leaving it that
way was the tempting minimum — the Gate rules would all be *testable* — and it fails a criterion nobody
would notice until Task 9: an accept path no sequence of Commands can reach is not reachable by a Surface
either, so criterion 6 would have been proven only against a state the engine cannot arrive at, and the
end-to-end run of criterion 13 could not contain a Gate at all.

So `raise-gate` exists, and the rule for deciding that is worth keeping: **the domain does not have to know
*when* something is due in order to own *what it does*.** A Gate is declared by a Combination and there is no
Combination aggregate, exactly as a cost comes from a runtime and there is no price list — in both cases the
intent arrives as a Command and the domain owns the consequence. What that rules out is the opposite move:
an Event with no producer, which is the same lie as an always-zero field.

### Kill is not a Gate decision, and that is what gave the Cap halt an exit

The PRD lists three human answers at a Gate — approve, revise, kill — and only the first two answer the
Gate's *question*. Killing is a decision about the **Mission**, so it is `kill-mission`, accepted while a
Mission is running or halted, whichever halt stopped it. Routed through `decide-gate` it would have broken in
two directions at once: a Mission running away, delegating and spending, could not be stopped, and a Mission
halted at its **Cap** could never be ended — Task 7 left that halt exactly one exit, authorise more money, so
a human who did not want to spend more had nothing to say.

Two consequences worth not rediscovering:

- **A kill leaves the open Gate open.** Nobody answered it. Marking it decided would put an answer on the
  record that no human gave, and a Replay would show a checkpoint passed instead of a Mission abandoned at
  it.
- **`accrue-cost` and `kill-mission` are the two Commands a Mission stopped at its Cap still accepts**, for
  opposite reasons: the accrual because the money is already gone and refusing the report would only make the
  Meter understate what the Mission cost, the kill because ending a Mission spends nothing. Neither
  commissions work, which is the line `stoppedAtCap` draws — and it is why the Cap is not consulted by either.

### The same answer to the authorship question, in three places now

`CapAuthorised` records no authoriser (Task 7). `GateDecided` records no decider and `MissionKilled` records
no killer (Task 8), for the identical reason and deliberately not for a different one: nothing in `engine/`
names a human — the Core is a capability set, a Zord is an id with a Harness — so an author would be a claim
no rule could check. All three are **one** declared Gap with three sites, and each has a `@ts-expect-error`
probe pinning the absence, so whoever adds an actor model deletes the directives in one change instead of
finding two of the three.

The rule generalises: when a second and third fact meet a question an earlier task already answered, answer
it the same way or explain why it differs. Two facts about the same missing concept, answered differently, is
drift that nobody will notice until both are load-bearing.

### Openness is the absence of an answer — for the third time

`Delegation.handoff` (Task 6), and now `Gate.decision`: optional, present exactly when something answered.
The alternatives were rejected for the reasons already recorded, and the key-set assertion is what keeps them
rejected — `gate.test.ts` pins `["id", "question", "raisedAt"]`, so adding a `status` or a `decidedAt` fails.

The pattern is now stable enough to state as a default: **a thing that waits for an answer carries the answer
optionally and nothing else.** No `status` whose only value is the one it starts with, no Instant beside the
answer that can be present while the answer is absent.

### Two readings of one truth must be made to agree in `decide`, not chosen between

A Gate is open in two places: the halt (`halt.reason === "gate-open"` with its GateId) and the undecided
entry in the Mission's `gates`. Task 7's precedent said pick the fact — "the halt is the fact, not the
arithmetic" — and following it blindly produced a real bug, caught reviewing the delivery rather than by a
test: on a state where the halt names a Gate the Mission never raised, `decide` accepted the answer and
`evolve` then ignored it, because there was no record to annotate. A Decision the fold drops on the floor
breaks the one property this whole design exists for.

The resolution is not to elect an authority but to **require the two to agree**, in `decide`: the halt must
say gate-open, the id must match, *and* the Mission must hold that Gate open. That makes the record
load-bearing instead of decorative, and it is a checklist item for any future field that duplicates a
reading — `spent` on the Mission and on its Delegations is the other one, and it is safe only because one
rule writes both from one fact.

The general form, which is worth checking on every new Command: **enumerate what `evolve` ignores, and make
`decide` refuse exactly that set.** Both directions are bugs — accepting what the fold drops, and refusing
what the fold would have applied.

### Guarding a field in the fold depends on what the fold does with it

`applyGateRaised` refuses a blank question and `applyKilled` copies a blank reason, and the difference is
deliberate. `CLAUDE.md` already records three grades of cast-tolerance by what the rule *does* with the
value (copy, dereference, compute); this adds a fourth axis, what the **state** does with it:

- `applyGateRaised` **appends to a list that is read afterwards** — `openGateIn` and `revisionsIn` are
  readings a Surface renders, and a Gate that asks nothing would sit in them forever, because the Mission
  stays halted until somebody answers a question nobody can read.
- `applyKilled` **writes a terminal field**. A killed Mission with a blank reason is poorer history, and it
  is still complete: ignoring the fact instead would leave a Mission running that a log says ended, which is
  worse than a missing sentence.

`decide` refuses both, so neither is reachable except from a hand-written log.

### A test helper's default parameter can swallow the case under test

Three of the four failures in Task 8's first green run came from one mistake: `deciding(decision = { kind:
"approved" })` and `gateDecided(decision = { kind: "approved" })`, called as `deciding(undefined as unknown as
GateDecision)` to prove that a decision forced past the compiler is refused. A default parameter fires on
`undefined`, so the test built a **perfectly valid approval** and then asserted a Refusal. It failed loudly
here; the dangerous version is the one that passes.

So: **a probe about a missing or malformed field is written out inline, never through a fixture with
defaults.** The fourth failure was the same class of self-inflicted honesty check in the other direction —
`expect(rejected).toThrow(TypeError)` on `state.gates.push(...)`, which does not throw, because no list on a
Mission is frozen (`delegations` is not either). The frozen things are the readings handed *out*: `meterOf`,
`harness()`, `handoff()`, `gap()`.

### Two identity checks in a test need the same object

`expect(evolve(running(), fact)).toBe(running())` can never pass: `running()` builds a fresh Mission on every
call, and `toBe` is `Object.is`. Hold it in a `const` first. Vitest's message for this is
`serializes to the same string` with `Compared values have no visual difference`, which reads like a
serialisation quirk and is in fact the assertion being wrong.

### The Replay is the sequence of Decisions, and that is how a Refusal became auditable

Tasks 6 and 8 handed Task 9 one open question — criterion 7 names **refusal** among what the Replay must
contain, and a refused Decision emits no Event — with two admissible shapes. Task 9 took the second:
`Replay = readonly ReplayEntry[]`, one Command and one Decision per entry, in `replay.ts`. `Decision`,
`evolve` and the Event union are all untouched, and `stateOf(replay)` is literally
`replay(eventsOf(replay))`, so the fold is still the only source of truth for state.

The shape that was rejected — widen `refused` to carry facts — fails for a reason that is structural and
not a matter of taste, and it is worth keeping because it settles the question permanently: **a refusal is
not always attributable to a Mission.** Every `MissionEvent` carries a `missionId`, and
`decide(UNOPENED_MISSION, command)` refuses before any Mission exists — that is one of criterion 12's own
illegal transitions. A fact about a Mission that does not exist cannot be written, so that shape could
only ever have held *some* refusals. Two more reasons behind it: the fact would have to be folded into the
state to avoid being the Event-nobody-folds lie, which puts history inside the state that event sourcing
exists to keep out of it; and criterion 3 rests on `refused` carrying a Refusal and nothing else.

The general form, and it is new: **when the audit surface and the state disagree about what counts as
history, add a reader, not a fact.** The log answers "where is this Mission"; the Replay answers "how did
it get here", and it is allowed to know things the state does not.

**This decision passes the three-part ADR test** — hard to reverse (every reader of the audit surface
changes with it), surprising without context (the glossary said "event sequence", and it is not one), and a
real trade-off between two shapes that were both admissible. `docs/adr/` is Task 10's scope, so Task 9 did
not write it: the argument lives in full at the head of `replay.ts`, and Task 10 should add it to the four
ADRs the techspec lists rather than discover it. The glossary definition of **Replay** was rewritten in the
same breath, because "auditable event sequence *including what was refused*" cannot be true of any shape:
a Refusal is not an Event.

### A reading is derived, so its wording never enters the record

A `Step` is a `ReplayEntry` plus an `ordinal` and a `summary`, and both are added by `stepsOf` at read
time. Writing the sentence into the Replay would freeze today's wording into the record and put a second
copy of what the Command and the Decision already say — `meterOf` deriving `reached` is the same call, made
first. Two corollaries followed:

- **Totals are the Meter's, per-step cost is the Replay's.** `eventsIn(steps, "cost-accrued")` reports what
  each Step cost and nothing sums it, because `meterOf` already answers the totals from the state.
- **The projection is pinned by what the product already promises**, not by what an auditor might want:
  `lib/surfaces.ts:641` and `docs/PRODUTO.md:99` name which Zord ran with which Harness, what each
  delivered, what was refused and why, where a human approved, and what each step cost. That is the whole
  list, and it is why the reading is four functions and not a schema.

### A glossary collision in an exported name is resolved by renaming, not by an exemption

The techspec pins `project(events)`; the delivered name is `stepsOf`. `project` is an `_Avoid_` term under
**Workspace**, and Task 10's check scans exported domain symbol names in `engine/domain/` — the exact
category. Keeping it would have meant shipping a required exemption for a name that has a cheap
replacement, and the PRD's own precedent is the opposite: the module was going to be `core/` and became
`engine/` so `Core` stays the orchestrator. `stepsOf` also reads like the four readings beside it —
`eventsOf`, `stateOf`, `eventsIn`, `refusedIn`.

Two live hits Task 10 will meet in this task's files, both of them correct code and both deliberate:

- **`AgentRunner`, `AgentRun`, `AgentReport`, `fakeAgentRunner`** — `agent` is `_Avoid_` under **Zord**.
  These live in `engine/ports/` and `engine/adapters/`, outside the `engine/domain/` the symbol scan is
  scoped to, and `AgentRunner` is the name the techspec pins. A Zord is what the domain calls the thing on
  the far side of the port; the port is named after the boundary.
- **`instruction`** on `AgentRun` — `_Avoid_` under **Skill**, and the field name the techspec pins. It is
  the text a runner is handed, not an installable instruction block.

Prose in `engine/` is a third case and it is already out of scope by the rule recorded above: `replay.ts`
says **log** (of Events), **audit** and **history** freely, and the glossary's own definition of a Replay
says "auditable". A scan that reads comments would fail on the file that implements the concept.

### Not every type-level proof can be written as `@ts-expect-error`

`eventsIn(steps, "delegated")` must answer `readonly Delegated[]` and not `readonly MissionEvent[]`, and
**no probe can express that**: reading a field off either one fails — off the narrow type because the field
is absent, off the union because it is absent from *some* member — so widening the return type left the
directive used and reported no `TS2578`. What distinguishes the two is **assignability**, so the proof is a
positive annotation (`const made: readonly Delegated[] = eventsIn(…)`), and its falsification is 18 `tsc`
errors starting with `TS2322`, not a `TS2578`.

That is a third answer to the rule this file already carries about probes with no collateral damage. The
full set: a probe that reports `TS2578` **with** collateral is load-bearing; one **without** it either
guards an absence or has a runtime half carrying the load; and a guarantee no probe can phrase is written
as an annotation whose falsification **fails the build**. All three are evidence — what is never evidence
is a falsification that changes nothing, which only proves you broke the wrong thing.

Falsification tally for this task: 11 probes, 10 reported `TS2578` (4 with collateral inside the source:
`Replay`'s `readonly` broke `submit` and `EMPTY_REPLAY`; `AgentRun.harness` optional produced `TS18048`
inside the fake; widening it to accept sources produced `TS2339`; `cost: number` broke the e2e's script),
and the eleventh is the annotation above.

### A fake is scripted in order, because the loop worth testing asks the same thing twice

`fakeAgentRunner(script)` answers one entry per call, in order. Keyed by instruction — the tempting
"deterministic" choice — it could not answer the same question two different ways, and that is exactly
criterion 3's loop: a Handoff is refused, the Zord is told what it broke, and it submits again. Being asked
more times than scripted **fails** (`UnscriptedRunError`), rather than repeating the last answer, because a
test that runs one more Zord than it meant to should hear about it at the call.

It fails as a **rejected Promise**, not a synchronous throw: `run` returns a Promise by Contract, and a fake
that threw where no real runner would lets a Surface get away with not handling rejection. And it forms no
opinions — it does not read the instruction, check the Harness or price the run — because judging a Harness
is `harness()`, judging a delivery is `validateHandoff`, and a fake with rules of its own is a second rule
set the tests would start passing because of.

### "No network, no CLI" is provable structurally, not only by stubbing

`mission.e2e.test.ts` poisons `Date.now`, `Date.parse`, `Math.random` **and** `fetch` around the whole
drive, and then does the thing that cannot be worked around: it reads every non-test file under `engine/`
and asserts every `from "…"` specifier is a relative path. No dependency, no `node:child_process`, no
`node:fs`, nothing to reach the network *with*. A stub proves the run did not call the one function you
stubbed; the import check proves there was nothing else to call.

The same file imports **only** from `@engine/index`, which is deliberate: it stands in for the first
Surface, so it is held to a Surface's boundary and it proves the public surface is enough to *run* a Mission
rather than merely to inspect one. `engine/index.ts` had no test before this.

### The loop that drives a Mission is a Surface's, and `submit` is the part that is not

`submit(replay, command)` decides against `stateOf(replay)` and appends the entry — it lives in the engine
because a Surface that recorded only what it accepted would lose every Refusal, which is the half of the
Replay a human most needs, and the PRD opens with exactly that drift. What stays outside is everything that
reads a runner's answer and turns text into a Handoff: judging what a Zord *wrote* is not a Mission rule.

`submit` re-folds the state on every call instead of carrying it. That is the mandate, not an oversight — a
stored state would be a second copy of a truth the log already holds, and a hand-written Replay could then
carry a state its own facts do not fold to. When tens of entries per Mission stops being the size, the
answer is a Surface that keeps `stateOf` beside its Replay, never a Replay that remembers.

### A Refusal carries a list, so pinning one violation is wrong twice

Two of the three failures in this task's first green run were the same mistake: a Handoff with
`satisfies: []` and a Gap on the required Clause breaks the Contract **twice** — the required Clause the Gap
does not excuse, *and* the optional Clause it said nothing at all about. Expecting one violation failed
loudly; the dangerous version is a test that asserts `violations[0]` and never notices the second. Assert
the whole list.

### The authorship Gap now has four sites

`CapAuthorised` (Task 7), `GateDecided` and `MissionKilled` (Task 8), and now a `Step`, which says what was
decided and not who decided it. `docs/PRODUTO.md` promises "quem decidiu o quê" and the domain answers it
only as far as it can name anybody: the Core delegates, a Zord answers, a human decides a Gate. Whoever adds
an actor model adds it to all four in one change.

### Finding: `evolve` does not check that an Event belongs to its Mission

`replay(events)` deliberately does **not** filter by `missionId`, because `evolve` does not either and a
filter would make `replay(events)` disagree with `events.reduce(evolve, …)` — the one equality the function
exists to have. A log that mixes two Missions therefore folds nonsense, quietly. Recorded as a finding of
Task 9 with a test pinning the current behaviour, not fixed from inside a task whose scope is the Replay:
the fix belongs in `evolve`, and it is a rule change (which Events a Mission accepts) that deserves its own
decision.

### The adherence check scans names and prose, and nothing else

Built in Task 10 as `tools/glossary-check.ts`, a library of pure functions plus four readers, so a fixture
can plant a violation instead of the test only ever asserting that the tree is clean. What it reads:

- `domainSources()` — `engine/domain/*.ts` **without** the tests, scanned for **exported declaration
  names**. A test exports nothing that claims to be a concept, and `engine/ports` and `engine/adapters`
  are out by decision, which is the whole reason the scope is written that way: `AgentRunner`, `AgentRun`,
  `AgentReport`, `fakeAgentRunner` and `AgentRun.instruction` are all techspec-pinned names of a
  **boundary**. The test pins both halves — the word is live if you hand the port's text to the scan, and
  the reader does not hand it over.
- `prdDocuments()` and `adrDocuments()` — prose, with fenced blocks, inline code spans and link targets
  removed. `docs/adr/` is beyond criterion 8 and included anyway: an ADR is where a decision about the
  domain is written down. **`qa.md`, `bugs.md` and `review.md` are scanned too**, so the flow's own later
  documents must use the glossary's words or add an exemption.
- `CONTEXT.md` is read and never scanned — every `_Avoid_` line is a hit by construction — and
  `docs/PRODUTO.md` stays out because SDD is forward-only.

Matching is by **word and its inflections**, never substring and never stem — see "Grow the avoided word
forwards" below. `Catalog` contains `log`; `catalogDefault` is not
the avoided `defaults`; `validateHandoff` contains no `validation`. An identifier is split on case and
punctuation, and a multi-word entry (`lead agent`, `agent list`) matches only as consecutive words. One
mechanic worth keeping: **an entry the glossary wrote in capitals matches case-sensitively.** `TODO` is
avoided under **Gap** as the code marker, and `tasks.md` writes `- **Status**: todo` on every task — a
case-insensitive scan fails the task list for having statuses.

### Reword when the prose names a concept; exempt only ordinary vocabulary

The prose scan found nine real hits on its first run over `docs/prd/`, and the split between the two
answers is the rule. **Reworded**, because the line was naming a domain concept with an avoided word:
`Clause` defined as "one **obligation** of a Contract" (→ "one thing a Contract asks for"), the Replay
called "the **audit** surface" three times (→ "the Replay itself is a reader"), "**agent** execution enters
through the edges" (→ "Zord execution"), "a real **debt**, tracked" (→ "real and tracked"). **Exempted**,
because ordinary English, a TypeScript keyword or the vocabulary the flow uses about itself: 33 entries in
`PROSE_EXEMPTIONS`, each carrying its reason as a string.

Three properties make that table honest, and all three are tests:

- **Every entry names a word `CONTEXT.md` really avoids.** An exemption for a word the glossary does not
  list is fiction that outlives the sentence it was written for.
- **Every entry is excused by the mechanism.** The test scans a carrier sentence with the table and with
  `[]`, and asserts the word fires without it and not with it.
- **Every entry carries a real line of `docs/prd/` or `docs/adr/`.** Measured with the table replaced by
  `[]` over `prdDocuments()` and `adrDocuments()`. An exemption that excuses nothing gets deleted, not
  kept "just in case".

The second and third are not the same claim, and mistaking one for the other was BUG-2 — see
"A test that writes its own carrier measures the mechanism, not the tree".

The twelve ordinary-vocabulary words this file recorded were not the whole list: 30 distinct avoided words
were actually hit, among them `cast` (a type assertion, not a Roster), `memory` ("state lives in memory" is
RAM), `limit` (the glossary defines the **Cap** itself as "the spending limit of a Mission"), `agreement`
(a candidate context, and a heading of `CONTEXT.md`) and `rejection` (the compiler rejecting code). Of the
129 avoided words the glossary now lists, **93 stay live** in prose — `squad`, `subtask`, `worker`,
`maestro`, `dispatch` and `agent` among them.

### `any` and `@ts-expect-error` cannot be grepped for

Criterion 10's check (in `tools/prd-structure.test.ts`) blanks comments, string literals and
regular-expression literals first, via `codeOf`. Both reasons are load-bearing:

- **Every mention of `any` in `engine/` is prose** — 29 of them at the time of the review — "the `any[]`
  that `Array.isArray` narrows an `unknown` to", "beyond any Cap a Mission could have been opened with". A
  raw scan fails on all 29 correct lines and gets switched off the same afternoon.
- **A doc comment that mentions `@ts-expect-error` is not a directive.** TypeScript honours it only when
  the directive **opens** the comment, so `` `TS2578: Unused '@ts-expect-error' directive` `` mid-sentence
  is not a suppression — nine of those exist in `engine/`, and the regex mirrors what the compiler
  honours rather than what a grep finds.

What counts as stray: `@ts-expect-error` outside a `*.test.ts` (where it would hide an error from
`npm run build`, which is what enforces every guarantee here), a directive whose reason is under ten
characters (the 75 real probes all carry a sentence; the shortest is 47 characters), and `@ts-ignore` or
`@ts-nocheck` anywhere — `@ts-ignore` is `@ts-expect-error` with the proof removed, since it never starts
failing when the error goes away.

### A check that only passes proves nothing: five plants, five reds

Task 10's evidence, and the pattern to repeat. Each was planted in the real tree, run, and reverted:
`export type Squad` in `engine/domain/ids.ts` → `squad` under **Combination**; "The squad hands a subtask to
a worker." appended to `prd.md` → three violations; `const plantedLoose: any = 1;` → the `any` scan;
`// @ts-expect-error` with nothing after it in a test → the stray scan; `mv` of `techspec.md` → criterion 9.
Fixture-only assertions are not the same evidence: they prove the function works, not that it is pointed at
the tree.

### `Halt` was the term the engine had and the glossary did not

Criterion 11 checked by comparing exported domain type names against `CONTEXT.md`: everything matched
except `Halt`, which `mission.ts` has carried since Task 7 (`cap-reached` or `gate-open`, with the GateId
when there is one). Added, with its spoken form `parada`.

`Money` and `Instant` stay **out** on purpose: the glossary's own rule is that a term belongs there only if
it is specific to this domain, and a branded amount and a branded timestamp are general programming
concepts. What is domain-specific about them is a decision, and that lives in ADR 0004.

### Grow the avoided word forwards; a stemmer cuts it back. Only one of the two is safe

**Supersedes the earlier rule on this page** — "live with the hole, and add the inflected form to the
`_Avoid_` list" — which BUG-1 is the evidence against. Task 10 found the hole by planting `dispatches`
into `prd.md` and watching nothing happen, and then never swept the documents for forms already in them:
`real agents behave` and `designed for auditing needs` had been sitting in `prd.md` since it was written.
A remedy that records only the forms someone has already tripped over leaves the sweep manual, so the
next plural waits for the next QA.

The matcher now expands each avoided word into its inflections (`inflectionsOf` in
`tools/glossary-check.ts`), and the reason this is not the stem-based scan this file rules out is
mechanical, not a matter of degree:

- **A stemmer cuts a word back** to a root that unrelated words share. That is what makes `validation`
  reach `validateHandoff` and `log` reach `Catalog` — and a check that fails on correct code is a check
  switched off in its second week.
- **Inflection grows the word forwards.** Every form it produces still carries the avoided word:
  `log`, `logs`, `loged`, `loging` — none of them is `Catalog`. It can add a false positive only for a
  real inflection of a word the glossary really avoids, which is exactly the thing being looked for.

The set is closed and deliberately small: plural, past, present participle, with the two orthographic
rules English forces (`interface` → `interfacing`, not `interfaceing`; `history` → `histories`, not
`historys`). No irregular plurals, no doubled consonants (`logging`), no `-al`/`-ly` derivations —
`historical` is a different word, and reaching for it is stemming again. Only the last word of a
multi-word entry bends: `lead agents`, never `leads agent`.

Two consequences worth knowing before touching it:

- **A form the closed set cannot derive goes beside the set, never into `CONTEXT.md`.** The glossary is
  the team's vocabulary; the matcher's mechanics are not vocabulary, and a reader picking the language up
  does not need to be told that the plural of an avoided word is also avoided. There is no such form today
  and no empty table for one, which would be the always-zero field this file keeps warning about.
- **The name scan has no exemption table**, so widening it there was measured first: all 135 exported names
  of `engine/domain/` stay clean. `catalogDefault` still passes for the right reason — the avoided entry is
  `defaults`, and growing forwards never reaches the shorter `default`. **That measurement was not enough,
  and BUG-3 is why**: names that exist cannot show a false positive on a name nobody has written yet. What
  the widening actually broke was the comparison *beside* it — see "Widen one side of a comparison and you
  have written a bug".

What inflection changed on the day it landed: `interface` and `block` stopped being dead exemptions,
because their only carriers were `interfaces` (techspec) and `blocks` (PRD and tasks); `directive` had to
be **added**, because `qa.md` says "75 `directives`" about `@ts-expect-error` and a bugfix does not reword
QA's document; and `output` was deleted, having no carrier in any form.

### Widen one side of a comparison and you have written a bug: BUG-3

Inflection landed on the **avoided** side of both scans and not on the **term** side of the name scan, which
compared exact spellings. `delivery` is the glossary's only word that is both a defined term and an
`_Avoid_` entry (under **Handoff**), so `export type Delivery` passed and `export type Deliveries` was
reported — with nowhere to be excused, the name scan having no exemption table and by decision no future
one. Renaming correct code to satisfy a scan is how a scan gets switched off, which is the outcome the
whole inflection design was argued for.

The remedy is not a second widening kept in step by hand. It is **one derivation of "the same word"** —
`formsOf` in `tools/glossary-check.ts`, a phrase whose last word bends and whose earlier words do not — read
by every comparison in the module: the avoided side via `runOf` and `proseMatcher`, the term side via
`termForms`. Whatever grows there grows on both sides at once. Two mechanics worth not rediscovering:

- **Two derivations of one notion will drift, and the drift is silent.** It was latent for a whole QA round:
  135 names passed, so nothing failed and nothing said anything. A test that loops over `formsOf` and
  asserts the matcher agrees is cheap; **give it a vacuity guard** (`checked > entries`), or narrowing
  `formsOf` back to the bare word makes the loop pass by examining nothing.
- **`formsOf` lowercases and `proseMatcher` does not**, deliberately: prose means the capitals the glossary
  wrote (`TODO` the marker, `PRs` and not `PRS`), while `TODO_MARKER` and `todoMarker` are the same name. The
  forms are the same forms; only the stem's capitals differ, and the test reconstructs them rather than
  pretending the two agree letter for letter.

### The glossary's own words win, and the tie is broken once, not per scan

The collision `delivery` creates cannot be resolved by matching harder — both readings are in `CONTEXT.md`,
and no scan can tell which concept `Deliveries` means. `enforceable(glossary)` answers it once, for **both**
scans: an `_Avoid_` entry that is itself a defined term is not enforced at all. Three reasons, all pointing
the same way: a word the glossary *defines* is correct code by construction; the prose scan had always read
it that way, so this is the two scans agreeing rather than a new licence; and an `_Avoid_` entry rules a
word out for **one other** concept while a term heading names a concept, so the more specific statement
wins.

Consequences to know before touching it:

- **It is a derivation, not a list.** Nothing is named in the module: the subtraction is computed from
  `CONTEXT.md` on every run, so adding or removing a term moves it with no edit. That is what makes it not
  the exemption table the name scan refuses to grow. The cost is stated and real — `delivery` can no longer
  be enforced as a name for a Handoff, and whoever wants that back resolves the collision **in the
  glossary**, which is where a collision between two glossary readings belongs.
- **An exemption that is dead today is still kept when its mechanism is the next false positive.** "A name
  that is itself a term is never a violation" excused exactly one of the 39 terms, `Delivery`, and
  `enforceable` now excuses that word earlier. It stays, widened to read `formsOf`, for the case the
  subtraction cannot express: a **multi-word** term one of whose words is avoided elsewhere (`Session Log`
  against `log`). This is not the BUG-2 rule being broken — that rule is about a **table of words nobody can
  tell is dead**; this is a structural branch whose deadness is derivable from the glossary, declared where
  it lives, and **exercised against a synthetic glossary**, because a branch nothing exercises is a branch
  that rots.
- **A scope narrowness hides behind a spelling narrowness.** The exact-join skip excused a name that *is* a
  term and nothing else, so `deliveryOf` and `DeliveryId` were reported too — no inflection involved. QA
  found the collision through the plural; the singular `DeliveryId` is the name someone writes first. When a
  comparison is asymmetric, check both axes.

### A Markdown code span is not a line, so it cannot be stripped a line at a time

QA's caveat 12, fixed rather than declared. A span opens on a run of backticks and closes on the next run of
the same length, and Markdown lets one wrap across a line break. Stripping line by line left an unmatched
tick on each line, and the stray closing tick then paired with the **next opening tick on its own line** —
so one wrapped span both **hid** the ordinary prose in between and **exposed** the following span. Four such
spans are live in `docs/prd/` today, and the hole cost QA two reproved runs on its own document. So
`proseLinesOf` finds fences line by line (a fence *is* a line) and strips spans over the kept lines joined
back together.

Two bounds are what keep a Markdown accident from blanking a document, and both are tested:

- **An unmatched run stays literal**, exactly as Markdown renders it, so a stray backtick blanks nothing and
  the words after it are still scanned. Same reasoning `codeOf` records for regular-expression literals: a
  check that silently under-reports is the failure mode to avoid.
- **A span never crosses a blank line.** A blank line ends the paragraph, so it ends any span an author left
  open; without it one stray tick swallows the rest of a document.

Blanking preserves each character's column, like `codeOf`, so a violation still points at the right place.
The practical rule for whoever writes a document here is unchanged and now cheap rather than load-bearing:
keep a code span on one line if you can.

### A test that writes its own carrier measures the mechanism, not the tree

BUG-2, and the same shape as "Falsify at the guarantee, not at the test". `is load-bearing, every entry`
built its own sentence — `` `One line that says ${exemption.word} and no more.` `` — so it passed for any
word `CONTEXT.md` avoids, whether or not a document contained it. Three of 33 exemptions excused nothing
and the test that existed to catch that could not.

The fix is not a better sentence, it is a different subject: the load-bearing claim is measured over
`prdDocuments()` and `adrDocuments()`. The mechanical check is kept, renamed to what it actually proves,
because "the table is honoured" is worth pinning too — it is just not evidence that an entry is needed.
And the new check is itself falsified by a test that derives a genuinely-uncarried avoided word from the
tree and shows the mechanical check passing for it while the real-tree check reports it dead. A check on a
check needs the same standard as the code.

Generalised, for the next reviewer probe: **when a test constructs the input it then judges, it is testing
the function; when it reads the tree, it is testing the delivery.** Both are useful and they are not
interchangeable, and a name like "is load-bearing" claiming the second while doing the first is worse than
having no test, because it stops anyone looking.

The price, and it is the right price: a `tools/` test now fails when a **document** is reworded. Delete
`interfaces` from `techspec.md:78` and the `interface` exemption has no carrier; rewrite `qa.md` without
"75 `directives`" and `directive` has none. Some entries are held up by a single line — `spec`, `setup`,
`conversation`, `rejection` and `feature` each have exactly one, and `directive`'s only carrier is `qa.md`.
That is the table staying honest, not the test being brittle: the answer when it goes red is to delete the
entry the message names, which is one line and takes less thought than arguing with it. What must not
happen is the reverse — planting a sentence somewhere so an exemption survives.

### Reverting a plant with `git checkout <file>` throws away your own edits to it

Small, and it cost a redo. Planting a violation in `prd.md` to re-arm the adherence check, then reverting
with `git checkout docs/prd/mission-engine/prd.md`, also reverted the two rewordings the same task had
just made to that file — the plant and the fix were in one working-tree change and `git checkout` does not
know which is which. Plant into a file you have not edited, or remove the plant the way you added it
(delete the appended line), and check `git diff --stat` afterwards rather than trusting the revert.

### A structural type is not a constructor, so `Core` is a boundary and not a guarantee

Found in review, and it is the one place the engine's own reasoning was wrong rather than incomplete.
`mission.ts` said it did not re-check the Core invariant "because a Core is only constructible through
`core()`" — and `Core` is `{ readonly capabilities: readonly CoreCapability[] }`, a structural type with no
brand, so `{ capabilities: [] }` **is** a Core and never met `assertNoExecution`. A Surface that deserialises
an `open-mission` payload and casts it therefore leads a Mission with a Core the type system would have
refused, and `decide` accepts its Delegations. Proven from `@engine/index` with a typechecked probe.

Two halves, and only one of them was a defect:

- **The throw was.** `holds` dereferenced `core.capabilities`, so a Core that arrived as `{}` reached
  `undefined.some` and threw out of `decide`, which promises never to throw. `core` is the one required field
  of `open-mission` a rule reaches *into* — the third grade of cast-tolerance this file records — so it is now
  read as `unknown`: a Core nobody can read holds nothing, and the Command is refused `missing-capability`.
- **The unchecked invariant is not**, and it is left as a **finding**: re-checking in `decide` needs a Refusal
  reason this PRD's union does not carry, and inventing one in a review is the scope creep this file forbids.
  The durable fix is to brand `Core` so `core()` is the only way in — which changes the public surface, so it
  belongs to whoever owns that decision. What changed here is that the comment now states the boundary
  truthfully instead of claiming a guarantee.

General form: **"only constructible through X" is only true of a branded type.** Every other value object here
earns the claim (`Money`, `Briefing`, `Slice`, `Instant`, the five ids); `Harness`, `Contract`, `Handoff` and
`Gate` do not, which is exactly why `decide` re-reads them where it computes with them.

### A reading is part of the non-throwing contract, not an afterthought

`decide` was hardened to refuse a `submit-handoff` whose Handoff was lost to a cast — and `stepsOf`, reading
that same recorded Refusal back, threw `TypeError` on `command.handoff.delegationId`. The Refusal was handled
perfectly and the audit surface was what finally broke, which is the worst possible place for it: a Replay
that cannot be read is a Replay that cannot be shown to a human, and it is the only reason the Replay exists.

So the rule that governs `decide` and `evolve` governs every reading over a recorded Command as well —
`stepsOf`, `refusedIn`, `meterOf`, `revisionsIn`. A Replay records **what somebody intended**, including
intentions the domain refused *because* they were malformed, so a reading is by definition handed values no
rule validated. Anything it dereferences is read as `unknown` first.

### A check that under-reports is worse than one that over-reports, and a fence proves it

QA's caveat 13, closed in review. `proseLinesOf` dropped fenced lines **before** spans were found, so the line
before a fence became adjacent to the line after it: two unmatched backticks on either side of a fence paired
*across* it and blanked the prose in between. A planted `squad` between them was silently not reported — the
adherence check quietly saying a tree is clean, which is the one failure that makes every green run
meaningless. Markdown does the opposite, because a fence ends the paragraph.

The fix is one line of shape rather than logic: a fenced line is **emptied, not dropped**, so it *is* the blank
line the span search already bounds at. Falsified by restoring the drop, which turns the new test red.

Same lesson as `codeOf`'s regular-expression tracking, and now recorded twice: when a scan can err in two
directions, spend the effort on the direction that hides a violation. Over-reporting gets argued about;
under-reporting gets believed.

### A dependency is a location decision, and `runtime/` is where the world is allowed in

The real `AgentRunner` needs `node-pty`. The engine has none, and that is not a preference — it is a test:
`mission.e2e.test.ts` reads every non-test source under `engine/` and asserts every `from "…"` specifier is
a relative path. Putting a pty adapter in `engine/adapters/` would have failed it, and rightly: the engine
would stop being typecheckable, testable and readable on a machine without a native toolchain.

So there is a third top-level source directory. **`runtime/` may import `engine/`; `engine/` must never
import `runtime/`**, and both halves are pinned rather than remembered — the engine's own test forbids the
non-relative import, and `runtime/pty-agent-runner.test.ts` asserts no specifier under `engine/` contains
`runtime` and that this module's only non-relative imports are `node-pty` plus two `@engine/` paths. The
general form: **when a new capability arrives with a dependency, the question is not how to hide the
dependency but which directory is allowed to have it.**

`vitest.config.mts` gained `runtime/**` in `test.include` and a `testTimeout` of 30s, because a spawn, a
timeout and a kill escalation are wall-clock work and 5s is not enough.

### Killing the leader is not killing the child

`IPty.kill(signal)` is `process.kill(this.pid, signal)` — one pid. Every grandchild the CLI spawned is
somebody else's problem, and the reason it *looks* fine is incidental: killing the session leader hangs up
the terminal, and an ordinary child dies of `SIGHUP`. A child that traps it does not. Proven with a
`bash -lc` script whose grandchild does `trap '' HUP; exec sleep 300` (an **ignored** signal survives an
`exec`, which is what makes the `sleep` itself immune): after the leader-only kill both grandchildren were
alive with `ppid 1`, still running, still spending.

So `terminate` signals the **process group** — `process.kill(-child.pid, …)`, which works because `node-pty`
puts the child in a new session, so its pid is also its process group id — and escalates `SIGTERM` →
`SIGKILL` after a grace period. Both halves have a test that can fail: the group kill has a **control** that
performs the leader-only kill and asserts the grandchild survives it, and the escalation has a grandchild
trapping `HUP` **and** `TERM`, so only the `SIGKILL` can end it. Without those two, "the kill kills" is a
check that can only pass.

Two mechanics worth not rediscovering: `$$` inside `( … )` is still the *parent* shell's pid, so a subshell
reports itself with `$BASHPID`; and liveness is read from `/proc/<pid>/stat`, not from `process.kill(pid, 0)`,
because a zombie answers signal 0 and a test that counted zombies as survivors would call a working kill
broken on any host whose init is slow to reap.

### A timeout that waits for the process it is killing is not a timeout

`run` rejects **on the timer** and destroys the process tree in the background. Settling only after the
child is confirmed dead would make the caller's answer depend on the child — the exact thing the timeout
exists to stop — and a process ignoring `SIGTERM`, or wedged in an uninterruptible read, would hang the
Surface for as long as it liked. The escalation timer is `unref`'d so a pending `SIGKILL` never holds a test
run or a CLI session open, and it is cleared the moment the child is gone.

The consequence is that "the process is dead" is not something the caller can await, and it should not be:
the evidence is `/proc`, and the test polls it.

### A pty is not a pipe, and an adapter that pretends otherwise is guessing

Three properties of a pseudoterminal, all left visible on purpose, and each one a decision:

- **One stream.** stdout and stderr arrive interleaved. `AgentReport` has one `output`, so this matches the
  port; what it costs is that nothing downstream can tell which half a line came from.
- **The terminal echoes what is written to it.** An instruction delivered through the terminal appears in
  `output` before the CLI has said anything — the test asserts it appears exactly **twice** when `cat` is the
  CLI. Stripping the echo means guessing which prefix of the output was ours.
- **`\r\n`, ANSI escapes and cursor moves are in the output.** Nothing trims, normalises or strips them, for
  the reason `resolveHarness` already gives: `"claude "` is either a typo or a different CLI and both deserve
  to be seen. Turning what a Zord wrote into a Handoff is a judgement about text and belongs to the Surface.

And the mechanic: a terminal has no EOF, so an instruction is written followed by `\r` (which `ICRNL` turns
into the newline that completes the line) and then EOT (`\u0004`, written as an escape because no editor
shows the literal control character), which is what the line discipline turns into
end-of-input. Without the EOT a CLI reading stdin never stops reading and the run dies of its timeout —
which is how the delivery test is written, as a **pair**: the same script under `"arguments"` must hear
nothing and under `"terminal"` must hear the instruction, or neither test says anything about delivery.

### A runner fails by rejecting, because `AgentReport` is a claim that a Zord delivered

Decided against widening the resolved value, and the first reason is the load-bearing one: a Surface awaits
`run` and then submits what came back as Commands. Hand it a crash log in `output` and it builds a Handoff
out of a stack trace; `decide` judges that against the Contract and answers a Refusal, and the Replay says
forever that the Zord delivered and broke its Contract. It did not deliver. The other two reasons: widening
`AgentReport` means editing `engine/`, where every existing implementation would carry a field it cannot
fill; and `fakeAgentRunner` already rejects, so two failure channels for one port means a Surface that
handles the fake and drops a real one.

`AgentRunFailure` keeps `timeout` and `killed` apart although both end with a dead process, because they are
facts about different parties — `timeout` is this runner giving up, `killed` is somebody else ending the
process while we waited — and collapsing them would tell a human to raise a timeout that was never reached.
The error carries the output collected so far and **no cost**: a failed run may well have spent money and
this module has no way to know how much, so a zero there would be the always-zero field again.

### An overflow fails rather than truncating, for the same reason a scan must not under-report

`maxOutputBytes` (default 4 MiB) exists because unbounded capture from a runaway CLI is an OOM. Exceeding it
**rejects**. A truncated `output` handed back as an `AgentReport` is a delivery missing its end and nothing
downstream can tell — the same shape as the fenced-block hole in `proseLinesOf`: over-reporting gets argued
about, under-reporting gets believed.

### Cost is a declared zero, and that is the honest answer here

Every run answers `ZERO_MONEY`, meaning **"no price source exists"** and not "this run was free". The
process is the party being billed and is not trusted to report a cost; `node-pty` reports an exit code and a
signal and nothing about tokens; and there is no price list anywhere in this repository. What is left is
wall-clock time, and turning seconds into cents would be inventing money — a plausible number a Meter would
total and a Cap would halt a Mission against, which is precisely the class of value `money.ts` refuses
fractions and negatives to keep out.

There is deliberately **no `priceOf` hook** waiting for the day a CLI reports its usage: an option only a
test would ever pass is the always-zero field wearing a function type. A `@ts-expect-error` probe pins its
absence, so whoever adds pricing deletes the directive and states the decision. This is the fifth site of
the "nothing in this repo names the thing" family, after the four authorship Gaps.

### Cast-tolerance at a port is about what the adapter *substitutes*, not only what it dereferences

`spawn("")` in `node-pty` silently falls back to `sh`. So a `Harness` whose `cli` was lost to a cast would
run a **different program under the Harness's name** and the Replay would say it ran the one the `Delegated`
fact records. That is worse than a throw, and it is why `cli` is read as `unknown` and refused before
anything is forked — a fourth entry for the grades this file already lists (copy, dereference, compute):
**substitute a default for a missing value and the lie is silent and permanent.**

The instruction is checked in the same place and only under `"terminal"` delivery, so `not-spawned` stays
true — nothing has been forked yet. A **blank** instruction is allowed through, because "nothing to say" is
something a caller can mean and it is not an adapter's judgement; a non-string is not.

The options themselves are **not** read as `unknown`, and the line is worth stating: an `AgentRun` crosses
the port from a Surface that may have deserialised it, while `PtyAgentRunnerOptions` is written in code by
whoever builds the runner. Different threat models, different standards.

### Nothing is inherited silently, and the two variables you did not list

`cwd`, `env`, `timeoutMs` and `argumentsFor` are all **required**, and `env` is a complete map this module
never merges with `process.env`: a CLI that inherits the whole parent environment inherits every credential
the parent holds, and a Zord is a process running text somebody else wrote. `inheritedEnv(names)` is how a
variable is passed through — the point being that the list is written down at the call site — and an unset
name is left out rather than passed as `""`, because an empty `HOME` is a different question from an absent
one.

`argumentsFor` is required rather than defaulted to `[]` for a Replay reason, not a taste one: the Harness
carries `model`, `effort` and `skills`, there is no flag spelling true of `claude`, `codex` and `gemini` at
once, and a default would drop those three on the floor and run a Zord under a bundle the `Delegated` fact
says it ran with.

Two variables reach the child that no caller listed, both set by `node-pty` and both named in the module
doc so the list is complete: `TERM` (from the `term` option) and `PWD` (set to `cwd`).

### A probe with no collateral can also mean "the type is the whole enforcement"

Falsification tally for the pty adapter: 8 probes, 7 reported `TS2578` (2 with collateral inside the source
— optional `timeoutMs` produced `TS2322` at the `setTimeout`, optional `argumentsFor` produced `TS2722` at
the call), and the eighth is an annotation (`const asPort: AgentRunner = bashRunner()`) whose falsification
is 8 errors starting with `TS2322`, because assignability cannot be phrased as a directive.

The four with no collateral add a case to the list this file already keeps. `cwd` and `env` being required
break nothing inside the source when made optional — `node-pty` would happily default them to
`process.cwd()` and `process.env`, which is exactly the failure the requiredness exists to prevent. So the
answer is neither "it guards an absence" nor "a runtime half carries the load": **the type is the whole
enforcement, and the thing it enforces is that a caller cannot stay silent.** Worth distinguishing, because
it is the one variety where adding a runtime check would be the wrong instinct.

### A test whose premise is "and then it resolves" has a premise

The first green run had one failure, and it took 15 seconds to arrive: a test asserting that nothing is
written to the terminal ran `bash -lc 'cat; echo …'` and reasoned that it would resolve "because the
terminal closed when bash exited". Bash does not exit while `cat` is reading — `cat` had no input and no
EOT, so the run died of its timeout and the assertion never ran.

Same family as "a test helper's default parameter can swallow the case under test", from the other end:
that one was a fixture quietly supplying a valid value, this one was a **sentence in a comment standing in
for a mechanism**. The fix is the pair described above, where each half fails if the other's premise is
wrong. When a test's reasoning contains "because", check the because.

### Declared Gap: node-pty reports a missing binary as exit code 1

`node-pty` forks a helper that `execvp`s the file, so a CLI that is not installed arrives as
`{ reason: "exit", exitCode: 1 }` with `execvp(3) failed.: No such file or directory` on the terminal — and
a bad `cwd` arrives the same way with `chdir(2) failed.`. This adapter cannot tell either apart from the CLI
itself exiting 1, and matching the helper's wording would be a heuristic against a dependency's internals.
Pinned by a test rather than guessed at, so the day it changes, something says so.

### Vitest boundaries

- The config is `vitest.config.mts`, not `.ts`: as `.ts` under a `package.json` without
  `"type": "module"`, Vite's loader warns on every run. `.mts` fixes it without making the whole
  root package ESM, which would put the Next config files at risk.
- `test.include` is scoped to `engine/**`, `runtime/**` and `tools/**`. The site is verified by
  `npm run build` and is never pulled into a Vitest run.
- `testTimeout` is 30s, raised from the default 5s because `runtime/` spawns real processes and a
  timeout plus a kill escalation is wall-clock work. It is a ceiling, not a budget: the whole
  `runtime/` suite runs in about 9 seconds.
- `vitest.config.mts` is listed explicitly in `tsconfig.json` `include`, because `**/*.ts` does not
  match `.mts`.
- **`expect(promise).rejects` must be awaited**, or Vitest warns and will fail in its next major. The
  trap it hides is worse: `expect(() => void runner.run(…)).not.toThrow()` leaves a **floating rejected
  Promise**, which Vitest reports as an unhandled error and warns "might cause false positive tests".
  Assign the Promise inside the callback and `await expect(pending).rejects…` after it.
- A `function describe(…)` in a test file **shadows Vitest's `describe`**, and the error arrives as
  `TS2440` plus `TS2554: Expected 1 arguments, but got 2` at every real `describe(…)` — which reads like
  the test framework is broken. Name test helpers away from `describe`, `it` and `expect`.

### Known broken, pre-existing

`npm run lint` does not work: `next lint` is deprecated in Next 15 and the repo has no ESLint
config, so it drops into an interactive prompt and exits 1. It predates this flow. The repo
therefore has **no working linter**, which matters whenever a review step wants one.

**`npm test` has two failing tests, and they are about a document.** `docs/prd/cockpit/prd.md` was
committed after Task 10 built the adherence checks and has never been through them: it trips criterion 8
(26 prose violations — `agent`, `terminal`, `directory`, `team`, `output`, `grid`, `session`, `budget`,
`prompt`) and criterion 9 (the folder has no `techspec.md` and no `tasks.md` yet). Both failures are
`tools/`, both name the same folder, and neither involves `engine/` or `runtime/`. Confirmed pre-existing
by stashing: at `85636c0` the suite is 472 tests with the same 2 red. Do not read a red `npm test` as
your own until you have checked that it is more than these two.

## Current state of the repo

- The product **site** is in `app/`, `components/`, `lib/` — Next.js 15 App Router, Tailwind v4,
  TypeScript strict, content in a typed data layer, static build.
- The site pre-dates this flow and is **not** retro-documented: SDD applies from here forward.
  Its design rationale is in `docs/PRODUTO.md`.
- `typescript` is pinned to `5.9` on purpose: TypeScript 7 breaks Next 15's `tsconfig` path
  alias resolution, and every `@/...` import fails to build. Do not bump it.
- Fonts are system stacks and there are no external asset requests. Keep it that way — the site
  must build and render with no network.
- Skills live in `.agents/skills/` (real files) and are symlinked into `.claude/skills/`. They
  are versioned so the flow travels with the clone.
- The **engine** is `engine/domain/` (twelve modules), `engine/ports/agent-runner.ts`,
  `engine/adapters/fake-agent-runner.ts` and `engine/index.ts`, with tests beside their subject plus
  `engine/mission.e2e.test.ts` at the root, which imports only `@engine/index`. 406 tests. It has **no
  dependency of any kind** — every import inside `engine/` is a relative path, and `mission.e2e.test.ts`
  asserts that.
- The **runtime** is `runtime/pty-agent-runner.ts` — the real `AgentRunner`, spawning a CLI through
  `node-pty` — with `runtime/pty-agent-runner.test.ts` beside it (39 tests, all of them real spawns, no
  mock of the pty anywhere). It is the **only** place in the repo with a runtime dependency and the only
  place that touches the operating system. `runtime/` may import `engine/`; `engine/` must never import
  `runtime/`, and both directions are asserted by tests.
- The **adherence checks** are `tools/glossary-check.ts` (the scanning library), with
  `tools/glossary-check.test.ts` for criterion 8 and `tools/prd-structure.test.ts` for criteria 9 and 10.
  They are part of `npm test`, which is 511 tests. `tools/` uses `node:fs` and is the only place in the
  repo that reads the tree — `runtime/` reads it too, but only to assert its own boundary.
- The **decisions** are `docs/adr/0001..0007`, one per entry of the techspec's "Decisions worth an ADR".
