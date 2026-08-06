# Bugs — Mission Engine

Round 1 opened BUG-1 and BUG-2 by `/executar-qa` on 2026-08-06 against `1f2d709`. Both are in the
documents the adherence check governs; nothing in `engine/` is at fault.

Round 2 verified both fixes against `c4f2f5f` and opened **BUG-3**, which the fix to BUG-1
introduced. Current state:

| Bug | Status | Verified by QA |
| --- | --- | --- |
| BUG-1 | fixed | yes — Round 2 reproduced the fix at the cause by three independent routes |
| BUG-2 | fixed | yes — Round 2 falsified the corrected test by reinstating the deleted entry |
| BUG-3 | **open** | opened by Round 2 |

## BUG-1 — Two `_Avoid_` words are live in `prd.md` prose, escaping the scan through inflection

- **Criterion**: acceptance criterion 8 of `prd.md` — "a test fails when a term listed under
  `_Avoid_` in `CONTEXT.md` is used **to name a domain concept**: … a word in `docs/prd/` and
  `docs/adr/` prose outside fenced code."
- **Observed**: two words `CONTEXT.md` lists under `_Avoid_`, neither of them in
  `PROSE_EXEMPTIONS`, sit in `prd.md` prose outside any fence and are not reported, because
  `proseMatcher` matches whole words and both appear inflected:
  - `docs/prd/mission-engine/prd.md:109` — "wrong assumptions about how real `agents` behave".
    `agent` is `_Avoid_` under **Zord**. `\bagent\b` does not match `agents`.
  - `docs/prd/mission-engine/prd.md:113` — "designed for `auditing` needs no one has expressed
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
- **Status**: fixed
- **Fix**: the cause was not the two sentences — it was that **nothing could have found them**, so the
  sweep QA performed by hand had no way of being repeated. Two changes, in that order:

  1. `tools/glossary-check.ts` grows every avoided word **forwards** into its own inflections
     (`inflectionsOf`): the word, its plural, its past and its present participle, as a closed set with the
     orthography English needs — `agent`/`agents`, `audit`/`auditing`, `interface`/`interfacing`,
     `history`/`histories`. Only the last word of a multi-word entry bends (`lead agents`, never
     `leads agent`), and both scans use it: `proseMatcher` for prose and `containsRun` for exported names,
     because `export type Squads` publishes a concept exactly as `export type Squad` does.

     This is **not** the stem-based matcher `CLAUDE.md` rules out, and the distinction is mechanical rather
     than a matter of degree. A stemmer cuts a word *back* to a root that unrelated words share, which is
     how `validation` reaches `validateHandoff` and `log` reaches `Catalog`. Growing forwards can only ever
     produce strings that still carry the avoided word: `log`, `logs`, `loged`, `loging` — none of them is
     `Catalog`. Pinned by `does not read a stem or a substring, in any inflection`, which scans
     `Catalogs of validated Handoffs.` with the exemption table **emptied** and reports nothing.

     Measured before it was turned on, because the name scan has no exemption table to absorb a false
     positive: all 135 exported names of `engine/domain/` stay clean, `catalogDefault` included — the
     avoided entry is `defaults`, and growing a word forwards never reaches the shorter `default`.

  2. The two sentences were then reworded, which is the declared policy: `prd.md:109` now reads
     "how real Zords behave", and `prd.md:113` "designed to answer questions no one has asked yet".
     The quotations in this document put the offending forms in inline code spans, which the scan reads as
     quoting rather than naming — the same treatment the techspec's "the reading is `stepsOf`, not
     `project`" already relies on.

  Nothing was added to `CONTEXT.md`. `CLAUDE.md` prescribed adding the inflected form to the `_Avoid_`
  list, and that remedy is what this bug is evidence against: it only ever records the forms someone has
  already tripped over, so the sweep stays manual and the next plural waits for the next QA. It also puts
  matcher mechanics into the one document `CLAUDE.md` reserves for shared vocabulary — a reader picking
  the language up does not need to be told that the plural of a word to avoid is also to be avoided.
  A form the closed set genuinely cannot derive (an irregular plural, a doubled consonant) belongs beside
  the set in `inflectionsOf`, and `CLAUDE.md` now says so. There is no such form today, and an empty table
  for one would be the always-zero field this repository keeps warning about.
