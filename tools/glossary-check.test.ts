/**
 * Acceptance criterion 8: a test fails when a term listed under `_Avoid_` in `CONTEXT.md` is used to name
 * a domain concept.
 *
 * Two halves, and both are needed. The current tree must pass **clean** — a check that fires on correct
 * code is a check somebody deletes within a week. And a planted violation must **fail** — a check that
 * can only ever pass proves nothing, which is the same standard `CLAUDE.md` sets for a type-level probe.
 * So every rule here is pinned twice: once by the real tree, once by a fixture that breaks it.
 */

import { describe, expect, it } from "vitest";

import {
  MalformedGlossaryError,
  PROSE_EXEMPTIONS,
  adrDocuments,
  domainSources,
  enforceable,
  exportedNamesOf,
  formatViolations,
  formsOf,
  glossaryText,
  inflectionsOf,
  namingViolations,
  parseGlossary,
  prdDocuments,
  proseLinesOf,
  proseMatcher,
  proseViolations,
  wordsOf,
  type Exemption,
  type Glossary,
  type SourceText,
} from "./glossary-check";

const GLOSSARY: Glossary = parseGlossary(glossaryText());

/** A fixture stands where a real file would, so a violation can be planted without editing the tree. */
function planted(text: string, file = "engine/domain/planted.ts"): readonly SourceText[] {
  return [{ file, text }];
}

/** Only the words, so an assertion reads as the rule instead of as a row of line numbers. */
function wordsFlagged(violations: readonly { readonly word: string }[]): readonly string[] {
  return violations.map((violation) => violation.word);
}

describe("the glossary itself", () => {
  it("reads the terms and the words each one avoids", () => {
    expect(GLOSSARY.terms).toContain("Mission");
    expect(GLOSSARY.terms).toContain("Gate decision");
    expect(GLOSSARY.avoided).toEqual(
      expect.arrayContaining([
        { word: "squad", under: "Combination" },
        { word: "agent", under: "Zord" },
        { word: "lead agent", under: "Core" },
      ]),
    );
  });

  it("refuses a document with no terms rather than passing everything", () => {
    expect(() => parseGlossary("# Nothing here\n\nJust prose.\n")).toThrow(MalformedGlossaryError);
  });

  it("refuses an _Avoid_ list that belongs to no term", () => {
    expect(() => parseGlossary("# Glossary\n\n_Avoid_: squad\n")).toThrow(MalformedGlossaryError);
  });

  /**
   * The language policy in `CLAUDE.md` calls the spoken-form table "the single source of truth for that
   * bridge". A term missing from it is a term the team has no agreed way to say out loud, which is how a
   * ubiquitous language dies: the PT-BR conversation invents a word, and the invented word reaches code.
   */
  it("gives every term a spoken form, and every spoken form a term", () => {
    const rows = [...glossaryText().matchAll(/^\|\s*[^|]+\|\s*`?([A-Za-z ]+?)`?\s*\|\s*$/gm)].map((row) =>
      row[1].trim(),
    );

    expect(rows).toEqual(expect.arrayContaining([...GLOSSARY.terms]));
    expect([...GLOSSARY.terms]).toEqual(expect.arrayContaining(rows));
  });
});

describe("splitting a name into words", () => {
  it("splits the casings the engine actually uses", () => {
    expect(wordsOf("MissionEvent")).toEqual(["mission", "event"]);
    expect(wordsOf("resolveHarness")).toEqual(["resolve", "harness"]);
    expect(wordsOf("EXECUTION_CAPABILITY_NAMES")).toEqual(["execution", "capability", "names"]);
    expect(wordsOf("UNOPENED_MISSION")).toEqual(["unopened", "mission"]);
  });

  it("does not stem and does not singularise", () => {
    // `defaults` is avoided under Catalog. `catalogDefault` is not that word, and a scan that decided it
    // was would fail `harness.ts` for naming the level the techspec pinned.
    expect(wordsOf("catalogDefault")).toEqual(["catalog", "default"]);
  });
});

/**
 * BUG-1 was two words sitting in `prd.md` for as long as the check existed, unseen because the scan looked
 * for `agent` and `audit` while the prose said `agents` and `auditing`. The remedy is the matcher growing
 * the avoided word **forwards**, which is the opposite operation from stemming — the one `CLAUDE.md` rules
 * out, because cutting a word back to a shared root is what makes a check fire on `validateHandoff`.
 */
