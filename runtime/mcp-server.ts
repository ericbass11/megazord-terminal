/**
 * The control plane: the surface through which a Zord running inside a Pane acts on the Cockpit itself.
 *
 * Eight tools, pinned by the PRD (scope 7, criterion 9):
 *
 * ```
 * pane_spawn      open a Pane and fork a process in it
 * pane_write      deliver keystrokes to a Pane
 * pane_read       what a Pane has written, bounded
 * handoff_submit  answer a Delegation with a Handoff — ADR 0010
 * mission_create  open this Mission
 * memory_write    record a Fact in the Workspace's Cortex
 * memory_read     read the Cortex, narrowed
 * agent_invoke    run the Zord of a Delegation and accrue what it cost
 * ```
 *
 * Those eight strings are **wire names** and they are spelled exactly as the PRD spells them. Two of them
 * carry words `CONTEXT.md` lists under `_Avoid_` — `agent` for **Zord**, `memory` for **Cortex** — which is
 * why they only ever appear as string literals. Every identifier in this file uses the glossary's word:
 * `writeFact`, `readFacts`, `invokeZord`, `ZordId`, `Handoff`, `Pane`, `Delegation`.
 *
 * ## JSON-RPC, hand-rolled, with no dependency
 *
 * MCP is JSON-RPC 2.0 and this module implements it directly. Three reasons, checked rather than assumed:
 *
 * - **It is the established answer here.** `cockpit/server.ts` speaks RFC 6455 over `node:http` and
 *   `node:crypto` with no dependency, and argues that a dependency is a *location* decision. A framing
 *   this small does not move the boundary.
 * - **The surface is small and fully specified.** `initialize`, the `notifications/initialized`
 *   notification, `tools/list`, `tools/call` — plus `ping`, see below. That is the whole of what a tool
 *   server has to answer.
 * - **This is the most expensive place in the repository to be wrong about somebody else's behaviour.**
 *   `pane_spawn` forks a process and `handoff_submit` writes to a Mission's record. An unaudited framework
 *   between a Zord and `paneManager.spawn` decides, on our behalf, what a model's arguments mean.
 *
 * `ping` is the fifth method and it is a deliberate addition to the four: a conformant client that pings
 * and is answered `-32601` concludes the connection is dead and closes it, so refusing it would cost
 * interoperability and buy nothing.
 *
 * ## The protocol is here; the transport is not, and that is Task 9's
 *
 * `handle(frame)` answers one JSON-RPC frame and knows nothing about where it came from. There is no
 * `node:process` in this file, no stdio loop, no `node:http`, no socket. **The two transports live in
 * Task 9** (`bin/mz.ts`): the stdio framing a CLI-hosted MCP server needs, and the mount on the Cockpit's
 * own port. Do not go looking for either here — their absence is what lets criterion 9 be proven by
 * feeding strings to a function, with no process, no port and no client library in the way.
 *
 * The split also means the handshake is **not** enforced as an order: `tools/call` is answered whether or
 * not `initialize` arrived first. Enforcing it would be state that changes what a tool does, and a
 * transport that reconnects — which the Cockpit mount will — would have to re-handshake against a control
 * plane whose lifetime is a Zord's, not a connection's.
 *
 * ## `handle` never throws and never rejects
 *
 * The same contract `decide` and `evolve` hold, for the same reason: every argument that reaches this
 * module was written by a language model running in a subprocess. A frame that is not JSON, a frame that
 * is not a request, a method that does not exist, a tool that does not exist, arguments of the wrong
 * shape, a collaborator that threw, a `now` that answered nonsense — each has a defined answer, and none
 * of them escapes. A control plane that could reject would take its transport down with it, and the
 * transport is the only thing a Zord can talk through.
 *
 * ## Two channels, and the line between them is where the fault was read
 *
 * MCP separates a **protocol error** (a JSON-RPC `error` member) from a **tool result that reports
 * failure** (`isError: true`). The line drawn here is mechanical, so a reader can verify it by looking at
 * where the `try` sits:
 *
 * - **`-32602`, a protocol error, is exactly "the arguments do not match `inputSchema`".** That is what
 *   *this* module reads for itself: the tool's name, the presence of each required argument, its declared
 *   type, and the absence of any argument the schema does not declare.
 * - **Everything a collaborator refused is a tool result with `isError: true`**, carrying the
 *   collaborator's own error name and message. `PaneSpawnError` for a Pane already open, `InvalidFactError`
 *   for a blank subject, `InvalidHandoffError` for a Clause claimed twice, a disk that refused, a runner
 *   that failed.
 *
 * The second half is what keeps one rule in one place. This module does **not** re-check that a subject is
 * non-blank, that a `cli` names something, or that a Cap is whole cents: `cortexStore.write`,
 * `paneManager.spawn` and `moneyFromCents` each own their invariant and each says so better than a copy
 * here would. A second statement of a rule is a second place for it to drift, with this one having the
 * last word because it is what a call passes through — the argument `mission-store.ts` and
 * `cockpit/protocol.ts` both make, applied to a third layer.
 *
 * It is also why the schemas declare **types and nothing else**. A `minLength: 1` on `subject` would be
 * this module promising a rule the Cortex owns. The one exception is `mode`, which has no constructor in
 * `engine/` — `decide` copies it verbatim — so its `enum` is declared here and enforced here, because
 * there is no collaborator to relay.
 *
 * **The schema is the validator.** `checkAgainst` walks the declared `inputSchema` and is the only thing
 * that reads an argument's type, so a schema and its enforcement cannot drift: a client that obeys
 * `tools/list` is accepted by construction. `additionalProperties: false` is enforced too, and that is
 * load-bearing rather than tidy — see the next section.
 *
 * ## What a Zord may not say: identity, time, and where a process runs
 *
 * Four values a Command or a Fact needs are **options of this control plane, never arguments**, and each
 * one is refused as an argument by `additionalProperties: false` rather than being silently ignored. A
 * Zord that passes `zordId` and is not told it was dropped believes it attributed a Fact to somebody else.
 *
 * - **`zordId`.** A Fact is "attributed to the Zord that wrote it", and `CLAUDE.md` records that a Surface
 *   must not invent one — an unfalsifiable claim sitting in the Workspace's shared memory forever is worse
 *   than not being able to write one. Taken off the wire it would be worse still: a Zord could attribute
 *   its Facts to a colleague. So a control plane **speaks for one Zord**, whose id is configuration, and
 *   the honest option is the only representable one. `memory_read` may still *filter* by `zordId`, and the
 *   asymmetry is the point: reading what somebody else recorded is what a shared Cortex is for; claiming
 *   to be them is not.
 * - **`missionId`.** One control plane acts on one Mission, exactly as one Cockpit is opened on one. There
 *   is no argument for it, so `mission_create` cannot open a Mission under another id into this Mission's
 *   file — the store's declared Gap ("nothing checks that the entries of `<id>.jsonl` are about the Mission
 *   that names the file") is closed here by the field not existing, rather than by a rule this layer
 *   invented.
 * - **`occurredAt` / `recordedAt`.** Time enters the domain on a Command, and there is no clock in
 *   `engine/` or in either store. A timestamp off the wire is a claim no rule can check, written into the
 *   Replay and the Cortex forever, and a model will happily produce one. So `now` is a **required injected
 *   function**: whoever builds the control plane writes down where time comes from, a test hands it a
 *   fixed clock, and this module reads no clock of its own. A `now` that answers something that is not an
 *   Instant is this host's bug, not the caller's, so it is `-32603` rather than a tool error.
 * - **`cwd`.** A Pane opened here runs in `workspace` and nowhere else. A directory chosen by text a model
 *   wrote is one grade worse than the substituted default `pty-agent-runner.ts` records for `spawn("")`:
 *   not a missing value quietly replaced, but a chosen one. There is deliberately no subdirectory
 *   argument — that needs path containment nobody has written, and it is a declared Gap below.
 *
 * ## `pane_read` keeps a bounded ring, because it is the reader the process table was waiting for
 *
 * `PaneManager.onData` is a live stream and buffers nothing for a late listener, and its Gap 1 says why
 * and where the fix belongs: *"the control plane's `pane_read` needs a scrollback, and a scrollback needs
 * a bound nobody has chosen — so the buffer arrives with its first reader, rather than sitting here as a
 * field no rule fills."* This is that first reader, so the buffer is here and not a second process table.
 *
 * - `maxPaneBytes` is **required and has no default**, because it is half of what `pane_read` answers and
 *   a default would be this module choosing invisibly how much of a Zord's work is forgotten.
 * - Eviction is **oldest first, whole chunks**. A chunk is what the terminal delivered in one write and
 *   `node-pty` decodes it, so a chunk boundary never splits a code point; slicing bytes would. The exact
 *   bound this buys is stated rather than rounded: the buffer holds at most `maxPaneBytes` plus the newest
 *   chunk, because the newest chunk is never evicted — dropping the bytes a reader most wants in order to
 *   honour a bound to the byte is the wrong trade.
 * - **`dropped` is always in the answer**, in bytes, cumulative since the Pane was first seen. A truncated
 *   answer nothing can detect is the failure this repository refuses everywhere it scans or reads: over-
 *   report, never under-report.
 * - A PaneId this control plane holds no record of is a **tool error**, not an empty reading. Answering
 *   `output: ""` would tell a Zord that a Pane wrote nothing when the truth is that there is no such Pane —
 *   the substituted default again, in a reading.
 *
 * There is no cursor and no tail argument: `pane_read` is a snapshot of a bounded window, and a Zord that
 * needs the stream is watching the Pane in the Cockpit.
 *
 * ## The Mission half is the Cockpit's, with one difference and one divergence
 *
 * `handoff_submit`, `mission_create` and the accrual `agent_invoke` makes all take the same path
 * `cockpit/server.ts` takes, and now literally the same code: `MissionWriter.record` — load the Replay off
 * the disk, `submit`, append — and answer the entry **verbatim**.
 * No state is held: the Mission is the file, and every gesture re-folds it. A Refusal is **data** — it
 * comes back as the entry it is, with its violations, and `isError` stays `false`, because the tool did
 * what it was asked and the domain answered. That loop — refused, told what broke, submit again — is
 * criterion 3 of the Mission Engine PRD and ADR 0010's stated consequence.
 *
 * **The difference:** this module *builds* the Command, which the server never does — a gesture arrives
 * there already shaped. Building a value object means using its constructor, so `handoff()`, `gap()`,
 * `briefing()`, `moneyFromCents()` and `core()` run here, and their violations are tool errors. The cost
 * is stated as a finding: a Handoff so malformed that `handoff()` refuses it leaves **no** entry in the
 * Replay, while one that merely breaks its Contract leaves a refused one. An unbuildable Handoff never
 * became an intent; a Contract-violating one did.
 *
 * **The divergence this module declared, and how it ended:** it appends **every** entry, refused as well
 * as accepted, and `cockpit/server.ts` shipped appending only accepted ones. The glossary is not ambiguous
 * — a Replay is "every Command it was given and what the domain answered, the accepted Events **and the
 * Refusals alike**" — `mission-store.ts` designs `load` around refused entries being in the file, and
 * `refusedIn` is a reader the engine ships that a persisted Replay could otherwise never satisfy. Folded
 * state is identical either way, because `eventsOf` skips a refused Decision; what changes is whether the
 * audit surface survives being written down. The Gap was declared rather than quietly matched, `server.ts`
 * was corrected, and both now take the same path — one that neither of them writes any more, because
 * `MissionWriter.record` is where those three steps live.
 *
 * ## `agent_invoke` is smaller than it looks, and the reason is the Core
 *
 * It does **not** delegate. Delegating is the Core's own act — `decide` refuses a `delegate` from a Core
 * with no `delegate` capability, and a Zord is not the Core — and a `Delegated` fact carries a Harness
 * that `decide` resolved. So the Delegation must **already exist**, and that is structural rather than a
 * rule invented here: the resolved Harness lives on the recorded Delegation, and without one there is
 * nothing to run.
 *
 * What it does: fold the Replay, find the Delegation, take the Harness **off the fact** (never re-resolve
 * — ADR 0005), hand it to the injected `AgentRunner` with the caller's instruction, and submit one
 * `accrue-cost` for what the run reported. Recording the accrual is what keeps the Meter from being blind
 * to work that really happened; the real runner reports `ZERO_MONEY`, which means "no price source exists"
 * and is recorded as such rather than skipped, because a run that cost nothing measurable still happened.
 *
 * The Harness is read as `unknown` before it is handed over. It came off a disk file the store
 * deliberately does not judge, and a runner is an implementation of a port: `ptyAgentRunner` guards its
 * own `cli`, `fakeAgentRunner` reads `asked.harness.cli` in an error message and would throw on a Harness
 * that is not there. The threat model is the file, not the runner.
 *
 * It composes **no Handoff**. What a Zord wrote is text and this module judges none of it — ADR 0010 — so
 * the invoking Zord reads the output and calls `handoff_submit` itself. And the `instruction` is an
 * argument rather than something built from the Slice, for the same reason: writing the prose a Zord is
 * given is a judgement about text.
 *
 * ## Declared Gaps
 *
 * 1. **No tool reads the Mission.** The eight are pinned, and none of them answers "where does this
 *    Mission stand". A Zord calling `agent_invoke` must already know its DelegationId; a human reads the
 *    Cockpit. The additive fix is a ninth tool and it changes a list the PRD pins.
 * 2. **One control plane per Zord, over a shared process table, buffers every Pane once per Zord.**
 *    `onData` is global and `PaneManager` has no way to remove a listener (its Gap 4), so N Zords means N
 *    listeners and N rings over the same Panes, and none of them can be detached. The shape that fixes it
 *    is a single shared scrollback — which is where the process table's own Gap 1 says a buffer belongs
 *    once it has more than one reader — and inventing a second process table here is exactly what this
 *    task was told not to do.
 * 3. **A Pane opened before this control plane existed is invisible to it.** Nothing is buffered for a
 *    late listener, so `pane_read` and `pane_write` answer a tool error for it. Build the control plane
 *    before spawning, which is what the Cockpit server already does for the same reason.
 4. **Two *stores* over one Workspace are still not ordered.** ~~Two writers on one Mission file are not
 *    ordered~~ — that was this module's Gap and it is **closed**: `load → submit → append` is one atom in
 *    `runtime/mission-writer.ts`, and the Cockpit's server, every control plane and every drive over a
 *    Workspace share one writer. What is left is what no module in one process can see: a second
 *    `missionStore` over the same directory, or a second process. One Cockpit per Workspace is the
 *    assumption `mz` meets by construction.
 * 5. **A Pane runs in the Workspace root, never a subdirectory.** Accepting a relative path needs
 *    containment logic — resolve, compare, refuse an escape — and a containment check that is subtly wrong
 *    is worse than not offering the field.
 * 6. **A failed run accrues nothing.** `AgentRunFailedError` carries no cost, by the pty runner's own
 *    decision ("a failed run may well have spent money and this module has no way to know how much"), so a
 *    Mission can spend money on a run that failed and the Meter will not show it. Inherited, not
 *    introduced.
 * 7. **`agent_invoke` does not check that a Delegation is still open.** Running a Zord for a Delegation
 *    that was already answered spends money on settled work, and `submit-handoff` refuses the Handoff
 *    afterwards. Refusing it *here* would be a Mission rule living outside `decide`, which is the one thing
 *    this layer may not have.
 * 8. **No `outputSchema` and no `structuredContent`.** Every answer is one text block of JSON. The
 *    2025-06-18 structured-result surface is additive and needs a schema per tool that nothing yet reads.
 * 9. **No batching and no pagination.** MCP 2025-06-18 removed JSON-RPC batches, so an array frame is
 *    refused; eight tools fit in one `tools/list`, so there is no `nextCursor`.
 */

