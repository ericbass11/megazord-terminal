/**
 * The Replay on disk: one JSONL file per Mission under `.megazord/`, appended one `ReplayEntry` per
 * line, loaded back whole.
 *
 * ```
 * <workspace>/.megazord/missions/<encoded MissionId>.jsonl
 * ```
 *
 * The Mission **is** the file. There is no state here, cached or otherwise: what a Mission is doing is
 * `stateOf(await store.load(id))`, folded from the entries this file appended, exactly as the engine
 * folds a Replay it never wrote down. That is the techspec's rule — "no state lives in the server that
 * is not derivable" — reduced to its smallest form, and it is why this module has three functions and
 * no notion of an open Mission.
 *
 * ## Why this file is not in `engine/`
 *
 * It touches a disk. `engine/mission.e2e.test.ts` reads every non-test source under `engine/` and
 * asserts that every `from "…"` specifier is a relative path, which is the structural half of "no
 * network, no CLI" — and `node:fs/promises` is neither relative nor pure. So it lives here, where the
 * operating system is allowed in: **`runtime/` may import `engine/`; `engine/` must never import
 * `runtime/`.** `pty-agent-runner.ts` is the other half of that boundary and its test pins both
 * directions.
 *
 * This module goes one step further than the boundary requires, and the step is load-bearing rather
 * than tidy: **its only import from the engine is `import type`, so no line of engine code runs here.**
 * A store that could call `decide`, `evolve` or a value constructor would be a second place where the
 * rules live, and the two would drift — with the store having the last word, because it is what a
 * Surface reads the Mission through. Persisting a value and judging it are different jobs; this file
 * does the first one only. `mission-store.test.ts` asserts the import is type-only.
 *
 * ## What a loaded entry is, and what it is not
 *
 * JSON knows nothing about brands. `Money` is a branded `number`, an `Instant` and all five ids are
 * branded `string`s, and the brand is a compile-time phantom with no runtime representation at all — so
 * there is nothing in a file to check a brand *against*, and no function anywhere can restore one. What
 * a constructor like `moneyFromCents` re-checks is the **value's** invariants, not its brand.
 *
 * So the decision, stated plainly: **`load` casts, and the file is trusted.** It is trusted for the
 * same reason the source tree beside it is: `.megazord/` sits inside the Workspace, and anybody who can
 * edit a line of a Mission's file can edit `engine/domain/mission.ts`. This is not a boundary where
 * hostile input arrives; it is this process's own record, read back.
 *
 * **Re-validating through the domain's constructors was rejected, and not on grounds of effort.** A
 * Replay legitimately contains malformed Commands: `decide` refuses a `submit-handoff` whose Handoff was
 * lost to a cast, and `submit` **records that Refusal, Command and all** — that is the whole point of a
 * Replay being a sequence of Decisions rather than of Events. A loader that ran `handoff()` over what it
 * read would therefore refuse to load exactly the entries the engine went out of its way to record, and
 * a Replay that cannot be read is a Replay that cannot be shown to a human, which is the only reason it
 * exists. The engine already reads a recorded value as `unknown` wherever it dereferences or computes
 * with one — `stepsOf`, `amountOf`, `decide` — so a second layer of checking here would not add safety,
 * it would add a disagreement.
 *
 * What this module does check is what **it** computes with, which is the rule `CLAUDE.md` states about
 * casts applied to this file's own two jobs:
 *
 * - **The MissionId becomes a path.** `join(root, undefined)` throws and `join(root, "")` names the
 *   directory itself, so a MissionId is read as `unknown` and refused when it is not a non-blank string.
 *   This is the grade the pty adapter calls *substituting a default*: the damage is silent and
 *   permanent, so it is refused before anything is opened.
 * - **The entry becomes a line, and a line becomes an entry.** `load` checks the discriminated skeleton
 *   of a `ReplayEntry` — the two fields, the Command's `kind`, and the payload the Decision's own member
 *   declares — because that skeleton is what makes the returned value readable at all: `stepsOf` reads
 *   `refusal.violations.join`, and a Refusal with no `violations` would make the audit surface throw.
 *   It stops at the Decision's own shape and never looks inside a Command or an Event, which is where
 *   the deliberately-recorded malformed values live.
 *
 * **Declared Gap, and it is the same shape as a finding Task 9 recorded.** Nothing checks that the
 * entries of `<id>.jsonl` are about the Mission that names the file, exactly as `evolve` does not check
 * that an Event belongs to the Mission it is folded into. The file name is this store's index, not a
 * claim verified against the entries; a hand-edited file that mixes two Missions folds nonsense, quietly.
 * A second Gap of the same family: the skeleton check guarantees an entry can be *read*, not that the
 * inside of a fact is well-formed — `added()` in `replay.ts` reads `event.harness.cli` off a `Delegated`
 * without reading it as `unknown` first, because an Event is a fact the engine itself wrote. A
 * hand-edited fact can still break that reading, and closing it belongs to whoever changes the rule.
 *
 * ## A corrupt line is reported, never skipped
 *
 * A half-written line is the ordinary failure of an append-only file: the app was killed between the
 * `write` and the newline. `load` **rejects** with a `CorruptReplayError` naming the file, the 1-based
 * line and the byte offset where that line starts, and it returns nothing at all.
 *
 * Two alternatives, both rejected:
 *
 * - **Skip the line.** The state a Surface then shows is not the state the Mission reached, and nothing
 *   anywhere says so. It is the failure `CLAUDE.md` records twice about scans — over-reporting gets
 *   argued about, under-reporting gets believed — applied to the one record a human trusts.
 * - **Return the prefix and let the caller carry on.** This is the tempting one, because a torn line is
 *   almost always the *last* line and the prefix is a consistent Replay. It breaks on the next append:
 *   an entry written after a torn tail buries that tail in the middle of the file, where no future
 *   `load` can ever pass it, and every entry after it becomes unreadable. A prefix a caller will append
 *   to is a file destroyed one entry later, so `load` refuses and the truncation offset it names makes
 *   the recovery a one-liner (`truncate -s <at> <path>`) rather than a guess.
 *
 * There is deliberately **no repair function**, and no guard in `append` against a torn tail. A torn
 * line means the writer died mid-write, so no live writer can be sitting behind one; and a new writer
 * cannot append a coherent entry without having loaded the Replay first, because `submit` needs the
 * Replay to decide against — so `load`'s refusal is already in the way. What that argument does not
 * cover is a caller appending an entry it did not get from `submit`, which is a caller writing fiction
 * into the record; the store is not the place to make that safe.
 *
 * ## What "appended" means
 *
 * `append` resolves once the entry's bytes are **on the medium**: one `write` to a file opened
 * `O_APPEND`, then `fsync` on the file, then `fsync` on the containing directory so the file's *name*
 * is durable too and not only its contents. What that buys is that a power loss cannot lose an entry
 * whose `append` had already resolved. What it relies on is the platform honouring `fsync`, which a
 * consumer disk with a lying write cache does not; and on the directory being openable for `fsync`,
 * which every POSIX platform allows and Windows does not — there the guarantee degrades to the file's
 * own contents, and the failure is ignored rather than turned into a rejection, because a refusal to
 * store a Mission would be a worse answer than a weaker durability claim.
 *
 * One `write` per entry, and the entry is serialised **before** the file is opened: a torn line
 * therefore requires the process to die inside a single `write` of a few hundred bytes to an `O_APPEND`
 * descriptor, and an entry that cannot be JSON never creates a file. Appends from one store are
 * serialised in call order, so a caller that fires two without awaiting still gets them in the order it
 * asked; two *processes* appending to one Mission is not something this module can order, and one writer
 * per Mission is the assumption a Cockpit meets by construction.
 *
 * ## The file name is the MissionId, encoded and reversible
 *
 * A MissionId is any non-blank string, and a file name is not: `../../etc/passwd` must not escape the
 * Workspace and `list()` must hand back the id that was appended, byte for byte. So the name is
 * `encodeURIComponent(id) + ".jsonl"`, which escapes every separator (`/` → `%2F`, `\` → `%5C`, NUL →
 * `%00`) and is exactly invertible; `list()` requires the name to be the *canonical* encoding of what it
 * decodes to, so two names cannot claim one Mission.
 *
 * Two declared Gaps in that scheme, both about the file system rather than about the encoding:
 *
 * - **A case-insensitive volume folds two MissionIds that differ only in case into one file.** The
 *   encoding is injective; the volume is not. Hex-encoding the bytes would close it and would make
 *   `.megazord/missions/` unreadable to the human the "one file per Mission" layout is for.
 * - **A MissionId longer than the platform's name limit cannot be stored**, and arrives as the OS's
 *   `ENAMETOOLONG` from `append` rather than as a refusal from this module. It is a real answer, at the
 *   only layer that knows the limit.
 */

