/**
 * Which Zord CLIs exist on a given `PATH`, and the Catalog default Harness for each.
 *
 * The Cockpit offers a provider per Pane, and criterion 11 says that offer is **discovered**, not
 * hardcoded: remove a CLI and it stops being offered. So this module answers one `Provider` per entry of
 * the Catalog — the provider's name, whether it is there, where it is, and the bundle a Zord runs with
 * when nobody said anything else.
 *
 * ## Why this file is not in `engine/`
 *
 * It looks at a file system. `engine/mission.e2e.test.ts` reads every non-test source under `engine/`
 * and asserts every `from "…"` specifier is a relative path, which is the structural half of "no
 * network, no CLI" — and `node:fs/promises` is neither relative nor pure. So it lives here, where the
 * operating system is allowed in: **`runtime/` may import `engine/`; `engine/` must never import
 * `runtime/`.** What crosses is `Harness`, `Effort` and `harness()`, and nothing else.
 *
 * ## The `PATH` is given, never read
 *
 * `providersIn` takes the `PATH` it searches. It never reads `process.env` on its own initiative, for
 * the reason `pty-agent-runner.ts` states about the child's environment: a module that reaches for the
 * ambient environment answers a different question depending on who called it, and the answer here ends
 * up in a `Delegated` fact — "which Zord ran with which Harness" is the one thing a Replay must never be
 * wrong about. `hostLookup()` is the single named place that reads the real process, so every such read
 * is visible at a call site.
 *
 * The same argument makes the **platform** an input. Two rules differ on Windows — the `PATH` separator
 * and whether `PATHEXT` decides the file name — and a module that read `process.platform` could not be
 * shown to obey either of them except on a machine of that kind. `candidatesFor` is therefore pure: it
 * answers the ordered list of paths that *would* be tried, and both platforms' rules are proven on
 * whatever host the suite runs on.
 *
 * ## What "executable" is taken to mean, and where that stops
 *
 * Being named in a directory on `PATH` is not enough. A candidate counts when, in this order:
 *
 * 1. `stat` — following symbolic links — says it is a **regular file**. This is not pedantry: on POSIX a
 *    directory carries the execute bit to mean "searchable", so `access(X_OK)` alone reports a directory
 *    named `claude` as an installed provider.
 * 2. `access(X_OK)` says **this process** may execute it. Asking the kernel is the only way to be right
 *    about ACLs, capabilities and the special case of being root — where the answer is "yes" only if some
 *    execute bit is set, which is exactly what a reimplementation of the mode-bit arithmetic gets wrong.
 *
 * The limit is declared rather than hidden, and it is drawn at "would the operating system let us start
 * this file":
 *
 * - **Nothing is read from inside the file.** A shebang naming an absent interpreter, a binary for
 *   another architecture, a script with CRLF line endings — all of them are "present" here and fail at
 *   the spawn, where `pty-agent-runner.ts` already answers `not-spawned`. Deciding whether a file is a
 *   *runnable program* is the loader's job and this module does not have a loader.
 * - **A symbolic link is not resolved.** `claude` on this machine is a link, and the answer is the path
 *   `PATH` gives, not the link's target: the target is in a directory `PATH` does not contain, so
 *   reporting it makes "which `PATH` entry won" unanswerable and puts a location in the Replay that the
 *   operator never installed.
 * - **The answer is a reading at a moment, not a promise.** A CLI uninstalled between the detection and
 *   the spawn fails at the spawn. There is no way to close that, and pretending otherwise with a lock or
 *   a re-check would only move it.
 * - **An entry the file system refuses is read as "nothing there"** — a `PATH` naming an unreadable
 *   directory, or one with a NUL in it, makes that entry contribute no provider rather than failing the
 *   whole lookup. A `PATH` is the environment's, and one bad entry is not a reason to answer nothing
 *   about the other twelve. What *is* refused loudly is a `PATH` that is not a string at all, and a
 *   Catalog entry naming no CLI — those are a caller's bug, and reporting "no providers installed" for
 *   them would send a human to install software they already have.
 *
 * **The Windows half is a declared Gap.** Its *string* rules — the `;` separator, quoted entries, the
 * `PATHEXT` expansion and its order — are proven by `candidatesFor` in `providers.test.ts`, because they
 * are pure. Its *file-system* half is not exercised: there is no Windows host in this repository's
 * verification, and on Windows `X_OK` is `F_OK`, so step 2 above degrades to "the file exists" and the
 * extension in step 1 is what carries the meaning of executable.
 *
 * ## The Catalog is data, and its models are written down rather than measured
 *
 * `PROVIDER_CATALOG` is a list of entries. Adding a provider is **one entry** and no other change:
 * detection, validation and the answer all walk the list, and `providersIn` will look for whatever it
 * finds there. `providers.test.ts` proves that by detecting a provider the module has never heard of.
 *
 * Every `model` and `effort` in that list is a **choice somebody wrote down**, not a measurement.
 * Nothing in this repository can ask a provider what it serves — there is no network, and a CLI's model
 * list is behind an account. That is what a Catalog default *is*, by the glossary: "what a resolution
 * falls back to when neither the Roster nor the invocation specifies a field". Two consequences:
 *
 * - **A default that is not a complete, valid `Harness` fails loudly.** Every entry goes through
 *   `harness()`, which refuses a blank `cli`, a blank `model`, an Effort outside the registry and a
 *   duplicated Skill. A provider offered with a Harness a Zord cannot run is worse than a provider that
 *   is not offered, because the failure surfaces one Delegation later, inside a Mission.
 * - **Declared Gap: nothing checks that the provider actually has that model.** The remedy is a Roster
 *   or an invocation, which outrank the default field by field — not a smarter default here.
 *
 * **Declared Gap: four of the product's providers are missing.** `lib/surfaces.ts` also names
 * Antigravity, Ollama, LM Studio and llama.cpp, and each needs two facts nobody in this repository can
 * check: the program name it installs on `PATH`, and a model it really serves. An entry with the wrong
 * program name is worse than an absent one — it reports "not installed" forever, on a machine where it
 * is installed, and nobody looks at a negative. So the three the PRD and the techspec name are here, and
 * the other four are one entry each the day somebody can name them truthfully.
 */

