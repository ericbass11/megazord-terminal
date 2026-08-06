/**
 * The served document, and the Cockpit driven end to end.
 *
 * Two things are proven here that `view/client.test.ts` cannot prove on its own:
 *
 * 1. **The bytes the browser gets are the module the tests drive.** `clientScript()` is imported back
 *    through a `data:` URL and its answers are compared, function by function, against the module
 *    imported normally. Without that, "the client is typechecked TypeScript" would say nothing about
 *    what is actually inlined into the page.
 * 2. **Criteria 6 and 7 over the real server.** A real `missionStore` on a real temporary Workspace, a
 *    real `cockpitServer` on an ephemeral port, Node's own `WebSocket`, and the real engine deciding.
 *    The Gate answer and the Cap authorisation are built by the *client's* `answerFor` from the *client's*
 *    reading of the `mission` message the server sent, put on the wire, and the Mission is asserted to
 *    have resumed — on disk as well as in the answer.
 *
 * The process table is a recording fake, as it is in `server.test.ts`, and for the same reason: it
 * arrives at the server as a type, so nothing here spawns a process or leaves one behind. That a real
 * Pane streams and dies is `runtime/pane-manager.test.ts`'s proof.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_REPLAY,
  briefing,
  clause,
  clauseId,
  contract,
  core as coreOf,
  delegationId,
  gateId,
  instant,
  isOpened,
  missionId,
  moneyFromCents,
  moneyFromDecimal,
  orchestrationCapability,
  slice,
  stateOf,
  submit,
  zordId,
  type Delegate,
  type MissionCommand,
  type MissionId,
  type Replay,
} from "@engine/index";

import { missionStore } from "../runtime/mission-store";
import type { PaneId, PaneManager, PaneStatus } from "../runtime/pane-manager";

import { cockpitServer, type CockpitServer } from "./server";
import type { ToCockpit } from "./protocol";
import { SCREEN, UnservableViewError, clientScript, cockpitView, documentOf } from "./view";
import { STYLE, TOKENS } from "./view/style";
import * as client from "./view/client";

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const MISSION: MissionId = missionId("mission-e2e");
const GATE = gateId("gate-one");
const DELEGATION = delegationId("delegation-one");
const BASE = Date.parse("2026-08-06T12:00:00.000Z");

function at(minutes: number): ReturnType<typeof instant> {
  return instant(new Date(BASE + minutes * 60_000).toISOString());
}

function opening(cap: string): MissionCommand {
  return {
    kind: "open-mission",
    occurredAt: at(0),
    missionId: MISSION,
    briefing: briefing("Drive the Cockpit end to end"),
    mode: "combination",
    cap: moneyFromDecimal(cap),
    core: coreOf([orchestrationCapability("delegate")]),
  };
}

function delegating(): Delegate {
  return {
    kind: "delegate",
    occurredAt: at(1),
    delegationId: DELEGATION,
    zordId: zordId("zord-builder"),
    slice: slice("Draw the Pane grid"),
    harnessSources: { catalogDefault: { cli: "codex", model: "gpt", effort: "high", skills: [] } },
    contract: contract([
      clause({ id: clauseId("clause-one"), description: "the grid renders", required: true }),
    ]),
  };
}

const workspaces: string[] = [];
const started: CockpitServer[] = [];

function workspace(): string {
  const made = mkdtempSync(join(tmpdir(), "cockpit-view-"));
  workspaces.push(made);
  return made;
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  for (const made of workspaces.splice(0)) {
    rmSync(made, { recursive: true, force: true });
  }
});

/**
 * A recording process table. Forms no opinions: judging a gesture is the server's, and a fake with
 * rules of its own is a second rule set a test would start passing because of.
 */