import { mkdir, open, readFile, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

// Type-only, and that is the point: no engine code runs in this module. See the module doc.
import type { MissionId, Replay, ReplayEntry } from "@engine/index";

/* -------------------------------------------------------------------------------------------------
 * The layout
 * ---------------------------------------------------------------------------------------------- */

/** Everything this product writes into a Workspace lives under one directory. */
const STORE_ROOT = ".megazord";

/**
 * Missions get their own directory under it.
 *
 * The Cortex lands beside them in a later task, and `list()` answers "which Missions exist" by reading
 * a directory — so the Missions need a directory that is theirs, or that answer becomes a guess about
 * which files in `.megazord/` are Replays.
 */
const MISSIONS_ROOT = "missions";

/** JSONL: one JSON value per line, appended. The suffix is what `list()` recognises as ours. */
const REPLAY_SUFFIX = ".jsonl";

/** The line ending. `\n` and not `\r\n`: a record separator, not a document for a terminal. */
const LINE_END = "\n";

/* -------------------------------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------------------------------- */

/**
 * A Mission's file holds a line that is not a `ReplayEntry`, so nothing was loaded.
 *
 * `line` is 1-based, because it is what an editor shows. `at` is the byte offset where that line
 * *starts*, which is the number `truncate -s` takes: for the ordinary case — an append interrupted
 * mid-write — truncating there restores the file to its last complete entry and loses only the entry
 * whose bytes never made it.
 */
export class CorruptReplayError extends Error {
  readonly path: string;
  readonly line: number;
  readonly at: number;
  readonly detail: string;

  constructor(path: string, line: number, at: number, detail: string) {
    super(
      `${path} is not a readable Replay: line ${line} ${detail}. ` +
        `That line starts at byte ${at}; nothing was loaded.`,
    );
    this.name = "CorruptReplayError";
    this.path = path;
    this.line = line;
    this.at = at;
    this.detail = detail;
  }
}

/**
 * A MissionId cannot become a file name, or a file in the Missions directory cannot become a MissionId.
 *
 * One error for both directions because it is one bijection: the day either half stops holding, the
 * store can no longer say which Mission a file belongs to, and that is the same failure whichever side
 * it is discovered from.
 */
export class MissionFileNameError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "MissionFileNameError";
    this.detail = detail;
  }
}

