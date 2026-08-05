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