- **Proof**:

  ```
  # the fix, before the reword: the check now sees what escaped it
  $ npx vitest run tools/glossary-check.test.ts
  docs/prd/mission-engine/prd.md:109 uses "agent" (_Avoid_ under Zord) in: real agents behave. …
  docs/prd/mission-engine/prd.md:113 uses "audit" (_Avoid_ under Replay) in: … designed for auditing …
  docs/prd/mission-engine/bugs.md:14  uses "agent" (_Avoid_ under Zord) in: …
  docs/prd/mission-engine/bugs.md:16  uses "audit" (_Avoid_ under Replay) in: …
   Tests  1 failed | 25 passed (26)

  # after the reword and the re-quoting
  $ npm test
   Test Files  15 passed (15)
        Tests  458 passed (458)

  # re-armed against the real tree, planted and reverted — every form inflected
  $ printf 'The maestro dispatches subtasks to workers inside squads.\n' >> docs/prd/mission-engine/prd.md
  $ npx vitest run tools/glossary-check.test.ts
  prd.md:154 uses "maestro" (_Avoid_ under Core)        prd.md:154 uses "worker" (_Avoid_ under Zord)
  prd.md:154 uses "dispatch" (_Avoid_ under Delegation) prd.md:154 uses "squad" (_Avoid_ under Combination)
  prd.md:154 uses "subtask" (_Avoid_ under Slice)
   Tests  1 failed | 34 passed (35)
  ```

  `dispatches`, `subtasks`, `workers` and `squads` are all plural, and all five are reported. Before this
  fix that plant produced one hit — `maestro`, the only word in it the matcher could see.

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
- **Status**: fixed
- **Fix**: the test was corrected first, and then the table was made honest against what it reported.

  **The test.** The old `is load-bearing, every entry` was renamed to `excuses the word it names,
  mechanically`, because that is all it ever proved: it writes its own carrier sentence, so it passes for
  any word `CONTEXT.md` avoids. It is kept, unchanged, because the mechanism is worth pinning — it is just
  not the load-bearing claim. Two tests were added beside it:

  - `carries at least one real line of the documents it governs, every entry` scans
    `prdDocuments()` and `adrDocuments()` with the table replaced by `[]`, and fails naming any entry with
    no hit. The failure message says what to do: delete the entry, or say in `because` what prose it is
    cover for.
  - `would report a dead entry, which the mechanical check cannot` falsifies the new test rather than
    asserting it. It derives from the tree a word the glossary avoids and the documents never use, shows
    that the mechanical check passes for it — fires without the table, excused with it — and that the
    real-tree check reports it dead. Without this, "measured against the tree" would be a claim nobody
    had run.

  **The table.** Of the three entries QA found dead, two were not dead at all — they were carriers the
  matcher could not see, which is BUG-1 in the other direction:

  - `interface` is carried by `techspec.md:78`, "The `interfaces` agreed before any code is written". QA
    named this line and said the plural was what hid it. With `inflectionsOf` the line is a real hit and
    the exemption really excuses it.
  - `block` is carried by `prd.md:136` and two lines of `tasks.md`, all of them `blocks`.
  - `output` had no carrier in any form, in any document, and was **deleted**. QA's reading was right: the
    word lives only in `AgentReport`, which is a property name in `engine/ports/` — outside the name scan's
    scope and invisible to the prose scan. The module's own rule then applies without argument. If a later
    PRD writes "the Zord's own `output`", the check will fire and the answer is `Handoff`, which is exactly
    the behaviour the exemption was suppressing for no one.

  One entry was **added**: `directive`, avoided under **Command**, and carried twice by `qa.md` — "75
  `directives` in `engine/` open their comment" and "deletes all three `directives` in one change". Both
  are TypeScript compiler `directives`, category one of this table, and both became visible for the same
  reason `interfaces` did. `qa.md` is QA's document and is not the bugfix's to reword, so the honest move
  is the exemption; without it the check reports a false positive on the file that reproves it.
- **Proof**:

  ```
  # the corrected test, falsified: `output` put back into the table
  $ npx vitest run tools/glossary-check.test.ts
   × carries at least one real line of the documents it governs, every entry
  AssertionError: these exemptions excuse nothing in docs/prd or docs/adr: delete them, or say in
  `because` what prose they are cover for and why that prose is not written yet:
  expected [ 'output' ] to deeply equal []
   Tests  1 failed | 34 passed (35)

  # `output` removed again — the table is honest and every remaining entry has a real carrier
  $ npx vitest run tools/glossary-check.test.ts
   Tests  35 passed (35)
  ```

  The old test cannot produce that red: with `output` in the table it passes, because the sentence it
  measures is one it wrote itself. That is the defect, and the red above is the fix.
- **QA verification (Round 2)**: reproduced independently. The deleted entry was put back into
  `PROSE_EXEMPTIONS` verbatim and the suite run: exactly one test failed — the real-tree one, which
  named the reinstated entry in its message — and the mechanical test it
  replaced was among the 34 that **passed**, with the dead entry sitting in the table. Both halves of
  the defect demonstrated in one run. Reverted; tree verified clean; 35 pass again. Sweeping the real
  documents with the table emptied gives 316 hits across exactly 33 distinct words, so every one of the
  33 entries now has at least one carrier and no hit falls outside the table. Accepted.