/**
 * A `ReplayEntry` cannot become a line, so nothing was written.
 *
 * Only reachable through a cast — a circular structure, a `BigInt`, a `toJSON` answering `undefined` —
 * and it is refused rather than absorbed because `String(undefined)` would append the literal text
 * `undefined` as a line and corrupt the file for every later `load`.
 */
export class InvalidReplayEntryError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this entry cannot be recorded: ${detail}`);
    this.name = "InvalidReplayEntryError";
    this.detail = detail;
  }
}

/* -------------------------------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------------------------------- */

/** What a store is built with. */
export type MissionStoreOptions = {
  /**
   * The Workspace root. `.megazord/` is created inside it.
   *
   * Required, and never defaulted to `process.cwd()`: a Mission belongs to a Workspace, not to
   * wherever the process that opened it happened to be started. Same rule as the pty runner's `cwd`.
   */
  readonly workspace: string;
};

/** The Replay of a Mission, as a file. */
export interface MissionStore {
  /** Records one entry. Resolves once its bytes are durable — see "What appended means". */
  append(missionId: MissionId, entry: ReplayEntry): Promise<void>;
  /**
   * The whole Replay of a Mission, in the order it was appended.
   *
   * A Mission with no file loads as the **empty Replay**, because that is what an absent file means and
   * the domain already has a name for it: `stateOf([])` is the unopened Mission, which is exactly "there
   * is no such Mission". Which Missions exist is `list`'s question, not this one's. Every other I/O
   * failure rejects.
   *
   * @throws {CorruptReplayError} on any line that is not a `ReplayEntry`. Nothing is skipped.
   */
  load(missionId: MissionId): Promise<Replay>;
  /** Every Mission this store holds, by id, in ascending order. Empty when nothing was ever appended. */
  list(): Promise<readonly MissionId[]>;
}

/**
 * Builds a store over one Workspace.
 *
 * It holds no Mission and caches nothing: the only state is the queue that keeps this instance's
 * appends in call order.
 */
export function missionStore(options: MissionStoreOptions): MissionStore {
  const missionsRoot = join(options.workspace, STORE_ROOT, MISSIONS_ROOT);
  const queued = appendQueue();

  return {
    async append(missionId: MissionId, entry: ReplayEntry): Promise<void> {
      // Both before the queue and before anything is opened: a MissionId that cannot be a name and an
      // entry that cannot be a line are the caller's bugs, and neither should wait for a disk or leave
      // an empty file behind.
      const path = join(missionsRoot, fileNameOf(missionId));
      const line = `${lineOf(entry)}${LINE_END}`;

      return queued(async () => {
        await mkdir(missionsRoot, { recursive: true });

        const handle = await open(path, "a");
        try {
          await handle.writeFile(line, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }

        await syncName(missionsRoot);
      });
    },

    async load(missionId: MissionId): Promise<Replay> {
      const path = join(missionsRoot, fileNameOf(missionId));

      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (cause) {
        if (isMissing(cause)) {
          return frozen([]);
        }
        throw cause;
      }

      return entriesIn(text, path);
    },

    async list(): Promise<readonly MissionId[]> {
      const listed = await readdir(missionsRoot, { withFileTypes: true }).catch(
        (cause: unknown) => {
          if (isMissing(cause)) {
            return undefined;
          }
          throw cause;
        },
      );
      if (listed === undefined) {
        return frozenIds([]);
      }

      const held: MissionId[] = [];
      for (const entry of listed) {
        // A directory named `x.jsonl` is not a Mission. A symbolic link may well be one, so it is not
        // excluded — following it is the file system's business.
        if (entry.isDirectory() || !entry.name.endsWith(REPLAY_SUFFIX)) {
          continue;
        }
        held.push(missionIdIn(entry.name, missionsRoot));
      }

      return frozenIds(held.sort());
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Internals: names
 * ---------------------------------------------------------------------------------------------- */

/**
 * The file name a MissionId is stored under.
 *
 * The id is read as `unknown` first, in the grade this project calls *substituting a default for a
 * missing value*: `join(root, "")` is the Missions directory itself and `join(root, undefined)` throws
 * a `TypeError` from deep inside `node:path`. A MissionId arrives from a `JSON.parse`, a WebSocket
 * frame or a cast as easily as from `missionId()`, so the brand is not the guarantee.
 */
function fileNameOf(claimed: MissionId): string {
  const value: unknown = claimed;

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MissionFileNameError(
      `a Mission is stored under its id, which must be a non-blank string, received ${shown(value)}`,
    );
  }

  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch (cause) {
    // `encodeURIComponent` throws `URIError` on an unpaired surrogate, which has no UTF-8 encoding and
    // therefore no file name. Refused here so the failure names the id rather than the encoder.
    throw new MissionFileNameError(
      `MissionId ${JSON.stringify(value)} cannot be a file name: ${messageOf(cause)}`,
    );
  }

  return `${encoded}${REPLAY_SUFFIX}`;
}

/**
 * The MissionId a file name belongs to, or a refusal.
 *
 * The name must be the **canonical** encoding of what it decodes to. Accepting a non-canonical one
 * (`a b.jsonl` beside `a%20b.jsonl`) would let two files claim a single Mission, so `list()` would
 * report an id twice and `load` would read only one of them. Ignoring it silently is the other half of
 * the same mistake — a `.jsonl` in this directory is either a Mission or something a human needs to
 * hear about, and `list()` answering "no Missions" over a directory full of them is the failure this
 * module refuses everywhere else.
 */
function missionIdIn(fileName: string, root: string): MissionId {
  const stem = fileName.slice(0, -REPLAY_SUFFIX.length);

  let decoded: string;
  try {
    decoded = decodeURIComponent(stem);
  } catch {
    throw new MissionFileNameError(
      `${join(root, fileName)} is not a Mission: its name is not an encoded MissionId`,
    );
  }

  if (decoded.trim().length === 0 || encodeURIComponent(decoded) !== stem) {
    throw new MissionFileNameError(
      `${join(root, fileName)} is not a Mission: a Mission's file is named ` +
        `${JSON.stringify(`${encodeURIComponent(decoded)}${REPLAY_SUFFIX}`)}`,
    );
  }

  // The one cast this direction needs, and the reason it is safe is the check above it: a MissionId is a
  // non-blank string and nothing else, and `decoded` has just been shown to be one.
  return decoded as MissionId;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: lines
 * ---------------------------------------------------------------------------------------------- */

