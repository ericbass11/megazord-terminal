/**
 * The Cockpit server, over real sockets. This file is criterion 1's proof.
 *
 * Three things are real here and none of them is stubbed:
 *
 * - **The HTTP server and the WebSocket.** The view is fetched with `fetch`, and the envelope is driven
 *   with Node's own `WebSocket` — an implementation nobody here wrote, which is what makes the
 *   hand-rolled handshake and framing in `server.ts` interoperable rather than merely self-consistent.
 *   The framing edge cases a well-behaved client will not produce (an unmasked frame, a binary frame, a
 *   fragmented message, a frame over the bound) are driven from a raw `node:net` socket with masking
 *   written out in this file, which is a second independent implementation of the client half.
 * - **The Replay on disk.** A real `missionStore` over a temporary Workspace. Every claim about "no
 *   state in the server" is measured against the file, not against an object.
 * - **The engine.** `submit`, `decide` and `stateOf` are the real ones, and the Refusal asserted below is
 *   compared byte for byte against what `submit` answers when called directly.
 *
 * What is **not** real is the process table, and that is deliberate: `PaneManager` arrives at the server
 * as a type, so this file hands it a recording one and criterion 1 is proven with no process spawned, no
 * `/proc` dependence and nothing to leave behind. That a real Pane streams, accepts keystrokes and dies
 * when killed is criteria 2, 3 and 4, proven in `runtime/pane-manager.test.ts`; repeating it here would
 * only make this file slower and weaker.
 *
 * Every server is closed and every socket destroyed in `afterEach`, and the last test asserts the ports
 * this file bound are no longer listening.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_REPLAY,
  briefing,
  core as coreOf,
  delegationId,
  gateId,
  handoff,
  instant,
  isOpened,
  meterOf,
  missionId,
  moneyFromDecimal,
  orchestrationCapability,
  stateOf,
  stepsOf,
  submit,
  type Mission,
  type Refusal,
  type MissionCommand,
  type MissionId,
  type ReplayEntry,
} from "@engine/index";

import { missionStore, type MissionStore } from "../runtime/mission-store";
import { UnknownPaneError, type PaneId, type PaneManager, type PaneStatus } from "../runtime/pane-manager";

import { cockpitServer, type CockpitServer, type CockpitServerOptions } from "./server";
import type { ToCockpit } from "./protocol";

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const MISSION: MissionId = missionId("mission-cockpit");
const PANE = "pane-1" as PaneId;
const VIEW = "<!doctype html><title>Cockpit</title><p>the Panes go here";
const AT = instant("2026-08-06T12:00:00.000Z");

/** Everything this file opened, closed after every test whatever the test did. */
const started: CockpitServer[] = [];
const opened: Socket[] = [];
const workspaces: string[] = [];
const bound: number[] = [];

afterEach(async () => {
  for (const socket of opened.splice(0)) {
    socket.destroy();
  }
  for (const server of started.splice(0)) {
    await server.close();
  }
  for (const root of workspaces.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "cockpit-server-"));
  workspaces.push(root);
  return root;
}

/**
 * A process table that records what it was told and can push a chunk or a status out.
 *
 * It forms no opinions, exactly as `fakeAgentRunner` forms none: judging a gesture is the server's, and
 * a fake with rules of its own is a second rule set a test would start passing because of. The one
 * refusal it does make is the real one — a Pane it does not hold — because that is the path the server's
 * out-of-sync close code exists for.
 */
type RecordedPanes = PaneManager & {
  readonly written: { readonly paneId: PaneId; readonly keystrokes: string }[];
  readonly killed: PaneId[];
  /** Ids this table pretends to hold. Anything else is an `UnknownPaneError`, as the real one answers. */
  readonly holding: Set<string>;
  /** Fails the next `kill`, so the server's answer to a tree that outlived SIGKILL can be driven. */
  killRejects: Error | undefined;
  says(paneId: PaneId, chunk: string): void;
  becomes(paneId: PaneId, status: PaneStatus): void;
};

function recordedPanes(): RecordedPanes {
  const data: ((paneId: PaneId, chunk: string) => void)[] = [];
  const statuses: ((paneId: PaneId, status: PaneStatus) => void)[] = [];
  const table: RecordedPanes = {
    written: [],
    killed: [],
    holding: new Set<string>([PANE]),
    killRejects: undefined,
    spawn(): void {
      throw new Error("this envelope has no pane-spawn: spawning is the control plane's");
    },
    write(paneId: PaneId, keystrokes: string): void {
      if (!table.holding.has(paneId)) {
        throw new UnknownPaneError(JSON.stringify(paneId));
      }
      table.written.push({ paneId, keystrokes });
    },
    async kill(paneId: PaneId): Promise<void> {
      if (!table.holding.has(paneId)) {
        throw new UnknownPaneError(JSON.stringify(paneId));
      }
      if (table.killRejects !== undefined) {
        throw table.killRejects;
      }
      table.killed.push(paneId);
    },
    onData(listen: (paneId: PaneId, chunk: string) => void): void {
      data.push(listen);
    },
    onStatus(listen: (paneId: PaneId, status: PaneStatus) => void): void {
      statuses.push(listen);
    },
    says(paneId: PaneId, chunk: string): void {
      for (const listen of data) {
        listen(paneId, chunk);
      }
    },
    becomes(paneId: PaneId, status: PaneStatus): void {
      for (const listen of statuses) {
        listen(paneId, status);
      }
    },
  };
  return table;
}

