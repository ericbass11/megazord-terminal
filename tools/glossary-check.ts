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
 *
 * Every comparison of two words in this module goes through `formsOf`, and that is not tidiness. BUG-3
 * was two answers to "is this the same word" living side by side: the avoided side of the name scan bent
 * the last word into its inflections while the exemption beside it compared exact spellings, so the
 * plural of the glossary's own `Delivery` came out a violation. One function, so a later widening widens
 * both sides of every comparison at once.
 *
 * ## The glossary's own words win, and that is decided once
 *
 * `delivery` sits under `_Avoid_` for **Handoff**, and `Delivery` is a defined term — the glossary's own
 * name for the consolidated outcome of a Mission. The two readings cannot both be enforced, and a scan
 * reading names cannot tell which concept `Deliveries` means. `enforceable` resolves it in the one
 * direction that keeps the check alive: **an `_Avoid_` entry that is itself a defined term is not
 * enforced at all**, in names or in prose. See its own comment for why that is what the glossary means.
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

/**
 * Every form of a phrase this module is willing to treat as the same word: the last word bends through
 * `inflectionsOf`, the words before it are exact. `delivery` → `delivery`, `deliveries`, `deliveried`;
 * `gate decision` → `gate decisions`, never `gates decision`, because English bends the noun a phrase
 * ends on.
 *
 * This is the single answer to "is this the same word", and every comparison in the module reads it: the
 * avoided side of both scans (through `runOf` and `proseMatcher`, which need a set and a regexp of the
 * same forms) and the term side of both scans (through `termForms`). BUG-3 was what happens when one
 * side of one comparison grows and the other does not.
 */
