---
description: Break a techspec into executable tasks under docs/prd/<slug>/tasks.md
argument-hint: <prd-folder-name>
---

# Create tasks

Break the techspec in `docs/prd/$1/` into tasks.

## Preconditions

Read `docs/prd/$1/prd.md` and `docs/prd/$1/techspec.md` in full, plus `CONTEXT.md`.

## Granularity

This is the judgement call of this command, so make it explicitly.

- One task is a **single reviewable delivery**: it changes one thing, it can be verified on its
  own, and it leaves the repo working.
- Too many tasks turns review into bureaucracy and multiplies context switches.
- Too few hides several decisions inside one diff, and review degrades into "looks fine".
- A task that cannot be verified on its own is not a task — it is half of another task.

After drafting the list, state the count and justify it against the size of the techspec. If
the count looks wrong, redo the split before writing the file.

## Procedure

Write `docs/prd/$1/tasks.md`. For each task:

```md
## Task <n> — <title>

- **Status**: todo | doing | done
- **Goal**: what must be true when it is finished
- **Touches**: files and modules
- **Depends on**: task numbers, or none
- **Verification**: the executable proof, or the manual check when no proof is possible
```

Order tasks so that dependencies come first and each one leaves the repo green.

## Definition of done

Every element of the techspec structure is covered by at least one task, and every task has a
verification. Then report the count to the user in PT-BR and wait for approval before
`/executar-task`.
