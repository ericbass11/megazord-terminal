# 0010 — A Zord submits its own Handoff, and nothing here parses prose

- **Status**: accepted
- **Date**: 2026-08-06
- **PRD**: `docs/prd/cockpit/`

## Decision

A Handoff is built by the Zord that delivers it and submitted as a Command, through the embedded control
plane. Nothing in `runtime/` or `cockpit/` reads what a Zord wrote and infers a Handoff from it.

That is why the control plane exists at all. What the Zord itself wrote arrives as a stream of bytes from a
pseudoterminal — interleaved, echoed, carrying ANSI escapes and cursor moves — and the pty adapter
deliberately hands it over untouched. Turning that into a scope, a list of artifacts, a reference
Contract and a set of declared Gaps means judging text, and it is the one thing this product does not
judge on a Zord's behalf.

## Trade-off

The cost is real and it is a constraint on every Zord: a CLI that cannot be told to call a tool cannot
deliver into a Mission at all. It can run in a Pane and be watched, and its work is invisible to the
Contract. Inferring the Handoff would have made every CLI a first-class Zord immediately.

It is refused because the inference is the party being judged writing its own verdict. `validateHandoff`
answers whether a delivery satisfies its Contract by reading the Handoff's declared scope and Gaps; if
those come from a heuristic over the Zord's prose, then a Zord that writes confidently satisfies more
Clauses than one that writes plainly, and the Refusal stops meaning anything. Worse, it is
unfalsifiable: nobody can tell a heuristic that missed a Gap from a Zord that did not declare one.

The engine already refuses this in the small — `decide` never judges text, and a Handoff's Clauses are
matched by ClauseId — so inferring one at the edge would put a rule in the layer that is not allowed to
have rules, and it would be the rule that decides whether work counts.

## Consequences

- The control plane's `handoff_submit` composes the same path the Cockpit's own gestures take: load the
  Replay, `submit`, append when accepted, answer the Step. A Refusal is returned **to the Zord**, with
  its violations, so it can fix the delivery and submit again. That loop is criterion 3 of the Mission
  Engine PRD, and it is the reason a Refusal is a return value rather than a fact in the log.
- A Refusal carries a list of violations. Every reader of one asserts the whole list; the first entry
  alone hides the second, and a Handoff that breaks a required Clause usually breaks an optional one too.
- Declaring a Gap is how a Zord says what it did not cover, and a Gap names its Clause. The domain
  cannot infer either, which is the same decision seen from the Zord's side.
- Every argument reaching the control plane was written by a model running in a subprocess, so it is read
  as `unknown` before anything is forked, written or appended.
