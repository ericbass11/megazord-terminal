# Bugs — Mission Engine

Opened by `/executar-qa` on 2026-08-06 against `1f2d709`. Both are in the documents the adherence
check governs; nothing in `engine/` is at fault.

## BUG-1 — Two `_Avoid_` words are live in `prd.md` prose, escaping the scan through inflection

- **Criterion**: acceptance criterion 8 of `prd.md` — "a test fails when a term listed under
  `_Avoid_` in `CONTEXT.md` is used **to name a domain concept**: … a word in `docs/prd/` and
  `docs/adr/` prose outside fenced code."
- **Observed**: two words `CONTEXT.md` lists under `_Avoid_`, neither of them in
  `PROSE_EXEMPTIONS`, sit in `prd.md` prose outside any fence and are not reported, because
  `proseMatcher` matches whole words and both appear inflected:
  - `docs/prd/mission-engine/prd.md:109` — "wrong assumptions about how real **agents** behave".
    `agent` is `_Avoid_` under **Zord**. `\bagent\b` does not match `agents`.
  - `docs/prd/mission-engine/prd.md:113` — "designed for **auditing** needs no one has expressed
    yet". `audit` is `_Avoid_` under **Replay**, and the sentence is about the Replay — the concept
    that word is avoided for. `\baudit\b` does not match `auditing`.

  The delivery's stated policy for these two words is **reword**, not exempt: `tools/glossary-check.ts`
  says so in its own docstring ("`agent`, `audit`, `history`, `obligation` and `debt` all appeared in
  the PRD and the techspec … every one of them was a real hit … Those lines were reworded"), and
  `CLAUDE.md` records the rewordings — `agent execution enters through the edges` became
  `Zord execution`, and the Replay described three times as `the audit surface` became
  `the Replay itself is a reader`. Every singular form was reworded. These two inflected forms
  were left, and the matcher cannot see them, so nothing said so.

  `CLAUDE.md` declares the **class** of hole ("The adherence scan matches words, so inflections escape
  it") and prescribes the remedy: "when a violation slips through in a plural or a verb form, add that
  form to the `_Avoid_` list rather than making the matcher smarter". What it does not declare is that
  the class has live instances in the tree — Task 10 discovered the hole by planting `dispatches` and
  never swept the documents for words already there. That sweep is what found these.
- **Expected**: no un-exempted `_Avoid_` word naming a domain concept in `docs/prd/` or `docs/adr/`
  prose, in any form. Either reword both lines, or add `agents` and `auditing` to the `_Avoid_` lists
  of **Zord** and **Replay** in `CONTEXT.md` as `CLAUDE.md` prescribes — after which the check fails
  until the lines are reworded, which is the point.
- **Evidence**: the whole-word matcher is `proseMatcher` in `tools/glossary-check.ts:468-473`, built as
  `new RegExp(\`\\b${parts.join("[\\s-]+")}\\b\`, flags)`. Scanning `prdDocuments()` and
  `adrDocuments()` for `<word> + {s,es,ed,ing,al,ly}` over every non-exempt `_Avoid_` entry:

  ```
  [agent -> agents]   docs/prd/mission-engine/prd.md:109 :: real agents behave. Mitigated by keeping
                      every runtime concern behind the   port,
  [audit -> auditing] docs/prd/mission-engine/prd.md:113 :: 3. **The Replay may be over-modelled** if
                      it is designed for auditing needs no one has expressed
  ```

  and the current run is green, so the check does not see them:

  ```
  $ npx vitest run tools/glossary-check.test.ts
   Tests  26 passed (26)
  ```

  For contrast, the same two words in singular form are reported at once — planted into `prd.md` and
  reverted:

  ```
  docs/prd/mission-engine/prd.md:154 uses "worker" (_Avoid_ under Zord) in: …
  ```
- **Status**: open

## BUG-2 — Three prose exemptions excuse nothing, and the test that claims otherwise measures a synthetic sentence

- **Criterion**: acceptance criterion 8, and the standard `tools/glossary-check.ts` sets for itself:
  "An exemption that is not load-bearing is a lie in a list nobody re-reads" (`PROSE_EXEMPTIONS`
  docstring), restated in `glossary-check.test.ts`: "An entry that fails this test is an entry excusing
  nothing, and the honest move then is to delete it, not to keep it 'just in case'."
- **Observed**: scanned across the whole of `docs/prd/` and `docs/adr/` with `PROSE_EXEMPTIONS`
  replaced by `[]`, three of the 33 entries produce **no hit at all** — they excuse nothing in the
  documents the check reads:
  - `interface` — no prose hit. The one place it would have applied, `techspec.md:78` ("The
    **interfaces** agreed before any code is written"), escapes first through the plural, exactly as
    in BUG-1. That line is template vocabulary — `/criar-techspec` itself glosses the Contracts
    section as "the interfaces agreed before code" — so the exemption's category is right; it simply
    never gets reached.
  - `output` — no prose hit. The word lives only in code (`AgentReport.output`), which the name scan
    covers and the prose scan does not read.
  - `block` — no prose hit. Only `blocks` and `blocked` appear, and both escape the matcher.

  The test named "is load-bearing, every entry" cannot catch this: it builds its own carrier sentence,
  `One line that says ${exemption.word} and no more.`, so it passes for any word `CONTEXT.md` avoids,
  whether or not the tree contains it. The test proves the *mechanism* works, not that the entry is
  carrying anything — which is the same gap `CLAUDE.md` warns about for type-level probes ("Falsify at
  the guarantee, not at the test") and the same one Task 10 wrote its real-tree plants to avoid.
- **Expected**: by the module's own rule, an exemption that excuses nothing is deleted. Either drop the
  three entries, or measure load-bearing against `prdDocuments()` and `adrDocuments()` instead of a
  synthetic line, so the table cannot silently accumulate dead entries. If the three are kept
  deliberately — as forward cover for prose not yet written — say so in the `because` string, because
  the current reasons read as though the words were hit.
- **Evidence**: `tools/glossary-check.ts:427-466` (the table), `:286-297` of
  `tools/glossary-check.test.ts` (the falsification). Scanning the real documents with the table
  emptied:

  ```
  total hits with NO exemptions: 175
  distinct words: 30

  === exemptions that carry ZERO real hits in the tree ===
   - interface
   - output
   - block
  ```

  All 30 other distinct words hit at least once, and every one of those is correctly excused — see
  `qa.md`, "The five risky spots, judged", item 4.
- **Status**: open
