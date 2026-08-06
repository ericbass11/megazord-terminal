/**
 * The glossary adherence check: acceptance criterion 8 of `docs/prd/mission-engine/prd.md`.
 *
 * `CONTEXT.md` lists, under each term, the words that must **not** be used to name that concept. This
 * module is what makes that list cost something. It is a library of pure functions plus a handful of
 * readers, so `glossary-check.test.ts` can drive it with planted fixtures instead of only ever asserting
 * that the current tree is clean — a check that can only pass proves nothing.
 *
 * ## What is scanned, and why it is not everything
 *
 * An `_Avoid_` entry means "do not use this word **to name this concept**". It is not a banned-word
 * list, and this is not a rule a naive scan can implement: twelve of the current entries are TypeScript
 * keywords or ordinary technical vocabulary (`type`, `interface`, `function`, `kind`, `input`, `output`,
 * `result`, `module`, `context`, `level`, `log`, `block`), and `interface AgentRunner` and
 * `kind: "accepted"` are both correct code. So there are exactly two scans:
 *
 * 1. **Exported symbol names in `engine/domain/`** — the names that claim to *be* a concept. Never raw
 *    code tokens. A file's local variables, its property names and its prose are all out: an exported
 *    name is the only thing that publishes a word as the name of a domain concept.
 * 2. **Prose in `docs/prd/`** — with fenced code blocks, inline code spans and link targets removed,
 *    because those quote identifiers and paths rather than naming anything.
 *
 * `CONTEXT.md` itself is never scanned: it is the file that lists the words, so every `_Avoid_` line is
 * a hit by construction. Neither is `docs/PRODUTO.md` — the site pre-dates this flow and SDD applies
 * forward only (PRD, out of scope 7).
 *
 * `engine/ports/` and `engine/adapters/` are outside the symbol scan, and that is the reason the scope
 * is written the way it is: `AgentRunner`, `AgentRun`, `AgentReport` and `fakeAgentRunner` all carry
 * `agent`, which sits under `_Avoid_` for **Zord**, and `AgentRun.instruction` carries `instruction`,
 * which sits under `_Avoid_` for **Skill**. Both names are pinned by the techspec, and both name a
 * boundary rather than a domain concept — a port is named after the thing on the other side of it. The
 * honest way to say that is a scope, not an exemption list that would also excuse a domain file.
 *
 * ## Matching
 *
 * Words, never substrings and never stems. `Catalog` contains `log`; `validateHandoff` contains no
 * `validation` but a stem-based scan would claim it does; `catalogDefault` is not the avoided
 * `defaults`. So an identifier is split into words (`camelCase`, `PascalCase`, `SNAKE_CASE`, `kebab`)
 * and an avoided word matches only as a whole word, or as a consecutive run of words for a multi-word
 * entry such as `lead agent`. Prose matches on word boundaries for the same reason. An entry written in
 * capitals — `TODO`, `PR` — matches case-sensitively, because capitals are what the glossary meant: the
 * code marker `TODO`, not the `todo` that is a task status in `tasks.md`.
 *
 * A whole word, but **every inflection of it**: see `inflectionsOf`. `agents` and `auditing` sat in
 * `prd.md` for as long as this check existed and it never said so, because it looked for `agent` and
 * `audit`. Growing the word forwards into its own plural and verb forms is the opposite operation from
 * stemming, which cuts a word back to a root it shares with unrelated words — that is what would flag
 * `validateHandoff` for `validation`. `Catalog` is still not `log`, `logs`, `logged` or `logging`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/* -------------------------------------------------------------------------------------------------
 * The glossary
 * ---------------------------------------------------------------------------------------------- */

/** One word `CONTEXT.md` says not to use, and the term whose `_Avoid_` list it sits under. */
export type AvoidedWord = {
  readonly word: string;
  readonly under: string;
};

/** The two things this check reads out of `CONTEXT.md`: the defined terms, and the avoided words. */
export type Glossary = {
  readonly terms: readonly string[];
  readonly avoided: readonly AvoidedWord[];
};

/** Thrown when `CONTEXT.md` cannot be read as a glossary at all — a silent empty scan is worse. */
export class MalformedGlossaryError extends Error {
  constructor(what: string) {
    super(`CONTEXT.md is not a readable glossary: ${what}`);
    this.name = "MalformedGlossaryError";
  }
}