describe("inflections of an avoided word", () => {
  it("grows the word forwards into a closed set of endings", () => {
    expect(new Set(inflectionsOf("agent"))).toEqual(new Set(["agent", "agents", "agented", "agenting"]));
    expect(new Set(inflectionsOf("audit"))).toEqual(new Set(["audit", "audits", "audited", "auditing"]));
    expect(new Set(inflectionsOf("dispatch"))).toEqual(
      new Set(["dispatch", "dispatches", "dispatched", "dispatching"]),
    );
    // A final `e` is dropped before `-ing`, and `-d` alone makes the past: never `interfaceing`.
    expect(new Set(inflectionsOf("interface"))).toEqual(
      new Set(["interface", "interfaces", "interfaced", "interfacing"]),
    );
    // Consonant + `y` pluralises as `-ies`, and takes no `-ing`: `historying` is not a word.
    expect(new Set(inflectionsOf("history"))).toEqual(new Set(["history", "histories", "historied"]));
  });

  it("never shortens a word, which is what keeps it from being a stemmer", () => {
    for (const word of ["log", "validation", "interface", "history", "dispatch", "TODO"]) {
      // Every form keeps the whole word, minus at most the final `e` or `y` English orthography drops.
      const kept = word.replace(/[ey]$/i, "");
      for (const form of inflectionsOf(word)) {
        expect(form.startsWith(kept), `${word} -> ${form}`).toBe(true);
      }
    }
    // The two roots a stemmer would reach for, and the reason it is not allowed to.
    expect(inflectionsOf("validation")).not.toContain("validate");
    expect(inflectionsOf("defaults")).not.toContain("default");
  });

  it("bends only the last word of a multi-word entry", () => {
    // `lead agents`, never `leads agent`: English inflects the noun the phrase ends on.
    expect(proseMatcher("lead agent").test("two lead agents")).toBe(true);
    expect(proseMatcher("lead agent").test("two leads agent")).toBe(false);
  });
});

/**
 * BUG-3 was one question with two answers: the avoided side of the name scan bent the last word into its
 * inflections, and the term exemption beside it compared exact spellings. `formsOf` is the single answer,
 * and this block is what stops the two sides drifting apart again — every side of every comparison in the
 * module reads it, so a form it derives is a form both scans agree about.
 */
describe("what counts as the same word, on both sides", () => {
  it("derives the same forms for a phrase as the matcher does for an entry", () => {
    expect(new Set(formsOf("delivery"))).toEqual(new Set(inflectionsOf("delivery")));
    // A multi-word phrase bends its last word only, and keeps the words as one joined phrase.
    expect(formsOf("gate decision")).toContain("gate decisions");
    expect(formsOf("gate decision")).not.toContain("gates decision");
    expect(formsOf("")).toEqual([]);
  });

  it("agrees with the prose matcher, form by form, for every avoided entry", () => {
    let checked = 0;
    for (const entry of GLOSSARY.avoided) {
      const matcher = proseMatcher(entry.word);
      // One difference, and it is deliberate: prose keeps the capitals the glossary wrote (`TODO` the
      // marker, not `todo` the task status, and `PRs` rather than `PRS`), while `formsOf` lowercases,
      // because an identifier's casing carries no such distinction — `TODO_MARKER` and `todoMarker` are
      // the same name. The forms are the same forms; only the capitals of the stem differ.
      const stem = wordsOf(entry.word).join(" ");
      const written = (form: string): string =>
        entry.word === entry.word.toUpperCase() && form.startsWith(stem)
          ? `${entry.word}${form.slice(stem.length)}`
          : form;
      for (const form of formsOf(entry.word)) {
        expect(matcher.test(`a sentence saying ${written(form)} once`), `${entry.word} -> ${form}`).toBe(true);
        checked += 1;
      }
    }
    // Not vacuous: every entry contributed more than its own spelling, so inflected forms were exercised.
    expect(checked).toBeGreaterThan(GLOSSARY.avoided.length);
  });

  it("agrees with the name scan, form by form, for every avoided entry it enforces", () => {
    let checked = 0;
    for (const entry of enforceable(GLOSSARY)) {
      for (const form of formsOf(entry.word)) {
        checked += 1;
        const name = form
          .split(" ")
          .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
          .join("");
        expect(
          wordsFlagged(namingViolations(GLOSSARY, planted(`export type ${name} = never;`))),
          `${entry.word} -> ${name}`,
        ).toContain(entry.word);
      }
    }
    expect(checked).toBeGreaterThan(enforceable(GLOSSARY).length);
  });
});