function recordedPanes(): PaneManager & { says(paneId: PaneId, chunk: string): void } {
  const data: ((paneId: PaneId, chunk: string) => void)[] = [];
  return {
    spawn(): void {
      throw new Error("this envelope has no pane-spawn");
    },
    write(): void {
      return;
    },
    async kill(): Promise<void> {
      return;
    },
    onData(listen: (paneId: PaneId, chunk: string) => void): void {
      data.push(listen);
    },
    onStatus(_listen: (paneId: PaneId, status: PaneStatus) => void): void {
      return;
    },
    says(paneId: PaneId, chunk: string): void {
      for (const listen of data) {
        listen(paneId, chunk);
      }
    },
  };
}

/** A Cockpit serving the real view over a Workspace whose Replay is already `recorded`. */
async function cockpit(recorded: Replay): Promise<CockpitServer> {
  const store = missionStore({ workspace: workspace() });
  for (const entry of recorded) {
    if (entry.decision.kind === "accepted") {
      await store.append(MISSION, entry);
    }
  }
  const server = await cockpitServer({
    missionId: MISSION,
    store,
    panes: recordedPanes(),
    view: await cockpitView(),
  });
  started.push(server);
  return server;
}

/* -------------------------------------------------------------------------------------------------
 * A client on Node's own WebSocket
 * ---------------------------------------------------------------------------------------------- */

type Driven = {
  /** The browser's Cockpit, folded from real frames by the real client. */
  readonly cockpit: client.Cockpit;
  send(sent: unknown): void;
  /** The first message satisfying `wanted`, waiting for it to arrive. */
  next(wanted: (said: ToCockpit) => boolean): Promise<ToCockpit>;
};

async function driving(server: CockpitServer): Promise<Driven> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
  const said: ToCockpit[] = [];
  const held = client.cockpitOf(SCREEN.rows, SCREEN.cols, SCREEN.maxScrollback);

  socket.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data === "string") {
      const message = JSON.parse(data) as ToCockpit;
      said.push(message);
      // The real client's fold, over the real frame. Nothing between the socket and the view.
      client.fold(held, message);
    }
  });
  await new Promise<void>((open, failed) => {
    socket.addEventListener("open", () => open());
    socket.addEventListener("error", () => failed(new Error("the WebSocket did not open")));
  });

  return {
    cockpit: held,
    send(sent: unknown): void {
      socket.send(JSON.stringify(sent));
    },
    async next(wanted: (message: ToCockpit) => boolean): Promise<ToCockpit> {
      const gave = Date.now() + 5000;
      for (;;) {
        const found = said.find(wanted);
        if (found !== undefined) {
          return found;
        }
        if (Date.now() > gave) {
          throw new Error(`nothing matched. messages so far: ${JSON.stringify(said)}`);
        }
        await new Promise<void>((again) => setTimeout(again, 10));
      }
    },
  };
}

/** The client's answer to a click, or a failure that says which control was pressed. */
function clicking(
  action: string,
  values: Readonly<Record<string, string>>,
): Extract<client.Answer, { kind: "sends" }>["sent"] {
  const answer = client.answerFor(action, values, new Date(BASE + 600_000).toISOString());
  if (answer.kind !== "sends") {
    throw new Error(`${action} did not become a gesture: ${answer.detail}`);
  }
  return answer.sent;
}

/**
 * The lines of the served document that carry `construct` and are **not** comment lines.
 *
 * A comment line is one whose first non-blank character opens or continues a block comment, or opens a
 * line comment — which is every line of the client's doc comments, and nothing else in this document.
 * The answer carries the line numbers, so a failure names where to look instead of printing 1,600 lines
 * of HTML at somebody.
 */
async function codeLinesOfView(construct: string): Promise<readonly string[]> {
  const view = await cockpitView();
  return view
    .split("\n")
    .map((line, at) => ({ line, at: at + 1 }))
    .filter(({ line }) => line.includes(construct))
    .filter(({ line }) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*"));
    })
    .map(({ line, at }) => `${at}: ${line.trim()}`);
}

/* -------------------------------------------------------------------------------------------------
 * The document
 * ---------------------------------------------------------------------------------------------- */