const TERM_HEADING = /^\*\*(.+?)\*\*:\s*$/;
const AVOID_LIST = /^_Avoid_:\s*(.+?)\s*$/;

/**
 * Reads the glossary out of `CONTEXT.md`.
 *
 * The shape it depends on is the one `CLAUDE.md` mandates: a term is a line of `**Term**:` on its own,
 * and its avoided words are a following `_Avoid_: a, b, c` line. An `_Avoid_` list before any term, or a
 * document with no terms at all, throws rather than yielding a scan that passes everything.
 */
export function parseGlossary(markdown: string): Glossary {
  const terms: string[] = [];
  const avoided: AvoidedWord[] = [];
  let under = "";

  for (const line of markdown.split("\n")) {
    const heading = TERM_HEADING.exec(line);
    if (heading !== null) {
      under = heading[1].trim();
      terms.push(under);
      continue;
    }

    const avoid = AVOID_LIST.exec(line);
    if (avoid === null) {
      continue;
    }
    if (under === "") {
      throw new MalformedGlossaryError("an _Avoid_ list appears before any term");
    }
    for (const entry of avoid[1].split(",")) {
      const word = entry.trim();
      if (word !== "") {
        avoided.push({ word, under });
      }
    }
  }

  if (terms.length === 0) {
    throw new MalformedGlossaryError("no term headings found");
  }
  if (avoided.length === 0) {
    throw new MalformedGlossaryError("no _Avoid_ lists found");
  }
  return { terms, avoided };
}

/* -------------------------------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------------------------- */

/**
 * Splits an identifier or a phrase into lowercase words.
 *
 * `MissionEvent` → `mission event`; `EXECUTION_CAPABILITY_NAMES` → `execution capability names`;
 * `resolveHarness` → `resolve harness`; `lead agent` → `lead agent`. Deliberately no stemming and no
 * singularising: `defaults` is avoided and `catalogDefault` is not it, and stemming is exactly how a
 * check starts failing on correct code and gets deleted.
 */
