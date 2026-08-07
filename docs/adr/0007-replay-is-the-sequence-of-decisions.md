# 0007 — The Replay is the sequence of Decisions, not a second Event log

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/mission-engine/` (decided during Task 9)

## Decision

A `Replay` is a list of `ReplayEntry` — each one a Command and the Decision it got. It grows only through
`submit(into, command)`, which calls `decide` itself against `stateOf(into)`, so it cannot record a
Decision that did not happen. State stays a fold and nothing else: `stateOf(recorded)` is
`replay(eventsOf(recorded))`, and `stepsOf` is a reading derived at read time and stored nowhere.

## Trade-off

Building the Replay from the Event log is the obvious shape — the facts are already there, and a Surface
would need to keep nothing. It cannot work: criterion 7 names **refusals** among what a Replay must
contain, and a Refusal cannot be an Event. `decide(UNOPENED_MISSION, command)` refuses before any Mission
exists, and every Event carries a `missionId`, so a fact-based Replay could only ever hold *some*
refusals — the ones that happened late enough. The rejected middle road was worse: a `handoff-refused`
Event that `evolve` ignores and no rule reads is the always-zero lie this repository keeps warning about.

What is paid for it: a Replay is a second structure a Surface has to hold onto, `submit` re-folds the
state on every call, and there are now two readings of the past — `eventsOf` as the state sees it, and
`stepsOf` as a human reads it.

## Consequences

- **General form**: when the auditable reading and the state disagree about what counts as the past, add
  a reader, not a fact.
- Criterion 7 is provable as an equality plus a filter: fold equality over a log containing a Refusal, a
  Gate decision, a Cap halt and an Authorisation, and `refusedIn(stepsOf(...))` for the refusals.
- `replay(events)` deliberately does not filter by `missionId`, because a filter would break the
  `replay(events) === events.reduce(evolve, …)` equality it exists to have. A log mixing two Missions
  folding to nonsense is recorded as open risk 4 of the PRD, and the fix belongs to `evolve`.