import { access, constants, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

import { harness, type Effort, type Harness } from "@engine/domain/harness";

/* -------------------------------------------------------------------------------------------------
 * The Catalog
 * ---------------------------------------------------------------------------------------------- */

/**
 * One provider the Cockpit knows how to look for.
 *
 * It carries the **fields** of a Catalog default and not a `Harness`, so `cli` has exactly one source:
 * the program looked up on `PATH` and the program a Zord is invoked with are the same string by
 * construction, instead of being two fields that agree until somebody edits one of them.
 */
export type ProviderCatalogEntry = {
  /** How a Command, a protocol frame or a test names this provider. Non-blank. */
  readonly id: string;
  /** How a human reads it in the Cockpit. Non-blank. */
  readonly name: string;
  /**
   * The program looked up on `PATH`, and the `cli` of the Catalog default.
   *
   * A bare name, with no directory separator in it: a command name containing one is not a `PATH`
   * lookup at all, on any platform, so one here would mean this entry can never be found.
   */
  readonly cli: string;
  /** The model of the Catalog default. A written-down choice — see the module doc. */
  readonly model: string;
  /** The Effort of the Catalog default. */
  readonly effort: Effort;
  /** The Skills of the Catalog default. `[]` means none, which is an answer and not silence. */
  readonly skills: readonly string[];
};

/**
 * The providers this build knows how to look for.
 *
 * `medium` for every Effort on purpose: there is no per-CLI Effort flag in this repository — the pty
 * runner's `argumentsFor` owns that mapping — so a default that differed per provider would be claiming
 * knowledge this module does not have. `skills: []` for the same reason a Catalog installs no Skill: a
 * Skill is asked for by a Roster or by an invocation.
 *
 * `as const satisfies` rather than an annotation: the literals stay literal *and* every entry is checked
 * against the shape, so an entry missing a field does not compile.
 */
export const PROVIDER_CATALOG = [
  { id: "claude", name: "Claude Code", cli: "claude", model: "sonnet", effort: "medium", skills: [] },
  { id: "codex", name: "Codex", cli: "codex", model: "gpt-5-codex", effort: "medium", skills: [] },
  { id: "gemini", name: "Gemini CLI", cli: "gemini", model: "gemini-2.5-pro", effort: "medium", skills: [] },
] as const satisfies readonly ProviderCatalogEntry[];

/* -------------------------------------------------------------------------------------------------
 * The answer
 * ---------------------------------------------------------------------------------------------- */

/** What every answer carries, present or not: who the provider is, and what it would be run with. */
type KnownProvider = {
  readonly id: string;
  readonly name: string;
  readonly cli: string;
  /** Complete, checked and frozen by `harness()`. Exists whether or not the CLI does. */
  readonly catalogDefault: Harness;
};

/** A provider whose CLI was found, and where. */
export type PresentProvider = KnownProvider & {
  readonly present: true;
  /**
   * The absolute path of the file that was found: the winning `PATH` entry joined with the name.
   *
   * Not the link's target and not a `realpath` — see the module doc.
   */
  readonly path: string;
};

/**
 * A provider whose CLI was not found on the `PATH` it was looked for on.
 *
 * It declares **no `path` field at all**, which is what makes "absent, at /usr/bin/x" unrepresentable
 * rather than merely wrong: a reader has to ask `present` before it can read a path.
 */
export type AbsentProvider = KnownProvider & {
  readonly present: false;
};

/** One provider, as looked up. Discriminated by `present`, so the path exists exactly when it does. */
export type Provider = PresentProvider | AbsentProvider;

/* -------------------------------------------------------------------------------------------------
 * The lookup
 * ---------------------------------------------------------------------------------------------- */

/** Where to look, and by whose rules. */
export type ProviderLookup = {
  /**
   * The `PATH` to search, spelled the way the platform spells it.
   *
   * Required, and never defaulted to `process.env.PATH`: see "The `PATH` is given, never read". A blank
   * one is an answer — there is nowhere to look, so nothing is found.
   */
  readonly path: string;
  /**
   * Whose rules apply. Only `"win32"` differs: the `PATH` separator is `;` and `PATHEXT` decides the
   * file name. Every other platform is read as POSIX.
   *
   * Required for the same reason `path` is, and it is what makes the Windows rules provable off Windows.
   */
  readonly platform: NodeJS.Platform;
  /**
   * `PATHEXT`, on a platform that has one. Ignored elsewhere.
   *
   * Absent or blank means the extensions `cmd.exe` itself falls back to — see
   * `WINDOWS_FALLBACK_PATHEXT`.
   */
  readonly pathext?: string;
  /**
   * The providers to look for. Absent means `PROVIDER_CATALOG`.
   *
   * `[]` is not absent: it means "look for nothing", and it answers nothing. Same rule as a Harness
   * source's `skills` — an empty list is a deliberate answer and only an absent field falls through.
   */
  readonly catalog?: readonly ProviderCatalogEntry[];
};

/**
 * The lookup that describes *this* process's world — the one function here that reads it.
 *
 * `from` and `platform` are parameters so a test can hand it a world; the defaults are what make it
 * worth having. It reads `PATH` and `PATHEXT` and nothing else, and an absent `PATH` becomes `""`
 * rather than a refusal: "there is nowhere to look" is a true answer, and the only honest one for a
 * process started without a `PATH`.
 *
 * Those two names are read with exactly that spelling. It is not a Windows hole — `process.env` there is
 * case-insensitive, so `Path` reaches `PATH` — but a **hand-built** map must spell them this way.
 */
export function hostLookup(
  from: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): ProviderLookup {
  return { path: from.PATH ?? "", platform, pathext: from.PATHEXT };
}

/* -------------------------------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------------------------------- */

/** The lookup itself cannot be used: nothing was searched. */
export class InvalidProviderLookupError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this lookup cannot be made: ${detail}`);
    this.name = "InvalidProviderLookupError";
    this.detail = detail;
  }
}

/**
 * A Catalog entry cannot be offered, so none is: every violation at once, exactly as `harness()` reports
 * a bundle's.
 *
 * It wraps `InvalidHarnessError` rather than letting it through, because the engine's message names the
 * *field* — "model must name something" — and a Catalog of seven entries needs to know **which
 * provider** that was.
 */
export class InvalidProviderCatalogError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`this Catalog cannot be offered: ${violations.join("; ")}`);
    this.name = "InvalidProviderCatalogError";
    this.violations = Object.freeze([...violations]);
  }
}

/* -------------------------------------------------------------------------------------------------
 * Detection
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every provider of the Catalog, in Catalog order, each said to be present or absent.
 *
 * Absent is an answer and not an omission: the Cockpit shows a provider it cannot offer, and criterion
 * 11 is that the answer *changes* when a CLI leaves the `PATH`. `presentIn` is the list that shrinks.
 *
 * @throws {InvalidProviderLookupError} when the `PATH` or the platform is not a string.
 * @throws {InvalidProviderCatalogError} when an entry names no CLI, repeats an id or a CLI, or carries a
 *   Catalog default `harness()` refuses.
 */
export async function providersIn(lookup: ProviderLookup): Promise<readonly Provider[]> {
  // The Catalog before the disk: an entry that cannot be offered is a caller's bug, and it should not
  // wait for a file system to be reported.
  const known = catalogOf(lookup.catalog ?? PROVIDER_CATALOG);

  const found = await Promise.all(
    known.map(async (provider): Promise<Provider> => {
      const at = await firstExecutableIn(candidatesFor(provider.cli, lookup));
      const { id, name, cli, catalogDefault } = provider;

      // Written out field by field rather than spread. Not the precedence rule `harness.ts` records —
      // there is one source here — but the same habit: the answer's key set is what `providers.test.ts`
      // pins, so a field that arrives has to be written down to arrive.
      if (at === undefined) {
        const absent: AbsentProvider = { present: false, id, name, cli, catalogDefault };
        return Object.freeze(absent);
      }
      const present: PresentProvider = { present: true, id, name, cli, catalogDefault, path: at };
      return Object.freeze(present);
    }),
  );

  return Object.freeze(found);
}

/**
 * The providers that can actually be offered per Pane.
 *
 * `=== true` and not a truthiness test: a `Provider` can arrive through a cast or a `JSON.parse`, and a
 * truthy non-boolean would be narrowed to a `PresentProvider` whose path nobody checked.
 */
export function presentIn(providers: readonly Provider[]): readonly PresentProvider[] {
  return Object.freeze(providers.filter((provider): provider is PresentProvider => provider.present === true));
}

/**
 * The absolute paths that would be tried for one CLI, in the order they would be tried.
 *
 * Pure, and exported because it is the whole Windows half of this module's proof: `PATHEXT` expansion,
 * the `;` separator and quoted entries are all decided here and nowhere else.
 *
 * What is dropped, and why each is not a silent hole:
 *
 * - **An empty `PATH` entry.** POSIX reads it as the current directory, so honouring it would make the
 *   answer depend on where this process happens to have been started — the thing `pty-agent-runner.ts`
 *   refuses by requiring `cwd`.
 * - **A relative entry**, for the same reason. Nothing here resolves one against a working directory,
 *   because this module was not given one.
 * - **A repeated candidate.** A `PATH` that names one directory twice is ordinary; trying it twice would
 *   only make this reading harder to read. The winner is unchanged either way.
 *
 * @throws {InvalidProviderLookupError} when the `PATH`, the platform or `PATHEXT` is not a string.
 * @throws {InvalidProviderCatalogError} when the CLI is not a bare non-blank name.
 */
export function candidatesFor(cli: string, lookup: ProviderLookup): readonly string[] {
  const named = checkedCli(cli, "the cli looked up");
  const windows = isWindows(lookup);
  const paths = windows ? win32 : posix;
  const names = windows ? windowsNamesOf(named, lookup.pathext) : [named];

  const tried: string[] = [];
  const seen = new Set<string>();

  for (const entry of checkedPath(lookup).split(windows ? ";" : ":")) {
    const directory = windows ? unquoted(entry) : entry;
    if (directory.length === 0 || !paths.isAbsolute(directory)) {
      continue;
    }
    for (const name of names) {
      const candidate = paths.join(directory, name);
      if (!seen.has(candidate)) {
        seen.add(candidate);
        tried.push(candidate);
      }
    }
  }

  return Object.freeze(tried);
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the Catalog
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Catalog, checked, with every default resolved — or one refusal naming everything that is wrong.
 *
 * Every violation is collected before anything is thrown, for the reason `harness()` gives: a Catalog
 * can be wrong in more than one way, and naming only the first sends whoever wrote it round the loop
 * once per entry.
 */
function catalogOf(claimed: readonly ProviderCatalogEntry[]): readonly KnownProvider[] {
  const value: unknown = claimed;
  if (!Array.isArray(value)) {
    throw new InvalidProviderCatalogError([`a Catalog is a list of providers, received ${shown(value)}`]);
  }

  // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
  const listed: readonly unknown[] = value;
  const violations: string[] = [];
  const known: KnownProvider[] = [];
  const ids = new Set<string>();
  const clis = new Set<string>();

  listed.forEach((entry, position) => {
    const at = `provider ${position}`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      violations.push(`${at} is ${shown(entry)}, not a provider`);
      return;
    }

    // One cast, and it is the ordinary one for reading an object nobody validated: every value read
    // through it is `unknown` and decided on its own terms below.
    const fields = entry as Readonly<Record<string, unknown>>;

    const id = named(fields.id, "id", at, violations);
    const name = named(fields.name, "name", at, violations);
    let cli: string | undefined;
    try {
      cli = checkedCli(fields.cli, `${at}'s cli`);
    } catch (cause) {
      // Folded in as violations rather than as a message: `checkedCli` refuses on its own behalf,
      // because `candidatesFor` calls it too, and re-wrapping its message would prefix this Catalog's
      // sentence twice.
      violations.push(...violationsIn(cause));
    }

    if (id !== undefined) {
      if (ids.has(id)) {
        violations.push(`${at} repeats the id ${JSON.stringify(id)}: two providers cannot answer to one name`);
      }
      ids.add(id);
    }

    let catalogDefault: Harness | undefined;
    if (cli !== undefined) {
      if (clis.has(cli)) {
        // The Catalog is "one default per CLI" by the glossary, so two entries over one program would
        // give one CLI two default Harnesses and nothing could say which a Zord ran with.
        violations.push(`${at} repeats the cli ${JSON.stringify(cli)}: a Catalog holds one default per CLI`);
      }
      clis.add(cli);

      try {
        // The runtime half of "a Catalog default is a complete Harness". The parameter type claims it and
        // a cast, a `JSON.parse` or a hand-written Catalog file all defeat that claim, so the values are
        // handed over exactly as they arrived — `harness()` reads every one of them as `unknown` — rather
        // than being coerced into a shape that would hide the violation.
        catalogDefault = harness({
          cli,
          model: fields.model,
          effort: fields.effort,
          skills: fields.skills,
        } as Harness);
      } catch (cause) {
        violations.push(`${at} carries a Catalog default that is not runnable — ${messageOf(cause)}`);
      }
    }

    if (id !== undefined && name !== undefined && cli !== undefined && catalogDefault !== undefined) {
      known.push({ id, name, cli, catalogDefault });
    }
  });

  if (violations.length > 0) {
    throw new InvalidProviderCatalogError(violations);
  }

  return known;
}

