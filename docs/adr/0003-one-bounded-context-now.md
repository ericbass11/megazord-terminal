# 0003 — One bounded context now, with four candidates recorded

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/`

## Decision

There is a single `CONTEXT.md` and a single ubiquitous language for the whole product. Four candidate
bounded contexts are recorded here and nowhere else, so that the option is not lost:

- **Orchestration** — Mission, Briefing, Mode, Core, Delegation, Slice
- **Execution** — Zord, Role, Capability, Harness, Catalog, Effort, Combination, Roster, Skill
- **Agreement** — Contract, Clause, Handoff, Gap, Refusal, Gate, Gate decision, Halt, Kill, Delivery
- **Governance** — Meter, Cap, Authorisation, Replay, Step

Promotion to a `CONTEXT-MAP.md` happens when a second context genuinely needs its own language — the
trigger being one word that must mean two different things, not a glossary that has merely grown.

## Trade-off

This ADR exists to record a **no**. Splitting the glossary now would look like diligence: four small
documents, clear ownership, DDD by the book. It was rejected because there is no code yet to anchor a
boundary, and a boundary invented from a reading of the words is the most expensive thing to get wrong
in DDD — an invented seam becomes translation layers, duplicated aggregates and two names for one fact,
and unwinding it costs more than every other decision in this PRD combined. The cost accepted in
exchange is a glossary that will get long, and terms whose home is ambiguous until code says otherwise.

## Consequences

- One glossary, policed by one adherence check (`tools/glossary-check.ts`).
- The four groupings above are a hypothesis, not a structure: nothing in `engine/` is arranged by them.
- The first genuine collision is the trigger to revisit this, and it should be recorded as its own ADR
  rather than by editing this one.