export function formsOf(phrase: string): readonly string[] {
  const words = wordsOf(phrase);
  if (words.length === 0) {
    return [];
  }
  const head = words.slice(0, -1);
  return inflectionsOf(words[words.length - 1]).map((form) => [...head, form].join(" "));
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
 * Blanks every inline code span, keeping each character's line and column so line numbers survive.
 *
 * A span opens on a run of backticks and closes on the **next run of the same length** — which is how
 * Markdown itself delimits one, and it is why this cannot be done a line at a time. A span that wraps
 * across a line break used to defeat the strip: the opening line was left with an unmatched backtick and
 * the continuation line with another, and that stray closing tick then paired with the *next* opening tick
 * on its own line. Both error directions followed from one wrapped span — the ordinary prose in between
 * was blanked away, hiding whatever it said, and the following span was left exposed, so a word that was
 * quoted read as a word that was naming something. It cost QA two reproved runs on its own document
 * before anybody noticed that the check, not the prose, was wrong.
 *
 * Two bounds keep a Markdown accident from blanking a document:
 *
 * - **An unmatched run stays literal**, exactly as Markdown renders it, so a stray backtick blanks nothing
 *   and the words after it are still scanned. A check that silently under-reports is the failure mode to
 *   avoid; this is the same reasoning `codeOf` records for regular-expression literals.
 * - **A span never crosses a blank line.** A blank line ends a paragraph, so it ends any span an author
 *   left open — without this, one stray tick could swallow the rest of a document.
 *
 * A fence ends a paragraph too, which is why `proseLinesOf` hands this function a document where every
 * fenced line has been emptied rather than removed: an emptied fence *is* the blank line that bounds the
 * search, so two unmatched runs on either side of a fence stay literal instead of pairing across it. See
 * `proseLinesOf` for what that hole cost before it was closed.
 */
function spansBlanked(text: string): string {
  const characters = text.split("");
  let at = 0;

  while (at < characters.length) {
    if (characters[at] !== "`") {
      at += 1;
      continue;
    }

    const opens = at;
    while (at < characters.length && characters[at] === "`") {
      at += 1;
    }
    const ticks = at - opens;
    const paragraph = /\n[ \t]*\n/.exec(text.slice(at));
    const until = paragraph === null ? characters.length : at + paragraph.index;

    let closes = -1;
    let search = at;
    while (search < until) {
      if (characters[search] !== "`") {
        search += 1;
        continue;
      }
      const run = search;
      while (search < until && characters[search] === "`") {
        search += 1;
      }
      if (search - run === ticks) {
        closes = search;
        break;
      }
    }

    if (closes === -1) {
      // Unmatched: the backticks are literal text, and everything after them is still prose.
      continue;
    }
    for (let index = opens; index < closes; index += 1) {
      if (characters[index] !== "\n") {
        characters[index] = " ";
      }
    }
    at = closes;
  }

  return characters.join("");
}

/**
 * Markdown with everything that is not prose removed: fenced code blocks, inline code spans and link
 * targets.
 *
 * All three quote something rather than naming it. The techspec's own sentence is the proof that this is
 * required rather than convenient: "The reading is `stepsOf`, not `project`" — the second span is there
 * *because* `project` is avoided, and a scan that read it would fail the document that explains the rule.
 *
 * Fences are found line by line, because a fence is a line; spans are found over the document joined
 * back together, because a span is not — see `spansBlanked`.
 *
 * **A fenced line is emptied, not dropped.** Found in review, and it is the second half of the wrapped-span
 * hole rather than a new one: dropping the fenced lines before the spans were found made the line before a
 * fence and the line after it adjacent, so two unmatched runs on either side of a fence with no blank line
 * between them paired *across* it and blanked the prose in between. Markdown does the opposite — a fence
 * ends the paragraph, so both ticks stay literal — and the error direction was the worse one: a real
 * violation between the two ticks went unreported, which is a check quietly lying about a clean tree.
 * Emptying the line keeps it out of the scan while leaving the paragraph bound `spansBlanked` needs, and
 * the line numbers still come from the document, not from the kept lines.
 */
export function proseLinesOf(markdown: string): readonly ProseLine[] {
  /** One entry per line of the document, `undefined` where a fence or fenced content sits. */
  const lines: (string | undefined)[] = [];
  let fenced = false;

  markdown.split("\n").forEach((raw) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      lines.push(undefined);
      return;
    }
    lines.push(fenced ? undefined : raw);
  });

  const blanked = spansBlanked(lines.map((text) => text ?? "").join("\n")).split("\n");
  const kept: ProseLine[] = [];
  lines.forEach((text, index) => {
    if (text === undefined) {
      return;
    }
    kept.push({
      line: index + 1,
      text: (blanked[index] ?? text).replace(/\]\([^)]*\)/g, "] "),
    });
  });
  return kept;
}

/* -------------------------------------------------------------------------------------------------
 * The two scans
 * ---------------------------------------------------------------------------------------------- */

/** Every defined term, in every form: `mission`, `missions`, `gate decision`, `gate decisions`. */
function termForms(glossary: Glossary): ReadonlySet<string> {
  return new Set(glossary.terms.flatMap((term) => formsOf(term)));
}

/**
 * The avoided words a scan really enforces: every `_Avoid_` entry **except** the ones that are themselves
 * defined terms.
 *
 * `delivery` is the only such entry today, and it is the whole reason this function exists. It sits under
 * `_Avoid_` for **Handoff** — do not call a Handoff a delivery — and `Delivery` is at the same time the
 * glossary's own term for the consolidated outcome of a Mission, with an `_Avoid_` list of its own. Both
 * readings are in `CONTEXT.md` and only one of them can be enforced, because neither scan can tell which
 * concept the word means in `Deliveries`.
 *
 * **The term wins**, for three reasons that all point the same way:
 *
 * - A word the glossary *defines* is correct code by construction. `export type Delivery` is the name the
 *   model asks for, and a check that reproves the model for using its own vocabulary is a check deleted in
 *   its second week — the failure mode PRD open risk 5 names and the one the name scan cannot absorb, since
 *   it has no exemption table and by decision will not grow one.
 * - The prose scan has always read it this way (`delivery` was never enforced in prose, in any form), so
 *   this is the two scans agreeing rather than a new licence.
 * - The `_Avoid_` list is advice about *which word names which concept*, and the glossary answers that for
 *   `delivery` twice. The tie is broken by the more specific statement: a term heading names a concept,
 *   while an `_Avoid_` entry only rules a word out for one other concept.
 *
 * Two things this deliberately is **not**. It is not an exemption list — nothing is named here, the
 * subtraction is derived from `CONTEXT.md` on every run, so adding or removing a term moves it with no
 * edit to this file. And it is not asymmetric: both sides read `formsOf`, so `Deliveries` and
 * `deliveriesOf` are excused for the reason `Delivery` is, rather than by luck of spelling.
 *
 * The cost, stated because it is real: `delivery` cannot be enforced as a name for a Handoff. Whoever
 * wants that back has to resolve the collision in `CONTEXT.md` — which is where a collision between two
 * glossary readings belongs, not in this module.
 */
