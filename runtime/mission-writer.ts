/**
 * One door to a Mission's file: `load → submit → append`, with nothing else touching that file in
 * between.
 *
 * ```
 * cockpit/server.ts ──┐
 * runtime/mcp-server.ts ──┼──▶ missionWriter.record(missionId, command) ──▶ MissionStore ──▶ <id>.jsonl
 * runtime/combination-driver.ts ──┘        one queue per Mission
 * ```
 *
 * ## What was wrong, precisely, because "unordered writes" is not the answer
 *
 * `MissionStore.append` was already ordered — one store, one queue, so no line is ever torn or
 * interleaved. What was not ordered is the **read-modify-write around it**. Three writers each held a
 * queue of their own (the server one, every control plane one, the driver none) and every one of them
 * did the same three steps: load the Replay, hand it to `submit`, append what came back. Two of them
 * therefore loaded the same Replay, both decided against a Mission that had not moved yet, and both
 * appended.
 *
 * The cost is not a duplicated record. `evolve` ignores what it must — a second `Delegated` under one id,
 * a second halt — so the *state* survives; what does not survive is the promise. Two `accrue-cost`
 * decided against the same stale total are **both** compared against the Cap, and a `delegate` decided
 * against a Mission that had spent nothing stays **accepted** after the concurrent accrual closed the
 * Cap. Work is commissioned that the same two gestures, ordered, refuse — and the Cap is the only promise
 * this product makes about money. The Replay then carries an accepted Decision that would have been
 * refused, so reading the file afterwards cannot tell you it happened.
 *
 * Nobody was at fault: `decide` answers truthfully about the state it was handed, and each writer handed
 * it the state it had. The atom was simply larger than the thing that held it.
 *
 * ## Why this is a module and not a wrapper around the store
 *
 * A wrapper sees `load` and `append` as two calls with nothing between them, so it cannot tell "this load
 * is the first half of a write" from "this load is somebody reading". A lock taken at `load` and given up
 * at `append` therefore deadlocks on every reader that loads and never appends — `waitForHandoff`
 * polling, `delegationUnder`, every new WebSocket rendering where a Mission stands. The atom has to be
 * **one call**, which is what `record` is.
 *
 * ## Reading stays free, and that is a requirement rather than an optimisation
 *
 * `load` is a straight relay to the store with no queue in front of it. A Cockpit with three tabs open
 * redraws on every frame, the driver polls the file while it waits for a Handoff, and `agent_invoke`
 * holds the queue for as long as a model takes to answer — which is minutes. A read that queued behind
 * that is a Cockpit that stops drawing, and the Mission is a file: reading it can never make it wrong.
 *
 * **What this buys and what it does not**, because the distinction is the whole design: every *Decision*
 * is made against the state as it is at the moment it is made. A caller's **choice** of Command can still
 * be stale — the driver reads the Replay, decides that the next gesture is a `delegate`, and by the time
 * `record` runs somebody else has moved the Mission. `decide` then refuses it (`illegal-transition`, a
 * duplicate DelegationId, `cap-reached`), which is exactly right and is the path
 * `runtime/combination-driver.ts` stops on: a Refusal of a Command a caller submitted itself ends the
 * drive, and the drive is resumable, so the next turn re-derives its gesture from a Mission that has
 * moved. What is unrepresentable after this module is an **accepted** Decision made against a state that
 * had already moved.
 *
 * ## The queue is per Mission
 *
 * One tail per MissionId, created on first use and dropped when it drains. The atom is one file, so two
 * Missions have nothing to order between them: a Workspace driving two Combinations would otherwise have
 * every gesture of one waiting behind a `agent_invoke` of the other. A single global queue was the
 * simpler thing and it would have made the fix cost more than the bug.
 *
 * A MissionId that is not a string gets **no queue at all**, and that is not a rule this module states:
 * the store refuses it (`join(root, "")` is the directory itself, so `fileNameOf` reads the id as
 * `unknown`) before it opens anything, and there is nothing to order about a write that cannot happen.
 * Inventing a key for one — `String(value)`, or a shared "unnameable" queue — would be this module
 * holding a second copy of the store's rule.
 *
 * ## One writer per store, and what a second one costs
 *
 * `missionWriter` answers **the same writer for the same store**: the memo is per `MissionStore`
 * instance, so calling it twice cannot produce two queues over one file. That is deliberate — two
 * writers is the bug, wearing a different name, and the safe construction has to be the one that is
 * hard to get wrong. `bin/mz.ts` builds one store and one writer for a Workspace and hands that one
 * writer to the server, every control plane and any drive.
 *
 * What remains unsafe is **two stores over one Workspace**, which is what two `missionStore({workspace})`
 * calls, or two processes, amount to. This module cannot see the second one and does not pretend to:
 * *one Cockpit per Workspace* is the assumption `mz` meets by construction, exactly as
 * `mission-store.ts` already states it for appends. `cockpit/cockpit.e2e.test.ts` keeps that difference
 * as an A/B — the same two concurrent gestures through one writer and through two — so the boundary of
 * the fix is measured rather than described.
 *
 * ## What `record` answers
 *
 * Both halves of what `submit` produced: the `entry` this Command became, and the `replay` it belongs to.
 * The three callers need different things from one gesture and re-deriving either is worse than carrying
 * it:
 *
 * - `cockpit/server.ts` sends the entry back to the client that asked and broadcasts the reading folded
 *   from the Replay. Re-loading the file for the reading would be a second read of something already in
 *   hand, and it could answer a state a *later* gesture produced.
 * - `runtime/mcp-server.ts` answers a tool call with the entry alone.
 * - `runtime/combination-driver.ts` needs the entry to see whether it was refused, and the Replay to read
 *   the refused Step back through `refusedIn(stepsOf(...))` rather than casting.
 *
 * Answering the `Replay` alone was the alternative, and it makes all three callers repeat the claim that
 * "`submit` appends exactly one entry, so the last one is mine". That claim belongs in one place, and this
 * is it.
 *
 * There is deliberately **no `append`** on this interface. A caller that could still reach the store's
 * own `append` could still write an entry it decided against a state it loaded itself, which is the bug
 * this module exists to make unrepresentable. The store is not hidden — tests build a Replay with it and
 * `mz` lists Missions through it — but the three writers hold the door and nothing else.
 *
 * ## Where this sits
 *
 * `runtime/`, because it composes a store that touches a disk, and it imports `@engine/index` for
 * `submit` — the engine's public surface and nothing inside it (ADR 0008). The store arrives as a **type
 * only**, so this module opens no file of its own and every Workspace it ever writes to came from its
 * caller.
 *
 * `MissionWriterOptions` is not read as `unknown`. The precedent is `pty-agent-runner.ts`: a value that
 * crosses a port from a Surface may have been deserialised, while the options a module is *built* with
 * are written in code by whoever composes it. The one consequence worth knowing is that a store which is
 * not an object is a `TypeError` out of `WeakMap.set` at composition time, which is where a caller's bug
 * belongs — loud, before a Mission exists.
 */