/**
 * One text field of an entry, read as `unknown` and required to name something.
 *
 * `id` and `name` are only ever copied, so a cast could not make this module throw — they are checked
 * anyway because both are addresses: an id nothing can name is a provider a Command cannot ask for, and
 * a blank name is an empty row in the Cockpit.
 */
function named(value: unknown, field: "id" | "name", at: string, violations: string[]): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    violations.push(`${at}'s ${field} must name something, received ${shown(value)}`);
    return undefined;
  }
  return value;
}

/**
 * The program name to look up, read as `unknown` because a path is **computed** with it.
 *
 * A separator is refused rather than absorbed: `posix.join("/usr/bin", "../../x")` happily answers a
 * path outside the `PATH` entry, and no shell searches `PATH` for a name containing a separator anyway —
 * so an entry with one could never be found by the thing it is trying to describe. A NUL is refused for
 * the same reason at a lower level: `stat` rejects it, and the rejection should name the Catalog rather
 * than `node:fs`.
 *
 * A bad `cli` is a Catalog fault whichever function noticed it, which is why `candidatesFor` reports it as
 * one too: the program a provider installs is a Catalog fact, and an entry whose name stops being a bare
 * one is a provider that can never be found — the same failure, seen from the other side.
 */
function checkedCli(claimed: unknown, at: string): string {
  if (typeof claimed !== "string" || claimed.trim().length === 0) {
    throw new InvalidProviderCatalogError([`${at} must name something, received ${shown(claimed)}`]);
  }
  if (claimed.includes("/") || claimed.includes("\\")) {
    throw new InvalidProviderCatalogError([
      `${at} is ${JSON.stringify(claimed)}, which carries a directory separator: ` +
        `a PATH lookup takes a bare program name`,
    ]);
  }
  if (claimed.includes("\u0000")) {
    throw new InvalidProviderCatalogError([
      `${at} is ${JSON.stringify(claimed)}, which carries a NUL: no file can be named that`,
    ]);
  }
  return claimed;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the lookup
 * ---------------------------------------------------------------------------------------------- */

/**
 * What `cmd.exe` falls back to when `PATHEXT` is not set.
 *
 * Windows always sets it, so this is the shape of an answer for a hand-built lookup rather than a guess
 * about a real machine. It is not extended with `.PS1` or `.VBS`: those are what a real `PATHEXT` adds,
 * and the fallback's job is to be the documented minimum rather than a generous one.
 */
const WINDOWS_FALLBACK_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Whether the given platform's rules are Windows'. Everything else is read as POSIX. */
function isWindows(lookup: ProviderLookup): boolean {
  const value: unknown = lookup.platform;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidProviderLookupError(
      `a lookup names the platform whose rules apply, received ${shown(value)}`,
    );
  }
  return value === "win32";
}

