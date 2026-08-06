/**
 * The envelope both sides of the Cockpit share: one discriminated union per direction, and the reading
 * that turns an untrusted text frame into one.
 *
 * ```
 * FromCockpit   a human gesture, on its way in       submit | pane-write | pane-kill
 * ToCockpit     what the server answers or streams   pane-data | pane-status | decided | mission
 * ```
 *
 * The two unions are the techspec's, member for member. What this module adds is the boundary either
 * side of them: `fromCockpitIn` reads a frame, and `textOf` writes one.
 *
 * ## Every import here is `import type`, and that is load-bearing
 *
 * This file is shared by the server and by the view the server serves — a browser cannot load
 * `node-pty`, and `PaneId` and `PaneStatus` live in `runtime/pane-manager.ts`, which does. Type-only
 * imports are erased at compile time, so the compiled envelope requires nothing at all: no engine
 * module, no runtime module, no Node builtin. `protocol.test.ts` asserts the statements are `import
 * type` rather than merely importing types, the same pin `mission-store.test.ts` puts on its own
 * boundary.
 *
 * It also means this module runs **no** rule. It cannot: `decide` is not here to be called.
 *
 * ## What is checked, and the one thing that is deliberately not
 *
 * A frame is whatever the far side sent — a `JSON.parse` of text from a browser tab, or from anything
 * else that can reach a loopback port. So the envelope is read as `unknown` and checked down to the
 * fields the member it claims to be actually declares. That is this repo's standing rule about casts,
 * applied at the one place in the Cockpit where a value arrives from outside the process.
 *
 * The **Command inside a `submit` is not inspected**, beyond its being an object that says what kind it
 * is, and that is the most important line in this file:
 *
 * - `decide` is what answers a Command, and it answers a malformed one truthfully — an unrecognised
 *   `kind` is refused `illegal-transition`, a `submit-handoff` whose Handoff was lost to a cast is
 *   refused with the reason written out. A check here would answer *first*, and with a different
 *   vocabulary: the client would get a transport fault where the engine had a Refusal to give it, and
 *   the Replay would never record that the intent was made at all.
 * - It would also be a second place the rules live, with this one having the last word, because it is
 *   what a gesture passes through. `mission-store.ts` refused the same move for the same reason and it
 *   is worth reading beside this: a Replay legitimately records Commands the domain refused *for being
 *   malformed*, so a layer that filtered them would drop exactly what the record exists to keep.
 *
 * The `kind` is checked, and only because the reading of a frame has to be able to say *what* it read:
 * an envelope carrying a Command with no `kind` is not a gesture anybody made, and `stepsOf` would have
 * nothing to call it. It is one string, and `decide` still decides.
 *
 * `paneId` and `keystrokes` **are** checked, and the asymmetry is not an inconsistency: they are the
 * envelope's own fields, not a payload for somebody else's rule. A `pane-write` with no PaneId is not
 * addressed to anything, and the process table answers a missing one by throwing — a gesture that
 * cannot be delivered is refused where it is read.
 *
 * ## A fault is a string, not a member of `ToCockpit`
 *
 * `fromCockpitIn` answers a `Reading`: what was read, or why it could not be. It never throws and it
 * never guesses. Who reports the fault, and how, is the server's decision — see the close-code table in
 * `server.ts` — and the reason it is not a fifth `ToCockpit` member is that the techspec pins four, and
 * a frame that is not an envelope is a fault of the *transport* rather than a fact about a Mission.
 * RFC 6455 already has a channel for that, and it is the Close frame.
 */

import type { Meter, Mission, MissionCommand, ReplayEntry } from "@engine/index";
import type { PaneId, PaneStatus } from "../runtime/pane-manager";

/* -------------------------------------------------------------------------------------------------
 * On the way in
 * ---------------------------------------------------------------------------------------------- */

/**
 * A human gesture, as a Command for the Mission this Cockpit is on.
 *
 * It carries **no MissionId**, deliberately. Which Mission an entry lands in is the server's — a
 * Cockpit is opened on one Mission — and a gesture that repeated the id could disagree with it, which
 * is a state nobody should have to handle. It is the same rule that keeps `missionId` off every
 * `MissionCommand` but `open-mission`.
 */
