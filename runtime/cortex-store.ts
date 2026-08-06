/**
 * The Cortex on disk: the Facts of a Workspace as one JSONL file, appended one Fact per line, read
 * back whole and narrowed by a query.
 *
 * ```
 * <workspace>/.megazord/cortex.jsonl
 * ```
 *
 * **One file per Workspace, and that is the glossary rather than a convenience.** A Workspace is "the
 * project where Missions happen, and the sharing scope of the Cortex", and a Cortex is "the fact memory
 * shared by every Zord of a Workspace, which outlives the session". Both halves of that fall out of the
 * path: every Zord of every Mission of this Workspace appends to and reads the same file, so a Fact
 * recorded by a scout in one Mission is there for a builder in the next one, and it is there after the
 * app is closed. A file per Mission would have made the Cortex a Mission's private notebook, which is
 * the one thing it is defined not to be.
 *
 * `.megazord/` is the same directory `mission-store.ts` writes Replays into, and the Cortex sits beside
 * `missions/` rather than inside it — that store's own doc says which of the two owns the directory
 * level: "the Missions need a directory that is theirs, or that answer becomes a guess about which files
 * in `.megazord/` are Replays".
 *
 * ## Why this file is not in `engine/`
 *
 * It touches a disk. `engine/mission.e2e.test.ts` reads every non-test source under `engine/` and
 * asserts every `from "…"` specifier is a relative path, which is the structural half of "no network, no
 * CLI" — and `node:fs/promises` is neither relative nor pure. So it lives here, where the operating
 * system is allowed in: **`runtime/` may import `engine/`; `engine/` must never import `runtime/`.**
 *
 * As with the Mission store, the import from the engine is **type-only**, so no line of engine code runs
 * here and this module cannot become a second place where a rule lives. What crosses is `Instant`,
 * `MissionId` and `ZordId`, and all three are erased at compile time; `cortex-store.test.ts` reads the
 * emitted JavaScript and asserts it requires nothing but two Node builtins.
 *
 * That decision has one visible consequence, stated here rather than discovered: **`recordedAt` is not
 * checked against `instant()`.** A Fact's moment is a string this module stores and hands back, and
 * nothing here computes with it — the record's order is the file's, never the clock's (see "Order is the
 * record's"). By this repository's own rule, what a value is checked for depends on what is done with
 * it, so `recordedAt` is required to be a non-blank string and its *spelling* is judged where an
 * `Instant` is built, at the boundary that builds one. A Fact whose moment is nonsense is poorer
 * history, exactly as a killed Mission with a blank reason is, and it is not an unreadable Fact.
 *
 * ## What a Fact carries, and why every field of it is required
 *
 * The glossary is exact: a Fact is "one Cortex entry, **attributed to who wrote it and to the Mission it
 * came from**". So the attribution and the origin are not metadata a caller may omit — they are half the
 * definition, and a Fact with either missing is the always-zero field this project keeps refusing. Both
 * are required at the type level and re-checked at runtime, because a Fact arrives from a Zord through
 * the control plane, which means from a `JSON.parse`.
 *
 * - `zordId` — **who wrote it.** A Zord is the only party in this product that has an id, so a Zord is
 *   who a Fact can be attributed to.
 * - `missionId` — **the Mission it came from.** All work happens inside a Mission, so every Fact has one
 *   to come from; it is what lets a reader ask "what did the Mission that touched this last learn".
 * - `recordedAt` — when it was written down, for a human reading the Cortex.
 * - `subject` — the key a Fact is found by. See "Finding a Fact".
 * - `body` — what is known. Verbatim, capitals and line breaks and all.
 *
 * ### Attribution, and how this differs from the engine's four silent facts
 *
 * `CapAuthorised`, `GateDecided`, `MissionKilled` and a `Step` all record **no author**, and that is one
 * declared Gap with four sites: nothing in `engine/` names a human, so an `authorisedBy` would be a
 * claim no rule could check. This module answers the same question differently, and the difference is
 * the whole reason it is allowed to:
 *
 * - Those four facts are the record of a **human's** decision, and there is no human identity anywhere
 *   in this repository to record. Nothing changed about that here.
 * - A Fact is written by a **Zord**, and a Zord *is* named: `ZordId` is one of the engine's five ids,
 *   the same id a `Delegated` fact already carries. So attribution is not a new identity concept — it
 *   is the one that exists, used for the party that actually acts.
 *
 * **Declared Gap, and it is the fifth site of the same family:** a human cannot write a Fact, and
 * neither can the Core. The Core is a capability set with no id, and a person at a Cockpit has no id at
 * all, so a Fact either carries a ZordId or it is refused. What a Surface must not do is invent one — a
 * `zordId` of `"human"` would put an unfalsifiable claim in the shared memory of the Workspace, forever,
 * which is worse than not being able to write. Whoever adds an actor model adds it here as the fifth
 * site, in the same change as the other four.
 *
 * ## Finding a Fact: what is supported, and what deliberately is not
 *
 * A Zord must be able to find what it needs without putting the Workspace's whole memory into a prompt.
 * That is a bound on **what is returned**, not on what is read from disk, and the distinction is worth
 * being blunt about: `read` scans the whole file every time. What the query buys is what enters the
 * prompt, which is the thing that is actually scarce.
 *
 * Supported, and all of it conjunctive — every filter given must hold:
 *
 * - `missionId` — Facts that came from one Mission.
 * - `zordId` — Facts written by one Zord.
 * - `subject` — Facts under one subject, matched on the normalised key (see below).
 * - `limit` — at most N Facts, the **most recently recorded** ones, still in record order.
 *
 * And `subjectsIn(reading)` answers the subjects a reading holds with a count each, so the navigation a
 * Zord does is: read the subjects, pick one, read that subject. It is a pure reader over what `read`
 * answered rather than a method of the store, for the reason the engine already keeps `stepsOf` and
 * `meterOf` outside the aggregate: it derives nothing the reading does not already contain, and putting
 * it in the store would make it a second answer that could disagree with the first.
 *
 * Not supported, deliberately, each with its reason:
 *
 * - **No search over the body**, no ranking, no similarity, no embeddings. Deciding which prose answers
 *   a question is a judgement about text, and this repository draws that line in the same place twice
 *   already: the engine refuses to judge what a Zord wrote, and the pty runner refuses to trim its
 *   output. A substring scan is the tempting middle, and it is the worst of the three: it finds the
 *   Facts that happen to share a word and silently misses the ones that say the same thing differently,
 *   so a Zord would read "nothing is known about this" from a Cortex that knows.
 * - **No time range.** The store does not trust `recordedAt` enough to order by it, so it must not
 *   filter by it either — a filter on a field whose value nothing checks would answer confidently and
 *   wrongly.
 * - **No deletion and no revision.** A Cortex is append-only, like the Replay. Retracting a Fact that
 *   turned out to be false is a real need and it needs a rule this module has no basis for — who may
 *   retract, and whether a reader hides the retracted Fact or shows it struck through — so it is a
 *   declared Gap rather than a `delete` nobody governs.
 * - **No deduplication.** Two Zords recording the same sentence are two Facts, because the second one is
 *   a second attribution and that is information. A Fact has no id for the same reason: nothing refers
 *   to one.
 * - **No index and no size bound.** The whole file is read on every `read`, and a Fact may be as long as
 *   the caller likes. Bounding either needs a number nobody here has measured, and inventing one is the
 *   move this project refuses when it declares a cost of zero rather than pricing wall-clock time. When
 *   a Workspace's Cortex outgrows a full scan the answer is an index; it is never a bigger prompt.
 *
 * ## The subject is a key, so it is normalised — once, for every comparison
 *
 * A subject is trimmed, lower-cased and has its inner runs of whitespace collapsed to single spaces.
 * `Cockpit  Panes` and `cockpit panes` are one subject. Without that, two Zords would write about the
 * same thing under two spellings and neither would ever see the other's Facts — the shared memory
 * would silently stop being shared, which is the under-reporting failure this project treats as the
 * worse of the two directions.
 *
 * `subjectKeyOf` is the **one** derivation, and it is exported and read by every comparison: by `write`
 * before a Fact is stored, by `read` on both the query and each stored subject, and by `subjectsIn` when
 * it tallies. That is the shape BUG-3 was fixed into — two derivations of one notion drift, and the
 * drift is silent — so a caller that wants to display or group subjects itself uses the same function
 * rather than reimplementing the rule.
 *
 * The **ids are not folded**: `missionId` and `zordId` are compared byte for byte, as the engine
 * compares every id. An id is chosen by a machine and means nothing to a reader; a subject is written by
 * whoever recorded the Fact and means everything to the next one.
 *
 * ## Order is the record's, not the clock's
 *
 * `read` answers Facts in the order they were **appended**, and `limit` keeps the last N of that order.
 * It never sorts by `recordedAt`, and the reason is the same one that makes `recordedAt` unchecked: it
 * is a string a caller handed over. A Fact whose moment is a lie — a clock behind by an hour, a Zord
 * that copied a timestamp — must not be able to reorder the Workspace's memory, and the file's order is
 * the one ordering this module is certain of because it is the one it created.
 *
 * `limit` keeps the *most recent* end rather than the first N because recency is what a reader wants
 * when it can only afford some, and it keeps them in record order rather than reversed so that reading
 * five Facts and reading all of them agree about which came first.
 *
 * ## A line that is not a Fact is skipped **and reported** — which the Mission store refuses to do
 *
 * `load` in `mission-store.ts` rejects the whole file on one bad line, and its argument is right there:
 * a Replay *folds* to the state of a Mission, so a Replay missing an entry is not a smaller answer, it
 * is a **wrong** one, and nothing downstream can tell. A Cortex is not folded. It is a set of
 * independent Facts, so a Fact that cannot be read makes the answer smaller and never makes the rest of
 * it wrong.
 *
 * That difference alone would not be enough — "under-reporting gets believed" applies to a Zord that
 * reads forty Facts of forty-one and is never told, exactly as it applies to a scan that quietly passes
 * a tree. So the damage is **in the answer**: `read` returns `{ facts, unreadable }`, and each unreadable
 * line carries its 1-based line number, the byte it starts at and what is wrong with it. Nothing is
 * dropped silently, and a Cockpit can say "two Facts on this Workspace's Cortex cannot be read" while
 * still showing the other thirty-nine. A Refusal is a return value here for the same reason it is one in
 * the engine: it is what makes the failure impossible for a caller to not receive.
 *
 * Two more reasons this is not the Mission store's answer wearing a different hat:
 *
 * - **A Cortex has many writers.** Every Zord of the Workspace appends to it, in parallel, from
 *   different processes. The Mission store can argue that "a torn line means the writer died mid-write,
 *   so no live writer sits behind one", because it has one writer per Mission by construction. Here a
 *   Zord killed mid-append leaves a torn line that other Zords immediately append *after*, so the damage
 *   is in the middle of the file rather than at its tail — and rejecting the whole file would take the
 *   Workspace's shared memory down for every Zord, in every future Mission, until a human ran
 *   `truncate` at a shell.
 * - **The refusal exists to protect an offset, and there is no offset to protect here.** The Mission
 *   store refuses to return a prefix because appending after a torn tail buries it where no future
 *   `truncate -s <at>` can reach, destroying every entry after it. Skipping per line has no such
 *   dependency: a buried unreadable line stays reported for as long as it is there, and every other Fact
 *   is readable the whole time. The recovery is to delete that one line, and the line number is what
 *   makes it mechanical.
 *
 * A **blank** line is neither a Fact nor damage: it is the ordinary residue of the newline guard below,
 * so it is passed over in silence rather than reported. That is the one place this module says less than
 * the Mission store, which reads an empty line as corruption, and it is because here an empty line is
 * something this module can itself produce.
 *
 * ## Appending: the newline guard, and what "written" means
 *
 * `write` resolves once the Fact's bytes are **on the medium**: the file is opened `a+`, one `write` puts
 * the line at the end (`O_APPEND`, so the position is the kernel's and two writers cannot overwrite each
 * other), then `fsync` on the file, then `fsync` on `.megazord/` so a newly created file's *name* is
 * durable too. The directory `fsync` failing is ignored — it is not permitted on every platform, and
 * refusing to record a Fact would be a worse answer than the weaker durability claim this sentence
 * makes. What all of it relies on is the platform honouring `fsync`, which a consumer disk with a lying
 * write cache does not.
 *
 * Before the write, if the file is not empty and does not end with a line ending, **one is written
 * first.** The Mission store deliberately has no such guard and this module needs one, for a reason that
 * follows from everything above: appending straight onto a torn tail would splice this Fact into the
 * garbage and lose it too, and here nothing later refuses to read the file, so the loss would be silent
 * and permanent. With the guard, somebody else's half-written line stays exactly one unreadable line and
 * this Fact is readable. It is not a repair — the torn line is left alone, reported, for a human to
 * delete.
 *
 * The guard reads one byte, so between that read and the write another process may append: the residue
 * is a blank line, which is why a blank line is not damage. Appends from *this* store are serialised in
 * call order, so a caller that fires two without an `await` still gets them in the order it asked.
 *
 * The bound on all of it, stated rather than hidden: a torn line requires a process to die **inside** a
 * single `write` of a few hundred bytes to an `O_APPEND` descriptor. Node loops until every byte is
 * written, so a short write is a torn line as well; it is the same exposure `mission-store.ts` accepts
 * and names.
 *
 * One thing that cannot fail: **serialising a Fact.** `write` projects what it was given onto exactly
 * the five fields, all of them strings, so `JSON.stringify` can neither throw nor answer `undefined` —
 * there is no circular reference and no `BigInt` to reach it. The Mission store needs an
 * `InvalidReplayEntryError` for that case and this module does not, and the difference is that a Fact is
 * a value with a known shape while a `ReplayEntry` carries whatever Command a Surface recorded. The
 * projection is also why a field nobody declared cannot be smuggled into the Cortex: it is dropped, and
 * what comes back out is what a `Fact` is.
 */

