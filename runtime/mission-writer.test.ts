/**
 * The one door to a Mission's file, driven.
 *
 * ## What is real here, and the one thing that is held open on purpose
 *
 * - **The engine.** Every Command is a real `MissionCommand` and every Decision is `decide`'s. Nothing
 *   here writes an object that looks like a Mission, and no assertion is about a shape this file invented:
 *   `stateOf`, `meterOf`, `stepsOf`, `refusedIn` and `eventsIn` are what read the result back.
 * - **The disk.** A real `missionStore` over a temporary Workspace, so "the second gesture was decided
 *   against what the first recorded" is a claim about a file and not about a variable.
 *
 * The one fixture is a **store wrapper that holds its `append` open**, and it is here for the reason
 * `cockpit/server.test.ts` already gives for the same device: "in flight" has exactly one observable
 * moment, and a test that hopes to catch it by timing is a test that will one day pass for the wrong
 * reason. The wrapper holds no rule of its own — it delays one call and relays every one of them to the
 * real store, and both halves of what it is used to prove (a `load` that does not wait, a second Mission
 * that does not wait) fail without the delay rather than because of it.
 *
 * ## The A/B, and why the Cap case lives here rather than in the end-to-end run
 *
 * BUG-1 was not "unordered writes" — appends were already ordered by the store's own queue. It was the
 * **read-modify-write**: three writers, three queues, so two of them decided against a Replay neither had
 * seen the other move. The cost that matters is not a duplicated record: an accrual that reaches the Cap
 * and a Delegation decided against the same stale total are **both** accepted, so a Mission commissions
 * work past the one promise this product makes about money.
 *
 * That is asserted here, twice, as the same two Commands through **one** door and through **two** — and it
 * is here rather than in `cockpit/cockpit.e2e.test.ts` because it needs the two gestures in a *known*
 * order. `record` enters its queue synchronously, so two calls in one statement pair are ordered by call
 * order and nothing else; over a WebSocket and an HTTP POST, which of the two reaches the queue first is a
 * race no test can promise without holding a transport open. The end-to-end file therefore asserts the
 * same fix over the real transports with a Command whose Refusal does not depend on the order
 * (`open-mission`), and the expensive half is proven here where the order is a fact.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  briefing,
  clause,
  clauseId,
  contract,
  core as coreOf,
  delegationId,
  eventsIn,
  instantFromDate,
  isOpened,
  meterOf,
  missionId,
  moneyFromCents,
  orchestrationCapability,
  refusedIn,
  slice,
  stateOf,
  stepsOf,
  zordId,
  type AccrueCost,
  type Delegate,
  type Instant,
  type MissionCommand,
  type MissionId,
  type OpenMission,
  type Replay,
  type ReplayEntry,
} from "@engine/index";

import {
  CorruptReplayError,
  MissionFileNameError,
  missionStore,
  type MissionStore,
} from "./mission-store";
import { missionWriter, type MissionWriter, type Recorded } from "./mission-writer";

/* -------------------------------------------------------------------------------------------------
 * A Workspace, a clock, and the Commands
 * ---------------------------------------------------------------------------------------------- */

const MISSION: MissionId = missionId("mission-writer");
const OTHER: MissionId = missionId("mission-writer-two");
const ONE = delegationId("d-one");
const TWO = delegationId("d-two");
const ZORD = zordId("z-builder");

const workspaces: string[] = [];

afterAll(() => {
  for (const workspace of workspaces) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "megazord-writer-"));
  workspaces.push(root);
  return root;
}

/** Instants derived from one base, never spelled out digit by digit: `11:80` is not a time. */
const BASE = Date.parse("2026-08-07T09:00:00.000Z");

function at(seconds: number): Instant {
  return instantFromDate(new Date(BASE + seconds * 1_000));
}

/** A Mission with the Cap this file needs: one real, whole amount of BRL cents. */
function opening(capCents: number): OpenMission {
  return {
    kind: "open-mission",
    occurredAt: at(0),
    missionId: MISSION,
    briefing: briefing("prove that one file has one door"),
    mode: "combination",
    cap: moneyFromCents(capCents),
    core: coreOf([orchestrationCapability("delegate")]),
  };
}

