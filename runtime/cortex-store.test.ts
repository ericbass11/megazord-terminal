/**
 * These tests write to a real disk, and the one that matters uses **three processes**.
 *
 * Criterion 10 is "a Fact written with `memory_write` in one session is read by `memory_read` in the
 * next", and reading back the object that wrote it proves nothing about a file, a session or a Workspace.
 * So `wroteInAnotherProcess` spawns a `node` process that writes Facts and then **exits**, and
 * `readInAnotherProcess` spawns a second one that reads them; this Vitest process is a third reader that
 * saw neither. Each child reports its own pid, and the test asserts all three differ — otherwise the
 * proof is a claim in a comment.
 *
 * The compile step exists because bare Node cannot load `engine/`: its relative specifiers carry no
 * extension, which ESM refuses, so `node --experimental-strip-types engine/index.ts` fails on
 * `./domain/ids`. `tsc` with `--module commonjs` produces a tree Node requires happily, and it takes
 * about two seconds once per run. It is the same mechanism `mission-store.test.ts` uses, for the same
 * reason.
 *
 * Every temporary directory this file creates is removed afterwards, and the last test asserts the
 * repository root has no `.megazord/` in it: a Cortex test that left Facts behind in the Workspace it was
 * run from would be its own bug report.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  instant,
  missionId,
  zordId,
  type Instant,
  type MissionId,
  type ZordId,
} from "@engine/index";

import {
  InvalidFactError,
  InvalidFactQueryError,
  cortexStore,
  subjectKeyOf,
  subjectsIn,
  type CortexReading,
  type CortexStore,
  type Fact,
  type SubjectTally,
} from "./cortex-store";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

/* -------------------------------------------------------------------------------------------------
 * Temporary Workspaces
 * ---------------------------------------------------------------------------------------------- */

const created: string[] = [];

/** A directory of this run's own, removed at the end whatever happens. */
function temporary(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  created.push(made);
  return made;
}

/** A Workspace with nothing in it. `.megazord/` is the store's to create. */
function workspace(): string {
  return temporary("megazord-workspace-");
}

/**
 * Where the Cortex must be, written out rather than asked of the module.
 *
 * The duplication is deliberate: the PRD pins "Cortex on disk, Workspace-scoped", and the glossary makes
 * the Workspace the sharing scope — so a test that asked the module for its own path would agree with it
 * by construction and pin nothing. One file per Workspace is the claim.
 */
function cortexPath(root: string): string {
  return join(root, ".megazord", "cortex.jsonl");
}

function storeRoot(root: string): string {
  return join(root, ".megazord");
}

/** The lines of the Cortex as they are on disk, without the trailing empty piece. */
function linesOn(root: string): readonly string[] {
  return readFileSync(cortexPath(root), "utf8").split("\n").slice(0, -1);
}