export type Submit = {
  readonly kind: "submit";
  readonly command: MissionCommand;
};

/** Keystrokes for a Pane, exactly as a human typing into it would deliver them. */
export type PaneWrite = {
  readonly kind: "pane-write";
  readonly paneId: PaneId;
  /** What was typed. A blank string is a real answer — nothing to say is something a human can mean. */
  readonly keystrokes: string;
};

/** End a Pane's process tree. */
export type PaneKill = {
  readonly kind: "pane-kill";
  readonly paneId: PaneId;
};

/** What a Cockpit sends. Every member is a gesture somebody made. */
export type FromCockpit = Submit | PaneWrite | PaneKill;

/* -------------------------------------------------------------------------------------------------
 * On the way out
 * ---------------------------------------------------------------------------------------------- */

/** Bytes a Pane's process wrote, in the order it wrote them. Never buffered — see the manager's Gap 1. */
export type PaneData = {
  readonly kind: "pane-data";
  readonly paneId: PaneId;
  readonly chunk: string;
};

/**
 * A Pane's status, when it changed.
 *
 * Named for the change rather than for the status, because that is what the process table announces:
 * only changes are told, and a status is never repeated.
 */
export type PaneStatusChange = {
  readonly kind: "pane-status";
  readonly paneId: PaneId;
  readonly status: PaneStatus;
};

/**
 * What the domain answered one gesture: the accepted Events, or the Refusal, **verbatim**.
 *
 * The whole `ReplayEntry`, Command included, and nothing summarised. This is the rule the Cockpit may
 * not break, expressed as a shape: a Refusal is a value that arrives here whole, and a server that
 * could soften it would have to build something other than an entry.
 */
export type Decided = {
  readonly kind: "decided";
  readonly entry: ReplayEntry;
};

/**
 * Where the Mission stands: the state the Replay folds to, and the Meter read off it.
 *
 * `meter` is present **exactly when the Mission has been opened**, and that is a deviation from the
 * techspec's `meter: Meter` worth stating. `meterOf` takes an `OpenedMission` because a Mission nobody
 * opened has no Cap, no spending and no Delegations — so a Meter for one would be a zero Cap in front
 * of a human that nobody set, which is the always-zero lie this repo keeps refusing. Optional, present
 * when there is an answer, is the shape `Delegation.handoff` and `Gate.decision` already use.
 *
 * `state` is a `Mission` and not an `OpenedMission`: a Cockpit opened on a Mission that does not exist
 * yet is the ordinary first second of `mz .`, and the unopened state is what says so.
 */
export type MissionReading = {
  readonly kind: "mission";
  readonly state: Mission;
  readonly meter?: Meter;
};

/** What the server sends. Three of the four are readings; `decided` is the answer to a gesture. */
export type ToCockpit = PaneData | PaneStatusChange | Decided | MissionReading;

/* -------------------------------------------------------------------------------------------------
 * Reading a frame
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a text frame turned out to be: a gesture, or the reason it is not one.
 *
 * The `unreadable` member deliberately does **not** declare `sent`, so `reading.sent` cannot be read
 * off the un-narrowed union. A `sent?: never` would make it readable as `undefined`, which is a
 * convenience this one does not want: every caller has to answer the fault, and the type is what makes
 * forgetting it impossible.
 */
export type Reading =
  | { readonly kind: "read"; readonly sent: FromCockpit }
  | { readonly kind: "unreadable"; readonly detail: string };

/**
 * The gesture a text frame carries, or why it carries none.
 *
 * Never throws: a frame is untrusted input, and a reading that threw would make every fault the
 * server's crash rather than the client's answer.
 */
