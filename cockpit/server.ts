/**
 * The Cockpit's server: one static view over HTTP, one WebSocket carrying the envelope, and `submit` in
 * the middle of it.
 *
 * ```
 * GET  /            the view, one HTML document
 * GET  /  + Upgrade a WebSocket carrying FromCockpit in and ToCockpit out
 * ```
 *
 * ## The rule this file may not break
 *
 * A human gesture becomes a `MissionCommand` and goes through `submit`. Nothing here mutates a Mission,
 * nothing here decides anything, and a Refusal is sent back **verbatim** as the entry it is. The whole
 * of the Mission half of this module is nine lines — load the Replay, `submit`, append when the
 * Decision was accepted, hand the entry back — and every one of them is a composition of something the
 * engine already owns.
 *
 * A Refusal is therefore **not** an error path. It is an ordinary `{ kind: "decided", entry }`, exactly
 * like an acceptance, and the client tells them apart by reading `entry.decision.kind`. That is what
 * criterion 1 asks to be proven: a Command the engine refuses comes back as a Refusal, not as silence
 * and not as a generic failure.
 *
 * ## No Mission state, and the two things that are not Mission state
 *
 * The Mission is the Replay on disk. Every answer this server gives about it is `stateOf` of what the
 * store just handed over, re-loaded on every gesture — there is no cached Replay, no cached state, no
 * `Mission` field anywhere in this file. A second client that connects a moment later reads the same
 * file and derives the same state, which is the property `server.test.ts` proves with two clients and no
 * shared object between them.
 *
 * Two things are held, and neither is derivable, which is exactly why they are:
 *
 * - **The live process table**, and it is not even held here — it is handed in. See below.
 * - **The open connections**, so a Pane's bytes can reach whoever is watching. A socket cannot be
 *   folded out of a log.
 *
 * The MissionId is not state either: it is *which* Mission this Cockpit is looking at, chosen by
 * whoever started the server, the way a browser tab's URL is not the document's content.
 *
 * ## The process table is injected, and the server has no dependency
 *
 * `PaneManager` and `MissionStore` arrive as **types only**, so nothing in this module requires
 * `node-pty` or touches a disk on its own behalf. Three things follow, and the first is the reason:
 *
 * - **A Pane is a real process and this file owns none.** Spawning belongs to the control plane
 *   (`pane_spawn`, Task 7); this server delivers keystrokes to a Pane that exists and ends one that
 *   does. There is deliberately no `pane-spawn` in the envelope, because the techspec pins three
 *   members and a Cockpit that could fork a process from a browser gesture is a different security
 *   question than one that cannot.
 * - **The test drives it without spawning anything**, so criterion 1 is proven with no orphan process
 *   and no `/proc` dependence. That the process table really does kill a tree is Task 3's proof, which
 *   this file would only weaken by repeating.
 * - `node:http`, `node:crypto` and `node:stream` are the only imports besides the engine, the envelope
 *   and those two types. There is no WebSocket library — see the next section.
 *
 * Listeners are attached to the process table **once**, when the server is built, and never per
 * connection: the manager's contract has no way to remove one (its Gap 4), so a listener per client
 * would leak one per page load. It also means the server must be built **before** any Pane is spawned,
 * because nothing is buffered (the manager's Gap 1) and a chunk written before the server existed is
 * gone. `mz` builds the server first.
 *
 * ## How much of RFC 6455 is here, and what is not
 *
 * Hand-rolled, because a WebSocket is a handshake and a frame header and this repo's boundary rule is
 * that a dependency is a location decision: `runtime/` is where the world is allowed in, and a server
 * that only needs SHA-1 and byte arithmetic does not need to move the boundary to get them.
 *
 * **Implemented**: the `Sec-WebSocket-Key` / `Sec-WebSocket-Accept` handshake with the RFC's GUID and a
 * key that must decode to 16 bytes; version 13 only; masked client frames, unmasked server frames; all
 * three payload-length encodings in both directions; text frames; **fragmented** text (continuation
 * frames, with the reassembled message bounded); ping answered with a pong carrying the same payload;
 * pong ignored; close answered with a close and the socket ended; the reserved bits refused because no
 * extension was negotiated; control frames refused when fragmented or over 125 bytes.
 *
 * **Not implemented, and stated rather than discovered**:
 *
 * - **Extensions.** `permessage-deflate` is offered by every browser and by Node's own client; the
 *   handshake answers with no `Sec-WebSocket-Extensions` header, which per the RFC means it is not used,
 *   and a frame arriving with RSV1 set is refused `1002` instead of being silently mis-parsed.
 * - **Subprotocols.** `Sec-WebSocket-Protocol` is ignored and never echoed. There is one protocol here
 *   and it is this file's envelope.
 * - **Binary frames** are refused `1003`. The envelope is JSON text; a binary frame is a client that
 *   thinks it is talking to something else.
 * - **UTF-8 is not validated.** An invalid sequence in a text frame becomes U+FFFD and then almost
 *   certainly fails `JSON.parse`, so it is answered `1007` for being unreadable rather than `1007` for
 *   being invalid UTF-8. The code is the same; the reason names the wrong layer, and the alternative is
 *   a UTF-8 validator this server would be the only user of.
 * - **No ping is ever sent.** Nothing here detects a half-open connection, so a client whose network
 *   vanished stays in the table until the OS says otherwise. A Cockpit on loopback does not have that
 *   problem; whoever serves it over anything else adds a heartbeat.
 * - **No backpressure.** A Pane's bytes are written to every socket as they arrive and Node buffers
 *   what the kernel will not take. A Zord printing a megabyte a second into a paused socket grows that
 *   buffer without bound. The honest fix needs a policy — drop, coalesce, or disconnect — and a policy
 *   nobody has chosen is not a default this file gets to invent.
 * - **`Sec-WebSocket-Accept` is the whole of the security of the handshake**, which is to say none. See
 *   the next section.
 *
 * ## Who may connect
 *
 * The server binds **loopback only**, and there is no option to change it. A Cockpit can write
 * keystrokes into a live process; a server that could be bound to every interface would be a remote
 * shell one flag away, and the flag would eventually be set by a script somebody copied.
 *
 * A WebSocket is **not** subject to the same-origin policy: any page in any browser may open one to
 * `127.0.0.1`. So an upgrade is refused `403` unless its `Origin` is this server's own — or absent,
 * which is what a non-browser client sends, including Node's own `WebSocket`. That closes the
 * drive-by-web-page class, and it closes nothing else:
 *
 * **Declared Gap: there is no authentication.** Anything that can reach the port and speak the protocol
 * can type into a Pane. A token in the URL the view is served with is the obvious answer and it belongs
 * to whoever owns starting the server (`mz`, Task 8), because the token has to reach the view.
 *
 * ## The Close frame is the fault channel
 *
 * `ToCockpit` has four members and none of them is an error, which is the techspec's shape and is right:
 * a Refusal is data, and everything else that can go wrong here is a fault of the transport or a client
 * out of sync with the server. RFC 6455 already has a channel for that, so this server uses it rather
 * than widening the envelope:
 *
 * | code | what it means here |
 * | ---- | ------------------ |
 * | 1002 | the framing is wrong: unmasked, a reserved bit, a fragmented control frame, a continuation with nothing to continue |
 * | 1003 | a binary frame, on a protocol that carries text |
 * | 1007 | the text is not one of this envelope's gestures — `fromCockpitIn` said why |
 * | 1008 | a well-formed gesture named a Pane the process table does not hold: the client is out of sync |
 * | 1009 | a frame, or a reassembled message, over `maxMessageBytes` |
 * | 1011 | a well-formed gesture the server could not carry out: a corrupt Replay, a disk that refused, a tree that outlived `SIGKILL` |
 * | 1001 | the server is closing |
 *
 * Closing on a client's mistake costs that client its connection, which is the RFC's own answer once a
 * protocol is broken, and it is loud: reconnecting re-derives everything from the file. **Declared Gap:**
 * a per-gesture failure has no home in the envelope, so a `pane-kill` that times out takes the
 * connection down instead of reporting on it. The additive fix is a fifth `ToCockpit` member and it
 * changes a contract the techspec pins, so it belongs to whoever draws the view and finds out what a
 * human needs to see.
 *
 * ## Two gestures at once
 *
 * Every `submit` runs through one queue, in call order. Two clients submitting at the same moment would
 * otherwise both load the Replay, both `submit` against the same state, and the second append would
 * record an entry decided against a Mission that had already moved — the classic lost update, on the one
 * file that is the record. The queue is the same idiom `mission-store.ts` uses for its appends, and it
 * is ordering rather than state: nothing is remembered between turns.
 *
 * Two *processes* serving one Mission is not something this file can order, and one Cockpit per
 * Workspace is the assumption `mz` meets by construction.
 *
 * ## Declared Gaps
 *
 * 1. **One document, no assets.** `view` is served at `/` and `/index.html`, and everything else is 404.
 *    A view that needs `xterm.js` as a separate file needs a path to serve it from; that arrives with
 *    the view (Task 6), which is the first thing that has an asset. A map of paths sitting here today
 *    would be a field no rule fills.
 * 2. **No provider list.** `runtime/providers.ts` has no member in this envelope, because choosing a CLI
 *    happens where a Pane is spawned and that is the control plane's. Nothing here imports it.
 * 3. **The Cockpit is opened on one Mission.** Nothing checks that a `submit` carrying `open-mission`
 *    names the MissionId this server was opened on, so a client can open a Mission under another id into
 *    this Mission's file. That is the store's declared Gap ("nothing checks that the entries of
 *    `<id>.jsonl` are about the Mission that names the file") and Task 9's finding about `evolve`, seen
 *    from the third layer: refusing it here would be this server holding a rule, which is the one thing
 *    it may not do. Whoever wants it refused adds the rule to `decide`.
 * 4. **A `decided` entry goes to the client that asked, and a `mission` reading to everybody.** So a
 *    second client watching sees *that* the Mission moved and not *which* gesture moved it. Broadcasting
 *    `decided` too would be a one-line change and it is a decision about what a Cockpit shows, which is
 *    the view's.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import {
  isOpened,
  meterOf,
  stateOf,
  submit,
  type MissionCommand,
  type MissionId,
  type Replay,
} from "@engine/index";

// Type-only, both of them: this module requires no `node-pty` and opens no file. See the module doc.
import type { PaneId, PaneManager, PaneStatus } from "../runtime/pane-manager";
import type { MissionStore } from "../runtime/mission-store";

import { fromCockpitIn, textOf, type FromCockpit, type ToCockpit } from "./protocol";

/* -------------------------------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------------------------- */