afterAll(() => {
  for (const made of created) {
    rmSync(made, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------------------------------
 * The Facts being recorded
 * ---------------------------------------------------------------------------------------------- */

const COCKPIT = missionId("mission-cockpit");
const ENGINE = missionId("mission-engine");
const SCOUT = zordId("zord-scout");
const BUILDER = zordId("zord-builder");

/**
 * Instants built in order: nothing in this file reads a clock, and neither does the store.
 *
 * Derived from a fixed base rather than spelled out minute by minute, because the spelled-out version
 * ran past `11:59` and every Fact after that was refused by `instant()` — a fixture that cannot count is
 * a fixture that fails a test about something else.
 */
const FIRST_MOMENT = Date.parse("2026-08-06T11:00:00.000Z");

function clock(): () => Instant {
  let tick = 0;
  return () => {
    tick += 1;
    return instant(new Date(FIRST_MOMENT + tick * 60_000).toISOString());
  };
}

const at = clock();

/**
 * A happy-path Fact. Defaults are fine **here** and nowhere near a probe about a missing field: a
 * default parameter fires on `undefined`, so a fixture with defaults would build a perfectly valid Fact
 * and then the test would assert a refusal it caused itself. Every malformed Fact below is written out
 * inline.
 */
function fact(fields: {
  readonly subject: string;
  readonly body: string;
  readonly from?: MissionId;
  readonly by?: ZordId;
}): Fact {
  return {
    recordedAt: at(),
    missionId: fields.from ?? COCKPIT,
    zordId: fields.by ?? SCOUT,
    subject: fields.subject,
    body: fields.body,
  };
}

/** The three Facts the Workspace-scope tests use: two Zords, two Missions, two subjects. */
function recorded(): readonly Fact[] {
  return [
    fact({ subject: "Panes", body: "A Pane is a node-pty child, one per Zord." }),
    fact({
      subject: "providers",
      body: "claude and codex are on PATH here; gemini is not.",
      by: BUILDER,
    }),
    fact({
      subject: "Panes",
      body: "Killing a Pane must kill the process group, not the leader.",
      from: ENGINE,
      by: BUILDER,
    }),
  ];
}

async function writeAll(store: CortexStore, facts: readonly Fact[]): Promise<void> {
  for (const one of facts) {
    await store.write(one);
  }
}

/* -------------------------------------------------------------------------------------------------
 * Writing and reading in other processes
 * ---------------------------------------------------------------------------------------------- */

/** What the writing child reports: nothing of the Cortex, only that it wrote and who it was. */
type Wrote = {
  readonly written: number;
  readonly subjects: readonly string[];
  readonly pid: number;
};

/** What the reading child reports, all of it derived from what `read` gave it. */
type Read = {
  readonly facts: readonly Fact[];
  readonly unreadable: readonly { readonly line: number; readonly detail: string }[];
  readonly subjects: readonly SubjectTally[];
  readonly keyed: string;
  readonly frozen: boolean;
  readonly pid: number;
};

/**
 * The writer the first child runs: it builds each Fact through the engine's own constructors.
 *
 * CommonJS, over the compiled tree, requiring nothing but it. No template literals, so this stays
 * readable inside the one it is written with.
 */
const WRITER = [
  'const { cortexStore } = require("./runtime/cortex-store.js");',
  'const { instant, missionId, zordId } = require("./engine/index.js");',
  "",
  "const store = cortexStore({ workspace: process.argv[2] });",
  "const asked = JSON.parse(process.argv[3]);",
  "",
  "asked",
  "  .reduce(function (pending, one) {",
  "    return pending.then(function (subjects) {",
  "      return store",
  "        .write({",
  "          recordedAt: instant(one.recordedAt),",
  "          missionId: missionId(one.missionId),",
  "          zordId: zordId(one.zordId),",
  "          subject: one.subject,",
  "          body: one.body,",
  "        })",
  "        .then(function (stored) {",
  "          return subjects.concat([stored.subject]);",
  "        });",
  "    });",
  "  }, Promise.resolve([]))",
  "  .then(",
  "    function (subjects) {",
  "      process.stdout.write(",
  "        JSON.stringify({ written: asked.length, subjects: subjects, pid: process.pid }),",
  "      );",
  "    },",
  "    function (failed) {",
  "      process.stderr.write(String((failed && failed.stack) || failed));",
  "      process.exit(1);",
  "    },",
  "  );",
  "",
].join("\n");

/** The reader the second child runs. It never saw the process that wrote, and holds no shared object. */
const READER = [
  'const { cortexStore, subjectKeyOf, subjectsIn } = require("./runtime/cortex-store.js");',
  "",
  "const store = cortexStore({ workspace: process.argv[2] });",
  "const asked = process.argv[3] ? JSON.parse(process.argv[3]) : undefined;",
  "",
  "store.read(asked).then(",
  "  function (reading) {",
  "    process.stdout.write(",
  "      JSON.stringify({",
  "        facts: reading.facts,",
  "        unreadable: reading.unreadable,",
  "        subjects: subjectsIn(reading),",
  '        keyed: subjectKeyOf("  Cockpit   PANES "),',
  "        frozen: Object.isFrozen(reading) && Object.isFrozen(reading.facts),",
  "        pid: process.pid,",
  "      }),",
  "    );",
  "  },",
  "  function (failed) {",
  "    process.stderr.write(String((failed && failed.stack) || failed));",
  "    process.exit(1);",
  "  },",
  ");",
  "",
].join("\n");

let built: string | undefined;

/**
 * `engine/` and this module, compiled to CommonJS once per run.
 *
 * `tsc` is spawned rather than imported: what the children need is a tree on disk, and a compiler API
 * call would be this test process doing the emit, which is the thing it is trying not to be part of.
 */
function compiled(): string {
  if (built !== undefined) {
    return built;
  }

  const out = temporary("megazord-cortex-build-");
  const lib = join(out, "lib");
  const config = join(out, "tsconfig.json");

  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        moduleResolution: "node10",
        target: "es2022",
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        outDir: lib,
        rootDir: REPO,
        baseUrl: REPO,
        // The same alias `tsconfig.json` and `vitest.config.mts` carry, so the type-only import of
        // `@engine/index` resolves here too.
        paths: { "@engine/*": ["engine/*"] },
        types: ["node"],
        typeRoots: [join(REPO, "node_modules", "@types")],
      },
      files: [join(REPO, "engine", "index.ts"), join(REPO, "runtime", "cortex-store.ts")],
    }),
    "utf8",
  );

  const done = spawnSync(process.execPath, [TSC, "-p", config], { encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`tsc could not compile the engine and the Cortex:\n${done.stdout}${done.stderr}`);
  }

  writeFileSync(join(lib, "write.cjs"), WRITER, "utf8");
  writeFileSync(join(lib, "read.cjs"), READER, "utf8");
  built = lib;
  return lib;
}

function ran(script: string, args: readonly string[]): string {
  const done = spawnSync(process.execPath, [join(compiled(), script), ...args], {
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`${script} failed (${String(done.status)}):\n${done.stdout}${done.stderr}`);
  }
  return done.stdout;
}

/** Records Facts in a process that exits before anything reads them. */
function wroteInAnotherProcess(root: string, facts: readonly Fact[]): Wrote {
  return JSON.parse(ran("write.cjs", [root, JSON.stringify(facts)])) as Wrote;
}

/** Reads the Cortex in a process that never saw the one that wrote it. */
function readInAnotherProcess(root: string, query?: unknown): Read {
  return JSON.parse(
    ran("read.cjs", query === undefined ? [root] : [root, JSON.stringify(query)]),
  ) as Read;
}

