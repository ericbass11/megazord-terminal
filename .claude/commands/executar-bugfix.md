---
description: Fix everything QA registered in bugs.md, then hand back to QA
argument-hint: <prd-folder-name>
---

# Execute bugfix

Fix the bugs in `docs/prd/$1/bugs.md`.

## Preconditions

Read `bugs.md`, `qa.md`, `prd.md`, `techspec.md`, `CONTEXT.md` and `CLAUDE.md`.

## Procedure

For each entry with `Status: open`:

1. Reproduce it using the evidence QA recorded. If it does not reproduce, do not close it —
   write what you observed under the entry and ask QA to recheck. A bug that "vanished" without
   explanation is still a bug.
2. Fix the **cause**, not the symptom. If the cause is outside the scope of the PRD, say so
   instead of widening the scope silently.
3. Re-run the criterion the bug broke.
4. Set `Status: fixed` and record what changed and what proves it.
5. If the fix revealed a rule the next task should know, write it into `CLAUDE.md`.

## Definition of done

Every entry `fixed` with proof, or explicitly reported as out of scope with the reason.

Then tell the user, in PT-BR, to run `/executar-qa` again. The QA ↔ bugfix loop repeats until QA
approves — no exception, and no "approved with known pending".
