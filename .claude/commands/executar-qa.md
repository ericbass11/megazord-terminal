---
description: Validate a delivery against PRD, techspec and tasks; verdict and bugs.md
argument-hint: <prd-folder-name>
---

# Execute QA

Validate the delivery of `docs/prd/$1/` and issue a verdict.

## Preconditions

Read `prd.md`, `techspec.md` and `tasks.md` in full, plus `CONTEXT.md` and `CLAUDE.md`. QA
validates against those documents, never against your own taste.

## Independence

Judge the delivery, not the intention. Do not fix anything here — QA that fixes what it finds
stops being able to reprove it.

## Procedure

1. Walk every **acceptance criterion** of the PRD and check it. Run the proof; do not infer it
   from reading the diff.
2. Walk the **techspec verification plan** and confirm each item was actually verified.
3. Check every task marked `done` really is, including its declared Gaps.
4. Check glossary adherence: no term listed under `_Avoid_` in `CONTEXT.md` appears in code,
   docs or commits.
5. Write `docs/prd/$1/qa.md` with the verdict and the evidence per criterion.

## Verdict

- **approved** — every criterion proven. Nothing pending.
- **approved with caveat** — everything works, but something non-blocking deserves record. State
  the caveat explicitly; it is fixed in the same context, by the same agent, before the PR.
- **reproved** — any criterion unproven, any Gap not declared, any glossary violation.

## On reproval

Write `docs/prd/$1/bugs.md`, one entry per problem:

```md
## BUG-<n> — <title>

- **Criterion**: which PRD or techspec item it breaks
- **Observed**: what happens
- **Expected**: what should happen
- **Evidence**: command, output, file:line
- **Status**: open | fixed
```

Then tell the user, in PT-BR, to run `/executar-bugfix`. Nothing advances with an open bug —
never release with a known pending item.