/** The failure of a call that was supposed to fail, or a loud test failure when it was not. */
async function refusalIn<TError extends Error>(
  pending: Promise<unknown>,
  kind: new (...args: never[]) => TError,
): Promise<TError> {
  try {
    const answered = await pending;
    throw new Error(`expected a refusal, it answered ${JSON.stringify(answered)}`);
  } catch (caught) {
    if (!(caught instanceof kind)) {
      throw caught;
    }
    return caught;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Criterion 10
 * ---------------------------------------------------------------------------------------------- */

describe("a Fact written in one session, read in the next (criterion 10)", () => {
  it("is read by a process that never saw the one that wrote it", async () => {
    const root = workspace();
    const facts = recorded();

    // The writing process exits before this line returns: `spawnSync` waits for it. Nothing of it is in
    // scope in the reader — no Vitest, no alias resolution, no shared object, no open descriptor.
    const wrote = wroteInAnotherProcess(root, facts);
    expect(wrote.written).toBe(facts.length);

    const read = readInAnotherProcess(root);

    // The criterion itself.
    expect(read.facts).toEqual(
      facts.map((one) => ({ ...one, subject: subjectKeyOf(one.subject) })),
    );

    // Three processes, and the pids say so rather than a comment saying so.
    expect(new Set([wrote.pid, read.pid, process.pid]).size).toBe(3);

    // And it is still a Cortex, not merely equal bytes: the readings work over it in the child too.
    expect(read.subjects).toEqual([
      { subject: "panes", facts: 2 },
      { subject: "providers", facts: 1 },
    ]);
    expect(read.unreadable).toEqual([]);
    expect(read.frozen).toBe(true);
    expect(read.keyed).toBe("cockpit panes");

    // A third reader, in this process, over the same file.
    const here = await cortexStore({ workspace: root }).read();
    expect(here.facts).toEqual(read.facts);
  });

  it("is shared by every Zord of the Workspace, across sessions that never overlap", async () => {
    const root = workspace();
    const [first, second, third] = recorded();

    // Three sessions, one after another, each its own process. The second and third must append to what
    // the first left, not replace it: a Cortex that outlives the session is the definition.
    const sessions = [first, second, third].map((one) =>
      one === undefined ? unreachable() : wroteInAnotherProcess(root, [one]),
    );
    expect(new Set(sessions.map((session) => session.pid)).size).toBe(3);

    const read = readInAnotherProcess(root);
    expect(read.facts).toHaveLength(3);
    // Written by two different Zords in two different Missions, and all of it is in one Cortex.
    expect(new Set(read.facts.map((one) => one.zordId))).toEqual(new Set([SCOUT, BUILDER]));
    expect(new Set(read.facts.map((one) => one.missionId))).toEqual(new Set([COCKPIT, ENGINE]));
    expect(readdirSync(storeRoot(root))).toEqual(["cortex.jsonl"]);
  });

  it("narrows in the reading process, so a Zord need not be handed the whole Cortex", async () => {
    const root = workspace();
    wroteInAnotherProcess(root, recorded());

    const panes = readInAnotherProcess(root, { subject: "PANES" });
    expect(panes.facts.map((one) => one.body)).toEqual([
      "A Pane is a node-pty child, one per Zord.",
      "Killing a Pane must kill the process group, not the leader.",
    ]);

    const latest = readInAnotherProcess(root, { subject: "panes", limit: 1 });
    expect(latest.facts.map((one) => one.body)).toEqual([
      "Killing a Pane must kill the process group, not the leader.",
    ]);

    const scouted = readInAnotherProcess(root, { zordId: SCOUT, missionId: COCKPIT });
    expect(scouted.facts).toHaveLength(1);
  });
});

function unreachable(): never {
  throw new Error("the recorded Facts are missing");
}

/* -------------------------------------------------------------------------------------------------
 * The layout
 * ---------------------------------------------------------------------------------------------- */

describe("the layout on disk", () => {
  it("is one JSONL file per Workspace under .megazord/", async () => {
    const root = workspace();
    await writeAll(cortexStore({ workspace: root }), recorded());

    expect(readdirSync(storeRoot(root))).toEqual(["cortex.jsonl"]);
    const text = readFileSync(cortexPath(root), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(3);
  });

  it("stores exactly the five fields of a Fact, and drops what nobody declared", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });

    await store.write({
      ...(recorded()[0] ?? unreachable()),
      // Cast, because the type refuses it — see the probe below. What this pins is the runtime half: the
      // projection is what keeps a field no reader knows about out of the Workspace's memory forever.
      ...({ confidence: 0.9 } as unknown as Record<string, never>),
    });

    const line = linesOn(root)[0] ?? unreachable();
    expect(Object.keys(JSON.parse(line) as object)).toEqual([
      "recordedAt",
      "missionId",
      "zordId",
      "subject",
      "body",
    ]);
    expect(line).not.toContain("confidence");
  });

  it("keeps the two Missions of one Workspace in the same file, attributed", async () => {
    const root = workspace();
    await writeAll(cortexStore({ workspace: root }), recorded());

    const stored = linesOn(root).map((line) => JSON.parse(line) as Fact);
    expect(stored.map((one) => `${one.missionId}/${one.zordId}`)).toEqual([
      `${COCKPIT}/${SCOUT}`,
      `${COCKPIT}/${BUILDER}`,
      `${ENGINE}/${BUILDER}`,
    ]);
  });

  it("normalises the subject on disk and keeps the body verbatim", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });

    const stored = await store.write(
      fact({ subject: "  Cockpit   PANES ", body: "Two  spaces and a CAPITAL stay.\nSo does a break." }),
    );

    expect(stored.subject).toBe("cockpit panes");
    expect(stored.body).toBe("Two  spaces and a CAPITAL stay.\nSo does a break.");
    // One Fact, one line: the newline inside the body is escaped, not written.
    expect(linesOn(root)).toHaveLength(1);
    expect(readFileSync(cortexPath(root), "utf8")).toContain("\\nSo does a break.");
  });
});