/** Loopback, and not an option. A Cockpit types into live processes — see "Who may connect". */
const HOST = "127.0.0.1";

/** RFC 6455 §1.3. The magic string a `Sec-WebSocket-Key` is hashed with. */
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A `Sec-WebSocket-Key` is 16 random bytes, base64-encoded. */
const KEY_BYTES = 16;

/** The only version of the protocol this server speaks. */
const PROTOCOL_VERSION = "13";

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

/** The close codes this server uses. The table in the module doc says what each one means here. */
const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_UNACCEPTABLE = 1003;
const CLOSE_UNREADABLE = 1007;
const CLOSE_OUT_OF_SYNC = 1008;
const CLOSE_TOO_BIG = 1009;
const CLOSE_SERVER_FAULT = 1011;

/** A close reason travels in a frame of 125 bytes, two of which are the code. */
const MAX_CLOSE_REASON_BYTES = 123;

/** How long a closing socket has to acknowledge before it is destroyed, so `close` cannot hang. */
const CLOSE_GRACE_MS = 200;

/**
 * The largest frame, and the largest reassembled message, this server will read. Default 1 MiB.
 *
 * A gesture is a Command: a Briefing, a Slice, a Contract of a few Clauses. A megabyte is three orders
 * of magnitude more than any of them, and it is the bound that keeps an unbounded read from being an
 * out-of-memory failure — the same reason `maxOutputBytes` exists in the pty runner, and the same answer
 * when it is exceeded: refuse, never truncate.
 */
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