function delegating(id: typeof ONE, second: number): Delegate {
  return {
    kind: "delegate",
    occurredAt: at(second),
    delegationId: id,
    zordId: ZORD,
    slice: slice(`the slice of ${String(id)}`),
    harnessSources: {
      catalogDefault: { cli: "claude", model: "opus", effort: "high", skills: [] },
    },
    contract: contract([clause({ id: clauseId("c-one"), description: "it is done", required: true })]),
  };
}

function accruing(id: typeof ONE, cents: number, second: number): AccrueCost {
  return {
    kind: "accrue-cost",
    occurredAt: at(second),
    delegationId: id,
    cost: moneyFromCents(cents),
  };
}

/* -------------------------------------------------------------------------------------------------
 * A store whose `append` can be held open, which is the only observable "in flight"
 * ---------------------------------------------------------------------------------------------- */

type Held = {
  readonly store: MissionStore;
  /** Resolves once an `append` this store was asked to hold has actually been reached. */
  reached(): Promise<void>;
  /** Lets every held `append` through, and every later one straight through. */
  release(): void;
};

/**
 * The real store with one call delayed: it relays `append`, `load` and `list` verbatim and decides nothing.
 *
 * `holds` says which Mission's appends wait. Everything else is the store's own behaviour, so a test that
 * passes through this wrapper is still a test about a file.
 */