/**
 * The `PATH` to search, read as `unknown` because it is **split** — `undefined.split` throws.
 *
 * A blank one is allowed through: "there is nowhere to look" is a true state of the world, and answering
 * it as "no providers" is correct. A non-string is not a state of the world, it is a caller that lost
 * its `PATH` to a cast, and reporting "nothing is installed" for that would send a human to reinstall a
 * CLI they have.
 */
function checkedPath(lookup: ProviderLookup): string {
  const value: unknown = lookup.path;
  if (typeof value !== "string") {
    throw new InvalidProviderLookupError(
      `a lookup searches a PATH, which must be a string, received ${shown(value)}`,
    );
  }
  return value;
}

/**
 * The file names one CLI can have on a `PATHEXT` platform, in the order Windows tries them.
 *
 * A name that already ends with one of the extensions is taken **as it is** and not extended again:
 * `claude.cmd.exe` is a different program, and looking for it would report a provider nobody installed.
 * A name with no such extension is not a candidate on its own, because Windows will not start an
 * extensionless file.
 */
function windowsNamesOf(cli: string, pathext: unknown): readonly string[] {
  if (pathext !== undefined && typeof pathext !== "string") {
    throw new InvalidProviderLookupError(
      `PATHEXT must be a string when it is given, received ${shown(pathext)}`,
    );
  }

  const spelled = pathext === undefined || pathext.trim().length === 0 ? WINDOWS_FALLBACK_PATHEXT : pathext;
  // Verbatim, empties dropped: `PATHEXT` is a list of extensions and this module does not know a better
  // spelling for any of them than the one the machine was configured with.
  const extensions = spelled.split(";").filter((extension) => extension.length > 0);

  const lowered = cli.toLowerCase();
  if (extensions.some((extension) => lowered.endsWith(extension.toLowerCase()))) {
    return [cli];
  }
  return extensions.map((extension) => `${cli}${extension}`);
}

