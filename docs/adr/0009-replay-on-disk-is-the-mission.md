# 0009 — The Replay on disk is the Mission, and every answer about it is derived

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/cockpit/`

## Decision

A Mission is persisted as one JSONL file per Mission under `.megazord/missions/`, one line per Step,
appended and never revised. That file **is** the Mission. Nothing above it stores Mission state:

- `cockpit/server.ts` holds no `Mission` field. Every gesture loads the Replay from the store, calls
  `submit`, appends when the Decision was accepted, and answers the entry. State is `stateOf` of what
  the store just handed over, re-derived on every gesture.
- `runtime/mission-store.ts` imports the engine **only as types**, so no engine code runs inside it. It
  persists and it does not judge: `load` casts what it read and says so.

What the server does hold is the live process table, which is not Mission state, because a process
cannot be folded.

## Trade-off

Re-folding the Replay on every gesture is work the server repeats, and holding the folded state in a
field would be free. That field is refused because it would be a second copy of a truth the file already
holds, and the copy
is the one a human would be shown: where the two disagreed, the reading would win and the record would
be wrong. A hand-edited file could then carry a state its own Steps do not fold to, and nothing would
say so.

At tens of Steps per Mission this costs nothing measurable. When it stops being the size, the answer is
a caller that keeps `stateOf` beside its Replay — never a Replay that remembers.

The store not judging has a cost that has to be stated, because it reads as laxness: a Replay
legitimately contains malformed Commands. `decide` refuses a `submit-handoff` whose Handoff was lost to
a cast, and `submit` records that Refusal *with* the Command that caused it. A loader that re-validated
through the value constructors would refuse to load exactly the Steps the engine goes out of its way to
keep — and a Replay that cannot be read is a Replay that cannot be shown to a human, which is the whole
of what it is for. So the store checks only what **it** computes with: the MissionId, because it becomes
a path, and the discriminated skeleton of a Step, because that is what makes the value readable at all.

## Consequences

- Criterion 8 is provable and was proven the hard way: append, then load in a **separate** `node`
  process over a compiled tree, fold with `stateOf` and read with `stepsOf`, `refusedIn` and `eventsIn`.
  Reopening the same in-memory object proves nothing about a file.
- A torn line makes `load` reject, naming the 1-based line and the byte offset where it starts, and
  return nothing. The alternative — answer the good prefix — breaks one Step later, because an append
  after a torn tail buries that tail where no future `load` can pass it.
- `append` resolves once the bytes are durable: one write to an append-only descriptor, `fsync` on the
  file, then `fsync` on the folder that holds it, so a new file's name is durable too and not only its
  contents.
- The Cortex made the opposite call on purpose, and the reasoning is in `runtime/cortex-store.ts`:
  all-or-nothing is right for a value that folds, and report-and-continue is right for a set.