/* -------------------------------------------------------------------------------------------------
 * write
 * ---------------------------------------------------------------------------------------------- */

describe("write", () => {
  it("has the Fact on disk once it resolves, and answers it as recorded", async () => {
    const root = workspace();
    const one = fact({ subject: "Meter", body: "The pty runner reports a cost of zero, and says why." });

    const stored = await cortexStore({ workspace: root }).write(one);

    // What cannot be tested here is the `fsync`: proving durability needs the power cut. What this
    // asserts is the half that is observable — the bytes are in the file, not in a buffer somewhere.
    expect(JSON.parse(readFileSync(cortexPath(root), "utf8").trimEnd())).toEqual(stored);
    expect(stored).toEqual({ ...one, subject: "meter" });
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("keeps the record in call order, not in whichever write finishes first", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    const facts = recorded();

    // Fired without an await between them: the queue is what keeps the record in order.
    await Promise.all(facts.map((one) => store.write(one)));

    const read = await store.read();
    expect(read.facts.map((one) => one.body)).toEqual(facts.map((one) => one.body));
  });

  it("appends when a second store opens the same Workspace, rather than replacing", async () => {
    const root = workspace();
    const [first, second] = recorded();

    await cortexStore({ workspace: root }).write(first ?? unreachable());
    await cortexStore({ workspace: root }).write(second ?? unreachable());

    expect((await cortexStore({ workspace: root }).read()).facts).toHaveLength(2);
  });

  it.each([
    [
      "is attributed to no Zord",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        subject: "panes",
        body: "something",
      },
      "attributed to no Zord",
    ],
    [
      "carries a blank ZordId",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: "   ",
        subject: "panes",
        body: "something",
      },
      "attributed to no Zord",
    ],
    [
      "came from no Mission",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        zordId: SCOUT,
        subject: "panes",
        body: "something",
      },
      "came from no Mission",
    ],
    [
      "carries a MissionId that is not a string",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: 7,
        zordId: SCOUT,
        subject: "panes",
        body: "something",
      },
      "came from no Mission",
    ],
    [
      "says nothing about when",
      { missionId: COCKPIT, zordId: SCOUT, subject: "panes", body: "something" },
      "when it was recorded",
    ],
    [
      "carries no subject",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: SCOUT,
        body: "something",
      },
      "carries no subject",
    ],
    [
      "carries a blank subject",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: SCOUT,
        subject: " \t ",
        body: "something",
      },
      "blank subject",
    ],
    [
      "carries a subject that is not a string",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: SCOUT,
        subject: ["panes"],
        body: "something",
      },
      "subject that is a list",
    ],
    [
      "says nothing",
      {
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: SCOUT,
        subject: "panes",
        body: "  ",
      },
      "says nothing",
    ],
    ["is null", null, "is null, not a Fact"],
    ["is a list", [], "is a list, not a Fact"],
    ["is a string", "a fact", 'is "a fact", not a Fact'],
  ])(
    // Each malformed Fact is written out inline above rather than built by `fact()` with a field taken
    // away: a fixture with defaults fires on `undefined` and would hand `write` a valid Fact.
    "refuses a Fact that %s, and writes nothing",
    async (_, malformed, detail) => {
      const root = workspace();
      const store = cortexStore({ workspace: root });

      const failed = await refusalIn(
        store.write(malformed as unknown as Fact),
        InvalidFactError,
      );
      expect(failed.detail).toContain(detail);
      expect(failed.message).toContain("cannot be recorded");
      expect(existsSync(storeRoot(root))).toBe(false);
    },
  );
});

/* -------------------------------------------------------------------------------------------------
 * read
 * ---------------------------------------------------------------------------------------------- */