/* -------------------------------------------------------------------------------------------------
 * The contract
 * ---------------------------------------------------------------------------------------------- */

/** What a server is built with. Every collaborator is handed in; nothing has a hidden default. */
export type CockpitServerOptions = {
  /**
   * The Mission this Cockpit is opened on.
   *
   * Required: the envelope carries no MissionId, so this is what says which file a gesture is recorded
   * in. A Mission with no file yet is the ordinary case — it loads as the empty Replay, and the first
   * `open-mission` is what creates one.
   */
  readonly missionId: MissionId;
  /** Where the Replay lives. The Mission **is** this file; nothing about it is cached here. */
  readonly store: MissionStore;
  /**
   * The live process table.
   *
   * A type, so this module requires no `node-pty`, and injected rather than built here because a Pane's
   * lifetime is longer than a server's and spawning belongs to the control plane.
   */
  readonly panes: PaneManager;
  /**
   * The one document served at `/`.
   *
   * Required, and there is no built-in placeholder: a second view living inside the server is a view
   * that would eventually ship, competing with `cockpit/view/`. Whoever starts the server says what it
   * serves.
   */
  readonly view: string;
  /** The port to bind. **0 means an ephemeral one**, and `port` on the answer says which. Default 0. */
  readonly port?: number;
  /** The largest frame and the largest reassembled message. Default 1 MiB. */
  readonly maxMessageBytes?: number;
};

/** A running Cockpit server. */
export interface CockpitServer {
  /** The port actually bound — the real one, never the 0 that asked for it. */
  readonly port: number;
  /** Where the view is, ready to hand to a browser. */
  readonly url: string;
  /**
   * Closes every connection and stops listening.
   *
   * Resolves once nothing of this server is open: each client is sent a `1001`, given
   * `CLOSE_GRACE_MS` to acknowledge, and destroyed if it does not — so a client that never answers
   * cannot make this hang. Idempotent.
   */
  close(): Promise<void>;
}

