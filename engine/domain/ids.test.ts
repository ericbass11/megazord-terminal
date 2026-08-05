import { describe, expect, it } from "vitest";

import {
  InvalidIdError,
  clauseId,
  delegationId,
  gateId,
  missionId,
  zordId,
  type MissionId,
} from "@engine/domain/ids";

/** Stands in for any domain operation that requires a MissionId and nothing else. */
function readMissionId(id: MissionId): string {
  return id;
}

describe("branded ids", () => {
  it("keeps the underlying string at runtime", () => {
    expect(missionId("mission-1")).toBe("mission-1");
    expect(readMissionId(missionId("mission-1"))).toBe("mission-1");
  });

  it("constructs every id kind the engine needs", () => {
    expect(zordId("zord-1")).toBe("zord-1");
    expect(delegationId("delegation-1")).toBe("delegation-1");
    expect(gateId("gate-1")).toBe("gate-1");
    expect(clauseId("clause-1")).toBe("clause-1");
  });

  it("refuses a raw string where a MissionId is required", () => {
    // @ts-expect-error a raw string carries no brand, so it is not a MissionId
    const rejected = (): string => readMissionId("mission-1");

    // The type error is the proof; the call still runs, because the brand is erased at runtime.
    expect(rejected()).toBe("mission-1");
  });

  it("refuses an id of another kind where a MissionId is required", () => {
    // @ts-expect-error a ZordId is a different brand, so it is not a MissionId
    const rejected = (): string => readMissionId(zordId("zord-1"));

    expect(rejected()).toBe("zord-1");
  });

  it("stays assignable to string, so ids can be compared and printed", () => {
    const id: string = missionId("mission-1");

    expect(id.startsWith("mission")).toBe(true);
  });

  it("rejects a blank value at runtime", () => {
    expect(() => missionId("")).toThrow(InvalidIdError);
    expect(() => zordId("   ")).toThrow(InvalidIdError);
    expect(() => clauseId("")).toThrow(/ClauseId must be a non-empty string/);
  });
});