describe("read", () => {
  it("answers an empty reading for a Workspace whose Cortex was never written to", async () => {
    const root = workspace();
    const read = await cortexStore({ workspace: root }).read();

    expect(read.facts).toEqual([]);
    expect(read.unreadable).toEqual([]);
    // And it did not create the directory to find that out.
    expect(existsSync(storeRoot(root))).toBe(false);
  });

  it("answers every Fact in the order they were recorded", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect((await store.read()).facts.map((one) => one.body)).toEqual(
      recorded().map((one) => one.body),
    );
  });

  it("never reorders by the clock, because the clock is a caller's string", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });

    await store.write(fact({ subject: "order", body: "recorded first, dated last" }));
    await store.write({
      recordedAt: instant("2020-01-01T00:00:00.000Z"),
      missionId: COCKPIT,
      zordId: SCOUT,
      subject: "order",
      body: "recorded second, dated years earlier",
    });

    expect((await store.read()).facts.map((one) => one.body)).toEqual([
      "recorded first, dated last",
      "recorded second, dated years earlier",
    ]);
  });

  it("filters by Mission, by Zord and by subject, and every filter must hold", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect((await store.read({ missionId: ENGINE })).facts).toHaveLength(1);
    expect((await store.read({ zordId: BUILDER })).facts).toHaveLength(2);
    expect((await store.read({ subject: "panes" })).facts).toHaveLength(2);
    expect((await store.read({ subject: "panes", zordId: BUILDER })).facts).toHaveLength(1);
    expect((await store.read({ subject: "panes", missionId: ENGINE, zordId: SCOUT })).facts).toEqual(
      [],
    );
  });

  it("matches a subject however it was capitalised or spaced, on both sides", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await store.write(fact({ subject: "Cockpit  Panes", body: "one" }));
    await store.write(fact({ subject: "cockpit panes", body: "two" }));

    // Two spellings, one subject: without the fold, the shared memory would silently stop being shared.
    for (const asked of ["cockpit panes", "COCKPIT PANES", "  Cockpit   Panes  "]) {
      expect((await store.read({ subject: asked })).facts).toHaveLength(2);
    }
  });

  it("compares ids byte for byte, unlike the subject", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect((await store.read({ zordId: "ZORD-SCOUT" as ZordId })).facts).toEqual([]);
    expect((await store.read({ zordId: SCOUT })).facts).toHaveLength(1);
  });

  it("bounds the answer to the most recent Facts, still in record order", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect((await store.read({ limit: 2 })).facts.map((one) => one.body)).toEqual([
      recorded()[1]?.body,
      recorded()[2]?.body,
    ]);
    // A bounded read and a whole one agree about which of the two came first.
    expect((await store.read({ limit: 99 })).facts).toHaveLength(3);
    // Zero is coherent and answers nothing, exactly as a Cap of zero is reached by a Mission that spent
    // nothing.
    expect((await store.read({ limit: 0 })).facts).toEqual([]);
  });

  it("asks nothing when it is given nothing, and `undefined` is giving nothing", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect((await store.read()).facts).toHaveLength(3);
    expect((await store.read(undefined)).facts).toHaveLength(3);
    expect((await store.read({})).facts).toHaveLength(3);
  });

  it.each([
    // `null` and not `undefined`: a default parameter fires on `undefined`, so `read(undefined)` is
    // `read()` by design and a probe passing it would prove nothing about a malformed query.
    [null, "received null"],
    [[], "received a list"],
    ["panes", 'received "panes"'],
    [{ missionId: "" }, "missionId must be a non-blank id"],
    [{ zordId: "  " }, "zordId must be a non-blank id"],
    [{ zordId: 7 }, "received 7"],
    [{ subject: 7 }, "subject must be a string"],
    [{ subject: "   " }, "subject is blank"],
    [{ limit: -1 }, "limit must be a whole number"],
    [{ limit: 1.5 }, "received 1.5"],
    [{ limit: Number.NaN }, "received NaN"],
    [{ limit: Number.POSITIVE_INFINITY }, "received Infinity"],
    [{ limit: "3" }, 'received "3"'],
  ])("refuses the query %j rather than quietly answering everything", async (query, detail) => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    const failed = await refusalIn(
      store.read(query as never),
      InvalidFactQueryError,
    );
    expect(failed.message).toContain(detail);
  });

  it("freezes the reading and both of its lists", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());
    const read = await store.read();

    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.facts)).toBe(true);
    expect(Object.isFrozen(read.unreadable)).toBe(true);
    expect(Object.isFrozen(read.facts[0])).toBe(true);
    expect(() => (read.facts as Fact[]).push(read.facts[0] ?? unreachable())).toThrow(TypeError);
  });
});

/* -------------------------------------------------------------------------------------------------
 * subjectsIn and subjectKeyOf
 * ---------------------------------------------------------------------------------------------- */