import { submit } from "@engine/index";
import type { MissionCommand, MissionId, Replay, ReplayEntry } from "@engine/index";

// Type-only: no store is built here, and no file is opened by this module. See "Where this sits".
import type { MissionStore } from "./mission-store";

/* -------------------------------------------------------------------------------------------------
 * The door
 * ---------------------------------------------------------------------------------------------- */

/** What a writer is built with. One store, and nothing with a hidden default. */
export type MissionWriterOptions = {
  /**
   * Where the Replay lives.
   *
   * The writer's identity is this store's — see "One writer per store". A Workspace with one store has
   * one door, whoever asks for it.
   */
  readonly store: MissionStore;
};

/** What one recorded gesture produced: the entry, and the Replay it is the last of. */
export type Recorded = {
  /** The `ReplayEntry` this Command became — accepted or refused, Command and Decision whole. */
  readonly entry: ReplayEntry;
  /** The Replay as `submit` answered it, with `entry` at the end. Frozen, like everything the engine hands out. */
  readonly replay: Replay;
};

/** The one way a Mission is written to. */
export interface MissionWriter {
  /**
   * Records one Command: loads the Replay, hands it to `submit`, appends what came back.
   *
   * The three steps are one atom per Mission — no other `record` on the same MissionId runs between
   * them. The entry is appended **whichever way the Decision went**, because a Surface that recorded
   * only what it accepted would lose every Refusal, which is the half of the Replay a human most needs.
   *
   * Rejects only for the reasons the store rejects — a corrupt line, a disk that refused, a MissionId
   * that cannot be a file name. `submit` itself never throws, so a Refusal arrives as a value.
   */
  record(missionId: MissionId, command: MissionCommand): Promise<Recorded>;
  /**
   * The whole Replay of a Mission, as the store has it.
   *
   * **Not queued**, and never will be: see "Reading stays free". A relay rather than a re-export, so
   * every writer holds one collaborator instead of two and cannot be handed a store that is not the
   * store its door leads to.
   */
  load(missionId: MissionId): Promise<Replay>;
}