describe("what counts as an export", () => {
  it("collects declarations and ignores what a comment says", () => {
    const source = [
      "/** A doc comment that writes export type Squad = never on purpose. */",
      "export type Mission = { readonly status: string };",
      "export function decide(): void {}",
      "export const MODES = ['free'] as const;",
      "export { decide } from './elsewhere';",
    ].join("\n");

    expect(exportedNamesOf(source)).toEqual([
      { name: "Mission", line: 2 },
      { name: "decide", line: 3 },
      { name: "MODES", line: 4 },
    ]);
  });
});

describe("exported domain names (criterion 8)", () => {
  it("passes clean over engine/domain", () => {
    const violations = namingViolations(GLOSSARY, domainSources());
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("fails on a planted name that takes an avoided word", () => {
    const violations = namingViolations(
      GLOSSARY,
      planted(
        [
          "export type Squad = { readonly zords: readonly string[] };",
          "export function dispatchSlice(): void {}",
          "export const AGENT_LIST = [] as const;",
        ].join("\n"),
      ),
    );

    expect(violations).toEqual([
      { file: "engine/domain/planted.ts", line: 1, word: "squad", under: "Combination", named: "Squad" },
      {
        file: "engine/domain/planted.ts",
        line: 2,
        word: "dispatch",
        under: "Delegation",
        named: "dispatchSlice",
      },
      { file: "engine/domain/planted.ts", line: 3, word: "agent", under: "Zord", named: "AGENT_LIST" },
      { file: "engine/domain/planted.ts", line: 3, word: "agent list", under: "Roster", named: "AGENT_LIST" },
    ]);
  });

  it("matches a multi-word entry only as consecutive words", () => {
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export type LeadAgent = never;")))).toEqual([
      "lead agent",
      "agent",
    ]);
    // The same two words, not adjacent: `lead agent` no longer applies, `agent` still does.
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export type LeadZordAgent = never;")))).toEqual([
      "agent",
    ]);
  });

  it("never reproves a name that is itself a glossary term", () => {
    // `Delivery` is a defined term and also sits under `_Avoid_` for Handoff. `export type Delivery` is
    // the right name for the consolidated outcome of a Mission.
    expect(namingViolations(GLOSSARY, planted("export type Delivery = { readonly summary: string };"))).toEqual(
      [],
    );
  });

  it("proves that exemption is what is carrying the Delivery case, not blindness", () => {
    const withoutDelivery: Glossary = {
      terms: GLOSSARY.terms.filter((term) => term !== "Delivery"),
      avoided: GLOSSARY.avoided,
    };

    expect(wordsFlagged(namingViolations(withoutDelivery, planted("export type Delivery = never;")))).toEqual([
      "delivery",
    ]);
  });

  /**
   * BUG-3. `delivery` is avoided under **Handoff** and `Delivery` is a defined term — the glossary's only
   * such collision — and after inflection landed, the avoided side reached `deliveries` while the term side
   * still compared exact spellings. So the plural of the model's own vocabulary was a violation with
   * nowhere to be excused, since this scan has no exemption table and will not grow one. `enforceable`
   * settles it once, for both scans: an entry that is itself a term is not enforced, in any form.
   */
  it("never reproves an inflection of a glossary term, which is what BUG-3 was", () => {
    for (const declaration of [
      "export type Delivery = { readonly summary: string };",
      "export type Deliveries = readonly Delivery[];",
      "export function deliveriesOf(): void {}",
      "export type DeliveryId = never;",
      "export const DELIVERIES = [] as const;",
    ]) {
      const violations = namingViolations(GLOSSARY, planted(declaration));
      expect(violations, formatViolations(violations)).toEqual([]);
    }
  });

  it("proves the term is what carries every one of those, not blindness", () => {
    const withoutDelivery: Glossary = {
      terms: GLOSSARY.terms.filter((term) => term !== "Delivery"),
      avoided: GLOSSARY.avoided,
    };

    for (const declaration of [
      "export type Delivery = never;",
      "export type Deliveries = never;",
      "export function deliveriesOf(): void {}",
      "export type DeliveryId = never;",
    ]) {
      expect(wordsFlagged(namingViolations(withoutDelivery, planted(declaration))), declaration).toEqual([
        "delivery",
      ]);
    }
  });

  it("still fires on an inflection of a word that is only avoided", () => {
    // The other direction of the same widening: a term is excused, a word that is merely avoided is not.
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export type Subagents = never;")))).toEqual([
      "subagent",
    ]);
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export type SquadRosters = never;")))).toEqual([
      "squad",
    ]);
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export function workersOf(): void {}")))).toEqual([
      "worker",
    ]);
  });

  it("enforces exactly the list the prose scan does, terms subtracted once", () => {
    const terms = new Set(GLOSSARY.terms.flatMap((term) => formsOf(term)));
    const dropped = GLOSSARY.avoided.filter((entry) => !enforceable(GLOSSARY).includes(entry));

    // Derived from CONTEXT.md on every run, not listed here: a term added or removed moves this with no
    // edit to the module. Today it drops exactly one entry, and `delivery` is the glossary's own term.
    expect(dropped.map((entry) => `${entry.word} (${entry.under})`)).toEqual(["delivery (Handoff)"]);
    expect(enforceable(GLOSSARY).filter((entry) => terms.has(wordsOf(entry.word).join(" ")))).toEqual([]);
    expect(enforceable(GLOSSARY).map((entry) => entry.word)).toContain("squad");
    // And the prose scan is silent on the same word, in every form, which it always was.
    expect(proseViolations(GLOSSARY, planted("Two Deliveries, one Mission.", "docs/prd/x/prd.md"), [])).toEqual([]);
  });

  /**
   * The one thing `enforceable` cannot express, kept because it is what stops the next false positive: a
   * **multi-word** term one of whose words is avoided elsewhere. The entry stays enforceable — `log` is
   * avoided under **Fact** and **Replay** and is not a term — while the name is still the glossary's own,
   * so the whole-name rule carries it, and it reads `formsOf` for the same reason `enforceable` does.
   * There is no such term today; a synthetic glossary is the only way to exercise the branch, and a branch
   * nothing exercises is a branch that rots.
   */
  it("excuses a multi-word term in any form, which is the case a term subtraction cannot reach", () => {
    const withSessionLog: Glossary = { terms: [...GLOSSARY.terms, "Session Log"], avoided: GLOSSARY.avoided };

    expect(namingViolations(withSessionLog, planted("export type SessionLog = never;"))).toEqual([]);
    expect(namingViolations(withSessionLog, planted("export type SessionLogs = never;"))).toEqual([]);
    // The same two names against the real glossary, where `Session Log` is nobody's term.
    expect([...new Set(wordsFlagged(namingViolations(GLOSSARY, planted("export type SessionLogs = never;"))))]).toEqual(
      ["session", "log"],
    );
  });

  it("catches an inflected name: a plural publishes the concept just as the singular does", () => {
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export type Squads = readonly string[];")))).toEqual([
      "squad",
    ]);
    expect(wordsFlagged(namingViolations(GLOSSARY, planted("export function dispatching(): void {}")))).toEqual([
      "dispatch",
    ]);
  });

  it("still does not shorten: `defaults` is avoided and `catalogDefault` is still not it", () => {
    // The precedence level the techspec pins. Inflection grows a word forwards, so the avoided `defaults`
    // never reaches the singular `default` this name ends on.
    expect(namingViolations(GLOSSARY, planted("export const catalogDefault = 1;"))).toEqual([]);
  });

  it("does not read a stem: validateHandoff is not validation", () => {
    // Recorded in CLAUDE.md: `validateHandoff` names a judgement of a Handoff, not a Gate. A stem-based
    // scan would flag it, which is why this one is not stem-based.
    expect(namingViolations(GLOSSARY, planted("export function validateHandoff(): void {}"))).toEqual([]);
  });

  it("does not read a substring: Catalog is not log", () => {
    expect(namingViolations(GLOSSARY, planted("export type CatalogEntry = never;"))).toEqual([]);
  });

  /**
   * The scope of the scan is `engine/domain/`, and this is the pair of assertions that makes that a
   * decision rather than an oversight. `AgentRunner` is techspec-pinned and names a boundary, not a Zord;
   * the honest way to say so is to scan the domain, where a name really does claim to be a concept.
   */
  it("leaves the ports and adapters out of scope, and the word live", () => {
    const port = "export interface AgentRunner { run(): Promise<void>; }";
    expect(wordsFlagged(namingViolations(GLOSSARY, planted(port, "engine/ports/agent-runner.ts")))).toEqual([
      "agent",
    ]);
    expect(domainSources().map((source) => source.file)).not.toContain("engine/ports/agent-runner.ts");
    expect(domainSources().map((source) => source.file)).toContain("engine/domain/mission.ts");
  });

  it("leaves the tests out of scope: a test exports nothing that claims to be a concept", () => {
    expect(domainSources().map((source) => source.file)).not.toContain("engine/domain/mission.test.ts");
  });
});

