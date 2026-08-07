/**
 * Branded identifiers for the Mission Engine.
 *
 * Every id is a `string` at runtime and a distinct type at compile time, so a raw string — or an
 * id of another kind — cannot be passed where a specific id is required. The brand exists only in
 * the type system: nothing is wrapped, nothing is allocated.
 */

declare const brand: unique symbol;

/** A `string` tagged with a phantom brand. Assignable to `string`, never assignable from it. */
type Branded<TBrand extends string> = string & { readonly [brand]: TBrand };

/** Identifies a Mission. */
export type MissionId = Branded<"MissionId">;

/** Identifies a Zord. */
export type ZordId = Branded<"ZordId">;

/** Identifies a Delegation. */
export type DelegationId = Branded<"DelegationId">;

/** Identifies a Gate. */
export type GateId = Branded<"GateId">;

/** Identifies a Clause of a Contract. */
export type ClauseId = Branded<"ClauseId">;

/** Raised when an id is constructed from a value that cannot identify anything. */
export class InvalidIdError extends Error {
  constructor(label: string, value: string) {
    super(`${label} must be a non-empty string, received ${JSON.stringify(value)}`);
    this.name = "InvalidIdError";
  }
}

function brandId<TId extends Branded<string>>(label: string, value: string): TId {
  if (value.trim().length === 0) {
    throw new InvalidIdError(label, value);
  }
  return value as TId;
}

/** Constructs a MissionId. Throws `InvalidIdError` on a blank value. */
export function missionId(value: string): MissionId {
  return brandId<MissionId>("MissionId", value);
}

/** Constructs a ZordId. Throws `InvalidIdError` on a blank value. */
export function zordId(value: string): ZordId {
  return brandId<ZordId>("ZordId", value);
}

/** Constructs a DelegationId. Throws `InvalidIdError` on a blank value. */
export function delegationId(value: string): DelegationId {
  return brandId<DelegationId>("DelegationId", value);
}

/** Constructs a GateId. Throws `InvalidIdError` on a blank value. */
export function gateId(value: string): GateId {
  return brandId<GateId>("GateId", value);
}

/** Constructs a ClauseId. Throws `InvalidIdError` on a blank value. */
export function clauseId(value: string): ClauseId {
  return brandId<ClauseId>("ClauseId", value);
}