/* -------------------------------------------------------------------------------------------------
 * The server
 * ---------------------------------------------------------------------------------------------- */

/** One open WebSocket. Everything here is transport; none of it is a Mission. */
type Connection = {
  readonly socket: Duplex;
  /** Bytes read but not yet a whole frame. A frame does not arrive aligned with a TCP segment. */
  pending: Buffer;
  /** The payloads of a fragmented text message, or `undefined` when none is in progress. */
  fragments: Buffer[] | undefined;
  /** How many bytes those fragments add up to, so the bound applies to the message and not the frame. */
  fragmented: number;
  /** Whether a close has already been sent, so a fault during a close does not send a second one. */
  closing: boolean;
};

/**
 * Starts the Cockpit: binds, serves the view, and carries the envelope.
 *
 * Asynchronous because the port is not known until the socket is bound, and reporting the port actually
 * bound is what lets a caller ask for 0 — which is what a test does, and what a second Cockpit on one
 * machine needs.
 */
export async function cockpitServer(options: CockpitServerOptions): Promise<CockpitServer> {
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const connections = new Set<Connection>();

  /** The one queue every `submit` passes through, in call order. See "Two gestures at once". */
  let tail: Promise<void> = Promise.resolve();

  function inTurn(work: () => Promise<void>): Promise<void> {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /* ---------------------------------------------------------------------------------------------
   * Sending
   * ------------------------------------------------------------------------------------------ */

  function sendTo(connection: Connection, said: ToCockpit): void {
    if (connection.closing) {
      return;
    }
    let text: string;
    try {
      text = textOf(said);
    } catch (cause) {
      // A message that cannot be JSON is this server's own bug, not the client's, and it must not be
      // absorbed: the client would otherwise wait forever for an answer nobody can phrase.
      shut(connection, CLOSE_SERVER_FAULT, messageOf(cause));
      return;
    }
    write(connection, frameOf(OPCODE_TEXT, Buffer.from(text, "utf8")));
  }

  function broadcast(said: ToCockpit): void {
    for (const connection of [...connections]) {
      sendTo(connection, said);
    }
  }

  function write(connection: Connection, frame: Buffer): void {
    try {
      connection.socket.write(frame);
    } catch {
      // The socket went away between the check and the write. Its `close` event is already on its way
      // and will take the connection out of the table; inventing a second failure here would race it.
    }
  }

  /**
   * Sends a close and ends the socket.
   *
   * Never throws, and never sends twice: a fault raised while closing — a write to a socket that has
   * already gone — must not start the sequence again.
   */
  function shut(connection: Connection, code: number, reason: string): void {
    if (connection.closing) {
      return;
    }
    connection.closing = true;
    write(connection, closeFrameOf(code, reason));
    try {
      connection.socket.end();
    } catch {
      // Already gone. Nothing left to end.
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * The Mission, which is the file
   * ------------------------------------------------------------------------------------------ */

  /**
   * Where the Mission stands, derived from a Replay and nothing else.
   *
   * The Meter is present exactly when the Mission has been opened — see `MissionReading` for why an
   * unopened Mission has no accounting rather than a zero one.
   */
  function readingOf(recorded: Replay): ToCockpit {
    const state = stateOf(recorded);
    return isOpened(state)
      ? { kind: "mission", state, meter: meterOf(state) }
      : { kind: "mission", state };
  }

  /**
   * One gesture, decided by the engine and recorded if it was accepted.
   *
   * The whole Mission half of this server. Every line is the engine's or the store's:
   *
   * 1. the Replay comes off the disk — no cache, so two clients cannot disagree about it;
   * 2. `submit` calls `decide` against `stateOf` of it, and appends the entry to the Replay it answers;
   * 3. an **accepted** Decision is appended to the file. A refused one is not, and that is not this
   *    server's choice to make either: `submit` records the Refusal in the Replay it returns, and what
   *    the file holds is what the Mission accepted. The Refusal still reaches the human, verbatim, as
   *    the entry below.
   * 4. the entry goes back whole — Command, Decision, Refusal and all.
   */
  async function record(connection: Connection, command: MissionCommand): Promise<void> {
    const recorded = await options.store.load(options.missionId);
    const next = submit(recorded, command);
    // `submit` appends exactly one entry and never throws, so the last one is this Command's. The
    // length is asserted in the test rather than assumed here.
    const entry = next[next.length - 1];

    if (entry.decision.kind === "accepted") {
      await options.store.append(options.missionId, entry);
    }

    sendTo(connection, { kind: "decided", entry });
    broadcast(readingOf(next));
  }

  /* ---------------------------------------------------------------------------------------------
   * Acting on a gesture
   * ------------------------------------------------------------------------------------------ */

  function act(connection: Connection, sent: FromCockpit): void {
    switch (sent.kind) {
      case "submit":
        void inTurn(() => record(connection, sent.command)).catch((cause: unknown) => {
          shut(connection, CLOSE_SERVER_FAULT, messageOf(cause));
        });
        return;
      case "pane-write":
        try {
          options.panes.write(sent.paneId, sent.keystrokes);
        } catch (cause) {
          shut(connection, codeFor(cause), messageOf(cause));
        }
        return;
      case "pane-kill":
        void options.panes.kill(sent.paneId).catch((cause: unknown) => {
          shut(connection, codeFor(cause), messageOf(cause));
        });
        return;
      default:
        // Add a member to `FromCockpit` without a branch here and this stops compiling: `exhausted`
        // takes `never`. It returns rather than throws, and the safe answer to a gesture nobody wrote
        // an action for is to say so and close.
        exhausted(sent);
        shut(connection, CLOSE_UNREADABLE, "this is not a gesture this server can act on");
        return;
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * Reading frames
   * ------------------------------------------------------------------------------------------ */

  function receive(connection: Connection, chunk: Buffer): void {
    connection.pending =
      connection.pending.length === 0 ? chunk : Buffer.concat([connection.pending, chunk]);

    for (;;) {
      if (connection.closing) {
        return;
      }
      const parsed = frameIn(connection.pending, maxMessageBytes);
      if (parsed.kind === "incomplete") {
        return;
      }
      if (parsed.kind === "fault") {
        shut(connection, parsed.code, parsed.reason);
        return;
      }
      connection.pending = parsed.rest;
      take(connection, parsed.frame);
    }
  }

  /** One frame, dispatched. Faults close the connection, which is what stops the loop above. */
  function take(connection: Connection, frame: Frame): void {
    switch (frame.opcode) {
      case OPCODE_PING:
        // The same payload back, which is what the RFC asks for and what a keepalive checks.
        write(connection, frameOf(OPCODE_PONG, frame.payload));
        return;

      case OPCODE_PONG:
        // Nothing here sends a ping, so nothing here is waiting for one. Ignored rather than refused:
        // a client is allowed to send an unsolicited pong.
        return;

      case OPCODE_CLOSE: {
        // The RFC's answer to a close is a close. The code is echoed when the client sent a readable
        // one, so a client that said 1000 hears 1000 and its own reason is not repeated back at it.
        const said = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : CLOSE_NORMAL;
        shut(connection, isSendableCode(said) ? said : CLOSE_NORMAL, "");
        return;
      }

      case OPCODE_BINARY:
        shut(connection, CLOSE_UNACCEPTABLE, "this protocol carries text frames only");
        return;

      case OPCODE_TEXT:
        if (connection.fragments !== undefined) {
          shut(
            connection,
            CLOSE_PROTOCOL_ERROR,
            "a text frame arrived in the middle of a fragmented message",
          );
          return;
        }
        if (frame.fin) {
          heard(connection, frame.payload.toString("utf8"));
          return;
        }
        connection.fragments = [frame.payload];
        connection.fragmented = frame.payload.length;
        return;

      case OPCODE_CONTINUATION: {
        const fragments = connection.fragments;
        if (fragments === undefined) {
          shut(connection, CLOSE_PROTOCOL_ERROR, "a continuation frame with nothing to continue");
          return;
        }
        const grown = connection.fragmented + frame.payload.length;
        if (grown > maxMessageBytes) {
          shut(
            connection,
            CLOSE_TOO_BIG,
            `a message of more than ${maxMessageBytes} bytes: refused rather than truncated`,
          );
          return;
        }
        fragments.push(frame.payload);
        connection.fragmented = grown;
        if (!frame.fin) {
          return;
        }
        const whole = Buffer.concat(fragments);
        connection.fragments = undefined;
        connection.fragmented = 0;
        heard(connection, whole.toString("utf8"));
        return;
      }

      default:
        shut(connection, CLOSE_PROTOCOL_ERROR, `opcode ${frame.opcode} is not part of this protocol`);
        return;
    }
  }

  /** One text message, read as an envelope. An unreadable one is a fault of the transport. */
  function heard(connection: Connection, text: string): void {
    const reading = fromCockpitIn(text);
    if (reading.kind === "unreadable") {
      shut(connection, CLOSE_UNREADABLE, reading.detail);
      return;
    }
    act(connection, reading.sent);
  }

  /* ---------------------------------------------------------------------------------------------
   * HTTP, and the upgrade
   * ------------------------------------------------------------------------------------------ */

  const http: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = pathOf(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      answer(response, 405, "text/plain; charset=utf-8", "this server answers GET and HEAD", request);
      return;
    }
    if (path !== "/" && path !== "/index.html") {
      answer(response, 404, "text/plain; charset=utf-8", `there is nothing at ${path}`, request);
      return;
    }
    answer(response, 200, "text/html; charset=utf-8", options.view, request);
  });

  http.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    const fault = handshakeFaultIn(request, port());
    if (fault !== undefined) {
      refuse(socket, fault);
      return;
    }
    // Checked by `handshakeFaultIn`, which is what makes the `?? ""` unreachable rather than a default
    // standing in for a missing value.
    const key = request.headers["sec-websocket-key"] ?? "";
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptOf(key)}\r\n` +
        "\r\n",
    );

    const connection: Connection = {
      socket,
      pending: Buffer.alloc(0),
      fragments: undefined,
      fragmented: 0,
      closing: false,
    };
    connections.add(connection);

    // `node:http` sets TCP_NODELAY on its sockets by default, which is what keeps a keystroke from
    // waiting for Nagle. Nothing to do here beyond not undoing it.
    socket.on("data", (chunk: Buffer) => {
      receive(connection, chunk);
    });
    socket.on("error", () => {
      // A reset connection is not a failure of anything: the `close` below is what cleans up.
      connection.closing = true;
    });
    socket.on("close", () => {
      connection.closing = true;
      connections.delete(connection);
    });

    // Where the Mission stands, before anything is asked. Read off the disk, which is what makes a
    // client that connects late see exactly what a client that was here all along sees.
    void options.store
      .load(options.missionId)
      .then((recorded) => {
        sendTo(connection, readingOf(recorded));
      })
      .catch((cause: unknown) => {
        shut(connection, CLOSE_SERVER_FAULT, messageOf(cause));
      });
  });

  /* ---------------------------------------------------------------------------------------------
   * The process table's two streams
   * ------------------------------------------------------------------------------------------ */

  // Attached once, before anything is spawned, and never removed — see the module doc.
  options.panes.onData((paneId: PaneId, chunk: string) => {
    broadcast({ kind: "pane-data", paneId, chunk });
  });
  options.panes.onStatus((paneId: PaneId, status: PaneStatus) => {
    broadcast({ kind: "pane-status", paneId, status });
  });

  /* ---------------------------------------------------------------------------------------------
   * Binding
   * ------------------------------------------------------------------------------------------ */

  await new Promise<void>((bound, failed) => {
    http.once("error", failed);
    http.listen(options.port ?? 0, HOST, () => {
      http.off("error", failed);
      bound();
    });
  });

  function port(): number {
    const address: string | AddressInfo | null = http.address();
    if (typeof address !== "object" || address === null) {
      // Only reachable after the server has stopped listening, which cannot happen between binding and
      // the answer below. Refused rather than defaulted to 0, which would report a port nobody bound.
      throw new Error(`this server is not listening on a port: ${shown(address)}`);
    }
    return address.port;
  }

  const bound = port();
  let closed: Promise<void> | undefined;

  return Object.freeze({
    port: bound,
    url: `http://${HOST}:${bound}/`,
    close(): Promise<void> {
      closed ??= (async (): Promise<void> => {
        await Promise.all(
          [...connections].map(
            (connection) =>
              new Promise<void>((gone) => {
                // Bounded, and the timer is **not** `unref`'d: this promise is what `close` awaits, and
                // an `unref`'d timer would let the process exit with a socket still open.
                const give = setTimeout(() => {
                  connection.socket.destroy();
                }, CLOSE_GRACE_MS);
                connection.socket.once("close", () => {
                  clearTimeout(give);
                  gone();
                });
                shut(connection, CLOSE_GOING_AWAY, "the Cockpit is closing");
              }),
          ),
        );

        // **After** the connections, so no new gesture can be queued behind this, and **before** the
        // socket stops listening, so an append that was already in flight reaches the disk. A `close`
        // that returned while an entry was mid-write would let a caller — `mz`, exiting — lose a
        // Decision the domain had already made, which is the one thing this whole layer exists to
        // record. The queue is bounded by whatever was already accepted, so this cannot hang on a
        // client.
        await tail;

        await new Promise<void>((stopped, failed) => {
          http.close((cause) => {
            if (cause === undefined || cause === null) {
              stopped();
              return;
            }
            failed(cause);
          });
        });
      })();
      return closed;
    },
  });
}