/**
 * The writer for a store, built on first ask and then always the same one.
 *
 * Keyed on the store instance rather than on the Workspace path: a path is a string two stores can both
 * hold, and this module has no way to know that two paths name one directory (a symlink, a bind mount, a
 * case-insensitive volume). What it *can* guarantee is that one store has one door, which is the
 * property `mz` needs and the one a test can assert with `toBe`.
 */
const doors = new WeakMap<MissionStore, MissionWriter>();

export function missionWriter(options: MissionWriterOptions): MissionWriter {
  const held = doors.get(options.store);
  if (held !== undefined) {
    return held;
  }
  const made = doorOver(options.store);
  doors.set(options.store, made);
  return made;
}

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

function doorOver(store: MissionStore): MissionWriter {
  /** One tail per Mission, present exactly while something is queued behind it. */
  const queues = new Map<string, Promise<void>>();

  /**
   * Runs each unit of work after the one before it on the same Mission, whatever became of that one.
   *
   * The idiom `mission-store.ts` uses for its appends, keyed. Failures do not poison a queue: the tail
   * swallows them and the caller still gets the rejection of its own call. The tail is dropped once it
   * drains, so a long-lived process does not hold one promise per Mission it ever wrote to — and the
   * check that it is still *this* tail is what keeps a gesture that arrived in the meantime from losing
   * its queue.
   */
  function inTurn<TAnswer>(key: string, work: () => Promise<TAnswer>): Promise<TAnswer> {
    const tail = queues.get(key) ?? Promise.resolve();
    const next = tail.then(work, work);
    const settled: Promise<void> = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) {
        queues.delete(key);
      }
    });
    return next;
  }

  async function recording(missionId: MissionId, command: MissionCommand): Promise<Recorded> {
    const recorded = await store.load(missionId);
    const replay = submit(recorded, command);
    // `submit` appends exactly one entry and never throws, so the last one is this Command's. The one
    // place in this repository that claims it, and `mission-writer.test.ts` asserts it.
    const entry = replay[replay.length - 1];
    await store.append(missionId, entry);
    return Object.freeze({ entry, replay });
  }

  return Object.freeze({
    async record(missionId: MissionId, command: MissionCommand): Promise<Recorded> {
      const key: unknown = missionId;
      if (typeof key !== "string") {
        // No queue, and no rule of ours: the store refuses an id that cannot be a file name before it
        // opens anything. See "The queue is per Mission".
        return recording(missionId, command);
      }
      return inTurn(key, () => recording(missionId, command));
    },

    async load(missionId: MissionId): Promise<Replay> {
      return store.load(missionId);
    },
  });
}
