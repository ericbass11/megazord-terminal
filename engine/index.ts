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
