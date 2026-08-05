---
description: Final review of everything done, before opening a PR
argument-hint: <prd-folder-name>
---

# Execute review

Final review of the delivery of `docs/prd/$1/`, before any PR.

## Preconditions

- `docs/prd/$1/qa.md` exists with verdict **approved** or **approved with caveat**. If QA
  reproved, or if `bugs.md` still has an open entry, stop: review does not run over open bugs.
- Read `prd.md`, `techspec.md`, `tasks.md`, `qa.md`, `CONTEXT.md` and `CLAUDE.md`.

## What review looks at that QA does not

QA asks "does it do what was asked?". Review asks "should it have been done this way?".

1. **Rule adherence** — every convention in `CLAUDE.md`, every term in `CONTEXT.md`.
2. **Domain integrity** — do the invariants actually protect anything, or is the model
   decoration? Can an invalid state be constructed?
3. **Reuse and altitude** — is anything reimplemented that already exists? Is anything abstracted
   before it earned it?
4. **Scope discipline** — does the diff contain anything the PRD did not ask for?
5. **What was left behind** — are the declared Gaps acceptable, or is one of them a blocker
   wearing a Gap costume?
6. **Documentation** — do `CONTEXT.md`, `CLAUDE.md` and the ADRs reflect what was actually built?

## Procedure

Write `docs/prd/$1/review.md` with a verdict per item and the reasoning.

- **With a caveat**: the correction is made now, in this same context, by this same agent. It
  does not become someone else's doubt later.
- **Approved**: the PR may be opened.

## After approval

Open the PR only if the user asks. State clearly, in PT-BR, that the PR still goes through
manual evaluation by **two peers** and through the weekly war-room — automation does not replace
human conference.
