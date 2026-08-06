/**
 * Public surface of the Mission Engine.
 *
 * Everything a Surface (a Cockpit, an MCP server, a shell) is allowed to import comes from here.
 * Reaching into `engine/domain/*` from outside the module is not part of the Contract.
 */

export {
  InvalidIdError,
  clauseId,
  delegationId,
  gateId,
  missionId,
  zordId,
  type ClauseId,
  type DelegationId,
  type GateId,
  type MissionId,
  type ZordId,
} from "./domain/ids";

export {
  InvalidMoneyError,
  ZERO_MONEY,
  addMoney,
  centsOf,
  compareMoney,
  formatMoney,
  moneyFromCents,
  moneyFromDecimal,
  type Money,
} from "./domain/money";

export {
  EXECUTION_CAPABILITY_NAMES,
  ExecutionCapabilityError,
  ORCHESTRATION_CAPABILITY_NAMES,
  UnknownCapabilityError,
  assertNoExecution,
  core,
  executionCapability,
  isExecutionCapability,
  orchestrationCapability,
  type Capability,
  type Core,
  type CoreCapability,
  type ExecutionCapability,
  type ExecutionCapabilityName,
  type OrchestrationCapability,
  type OrchestrationCapabilityName,
} from "./domain/capability";

export {
  InvalidContractError,
  clause,
  contract,
  validateHandoff,
  type Clause,
  type Contract,
} from "./domain/contract";

export {
  InvalidGapError,
  InvalidHandoffError,
  gap,
  handoff,
  type Gap,
  type Handoff,
} from "./domain/handoff";

export {
  accrued,
  amountOf,
  hasReachedCap,
  meterOf,
  type Meter,
  type MeteredDelegation,
} from "./domain/meter";

export {
  decisionOf,
  isOpenGate,
  openGateIn,
  revisionsIn,
  type Gate,
  type GateDecision,
} from "./domain/gate";

export {
  InvalidInstantError,
  instant,
  instantFromDate,
  type CapAuthorised,
  type CostAccrued,
  type Delegated,
  type GateDecided,
  type GateRaised,
  type HandoffAccepted,
  type Instant,
  type MissionDelivered,
  type MissionEvent,
  type MissionHalted,
  type MissionKilled,
  type MissionOpened,
} from "./domain/events";

export type {
  AccrueCost,
  AuthoriseCap,
  DecideGate,
  Delegate,
  DeliverMission,
  KillMission,
  MissionCommand,
  OpenMission,
  OpenMissionFields,
  RaiseGate,
  SubmitHandoff,
} from "./domain/commands";

export {
  InvalidBriefingError,
  InvalidSliceError,
  MODES,
  REFUSAL_REASONS,
  UNOPENED_MISSION,
  briefing,
  decide,
  evolve,
  isOpenDelegation,
  isOpened,
  openMission,
  slice,
  type Briefing,
  type Decision,
  type Delegation,
  type DeliveredMission,
  type Delivery,
  type Halt,
  type HaltedMission,
  type KilledMission,
  type Mission,
  type MissionStatus,
  type Mode,
  type OpenedMission,
  type Refusal,
  type RefusalReason,
  type RunningMission,
  type Slice,
  type UnopenedMission,
} from "./domain/mission";

export {
  EFFORTS,
  InvalidHarnessError,
  harness,
  resolveHarness,
  type Effort,
  type Harness,
  type HarnessSources,
} from "./domain/harness";

export {
  EMPTY_REPLAY,
  eventsIn,
  eventsOf,
  refusedIn,
  replay,
  stateOf,
  stepsOf,
  submit,
  type Replay,
  type ReplayEntry,
  type RefusedStep,
  type Step,
} from "./domain/replay";

/**
 * The boundary a Zord runs behind. A Surface implements it for a real CLI; the domain never imports it.
 */
export type { AgentReport, AgentRun, AgentRunner } from "./ports/agent-runner";

/**
 * The deterministic fake, exported on purpose: it is how a Surface builds against this engine — and how
 * this engine proves a whole Mission — with no CLI installed and no network.
 */
export {
  UnscriptedRunError,
  fakeAgentRunner,
  type FakeAgentRunner,
} from "./adapters/fake-agent-runner";
