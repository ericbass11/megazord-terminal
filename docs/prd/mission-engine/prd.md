# PRD — Mission Engine

The heart of the ADE: the domain module that holds the rules the product promises, plus the
DDD/SDD foundation that keeps those rules honest.

## Problem

Every rule that makes this product an ADE instead of an IDE lives today as marketing copy. The
site states that the Core cannot execute, that a Handoff violating its Contract is refused
without human involvement, that a Mission halts when it reaches its Cap, and that the Replay
holds every decision with its exact cost. `lib/surfaces.ts` and `lib/site.ts` are 21 exports of
static text: no state, no transition, no invariant, nothing that can be violated.

The cost is not cosmetic. The moment a second Surface exists — a Cockpit UI, an MCP server, a
desktop shell — each one will implement its own reading of those rules, and they will drift.
"The Core delegates and never executes" becomes a code review convention instead of something
the type system refuses to compile, and the first deadline turns it into a comment.

## Outcome

An `engine/` domain module in TypeScript that models the Mission lifecycle and **enforces** its
invariants, proven by tests that fail when a rule is broken. Around it, the documentation
foundation: the glossary in active use, the architectural decisions recorded, and adherence
checks that break the build instead of relying on goodwill.

No UI. No real agent process spawning. No persistence. The engine is the heart — the organs come
in later PRDs.

## Scope

1. **Mission** aggregate — created from a Briefing with a Mode and a Cap; explicit lifecycle
   states; illegal transitions unrepresentable.
2. **Core** invariant — the orchestrator cannot hold an execution capability. Enforced at the
   type level and guarded at runtime.
3. **Delegation** — the Core assigns a slice of the Mission to a Zord with a resolved Harness.
4. **Harness resolution** — deterministic precedence: roster > invocation > catalog default.
5. **Contract, Handoff, Refusal** — a Handoff is validated against its Contract; a violation is
   refused automatically, carrying what was violated.
6. **Gate** — the Mission halts and waits for a human decision: approve, revise with a reason,
   or kill.
7. **Meter and Cap** — cost accrues per Pane and per Mission; reaching the Cap halts the Mission
   and requires authorisation.
8. **Replay** — an append-only event sequence covering every delegation, refusal, gate decision
   and cost, in order, sufficient to reconstruct the final state.
9. **AgentRunner port + fake adapter** — the boundary where a real CLI would live, with a
   deterministic fake so the domain is testable with no CLI installed.
10. **Adherence checks** — a test fails when a term listed under `_Avoid_` in `CONTEXT.md`
    appears in `engine/` or in `docs/prd/`; a test fails when a PRD folder lacks `prd.md`,
    `techspec.md` or `tasks.md`.
11. **ADRs** for the decisions that pass the three-part test.

## Out of scope

1. Spawning real CLI processes (Claude, Codex, Gemini). The port exists; the real adapter does not.
2. Cockpit UI, Pane rendering, any visual surface.
3. Persistence of any kind — no database, no file store. State lives in memory.
4. The MCP server and the 52 tools.
5. Providers, credentials, media generation, marketplace, voice.
6. Refactoring the site to consume the glossary. It is a real debt, tracked, but a separate PRD.
7. Retro-documenting the site: SDD applies from here forward.
8. **Token counting.** The glossary defines the Meter as the accounting of tokens *and* cost, and
   this PRD delivers cost only: the `AgentRunner` port reports a cost and there is no price list to
   derive one from a token count. A `tokens` field no rule could fill would be the always-zero lie.
   Additive once a runner reports them.

## Grill findings

What the demand did not say, and what was decided.

- **Q1 — what is "the heart"?** First answered as documentation only, then revised to
  documentation **and** code. Recorded because it reverses an earlier decision: the engine is
  built now, and the documentation is produced by the same flow rather than ahead of it.
- **There was no domain to model.** Fact found before asking: `lib/*.ts` holds 21 static exports,
  zero state transitions, zero invariants. DDD applied to the marketing site would have been
  ceremony. This PRD exists because the code being modelled is new.
- **Q2 — the flow commands did not exist here.** `.claude/commands/` was absent; the eight
  commands were written into this repo from the process the user provided, so the flow travels
  with the clone instead of living in one machine's global config.
