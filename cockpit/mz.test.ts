/**
 * `bin/mz.ts`, driven at its seams: how a call is read, how a control path names a Zord, and how the
 * stdio bridge frames what it carries. No Cockpit is started here and no process is forked — that is
 * `cockpit.e2e.test.ts`, and keeping the two apart is what makes this file fast enough to run on every
 * change.
 *
 * **Why a test of `bin/` lives in `cockpit/`.** `vitest.config.mts` collects `engine/**`, `runtime/**`,
 * `tools/**` and `cockpit/**`, and that file is not this task's to edit. A test nothing collects is not a
 * test, so it lives in the nearest collected directory and imports across — which is also true of the
 * subject: `bin/mz.ts` exists to compose `cockpit/` with `runtime/`, and the two files that prove it are
 * beside the layer it serves.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentRun } from "@engine/index";

import type { MissionWriter } from "../runtime/mission-writer";

import {
  CONTROL_URL_VARIABLE,
  MAX_FRAME_BYTES,
  UnmappedHarnessError,
  ZORD_VARIABLE,
  bridge,
  faultFrameFor,
  invocationIn,
  postingTo,
  refusingArguments,
  startCockpit,
  zordNameIn,
  type BridgeOptions,
  type CockpitOptions,
  type Invocation,
  type Io,
  type RunningCockpit,
} from "../bin/mz";

/* -------------------------------------------------------------------------------------------------
 * Reading a call
 * ---------------------------------------------------------------------------------------------- */

const NO_ENV: Readonly<Record<string, string | undefined>> = {};

describe("what an invocation means", () => {
  it("opens a Cockpit on a Workspace", () => {
    expect(invocationIn(["."], NO_ENV)).toEqual({
      kind: "cockpit",
      workspace: ".",
      missionId: undefined,
      port: undefined,
    });
  });

  it("takes the Mission and the port when they are given", () => {
    expect(invocationIn(["/work", "--mission", "m-2", "--port", "8080"], NO_ENV)).toEqual({
      kind: "cockpit",
      workspace: "/work",
      missionId: "m-2",
      port: 8080,
    });
  });

  it("says how it is used when it is called with nothing, or asked", () => {
    expect(invocationIn([], NO_ENV)).toEqual({ kind: "usage" });
    expect(invocationIn(["--help"], NO_ENV)).toEqual({ kind: "usage" });
    expect(invocationIn(["-h"], NO_ENV)).toEqual({ kind: "usage" });
  });

  it("bridges with the flags it was given", () => {
    expect(invocationIn(["mcp", "--zord", "scout", "--url", "http://127.0.0.1:1/mcp"], NO_ENV)).toEqual({
      kind: "bridge",
      url: "http://127.0.0.1:1/mcp",
      zordId: "scout",
    });
  });

  it("falls back to the environment a Cockpit gives its children", () => {
    const env = { [CONTROL_URL_VARIABLE]: "http://127.0.0.1:2/mcp", [ZORD_VARIABLE]: "builder" };

    expect(invocationIn(["mcp"], env)).toEqual({
      kind: "bridge",
      url: "http://127.0.0.1:2/mcp",
      zordId: "builder",
    });
    // A flag beats the environment, so one shell can host two Zords.
    expect(invocationIn(["mcp", "--zord", "scout"], env)).toEqual({
      kind: "bridge",
      url: "http://127.0.0.1:2/mcp",
      zordId: "scout",
    });
  });

  it("never invents a Zord, and says where one comes from", () => {
    const refused = invocationIn(["mcp", "--url", "http://127.0.0.1:3/mcp"], NO_ENV);

    expect(refused.kind).toBe("refused");
    expect(detailOf(refused)).toContain("--zord");
    expect(detailOf(refused)).toContain(ZORD_VARIABLE);
    // The reason, not just the remedy: a Fact carries who wrote it.
    expect(detailOf(refused)).toContain("a Fact carries who wrote it");
  });

  it("refuses a bridge with nowhere to post", () => {
    expect(detailOf(invocationIn(["mcp", "--zord", "scout"], NO_ENV))).toContain(CONTROL_URL_VARIABLE);
    expect(detailOf(invocationIn(["mcp", "--zord", "scout"], { [CONTROL_URL_VARIABLE]: "  " }))).toContain(
      CONTROL_URL_VARIABLE,
    );
  });

  it("refuses what it cannot read, rather than guessing at it", () => {
    expect(detailOf(invocationIn(["--port", "0"], NO_ENV))).toContain('starts with "--port"');
    expect(detailOf(invocationIn([".", "--nope", "1"], NO_ENV))).toContain('"--nope" is not one of');
    expect(detailOf(invocationIn([".", "--mission"], NO_ENV))).toContain("takes a value");
    expect(detailOf(invocationIn([".", "--port", "eighty"], NO_ENV))).toContain('"eighty"');
    expect(detailOf(invocationIn(["mcp", "--zord"], NO_ENV))).toContain("takes a value");
  });
});