describe("the subjects of a reading", () => {
  it("tallies them in ascending order, so a Zord can navigate without reading every body", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect(subjectsIn(await store.read())).toEqual([
      { subject: "panes", facts: 2 },
      { subject: "providers", facts: 1 },
    ]);
  });

  it("narrows with the reading it is given", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    expect(subjectsIn(await store.read({ missionId: ENGINE }))).toEqual([
      { subject: "panes", facts: 1 },
    ]);
    expect(subjectsIn(await store.read())).toHaveLength(2);
  });

  it("folds a subject a hand-written line left unnormalised, so the tally agrees with the filter", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await store.write(fact({ subject: "panes", body: "written through the store" }));

    // Whoever edits `.megazord/cortex.jsonl` by hand does not run `subjectKeyOf` first.
    appendFileSync(
      cortexPath(root),
      `${JSON.stringify({
        recordedAt: "2026-08-06T12:00:00.000Z",
        missionId: COCKPIT,
        zordId: SCOUT,
        subject: "  PANES ",
        body: "written by a human with an editor",
      })}\n`,
      "utf8",
    );

    const read = await store.read();
    // The fold happens in `factIn`, once, for a Fact that came from `write` and for one that came from a
    // line of the file alike — which is what lets the filter compare two keys with `===`.
    expect(read.facts.map((one) => one.subject)).toEqual(["panes", "panes"]);
    expect(subjectsIn(read)).toEqual([{ subject: "panes", facts: 2 }]);
    // The same claim from the filter's side: one derivation, read by every comparison.
    expect((await store.read({ subject: "Panes" })).facts).toHaveLength(2);
  });

  it("folds what a caller hands it, because a reading is a value anybody can build", () => {
    // No cast anywhere: `Fact.subject` is a `string`, so nothing in the type system can say "already
    // folded", and a Cockpit assembling a reading of its own is a legitimate caller. This is the one
    // place in the module where re-folding is load-bearing rather than idempotent.
    const built: CortexReading = {
      facts: [
        { ...fact({ subject: "  Cockpit  PANES ", body: "one" }) },
        { ...fact({ subject: "cockpit panes", body: "two" }) },
      ],
      unreadable: [],
    };

    expect(subjectsIn(built)).toEqual([{ subject: "cockpit panes", facts: 2 }]);
  });

  it("is empty for a Cortex nobody wrote to", async () => {
    expect(subjectsIn(await cortexStore({ workspace: workspace() }).read())).toEqual([]);
  });

  it.each([
    ["  Cockpit   PANES ", "cockpit panes"],
    ["panes", "panes"],
    ["Kill\tthe\ntree", "kill the tree"],
    ["   ", ""],
  ])("folds %j to %j, and every comparison reads that", (written, key) => {
    expect(subjectKeyOf(written)).toBe(key);
  });
});

/* -------------------------------------------------------------------------------------------------
 * A line that is not a Fact
 * ---------------------------------------------------------------------------------------------- */