import {
  MODES,
  ORCHESTRATION_CAPABILITY_NAMES,
  briefing as briefingOf,
  centsOf,
  core as coreOf,
  gap as gapOf,
  handoff as handoffOf,
  isOpened,
  moneyFromCents,
  orchestrationCapability,
  stateOf,
  type AgentRunner,
  type ClauseId,
  type DelegationId,
  type Delegation,
  type Gap,
  type Handoff,
  type Harness,
  type Instant,
  type MissionCommand,
  type MissionId,
  type Mode,
  type OrchestrationCapabilityName,
  type ReplayEntry,
  type ZordId,
} from "@engine/index";

// Type-only: this module requires no `node-pty`, so it loads on a machine with no native toolchain.
import type { PaneId, PaneManager, PaneStatus } from "./pane-manager";
import type { MissionWriter } from "./mission-writer";
// `subjectsIn` is the one value imported from a sibling, because tallying subjects a second way here
// would be the second derivation BUG-3 was fixed into having none of.
import { subjectsIn, type CortexStore, type Fact } from "./cortex-store";

/* -------------------------------------------------------------------------------------------------
 * The protocol's constants
 * ---------------------------------------------------------------------------------------------- */

/**
 * The MCP revision this control plane speaks.
 *
 * Pinned as a string and asserted by a test, so the day a client refuses it something says so here rather
 * than in a log nobody reads. A client that asks for another revision is answered with this one, which is
 * what the specification prescribes: the client then decides whether it can live with it.
 */