export function fromCockpitIn(text: string): Reading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return unreadable(`it is not JSON — ${messageOf(cause)}`);
  }

  // Every condition stays inline in its `if`: TypeScript does not narrow through an aliased compound
  // condition that uses `in`.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return unreadable(`it is ${shown(parsed)}, not an envelope`);
  }
  if (!("kind" in parsed) || typeof parsed.kind !== "string") {
    return unreadable("it does not say what kind of gesture it is");
  }

  switch (parsed.kind) {
    case "submit": {
      if (!("command" in parsed)) {
        return unreadable('a "submit" carries a Command, and this one carries none');
      }
      const command: unknown = parsed.command;
      if (
        typeof command !== "object" ||
        command === null ||
        Array.isArray(command) ||
        !("kind" in command) ||
        typeof command.kind !== "string" ||
        command.kind.trim().length === 0
      ) {
        return unreadable(
          `a "submit" carries a Command that says what kind it is, and this one carries ` +
            `${shown(command)}`,
        );
      }
      // The cast the module doc argues for, and the reason it is safe is what is *not* claimed by it:
      // nothing here reads a Command's fields. `decide` does, as `unknown`, and answers a malformed one
      // with a Refusal the Replay records.
      return read({ kind: "submit", command: command as MissionCommand });
    }

    case "pane-write": {
      const paneId = paneIdIn(parsed, "pane-write");
      if (typeof paneId !== "string") {
        return paneId;
      }
      if (!("keystrokes" in parsed) || typeof parsed.keystrokes !== "string") {
        return unreadable(
          `a "pane-write" carries the keystrokes as text, and this one carries ` +
            `${shown("keystrokes" in parsed ? parsed.keystrokes : undefined)}`,
        );
      }
      return read({ kind: "pane-write", paneId, keystrokes: parsed.keystrokes });
    }

    case "pane-kill": {
      const paneId = paneIdIn(parsed, "pane-kill");
      if (typeof paneId !== "string") {
        return paneId;
      }
      return read({ kind: "pane-kill", paneId });
    }

    default:
      return unreadable(`${JSON.stringify(parsed.kind)} is not a gesture a Cockpit makes`);
  }
}

/**
 * The PaneId a gesture names, or the reading that says it names none.
 *
 * Answers the `Reading` itself on failure rather than `undefined`, so the caller cannot forget to
 * phrase the fault and the two gestures that need a PaneId phrase it identically. The success answer is
 * a `PaneId`, which is a `string`, so a caller tells the two apart with `typeof`.
 */
function paneIdIn(envelope: object, gesture: string): PaneId | Extract<Reading, { kind: "unreadable" }> {
  const named: unknown = "paneId" in envelope ? envelope.paneId : undefined;
  if (typeof named !== "string" || named.trim().length === 0) {
    return {
      kind: "unreadable",
      detail:
        `a "${gesture}" is addressed to a Pane by its id, which must be a non-blank string, ` +
        `and this one names ${shown(named)}`,
    };
  }
  // The one cast this needs, and the check above it is what makes it safe: a PaneId is a non-blank
  // string and nothing else, exactly as `paneId()` in the process table defines it.
  return named as PaneId;
}

/* -------------------------------------------------------------------------------------------------
 * Writing a frame
 * ---------------------------------------------------------------------------------------------- */

/**
 * A message that cannot be JSON, so nothing was sent.
 *
 * Only reachable through a cast — a circular structure, a `BigInt`, a `toJSON` answering `undefined`.
 * Refused rather than absorbed for the reason `InvalidReplayEntryError` is: `String(undefined)` would
 * put the literal text `undefined` on the wire, where the far side would read it as a fault of its own
 * and never learn what really happened.
 */
export class UnsendableMessageError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`this message cannot be sent: ${detail}`);
    this.name = "UnsendableMessageError";
    this.detail = detail;
  }
}

/**
 * One message as the text of a frame.
 *
 * @throws {UnsendableMessageError} when it cannot be JSON.
 */
export function textOf(said: ToCockpit): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(said);
  } catch (cause) {
    throw new UnsendableMessageError(`it cannot be JSON — ${messageOf(cause)}`);
  }
  if (typeof text !== "string") {
    throw new UnsendableMessageError(`JSON.stringify answered ${shown(text)}`);
  }
  return text;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

function read(sent: FromCockpit): Reading {
  return { kind: "read", sent };
}

function unreadable(detail: string): Reading {
  return { kind: "unreadable", detail };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a fault. Mirrors the engine, the pty runner and the store. */
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