/**
 * A Windows `PATH` entry with its surrounding quotes removed.
 *
 * `PATH` on Windows legitimately carries `"C:\Program Files\x"`, and a quoted entry fails every absolute
 * path test there is — so leaving the quotes on would silently drop the entry, which is the direction of
 * error this repository refuses twice over: over-reporting a candidate costs one `stat`, under-reporting
 * a provider tells a human to install what they already have.
 */
function unquoted(entry: string): string {
  return entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"') ? entry.slice(1, -1) : entry;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the file system
 * ---------------------------------------------------------------------------------------------- */

/** The first candidate this process could execute, which is the one a shell would run. Sequential, because order is the answer. */
async function firstExecutableIn(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Whether one path names a regular file this process may execute.
 *
 * Both halves are needed and neither is enough — see "What executable is taken to mean". Every failure
 * is read as "no": `ENOENT` is the ordinary answer, `EACCES` is a file we may not run, `ELOOP` and
 * `ENAMETOOLONG` are a `PATH` entry nobody can use, and all four mean the same thing to a lookup.
 */
async function isExecutableFile(path: string): Promise<boolean> {
  try {
    // `stat` and not `lstat`: a link to a program is a program, and `claude` is installed as one on the
    // machine this was written on.
    if (!(await stat(path)).isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** What one refusal contributes to an aggregate of them. */
function violationsIn(cause: unknown): readonly string[] {
  return cause instanceof InvalidProviderCatalogError ? cause.violations : [messageOf(cause)];
}

/** How a rejected value reads inside a violation. Mirrors `harness.ts`, the pty runner and the store. */
function shown(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? "a list" : "an object";
  }
  return String(value);
}