export const PROTOCOL_VERSION = "2025-06-18";

/** How this control plane names itself in the handshake. */
export const SERVER_NAME = "megazord-control-plane";

/**
 * Its version.
 *
 * A constant, not read from `package.json`: this module opens no file. It can therefore drift from the
 * package's own version, which is a stated cost rather than a hidden one — nothing reads it but a client's
 * diagnostics.
 */
export const SERVER_VERSION = "0.1.0";

/** JSON-RPC 2.0 §5.1. The four this module uses, and no others. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/* -------------------------------------------------------------------------------------------------
 * The tools
 * ---------------------------------------------------------------------------------------------- */

/**
 * The eight wire names, in the order the PRD lists them.
 *
 * Strings, and only strings: `agent` and `memory` are `_Avoid_` terms and this is the boundary they are
 * allowed to cross, because they are somebody else's protocol's vocabulary rather than a name this
 * repository gives a concept.
 */
const TOOL_NAMES = [
  "pane_spawn",
  "pane_write",
  "pane_read",
  "handoff_submit",
  "mission_create",
  "memory_write",
  "memory_read",
  "agent_invoke",
] as const;

/** One of the eight. A name that is not one of them is refused before anything happens. */
export type ToolName = (typeof TOOL_NAMES)[number];

/** One declared property of a tool's arguments. The union `checkAgainst` walks. */
export type ToolProperty =
  | {
      readonly type: "string";
      readonly description: string;
      /** The permitted values, when this module owns the rule. See "the one exception is `mode`". */
      readonly enum?: readonly string[];
    }
  | { readonly type: "number"; readonly description: string }
  | { readonly type: "array"; readonly description: string; readonly items: ToolProperty }
  | {
      readonly type: "object";
      readonly description: string;
      readonly properties: Readonly<Record<string, ToolProperty>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
    };

/**
 * A tool's arguments, as JSON Schema.
 *
 * `additionalProperties` is `false` and the type says so, because it is enforced: an argument the schema
 * does not declare is refused rather than dropped, which is what stops a Zord from believing it passed a
 * `zordId`.
 */
export type ToolSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

/** One tool, exactly as `tools/list` answers it. */
export type ToolDescriptor = {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: ToolSchema;
};

function text(description: string): ToolProperty {
  return { type: "string", description };
}

function listOf(items: ToolProperty, description: string): ToolProperty {
  return { type: "array", description, items };
}

const GAP_PROPERTY: ToolProperty = {
  type: "object",
  description: "One Clause this Handoff declares it did not cover, and why.",
  properties: {
    clauseId: text("The Clause this Gap is about. A Gap that names none excuses every optional Clause."),
    reason: text("Why it was not covered."),
  },
  required: ["clauseId", "reason"],
  additionalProperties: false,
};

/**
 * The eight, with the schema that is also their validator.
 *
 * Every description says what the tool does and, where it matters, what it deliberately does not take —
 * a model reads these, and "there is no cwd" is cheaper to state here than to discover through a refusal.
 */