/** A Cockpit over a fresh Workspace, on an ephemeral port, closed for you afterwards. */
async function cockpit(
  over: Partial<CockpitServerOptions> = {},
): Promise<{ server: CockpitServer; store: MissionStore; panes: RecordedPanes }> {
  const store = over.store ?? missionStore({ workspace: workspace() });
  const panes = recordedPanes();
  const server = await cockpitServer({
    missionId: MISSION,
    store,
    panes,
    view: VIEW,
    ...over,
  });
  started.push(server);
  bound.push(server.port);
  return { server, store, panes };
}

/* -------------------------------------------------------------------------------------------------
 * A client, built on Node's own WebSocket
 * ---------------------------------------------------------------------------------------------- */

type Client = {
  readonly said: ToCockpit[];
  send(sent: unknown): void;
  /** The first message satisfying `wanted`, waiting for it to arrive. */
  next(wanted: (said: ToCockpit) => boolean): Promise<ToCockpit>;
  /** The close the server sent, once it arrives. */
  closed(): Promise<{ code: number; reason: string }>;
  end(): void;
};

async function clientOn(server: CockpitServer): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
  const said: ToCockpit[] = [];
  let ending: { code: number; reason: string } | undefined;

  socket.addEventListener("message", (event: MessageEvent) => {
    // Text frames only, by contract, so the data is a string. Read as `unknown` because an event is not
    // a promise anybody made.
    const data: unknown = event.data;
    if (typeof data === "string") {
      said.push(JSON.parse(data) as ToCockpit);
    }
  });
  socket.addEventListener("close", (event: CloseEvent) => {
    ending = { code: event.code, reason: event.reason };
  });

  await new Promise<void>((open, failed) => {
    socket.addEventListener("open", () => open());
    socket.addEventListener("error", () => failed(new Error("the WebSocket did not open")));
  });

  return {
    said,
    send(sent: unknown): void {
      socket.send(JSON.stringify(sent));
    },
    async next(wanted: (message: ToCockpit) => boolean): Promise<ToCockpit> {
      return until(() => said.find(wanted), () => `messages so far: ${JSON.stringify(said)}`);
    },
    async closed(): Promise<{ code: number; reason: string }> {
      return until(() => ending, () => "the server never closed the connection");
    },
    end(): void {
      socket.close();
    },
  };
}

/** Polls for something to arrive. Every wait in this file is bounded and says what it was waiting for. */
async function until<T>(read: () => T | undefined, onGivingUp: () => string): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`nothing arrived within 5s — ${onGivingUp()}`);
    }
    await new Promise((wake) => setTimeout(wake, 5));
  }
}

/* -------------------------------------------------------------------------------------------------
 * A raw client, for the framing this file has to drive by hand
 * ---------------------------------------------------------------------------------------------- */

type RawClient = {
  /** The HTTP response head, once it arrives. */
  head(): Promise<string>;
  /** Writes one frame, masked as a client must. */
  send(opcode: number, payload: Buffer, fin?: boolean): void;
  text(said: string): void;
  /** The next frame the server wrote. */
  frame(): Promise<{ fin: boolean; opcode: number; payload: Buffer }>;
  /** The close the server sent: its code and its reason, skipping whatever came before it. */
  closeFrame(): Promise<{ code: number; reason: string }>;
  readonly key: string;
  /** The socket itself, for the tests that have to write bytes this file's framing would not produce. */
  readonly socket: Socket;
};

function rawClientOn(server: CockpitServer, extra: Readonly<Record<string, string>> = {}): RawClient {
  const socket = netConnect(server.port, "127.0.0.1");
  opened.push(socket);

  let pending = Buffer.alloc(0);
  let upgraded = false;
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
  });
  socket.on("error", () => {
    // A reset is an answer here, and the assertion that follows says what was expected instead.
  });

  // `extra` **replaces** a default rather than being appended after it. Appending sends the header
  // twice, and Node's parser keeps the first — so a test that meant to send a bad key sent a good one
  // beside it and watched the handshake succeed. It failed loudly here; the dangerous version passes.
  const generated = randomBytes(16).toString("base64");
  const headers: Record<string, string> = {
    Host: `127.0.0.1:${server.port}`,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": generated,
    "Sec-WebSocket-Version": "13",
    ...extra,
  };
  const key = headers["Sec-WebSocket-Key"];
  const head = [
    "GET / HTTP/1.1",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ].join("\r\n");
  socket.write(`${head}\r\n\r\n`);

  /** One server frame off the front of the buffer. Server frames are never masked. */
  function taken(): { fin: boolean; opcode: number; payload: Buffer } | undefined {
    if (!upgraded || pending.length < 2) {
      return undefined;
    }
    const first = pending[0];
    const second = pending[1];
    let at = 2;
    let length = second & 0x7f;
    if (length === 126) {
      if (pending.length < 4) {
        return undefined;
      }
      length = pending.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (pending.length < 10) {
        return undefined;
      }
      length = Number(pending.readBigUInt64BE(2));
      at = 10;
    }
    if ((second & 0x80) !== 0) {
      throw new Error("the server masked a frame, which a server must never do");
    }
    if (pending.length < at + length) {
      return undefined;
    }
    const payload = Buffer.from(pending.subarray(at, at + length));
    pending = pending.subarray(at + length);
    return { fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload };
  }

  return {
    key,
    socket,
    async head(): Promise<string> {
      return until(
        () => {
          const at = pending.indexOf("\r\n\r\n");
          if (at < 0) {
            return undefined;
          }
          const text = pending.subarray(0, at).toString("utf8");
          pending = pending.subarray(at + 4);
          upgraded = text.startsWith("HTTP/1.1 101");
          return text;
        },
        () => `the head never arrived; ${pending.length} bytes so far`,
      );
    },
    send(opcode: number, payload: Buffer, fin = true): void {
      socket.write(maskedFrame(opcode, payload, fin));
    },
    text(said: string): void {
      this.send(0x1, Buffer.from(said, "utf8"));
    },
    async frame(): Promise<{ fin: boolean; opcode: number; payload: Buffer }> {
      return until(taken, () => `no frame arrived; ${pending.length} bytes pending`);
    },
    async closeFrame(): Promise<{ code: number; reason: string }> {
      // Skips whatever the server had already sent — the `mission` reading arrives on its own schedule,
      // because it waits for the disk, and a test about a close must not depend on winning that race.
      let frame = await this.frame();
      while (frame.opcode !== 0x8) {
        frame = await this.frame();
      }
      return {
        code: frame.payload.readUInt16BE(0),
        reason: frame.payload.subarray(2).toString("utf8"),
      };
    },
  };
}