/* -------------------------------------------------------------------------------------------------
 * Internals: HTTP
 * ---------------------------------------------------------------------------------------------- */

/** The path of a request, without its query. `undefined` cannot happen on a served request; `/` if it does. */
function pathOf(url: string | undefined): string {
  if (typeof url !== "string" || url.length === 0) {
    return "/";
  }
  const at = url.indexOf("?");
  return at < 0 ? url : url.slice(0, at);
}

/** One answer. `no-store`, because the view changes whenever it is rebuilt and a stale one is a bug report. */
function answer(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  request: IncomingMessage,
): void {
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(bytes);
}

/**
 * Why this upgrade cannot be accepted, or `undefined` when it can.
 *
 * Every condition is the RFC's except the last, which is the one this server adds and the module doc
 * argues for: a WebSocket is not bound by the same-origin policy, so a page anywhere could otherwise
 * open one into a live process.
 */
function handshakeFaultIn(
  request: IncomingMessage,
  port: number,
): { readonly status: number; readonly reason: string } | undefined {
  if (request.method !== "GET") {
    return { status: 405, reason: "an upgrade is a GET" };
  }
  if (!(request.headers.connection ?? "").toLowerCase().includes("upgrade")) {
    return { status: 400, reason: "no Connection: Upgrade" };
  }
  if ((request.headers.upgrade ?? "").toLowerCase() !== "websocket") {
    return { status: 400, reason: "this server upgrades to websocket and nothing else" };
  }
  if (request.headers["sec-websocket-version"] !== PROTOCOL_VERSION) {
    return { status: 400, reason: `this server speaks version ${PROTOCOL_VERSION} only` };
  }

  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string" || Buffer.from(key, "base64").length !== KEY_BYTES) {
    return {
      status: 400,
      reason: `a Sec-WebSocket-Key is ${KEY_BYTES} bytes, base64-encoded`,
    };
  }

  const origin = request.headers.origin;
  if (origin !== undefined && !isOwnOrigin(origin, port)) {
    return {
      status: 403,
      reason: "a page on another origin may not open a WebSocket into this Cockpit",
    };
  }

  return undefined;
}