- **Q3 — language.** Artifacts in English, conversation in PT-BR, with the spoken→written table
  in `CONTEXT.md` as the bridge. Reasoning happens in English: native ground for the models and
  fewer tokens.
- **Q4 — SDD is forward-only.** The site keeps `docs/PRODUTO.md` as its rationale and is not
  retro-specced.
- **Q5 — how QA gets teeth.** With code in scope, QA validates invariants by running them. The
  adherence checks stay anyway (scope item 10): without them the glossary is decoration within
  weeks, and glossary drift is exactly what `/executar-review` is supposed to catch.
- **Q6 — one context, not four.** A single `CONTEXT.md`, with Orchestration / Execution /
  Agreement / Governance recorded in an ADR as candidate contexts. Splitting a glossary before
  code can anchor the boundary invents seams, and an invented seam is the most expensive refactor
  in DDD. Promotion to `CONTEXT-MAP.md` happens when a second context genuinely needs its own
  language.
- **Q7 — one PRD, not two.** "The project is founded on DDD and SDD" is one delivery. Splitting
  foundation from domain model would run two full QA and review cycles for the same outcome.
- **Q8 — slug.** Renamed from `ddd-sdd-foundation` to `mission-engine`: with code in scope, the
  deliverable is the engine, and the foundation is how it gets built. `/executar-task
  mission-engine <n>`.
- **Where the code lives.** `engine/` inside the existing project, reached through a path alias —
  not an npm workspace, and nothing moved. Reason: the site is already running in the user's VS
  Code, and restructuring into `apps/`+`packages/` risks breaking a working setup for zero
  domain gain. Extraction to a package stays possible later.
- **How it is tested.** Vitest, for watch-mode TDD ergonomics on a pure domain module.
- **Glossary collision found while writing this PRD.** The module was first named `core/`, which
  collides with **Core**, the glossary term for the orchestrator. The module is `engine/`; `Core`
  stays reserved for the orchestrator, never for a folder or a module.

## Open risks

1. **Modelling invariants before the runtime exists** can bake in wrong assumptions about how
   real agents behave. Mitigated by keeping every runtime concern behind the `AgentRunner` port,
   so a wrong guess costs an adapter and not the domain.
2. **"The Core holds no execution capability" is partly a type-level guarantee**, and a cast can
   bypass it. Mitigated with a runtime guard plus an explicit review item.
3. **The Replay may be over-modelled** if it is designed for auditing needs no one has expressed
   yet. Kept to what the Surfaces already promise, nothing more.
4. **Adherence checks can produce false positives** — an `_Avoid_` term may legitimately appear
   in prose quoting what to avoid. The check must scope itself to code identifiers and to PRD
   body text, excluding the glossary itself.

## Acceptance criteria

Each line is checkable by someone who did not take part in the grill.

1. `npm test` passes, and `npm run build` for the site stays green.
2. A test proves a Core cannot be constructed or used with an execution capability, and that
   bypassing it by cast fails the runtime guard.
3. A test proves a Handoff that violates its Contract is refused with no human input, and that
   the Refusal states what was violated.
4. A test proves Harness resolution follows roster > invocation > catalog default, with a case
   for each level winning.
5. A test proves a Mission that reaches its Cap halts and cannot continue without authorisation.
6. A test proves a Gate blocks progress until decided, and that killing it stops the Mission.
7. A test proves the Replay contains every delegation, refusal, gate decision and cost in order,
   and that replaying it reconstructs the same final state.
8. A test fails when a term listed under `_Avoid_` in `CONTEXT.md` appears in `engine/` source or
   in a `docs/prd/` body.
9. A test fails when a `docs/prd/<slug>/` folder is missing `prd.md`, `techspec.md` or `tasks.md`.
10. `engine/` compiles under strict TypeScript with no `any` and no `@ts-expect-error` outside the
    tests that deliberately probe the type-level guarantees.
11. Every term introduced by this work is in `CONTEXT.md`, and every recorded ADR passes the
    three-part test.
12. A test proves an illegal Mission transition is rejected — delegating on a halted Mission,
    submitting a Handoff for a Delegation that was never made, deciding a Gate that is not open.
13. A test drives a whole Mission end to end against the fake AgentRunner, with no CLI installed
    and no network, from Briefing to Delivery.