export const TOOLS: readonly ToolDescriptor[] = Object.freeze([
  {
    name: "pane_spawn",
    description:
      "Open a Pane and fork a process in it. The Pane runs in this Workspace; there is no directory " +
      "argument. Answers the PaneId and the Pane's first status.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: text("The id to open the Pane under. Refused if a Pane already holds it."),
        cli: text("The program to run."),
        argv: listOf(text("One argument."), "Its argument vector. Required: [] means no arguments."),
      },
      required: ["paneId", "cli", "argv"],
      additionalProperties: false,
    },
  },
  {
    name: "pane_write",
    description:
      "Deliver keystrokes to a Pane, exactly as a human typing into it would. A Pane whose process " +
      "already exited ignores them; the status in the answer is how that is visible.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: text("The Pane to type into."),
        keystrokes: text("What to type. Blank is a real answer."),
      },
      required: ["paneId", "keystrokes"],
      additionalProperties: false,
    },
  },
  {
    name: "pane_read",
    description:
      "What a Pane has written, up to a bound. Answers the output kept, how many bytes were evicted " +
      "as the bound was reached, and the Pane's last status.",
    inputSchema: {
      type: "object",
      properties: { paneId: text("The Pane to read.") },
      required: ["paneId"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_submit",
    description:
      "Answer a Delegation with a Handoff. The Handoff is judged against the Contract recorded on that " +
      "Delegation; a Refusal comes back with every violation, and the Delegation stays open so it can be " +
      "submitted again.",
    inputSchema: {
      type: "object",
      properties: {
        delegationId: text("The Delegation this Handoff answers."),
        satisfies: listOf(text("A ClauseId."), "The Clauses this Handoff claims to have covered."),
        gaps: listOf(GAP_PROPERTY, "What it declares it did not cover, one entry per Clause."),
        artifacts: listOf(text("A path, id or reference."), "What proves the work exists."),
      },
      required: ["delegationId", "satisfies", "gaps", "artifacts"],
      additionalProperties: false,
    },
  },
  {
    name: "mission_create",
    description:
      "Open the Mission this control plane is on. There is no id argument: it opens that Mission or " +
      "none. A Mission is opened once, and a second attempt comes back refused.",
    inputSchema: {
      type: "object",
      properties: {
        briefing: text("The expected outcome. States the end, not the steps."),
        mode: {
          type: "string",
          description: "Who leads the Mission and how much autonomy exists.",
          enum: MODES,
        },
        capCents: {
          type: "number",
          description: "The spending limit, in whole BRL cents. 5000 is R$ 50,00.",
        },
        capabilities: listOf(
          text("An orchestration capability."),
          `What the Core of this Mission may do. One of: ${ORCHESTRATION_CAPABILITY_NAMES.join(", ")}. ` +
            "A Core holds no executing capability.",
        ),
      },
      required: ["briefing", "mode", "capCents", "capabilities"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_write",
    description:
      "Record a Fact in this Workspace's Cortex. It is attributed to this Zord and to this Mission; " +
      "neither is an argument. Answers the Fact as recorded, with its subject normalised.",
    inputSchema: {
      type: "object",
      properties: {
        subject: text("The key it is found by. Trimmed, lower-cased, inner whitespace collapsed."),
        body: text("What is known. Stored verbatim."),
      },
      required: ["subject", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_read",
    description:
      "Read this Workspace's Cortex. Every filter given must hold; give none to read all of it. Answers " +
      "the Facts, the subjects they fall under, and every line of the Cortex that cannot be read.",
    inputSchema: {
      type: "object",
      properties: {
        subject: text("Only Facts under this subject."),
        missionId: text("Only Facts from this Mission. Any Mission of this Workspace."),
        zordId: text("Only Facts written by this Zord. Any Zord of this Workspace."),
        limit: { type: "number", description: "At most this many, the most recent, in record order." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "agent_invoke",
    description:
      "Run the Zord of a Delegation this Mission already made, with the Harness that Delegation " +
      "recorded, and accrue what the run cost. Answers what the Zord wrote; turning that into a Handoff " +
      "is the caller's, through handoff_submit.",
    inputSchema: {
      type: "object",
      properties: {
        delegationId: text("The Delegation to run. It must already exist in this Mission."),
        instruction: text("What the Zord is being asked to do."),
      },
      required: ["delegationId", "instruction"],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ToolDescriptor[]);

/* -------------------------------------------------------------------------------------------------
 * The contract
 * ---------------------------------------------------------------------------------------------- */

/** What a control plane is built with. Every collaborator is handed in; nothing has a hidden default. */
export type ControlPlaneOptions = {
  /** The Mission every Command this control plane builds is recorded against. */
  readonly missionId: MissionId;
  /**
   * The Zord this control plane speaks for.
   *
   * Required, and never an argument: a Fact carries who wrote it, and a Zord must not be able to say it
   * was somebody else. See "What a Zord may not say".
   */
  readonly zordId: ZordId;
  /**
   * The Workspace root. Every Pane opened here runs in it.
   *
   * Required, and never defaulted to `process.cwd()`, for the reason both stores state: a Zord runs
   * inside a Workspace, not wherever the process that hosts it happened to start.
   */
  readonly workspace: string;
  /**
   * The one door to the Mission's file. The Mission is that file, and nothing about it is cached here.
   *
   * A writer rather than a store: `record` is `load → submit → append` as one atom, shared with the
   * Cockpit's server, every other control plane and any drive over the same Workspace. Before it, each
   * control plane held a queue of its own, which ordered a Zord against itself and against nobody else —
   * BUG-1, argued in full in `runtime/mission-writer.ts`.
   */
  readonly writer: MissionWriter;
  /** The live process table. A type only, so this module requires no `node-pty`. */
  readonly panes: PaneManager;
  /** The Workspace's Cortex. */
  readonly cortex: CortexStore;
  /**
   * What runs a Zord.
   *
   * Injected rather than built here: the real one needs `node-pty` and a Harness-to-flags mapping nobody
   * can write once for every CLI, and the fake is what makes `agent_invoke` provable with no CLI installed.
   */
  readonly runner: AgentRunner;
  /**
   * Where time comes from.
   *
   * Required, with no default and no clock read inside this module. Time enters the domain on a Command
   * and nothing in `engine/` reads a clock; a timestamp taken off the wire would be a claim no rule can
   * check. A caller writes `() => instantFromDate(new Date())`; a test hands over a fixed sequence.
   */
  readonly now: () => Instant;
  /**
   * How much of each Pane's output is kept for `pane_read`.
   *
   * Required, because it is half of what `pane_read` answers. The oldest whole chunks are evicted first
   * and what was evicted is always reported; the newest chunk is never evicted, so the buffer holds at
   * most this many bytes plus one chunk.
   */
  readonly maxPaneBytes: number;
};

/** The embedded control plane: one JSON-RPC frame in, one answer out. */
export interface ControlPlane {
  /**
   * Answers one JSON-RPC frame.
   *
   * `undefined` when the frame was a notification, which has no reply — including a notification this
   * control plane does not recognise, because JSON-RPC forbids answering one at all.
   *
   * Never throws and never rejects. See the module doc.
   */
  handle(frame: string): Promise<string | undefined>;
  /** The eight tools, exactly as `tools/list` answers them. Frozen. */
  readonly tools: readonly ToolDescriptor[];
}

/* -------------------------------------------------------------------------------------------------
 * What a Pane wrote
 * ---------------------------------------------------------------------------------------------- */

/** One Pane's bounded ring, and the last status it announced. Nothing here is shared between Panes. */
type PaneRecord = {
  /** The chunks still held, oldest first. Evicted whole, so a code point is never split. */
  readonly chunks: string[];
  /** How many bytes those chunks add up to. */
  bytes: number;
  /** How many bytes were evicted since this Pane was first seen. Always reported. */
  dropped: number;
  /** The last status announced, or `undefined` when none was — openness is the absence of an answer. */
  status: PaneStatus | undefined;
};

/* -------------------------------------------------------------------------------------------------
 * The control plane
 * ---------------------------------------------------------------------------------------------- */

/**
 * Builds a control plane over one Mission, for one Zord.
 *
 * It attaches its two listeners to the process table **immediately**, because nothing is buffered for a
 * late listener: a Pane opened before this call is invisible to `pane_read` for the rest of the session.
 */
export function controlPlane(options: ControlPlaneOptions): ControlPlane {
  const records = new Map<string, PaneRecord>();

  /** The record of a Pane, created on the first thing ever heard about it. */
  function recordFor(pane: PaneId): PaneRecord {
    const key = keyOf(pane);
    const held = records.get(key);
    if (held !== undefined) {
      return held;
    }
    const made: PaneRecord = { chunks: [], bytes: 0, dropped: 0, status: undefined };
    records.set(key, made);
    return made;
  }

  /**
   * The record of a Pane this control plane has heard something about, or a refusal.
   *
   * Answering an empty reading for a Pane that does not exist would tell a Zord that a Pane wrote
   * nothing, which is the substituted default `pty-agent-runner.ts` records as the silent and permanent
   * kind of lie. Creating a record on demand — which `recordFor` does, because a chunk may arrive before
   * anything asks — would do exactly that, so the two readers are separate functions.
   */
  function knownPane(pane: PaneId): PaneRecord {
    const key = keyOf(pane);
    const held = records.get(key);
    if (held === undefined) {
      throw new ToolFailure(
        "UnknownPaneError",
        `this control plane holds no record of a Pane called ${JSON.stringify(key)}: either it was ` +
          `never opened, or it was opened before this control plane existed and nothing is buffered ` +
          `for a late listener`,
      );
    }
    return held;
  }

  options.panes.onData((pane: PaneId, chunk: string) => {
    const record = recordFor(pane);
    record.chunks.push(chunk);
    record.bytes += Buffer.byteLength(chunk, "utf8");
    // The newest chunk is never evicted: honouring the bound to the byte by dropping the bytes a reader
    // most wants is the wrong trade, and the overshoot it costs is stated in the module doc.
    while (record.chunks.length > 1 && record.bytes > options.maxPaneBytes) {
      const oldest = record.chunks.shift() ?? "";
      const size = Buffer.byteLength(oldest, "utf8");
      record.bytes -= size;
      record.dropped += size;
    }
  });

  options.panes.onStatus((pane: PaneId, status: PaneStatus) => {
    recordFor(pane).status = status;
  });

  /* ---------------------------------------------------------------------------------------------
   * The Mission, which is the file
   * ------------------------------------------------------------------------------------------ */

  /**
   * One Command, decided by the engine and recorded.
   *
   * Every line is the engine's or the writer's: the Replay comes off the disk with no cache, `submit`
   * decides against `stateOf` of it, and the entry is appended — **accepted or refused**, for the reason
   * the module doc argues at length. The entry goes back whole.
   *
   * There is no queue here any more. `MissionWriter.record` holds those three steps as one atom for every
   * writer of the Workspace, and a second queue in front of it would order this control plane against
   * itself twice while ordering it against nobody else — which is exactly the shape BUG-1 had.
   */
  async function record(command: MissionCommand): Promise<ReplayEntry> {
    const { entry } = await options.writer.record(options.missionId, command);
    return entry;
  }

  /** The Delegation this Mission recorded under an id, or `undefined`. Folded, never cached. */
  async function delegationUnder(id: DelegationId): Promise<Delegation | undefined> {
    const state = stateOf(await options.writer.load(options.missionId));
    if (!isOpened(state)) {
      return undefined;
    }
    return state.delegations.find((made) => made.id === id);
  }

  /* ---------------------------------------------------------------------------------------------
   * The eight
   * ------------------------------------------------------------------------------------------ */

  async function spawnPane(given: Arguments): Promise<unknown> {
    const pane = textIn(given, "paneId") as PaneId;
    // Handed over as they arrived. `paneManager.spawn` reads every one of them as `unknown` and refuses a
    // blank `cli`, a blank `cwd`, an id already open and a non-string in `argv` **before it forks** — so
    // re-checking their values here would be a second place for one rule, and the fork is already guarded.
    options.panes.spawn({
      paneId: pane,
      cli: textIn(given, "cli"),
      argv: textListIn(given, "argv"),
      cwd: options.workspace,
    });
    const record = recordFor(pane);
    return withStatus({ paneId: pane }, record);
  }

  async function writeToPane(given: Arguments): Promise<unknown> {
    const pane = textIn(given, "paneId") as PaneId;
    knownPane(pane);
    options.panes.write(pane, textIn(given, "keystrokes"));
    return withStatus({ paneId: pane }, recordFor(pane));
  }

  async function readPane(given: Arguments): Promise<unknown> {
    const pane = textIn(given, "paneId") as PaneId;
    const record = knownPane(pane);
    const output = record.chunks.join("");
    return withStatus(
      {
        paneId: pane,
        output,
        bytes: record.bytes,
        // Always present, never conditional: a reader that has to notice a missing field to learn it lost
        // something has not been told.
        dropped: record.dropped,
      },
      record,
    );
  }

  async function submitHandoff(given: Arguments): Promise<unknown> {
    const submitted: Handoff = handoffOf({
      delegationId: textIn(given, "delegationId") as DelegationId,
      satisfies: textListIn(given, "satisfies") as readonly ClauseId[],
      gaps: gapsIn(given),
      artifacts: textListIn(given, "artifacts"),
    });

    const entry = await record({
      kind: "submit-handoff",
      occurredAt: instantNow(options.now),
      handoff: submitted,
    });
    return { entry };
  }

  async function createMission(given: Arguments): Promise<unknown> {
    const entry = await record({
      kind: "open-mission",
      occurredAt: instantNow(options.now),
      // Never an argument: this control plane opens the Mission it is on, or none.
      missionId: options.missionId,
      briefing: briefingOf(textIn(given, "briefing")),
      // The one value this module checks for itself, because `engine/` has no `mode()` to relay: `decide`
      // copies the Mode verbatim. Declared as an `enum` in the schema, so the check and the claim agree.
      mode: textIn(given, "mode") as Mode,
      cap: moneyFromCents(numberIn(given, "capCents")),
      // The cast hands an unchecked name to the one function that checks it. `orchestrationCapability`
      // is a constructor and nothing more — the rule lives in `core()`, whose `assertNoExecution` reads
      // every name as `unknown` and refuses both an executing capability and a name in no registry at
      // all. So a Zord cannot grant the Core a tool it may not hold, and the refusal says which name.
      core: coreOf(
        textListIn(given, "capabilities").map((named) =>
          orchestrationCapability(named as OrchestrationCapabilityName),
        ),
      ),
    });
    return { entry };
  }

  async function writeFact(given: Arguments): Promise<unknown> {
    const written = await options.cortex.write({
      recordedAt: instantNow(options.now),
      missionId: options.missionId,
      zordId: options.zordId,
      subject: textIn(given, "subject"),
      body: textIn(given, "body"),
    });
    return { fact: written };
  }

  async function readFacts(given: Arguments): Promise<unknown> {
    const reading = await options.cortex.read({
      ...optionalText(given, "subject", (value) => ({ subject: value })),
      ...optionalText(given, "missionId", (value) => ({ missionId: value as MissionId })),
      ...optionalText(given, "zordId", (value) => ({ zordId: value as ZordId })),
      ...optionalNumber(given, "limit", (value) => ({ limit: value })),
    });

    return {
      facts: reading.facts,
      // Derived from what is being answered, with the engine's own reader, so the tally can never disagree
      // with the Facts beside it. It travels here because the eight tools are pinned and there is no
      // `memory_subjects` for the navigation the Cortex was built to support.
      subjects: subjectsIn(reading),
      // The damage is in the answer, exactly as `CortexStore.read` puts it there.
      unreadable: reading.unreadable,
    };
  }

  async function invokeZord(given: Arguments): Promise<unknown> {
    const id = textIn(given, "delegationId") as DelegationId;
    const instruction = textIn(given, "instruction");

    const delegation = await delegationUnder(id);
    if (delegation === undefined) {
      throw new ToolFailure(
        "UnknownDelegationError",
        `Delegation ${JSON.stringify(id)} was never made in this Mission, so there is no Harness to ` +
          `run it with. A Delegation is made by the Core, and this control plane does not make one.`,
      );
    }

    // The Harness came off a Replay the store deliberately does not judge, and a runner is an
    // implementation of a port: the fake reads `asked.harness.cli` and the real one forks with it. Read as
    // `unknown` before anything is handed over.
    const held: unknown = delegation.harness;
    if (typeof held !== "object" || held === null) {
      throw new ToolFailure(
        "UnrunnableHarnessError",
        `the Delegation ${JSON.stringify(id)} recorded carries ${shown(held)} where its Harness should be`,
      );
    }
    if (!("cli" in held) || typeof held.cli !== "string" || held.cli.trim().length === 0) {
      throw new ToolFailure(
        "UnrunnableHarnessError",
        `the Harness recorded on Delegation ${JSON.stringify(id)} names no cli`,
      );
    }

    // Outside the queue: a run is wall-clock work and holding the Mission's turn open for it would stop
    // every other gesture. Only the accrual below is ordered.
    const report = await options.runner.run({ harness: held as Harness, instruction });

    const entry = await record({
      kind: "accrue-cost",
      occurredAt: instantNow(options.now),
      delegationId: id,
      cost: report.cost,
    });

    return {
      // What the Zord wrote, untouched — terminal artifacts and all. Judging it is nobody's here.
      output: report.output,
      costCents: centsOf(report.cost),
      entry,
    };
  }

  /* ---------------------------------------------------------------------------------------------
   * Dispatch
   * ------------------------------------------------------------------------------------------ */

  const running: Readonly<Record<ToolName, (given: Arguments) => Promise<unknown>>> = {
    pane_spawn: spawnPane,
    pane_write: writeToPane,
    pane_read: readPane,
    handoff_submit: submitHandoff,
    mission_create: createMission,
    memory_write: writeFact,
    memory_read: readFacts,
    agent_invoke: invokeZord,
  };

  /** One `tools/call`. A collaborator's refusal is a result; only the arguments are a protocol error. */
  async function called(params: Arguments): Promise<Answer> {
    const named: unknown = params.name;
    if (typeof named !== "string") {
      return fault(INVALID_PARAMS, `a tools/call names the tool to call, and this one names ${shown(named)}`);
    }
    const descriptor = TOOLS.find((tool) => tool.name === named);
    if (descriptor === undefined) {
      return fault(
        INVALID_PARAMS,
        `there is no tool called ${JSON.stringify(named)}; this control plane offers ${TOOL_NAMES.join(", ")}`,
      );
    }

    const given: unknown = params.arguments;
    if (typeof given !== "object" || given === null || Array.isArray(given)) {
      return fault(
        INVALID_PARAMS,
        `the arguments of ${descriptor.name} are a JSON object, and this call carries ${shown(given)}`,
      );
    }

    const asked = given as Arguments;
    const wrong = faultIn(descriptor.inputSchema, asked, descriptor.name);
    if (wrong !== undefined) {
      return fault(INVALID_PARAMS, wrong);
    }

    return ran(running[descriptor.name], asked);
  }

  /**
   * Runs a tool and turns whatever it did into an answer. Never throws.
   *
   * Two channels out, and the split is the module doc's: a `HostFault` is this host failing at something
   * the caller cannot fix, so it is `-32603`; everything else a collaborator raised is what the tool has
   * to report back, so it is a result with `isError: true` carrying that collaborator's own name.
   */
  async function ran(
    run: (given: Arguments) => Promise<unknown>,
    given: Arguments,
  ): Promise<Answer> {
    try {
      return { kind: "result", result: content(jsonOf(await run(given)), false) };
    } catch (cause) {
      if (cause instanceof HostFault) {
        return fault(INTERNAL_ERROR, cause.message);
      }
      return {
        kind: "result",
        result: content(jsonOf({ failed: true, error: nameOf(cause), detail: messageOf(cause) }), true),
      };
    }
  }

  async function answered(method: string, params: Arguments): Promise<Answer> {
    switch (method) {
      case "initialize":
        return {
          kind: "result",
          result: {
            protocolVersion: PROTOCOL_VERSION,
            // One capability, because there is one thing here: eight tools. `listChanged` is absent
            // rather than `false`, because the list is a constant and a notification nothing sends is a
            // field no rule fills.
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        };

      case "notifications/initialized":
        // Acknowledged by doing nothing, which is what a notification asks for. Nothing here waits on it:
        // the handshake is not enforced as an order — see the module doc.
        return NOTHING;

      case "ping":
        return { kind: "result", result: {} };

      case "tools/list":
        return { kind: "result", result: { tools: TOOLS } };

      case "tools/call":
        return called(params);

      default:
        return fault(METHOD_NOT_FOUND, `${JSON.stringify(method)} is not a method this control plane answers`);
    }
  }

  return Object.freeze({
    tools: TOOLS,

    async handle(frame: string): Promise<string | undefined> {
      const read = frameIn(frame);
      if (read.kind === "ignored") {
        return undefined;
      }
      if (read.kind === "fault") {
        return frameOf(errorOf(read.id, read.code, read.message));
      }

      const request = read.request;
      let answer: Answer;
      try {
        answer = await answered(request.method, request.params);
      } catch (cause) {
        // The last net. Every path above answers rather than throws, and a collaborator that broke that
        // must not take the transport down with it — `handle` never rejects.
        answer = fault(INTERNAL_ERROR, messageOf(cause));
      }

      if (request.id === undefined) {
        // A notification is never answered, whatever became of it. JSON-RPC 2.0 §4.1.
        return undefined;
      }
      if (answer.kind === "none") {
        // A method that answers nothing was called as a request. Answering `{}` would invent a result, so
        // it is refused as what it is: the client used the wrong shape.
        return frameOf(
          errorOf(request.id, INVALID_REQUEST, `${JSON.stringify(request.method)} is a notification and has no result`),
        );
      }
      if (answer.kind === "fault") {
        return frameOf(errorOf(request.id, answer.code, answer.message));
      }
      return frameOf({ jsonrpc: "2.0", id: request.id, result: answer.result });
    },
  });
}

/* -------------------------------------------------------------------------------------------------
 * Internals: the arguments a tool was given
 * ---------------------------------------------------------------------------------------------- */

/** A tool's arguments, before anything has been read off them. */
type Arguments = Readonly<Record<string, unknown>>;

/**
 * Why these arguments do not match the schema, or `undefined` when they do.
 *
 * **This walk is the only thing that reads an argument's type**, which is what makes `inputSchema` a
 * statement a client can rely on rather than documentation beside the code. The readers below cast on the
 * strength of it, in the idiom this repository uses everywhere a check and a cast sit together.
 */
function faultIn(schema: ToolSchema, given: Arguments, at: string): string | undefined {
  for (const named of Object.keys(given)) {
    if (!(named in schema.properties)) {
      // Refused, never dropped. A Zord that passed `zordId` and was not told believes it attributed a
      // Fact to somebody else — see "What a Zord may not say".
      return (
        `${at} takes no argument called ${JSON.stringify(named)}; it takes ` +
        `${Object.keys(schema.properties).join(", ")}`
      );
    }
  }

  for (const named of schema.required) {
    if (!(named in given) || given[named] === undefined) {
      return `${at} needs ${JSON.stringify(named)}, and this call gives none`;
    }
  }

  for (const [named, property] of Object.entries(schema.properties)) {
    if (!(named in given) || given[named] === undefined) {
      continue;
    }
    const wrong = valueFaultIn(property, given[named], `${at}.${named}`);
    if (wrong !== undefined) {
      return wrong;
    }
  }

  return undefined;
}

/** Why one value does not match one declared property, or `undefined`. */
function valueFaultIn(property: ToolProperty, value: unknown, at: string): string | undefined {
  switch (property.type) {
    case "string":
      if (typeof value !== "string") {
        return `${at} is text, and this call gives ${shown(value)}`;
      }
      if (property.enum !== undefined && !property.enum.includes(value)) {
        return `${at} is one of ${property.enum.join(", ")}, and this call gives ${JSON.stringify(value)}`;
      }
      return undefined;

    case "number":
      // `Number.isFinite` and not `typeof`: `NaN` and `Infinity` are numbers that no collaborator below
      // can do anything with, and JSON cannot even carry them back out.
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${at} is a number, and this call gives ${shown(value)}`;
      }
      return undefined;

    case "array": {
      if (!Array.isArray(value)) {
        return `${at} is a list, and this call gives ${shown(value)}`;
      }
      // Re-typed away from the `any[]` that `Array.isArray` narrows an `unknown` to.
      const listed: readonly unknown[] = value;
      for (const [position, entry] of listed.entries()) {
        const wrong = valueFaultIn(property.items, entry, `${at}[${position}]`);
        if (wrong !== undefined) {
          return wrong;
        }
      }
      return undefined;
    }

    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${at} is an object, and this call gives ${shown(value)}`;
      }
      return faultIn(
        {
          type: "object",
          properties: property.properties,
          required: property.required,
          additionalProperties: false,
        },
        value as Arguments,
        at,
      );
    }

    default:
      // Unreachable while every member of `ToolProperty` is handled above, which is what the `never`
      // parameter enforces. It returns rather than throws, and the safe answer about a property nobody
      // wrote a check for is to say so.
      exhausted(property);
      return `${at} is declared in a shape this control plane cannot check`;
  }
}

/**
 * One declared string argument.
 *
 * The cast is what `faultIn` earned: the walk above proved this key is present and is a string, so
 * re-reading it here would be the re-fold this repository records as a check that can only pass.
 */
function textIn(given: Arguments, named: string): string {
  return given[named] as string;
}

function numberIn(given: Arguments, named: string): number {
  return given[named] as number;
}

function textListIn(given: Arguments, named: string): readonly string[] {
  return given[named] as readonly string[];
}

/** An optional filter, present in the query exactly when it was given. Absent asks nothing. */
function optionalText<TFilter>(
  given: Arguments,
  named: string,
  asFilter: (value: string) => TFilter,
): TFilter | Record<string, never> {
  const value = given[named];
  return value === undefined ? {} : asFilter(value as string);
}

function optionalNumber<TFilter>(
  given: Arguments,
  named: string,
  asFilter: (value: number) => TFilter,
): TFilter | Record<string, never> {
  const value = given[named];
  return value === undefined ? {} : asFilter(value as number);
}

/**
 * The Gaps a Handoff declares, each through `gap()`.
 *
 * Built with the constructor rather than assembled as a literal: a Gap is a value object and its
 * invariants are checked where it is built, which is here. `gap()` refuses a blank Clause or a blank
 * reason, and that refusal is the tool's answer.
 */
function gapsIn(given: Arguments): readonly Gap[] {
  const listed = given["gaps"] as readonly Arguments[];
  return listed.map((declared) =>
    gapOf(declared["clauseId"] as ClauseId, declared["reason"] as string),
  );
}

/**
 * A failure of a tool that no collaborator raised.
 *
 * Two of them exist, both in `agent_invoke`, and both are readings of what the Replay recorded rather than
 * rules: there is no Delegation under that id, or the Harness it recorded cannot be run. It is not
 * exported, because nothing outside `handle` can ever see one — it becomes an `isError` result.
 */
class ToolFailure extends Error {
  constructor(name: string, detail: string) {
    super(detail);
    this.name = name;
  }
}

/**
 * The Instant a Command or a Fact happens at, read off the injected clock without trusting it.
 *
 * `now` is written by whoever built the control plane, but its answer is copied into a Command and into a
 * Fact, so a blank one would put an unreadable moment into the record permanently. A host's bug, so it
 * surfaces as `-32603` rather than as a tool error the caller could do nothing about.
 */
function instantNow(now: () => Instant): Instant {
  let answered: unknown;
  try {
    answered = now();
  } catch (cause) {
    throw new HostFault(`the clock this control plane was built with failed: ${messageOf(cause)}`);
  }
  if (typeof answered !== "string" || answered.trim().length === 0) {
    throw new HostFault(
      `the clock this control plane was built with answered ${shown(answered)}, which is not an Instant`,
    );
  }
  return answered as Instant;
}

/** A failure of the host rather than of the caller. Becomes `-32603`. Never leaves `handle`. */
class HostFault extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "HostFault";
  }
}

/* -------------------------------------------------------------------------------------------------
 * Internals: reading a frame
 * ---------------------------------------------------------------------------------------------- */

/** What one JSON-RPC frame turned out to be. */
type FrameRead =
  | { readonly kind: "request"; readonly request: JsonRpcRequest }
  | { readonly kind: "fault"; readonly id: string | number | null; readonly code: number; readonly message: string }
  | { readonly kind: "ignored" };

/** One well-formed frame. `id` absent means a notification, which is never answered. */
type JsonRpcRequest = {
  readonly id: string | number | undefined;
  readonly method: string;
  readonly params: Arguments;
};

/**
 * The request a frame carries, or why it carries none.
 *
 * Never throws. A parse error and an invalid request are both answered with `id: null`, which is what
 * JSON-RPC 2.0 prescribes for a frame whose id cannot be read; only a **well-formed notification** is
 * answered with nothing at all.
 */
function frameIn(frame: string): FrameRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch (cause) {
    return { kind: "fault", id: null, code: PARSE_ERROR, message: `this frame is not JSON — ${messageOf(cause)}` };
  }

  if (Array.isArray(parsed)) {
    return {
      kind: "fault",
      id: null,
      code: INVALID_REQUEST,
      message: "this control plane answers one request per frame: MCP 2025-06-18 removed JSON-RPC batches",
    };
  }
  // Every condition stays inline in its `if`: TypeScript does not narrow through an aliased compound
  // condition that uses `in`.
  if (typeof parsed !== "object" || parsed === null) {
    return {
      kind: "fault",
      id: null,
      code: INVALID_REQUEST,
      message: `a JSON-RPC frame is an object, and this one is ${shown(parsed)}`,
    };
  }
  if (!("jsonrpc" in parsed) || parsed.jsonrpc !== "2.0") {
    return {
      kind: "fault",
      id: null,
      code: INVALID_REQUEST,
      message: 'a JSON-RPC frame carries "jsonrpc": "2.0"',
    };
  }

  // Read before the method, so a request that names no method is still answered under its own id.
  let id: string | number | undefined;
  if ("id" in parsed) {
    const claimed: unknown = parsed.id;
    if (typeof claimed !== "string" && typeof claimed !== "number") {
      return {
        kind: "fault",
        id: null,
        code: INVALID_REQUEST,
        message: `a request's id is a string or a number, and this one is ${shown(claimed)}`,
      };
    }
    id = claimed;
  }

  if (!("method" in parsed) || typeof parsed.method !== "string" || parsed.method.length === 0) {
    if (id === undefined) {
      // A notification with no method is not answerable and must not be answered.
      return { kind: "ignored" };
    }
    return {
      kind: "fault",
      id,
      code: INVALID_REQUEST,
      message: `a JSON-RPC frame names the method it calls, and this one names ${shown("method" in parsed ? parsed.method : undefined)}`,
    };
  }

  const params: unknown = "params" in parsed ? parsed.params : undefined;
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
    // Positional parameters are legal JSON-RPC and are not part of MCP, which is by-name throughout.
    if (id === undefined) {
      return { kind: "ignored" };
    }
    return {
      kind: "fault",
      id,
      code: INVALID_PARAMS,
      message: `params are given by name, and this call gives ${shown(params)}`,
    };
  }

  return {
    kind: "request",
    request: { id, method: parsed.method, params: (params ?? {}) as Arguments },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Internals: writing a frame
 * ---------------------------------------------------------------------------------------------- */

/** What answering a method produced: a result, a fault to report, or nothing at all. */
type Answer =
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "fault"; readonly code: number; readonly message: string }
  | { readonly kind: "none" };

const NOTHING: Answer = Object.freeze({ kind: "none" });

function fault(code: number, message: string): Answer {
  return { kind: "fault", code, message };
}

/**
 * One JSON-RPC error response.
 *
 * `HostFault` is the one thrown value that carries its own code, and it is mapped here rather than at
 * every call site so the two channels stay one decision.
 */
function errorOf(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** MCP's tool result: one text block, and whether the tool failed. */
function content(said: string, failed: boolean): unknown {
  // `isError` is written even when it is `false`, although the specification lets it be omitted: a model
  // reading raw JSON should not have to know a default.
  return { content: [{ type: "text", text: said }], isError: failed };
}

/**
 * One answer as the text of a frame.
 *
 * Never throws: a response that cannot be JSON would otherwise take the transport down at the one moment
 * the client is waiting for something. It falls back to an internal error under the same id, built from a
 * literal so it cannot fail in turn.
 */
function frameOf(response: unknown): string {
  try {
    const text = JSON.stringify(response);
    if (typeof text !== "string") {
      throw new Error(`JSON.stringify answered ${shown(text)}`);
    }
    return text;
  } catch (cause) {
    const id = idOf(response);
    return `{"jsonrpc":"2.0","id":${id},"error":{"code":${INTERNAL_ERROR},"message":${JSON.stringify(
      `this control plane could not phrase its own answer: ${messageOf(cause)}`,
    )}}}`;
  }
}

/** The id of a response, as JSON text, for the fallback above. `null` when it cannot be read. */
function idOf(response: unknown): string {
  if (typeof response !== "object" || response === null || !("id" in response)) {
    return "null";
  }
  const id: unknown = response.id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }
  if (typeof id === "string") {
    return JSON.stringify(id);
  }
  return "null";
}

/** A tool's answer as the text a client reads. Indented, because a human debugs this too. */
function jsonOf(answer: unknown): string {
  const text = JSON.stringify(answer, undefined, 2);
  if (typeof text !== "string") {
    throw new HostFault(`this answer cannot be JSON: JSON.stringify answered ${shown(text)}`);
  }
  return text;
}

/* -------------------------------------------------------------------------------------------------
 * Internals: shapes
 * ---------------------------------------------------------------------------------------------- */

/** A Pane's answer, with its status present exactly when one was announced. */
function withStatus(answer: Readonly<Record<string, unknown>>, record: PaneRecord): unknown {
  // Absence is the answer, as it is for `Delegation.handoff` and `Gate.decision`: a Pane nobody has heard
  // a status from does not get an invented one.
  return record.status === undefined ? answer : { ...answer, status: record.status };
}

/**
 * A PaneId as a `Map` key.
 *
 * Read as `unknown` because the brand is not a guarantee: `records.get(undefined)` answers `undefined`
 * happily, so without this a Pane named by something that is not a string would silently share the "no
 * such Pane" answer with every other one. The schema walk has already refused a non-string on the way in;
 * this is what keeps that true if a caller inside this file ever stops going through it.
 */
function keyOf(pane: PaneId): string {
  const named: unknown = pane;
  return typeof named === "string" ? named : String(named);
}

function nameOf(cause: unknown): string {
  return cause instanceof Error ? cause.name : "Error";
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Enforces exhaustiveness without throwing.
 *
 * The engine's idiom: a `never` parameter, a `void` answer, and each caller returning its own safe value.
 */
function exhausted(value: never): void {
  void value;
}

/** How a rejected value reads inside a fault. Mirrors the engine, the pty runner and both stores. */
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