import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

// Type-only, and that is the point: no engine code runs in this module. See the module doc.
import type { Instant, MissionId, ZordId } from "@engine/index";

/* -------------------------------------------------------------------------------------------------
 * The layout
 * ---------------------------------------------------------------------------------------------- */

/** Everything this product writes into a Workspace lives under one directory. */
const STORE_ROOT = ".megazord";

/**
 * The Cortex is one file of the Workspace, beside `missions/` rather than inside it.
 *
 * JSONL: one JSON value per line, appended. Readable by `wc -l`, `tail` and a human, which matters for
 * a file whose whole purpose is that somebody else can find what is in it.
 */
const CORTEX_FILE = "cortex.jsonl";

/** The line ending. `\n` and not `\r\n`: a record separator, not a document for a terminal. */
const LINE_END = "\n";

/** The byte the newline guard looks for. */
const LINE_END_BYTE = 0x0a;

/* -------------------------------------------------------------------------------------------------
 * What a Fact is
 * ---------------------------------------------------------------------------------------------- */

/**
 * One Cortex entry: what is known, attributed to the Zord that wrote it and to the Mission it came from.
 *
 * Every field is required, and the two that carry the attribution are required *because* they are the
 * definition — see the module doc. `subject` is stored normalised (`subjectKeyOf`); `body` is stored
 * verbatim.
 */