/**
 * One masked client frame, written out here rather than reused from the server.
 *
 * Deliberately a second implementation: a client's frames are masked and a server's are not, so there is
 * nothing to share, and a test that reused the server's writer would prove only that the file agrees
 * with itself.
 */
function maskedFrame(opcode: number, payload: Buffer, fin: boolean): Buffer {
  const mask = randomBytes(4);
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

/* -------------------------------------------------------------------------------------------------
 * Commands
 * ---------------------------------------------------------------------------------------------- */

/** The Command that opens the Mission this file drives. Accepted. */
function opening(): MissionCommand {
  return {
    kind: "open-mission",
    occurredAt: AT,
    missionId: MISSION,
    briefing: briefing("Ship the Cockpit so a human can watch a Combination deliver"),
    mode: "combination",
    cap: moneyFromDecimal("50.00"),
    core: coreOf([orchestrationCapability("delegate")]),
  };
}

/** A Command the engine refuses: a Handoff for a Mission nobody has opened. */
function answering(): MissionCommand {
  return {
    kind: "submit-handoff",
    occurredAt: AT,
    handoff: handoff({
      delegationId: delegationId("delegation-1"),
      satisfies: [],
      gaps: [],
      artifacts: ["engine/index.ts"],
    }),
  };
}

/** A Command that ends the Mission. Accepted while it is running. */
function killing(): MissionCommand {
  return { kind: "kill-mission", occurredAt: AT, reason: "the human changed their mind" };
}

/** A Command that stops the Mission at a Gate. Accepted while it is running, refused once it is over. */
function raising(): MissionCommand {
  return {
    kind: "raise-gate",
    occurredAt: AT,
    gateId: gateId("gate-1"),
    question: "may this Combination open a pull request?",
  };
}

/** A message narrowed to the member it says it is, or a failure naming what arrived. */
function decidedIn(said: ToCockpit): ReplayEntry {
  if (said.kind !== "decided") {
    throw new Error(`expected a decided, got a ${said.kind}`);
  }
  return said.entry;
}

function readingIn(said: ToCockpit): Extract<ToCockpit, { kind: "mission" }> {
  if (said.kind !== "mission") {
    throw new Error(`expected a mission, got a ${said.kind}`);
  }
  return said;
}

function missionIn(said: ToCockpit): Mission {
  return readingIn(said).state;
}

/** The Refusal an entry carries, or a failure saying it carries none. */
function refusalIn(entry: ReplayEntry): Refusal {
  if (entry.decision.kind !== "refused") {
    throw new Error(`expected a Refusal, got a Decision that was ${entry.decision.kind}`);
  }
  return entry.decision.refusal;
}

const isDecided = (said: ToCockpit): boolean => said.kind === "decided";
const isMission = (said: ToCockpit): boolean => said.kind === "mission";

/* -------------------------------------------------------------------------------------------------
 * Criterion 1: the view arrives
 * ---------------------------------------------------------------------------------------------- */

describe("the view, over HTTP (criterion 1)", () => {
  it("is served from the ephemeral port the server reports", async () => {
    const { server } = await cockpit({ port: 0 });

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);

    const answered = await fetch(server.url);

    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answered.headers.get("cache-control")).toBe("no-store");
    expect(await answered.text()).toBe(VIEW);
  });

  it("serves the same document at /index.html, and nothing anywhere else", async () => {
    const { server } = await cockpit();

    expect(await (await fetch(`${server.url}index.html`)).text()).toBe(VIEW);
    expect(await (await fetch(`${server.url}?anything=1`)).text()).toBe(VIEW);

    const missing = await fetch(`${server.url}xterm.js`);
    expect(missing.status).toBe(404);
    // Declared Gap 1: one document, no assets. The 404 says so out loud rather than serving the view
    // under every path, which would make a missing asset look like a broken script.
    expect(await missing.text()).toContain("/xterm.js");

    const posted = await fetch(server.url, { method: "POST", body: "{}" });
    expect(posted.status).toBe(405);
  });

  it("answers a HEAD with the length and no body", async () => {
    const { server } = await cockpit();

    const answered = await fetch(server.url, { method: "HEAD" });

    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-length")).toBe(String(Buffer.byteLength(VIEW, "utf8")));
    expect(await answered.text()).toBe("");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 1: a Refusal comes back verbatim
 * ---------------------------------------------------------------------------------------------- */

describe("a gesture the engine refuses (criterion 1)", () => {
  it("comes back as the Refusal itself, not as silence and not as a generic failure", async () => {
    const { server, store } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "submit", command: answering() });
    const entry = decidedIn(await client.next(isDecided));

    expect(entry.decision.kind).toBe("refused");
    expect(refusalIn(entry).reason).toBe("illegal-transition");
    expect(refusalIn(entry).violations.length).toBeGreaterThan(0);

    // Verbatim, and "verbatim" is measured rather than asserted: the entry the client received is the
    // entry `submit` answers when called directly against the same Replay. Nothing was reworded,
    // summarised or softened on the way through, and the Command is in it too.
    const directly = submit(EMPTY_REPLAY, answering());
    expect(entry).toEqual(JSON.parse(JSON.stringify(directly[0])));
    expect(entry.command.kind).toBe("submit-handoff");

    // And it is readable as a Replay entry, which is what a human is eventually shown.
    expect(stepsOf([entry])[0].summary).toContain("was refused (illegal-transition)");

    // A refused Decision is not appended: the file holds what the Mission accepted. The Refusal reached
    // the human all the same, which is the whole distinction.
    expect(await store.load(MISSION)).toEqual([]);
  });

  it("refuses a Command kind nobody wrote a rule for, rather than the protocol refusing it first", async () => {
    const { server } = await cockpit();
    const client = await clientOn(server);

    // The deliberate non-inspection in `protocol.ts`, end to end: `decide`'s `default` branch is what
    // answers this, with a Refusal a human can read, and the client's connection stays open.
    client.send({ kind: "submit", command: { kind: "conquer-the-world", occurredAt: AT } });
    const entry = decidedIn(await client.next(isDecided));

    expect(refusalIn(entry).violations).toEqual([
      "a Command this engine does not recognise cannot be accepted",
    ]);
  });

  it("keeps the connection open, so the same client can submit again", async () => {
    const { server, store } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "submit", command: answering() });
    await client.next(isDecided);
    client.send({ kind: "submit", command: opening() });
    await until(
      () => (client.said.filter(isDecided).length === 2 ? true : undefined),
      () => `only ${client.said.filter(isDecided).length} decided so far`,
    );

    const entries = client.said.filter(isDecided).map(decidedIn);
    expect(entries.map((entry) => entry.decision.kind)).toEqual(["refused", "accepted"]);
    // A Refusal settles nothing: the Mission the second gesture opened is on disk, and the first
    // gesture is not.
    expect(await store.load(MISSION)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * An accepted gesture reaches the disk
 * ---------------------------------------------------------------------------------------------- */

describe("a gesture the engine accepts", () => {
  it("is appended to the Replay, and the Mission the file folds to is the one sent back", async () => {
    const { server, store } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "submit", command: opening() });
    const entry = decidedIn(await client.next(isDecided));

    expect(entry.decision.kind).toBe("accepted");

    const recorded = await store.load(MISSION);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual(entry);

    const state = stateOf(recorded);
    expect(state.status).toBe("running");

    // The `mission` reading the server broadcast is that same fold, with the Meter beside it.
    const last = client.said.filter(isMission).at(-1);
    expect(last).toBeDefined();
    const reading = readingIn(last ?? { kind: "pane-status", paneId: PANE, status: "idle" });
    expect(reading.state).toEqual(JSON.parse(JSON.stringify(state)));
    expect(isOpened(state)).toBe(true);
    if (!isOpened(state)) {
      throw new Error("unreachable: the status was asserted to be running above");
    }
    expect(reading.meter).toEqual(JSON.parse(JSON.stringify(meterOf(state))));
  });

  it("says where the Mission stands before anything is asked, and carries no Meter when it is unopened", async () => {
    const { server } = await cockpit();
    const client = await clientOn(server);

    const first = await client.next(isMission);

    expect(missionIn(first)).toEqual({ status: "unopened" });
    // An unopened Mission has no Cap, no spending and no Delegations, so it has no Meter — rather than a
    // zero Cap nobody set. The deviation from the techspec's `meter: Meter` is argued in `protocol.ts`.
    expect(readingIn(first).meter).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------------------------------
 * No Mission state in the server
 * ---------------------------------------------------------------------------------------------- */

describe("the server holds no Mission state (the techspec's rule)", () => {
  it("has one client see what another submitted, derived from the same Replay", async () => {
    const { server, store } = await cockpit();
    const watching = await clientOn(server);
    const acting = await clientOn(server);

    // Both are told where the Mission stands when they connect: unopened.
    expect(missionIn(await watching.next(isMission))).toEqual({ status: "unopened" });

    acting.send({ kind: "submit", command: opening() });
    await acting.next(isDecided);

    // The watching client never asked for anything and holds nothing. What it sees is a reading of the
    // Replay the acting client's gesture appended.
    const seen = await until(
      () => watching.said.filter(isMission).map(missionIn).find((state) => state.status === "running"),
      () => `watching client saw ${JSON.stringify(watching.said)}`,
    );

    const onDisk = stateOf(await store.load(MISSION));
    expect(seen).toEqual(JSON.parse(JSON.stringify(onDisk)));

    // `decided` goes to the client that asked and to nobody else — declared Gap 4.
    expect(watching.said.filter(isDecided)).toEqual([]);
  });

  it("tells a client that connects afterwards exactly the same thing, read off the file", async () => {
    const { server, store } = await cockpit();
    const acting = await clientOn(server);
    acting.send({ kind: "submit", command: opening() });
    await acting.next(isDecided);

    // A third client, connecting after the fact, with no broadcast to have missed and no object shared
    // with anybody. Its first message is the state of the Mission, folded from the file.
    const late = await clientOn(server);
    const first = missionIn(await late.next(isMission));

    expect(first).toEqual(JSON.parse(JSON.stringify(stateOf(await store.load(MISSION)))));
    expect(first.status).toBe("running");
  });

  it("reads the file for its first gesture, not an empty Replay it assumed", async () => {
    const { server, store } = await cockpit();
    const client = await clientOn(server);

    // Somebody else — the control plane, in this product — opened this Mission before the Cockpit was
    // asked anything.
    const already = submit(EMPTY_REPLAY, opening());
    await store.append(MISSION, already[0]);

    client.send({ kind: "submit", command: opening() });
    const entry = decidedIn(await client.next(isDecided));

    // Refused, because the Mission is already open — which is only knowable by having read the file.
    expect(refusalIn(entry).reason).toBe("illegal-transition");
  });

  it("reads it again for every later gesture, so a Replay that moved behind its back is not read stale", async () => {
    const { server, store } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "submit", command: opening() });
    expect(decidedIn(await client.next(isDecided)).decision.kind).toBe("accepted");

    // Now somebody else ends the Mission while the Cockpit is still open. This is the case a cache
    // actually breaks, and the one the test above cannot see: a server that remembered the Replay it
    // answered its **own** first gesture with would still think this Mission is running.
    const recorded = await store.load(MISSION);
    const ended = submit(recorded, killing());
    await store.append(MISSION, ended[ended.length - 1]);

    client.send({ kind: "submit", command: raising() });
    await until(
      () => (client.said.filter(isDecided).length === 2 ? true : undefined),
      () => `only ${client.said.filter(isDecided).length} decided so far`,
    );
    const second = decidedIn(client.said.filter(isDecided)[1]);

    // Refused, because the Mission is over. Against a cached Replay it would have been **accepted**, and
    // a Gate would have been raised on a Mission nobody can answer.
    expect(refusalIn(second).reason).toBe("illegal-transition");
    expect(stateOf(await store.load(MISSION)).status).toBe("killed");
  });

  it("decides two gestures in order, so neither is decided against a state the other moved", async () => {
    const { server, store } = await cockpit();
    const one = await clientOn(server);
    const two = await clientOn(server);

    // Both clients open the same Mission, at the same moment, from two connections. Without a queue both
    // would load the empty Replay and both would be accepted, and the file would hold two openings.
    one.send({ kind: "submit", command: opening() });
    two.send({ kind: "submit", command: opening() });

    const first = decidedIn(await one.next(isDecided));
    const second = decidedIn(await two.next(isDecided));

    expect([first.decision.kind, second.decision.kind].sort()).toEqual(["accepted", "refused"]);
    expect(await store.load(MISSION)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Panes
 * ---------------------------------------------------------------------------------------------- */

describe("a Pane's stream and a Pane's gestures", () => {
  it("streams what a Pane wrote to every client watching", async () => {
    const { server, panes } = await cockpit();
    const one = await clientOn(server);
    const two = await clientOn(server);
    await one.next(isMission);
    await two.next(isMission);

    panes.says(PANE, "hello from a Zord\r\n");
    panes.becomes(PANE, "working");

    for (const client of [one, two]) {
      expect(await client.next((said) => said.kind === "pane-data")).toEqual({
        kind: "pane-data",
        paneId: PANE,
        chunk: "hello from a Zord\r\n",
      });
      expect(await client.next((said) => said.kind === "pane-status")).toEqual({
        kind: "pane-status",
        paneId: PANE,
        status: "working",
      });
    }
  });

  it("delivers keystrokes to the Pane they name", async () => {
    const { server, panes } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "pane-write", paneId: PANE, keystrokes: "npm test\r" });

    await until(
      () => (panes.written.length === 1 ? panes.written[0] : undefined),
      () => "nothing was written to the process table",
    );
    expect(panes.written).toEqual([{ paneId: PANE, keystrokes: "npm test\r" }]);
  });

  it("ends a Pane's process tree", async () => {
    const { server, panes } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "pane-kill", paneId: PANE });

    await until(
      () => (panes.killed.length === 1 ? panes.killed[0] : undefined),
      () => "the process table was never asked to kill anything",
    );
    expect(panes.killed).toEqual([PANE]);
  });

  it("closes 1008 when a gesture names a Pane the table does not hold", async () => {
    const { server } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "pane-write", paneId: "pane-nobody-opened", keystrokes: "x" });
    const ending = await client.closed();

    expect(ending.code).toBe(1008);
    expect(ending.reason).toContain("there is no Pane under");
  });

  it("closes 1011 when a kill the client asked for could not be carried out", async () => {
    const { server, panes } = await cockpit();
    panes.killRejects = new Error(
      'the process tree of "pane-1" outlived SIGKILL: 4242 is still alive',
    );
    const client = await clientOn(server);

    client.send({ kind: "pane-kill", paneId: PANE });
    const ending = await client.closed();

    // Declared Gap: the envelope has no per-gesture failure, so this takes the connection down instead
    // of reporting on it. It is loud, and the reason names the survivor.
    expect(ending.code).toBe(1011);
    expect(ending.reason).toContain("outlived SIGKILL");
  });

  it("keys the out-of-sync close on the name the real process table gives its error", () => {
    // The server reads `error.name` rather than using `instanceof`, so that importing the class does not
    // make it require `node-pty`. This is the pin that turns that from a guess into a contract: rename
    // the class and this fails here rather than in production.
    expect(new UnknownPaneError('"pane-1"').name).toBe("UnknownPaneError");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The envelope's own faults
 * ---------------------------------------------------------------------------------------------- */

describe("a frame that is not a gesture", () => {
  it("closes 1007 with the reason, rather than being ignored", async () => {
    const { server } = await cockpit();
    const client = await clientOn(server);

    client.send({ kind: "pane-spawn", cli: "claude" });
    const ending = await client.closed();

    expect(ending.code).toBe(1007);
    expect(ending.reason).toContain('"pane-spawn" is not a gesture a Cockpit makes');
  });

  it("closes 1007 on text that is not JSON at all", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    expect(await raw.head()).toContain("101 Switching Protocols");

    raw.text("hello?");

    const ending = await raw.closeFrame();
    expect(ending.code).toBe(1007);
    expect(ending.reason).toContain("is not JSON");
  });
});

/* -------------------------------------------------------------------------------------------------
 * RFC 6455
 * ---------------------------------------------------------------------------------------------- */

describe("the handshake", () => {
  it("answers Sec-WebSocket-Accept as the RFC computes it", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);

    const head = await raw.head();

    expect(head).toContain("HTTP/1.1 101 Switching Protocols");
    expect(head.toLowerCase()).toContain("upgrade: websocket");
    // Computed here from the RFC's own GUID, independently of the server's `acceptOf`.
    const expected = acceptedFrom(`${raw.key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`);
    expect(head).toContain(`Sec-WebSocket-Accept: ${expected}`);
    // Nothing is negotiated: no extension, no subprotocol.
    expect(head.toLowerCase()).not.toContain("sec-websocket-extensions");
    expect(head.toLowerCase()).not.toContain("sec-websocket-protocol");
  });

  it("refuses a version other than 13", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server, { "Sec-WebSocket-Version": "8" });

    expect(await raw.head()).toContain("400 Bad Request");
  });

  it("refuses a key that is not 16 base64-encoded bytes", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server, { "Sec-WebSocket-Key": "dGhpcyBpcyBub3QgMTYgYnl0ZXMgbG9uZw==" });

    expect(await raw.head()).toContain("400 Bad Request");
  });

  it("refuses a page on another origin, and accepts its own", async () => {
    const { server } = await cockpit();

    const foreign = rawClientOn(server, { Origin: "https://evil.example" });
    expect(await foreign.head()).toContain("403 Forbidden");

    const own = rawClientOn(server, { Origin: `http://127.0.0.1:${server.port}` });
    expect(await own.head()).toContain("101 Switching Protocols");

    const alias = rawClientOn(server, { Origin: `http://localhost:${server.port}` });
    expect(await alias.head()).toContain("101 Switching Protocols");
  });
});