describe("the one string the server serves", () => {
  it("is a whole HTML document with the element the Cockpit is drawn into", async () => {
    const view = await cockpitView();
    expect(view.startsWith("<!doctype html>")).toBe(true);
    expect(view).toContain(`<main id="cockpit"></main>`);
    expect(view).toContain("<noscript>");
    expect(view).toContain(`<script type="module">`);
    expect(view).toContain("<style>");
  });

  it("asks the browser for nothing: no CDN, no asset, no font, no second route", async () => {
    // `CLAUDE.md` records that this product builds and renders with no network. A CDN would break that
    // in the one place nobody looks, so the check is on the document rather than on anybody's intent.
    //
    // It is checked over the document's **code lines**, not its raw text, and that is the repo's own
    // lesson rather than a softening: the client's doc comment argues at length why
    // `<script src="https://…">` is ruled out, so a raw scan fails on the file that documents the rule
    // — exactly as a raw scan for `any` fails on the 29 doc comments in `engine/` that discuss it. Add
    // any of these on a line of code and this fires; keep writing prose about CDNs and it does not.
    for (const construct of [
      "<script src",
      "<link ",
      "<img ",
      "<iframe",
      "@import",
      "url(",
      "http://",
      "https://",
      "fetch(",
      "XMLHttpRequest",
      "importScripts",
    ]) {
      expect({ construct, on: await codeLinesOfView(construct) }).toEqual({ construct, on: [] });
    }
  });

  it("opens exactly one connection, and it is the page's own origin", async () => {
    const view = await cockpitView();
    expect(view.match(/new WebSocket\(/gu)?.length).toBe(1);
    expect(view).toContain(`new WebSocket(new URL("/", location.href)`);
  });

  it("carries no import statement, because the browser has nowhere to import from", async () => {
    const script = await clientScript();
    // Every import in `client.ts` is `import type`, so stripping leaves none at all. A runtime import
    // would be a request for a file the server has no route to serve.
    expect(script).not.toMatch(/^\s*import\s/mu);
    expect(script).not.toMatch(/\brequire\s*\(/u);
  });

  it("blanks the types rather than removing them, so a stack trace points at the source line", async () => {
    const source = readFileSync(fileURLToPath(new URL("./view/client.ts", import.meta.url)), "utf8");
    const script = await clientScript();
    expect(script.length).toBe(source.length);
    expect(script.split("\n").length).toBe(source.split("\n").length);
  });

  it("exports every name the bootstrap at the foot of the document calls", async () => {
    const script = await clientScript();
    for (const name of ["cockpitOf", "attach"]) {
      expect(script).toMatch(new RegExp(`export function ${name}\\b|export const ${name}\\b`, "u"));
    }
    const view = await cockpitView();
    expect(view).toContain("cockpitOf(");
    expect(view).toContain("attach(cockpit,");
  });

  it("refuses to compose a script that would end its own element early", () => {
    expect(() => documentOf(`const bad = "</script>";`)).toThrow(UnservableViewError);
    expect(() => documentOf(`const bad = "</SCRIPT >";`)).toThrow(UnservableViewError);
  });

  it("draws the Pane grid at the size the document says it does", async () => {
    const view = await cockpitView();
    expect(view).toContain(`cockpitOf(${SCREEN.rows}, ${SCREEN.cols}, ${SCREEN.maxScrollback})`);
  });
});

describe("the stylesheet reuses the site's palette rather than inventing one", () => {
  it("declares every token with the value app/globals.css declares", () => {
    const globals = readFileSync(
      fileURLToPath(new URL("../app/globals.css", import.meta.url)),
      "utf8",
    );
    expect(TOKENS.size).toBeGreaterThan(0);
    for (const [name, value] of TOKENS) {
      // The pin: if the site's palette moves and this copy does not, this test says so by name.
      expect(globals).toContain(`${name}: ${value};`);
      expect(STYLE).toContain(`${name}: ${value};`);
    }
  });

  it("uses the site's own mono stack and its caret animation", () => {
    expect(STYLE).toContain(`ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono"`);
    expect(STYLE).toContain("@keyframes blink");
    expect(STYLE).toContain(".caret");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The shipped bytes are the module the tests drive
 * ---------------------------------------------------------------------------------------------- */

describe("what the browser runs is what these tests drive", () => {
  /** The inlined script, imported back as a module. This is the code the page executes. */
  async function shipped(): Promise<typeof client> {
    const script = await clientScript();
    return (await import(
      `data:text/javascript,${encodeURIComponent(script)}`
    )) as unknown as typeof client;
  }

  it("exports exactly the names the module exports", async () => {
    const browser = await shipped();
    const here = Object.keys(client).sort();
    expect(Object.keys(browser).sort()).toEqual(here);
    expect(here.length).toBeGreaterThan(20);
  });

  it("answers a terminal stream identically", async () => {
    const browser = await shipped();
    const chunk = `plain \u001b[1;31mbold red\u001b[0m\r\nnext\ttab`;

    const mine = client.screenOf(6, 40, 20);
    const theirs = browser.screenOf(6, 40, 20);
    client.feed(mine, chunk);
    browser.feed(theirs, chunk);

    expect(browser.textOf(theirs)).toBe(client.textOf(mine));
    expect(browser.htmlOfScreen(theirs)).toBe(client.htmlOfScreen(mine));
  });

  it("answers money and keystrokes identically", async () => {
    const browser = await shipped();
    for (const cents of [0, 7, 4850, 123456]) {
      expect(browser.brl(cents)).toBe(client.brl(cents));
    }
    for (const typed of ["60,00", "48.5", "abc"]) {
      expect(browser.centsIn(typed)).toBe(client.centsIn(typed));
    }
    for (const key of ["Enter", "ArrowUp", "c", "F5"]) {
      expect(browser.keystrokesOf(key, key === "c", false)).toBe(
        client.keystrokesOf(key, key === "c", false),
      );
    }
  });

  it("builds the same Gate answer, byte for byte", async () => {
    const browser = await shipped();
    const values = { gateId: String(GATE) };
    const when = new Date(BASE).toISOString();
    expect(browser.answerFor("approve-gate", values, when)).toEqual(
      client.answerFor("approve-gate", values, when),
    );
    expect(browser.answerFor("authorise-cap", { amount: "30,00" }, when)).toEqual(
      client.answerFor("authorise-cap", { amount: "30,00" }, when),
    );
  });

  it("renders the same Cockpit", async () => {
    const browser = await shipped();
    const recorded = submit(submit(EMPTY_REPLAY, opening("50.00")), delegating());
    const state = stateOf(recorded);
    const message = { kind: "mission", state } as ToCockpit;

    const mine = client.cockpitOf(6, 40, 20);
    const theirs = browser.cockpitOf(6, 40, 20);
    client.fold(mine, message);
    browser.fold(theirs, message);

    expect(browser.renderCockpit(theirs)).toBe(client.renderCockpit(mine));
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 6, end to end
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 6, over the real server: a Gate halts the Mission and a human answer resumes it", () => {
  async function gateHalted(): Promise<Replay> {
    let recorded = submit(EMPTY_REPLAY, opening("50.00"));
    recorded = submit(recorded, delegating());
    return submit(recorded, {
      kind: "raise-gate",
      occurredAt: at(2),
      gateId: GATE,
      question: "The Contract is signed. Carry on?",
    });
  }

  it("halts, offers the answer, and resumes when the answer is sent", async () => {
    const server = await cockpit(await gateHalted());
    const driven = await driving(server);

    // The server sends where the Mission stands the moment a tab connects.
    await driven.next((said) => said.kind === "mission");
    expect(driven.cockpit.state?.status).toBe("halted");

    // The view offers the Gate, with the Gate's own question, read off the state the server sent.
    const offered = client.renderAnswers(driven.cockpit);
    expect(offered).toContain("A Gate is open");
    expect(offered).toContain("The Contract is signed. Carry on?");

    // The human approves. The gesture is the client's, and it goes out as a `submit`.
    driven.send(clicking("approve-gate", { gateId: String(GATE) }));

    const decided = await driven.next((said) => said.kind === "decided");
    if (decided.kind !== "decided") {
      throw new Error("unreachable");
    }
    expect(decided.entry.decision.kind).toBe("accepted");
    expect(decided.entry.command.kind).toBe("decide-gate");

    await driven.next((said) => said.kind === "mission" && said.state.status === "running");
    expect(driven.cockpit.state?.status).toBe("running");
    // And the answer offered a moment ago is gone, because nothing is waiting any more.
    expect(client.renderAnswers(driven.cockpit)).toBe("");
  });

  it("records the resumption on disk, so the Mission is resumed and not merely redrawn", async () => {
    const store = missionStore({ workspace: workspace() });
    for (const entry of await gateHalted()) {
      if (entry.decision.kind === "accepted") {
        await store.append(MISSION, entry);
      }
    }
    const server = await cockpitServer({
      missionId: MISSION,
      store,
      panes: recordedPanes(),
      view: await cockpitView(),
    });
    started.push(server);

    const driven = await driving(server);
    await driven.next((said) => said.kind === "mission");
    driven.send(clicking("approve-gate", { gateId: String(GATE) }));
    await driven.next((said) => said.kind === "decided");

    const onDisk = stateOf(await store.load(MISSION));
    expect(onDisk.status).toBe("running");
    if (!isOpened(onDisk)) {
      throw new Error("a resumed Mission is opened");
    }
    expect(onDisk.gates[0]?.decision).toEqual({ kind: "approved" });
  });

  it("shows the Refusal when the answer names a Gate that is not the open one", async () => {
    const server = await cockpit(await gateHalted());
    const driven = await driving(server);
    await driven.next((said) => said.kind === "mission");

    driven.send(clicking("approve-gate", { gateId: "gate-nobody-raised" }));
    const decided = await driven.next((said) => said.kind === "decided");
    if (decided.kind !== "decided") {
      throw new Error("unreachable");
    }
    expect(decided.entry.decision.kind).toBe("refused");

    // And the view draws it, with the reason and the violation the engine wrote.
    const html = client.renderRecord(driven.cockpit);
    expect(html).toContain(`class="entry refused"`);
    if (decided.entry.decision.kind !== "refused") {
      throw new Error("unreachable");
    }
    for (const violation of decided.entry.decision.refusal.violations) {
      expect(html).toContain(client.escapeHtml(violation));
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * Criterion 7, end to end
 * ---------------------------------------------------------------------------------------------- */

describe("criterion 7, over the real server: the Cap halts and nothing is commissioned until authorised", () => {
  function capHalted(): Replay {
    let recorded = submit(EMPTY_REPLAY, opening("10.00"));
    recorded = submit(recorded, delegating());
    return submit(recorded, {
      kind: "accrue-cost",
      occurredAt: at(3),
      delegationId: DELEGATION,
      cost: moneyFromCents(1000),
    });
  }

  it("halts at the Cap, refuses work, and commissions again once authorised", async () => {
    const server = await cockpit(capHalted());
    const driven = await driving(server);

    await driven.next((said) => said.kind === "mission");
    expect(driven.cockpit.state?.status).toBe("halted");
    expect(client.stoppedAtCap(driven.cockpit.state)).toBe(true);
    expect(driven.cockpit.meter?.reached).toBe(true);

    // The view offers the authorisation and says what has been spent.
    const offered = client.renderAnswers(driven.cockpit);
    expect(offered).toContain("The Cap has been reached");
    expect(offered).toContain("R$ 10,00");

    // Nothing is commissioned while it is stopped: a second Delegation is refused, `cap-reached`.
    const second: Delegate = {
      ...delegating(),
      occurredAt: at(4),
      delegationId: delegationId("delegation-two"),
    };
    driven.send({ kind: "submit", command: second });
    const refused = await driven.next(
      (said) => said.kind === "decided" && said.entry.command.kind === "delegate",
    );
    if (refused.kind !== "decided" || refused.entry.decision.kind !== "refused") {
      throw new Error("a Mission at its Cap refuses a Delegation");
    }
    expect(refused.entry.decision.refusal.reason).toBe("cap-reached");
    expect(client.renderRecord(driven.cockpit)).toContain("cap-reached");

    // The human authorises a higher Cap. The gesture is the client's.
    driven.send(clicking("authorise-cap", { amount: "30,00" }));
    const authorised = await driven.next(
      (said) => said.kind === "decided" && said.entry.command.kind === "authorise-cap",
    );
    if (authorised.kind !== "decided") {
      throw new Error("unreachable");
    }
    expect(authorised.entry.decision.kind).toBe("accepted");
    await driven.next((said) => said.kind === "mission" && said.state.status === "running");

    // And now the same Delegation is accepted.
    driven.send({ kind: "submit", command: { ...second, occurredAt: at(6) } });
    const commissioned = await driven.next(
      (said) =>
        said.kind === "decided" &&
        said.entry.command.kind === "delegate" &&
        said.entry.decision.kind === "accepted",
    );
    expect(commissioned.kind).toBe("decided");
    expect(client.renderAnswers(driven.cockpit)).toBe("");
  });

  it("shows the Refusal when the amount typed is not an amount, rather than judging it in the browser", async () => {
    const server = await cockpit(capHalted());
    const driven = await driving(server);
    await driven.next((said) => said.kind === "mission");

    driven.send(clicking("authorise-cap", { amount: "as much as it takes" }));
    const decided = await driven.next((said) => said.kind === "decided");
    if (decided.kind !== "decided" || decided.entry.decision.kind !== "refused") {
      throw new Error("an unreadable Cap is refused");
    }
    expect(decided.entry.decision.refusal.violations.join(" ")).toContain("whole BRL cents");
    expect(client.renderRecord(driven.cockpit)).toContain("whole BRL cents");
    // Still stopped, and still asking: a Refusal settles nothing.
    expect(client.renderAnswers(driven.cockpit)).toContain("The Cap has been reached");
  });
});

/* -------------------------------------------------------------------------------------------------
 * A Pane's stream, end to end
 * ---------------------------------------------------------------------------------------------- */

describe("a Pane's bytes reach the view", () => {
  it("streams what a process wrote onto that Pane's screen, and reads its provider off the Delegation", async () => {
    const store = missionStore({ workspace: workspace() });
    for (const entry of submit(submit(EMPTY_REPLAY, opening("50.00")), delegating())) {
      if (entry.decision.kind === "accepted") {
        await store.append(MISSION, entry);
      }
    }
    const panes = recordedPanes();
    const server = await cockpitServer({
      missionId: MISSION,
      store,
      panes,
      view: await cockpitView(),
    });
    started.push(server);

    const driven = await driving(server);
    await driven.next((said) => said.kind === "mission");

    panes.says(DELEGATION as unknown as PaneId, "\u001b[32mbuilding\u001b[0m\r\ndone");
    await driven.next((said) => said.kind === "pane-data");

    const pane = driven.cockpit.panes[0];
    if (pane === undefined) {
      throw new Error("a Pane opened when it spoke");
    }
    expect(client.textOf(pane.screen)).toBe("building\ndone");
    // The Pane is named after the Delegation, so the provider is that Delegation's resolved CLI.
    expect(client.providerFor(driven.cockpit.state, pane.paneId)).toBe("codex");
    expect(client.renderPane(driven.cockpit, pane)).toContain("codex");
  });
});
