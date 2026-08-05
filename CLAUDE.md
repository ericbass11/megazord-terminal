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
and recorded in the fact.** Task 7 will meet the same choice with a price list.

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

### Vitest boundaries

- The config is `vitest.config.mts`, not `.ts`: as `.ts` under a `package.json` without
  `"type": "module"`, Vite's loader warns on every run. `.mts` fixes it without making the whole
  root package ESM, which would put the Next config files at risk.
- `test.include` is scoped to `engine/**` and `tools/**`. The site is verified by `npm run build`
  and is never pulled into a Vitest run.
- `vitest.config.mts` is listed explicitly in `tsconfig.json` `include`, because `**/*.ts` does not
  match `.mts`.

### Known broken, pre-existing

`npm run lint` does not work: `next lint` is deprecated in Next 15 and the repo has no ESLint
config, so it drops into an interactive prompt and exits 1. It predates this flow. The repo
therefore has **no working linter**, which matters whenever a review step wants one.

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