describe("framing", () => {
  it("refuses an unmasked frame from a client", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    // Written by hand rather than through `maskedFrame`: the mask bit is what is being taken away.
    const unmasked = Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from("{}", "utf8")]);
    rawWrite(raw, unmasked);

    expect(await raw.closeFrame()).toEqual({ code: 1002, reason: "a frame from a client is masked" });
  });

  it("refuses a reserved bit, because no extension was negotiated", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    // RSV1 set, which is what `permessage-deflate` would use had it been negotiated. It was not, so the
    // bytes after it are not what they claim to be and refusing beats mis-parsing.
    const compressed = maskedFrame(0x1, Buffer.from("{}", "utf8"), true);
    compressed[0] |= 0x40;
    rawWrite(raw, compressed);

    expect((await raw.closeFrame()).code).toBe(1002);
  });

  it("refuses a binary frame", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x2, Buffer.from([1, 2, 3]));

    expect(await raw.closeFrame()).toEqual({
      code: 1003,
      reason: "this protocol carries text frames only",
    });
  });

  it("reassembles a fragmented text message", async () => {
    const { server, panes } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    const whole = JSON.stringify({ kind: "pane-write", paneId: PANE, keystrokes: "hi\r" });
    const half = Math.floor(whole.length / 2);
    raw.send(0x1, Buffer.from(whole.slice(0, half), "utf8"), false);
    raw.send(0x0, Buffer.from(whole.slice(half), "utf8"), true);

    await until(
      () => (panes.written.length === 1 ? panes.written[0] : undefined),
      () => "the fragmented gesture never arrived whole",
    );
    expect(panes.written).toEqual([{ paneId: PANE, keystrokes: "hi\r" }]);
  });

  it("refuses a continuation with nothing to continue", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x0, Buffer.from("{}", "utf8"), true);

    expect(await raw.closeFrame()).toEqual({
      code: 1002,
      reason: "a continuation frame with nothing to continue",
    });
  });

  it("answers a ping with a pong carrying the same payload", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x9, Buffer.from("are you there", "utf8"));
    const pong = await raw.frame();

    expect(pong.opcode).toBe(0xa);
    expect(pong.payload.toString("utf8")).toBe("are you there");
  });

  it("refuses a fragmented control frame", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x9, Buffer.from("half a ping", "utf8"), false);

    expect((await raw.closeFrame()).code).toBe(1002);
  });

  it("refuses a frame over the bound rather than truncating it", async () => {
    const { server } = await cockpit({ maxMessageBytes: 256 });
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x1, Buffer.alloc(300, 0x61));

    expect(await raw.closeFrame()).toEqual({
      code: 1009,
      reason: "a frame of more than 256 bytes: refused rather than truncated",
    });
  });

  it("refuses a reassembled message over the bound, not only a single frame", async () => {
    const { server } = await cockpit({ maxMessageBytes: 256 });
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    raw.send(0x1, Buffer.alloc(200, 0x61), false);
    raw.send(0x0, Buffer.alloc(200, 0x61), true);

    expect(await raw.closeFrame()).toEqual({
      code: 1009,
      reason: "a message of more than 256 bytes: refused rather than truncated",
    });
  });

  it("reads a frame that arrives in pieces, and two frames that arrive in one piece", async () => {
    const { server, panes } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    // A frame does not arrive aligned with a TCP segment. Split one down the middle, with a pause, and
    // then send two whole frames inside a single write.
    const one = maskedFrame(
      0x1,
      Buffer.from(JSON.stringify({ kind: "pane-write", paneId: PANE, keystrokes: "one" }), "utf8"),
      true,
    );
    rawWrite(raw, one.subarray(0, 5));
    await new Promise((wake) => setTimeout(wake, 20));
    rawWrite(raw, one.subarray(5));

    const two = maskedFrame(
      0x1,
      Buffer.from(JSON.stringify({ kind: "pane-write", paneId: PANE, keystrokes: "two" }), "utf8"),
      true,
    );
    const three = maskedFrame(
      0x1,
      Buffer.from(JSON.stringify({ kind: "pane-write", paneId: PANE, keystrokes: "three" }), "utf8"),
      true,
    );
    rawWrite(raw, Buffer.concat([two, three]));

    await until(
      () => (panes.written.length === 3 ? panes.written : undefined),
      () => `only ${panes.written.length} arrived`,
    );
    expect(panes.written.map((written) => written.keystrokes)).toEqual(["one", "two", "three"]);
  });

  it("answers a close with a close, echoing a code a client may send", async () => {
    const { server } = await cockpit();
    const raw = rawClientOn(server);
    await raw.head();
    await raw.frame();

    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(1000, 0);
    raw.send(0x8, payload);

    expect(await raw.closeFrame()).toEqual({ code: 1000, reason: "" });
  });
});