## BUG-3 — the fix to BUG-1 made the plural of a glossary term a violation

- **Criterion**: acceptance criterion 8 of `prd.md` — "a test fails when a term listed under `_Avoid_`
  in `CONTEXT.md` is used **to name a domain concept**". A name that *is* the glossary's own term is
  the opposite of that, and PRD open risk 5 names this failure mode directly: "Adherence checks can
  produce false positives". It also breaks the one exemption `namingViolations` documents for itself:
  "a name that is itself a glossary term is never a violation. `Delivery` is a defined term and also
  sits under `_Avoid_` for **Handoff**, so `export type Delivery` is the correct name … and a scan
  without this would reprove the model for using its own vocabulary."
- **Observed**: BUG-1's fix widened the **avoided** side of the name scan into every inflection and
  left the **term** exemption beside it un-widened. `namingViolations` skips a name whose word join is
  exactly a term (`tools/glossary-check.ts:462`, `defined.has(words.join(" "))`), while the avoided
  side matches through `runOf`, whose tail is `inflectionsOf(last)`. So `delivery` reaches `deliveries`
  and `deliveried`, but the term `Delivery` only ever protects the exact word `delivery`:

  ```
  clean  export type Delivery = never;
  FIRES  export type Deliveries = readonly Delivery[];   "delivery" (_Avoid_ under Handoff)
  FIRES  export function deliveriesOf(): void {}         "delivery" (_Avoid_ under Handoff)
  ```

  `Delivery` is a real exported name of `engine/domain/mission.ts`, re-exported from
  `engine/index.ts`, so a collection of them is the ordinary next name someone writes — a Cockpit or
  Cortex PRD reading over many Missions needs exactly `Deliveries` or `deliveriesOf`. There is nowhere
  to excuse it: the name scan has **no exemption table** by decision, so the only two ways out are
  renaming correct code or editing the tool, and renaming correct code to satisfy a scan is how a scan
  gets switched off in its second week — the exact outcome the whole inflection design was argued for.

  Three things bound the defect, and none of them removes it:
  - **Latent, not live.** All 135 exported names of `engine/domain/` pass today; the plural does not
    exist yet.
  - **One word wide.** `delivery` is the only entry in `CONTEXT.md` that is both a defined term and an
    `_Avoid_` word under another term, so `Delivery` is the only collision.
  - **Prose is unaffected.** `proseViolations` filters an avoided entry out entirely when it is a term
    (`:592`), so `delivery` is never enforced in prose in any form. Confirmed: "The deliveries were
    consolidated." and "Two Deliveries, one Mission." both give zero violations. The asymmetry exists
    only in the name scan.
- **Expected**: a name that is the glossary's own term, in any form the same matcher is willing to
  derive, is never a violation. The two sides of the comparison should be widened together — the term
  exemption reading `inflectionsOf` the way the avoided side does — so that `Deliveries` is excused for
  the reason `Delivery` is, rather than by luck of spelling. The fix belongs in `namingViolations`, not
  in `CONTEXT.md` and not in a new exemption table, and it wants a test in the same shape as the
  existing `still does not shorten: 'defaults' is avoided and 'catalogDefault' is still not it` — a
  planted `export type Deliveries` that must stay clean, and a falsification showing it fires when the
  term side is narrowed back.
- **Evidence**: `tools/glossary-check.ts:454-480` (`namingViolations`, the exact-join term skip at
  `:462`), `:199-207` (`runOf`, the inflected avoided side), `:166-189` (`inflectionsOf`),
  `:584-594` (`proseViolations`, where the term filter is applied to the entry instead and prose is
  therefore safe). Reproduced by planting declarations through the module's own exported functions:

  ```
  === glossary TERMS that also sit in some _Avoid_ list ===
    "delivery" is a term AND avoided under Handoff

  === a legitimate PLURAL of such a term, as an exported domain name ===
    clean  export type Delivery
    FIRES  export type Deliveries   -> "delivery" (_Avoid_ under Handoff)
    FIRES  export type Deliveried   -> "delivery" (_Avoid_ under Handoff)

  === prose side, for contrast ===
    0 violation(s)  "The deliveries were consolidated."
    0 violation(s)  "Two Deliveries, one Mission."
  ```

  The delivery's own docstring records the measurement that missed it: the widening "was measured
  against `engine/domain/` before it was turned on — all 135 exported names stay clean". That is true,
  and it is a measurement of the names that exist. It cannot see a name nobody has written yet, which
  is BUG-2's shape in another form — a check measured against what is there rather than against what
  it claims.
- **Status**: open