/** One entry as a line, or a refusal. Never returns a line with a newline in it. */
function lineOf(entry: ReplayEntry): string {
  let line: string | undefined;
  try {
    line = JSON.stringify(entry);
  } catch (cause) {
    throw new InvalidReplayEntryError(`it cannot be JSON — ${messageOf(cause)}`);
  }

  if (typeof line !== "string") {
    throw new InvalidReplayEntryError(`JSON.stringify answered ${shown(line)}`);
  }
  if (line.includes(LINE_END)) {
    // Unreachable through `JSON.stringify`, which escapes every newline. Checked because the whole
    // format rests on it: one entry, one line.
    throw new InvalidReplayEntryError("its JSON contains a line ending");
  }

  return line;
}

/**
 * Every entry of a file, in order, or the first corruption.
 *
 * The tail is checked before anything is parsed, because a file that does not end with a line ending is
 * a file that was still being written — the ordinary way an append-only file dies — and the offset of
 * that fragment is what makes the recovery mechanical.
 */
function entriesIn(text: string, path: string): Replay {
  if (text.length === 0) {
    return frozen([]);
  }

  const lines = text.split(LINE_END);
  // `split` always answers one more piece than there are line endings: `""` when the file ends with one,
  // and the incomplete fragment when it does not.
  const fragment = lines.pop() ?? "";
  if (fragment.length > 0) {
    throw new CorruptReplayError(
      path,
      lines.length + 1,
      Buffer.byteLength(text.slice(0, text.length - fragment.length), "utf8"),
      "has no line ending: it was still being written",
    );
  }

  const entries: ReplayEntry[] = [];
  let at = 0;

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new CorruptReplayError(path, index + 1, at, "is empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new CorruptReplayError(path, index + 1, at, `is not JSON — ${messageOf(cause)}`);
    }

    const fault = faultIn(parsed);
    if (fault !== undefined) {
      throw new CorruptReplayError(path, index + 1, at, fault);
    }

    // The cast the module doc argues for: the skeleton has been checked, and what is inside a Command or
    // an Event is deliberately not, because a Replay records intents the domain refused for being
    // malformed.
    entries.push(Object.freeze(parsed as ReplayEntry));
    at += Buffer.byteLength(line, "utf8") + LINE_END.length;
  }

  return frozen(entries);
}

