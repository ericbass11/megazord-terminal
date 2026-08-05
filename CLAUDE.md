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
- Never use a term listed under `_Avoid_`. `Squad` is not a Combination; `agent` is not a Zord;
  `memory` is not the Cortex.
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
