---
description: Turn a grilled demand into a PRD under docs/prd/<slug>/prd.md
argument-hint: <short-name-of-the-demand>
---

# Create PRD

Write the PRD for: **$ARGUMENTS**

## Preconditions

- The demand went through `/grill-with-docs`. If it did not, stop and run the grill first.
  No exception: even an obvious demand hides the nuance that costs most.
- Read `CONTEXT.md` before writing a single line. Use its English terms and never a term listed
  under `_Avoid_`.

## Language

Talk to the user in PT-BR. Write every artifact in English. The spoken PT-BR term maps to the
English written term through the table in `CONTEXT.md`.

## Procedure

1. Pick a kebab-case English slug and create `docs/prd/<slug>/`.
2. Write `docs/prd/<slug>/prd.md` with:
   - **Problem** — what hurts today, stated as the current cost, not as a missing feature.
   - **Outcome** — what must exist at the end. Observable, so QA can check it.
   - **Scope** — numbered list of what is in.
   - **Out of scope** — numbered list of what is deliberately out. As valuable as the in-list.
   - **Grill findings** — what the grill exposed that the demand did not say, and the decision
     taken for each. Carry the questions and the answers, not a summary.
   - **Open risks** — what can still make this wrong.
   - **Acceptance criteria** — one checkable line per criterion. This is the contract QA
     validates the delivery against.
3. Do not write a technical solution here. Architecture belongs in the techspec.

## Definition of done

The PRD is done when every acceptance criterion is checkable by someone who did not
participate in the grill.

Then tell the user, in PT-BR, to read the whole PRD and correct what is wrong before
`/criar-techspec`. Do not move on by yourself.