/**
 * What is wrong with a value that is not a `ReplayEntry`, or `undefined` when nothing is.
 *
 * The **skeleton** and nothing deeper: the two fields, that the Command says what kind it is, and that
 * the Decision carries the payload its own member declares. Every condition stays inline in its `if`,
 * because TypeScript does not narrow through an aliased compound condition that uses `in`.
 */
function faultIn(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `is ${shown(value)}, not a recorded entry`;
  }
  if (!("command" in value) || !isKinded(value.command)) {
    return "carries no Command with a kind";
  }
  if (!("decision" in value)) {
    return "carries no Decision";
  }

  const decision: unknown = value.decision;
  if (typeof decision !== "object" || decision === null || !("kind" in decision)) {
    return `carries a Decision that is ${shown(decision)}`;
  }

  if (decision.kind === "accepted") {
    if (!("events" in decision) || !Array.isArray(decision.events)) {
      return "was accepted and carries no list of Events";
    }
    // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
    const events: readonly unknown[] = decision.events;
    const nameless = events.findIndex((event) => !isKinded(event));
    if (nameless >= 0) {
      // `stepsOf` switches on `event.kind`, so a fact that does not say what it is would throw where the
      // Replay is read rather than where it was loaded.
      return `carries an accepted Event at position ${nameless} with no kind`;
    }
    return undefined;
  }

  if (decision.kind === "refused") {
    if (!("refusal" in decision)) {
      return "was refused and carries no Refusal";
    }
    const refusal: unknown = decision.refusal;
    if (typeof refusal !== "object" || refusal === null) {
      return `carries a Refusal that is ${shown(refusal)}`;
    }
    if (!("reason" in refusal) || typeof refusal.reason !== "string") {
      return "carries a Refusal with no reason";
    }
    // `stepsOf` joins the violations, so a Refusal without them is a Replay that throws when read.
    if (!("violations" in refusal) || !Array.isArray(refusal.violations)) {
      return "carries a Refusal with no list of violations";
    }
    return undefined;
  }

  return `carries a Decision that is neither accepted nor refused, but ${shown(decision.kind)}`;
}

