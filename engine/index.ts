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
  InvalidInstantError,
  instant,
  instantFromDate,
  type Delegated,
  type Instant,
  type MissionDelivered,
  type MissionEvent,
  type MissionHalted,
  type MissionKilled,
  type MissionOpened,
} from "./domain/events";

export type {
  DecideGate,
  Delegate,
  DeliverMission,
  MissionCommand,
  OpenMission,
  OpenMissionFields,
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