/* -------------------------------------------------------------------------------------------------
 * Closing
 * ---------------------------------------------------------------------------------------------- */

describe("close", () => {
  it("tells every client it is going away and stops listening", async () => {
    const { server } = await cockpit();
    const one = await clientOn(server);
    const two = await clientOn(server);
    await one.next(isMission);
    await two.next(isMission);

    await server.close();

    expect((await one.closed()).code).toBe(1001);
    expect((await two.closed()).code).toBe(1001);
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it("does not return before an append it had already started has reached the disk", async () => {
    // The premise has to be *made* true rather than assumed: a `client.send` followed straight by
    // `server.close()` proves nothing, because the frame may still be on the wire and nothing was ever
    // queued. So the store is held open at its `append`, which is the only moment where "in flight" is
    // observable. (Written after the naive version failed, for the right reason.)
    const inner = missionStore({ workspace: workspace() });
    let started = false;
    let release = (): void => undefined;
    const held = new Promise<void>((go) => {
      release = () => go();
    });
    const store: MissionStore = {
      append: async (id, entry) => {
        started = true;
        await held;
        return inner.append(id, entry);
      },
      load: async (id) => inner.load(id),
      list: async () => inner.list(),
    };

    const { server } = await cockpit({ store });
    const client = await clientOn(server);
    client.send({ kind: "submit", command: opening() });
    await until(() => (started ? true : undefined), () => "the append never started");

    const closing = server.close();
    release();
    await closing;

    // A `close` that stopped listening while the entry was mid-write would lose a Decision the domain had
    // already made, which is the one thing this layer exists to record.
    expect(await inner.load(MISSION)).toHaveLength(1);
  });

  it("is idempotent, and does not hang on a client that never answers", async () => {
    const { server } = await cockpit();
    // A raw socket that has upgraded and will never send a close of its own: `close` must destroy it
    // rather than wait for it.
    const raw = rawClientOn(server);
    await raw.head();

    const began = Date.now();
    await server.close();
    await server.close();

    expect(Date.now() - began).toBeLessThan(5_000);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The boundary
 * ---------------------------------------------------------------------------------------------- */

describe("the boundary", () => {
  it("imports the engine's public surface, the two runtime contracts as types, and three Node builtins", () => {
    const here = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");
    const statements = [...here.matchAll(/^import\s[\s\S]*?from "([^"]+)";$/gm)];
    const specifiers = statements.map(([, specifier]) => specifier);

    expect([...specifiers].sort()).toEqual([
      "../runtime/mission-store",
      "../runtime/pane-manager",
      "./protocol",
      "@engine/index",
      "node:crypto",
      "node:http",
      "node:net",
      "node:stream",
    ]);
    // Never `@engine/domain/*`: reaching into the engine's insides from outside it is not part of the
    // Contract, and this was settled in review after two `runtime/` modules did it.
    expect(specifiers.every((specifier) => !specifier.startsWith("@engine/domain"))).toBe(true);
    // Both runtime imports are type-only, so this module requires no `node-pty` and opens no file of its
    // own: the process table and the store are handed in.
    for (const specifier of ["../runtime/pane-manager", "../runtime/mission-store"]) {
      const statement = statements.find(([, named]) => named === specifier);
      expect(statement?.[0].startsWith("import type ")).toBe(true);
    }
    // No dependency of any kind. A WebSocket is a handshake and a frame header.
    expect(specifiers.filter((specifier) => /^[a-z@]/.test(specifier) && !specifier.startsWith("node:") && !specifier.startsWith("@engine/"))).toEqual([]);
  });

  it("binds loopback only, and offers no way to change it", () => {
    const here = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");

    expect(here).toContain('const HOST = "127.0.0.1";');
    // A Cockpit types into live processes. An option to bind every interface would be a remote shell one
    // flag away, and the flag would eventually be set by a script somebody copied.
    expect(here).not.toMatch(/readonly host\??:/);
    expect(here).not.toContain("0.0.0.0");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The type level
 * ---------------------------------------------------------------------------------------------- */

describe("the type level", () => {
  it("answers the CockpitServer contract exactly, with nothing widened", async () => {
    // Not expressible as a directive: what is claimed is assignability. Widen `port` to `number |
    // undefined`, or `close` to `void`, and this line stops compiling — which fails `npm run build`.
    const { server } = await cockpit();
    const asContract: CockpitServer = server;

    expect(typeof asContract.close).toBe("function");
    expect(typeof asContract.port).toBe("number");
  });

  it("reports a port nobody can rewrite", async () => {
    const { server } = await cockpit();

    // The probe sits in a function nothing calls: the answer is frozen, so *running* the assignment
    // throws a TypeError and the test would pass for the runtime reason instead of proving the type one.
    // @ts-expect-error — `port` is readonly: it is what was actually bound, and a caller that could
    // rewrite it would be holding a number no socket answers to.
    const rewriting = (): number => (server.port = 0);

    expect(typeof rewriting).toBe("function");
    expect(Object.isFrozen(server)).toBe(true);
  });

  it("requires the view, the Mission, the store and the process table", async () => {
    const store = missionStore({ workspace: workspace() });
    const panes = recordedPanes();

    const viewless = (): Promise<CockpitServer> =>
      // @ts-expect-error — `view` has no default: a placeholder built into the server is a second view
      // that would eventually ship, competing with cockpit/view/.
      cockpitServer({ missionId: MISSION, store, panes });
    const missionless = (): Promise<CockpitServer> =>
      // @ts-expect-error — the envelope carries no MissionId, so this is what says which file a gesture
      // is recorded in.
      cockpitServer({ store, panes, view: VIEW });
    const hosted = (): Promise<CockpitServer> =>
      cockpitServer({
        missionId: MISSION,
        store,
        panes,
        view: VIEW,
        // @ts-expect-error — there is no host option, deliberately. See "Who may connect".
        host: "0.0.0.0",
      });

    expect([viewless, missionless, hosted].every((build) => typeof build === "function")).toBe(true);
  });

  it("takes a MissionId and not any string", async () => {
    const store = missionStore({ workspace: workspace() });
    const panes = recordedPanes();

    const loose = (): Promise<CockpitServer> =>
      cockpitServer({
        // @ts-expect-error — the brand is what keeps a ZordId out of the file a Mission is recorded in.
        missionId: "mission-cockpit",
        store,
        panes,
        view: VIEW,
      });

    expect(typeof loose).toBe("function");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Nothing is left behind
 * ---------------------------------------------------------------------------------------------- */

describe("nothing is left behind", () => {
  it("leaves no listening port and no .megazord/ in the repository", async () => {
    for (const port of bound) {
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    }
    expect(existsSync(join(process.cwd(), ".megazord"))).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

/** Writes bytes straight onto a raw client's socket, bypassing this file's own framing. */
function rawWrite(raw: RawClient, bytes: Buffer): void {
  raw.socket.write(bytes);
}

/** SHA-1 then base64, computed here so the handshake is checked against the RFC and not against itself. */
function acceptedFrom(text: string): string {
  return createHash("sha1").update(text).digest("base64");
}