export type Fact = {
  /** When it was written down. A moment for a reader; never an ordering — see "Order is the record's". */
  readonly recordedAt: Instant;
  /** The Mission it came from. Required: a Fact with no origin is a claim nobody can place. */
  readonly missionId: MissionId;
  /** The Zord that wrote it. Required, and the only kind of author this product can name. */
  readonly zordId: ZordId;
  /** The key it is found by, normalised. */
  readonly subject: string;
  /** What is known. */
  readonly body: string;
};

/**
 * How a reader narrows the Cortex. Every filter given must hold; an absent one asks nothing.
 *
 * There is no time range and no search over the body, both on purpose — see the module doc.
 */
export type FactQuery = {
  /** Only Facts from this Mission. Compared byte for byte, as ids are everywhere. */
  readonly missionId?: MissionId;
  /** Only Facts written by this Zord. Compared byte for byte. */
  readonly zordId?: ZordId;
  /** Only Facts under this subject, compared as normalised keys. */
  readonly subject?: string;
  /** At most this many Facts: the most recently recorded ones, still in record order. */
  readonly limit?: number;
};

/**
 * A line of the Cortex that is not a Fact, reported rather than dropped.
 *
 * `line` is 1-based, because it is what an editor shows, and deleting that line is the whole recovery.
 * `at` is the byte the line starts at, for a file too large to open in an editor.
 */