describe("a line that is not a Fact", () => {
  it("is reported with its line and byte, and the other Facts are still answered", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());

    const lines = linesOn(root);
    writeFileSync(
      cortexPath(root),
      `${[lines[0], '{"subject":"panes","body":"who wrote this?"}', lines[1], lines[2]].join("\n")}\n`,
      "utf8",
    );

    const read = await store.read();
    // The whole difference from the Mission store: a Cortex is a set, not a fold, so the readable Facts
    // are answered — and the damage is in the answer, not in a rejection nobody handles.
    expect(read.facts).toHaveLength(3);
    expect(read.unreadable).toEqual([
      {
        line: 2,
        at: Buffer.byteLength(`${lines[0] ?? ""}\n`, "utf8"),
        detail: expect.stringContaining("attributed to no Zord") as unknown as string,
      },
    ]);
  });

  it("reports a torn tail, and the next write is not spliced into it", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    const [first, second, third] = recorded();
    await store.write(first ?? unreachable());

    // Exactly what a Zord killed between the write and the newline leaves behind.
    appendFileSync(cortexPath(root), JSON.stringify(second ?? unreachable()).slice(0, 60), "utf8");

    await store.write(third ?? unreachable());

    const read = await store.read();
    expect(read.facts.map((one) => one.body)).toEqual([first?.body, third?.body]);
    expect(read.unreadable).toEqual([
      { line: 2, at: expect.any(Number) as unknown as number, detail: expect.stringContaining("is not JSON") as unknown as string },
    ]);
  });

  it("would lose that write without the newline guard, which is what the guard is for", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    const [first, second, third] = recorded();
    await store.write(first ?? unreachable());
    appendFileSync(cortexPath(root), JSON.stringify(second ?? unreachable()).slice(0, 60), "utf8");

    // The control: an append that does *not* look at the last byte, which is what `mission-store.ts`
    // does and what this module deliberately does not. The Fact is spliced into the torn line and gone.
    appendFileSync(cortexPath(root), `${JSON.stringify(third ?? unreachable())}\n`, "utf8");

    const read = await store.read();
    expect(read.facts.map((one) => one.body)).toEqual([first?.body]);
    expect(read.unreadable).toHaveLength(1);
    // Silently, which is why the guard exists: nothing here refuses to read the file afterwards.
    expect(read.unreadable[0]?.detail).toContain("is not JSON");
  });

  it("passes over a blank line, which is the guard's own residue and not damage", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await store.write(fact({ subject: "panes", body: "one" }));
    appendFileSync(cortexPath(root), "\n   \n", "utf8");
    await store.write(fact({ subject: "panes", body: "two" }));

    const read = await store.read();
    expect(read.facts.map((one) => one.body)).toEqual(["one", "two"]);
    expect(read.unreadable).toEqual([]);
  });

  it("reports every unreadable line, whatever the query narrowed to", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());
    appendFileSync(cortexPath(root), "{ not json\nnull\n", "utf8");

    // A line nobody can read cannot be shown to match a filter, so it is reported to every reader.
    const read = await store.read({ missionId: ENGINE });
    expect(read.facts).toHaveLength(1);
    expect(read.unreadable.map((one) => one.line)).toEqual([4, 5]);
    expect(read.unreadable.map((one) => one.detail)).toEqual([
      expect.stringContaining("is not JSON") as unknown as string,
      "is null, not a Fact",
    ]);
  });

  it("points at the right byte when the Facts before it are multi-byte", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await store.write(fact({ subject: "acentos", body: "uma missão em português — com acentos" }));
    appendFileSync(cortexPath(root), "not json\n", "utf8");

    const read = await store.read();
    const first = linesOn(root)[0] ?? "";
    // Bytes, not characters: the accented line is longer on disk than it is in memory.
    expect(read.unreadable[0]?.at).toBe(Buffer.byteLength(first, "utf8") + 1);
    expect(read.unreadable[0]?.at).toBeGreaterThan(first.length + 1);
  });

  it("is recovered by deleting the one line it names, and nothing else is lost", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    await writeAll(store, recorded());
    const before = await store.read();

    const lines = linesOn(root);
    writeFileSync(cortexPath(root), `${[lines[0], "half a fac", lines[1], lines[2]].join("\n")}\n`, "utf8");
    const damaged = await store.read();
    expect(damaged.unreadable.map((one) => one.line)).toEqual([2]);

    // The line number is the whole remedy — no offset to protect, because a buried unreadable line never
    // makes the ones after it unreachable.
    const kept = linesOn(root).filter((_, index) => index !== 1);
    writeFileSync(cortexPath(root), `${kept.join("\n")}\n`, "utf8");
    expect(await store.read()).toEqual(before);
  });

  it.each([
    ["{ not json", "is not JSON"],
    ["null", "is null, not a Fact"],
    ["[]", "is a list, not a Fact"],
    ['"a fact"', 'is "a fact", not a Fact'],
    ["{}", "attributed to no Zord"],
    ['{"zordId":"z","missionId":"m","recordedAt":"t","body":"b"}', "carries no subject"],
    ['{"zordId":"z","missionId":"m","recordedAt":"t","subject":"s"}', "says nothing"],
    ['{"zordId":"z","recordedAt":"t","subject":"s","body":"b"}', "came from no Mission"],
    ['{"zordId":"z","missionId":"m","subject":"s","body":"b"}', "when it was recorded"],
  ])("reports %j, saying it %s", async (line, detail) => {
    const root = workspace();
    mkdirSync(storeRoot(root), { recursive: true });
    writeFileSync(cortexPath(root), `${line}\n`, "utf8");

    const read = await cortexStore({ workspace: root }).read();
    expect(read.facts).toEqual([]);
    expect(read.unreadable).toHaveLength(1);
    expect(read.unreadable[0]?.line).toBe(1);
    expect(read.unreadable[0]?.at).toBe(0);
    expect(read.unreadable[0]?.detail).toContain(detail);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The boundary
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary", () => {
  it("runs no engine code: its only engine import is a type, and it names the public surface", () => {
    const here = readFileSync(fileURLToPath(new URL("./cortex-store.ts", import.meta.url)), "utf8");
    // Anchored at an `import` statement rather than at `from "…"`: this module's own doc quotes that
    // phrase when it explains the engine's import assertion, and a scan that read the comment would
    // report a specifier nobody wrote. `codeOf` in `tools/` exists for the same reason.
    const specifiers = [...here.matchAll(/^import\s[^;]*?from "([^"]+)";$/gm)].map(
      ([, specifier]) => specifier,
    );

    expect(specifiers.filter((specifier) => specifier?.startsWith("."))).toEqual([]);
    // `@engine/index` and never `@engine/domain/*`: the engine's public surface is the Contract, and
    // reaching past it from `runtime/` is what this repository settled in review.
    expect([...new Set(specifiers)].sort()).toEqual([
      "@engine/index",
      "node:fs/promises",
      "node:path",
    ]);
    expect(here).toContain('import type { Instant, MissionId, ZordId } from "@engine/index";');

    // Not merely "it imports types": the statement itself is `import type`, so `tsc` erases it and the
    // compiled module requires nothing but Node builtins — which is what makes the store unable to
    // re-decide, re-fold or re-validate anything. Read off the emitted JavaScript, because that is the
    // claim: no engine module is loaded at runtime.
    const emitted = readFileSync(join(compiled(), "runtime", "cortex-store.js"), "utf8");
    const required = [...emitted.matchAll(/require\("([^"]+)"\)/g)].map(([, specifier]) => specifier);
    expect([...new Set(required)].sort()).toEqual(["node:fs/promises", "node:path"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 * ---------------------------------------------------------------------------------------------- */

describe("the type level", () => {
  it("answers a CortexStore exactly, with nothing widened", async () => {
    // Not expressible as a `@ts-expect-error`: what is claimed is assignability, so the proof is the
    // annotation. Widen `read`'s answer to `Promise<readonly Fact[]>`, or `write`'s to `Promise<void>`,
    // and this line stops compiling — which fails `npm run build`.
    const asContract: CortexStore = cortexStore({ workspace: workspace() });
    expect(typeof asContract.write).toBe("function");
    expect((await asContract.read()).facts).toEqual([]);
  });

  it("requires the Workspace, and takes nothing else", () => {
    // @ts-expect-error — the Workspace has no default: it *is* the sharing scope of the Cortex, so
    // defaulting it to `process.cwd()` would split one Workspace's memory in two.
    const rootless = (): CortexStore => cortexStore({});
    const invented = (): CortexStore =>
      cortexStore({
        workspace: tmpdir(),
        // @ts-expect-error — there is no fsync option, deliberately: durability is not a thing a test
        // may switch off, and an option only a test would pass is the always-zero field with a type.
        fsync: false,
      });

    expect([rootless, invented].every((build) => typeof build === "function")).toBe(true);
  });

  it("requires the attribution and the origin of a Fact", () => {
    const store = cortexStore({ workspace: tmpdir() });

    const unattributed = (): Promise<Fact> =>
      // @ts-expect-error — a Fact carries the ZordId that wrote it. It is half of what the glossary says
      // a Fact is, so it is required at the type level and not merely checked at runtime.
      store.write({
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        subject: "panes",
        body: "something",
      });
    const originless = (): Promise<Fact> =>
      // @ts-expect-error — and the Mission it came from, for the same reason.
      store.write({
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        zordId: SCOUT,
        subject: "panes",
        body: "something",
      });

    expect([unattributed, originless].every((probe) => typeof probe === "function")).toBe(true);
  });

  it("takes the ids of the engine and not any string", () => {
    const store = cortexStore({ workspace: tmpdir() });

    const written = (): Promise<Fact> =>
      store.write({
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        // @ts-expect-error — a raw string is not a ZordId: the brand is what keeps a DelegationId or a
        // GateId out of the field that says who wrote a Fact.
        zordId: "zord-scout",
        subject: "panes",
        body: "something",
      });
    // @ts-expect-error — the same on the way out: a filter takes the ids the engine minted.
    const read = (): Promise<CortexReading> => store.read({ missionId: "mission-cockpit" });

    expect([written, read].every((probe) => typeof probe === "function")).toBe(true);
  });

  it("takes no filter nobody implemented", () => {
    const store = cortexStore({ workspace: tmpdir() });

    const dated = (): Promise<CortexReading> =>
      store.read({
        // @ts-expect-error — there is no time range: the store does not trust `recordedAt` enough to
        // order by it, so it must not filter by it either.
        since: "2026-08-01T00:00:00.000Z",
      });
    const searched = (): Promise<CortexReading> =>
      store.read({
        // @ts-expect-error — and no search over the body: deciding which prose answers a question is a
        // judgement about text, which this repository refuses in the engine and in the pty runner too.
        containing: "pane",
      });

    expect([dated, searched].every((probe) => typeof probe === "function")).toBe(true);
  });

  it("stores a Fact and not whatever else a caller attached to it", () => {
    const store = cortexStore({ workspace: tmpdir() });

    const embellished = (): Promise<Fact> =>
      store.write({
        recordedAt: instant("2026-08-06T11:00:00.000Z"),
        missionId: COCKPIT,
        zordId: SCOUT,
        subject: "panes",
        body: "something",
        // @ts-expect-error — a Fact has five fields. A sixth one nothing reads would sit in the
        // Workspace's memory forever, which is the always-zero field with a longer life than usual.
        confidence: 0.9,
      });

    expect(typeof embellished).toBe("function");
  });

  it("hands out a reading nobody can add to", async () => {
    const root = workspace();
    const store = cortexStore({ workspace: root });
    const stored = await store.write(fact({ subject: "panes", body: "something" }));
    const read = await store.read();

    // Every probe sits inside a function nothing calls: the lists and the Facts are frozen, so *running*
    // the write throws a TypeError and the test would fail for the runtime reason instead of proving the
    // type one.
    // @ts-expect-error — a reading's Facts are readonly: the file is the record, and a reader that could
    // push onto it would be a second way of writing one, which never reaches the disk.
    const appending = (): number => read.facts.push(stored);
    // @ts-expect-error — and so is the damage it reports.
    const hiding = (): number => read.unreadable.push({ line: 1, at: 0, detail: "invented" });
    const rewriting = (): void => {
      // @ts-expect-error — a Fact is readonly once recorded: a Cortex is append-only, so revising one is
      // a rule this module has no basis for rather than an assignment.
      stored.body = "something else";
    };

    expect([appending, hiding, rewriting].every((probe) => typeof probe === "function")).toBe(true);
    // The runtime half of the same claims, which is what actually stops a write.
    expect(Object.isFrozen(read.facts)).toBe(true);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => (read.facts as Fact[]).push(stored)).toThrow(TypeError);
  });

  it("tallies subjects from a reading, never from a bare list of Facts", () => {
    // @ts-expect-error — `subjectsIn` takes the whole reading, so the damage travels with the tally: a
    // caller cannot count subjects and be unaware that two lines of the file could not be read.
    const counted = (): readonly SubjectTally[] => subjectsIn(recorded());

    expect(typeof counted).toBe("function");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing is left behind
 * ---------------------------------------------------------------------------------------------- */

describe("nothing is left behind", () => {
  it("never writes a .megazord/ into the repository it runs from", () => {
    expect(existsSync(join(REPO, ".megazord"))).toBe(false);
    expect(existsSync(join(process.cwd(), ".megazord"))).toBe(false);
  });
});
