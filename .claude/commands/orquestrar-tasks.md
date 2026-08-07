---
description: Run the remaining tasks of a PRD autonomously — only when CLAUDE.md is mature
argument-hint: <prd-folder-name>
---

# Orchestrate tasks

Run the remaining tasks of `docs/prd/$1/tasks.md` back to back.

## Maturity gate

This command is **not** the default way to execute tasks. Use it only when `CLAUDE.md` is mature
enough for a task to run without a human between steps, which means all of these are true:

1. The conventions the last tasks discovered are already written in `CLAUDE.md`.
2. Every remaining task has an **executable** verification, not a manual check.
3. No remaining task touches a Gate decision — architecture, money, deploy, credentials.

If any is false, stop and say which one, then run `/executar-task` one by one instead.

## Procedure

For each remaining task in order:

1. Run it exactly as `/executar-task` would, including the `CLAUDE.md` update.
2. Run its verification. **On failure, stop the whole run** — do not continue over a red task.
3. Append one line to the run report: task, verdict, proof.

## Definition of done

Every task `done` and green, or a clean stop at the first failure. Report in PT-BR: what ran,
what proved it, and where it stopped. Never report a run as successful when a verification was
skipped.
