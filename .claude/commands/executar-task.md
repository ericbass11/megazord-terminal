---
description: Execute one numbered task from a PRD folder, then stop for human validation
argument-hint: <prd-folder-name> <task-number>
---

# Execute task

Execute task **$2** from `docs/prd/$1/tasks.md`.

## Preconditions

- Read `docs/prd/$1/prd.md`, `techspec.md` and `tasks.md`, plus `CONTEXT.md` and `CLAUDE.md`.
- Check that the tasks task $2 depends on are `done`. If not, stop and say which one blocks.

## Language

Talk to the user in PT-BR. Code, comments, commits and artifacts in English.

## Procedure

1. Set the task to `doing` in `tasks.md`.
2. Implement **only** this task. Anything outside its goal is scope creep — write it down as a
   finding instead of doing it.
3. Run the verification declared in the task. If there is no executable proof, run the manual
   check and record what you observed.
4. Review your own output before handing it over: does it obey `CLAUDE.md`, does it use only
   glossary terms, does it leave the repo green?
5. **Document the rules you discovered** in `CLAUDE.md`: any convention, constraint or gotcha
   that the next task would otherwise rediscover. This is what makes `/orquestrar-tasks`
   possible later.
6. Set the task to `done` and report, in PT-BR: what was done, what was verified and how, what
   was left as a Gap, and what the next task is.

## Handoff

The report is a Handoff, so it declares its Gaps. Never close a task saying it is complete when
part of it was skipped — say what was skipped and why.

Stop after one task. The human validates before the next one; automation speeds execution up,
it does not replace the human check.