/**
 * Whether an `Origin` is this server's own.
 *
 * Both spellings of loopback, because a human types either into a browser and the two are the same
 * server. `https` is not accepted: nothing here serves TLS, so an `https` origin claiming this port is
 * a page that is not the view.
 */
function isOwnOrigin(origin: string, port: number): boolean {
  return origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`;
}

/** Refuses an upgrade with an ordinary HTTP answer, then ends the socket. */
function refuse(socket: Duplex, fault: { readonly status: number; readonly reason: string }): void {
  const body = Buffer.from(`${fault.reason}\n`, "utf8");
  try {
    socket.end(
      `HTTP/1.1 ${fault.status} ${fault.status === 403 ? "Forbidden" : "Bad Request"}\r\n` +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        `Content-Length: ${body.length}\r\n` +
        "Connection: close\r\n" +
        "\r\n" +
        body.toString("utf8"),
    );
  } catch {
    // The client hung up first. There is nobody to tell.
  }
}

/** RFC 6455 §4.2.2: the key, the GUID, SHA-1, base64. */
function acceptOf(key: string): string {
  return createHash("sha1").update(`${key}${HANDSHAKE_GUID}`).digest("base64");
}

/* -------------------------------------------------------------------------------------------------
 * Internals: frames
 * ---------------------------------------------------------------------------------------------- */

/** One frame off the wire, unmasked. */
type Frame = {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
};

/** What the front of a buffer turned out to be. */
type Parsed =
  | { readonly kind: "frame"; readonly frame: Frame; readonly rest: Buffer }
  | { readonly kind: "incomplete" }
  | { readonly kind: "fault"; readonly code: number; readonly reason: string };

const INCOMPLETE: Parsed = Object.freeze({ kind: "incomplete" });

/**
 * The first whole frame in a buffer, or why there is not one yet, or why there never will be.
 *
 * Three answers rather than an exception, because two of them are ordinary: a frame does not arrive
 * aligned with a TCP segment, so "not yet" is the common case, and a fault has to name a close code.
 *
 * The payload is **copied** out of the buffer before it is unmasked, so unmasking never writes into
 * bytes the caller still holds — the pending buffer may be a view over the same memory as the chunk the
 * socket handed over.
 */
function frameIn(buffer: Buffer, maxBytes: number): Parsed {
  if (buffer.length < 2) {
    return INCOMPLETE;
  }

  const first = buffer[0];
  const second = buffer[1];

  if ((first & 0x70) !== 0) {
    return {
      kind: "fault",
      code: CLOSE_PROTOCOL_ERROR,
      reason: "a reserved bit is set, and no extension was negotiated",
    };
  }
  if ((second & 0x80) === 0) {
    return {
      kind: "fault",
      code: CLOSE_PROTOCOL_ERROR,
      reason: "a frame from a client is masked",
    };
  }

  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const seventh = second & 0x7f;

  let at = 2;
  let length: number;
  if (seventh < 126) {
    length = seventh;
  } else if (seventh === 126) {
    if (buffer.length < 4) {
      return INCOMPLETE;
    }
    length = buffer.readUInt16BE(2);
    at = 4;
  } else {
    if (buffer.length < 10) {
      return INCOMPLETE;
    }
    const claimed = buffer.readBigUInt64BE(2);
    if (claimed > BigInt(maxBytes)) {
      return tooBig(maxBytes);
    }
    length = Number(claimed);
    at = 10;
  }

  if (length > maxBytes) {
    return tooBig(maxBytes);
  }
  if (opcode >= OPCODE_CLOSE && (!fin || length > 125)) {
    return {
      kind: "fault",
      code: CLOSE_PROTOCOL_ERROR,
      reason: "a control frame is never fragmented and never longer than 125 bytes",
    };
  }

  const ends = at + 4 + length;
  if (buffer.length < ends) {
    return INCOMPLETE;
  }

  const mask = buffer.subarray(at, at + 4);
  const payload = Buffer.from(buffer.subarray(at + 4, ends));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }

  return { kind: "frame", frame: { fin, opcode, payload }, rest: buffer.subarray(ends) };
}

function tooBig(maxBytes: number): Parsed {
  return {
    kind: "fault",
    code: CLOSE_TOO_BIG,
    reason: `a frame of more than ${maxBytes} bytes: refused rather than truncated`,
  };
}

/**
 * One frame, ready to write. Server frames are never masked, and one message is one frame.
 *
 * Fragmenting what this server sends would buy nothing: every message is known in full before it is
 * written, and the RFC allows a single unfragmented frame of any length.
 */
function frameOf(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

/**
 * A close frame: the code, then the reason, truncated to what a control frame can carry.
 *
 * Truncating **a reason** is not the truncation this repo refuses. The reason is prose for a human, it
 * is not the record — the record is the Replay — and the RFC's 125-byte control frame is a hard bound.
 * A close that could not be sent because its sentence was too long would replace a legible fault with
 * silence.
 */
function closeFrameOf(code: number, reason: string): Buffer {
  const said = withinBytes(reason, MAX_CLOSE_REASON_BYTES);
  const payload = Buffer.alloc(2 + said.length);
  payload.writeUInt16BE(code, 0);
  said.copy(payload, 2);
  return frameOf(OPCODE_CLOSE, payload);
}

/**
 * A string as at most `maxBytes` of UTF-8, cut between code points and never through one.
 *
 * Slicing the bytes would be one line and would leave a half-written code point at the end, which is
 * invalid UTF-8 — and a close reason must be valid UTF-8, so a client that validates (Node's own does)
 * would report a protocol error instead of showing the sentence. Cutting a sentence short is a cost; a
 * fault nobody can read is not.
 */
function withinBytes(text: string, maxBytes: number): Buffer {
  const whole = Buffer.from(text, "utf8");
  if (whole.length <= maxBytes) {
    return whole;
  }

  let kept = "";
  let bytes = 0;
  // Iterating a string yields code points rather than UTF-16 units, so a surrogate pair is never split.
  for (const point of text) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > maxBytes) {
      break;
    }
    kept += point;
    bytes += size;
  }
  return Buffer.from(kept, "utf8");
}

/**
 * Whether a code a client sent may be echoed back.
 *
 * 1005 and 1006 are reserved for "no code" and "abnormal" and must never appear in a frame, so a client
 * that sent one gets a plain 1000 rather than a frame this server would be wrong to write.
 */
function isSendableCode(code: number): boolean {
  if (code === 1005 || code === 1006 || code === 1015) {
    return false;
  }
  return (code >= 1000 && code <= 1014) || (code >= 3000 && code <= 4999);
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

/**
 * Which close code a thrown value deserves.
 *
 * Read off the error's `name` rather than with `instanceof`, and that is deliberate: importing
 * `UnknownPaneError` would make this module require `node-pty` at runtime, which is the whole point of
 * the process table arriving as a type. Every error class in this repository sets its own `name`, so the
 * name is part of the contract rather than an internal detail being sniffed.
 *
 * `UnknownPaneError` is the client out of sync — it drew a Pane the table does not hold — and everything
 * else is the server failing to carry out something well-formed.
 */
function codeFor(cause: unknown): number {
  if (cause instanceof Error && cause.name === "UnknownPaneError") {
    return CLOSE_OUT_OF_SYNC;
  }
  return CLOSE_SERVER_FAULT;
}

/**
 * Enforces exhaustiveness without throwing.
 *
 * The engine's own idiom, restated here because it is internal to `engine/domain`: a `never` parameter,
 * a `void` answer, and each caller returning its own safe value. A version that threw would trade a
 * compile-time guarantee for a crash in a server nobody is watching.
 */
function exhausted(value: never): void {
  void value;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How a rejected value reads inside a failure. Mirrors the engine, the pty runner and the store. */
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
