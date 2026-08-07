/**
 * The two checks that police the shape of the work rather than a rule of the domain.
 *
 * - **Criterion 9**: a `docs/prd/<slug>/` folder missing `prd.md`, `techspec.md` or `tasks.md` fails. The
 *   flow in `CLAUDE.md` is problem → approach → tasks, and a folder with a hole in that sequence is a
 *   delivery whose reasoning was skipped somewhere. Extra files are fine: `qa.md`, `bugs.md` and
 *   `review.md` arrive later in the flow, and `bugs.md` exists only when QA reproved.
 * - **Criterion 10**: no `any` anywhere in `engine/`, and no `@ts-expect-error` except the deliberate
 *   type-level probes.
 *
 * They share a file because they share a nature — a scan over the repository, not a domain rule — and
 * because both are checks `tasks.md` assigns to Task 10. The name says `prd-structure` and the second half
 * is engine hygiene; that is a naming compromise, recorded here rather than hidden.
 *
 * Both checks are pure functions over a listing, plus a reader that produces the real listing. That is
 * what lets a fixture plant a violation: `mkdir`-ing a broken PRD folder into `docs/prd/` to prove a test
 * fails would leave the repository one crashed run away from carrying it.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, codeOf, engineSources, type SourceText } from "./glossary-check";

/* -------------------------------------------------------------------------------------------------
 * Criterion 9 — the PRD folder layout
 * ---------------------------------------------------------------------------------------------- */

/** The three documents every PRD folder owes, in the order the flow produces them. */
const REQUIRED_ARTIFACTS = ["prd.md", "techspec.md", "tasks.md"] as const;

/** One folder under `docs/prd/`, and the file names it holds. */
type PrdFolder = {
  readonly slug: string;
  readonly files: readonly string[];
};

/** `<slug>/<file>` for each required document a folder does not have. */
function missingArtifacts(folders: readonly PrdFolder[]): readonly string[] {
  return folders.flatMap((folder) =>
    REQUIRED_ARTIFACTS.filter((artifact) => !folder.files.includes(artifact)).map(
      (artifact) => `${folder.slug}/${artifact}`,
    ),
  );
}

function prdFolders(): readonly PrdFolder[] {
  const root = join(REPO_ROOT, "docs", "prd");
  return readdirSync(root)
    .sort()
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .map((slug) => ({ slug, files: readdirSync(join(root, slug)).sort() }));
}