function detailOf(invocation: Invocation): string {
  return invocation.kind === "refused" ? invocation.detail : `not a refusal: ${invocation.kind}`;
}

/* -------------------------------------------------------------------------------------------------
 * Which Zord a control path names
 * ---------------------------------------------------------------------------------------------- */

describe("the Zord a control path names", () => {
  it("is the one segment under the mount", () => {
    expect(zordNameIn("/scout")).toBe("scout");
    expect(zordNameIn("/a%20zord")).toBe("a zord");
    // Percent-encoding round-trips whatever a ZordId is, which is any non-blank string.
    expect(zordNameIn(`/${encodeURIComponent("a/b")}`)).toBe("a/b");
  });

  it("is nobody when the path names nobody", () => {
    // A POST to `/mcp` itself. Refused rather than answered under an invented Zord.
    expect(zordNameIn("")).toBeUndefined();
    expect(zordNameIn("/")).toBeUndefined();
    expect(zordNameIn("/scout/extra")).toBeUndefined();
    expect(zordNameIn("/%20%20")).toBeUndefined();
    expect(zordNameIn("/%")).toBeUndefined();
    expect(zordNameIn("scout")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------------------------------
 * The fault a bridge answers under
 * ---------------------------------------------------------------------------------------------- */

describe("a fault frame", () => {
  it("answers under the id the request used, whichever kind it is", () => {
    expect(JSON.parse(faultFrameFor('{"jsonrpc":"2.0","id":7,"method":"ping"}', -32603, "gone") ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32603, message: "gone" },
    });
    expect(
      JSON.parse(faultFrameFor('{"jsonrpc":"2.0","id":"a","method":"ping"}', -32603, "gone") ?? ""),
    ).toMatchObject({ id: "a" });
  });

  it("answers a notification with nothing at all, because JSON-RPC forbids answering one", () => {
    expect(faultFrameFor('{"jsonrpc":"2.0","method":"notifications/initialized"}', -32603, "gone")).toBeUndefined();
  });

  it("answers under a null id when the id cannot be read", () => {
    expect(JSON.parse(faultFrameFor("not json at all", -32603, "gone") ?? "")).toMatchObject({ id: null });
    expect(JSON.parse(faultFrameFor("[1,2]", -32603, "gone") ?? "")).toMatchObject({ id: null });
    expect(JSON.parse(faultFrameFor('{"jsonrpc":"2.0","id":{},"method":"ping"}', -32603, "gone") ?? "")).toMatchObject({
      id: null,
    });
  });
});

/* -------------------------------------------------------------------------------------------------
 * The stdio framing
 * ---------------------------------------------------------------------------------------------- */

/** What was written to the bridge's output, as the lines it framed. */
function collecting(): { readonly stream: Writable; lines(): readonly string[] } {
  let written = "";
  return {
    stream: new Writable({
      write(chunk: Buffer | string, _encoding, done) {
        written += String(chunk);
        done();
      },
    }),
    lines(): readonly string[] {
      return written.length === 0 ? [] : written.split("\n").slice(0, -1);
    },
  };
}

function bridging(
  chunks: readonly string[],
  send: BridgeOptions["send"],
  extra: Partial<BridgeOptions> = {},
): { readonly ran: Promise<void>; lines(): readonly string[]; reported(): readonly string[] } {
  const out = collecting();
  const reported: string[] = [];
  const ran = bridge({
    input: Readable.from(chunks),
    output: out.stream,
    send,
    report: (detail: string) => reported.push(detail),
    ...extra,
  });
  return {
    ran,
    lines: out.lines,
    reported: () => reported,
  };
}

const ECHOES: BridgeOptions["send"] = async (frame: string) =>
  JSON.stringify({ answered: JSON.parse(frame) as unknown });

describe("the stdio bridge", () => {
  it("answers one line per frame, and carries the answer through untouched", async () => {
    const run = bridging(['{"jsonrpc":"2.0","id":1,"method":"ping"}\n'], async () => '{"jsonrpc":"2.0","id":1,"result":{}}');

    await run.ran;

    expect(run.lines()).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
  });

  it("reads two frames out of one chunk, and one frame out of two chunks", async () => {
    const two = bridging(['{"id":1}\n{"id":2}\n'], ECHOES);
    await two.ran;
    expect(two.lines().map((line) => JSON.parse(line) as { answered: { id: number } })).toEqual([
      { answered: { id: 1 } },
      { answered: { id: 2 } },
    ]);

    const split = bridging(['{"id', '":3}\n'], ECHOES);
    await split.ran;
    expect(split.lines()).toEqual(['{"answered":{"id":3}}']);
  });

  it("answers a frame that arrived with no newline after it: the bytes are all there", async () => {
    const run = bridging(['{"id":4}'], ECHOES);

    await run.ran;

    expect(run.lines()).toEqual(['{"answered":{"id":4}}']);
  });

  it("ignores blank lines and a carriage return the client's pipe added", async () => {
    const run = bridging(['\n  \n{"id":5}\r\n'], ECHOES);

    await run.ran;

    expect(run.lines()).toEqual(['{"answered":{"id":5}}']);
  });

  it("writes nothing for a frame the control plane had nothing to say about", async () => {
    const run = bridging(['{"jsonrpc":"2.0","method":"notifications/initialized"}\n'], async () => undefined);

    await run.ran;

    expect(run.lines()).toEqual([]);
  });

  it("answers a POST that failed under the caller's own id, rather than going quiet", async () => {
    const run = bridging(['{"jsonrpc":"2.0","id":9,"method":"ping"}\n'], async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await run.ran;

    expect(JSON.parse(run.lines()[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32603, message: expect.stringContaining("connect ECONNREFUSED") as unknown as string },
    });
    // And a human hears about it on the channel that is not the protocol's.
    expect(run.reported()[0]).toContain("connect ECONNREFUSED");
  });

  it("says nothing on the wire when a failed POST carried a notification", async () => {
    const run = bridging(['{"jsonrpc":"2.0","method":"ping"}\n'], async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await run.ran;

    expect(run.lines()).toEqual([]);
    expect(run.reported()).toHaveLength(1);
  });

  it("refuses to write an answer carrying a newline, because it would frame as two", async () => {
    const run = bridging(['{"jsonrpc":"2.0","id":2,"method":"ping"}\n'], async () => '{"a":\n"b"}');

    await run.ran;

    // One line, and it is the fault — not the two lines the answer would have become.
    expect(run.lines()).toHaveLength(1);
    expect(JSON.parse(run.lines()[0] ?? "")).toMatchObject({
      id: 2,
      error: { message: expect.stringContaining("newline") as unknown as string },
    });
  });

  it("refuses a frame with no newline in sight, and stops rather than resynchronising on garbage", async () => {
    const huge = `{"id":1,"padding":"${"x".repeat(4_000)}"`;
    const run = bridging([huge, huge, '"}\n{"id":2}\n'], ECHOES, { maxFrameBytes: 5_000 });

    await run.ran;

    expect(run.lines()).toHaveLength(1);
    expect(JSON.parse(run.lines()[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: expect.stringContaining("refused rather than truncated") as unknown as string },
    });
    expect(run.reported()[0]).toContain("no newline in it");
  });

  it("answers frames as they resolve rather than in the order they arrived", async () => {
    // The reason concurrency is worth having: a `pane_read` must not wait behind an `agent_invoke` that
    // is running a model. The slow frame arrives first and is answered second.
    const run = bridging(['{"id":"slow"}\n{"id":"quick"}\n'], async (frame: string) => {
      const asked = JSON.parse(frame) as { id: string };
      if (asked.id === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return JSON.stringify({ id: asked.id });
    });

    await run.ran;

    expect(run.lines().map((line) => (JSON.parse(line) as { id: string }).id)).toEqual(["quick", "slow"]);
  });

  it("bounds a frame at a megabyte unless told otherwise", () => {
    expect(MAX_FRAME_BYTES).toBe(1024 * 1024);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Posting one frame
 * ---------------------------------------------------------------------------------------------- */

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((stopped) => {
          server.closeAllConnections();
          server.close(() => stopped());
        }),
    ),
  );
});

/** A stand-in for the mount: whatever it is told to answer, and the bodies it was given. */
async function standIn(answer: (body: string) => { status: number; body: string }): Promise<{
  readonly url: string;
  readonly bodies: string[];
  readonly headers: IncomingMessage["headers"][];
}> {
  const bodies: string[] = [];
  const headers: IncomingMessage["headers"][] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      bodies.push(body);
      headers.push(request.headers);
      const said = answer(body);
      response.writeHead(said.status, { "Content-Type": "application/json" });
      response.end(said.body);
    });
  });
  servers.push(server);

  await new Promise<void>((bound) => {
    server.listen(0, "127.0.0.1", () => bound());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return { url: `http://127.0.0.1:${port}/mcp/scout`, bodies, headers };
}

describe("posting one frame", () => {
  it("sends the frame as JSON and answers what came back", async () => {
    const mount = await standIn(() => ({ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}' }));

    const answered = await postingTo(mount.url)('{"jsonrpc":"2.0","id":1,"method":"ping"}');

    expect(answered).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
    expect(mount.bodies).toEqual(['{"jsonrpc":"2.0","id":1,"method":"ping"}']);
    expect(mount.headers[0]?.["content-type"]).toBe("application/json");
  });

  it("answers nothing for a 202, which is what a notification gets", async () => {
    const mount = await standIn(() => ({ status: 202, body: "" }));

    expect(await postingTo(mount.url)('{"jsonrpc":"2.0","method":"ping"}')).toBeUndefined();
  });

  it("throws on a transport fault, carrying the status and what the server said", async () => {
    const mount = await standIn(() => ({ status: 415, body: "a control frame is application/json" }));

    const failed = postingTo(mount.url)("{}");

    await expect(failed).rejects.toThrow("answered 415: a control frame is application/json");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The mapping nobody wrote
 * ---------------------------------------------------------------------------------------------- */

describe("an argument mapping nobody wrote", () => {
  it("refuses at the moment it would have guessed, naming the CLI", () => {
    const asked = { harness: { cli: "claude", model: "opus", effort: "high", skills: [] }, instruction: "go" };

    expect(() => refusingArguments(asked as AgentRun)).toThrow(UnmappedHarnessError);
    expect(() => refusingArguments(asked as AgentRun)).toThrow('"claude"');
    // The reason travels with the refusal: this is about the Replay, not about laziness.
    expect(() => refusingArguments(asked as AgentRun)).toThrow("the Replay wrong");
  });

  it("still names something when the Harness names nothing", () => {
    expect(() => refusingArguments({ instruction: "go" } as unknown as AgentRun)).toThrow('"a Zord"');
  });
});

/* -------------------------------------------------------------------------------------------------
 * What the types refuse
 * ---------------------------------------------------------------------------------------------- */

describe("what the types refuse", () => {
  it("takes no Cockpit with no argument mapping, because nobody may stay silent about it", () => {
    // @ts-expect-error `argumentsFor` is required: a default would run a Zord under a bundle the
    // `Delegated` fact says it ran with, which is the one thing the Replay must never be wrong about.
    // The directive sits on the declaration because a *missing* property is reported there, not on the
    // properties that are present.
    const options: CockpitOptions = {
      workspace: "/work",
      missionId: "m" as CockpitOptions["missionId"],
      port: 0,
    };

    expect(options.workspace).toBe("/work");
  });

  it("hands back the one door and no store, no process table and no control plane", () => {
    const reading = (cockpit: RunningCockpit): unknown =>
      // @ts-expect-error `RunningCockpit` carries no `store`. A store would let a caller load a Replay,
      // decide against it and append the entry — the read-modify-write BUG-1 was, one layer out. What it
      // hands back instead is the `writer`, whose `record` is that whole gesture as one atom.
      cockpit.store;

    const appending = (cockpit: RunningCockpit): unknown =>
      // @ts-expect-error and the door has no `append` either, which is what makes it a door.
      cockpit.writer.append;

    expect([typeof reading, typeof appending]).toEqual(["function", "function"]);
  });

  it("hands the door to a caller that drives a Combination, which is what it is on the answer for", () => {
    // `mz .` does not start a drive (Gap 1), so a caller with a recipe composes `startCockpit` with
    // `drive` — and the only thing it could otherwise build is a second store over the same Workspace,
    // which is two queues and the lost update back. `cockpit/cockpit.e2e.test.ts` is that caller, and
    // criterion 5 drives through this field.
    const driving = (cockpit: RunningCockpit): MissionWriter => cockpit.writer;

    expect(typeof driving).toBe("function");
  });

  it("asks for the bridge's input as a function, so a Cockpit never creates a stdin", () => {
    const io: Io = {
      out: process.stdout,
      err: process.stderr,
      // @ts-expect-error `input` is a function. A stream here would be created by every mode, including
      // the one that never reads a frame.
      input: process.stdin,
    };

    expect(io.out).toBe(process.stdout);
  });

  it("names a Workspace on a Cockpit call and a URL on a bridge, and never both", () => {
    const asked: Invocation = { kind: "bridge", url: "http://127.0.0.1:1/mcp", zordId: "scout" };
    if (asked.kind !== "bridge") {
      throw new Error("unreachable: it was just written down as one");
    }

    // @ts-expect-error a bridge has no Workspace. The two modes are one union and nothing carries both.
    expect(asked.workspace).toBeUndefined();
  });

  it("starts a Cockpit as a Promise of one, which is what makes the port knowable", () => {
    // An annotation rather than a directive: assignability is what is being claimed, and no
    // `@ts-expect-error` can phrase it. Falsifying it — narrowing the return type — fails the build.
    const starting: (options: CockpitOptions) => Promise<RunningCockpit> = startCockpit;

    expect(typeof starting).toBe("function");
  });
});