export type UnreadableFact = {
  readonly line: number;
  readonly at: number;
  readonly detail: string;
};

/**
 * What a read of the Cortex answers: the Facts, and the damage.
 *
 * `unreadable` is **not** narrowed by the query — a line nobody can read cannot be shown to match or
 * not match a filter, so what it reports is every unreadable line in the file. A caller filtering by
 * Mission still learns that this Workspace's Cortex has a hole in it.
 */
export type CortexReading = {
  readonly facts: readonly Fact[];
  readonly unreadable: readonly UnreadableFact[];
};

/** One subject of a reading, with how many of its Facts are in that reading. */
export type SubjectTally = {
  readonly subject: string;
  readonly facts: number;
};

/* -------------------------------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------------------------------- */

/**
 * A Fact cannot be recorded, so nothing was written.
 *
 * Reachable from a well-typed call — a `subject` of `"   "` satisfies `string` — and from every cast,
 * which is how a Fact arrives when a Zord submits one through the control plane. It is refused at the
 * door rather than stored, because the Cortex is shared by every Zord of the Workspace and outlives the
 * session: a Fact nobody can attribute would sit in it being unreadable forever.
 */
export class InvalidFactError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this Fact cannot be recorded: it ${detail}`);
    this.name = "InvalidFactError";
    this.detail = detail;
  }
}

/**
 * A query the Cortex cannot be asked, so nothing was read.
 *
 * Refused rather than ignored: a filter that is quietly dropped answers the whole Cortex to a caller
 * that asked for one subject, and a caller cannot tell the difference between "everything, because your
 * filter was nonsense" and "everything, because that is what matches".
 */
export class InvalidFactQueryError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`the Cortex cannot be read like that: ${detail}`);
    this.name = "InvalidFactQueryError";
    this.detail = detail;
  }
}

/* -------------------------------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------------------------------- */

/** What a store is built with. */
export type CortexStoreOptions = {
  /**
   * The Workspace root. `.megazord/cortex.jsonl` is created inside it.
   *
   * Required, and never defaulted to `process.cwd()`: the Workspace **is** the sharing scope of the
   * Cortex, so defaulting it would silently split one Workspace's memory in two whenever a process was
   * started from a subdirectory. Same rule as the Mission store's `workspace` and the pty runner's
   * `cwd`, and it is written down in one more place because the cost of getting it wrong here is a Zord
   * quietly not seeing what another one recorded.
   */
  readonly workspace: string;
};

/** The Cortex of a Workspace, as a file. */
export interface CortexStore {
  /**
   * Records one Fact. Resolves once its bytes are durable — see "Appending".
   *
   * Answers the Fact **as recorded**: the five fields, with the subject normalised. A caller that needs
   * to show what it wrote reads that rather than assuming its own value survived unchanged.
   *
   * @throws {InvalidFactError} when a field is missing or blank. Nothing is written.
   */
  write(fact: Fact): Promise<Fact>;
  /**
   * The Facts of the Workspace, in the order they were recorded, narrowed by the query.
   *
   * A Workspace whose Cortex was never written to reads as an empty reading, because that is what an
   * absent file means. Every other I/O failure rejects. A line that is not a Fact is reported in
   * `unreadable` and never thrown — see "A line that is not a Fact".
   *
   * @throws {InvalidFactQueryError} when the query itself cannot be honoured. Nothing is read.
   */
  read(query?: FactQuery): Promise<CortexReading>;
}

/**
 * Builds a store over one Workspace's Cortex.
 *
 * It holds no Fact and caches nothing: the only state is the queue that keeps this instance's writes in
 * call order. Two stores over one Workspace are two writers of one file, which is what the append is
 * built to survive.
 */
export function cortexStore(options: CortexStoreOptions): CortexStore {
  const root = join(options.workspace, STORE_ROOT);
  const path = join(root, CORTEX_FILE);
  const queued = writeQueue();

  return {
    async write(fact: Fact): Promise<Fact> {
      // Before the queue and before anything is opened: a Fact that cannot be recorded is the caller's
      // bug, and it should not wait for a disk or leave an empty file behind.
      const read = factIn(fact);
      if ("fault" in read) {
        throw new InvalidFactError(read.fault);
      }
      const line = lineOf(read.fact);

      await queued(async () => {
        await mkdir(root, { recursive: true });

        // `a+` rather than `a`: the newline guard has to read the last byte, and `a` is write-only.
        // Every write still lands at the end of the file, wherever the read left the position.
        const handle = await open(path, "a+");
        try {
          await handle.writeFile(`${await guardedStart(handle)}${line}${LINE_END}`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }

        await syncName(root);
      });

      return read.fact;
    },

    async read(query?: FactQuery): Promise<CortexReading> {
      // Validated before the file is opened, for the same reason a Fact is: nothing about a disk makes a
      // nonsensical filter answerable.
      const asked = askedFor(query);

      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (cause) {
        if (isMissing(cause)) {
          return reading([], []);
        }
        throw cause;
      }

      const held = factsIn(text);
      return reading(narrowed(held.facts, asked), held.unreadable);
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Readers over a reading
 * ---------------------------------------------------------------------------------------------- */

/**
 * The subjects a reading holds, with a count each, in ascending order.
 *
 * This is how a Zord navigates a Cortex it cannot afford to read: the subjects are short, so they fit in
 * a prompt where the bodies do not, and the next read names one of them. It is a pure reader over what
 * `read` answered — the same shape as `stepsOf` over a Replay — so it can never disagree with the store
 * about what is in the file, and it narrows with the query: `subjectsIn` of a reading of one Mission
 * answers that Mission's subjects.
 */
export function subjectsIn(reading: CortexReading): readonly SubjectTally[] {
  const counted = new Map<string, number>();
  for (const fact of reading.facts) {
    // Folded here, and this is the one place in the module where re-folding is load-bearing: a
    // `CortexReading` is a plain value, so a caller can build one — with no cast at all, because
    // `Fact.subject` is a `string` and no type can say "already folded" — and hand it to this reader.
    // A tally that trusted the spelling would then disagree with `read({ subject })` about how many
    // Facts a subject has. Idempotent for a reading that came from `read`, where `factIn` folded it.
    const subject = subjectKeyOf(fact.subject);
    counted.set(subject, (counted.get(subject) ?? 0) + 1);
  }

  return Object.freeze(
    [...counted.entries()]
      .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
      .map(([subject, facts]) => Object.freeze({ subject, facts })),
  );
}

/**
 * The key a subject is found by: trimmed, lower-cased, inner whitespace collapsed.
 *
 * Exported because it is the **one** derivation of "the same subject". A caller that groups or displays
 * subjects itself uses this rather than reimplementing the rule; two derivations of one notion drift, and
 * the drift is silent.
 *
 * Where it is called from is worth writing down, because a falsification found the answer surprising.
 * **Every `Fact` that exists has had its subject folded by `factIn`** — the one function that turns a
 * value into a Fact, on the way in from `write` and on the way back from a line of the file alike — and
 * the query is folded once by `subjectAsked`. So `narrowed` compares two keys with `===` and folds
 * nothing: what keeps the two sides in step is that both went through this function, not that one of them
 * goes through it twice. `subjectsIn` is the exception and its comment says why.
 *
 * `toLowerCase` and not `toLocaleLowerCase`: the fold must not depend on the machine's locale, or one
 * Zord's Turkish `I` would stop matching another's.
 */
export function subjectKeyOf(subject: string): string {
  return subject.trim().replace(/\s+/gu, " ").toLowerCase();
}

/* -------------------------------------------------------------------------------------------------
 * Internals: a Fact, read from a value nobody validated
 * ---------------------------------------------------------------------------------------------- */

/** Either the Fact a value holds, or what is wrong with it. One derivation, used by `write` and `read`. */
type FactRead = { readonly fact: Fact } | { readonly fault: string };

/**
 * The Fact a value carries, projected onto exactly the five fields, or the fault that stops it.
 *
 * Every condition stays inline in its `if`, because TypeScript does not narrow through an aliased
 * compound condition that uses `in`. The three casts at the end are the ones a brand always needs — a
 * brand has no runtime representation, so there is nothing in a string to check one against — and what
 * makes them safe is the check directly above each: an id is a non-blank string and nothing else.
 */
function factIn(value: unknown): FactRead {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { fault: `is ${shown(value)}, not a Fact` };
  }
  if (!("zordId" in value) || typeof value.zordId !== "string" || value.zordId.trim().length === 0) {
    return { fault: "is attributed to no Zord: a Fact carries the ZordId that wrote it" };
  }
  if (
    !("missionId" in value) ||
    typeof value.missionId !== "string" ||
    value.missionId.trim().length === 0
  ) {
    return { fault: "came from no Mission: a Fact carries the MissionId it was learnt in" };
  }
  if (
    !("recordedAt" in value) ||
    typeof value.recordedAt !== "string" ||
    value.recordedAt.trim().length === 0
  ) {
    return { fault: "says nothing about when it was recorded" };
  }
  if (!("subject" in value)) {
    return { fault: "carries no subject, so nothing could ever find it" };
  }
  if (typeof value.subject !== "string") {
    return { fault: `carries a subject that is ${shown(value.subject)}` };
  }
  if (subjectKeyOf(value.subject).length === 0) {
    // A blank subject is not a subject: nothing could ever ask for it, so the Fact would be reachable
    // only by reading the whole Cortex, which is the thing a subject exists to avoid.
    return { fault: "carries a blank subject, so nothing could ever find it" };
  }
  if (!("body" in value) || typeof value.body !== "string" || value.body.trim().length === 0) {
    return { fault: "says nothing: a Fact whose body is blank is not knowledge" };
  }

  return {
    fact: Object.freeze({
      recordedAt: value.recordedAt as Instant,
      missionId: value.missionId as MissionId,
      zordId: value.zordId as ZordId,
      subject: subjectKeyOf(value.subject),
      body: value.body,
    }),
  };
}

/**
 * One Fact as a line.
 *
 * Cannot fail, and that is a property of the projection rather than luck: every field of a `Fact` built
 * by `factIn` is a `string`, so there is no circular reference, no `BigInt` and no `toJSON` for
 * `JSON.stringify` to trip over, and every newline inside a body is escaped. The one check is the
 * invariant the whole format rests on — one Fact, one line — kept because it is cheap and because the
 * file is unreadable for every future reader if it ever stops holding.
 */
function lineOf(fact: Fact): string {
  const line = JSON.stringify(fact);
  if (line.includes(LINE_END)) {
    throw new InvalidFactError("cannot be one line of JSON");
  }
  return line;
}

/**
 * Every Fact of a file, in record order, and every line that is not one.
 *
 * A blank line is neither: it is the residue the newline guard can leave, so it is passed over. The
 * offset is tracked in **bytes**, because that is what a file has and what a human needs to find a line
 * in one too large to open.
 */
function factsIn(text: string): { facts: Fact[]; unreadable: UnreadableFact[] } {
  const facts: Fact[] = [];
  const unreadable: UnreadableFact[] = [];

  if (text.length === 0) {
    return { facts, unreadable };
  }

  const lines = text.split(LINE_END);
  // `split` always answers one more piece than there are line endings: `""` when the file ends with one,
  // and whatever was still being written when it does not.
  const fragment = lines.pop() ?? "";
  let at = 0;

  for (const [index, line] of lines.entries()) {
    const read = lineIn(line);
    if (read !== undefined) {
      if ("fault" in read) {
        unreadable.push(frozenFault(index + 1, at, read.fault));
      } else {
        facts.push(read.fact);
      }
    }
    at += Buffer.byteLength(line, "utf8") + LINE_END.length;
  }

  if (fragment.length > 0) {
    // The ordinary death of an append-only file: a process killed between the write and the newline. It
    // is reported like any other unreadable line, and the next `write` will put a line ending in front
    // of its own Fact rather than splicing into this one.
    unreadable.push(
      frozenFault(lines.length + 1, at, "has no line ending: it was still being written"),
    );
  }

  return { facts, unreadable };
}

/**
 * What one line of the file holds: a Fact, a fault, or **nothing at all** when it is blank.
 *
 * The two failures a line can have are different and both are reported the same way — it is not JSON, or
 * it is JSON that is not a Fact — and a blank line is neither, so it answers `undefined` rather than
 * being counted as damage. See "A line that is not a Fact" for why a blank line is this module's own
 * residue and not a corruption.
 */
function lineIn(line: string): FactRead | undefined {
  if (isBlank(line)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    return { fault: `is not JSON — ${messageOf(cause)}` };
  }

  return factIn(parsed);
}

/** A blank line carries no Fact and no damage, so `factsIn` must not read one as either. */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the query
 * ---------------------------------------------------------------------------------------------- */

/** A query, checked and with its subject folded once. Absent means "asks nothing". */
type Asked = {
  readonly missionId: string | undefined;
  readonly zordId: string | undefined;
  readonly subject: string | undefined;
  readonly limit: number | undefined;
};

/**
 * The query a caller asked, or a refusal.
 *
 * `read()` and `read(undefined)` are the same call and both ask nothing — a default parameter fires on
 * `undefined`, which is deliberate here and is why the probe for "a query that is not an object" has to
 * pass `null` rather than `undefined`.
 */
function askedFor(query: FactQuery | undefined): Asked {
  if (query === undefined) {
    return { missionId: undefined, zordId: undefined, subject: undefined, limit: undefined };
  }
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new InvalidFactQueryError(`a query is a set of filters, received ${shown(query)}`);
  }

  return {
    missionId: idAsked(query, "missionId"),
    zordId: idAsked(query, "zordId"),
    subject: subjectAsked(query),
    limit: limitAsked(query),
  };
}

/** One id filter: absent, or a non-blank string. A blank one would match nothing and mean everything. */
function idAsked(query: FactQuery, field: "missionId" | "zordId"): string | undefined {
  const asked: unknown = field === "missionId" ? query.missionId : query.zordId;
  if (asked === undefined) {
    return undefined;
  }
  if (typeof asked !== "string" || asked.trim().length === 0) {
    throw new InvalidFactQueryError(
      `${field} must be a non-blank id when it is given, received ${shown(asked)}`,
    );
  }
  return asked;
}

/** The subject filter, folded with the same function that folded what is on disk. */
function subjectAsked(query: FactQuery): string | undefined {
  const asked: unknown = query.subject;
  if (asked === undefined) {
    return undefined;
  }
  if (typeof asked !== "string") {
    throw new InvalidFactQueryError(`subject must be a string when it is given, received ${shown(asked)}`);
  }

  const key = subjectKeyOf(asked);
  if (key.length === 0) {
    throw new InvalidFactQueryError(
      "subject is blank, and a blank subject is not a subject: leave it out to ask for every Fact",
    );
  }
  return key;
}

/**
 * The bound on how many Facts come back.
 *
 * Zero is allowed and answers no Facts — coherent for the same reason a Cap of zero is reached by a
 * Mission that spent nothing. A negative, a fraction and an `Infinity` are refused rather than clamped:
 * clamping answers a different question than the one asked, silently.
 */
function limitAsked(query: FactQuery): number | undefined {
  const asked: unknown = query.limit;
  if (asked === undefined) {
    return undefined;
  }
  if (typeof asked !== "number" || !Number.isInteger(asked) || asked < 0) {
    throw new InvalidFactQueryError(
      `limit must be a whole number of Facts, zero or more, received ${shown(asked)}`,
    );
  }
  return asked;
}

/**
 * The Facts a query asked for: every filter must hold, and `limit` keeps the most recent of them.
 *
 * Every comparison is `===` on values that were folded, or not, exactly once: an id is never folded, on
 * either side, and a subject was folded by `factIn` when the Fact was read and by `subjectAsked` when the
 * query was checked. Folding again here would be a third fold of the same string and — as a plant proved
 * — a comparison nothing could ever make disagree, which is a check that can only pass.
 */
function narrowed(facts: readonly Fact[], asked: Asked): readonly Fact[] {
  const matching = facts.filter(
    (fact) =>
      (asked.missionId === undefined || fact.missionId === asked.missionId) &&
      (asked.zordId === undefined || fact.zordId === asked.zordId) &&
      (asked.subject === undefined || fact.subject === asked.subject),
  );

  if (asked.limit === undefined || matching.length <= asked.limit) {
    return matching;
  }
  // The last N, still in record order: recency is what a bounded reader wants, and reversing would make
  // a bounded read disagree with a whole one about which Fact came first.
  return matching.slice(matching.length - asked.limit);
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the disk
 * ---------------------------------------------------------------------------------------------- */

/**
 * What has to be written before this Fact so it starts on a line of its own.
 *
 * `""` for an empty file or one that ends with a line ending; a line ending when somebody else's write
 * was cut short. See "the newline guard" in the module doc: without it this Fact would be spliced into a
 * torn line and lost with it, silently, because nothing here refuses to read the file afterwards.
 */
async function guardedStart(handle: FileHandle): Promise<string> {
  const { size } = await handle.stat();
  if (size === 0) {
    return "";
  }

  const last = Buffer.alloc(1);
  const { bytesRead } = await handle.read(last, 0, 1, size - 1);
  if (bytesRead === 1 && last[0] === LINE_END_BYTE) {
    return "";
  }
  return LINE_END;
}

/**
 * Runs each unit of work after the one before it, whatever became of that one.
 *
 * Two writes fired without an `await` between them must land in the order they were asked for. Failures
 * do not poison the queue: the tail swallows them, and the caller still gets the rejection of its own
 * call.
 */
function writeQueue(): (work: () => Promise<void>) => Promise<void> {
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
 * A failure is ignored on purpose: opening a directory is not permitted on every platform (Windows), and
 * refusing to record a Fact there would be a worse answer than the weaker durability claim the module
 * doc states.
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
    // Same reason as above: the bytes of the Fact are already synced.
  } finally {
    await handle.close();
  }
}

/** Whether a failure is "there is no such file", which is the only one this module reads as an answer. */
function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

/** A reading handed out, frozen like every value this repository hands out. */
function reading(facts: readonly Fact[], unreadable: readonly UnreadableFact[]): CortexReading {
  return Object.freeze({ facts: Object.freeze(facts), unreadable: Object.freeze(unreadable) });
}

function frozenFault(line: number, at: number, detail: string): UnreadableFact {
  return Object.freeze({ line, at, detail });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure. Mirrors the Mission store and the pty runner. */
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
