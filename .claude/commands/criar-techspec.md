---
description: Turn a PRD into a technical spec under docs/prd/<slug>/techspec.md
argument-hint: <prd-folder-name>
---

# Create techspec

Write the techspec for the PRD in `docs/prd/$1/`.

## Preconditions

- Read `docs/prd/$1/prd.md` **in full**. If any acceptance criterion is not checkable, stop and
  fix the PRD first — a techspec built on a vague criterion produces tasks nobody can validate.
- Read `CONTEXT.md`. Every domain name in this document comes from the glossary.
- Read the existing code before proposing structure. Contradiction between what the PRD assumes
  and what the code does is a finding, and it goes in the techspec.

## Language

Talk to the user in PT-BR. Write the artifact in English.

## Procedure

Write `docs/prd/$1/techspec.md` with:

- **Approach** — the shape of the solution in a paragraph, and why this shape.
- **Domain impact** — which contexts, aggregates and invariants are touched or created. New
  domain terms are added to `CONTEXT.md` now, not later.
- **Structure** — files and modules created or changed, with the responsibility of each.
- **Contracts** — the interfaces agreed before code: signatures, payload shapes, error shapes.
  Parallel work only merges when this section exists first.
- **Rejected alternatives** — what was considered and why it lost. Prevents the same suggestion
  in six months.
- **Decisions worth an ADR** — list the decisions that are hard to reverse, surprising without
  context, and the result of a real trade-off. Offer to write them under `docs/adr/`. Skip the
  ones that fail any of the three tests.
- **Verification plan** — how each PRD acceptance criterion will be proven. Prefer executable
  proof over inspection.

## Definition of done

Every acceptance criterion in the PRD maps to something in the verification plan.

Then tell the user, in PT-BR, to read the whole techspec and correct it before `/criar-tasks`.