/** Whether a value is an object that says what kind it is. A Command and an Event both must. */
function isKinded(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    value.kind.trim().length > 0
  );
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the disk
 * ---------------------------------------------------------------------------------------------- */

/**
 * Runs each unit of work after the one before it, whatever became of that one.
 *
 * The Replay's order is the record, so two appends fired without an `await` between them must land in
 * the order they were asked for. Failures do not poison the queue: the tail swallows them, and the
 * caller still gets the rejection of its own call.
 */
function appendQueue(): (work: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return (work) => {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

/**
 * `fsync` the directory, so a newly created file's **name** is durable and not only its contents.
 *
 * A failure is ignored on purpose: opening a directory is not permitted on every platform (Windows),
 * and refusing to store a Mission there would be a worse answer than the weaker durability claim the
 * module doc states.
 */
async function syncName(root: string): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(root, "r");
  } catch {
    return;
  }

  try {
    await handle.sync();
  } catch {
    // Same reason as above: the bytes of the entry are already synced.
  } finally {
    await handle.close();
  }
}

/** Whether a failure is "there is no such file", which is the only one this module reads as an answer. */
function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"
  );
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

/** A Replay handed out, frozen like every value the engine hands out. Shallow, exactly as `submit`. */
function frozen(entries: readonly ReplayEntry[]): Replay {
  return Object.freeze(entries);
}

/** A list of ids handed out, frozen for the same reason. */
function frozenIds(ids: readonly MissionId[]): readonly MissionId[] {
  return Object.freeze(ids);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure. Mirrors `harness.ts` and the pty runner, for one vocabulary. */
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