function holding(store: MissionStore, holds: MissionId): Held {
  let arrived = (): void => undefined;
  const reached = new Promise<void>((there) => {
    arrived = there;
  });
  let go = (): void => undefined;
  const held = new Promise<void>((released) => {
    go = released;
  });

  return {
    store: {
      async append(id: MissionId, entry: ReplayEntry): Promise<void> {
        if (id === holds) {
          arrived();
          await held;
        }
        return store.append(id, entry);
      },
      async load(id: MissionId): Promise<Replay> {
        return store.load(id);
      },
      async list(): Promise<readonly MissionId[]> {
        return store.list();
      },
    },
    async reached(): Promise<void> {
      return reached;
    },
    release(): void {
      go();
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * The atom
 * ---------------------------------------------------------------------------------------------- */

describe("one gesture", () => {
  it("decides against the Replay on disk and appends what came back", async () => {
    const store = missionStore({ workspace: workspace() });
    const writer = missionWriter({ store });

    const recorded = await writer.record(MISSION, opening(5_000));

    expect(recorded.entry.decision.kind).toBe("accepted");
    // On the disk, through a store this test built and nothing else touched.
    const onDisk = await missionStore({ workspace: workspaces[workspaces.length - 1] ?? "" }).load(MISSION);
    expect(onDisk).toHaveLength(1);
    expect(stateOf(onDisk).status).toBe("running");
  });

  it("answers the entry submit produced and the Replay it is the last of", async () => {
    const store = missionStore({ workspace: workspace() });
    const writer = missionWriter({ store });

    await writer.record(MISSION, opening(5_000));
    const recorded = await writer.record(MISSION, delegating(ONE, 1));

    // The one place in this repository that claims "submit appends exactly one entry, so the last one is
    // mine". Three callers used to claim it each; this is the assertion that lets them stop.
    expect(recorded.replay).toHaveLength(2);
    expect(recorded.replay[recorded.replay.length - 1]).toBe(recorded.entry);
    expect(recorded.entry.command.kind).toBe("delegate");
    // Frozen, like everything the engine hands out.
    expect(Object.isFrozen(recorded)).toBe(true);
    expect(Object.isFrozen(recorded.replay)).toBe(true);
  });

  it("records a Refusal, with its Command, exactly as it records an acceptance", async () => {
    const store = missionStore({ workspace: workspace() });
    const writer = missionWriter({ store });

    await writer.record(MISSION, opening(5_000));
    const refused = await writer.record(MISSION, opening(5_000));

    expect(refused.entry.decision.kind).toBe("refused");
    const replay = await store.load(MISSION);
    expect(replay).toHaveLength(2);
    // A Surface that recorded only what it accepted would lose the half of the Replay a human most needs.
    expect(refusedIn(stepsOf(replay))).toHaveLength(1);
    expect(refusedIn(stepsOf(replay))[0]?.command.kind).toBe("open-mission");
  });
});

/* -------------------------------------------------------------------------------------------------
 * BUG-1: the read-modify-write is one atom
 * ---------------------------------------------------------------------------------------------- */

describe("two gestures at once, through one door", () => {
  it("decides the second against what the first recorded, in call order", async () => {
    const store = missionStore({ workspace: workspace() });
    const writer = missionWriter({ store });

    // Two `record` calls in flight at the same moment. Both enter the queue synchronously, so the order is
    // the call order — and the second is decided against a Mission that has already been opened.
    const [first, second] = await Promise.all([
      writer.record(MISSION, opening(5_000)),
      writer.record(MISSION, opening(5_000)),
    ]);

    expect([first.entry.decision.kind, second.entry.decision.kind]).toEqual(["accepted", "refused"]);
    const replay = await store.load(MISSION);
    expect(eventsIn(stepsOf(replay), "mission-opened")).toHaveLength(1);
    expect(replay).toHaveLength(2);
  });

  it("refuses work commissioned past a Cap a concurrent accrual has just reached", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const writer = missionWriter({ store });

    // A Mission with a Cap of exactly R$ 1,00 and one Delegation, so the two gestures below are the pair
    // BUG-1 was about: a Zord reporting what its run cost, and a human commissioning another Slice.
    await writer.record(MISSION, opening(100));
    await writer.record(MISSION, delegating(ONE, 1));

    const [accrual, commissioned] = await Promise.all([
      writer.record(MISSION, accruing(ONE, 100, 2)),
      writer.record(MISSION, delegating(TWO, 3)),
    ]);

    // The accrual is accepted — the money is already gone, and refusing the report would only make the
    // Meter understate what the Mission cost. The Delegation behind it is refused, and with the reason a
    // human can act on rather than `illegal-transition`.
    expect(accrual.entry.decision.kind).toBe("accepted");
    expect(commissioned.entry.decision.kind).toBe("refused");
    if (commissioned.entry.decision.kind !== "refused") {
      throw new Error("unreachable: the assertion above already failed");
    }
    expect(commissioned.entry.decision.refusal.reason).toBe("cap-reached");

    const state = stateOf(await store.load(MISSION));
    expect(state.status).toBe("halted");
    if (!isOpened(state)) {
      throw new Error("a halted Mission is opened");
    }
    // One Delegation, not two: no work was commissioned past the Cap.
    expect(state.delegations.map((made) => made.id)).toEqual([ONE]);
    expect(meterOf(state).reached).toBe(true);
  });

  it("is what two doors over one Workspace still do not do — the control", async () => {
    // The same four Commands, the same order, the same file. The only variable is how many queues sit in
    // front of it, which is exactly what BUG-1 was: both gestures load a Mission that has spent nothing,
    // both are accepted, and a second Slice is commissioned on a Mission whose Cap was reached. Two
    // stores over one Workspace is what two processes look like from inside one, and it is the bound the
    // fix states rather than a defect it left behind — see `mission-writer.ts`.
    const root = workspace();
    const one = missionWriter({ store: missionStore({ workspace: root }) });
    const two = missionWriter({ store: missionStore({ workspace: root }) });

    await one.record(MISSION, opening(100));
    await one.record(MISSION, delegating(ONE, 1));

    const [accrual, commissioned] = await Promise.all([
      one.record(MISSION, accruing(ONE, 100, 2)),
      two.record(MISSION, delegating(TWO, 3)),
    ]);

    expect([accrual.entry.decision.kind, commissioned.entry.decision.kind]).toEqual([
      "accepted",
      "accepted",
    ]);

    const replay = await missionStore({ workspace: root }).load(MISSION);
    const steps = stepsOf(replay);
    const state = stateOf(replay);
    expect(refusedIn(steps)).toEqual([]);

    // Two Slices commissioned on a Mission whose Cap is reached, and the second was never compared
    // against it. Which of the two appends lands first is a race, and **both outcomes are the defect**:
    // if the Delegation lands first the Mission really holds two of them past its Cap, and if the halt
    // lands first `evolve` ignores the Delegation and the file carries an accepted Decision that folds to
    // nothing — which `CLAUDE.md` names as breaking the one property this design exists for. So what is
    // asserted is what both orders share, rather than whichever one this host happened to produce.
    expect(eventsIn(steps, "delegated")).toHaveLength(2);
    expect(isOpened(state) && meterOf(state).reached).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Reading stays free
 * ---------------------------------------------------------------------------------------------- */

describe("reading is never queued behind a write", () => {
  it("answers a load while a record of the same Mission is still in flight", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const held = holding(store, MISSION);
    const writer = missionWriter({ store: held.store });

    const recording = writer.record(MISSION, opening(5_000));
    await held.reached();

    // The whole requirement: a Cockpit with three tabs redraws on every frame, and `agent_invoke` holds a
    // Mission's queue for as long as a model takes to answer. A `load` that waited for that is a Cockpit
    // that stops drawing. It answers, and it answers what the file holds — the append has not landed yet.
    const read = await writer.load(MISSION);
    expect(read).toEqual([]);

    held.release();
    await recording;
    expect(await writer.load(MISSION)).toHaveLength(1);
  });

  it("does not queue one Mission behind another", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const held = holding(store, MISSION);
    const writer = missionWriter({ store: held.store });

    const stuck = writer.record(MISSION, opening(5_000));
    await held.reached();

    // A Workspace driving two Combinations would otherwise have every gesture of one waiting behind the
    // other's ten-minute run. The atom is one file, so two Missions have nothing to order between them.
    const moved = await writer.record(OTHER, { ...opening(5_000), missionId: OTHER });
    expect(moved.entry.decision.kind).toBe("accepted");
    expect(await writer.load(OTHER)).toHaveLength(1);

    held.release();
    await stuck;
  });
});

/* -------------------------------------------------------------------------------------------------
 * One writer per store
 * ---------------------------------------------------------------------------------------------- */

describe("one store has one door", () => {
  it("answers the same writer for the same store, so nobody can build a second queue by asking twice", () => {
    const store = missionStore({ workspace: workspace() });

    // The safe construction is the easy one: `bin/mz.ts` builds one store per Workspace, and anybody who
    // asks that store for a writer gets the one the server and every control plane already hold.
    expect(missionWriter({ store })).toBe(missionWriter({ store }));
  });

  it("answers a different writer for a different store, which is the construction that costs", async () => {
    const root = workspace();
    const one = missionWriter({ store: missionStore({ workspace: root }) });
    const two = missionWriter({ store: missionStore({ workspace: root }) });

    expect(one).not.toBe(two);
    // Both work, and both write to one file — the ordering is what is missing, as the A/B above measures.
    await one.record(MISSION, opening(5_000));
    expect((await two.load(MISSION))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * What it relays, and what it does not invent
 * ---------------------------------------------------------------------------------------------- */

describe("a failure is the store's, relayed", () => {
  it("refuses a Mission whose file holds a line that is not an entry, and appends nothing", async () => {
    const root = workspace();
    const store = missionStore({ workspace: root });
    const writer = missionWriter({ store });

    await writer.record(MISSION, opening(5_000));
    // A torn line, the ordinary death of an append-only file. `load` refuses the whole Replay (ADR 0009),
    // so the gesture cannot be decided at all — and nothing is written on top of the damage.
    const path = join(root, ".megazord", "missions", `${encodeURIComponent(String(MISSION))}.jsonl`);
    const { appendFileSync, readFileSync } = await import("node:fs");
    appendFileSync(path, '{"command":{"kind":"open-mission"}');

    await expect(writer.record(MISSION, delegating(ONE, 1))).rejects.toThrow(CorruptReplayError);
    expect(readFileSync(path, "utf8").endsWith('{"command":{"kind":"open-mission"}')).toBe(true);
  });

  it("invents no queue for a MissionId that cannot be a file name, and refuses it as the store does", async () => {
    const store = missionStore({ workspace: workspace() });
    const writer = missionWriter({ store });

    // Through a cast, which is how a MissionId arrives from a WebSocket frame or a `JSON.parse`. The store
    // owns this rule — `join(root, "")` is the Missions directory itself — and this module states none of
    // its own: it does not key a queue on `String(value)` and does not answer for the store.
    const nameless = writer.record(undefined as unknown as MissionId, opening(5_000));
    await expect(nameless).rejects.toThrow(MissionFileNameError);

    // And nothing was poisoned: the next gesture on a real MissionId lands.
    const recorded = await writer.record(MISSION, opening(5_000));
    expect(recorded.entry.decision.kind).toBe("accepted");
  });

  it("does not poison a Mission's queue when one gesture fails", async () => {
    const root = workspace();
    const inner = missionStore({ workspace: root });
    let refuse = true;
    const store: MissionStore = {
      async append(id: MissionId, entry: ReplayEntry): Promise<void> {
        if (refuse) {
          refuse = false;
          throw new Error("the disk said no");
        }
        return inner.append(id, entry);
      },
      async load(id: MissionId): Promise<Replay> {
        return inner.load(id);
      },
      async list(): Promise<readonly MissionId[]> {
        return inner.list();
      },
    };
    const writer = missionWriter({ store });

    await expect(writer.record(MISSION, opening(5_000))).rejects.toThrow("the disk said no");
    // The tail swallows the failure and the caller keeps the rejection of its own call, which is the
    // idiom `mission-store.ts` uses for the same reason.
    const recorded = await writer.record(MISSION, opening(5_000));
    expect(recorded.entry.decision.kind).toBe("accepted");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The boundary
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary", () => {
  it("imports the engine's public surface and the store as a type, and nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const here = readFileSync(fileURLToPath(new URL("./mission-writer.ts", import.meta.url)), "utf8");
    const statements = [...here.matchAll(/^import\s[\s\S]*?from "([^"]+)";$/gm)];
    const specifiers = statements.map(([, specifier]) => specifier);

    // A vacuity guard: a regular expression that matched nothing would make every assertion below pass
    // over an empty list. Three imports, two specifiers.
    expect(statements.length).toBeGreaterThan(2);
    expect([...new Set(specifiers)].sort()).toEqual(["./mission-store", "@engine/index"]);
    // Never `@engine/domain/*`: reaching into the engine's insides from outside it is not part of the
    // Contract — ADR 0008, settled in review after two `runtime/` modules did it.
    expect(specifiers.every((specifier) => !specifier.startsWith("@engine/domain"))).toBe(true);
    // The store is a type only, so this module opens no file and builds no store of its own.
    const store = statements.find(([, named]) => named === "./mission-store");
    expect(store?.[0].startsWith("import type ")).toBe(true);
    // No dependency of any kind, and no Node builtin: a queue is a promise.
    expect(specifiers.filter((specifier) => specifier.startsWith("node:"))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 *
 * Each is falsified by breaking the **source of the guarantee** — `mission-writer.ts` — and confirming
 * `tsc --noEmit --incremental false` reports `TS2578: Unused '@ts-expect-error' directive`, never by
 * widening a helper in this file.
 * ---------------------------------------------------------------------------------------------- */

describe("the guarantees the compiler carries", () => {
  it("offers no append, so nothing can write an entry it decided by itself", () => {
    const probe = (writer: MissionWriter): unknown =>
      // @ts-expect-error there is deliberately no `append`: a caller that had one could load a Replay,
      // decide against it and write the entry, which is the whole of BUG-1. The door is `record`.
      writer.append;

    expect(typeof probe).toBe("function");
  });

  it("requires the store it is a door to", () => {
    const probe = (): MissionWriter =>
      // @ts-expect-error the store has no default: a writer that built its own would be a second store
      // over a Workspace, which is the one construction this module cannot order.
      missionWriter({});

    expect(typeof probe).toBe("function");
  });

  it("takes a MissionId and not any string", () => {
    const probe = (writer: MissionWriter, command: MissionCommand): Promise<Recorded> =>
      // @ts-expect-error the brand is what keeps a ZordId out of the file a Mission is recorded in — the
      // same reason `cockpitServer` takes one.
      writer.record("mission-writer", command);

    expect(typeof probe).toBe("function");
  });

  it("hands back a Recorded nobody can rewrite", async () => {
    const store = missionStore({ workspace: workspace() });
    const recorded = await missionWriter({ store }).record(MISSION, opening(5_000));

    // The probe sits in a function nothing calls: the answer is frozen, so *running* the assignment
    // throws a TypeError and the test would pass for the runtime reason instead of proving the type one.
    // @ts-expect-error `entry` is readonly: what was recorded is what the engine decided, and a caller
    // that could swap it would be holding a Recorded the file disagrees with.
    const rewriting = (): ReplayEntry => (recorded.entry = recorded.entry);

    expect(typeof rewriting).toBe("function");
    expect(Object.isFrozen(recorded)).toBe(true);
  });
});