describe("PRD folder layout (criterion 9)", () => {
  it("finds every PRD folder in the tree", () => {
    expect(prdFolders().map((folder) => folder.slug)).toContain("mission-engine");
  });

  it("passes clean over docs/prd", () => {
    const missing = missingArtifacts(prdFolders());
    expect(missing, `missing PRD artifacts: ${missing.join(", ")}`).toEqual([]);
  });

  it("fails on a folder with no techspec", () => {
    expect(missingArtifacts([{ slug: "half-thought", files: ["prd.md", "tasks.md"] }])).toEqual([
      "half-thought/techspec.md",
    ]);
  });

  it("fails once per missing document, naming each", () => {
    expect(missingArtifacts([{ slug: "empty", files: [] }])).toEqual([
      "empty/prd.md",
      "empty/techspec.md",
      "empty/tasks.md",
    ]);
  });

  it("does not mind the documents that arrive later in the flow", () => {
    expect(
      missingArtifacts([
        { slug: "complete", files: ["bugs.md", "prd.md", "qa.md", "review.md", "tasks.md", "techspec.md"] },
      ]),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 10 — no `any`, and no stray suppression
 * ---------------------------------------------------------------------------------------------- */

/** Somewhere a scan objects to, in the shape a failing test can print. */
type Objection = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

function objectionsIn(source: SourceText, text: string, matches: RegExp): readonly Objection[] {
  return text
    .split("\n")
    .map((line, index) => ({ file: source.file, line: index + 1, text: line.trim() }))
    .filter((candidate) => matches.test(candidate.text));
}

/**
 * Every use of `any` in code.
 *
 * Comments and string literals are blanked first, and that is not a convenience: the engine mentions
 * `any` twenty-odd times in prose — "the `any[]` that `Array.isArray` narrows an `unknown` to", "beyond
 * any Cap a Mission could have been opened with" — and a check that failed on those would be turned off
 * the same afternoon.
 */
function anyUses(sources: readonly SourceText[]): readonly Objection[] {
  return sources.flatMap((source) => objectionsIn(source, codeOf(source.text), /\bany\b/));
}

/**
 * A comment TypeScript honours as a suppression: the directive has to open the comment, which is exactly
 * when the compiler acts on it. `` `TS2578: Unused '@ts-expect-error' directive` `` written *inside* a
 * sentence is a doc comment talking about the mechanism — nine of those exist in `engine/` — and is not a
 * suppression at all.
 */
const HONOURED_SUPPRESSION = /^(?:\/\/|\/\*)\s*(@ts-expect-error|@ts-ignore|@ts-nocheck)\b(.*)$/;

/**
 * Suppressions that are not deliberate type-level probes.
 *
 * Two rules, and each one names a different way of cheating:
 *
 * 1. **`@ts-expect-error` belongs to a test.** In a source file it would hide a real error from `tsc`,
 *    and `npm run build` is what enforces every guarantee this engine claims. In a test it is the
 *    guarantee's proof — the falsification discipline in `CLAUDE.md` rests on it reporting `TS2578` the
 *    moment the error it expects disappears.
 * 2. **A probe states what it proves.** A bare `// @ts-expect-error` is indistinguishable from a
 *    suppression somebody left behind; the seventy-five in `engine/` all carry a sentence, the shortest
 *    of them 47 characters. Ten is the floor, which admits nothing that reads as an accident.
 *
 * `@ts-ignore` and `@ts-nocheck` are stray wherever they appear. `@ts-ignore` suppresses without ever
 * failing when the error goes away, so it can outlive the problem by years and nothing notices — it is
 * `@ts-expect-error` with the proof removed.
 */
function straySuppressions(sources: readonly SourceText[]): readonly Objection[] {
  return sources.flatMap((source) =>
    source.text
      .split("\n")
      .map((line, index) => ({ file: source.file, line: index + 1, text: line.trim() }))
      .filter((candidate) => {
        const suppression = HONOURED_SUPPRESSION.exec(candidate.text);
        if (suppression === null) {
          return false;
        }
        if (suppression[1] !== "@ts-expect-error") {
          return true;
        }
        if (!source.file.endsWith(".test.ts")) {
          return true;
        }
        const reason = suppression[2].replace(/\*\/\s*$/, "").trim();
        return reason.length < 10;
      }),
  );
}

function printed(objections: readonly Objection[]): string {
  return objections.map((objection) => `${objection.file}:${objection.line} ${objection.text}`).join("\n");
}

function fixture(text: string, file = "engine/domain/planted.ts"): readonly SourceText[] {
  return [{ file, text }];
}

describe("no `any` in the engine (criterion 10)", () => {
  it("passes clean over engine/, tests included", () => {
    const uses = anyUses(engineSources());
    expect(uses, printed(uses)).toEqual([]);
  });

  it("reads the whole engine and not a corner of it", () => {
    const files = engineSources().map((source) => source.file);
    expect(files).toEqual(expect.arrayContaining(["engine/index.ts", "engine/domain/mission.ts"]));
    expect(files).toContain("engine/domain/mission.test.ts");
    expect(files).toContain("engine/ports/agent-runner.ts");
  });

  it("fails on every shape `any` arrives in", () => {
    const planted = [
      "const loose: any = 1;",
      "const forced = value as any;",
      "const list: any[] = [];",
      "function widen<T>(x: T): Array<any> { return [x]; }",
    ].join("\n");

    expect(anyUses(fixture(planted)).map((use) => use.line)).toEqual([1, 2, 3, 4]);
  });

  it("does not object to prose or to a string that says `any`", () => {
    const planted = [
      "// The any[] that Array.isArray narrows an unknown to.",
      "/** Beyond any Cap a Mission could have been opened with. */",
      'const message = "any of these is fine";',
      "const template = `any of these too`;",
      "const notAComment = 6 / 2; // any",
    ].join("\n");

    expect(anyUses(fixture(planted))).toEqual([]);
  });

  it("does not lose code to a regular-expression literal that holds a slash", () => {
    const planted = ["const path = /a\\/\\/b/;", "const loose: any = path;"].join("\n");
    expect(anyUses(fixture(planted)).map((use) => use.line)).toEqual([2]);
  });
});

describe("no stray suppression (criterion 10)", () => {
  it("passes clean over engine/", () => {
    const stray = straySuppressions(engineSources());
    expect(stray, printed(stray)).toEqual([]);
  });

  it("counts the deliberate probes, so this test notices if they vanish", () => {
    const honoured = engineSources().flatMap((source) =>
      source.text.split("\n").filter((line) => HONOURED_SUPPRESSION.test(line.trim())),
    );
    expect(honoured.length).toBeGreaterThan(60);
  });

  it("accepts a probe in a test that says what it proves", () => {
    expect(
      straySuppressions(
        fixture(
          "// @ts-expect-error an unchecked string is not a Briefing: it may say nothing at all\n",
          "engine/domain/mission.test.ts",
        ),
      ),
    ).toEqual([]);
  });

  it("fails on a bare probe, which proves nothing about what it hides", () => {
    expect(
      straySuppressions(fixture("// @ts-expect-error\nconst x = 1;\n", "engine/domain/mission.test.ts")).map(
        (stray) => stray.line,
      ),
    ).toEqual([1]);
  });

  it("fails on a probe in a source file, where it would hide an error from the build", () => {
    expect(
      straySuppressions(
        fixture("// @ts-expect-error this reads like a reason and is still in the wrong file\n"),
      ).map((stray) => stray.line),
    ).toEqual([1]);
  });

  it("fails on @ts-ignore and @ts-nocheck wherever they appear", () => {
    expect(
      straySuppressions(fixture("// @ts-ignore silence it\n", "engine/domain/mission.test.ts")).map(
        (stray) => stray.line,
      ),
    ).toEqual([1]);
    expect(straySuppressions(fixture("// @ts-nocheck\n")).map((stray) => stray.line)).toEqual([1]);
  });

  it("does not mistake a doc comment about the mechanism for a suppression", () => {
    const planted = [
      " * Falsify it and `tsc` reports `TS2578: Unused '@ts-expect-error' directive`.",
      " * Every probe below pairs a @ts-expect-error with the runtime half of the same rule.",
    ].join("\n");

    expect(straySuppressions(fixture(planted, "engine/domain/mission.test.ts"))).toEqual([]);
  });
});