export function enforceable(glossary: Glossary): readonly AvoidedWord[] {
  const defined = termForms(glossary);
  return glossary.avoided.filter((entry) => !defined.has(wordsOf(entry.word).join(" ")));
}

/**
 * Scan 1 — exported names in `engine/domain/`.
 *
 * The word matches in every inflection (`inflectionsOf`), the same as in prose: `export type Squads`
 * publishes `squad` as the name of a concept exactly as `export type Squad` does. This scan has no
 * exemption table to absorb a false positive, so the expansion was measured against `engine/domain/`
 * before it was turned on — all 135 exported names stay clean, `catalogDefault` included. That
 * measurement was necessary and not sufficient, which is BUG-3: names that exist cannot show a false
 * positive on a name nobody has written yet, and what the widening broke was the comparison beside it.
 *
 * Nothing here is exempt by name. Two things are not violations, and both are the glossary's own words
 * winning rather than a list of excuses:
 *
 * 1. **An entry that is itself a defined term is not enforced at all** — `enforceable`, shared with the
 *    prose scan. This is what makes `Deliveries`, `deliveriesOf` and `DeliveryId` clean, and it is where
 *    BUG-3 lived: the avoided side bent `delivery` into `deliveries` while the term side compared exact
 *    spellings, so the plural of the glossary's own `Delivery` was reported and the singular was not.
 * 2. **A name that is itself a defined term is never a violation**, in any form `formsOf` derives. With
 *    (1) in place this carries nothing today — measured: of the 39 terms, `Delivery` was the only one it
 *    ever excused, and `enforceable` now excuses that word before this line is reached. It is kept for
 *    the case (1) cannot express: a **multi-word** term one of whose words is avoided elsewhere, where
 *    the entry is enforceable and the name is still the glossary's own. `Gate decision` is the only
 *    multi-word term today and none of its words is avoided; a hypothetical `Session Log` would need this
 *    line, and `SessionLogs` would need it to read `formsOf` rather than an exact spelling. The mechanism
 *    is pinned by a test against a synthetic glossary, because a branch nothing exercises is a branch
 *    that rots.
 */
export function namingViolations(glossary: Glossary, sources: readonly SourceText[]): readonly Violation[] {
  const defined = termForms(glossary);
  const avoided = enforceable(glossary).map((entry) => ({ ...entry, run: runOf(entry.word) }));
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
 * Two exemptions on top of the removals `proseLinesOf` already did: an entry that is itself a glossary
 * term is not enforced (`enforceable`, shared with the name scan), and the words in `exempted`, each with
 * its reason. Pass `[]` to see what the exemptions are actually carrying — the test does exactly that,
 * over the real documents. Passing `[]` does **not** reach `enforceable`: a term is not an exemption, and
 * scanning a document for the glossary's own vocabulary would report the glossary.
 */
export function proseViolations(
  glossary: Glossary,
  documents: readonly SourceText[],
  exempted: readonly Exemption[] = PROSE_EXEMPTIONS,
): readonly Violation[] {
  const excused = new Set(exempted.map((exemption) => exemption.word.toLowerCase()));
  const avoided = enforceable(glossary)
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
