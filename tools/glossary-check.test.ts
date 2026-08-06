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
  exportedNamesOf,
  formatViolations,
  glossaryText,
  namingViolations,
  parseGlossary,
  prdDocuments,
  proseLinesOf,
  proseViolations,
  wordsOf,
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
   * Each exemption is falsified the way `CLAUDE.md` demands of a type-level proof: break it and confirm
   * the thing it claims to hold really stops holding. Scanned with no exemptions, every one of these words
   * fires; scanned with the table, none does. An entry that fails this test is an entry excusing nothing,
   * and the honest move then is to delete it, not to keep it "just in case".
   */
  it("is load-bearing, every entry", () => {
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
});