describe("PRD prose (criterion 8)", () => {
  it("passes clean over docs/prd", () => {
    const violations = proseViolations(GLOSSARY, prdDocuments());
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("passes clean over docs/adr as well", () => {
    // Not required by criterion 8, which names `engine/` and `docs/prd/`. Included because an ADR records
    // a decision about the domain, so it is prose that names domain concepts by definition. Both hits it
    // found on its first run were reworded: "the signal being one word" and "once the Mission is
    // terminal".
    const violations = proseViolations(GLOSSARY, adrDocuments());
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("fails on planted prose that names a domain concept with an avoided word", () => {
    const violations = proseViolations(
      GLOSSARY,
      planted("The squad hands a subtask to a worker, who reports to the maestro.", "docs/prd/planted/prd.md"),
    );

    expect([...wordsFlagged(violations)].sort()).toEqual(["maestro", "squad", "subtask", "worker"]);
    expect(violations[0]).toEqual({
      file: "docs/prd/planted/prd.md",
      line: 1,
      word: "maestro",
      under: "Core",
      named: "The squad hands a subtask to a worker, who reports to the maestro.",
    });
  });

  /**
   * BUG-1: both of these forms sat in `prd.md` and the check said nothing. The singulars had been
   * reworded when this module was written; the plural and the participle were never looked for, because
   * the matcher could not have found them.
   */
  it("fails on an inflected form, which is what BUG-1 escaped through", () => {
    const document = planted(
      "Wrong assumptions about how real agents behave, and auditing needs no one has expressed.",
      "docs/prd/planted/prd.md",
    );
    expect([...wordsFlagged(proseViolations(GLOSSARY, document))].sort()).toEqual(["agent", "audit"]);
  });

  it("does not read a stem or a substring, in any inflection", () => {
    // Scanned with the exemption table emptied, so nothing here is being excused: a stem-based scan would
    // flag `Catalogs` for `log` and `validated` for `validation`, and this one flags neither.
    expect(
      proseViolations(GLOSSARY, planted("Catalogs of validated Handoffs.", "docs/prd/planted/prd.md"), []),
    ).toEqual([]);
  });

  it("reads a fenced code block as code, not as prose", () => {
    const document = ["Before the fence.", "```ts", "export type Squad = never;", "```", "After it."].join("\n");
    expect(proseViolations(GLOSSARY, planted(document, "docs/prd/planted/techspec.md"))).toEqual([]);
    expect(proseLinesOf(document).map((prose) => prose.line)).toEqual([1, 5]);
  });

  it("reads an inline code span and a link target as code, not as prose", () => {
    const document = "The reading of `squad` lives in [here](docs/prd/squad/prd.md).";
    expect(proseViolations(GLOSSARY, planted(document, "docs/prd/planted/techspec.md"))).toEqual([]);
    // The same word outside a span is a violation: the span and the link target are what were carrying it.
    expect(
      wordsFlagged(proseViolations(GLOSSARY, planted("A reading of squad.", "docs/prd/planted/prd.md"))),
    ).toEqual(["squad"]);
  });

  /**
   * QA's caveat 12, which had no test: a code span is delimited by a run of backticks and Markdown lets one
   * wrap across a line break, so stripping spans a line at a time leaves an unmatched tick on each line.
   * The stray closing tick then pairs with the *next* opening tick on its own line, which blanks the
   * ordinary prose between them and leaves the following span exposed — both error directions from one
   * wrapped span. Four such spans are live in `docs/prd/`, and this one cost QA two reproved runs on its
   * own document.
   */
  it("reads a code span that wraps across a line break as one span", () => {
    const document = ["The old `is load-bearing,", "every entry` was renamed, and `squad` is quoted here."].join(
      "\n",
    );

    expect(proseViolations(GLOSSARY, planted(document, "docs/prd/x/prd.md"))).toEqual([]);
    expect(proseLinesOf(document).map((prose) => prose.text).join(" ")).not.toContain("squad");
    // Both lines survive as prose, with their numbers, and the words outside the span are still read.
    expect(proseLinesOf(document).map((prose) => prose.line)).toEqual([1, 2]);
    expect(proseLinesOf(document)[1].text).toContain("was renamed");

    // And the falsification: stripping the same document a line at a time — what this used to do — leaves
    // `squad` standing as prose, which is how a quoted word became a violation.
    const lineByLine = document
      .split("\n")
      .map((raw) => raw.replace(/``[^`]*``/g, " ").replace(/`[^`]*`/g, " "))
      .join(" ");
    expect(lineByLine).toContain("squad");
  });

  it("leaves an unmatched backtick literal rather than blanking what follows it", () => {
    // Markdown renders a lone tick as a tick. A scan that read it as an opening delimiter would blank the
    // rest of the paragraph and under-report, which is the worse of the two failures.
    expect(
      wordsFlagged(proseViolations(GLOSSARY, planted("A stray ` tick, and a squad after it.", "docs/prd/x/prd.md"))),
    ).toEqual(["squad"]);
  });

  it("does not let a span cross a blank line, so one stray tick cannot swallow a document", () => {
    const document = ["An open ` tick.", "", "Then a squad, and a closing ` tick."].join("\n");
    const violations = proseViolations(GLOSSARY, planted(document, "docs/prd/x/prd.md"));

    expect(wordsFlagged(violations)).toEqual(["squad"]);
    expect(violations[0].line).toBe(3);
  });

  /**
   * QA's caveat 13, closed in review. A fence ends a paragraph exactly as a blank line does, so the two
   * unmatched runs around one must stay literal. They did not: fenced lines were dropped *before* spans
   * were found, which made the line before a fence adjacent to the line after it, so the ticks paired
   * across the fence and blanked the prose in between — under-reporting, which is the failure this module
   * says is the worse of the two.
   */
  it("does not let a span pair across a fence, so a real word between two ticks is still read", () => {
    const fence = "```";
    const document = [
      "A ` tick, then a fence with no blank line around it:",
      `${fence}ts`,
      "const x = 1;",
      fence,
      "A squad here, and another ` tick.",
    ].join("\n");

    const violations = proseViolations(GLOSSARY, planted(document, "docs/prd/x/prd.md"));

    expect(wordsFlagged(violations)).toEqual(["squad"]);
    expect(violations[0].line).toBe(5);
    // The fenced lines are still out of the scan, and the prose lines keep their own numbers.
    expect(proseLinesOf(document).map((prose) => prose.line)).toEqual([1, 5]);
    expect(proseLinesOf(document)[0].text).toContain("fence with no blank line");
  });

  it("keeps CONTEXT.md out of scope, which is the only reason a clean run is possible", () => {
    expect(prdDocuments().map((document) => document.file)).not.toContain("CONTEXT.md");
    expect(prdDocuments().map((document) => document.file)).toContain("docs/prd/mission-engine/prd.md");
    // Scanning the glossary would flag every `_Avoid_` line it defines. Left in scope, the check would
    // fail on the file that states the rule.
    const itself = proseViolations(GLOSSARY, [{ file: "CONTEXT.md", text: glossaryText() }]);
    expect(itself.length).toBeGreaterThan(0);
  });

  it("means the capitals when the glossary writes capitals", () => {
    // `TODO` is avoided under Gap as the code marker. `todo` is the status vocabulary of `tasks.md`.
    expect(wordsFlagged(proseViolations(GLOSSARY, planted("A TODO left in a PRD body.", "docs/prd/x/prd.md")))).toEqual(
      ["TODO"],
    );
    expect(proseViolations(GLOSSARY, planted("- **Status**: todo", "docs/prd/x/tasks.md"))).toEqual([]);
  });
});

describe("the prose exemptions", () => {
  it("names only words CONTEXT.md really avoids", () => {
    const avoided = new Set(GLOSSARY.avoided.map((entry) => entry.word.toLowerCase()));
    const fictional = PROSE_EXEMPTIONS.filter((exemption) => !avoided.has(exemption.word.toLowerCase()));

    expect(fictional.map((exemption) => exemption.word)).toEqual([]);
  });

  it("states a reason for each one", () => {
    const silent = PROSE_EXEMPTIONS.filter((exemption) => exemption.because.trim().length < 10);
    expect(silent.map((exemption) => exemption.word)).toEqual([]);
  });

  /**
   * Half the claim, and the weaker half: the **mechanism** excuses the word. Scanned with no exemptions the
   * word fires; scanned with the table it does not. This proves `proseViolations` honours the entry — it
   * says nothing about whether the entry is needed, because the carrier sentence is one the test writes
   * itself. That was BUG-2, and the test below is the other half.
   */
  it("excuses the word it names, mechanically", () => {
    for (const exemption of PROSE_EXEMPTIONS) {
      const document = planted(`One line that says ${exemption.word} and no more.`, "docs/prd/x/prd.md");

      expect(wordsFlagged(proseViolations(GLOSSARY, document, [])), `${exemption.word} is not fired at all`).toContain(
        exemption.word,
      );
      expect(wordsFlagged(proseViolations(GLOSSARY, document)), `${exemption.word} is not excused`).not.toContain(
        exemption.word,
      );
    }
  });

  /**
   * The load-bearing claim, measured where `CLAUDE.md` says to measure it: at the guarantee, not at the
   * test. The documents this check governs are the only place an exemption can be carrying anything, so
   * they are what the scan reads. An entry with no line to excuse is deleted — `output` was, and it is the
   * whole reason this test exists rather than the one above it.
   */
  it("carries at least one real line of the documents it governs, every entry", () => {
    const governed = [...prdDocuments(), ...adrDocuments()];
    const carried = new Set(
      proseViolations(GLOSSARY, governed, []).map((violation) => violation.word.toLowerCase()),
    );
    const dead = PROSE_EXEMPTIONS.filter((exemption) => !carried.has(exemption.word.toLowerCase()));

    expect(
      dead.map((exemption) => exemption.word),
      "these exemptions excuse nothing in docs/prd or docs/adr: delete them, or say in `because` what " +
        "prose they are cover for and why that prose is not written yet",
    ).toEqual([]);
  });

  /**
   * And the falsification of the test itself. A word `CONTEXT.md` avoids and the documents never use would
   * pass the mechanical check — it fires without the table and is excused with it — and be reported dead by
   * the real-tree check. Without this, "measured against the tree" would be a claim nobody had run.
   */
  it("would report a dead entry, which the mechanical check cannot", () => {
    const governed = [...prdDocuments(), ...adrDocuments()];
    const carried = new Set(
      proseViolations(GLOSSARY, governed, []).map((violation) => violation.word.toLowerCase()),
    );
    const uncarried = GLOSSARY.avoided.filter((entry) => !carried.has(entry.word.toLowerCase()));
    expect(uncarried.length, "every avoided word is live in the documents, so nothing can be dead").toBeGreaterThan(0);

    const invented: Exemption = { word: uncarried[0].word, because: "a reason long enough to pass the reason check" };
    const document = planted(`One line that says ${invented.word} and no more.`, "docs/prd/x/prd.md");

    // Passes the mechanical check, exactly as `output` did.
    expect(wordsFlagged(proseViolations(GLOSSARY, document, []))).toContain(invented.word);
    expect(wordsFlagged(proseViolations(GLOSSARY, document, [invented]))).not.toContain(invented.word);
    // And is dead against the tree.
    expect(carried.has(invented.word.toLowerCase())).toBe(false);
  });
});