export function wordsOf(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

/**
 * Every inflection of one word: the word itself, its plural, its past and its present participle.
 *
 * This is what closes the hole BUG-1 was: the scan matched whole words, so `agent` was caught and
 * `agents` was not, and nobody had swept the documents for a form the matcher could not see. Sweeping by
 * hand fixes the day it is done; growing the matcher forwards makes the sweep happen on every
 * `npm test`.
 *
 * It is **not** stemming, and the difference is the whole reason this is safe. A stemmer cuts a word back
 * to a root that unrelated words share — which is how `validation` would reach `validateHandoff` and `log`
 * would reach `Catalog`, and how a check gets switched off in its second week. This goes the other way:
 * from the exact word the glossary wrote, forwards, into a **closed** set of endings. Every form it
 * produces still has the avoided word as its own prefix, so nothing it matches is a different word.
 *
 * Deliberately incomplete, and it must stay small enough to read: no irregular plurals (`indices`), no
 * doubled consonants (`logging`), no `-al`/`-ly` derivations (`typeal` is not a word and `historical` is a
 * different one). A form it cannot derive is added here, beside the set, and never to `CONTEXT.md` — the
 * glossary is for the team's vocabulary, not for the matcher's mechanics.
 */
export function inflectionsOf(word: string): readonly string[] {
  const forms = new Set<string>([word]);

  if (/[^aeiou]y$/i.test(word)) {
    // `history` → `histories`, not `historys`.
    const stem = word.slice(0, -1);
    forms.add(`${stem}ies`);
    forms.add(`${stem}ied`);
    return [...forms];
  }

  forms.add(/(?:s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);

  if (/e$/i.test(word)) {
    // `interface` → `interfaced`, `interfacing`; the final `e` is dropped, not doubled.
    forms.add(`${word}d`);
    forms.add(`${word.slice(0, -1)}ing`);
  } else {
    forms.add(`${word}ed`);
    forms.add(`${word}ing`);
  }

  return [...forms];
}

/** The words of an avoided entry, split so the last one can be matched in any inflection. */
type AvoidedRun = {
  /** Every word but the last, matched exactly — `lead` of `lead agent`. */
  readonly head: readonly string[];
  /** The last word, in every inflection — `agent`, `agents`, `agented`, `agenting`. */
  readonly tail: ReadonlySet<string>;
};

function runOf(word: string): AvoidedRun {
  const words = wordsOf(word);
  if (words.length === 0) {
    // An entry with no words matches nothing: an empty tail can never contain a word of the name.
    return { head: [], tail: new Set() };
  }
  const last = words[words.length - 1];
  return { head: words.slice(0, -1), tail: new Set(inflectionsOf(last)) };
}

function startsWithRun(within: readonly string[], run: AvoidedRun, at: number): boolean {
  const headMatches = run.head.every((word, offset) => within[at + offset] === word);
  return headMatches && run.tail.has(within[at + run.head.length] ?? "");
}

function containsRun(within: readonly string[], run: AvoidedRun): boolean {
  const span = run.head.length + 1;
  for (let at = 0; at + span <= within.length; at += 1) {
    if (startsWithRun(within, run, at)) {
      return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------------------------------
 * Source text
 * ---------------------------------------------------------------------------------------------- */

/** A file to scan: its repo-relative path, and its content. */
export type SourceText = {
  readonly file: string;
  readonly text: string;
};

/** One thing the scan found, in the shape a failing test can print without further explanation. */
export type Violation = {
  readonly file: string;
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  /**
   * The avoided word, exactly as `CONTEXT.md` writes it — the entry, not the form found. A line saying
   * `agents` is reported as `agent`, because that is the entry a reader has to go and look up; `named`
   * carries the line itself, so the inflection is visible right beside it.
   */
  readonly word: string;
  /** The glossary term whose `_Avoid_` list carries that word. */
  readonly under: string;
  /** The exported name, or the line of prose, that used it. */
  readonly named: string;
};

/** Renders violations for a test failure message: one line each, path first. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${violation.line} uses "${violation.word}" ` +
        `(_Avoid_ under ${violation.under}) in: ${violation.named}`,
    )
    .join("\n");
}

/**
 * Blanks comments and string literals, keeping every line and column so line numbers survive.
 *
 * Needed by both scans. The word `any` appears twenty-odd times in `engine/`, every one of them inside a
 * doc comment — `` the `any[]` that `Array.isArray` narrows to `` — so criterion 10 cannot be checked
 * without this, and a doc comment quoting `export type Squad` must not be read as an export either.
 *
 * Regular-expression literals are tracked too, because a `/` that opens one can otherwise be read as a
 * comment and swallow the rest of a line. The engine holds two of them and neither carries a quote, so
 * this is insurance rather than a fix: getting it wrong would *hide* code from the scan, and a check
 * that under-reports is the failure mode to avoid.
 */
export function codeOf(source: string): string {
  const blanked: string[] = [];
  let at = 0;
  let previous = "";

  const keep = (character: string): void => {
    blanked.push(character);
    if (character.trim() !== "") {
      previous = character;
    }
  };
  const blank = (character: string): void => {
    blanked.push(character === "\n" ? "\n" : " ");
  };

  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1] ?? "";

    if (here === "/" && next === "/") {
      while (at < source.length && source[at] !== "\n") {
        blank(source[at]);
        at += 1;
      }
      continue;
    }

    if (here === "/" && next === "*") {
      const closes = source.indexOf("*/", at + 2);
      const until = closes === -1 ? source.length : closes + 2;
      while (at < until) {
        blank(source[at]);
        at += 1;
      }
      continue;
    }

    if (here === '"' || here === "'" || here === "`") {
      blank(here);
      at += 1;
      while (at < source.length) {
        const inside = source[at];
        if (inside === "\\") {
          blank(inside);
          blank(source[at + 1] ?? "");
          at += 2;
          continue;
        }
        blank(inside);
        at += 1;
        if (inside === here) {
          break;
        }
      }
      previous = "x";
      continue;
    }

    if (here === "/" && canOpenRegExp(previous)) {
      blank(here);
      at += 1;
      while (at < source.length) {
        const inside = source[at];
        if (inside === "\\") {
          blank(inside);
          blank(source[at + 1] ?? "");
          at += 2;
          continue;
        }
        if (inside === "\n") {
          break;
        }
        blank(inside);
        at += 1;
        if (inside === "/") {
          break;
        }
      }
      previous = "x";
      continue;
    }

    keep(here);
    at += 1;
  }

  return blanked.join("");
}

/** After one of these, a `/` opens a regular expression rather than dividing anything. */
function canOpenRegExp(previous: string): boolean {
  return previous === "" || "(,=:[!&|?{};+-*%~^<>".includes(previous);
}

/** An exported name, and the line it is declared on. */
export type ExportedName = {
  readonly name: string;
  readonly line: number;
};

const EXPORTED_DECLARATION =
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|function|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * The names a module exports by declaring them.
 *
 * Re-exports (`export { x } from "./y"`) are not collected: the name is declared, and therefore already
 * scanned, wherever it comes from — counting it twice would only double a violation.
 */
export function exportedNamesOf(source: string): readonly ExportedName[] {
  const found: ExportedName[] = [];
  codeOf(source)
    .split("\n")
    .forEach((line, index) => {
      const declaration = EXPORTED_DECLARATION.exec(line);
      if (declaration !== null) {
        found.push({ name: declaration[1], line: index + 1 });
      }
    });
  return found;
}

/** One line of prose: what is left of it after the code has been taken out. */
export type ProseLine = {
  readonly line: number;
  readonly text: string;
};

/**
 * Markdown with everything that is not prose removed: fenced code blocks, inline code spans and link
 * targets.
 *
 * All three quote something rather than naming it. The techspec's own sentence is the proof that this is
 * required rather than convenient: "The reading is `stepsOf`, not `project`" — the second span is there
 * *because* `project` is avoided, and a scan that read it would fail the document that explains the rule.
 */
export function proseLinesOf(markdown: string): readonly ProseLine[] {
  const prose: ProseLine[] = [];
  let fenced = false;

  markdown.split("\n").forEach((raw, index) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      return;
    }
    const text = raw
      .replace(/``[^`]*``/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\]\([^)]*\)/g, "] ");
    prose.push({ line: index + 1, text });
  });

  return prose;
}

/* -------------------------------------------------------------------------------------------------
 * The two scans
 * ---------------------------------------------------------------------------------------------- */

function termWords(glossary: Glossary): ReadonlySet<string> {
  return new Set(glossary.terms.map((term) => wordsOf(term).join(" ")));
}

/**
 * Scan 1 — exported names in `engine/domain/`.
 *
 * One exemption, and it is not a list: **a name that is itself a glossary term is never a violation.**
 * `Delivery` is a defined term and also sits under `_Avoid_` for **Handoff**, so `export type Delivery`
 * is the correct name for the consolidated outcome of a Mission and a scan without this would reprove
 * the model for using its own vocabulary. Nothing else is exempt here — an exported domain name that
 * carries an avoided word is the thing this check exists to catch.
 *
 * The word matches in every inflection (`inflectionsOf`), the same as in prose: `export type Squads`
 * publishes `squad` as the name of a concept exactly as `export type Squad` does. This scan has no
 * exemption table to absorb a false positive, so the expansion was measured against `engine/domain/`
 * before it was turned on — all 135 exported names stay clean, `catalogDefault` included.
 */
export function namingViolations(glossary: Glossary, sources: readonly SourceText[]): readonly Violation[] {
  const defined = termWords(glossary);
  const avoided = glossary.avoided.map((entry) => ({ ...entry, run: runOf(entry.word) }));
  const violations: Violation[] = [];

  for (const source of sources) {
    for (const exported of exportedNamesOf(source.text)) {
      const words = wordsOf(exported.name);
      if (defined.has(words.join(" "))) {
        continue;
      }
      for (const entry of avoided) {
        if (containsRun(words, entry.run)) {
          violations.push({
            file: source.file,
            line: exported.line,
            word: entry.word,
            under: entry.under,
            named: exported.name,
          });
        }
      }
    }
  }

  return violations;
}

/** A word the prose scan lets through, and the reason it does. Never a blanket ignore. */
export type Exemption = {
  readonly word: string;
  readonly because: string;
};

/**
 * The prose exemptions.
 *
 * Every entry is a word the repository's own documents cannot write around, because in that sentence it
 * is ordinary English, a TypeScript keyword, or the vocabulary the flow uses to talk about itself — not
 * the name of a domain concept. Each one carries its reason, and `glossary-check.test.ts` proves three
 * things about every single one: that it names a word `CONTEXT.md` really does avoid, that the exemption
 * mechanism really excuses it, and that **the tree contains a line it excuses**. An exemption that is not
 * load-bearing is a lie in a list nobody re-reads.
 *
 * That third property is measured against `prdDocuments()` and `adrDocuments()`, which is what makes it
 * evidence. Measured against a sentence the test writes itself, it passed for any word the glossary
 * avoids, and three entries sat here excusing nothing: `interface` and `block`, whose only carriers were
 * `interfaces` and `blocks` and so were invisible until the matcher learned inflections, and `output`,
 * which had no carrier at all and was deleted. The list shrinks when a word stops being needed.
 *
 * What is **not** here is the more interesting list. `agent`, `audit`, `history`, `obligation` and `debt`
 * all appeared in the PRD and the techspec while this check was being written, and every one of them was
 * a real hit: the techspec was defining a Clause as "one obligation", calling the Replay "the audit
 * surface", and putting `agent` where `Zord` belongs. Those lines were reworded — as were `real agents`
 * and `auditing needs`, the two inflected survivors the first pass could not see. Rewording is the answer
 * whenever the prose is naming a domain concept; an exemption is the answer only when it is not.
 */
export const PROSE_EXEMPTIONS: readonly Exemption[] = [
  // TypeScript keywords and ordinary technical vocabulary. Eleven of the twelve CLAUDE.md records, plus
  // `directive`; `output` is gone, because nothing in the documents needed it.
  { word: "type", because: "TypeScript's keyword; prose about a type-level guarantee cannot avoid it" },
  { word: "interface", because: "TypeScript's keyword, and how a port is written" },
  { word: "function", because: "TypeScript's keyword, and what `decide` and `evolve` are" },
  { word: "kind", because: "the discriminant of every union here, and ordinary English: 'of any kind'" },
  { word: "input", because: "ordinary English for what crosses a boundary: 'with no human input'" },
  { word: "directive", because: "a compiler directive, `@ts-expect-error`; a Command is the domain intent" },
  { word: "result", because: "ordinary English for what a call answers: 'the result of decide'" },
  { word: "module", because: "what TypeScript calls a file, and what this PRD calls `engine/`" },
  { word: "context", because: "bounded context, and the name of the glossary file itself" },
  { word: "level", because: "type level, and one precedence level of a Harness resolution" },
  { word: "log", because: "the event log the fold reads; Fact and Replay are the domain concepts" },
  { word: "block", because: "ordinary English: a fenced code block, and what the Cap blocks" },

  // Process vocabulary — how this repo's flow talks about itself, not how the domain is named.
  { word: "task", because: "`tasks.md` and `/executar-task` are this flow; Mission is the domain unit" },
  { word: "review", because: "`/executar-review` is a step of this flow; Gate is the domain checkpoint" },
  { word: "document", because: "'this document', `docs/`; a Skill is an installable instruction block" },
  { word: "spec", because: "`techspec.md`; the Contract is the agreement between Zords" },
  { word: "rule", because: "a domain rule is what `decide` enforces; a Skill is what specialises a Zord" },
  { word: "project", because: "this repository and the Next.js project it holds" },
  { word: "repo", because: "this repository, which the flow travels with" },
  { word: "folder", because: "'a PRD folder' is criterion 9's own wording" },
  { word: "product", because: "'what the product promises', and `docs/PRODUTO.md`" },

  // General English that happens to collide with a term some other concept avoids.
  { word: "cast", because: "a TypeScript type assertion — the reason every runtime guard exists" },
  { word: "memory", because: "'state lives in memory' is RAM; the Cortex is the shared fact memory" },
  { word: "library", because: "an npm dependency, and the engine's having none" },
  { word: "limit", because: "CONTEXT.md defines the Cap itself as 'the spending limit of a Mission'" },
  { word: "config", because: "a machine's global config; a Harness is what a Zord runs with" },
  { word: "setup", because: "a working editor setup, in the reason `apps/` + `packages/` was rejected" },
  { word: "conversation", because: "the PT-BR conversation the language policy is about" },
  { word: "validation", because: "the act of checking, as in `validateHandoff`: a judgement of a Handoff, not a Gate" },
  { word: "schema", because: "names the rejected schema library; a Contract is not a payload shape" },
  { word: "rejection", because: "the compiler rejecting code; a Refusal is what the Core performs" },
  { word: "feature", because: "ordinary software English: 'a property test rather than a feature'" },
  { word: "agreement", because: "one of the four candidate bounded contexts, and a heading of CONTEXT.md" },
];

function escaped(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The prose matcher for one avoided entry: whole words, and the last word in every inflection.
 *
 * Only the last word is inflected, because that is the one an English sentence bends: `lead agents`, not
 * `leads agent`. Longest form first in the alternation, so the match cannot anchor on the bare word and
 * leave a plural's `s` outside it — a hit reported as the singular would read as a different violation
 * from the one in the file.
 */
export function proseMatcher(word: string): RegExp {
  const parts = word.split(/[\s-]+/);
  const head = parts.slice(0, -1).map(escaped);
  const tail = inflectionsOf(parts[parts.length - 1] ?? "")
    .map(escaped)
    .sort((left, right) => right.length - left.length)
    .join("|");
  // A word the glossary wrote in capitals means the capitals: `TODO` the marker, not `todo` the status.
  const flags = word === word.toUpperCase() ? "" : "i";
  return new RegExp(`\\b${[...head, `(?:${tail})`].join("[\\s-]+")}\\b`, flags);
}

/**
 * Scan 2 — prose in `docs/prd/`.
 *
 * Two exemptions on top of the removals `proseLinesOf` already did: a word that is itself a glossary term
 * is never a violation (`Delivery`), and the words in `exempted`, each with its reason. Pass `[]` to see
 * what the exemptions are actually carrying — the test does exactly that, over the real documents.
 */
export function proseViolations(
  glossary: Glossary,
  documents: readonly SourceText[],
  exempted: readonly Exemption[] = PROSE_EXEMPTIONS,
): readonly Violation[] {
  const defined = termWords(glossary);
  const excused = new Set(exempted.map((exemption) => exemption.word.toLowerCase()));
  const avoided = glossary.avoided
    .filter((entry) => !defined.has(wordsOf(entry.word).join(" ")))
    .filter((entry) => !excused.has(entry.word.toLowerCase()))
    .map((entry) => ({ ...entry, matcher: proseMatcher(entry.word) }));
  const violations: Violation[] = [];

  for (const document of documents) {
    for (const prose of proseLinesOf(document.text)) {
      for (const entry of avoided) {
        if (entry.matcher.test(prose.text)) {
          violations.push({
            file: document.file,
            line: prose.line,
            word: entry.word,
            under: entry.under,
            named: prose.text.trim(),
          });
        }
      }
    }
  }

  return violations;
}

/* -------------------------------------------------------------------------------------------------
 * Readers
 * ---------------------------------------------------------------------------------------------- */

/** The repository root, resolved from this file rather than from a working directory. */
export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function read(path: string): SourceText {
  return { file: relative(REPO_ROOT, path).split("\\").join("/"), text: readFileSync(path, "utf8") };
}

function filesUnder(directory: string, matches: (name: string) => boolean): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, matches));
    } else if (matches(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** `CONTEXT.md`, the one file the scans read and never scan. */
export function glossaryText(): string {
  return readFileSync(join(REPO_ROOT, "CONTEXT.md"), "utf8");
}

/** The domain modules, without their tests: a test exports nothing that claims to be a concept. */
export function domainSources(): readonly SourceText[] {
  return filesUnder(join(REPO_ROOT, "engine", "domain"), (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map(
    read,
  );
}

/** Every TypeScript file of the engine, tests included — what criterion 10 is about. */
export function engineSources(): readonly SourceText[] {
  return filesUnder(join(REPO_ROOT, "engine"), (name) => name.endsWith(".ts")).map(read);
}

/** Every markdown body under `docs/prd/`. `CONTEXT.md` is not here, and neither is `docs/PRODUTO.md`. */
export function prdDocuments(): readonly SourceText[] {
  return filesUnder(join(REPO_ROOT, "docs", "prd"), (name) => name.endsWith(".md")).map(read);
}

/**
 * Every ADR. Criterion 8 asks for `engine/` and `docs/prd/`; the ADRs are scanned as well because an ADR
 * is where a decision *about the domain* is written down, so it is precisely prose that names domain
 * concepts. Whoever writes one either uses the glossary's word or records an exemption with its reason.
 */
export function adrDocuments(): readonly SourceText[] {
  return filesUnder(join(REPO_ROOT, "docs", "adr"), (name) => name.endsWith(".md")).map(read);
}
