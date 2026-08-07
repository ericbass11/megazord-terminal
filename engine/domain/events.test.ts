import { describe, expect, it } from "vitest";

import {
  InvalidInstantError,
  instant,
  instantFromDate,
  type Instant,
  type MissionEvent,
} from "@engine/domain/events";
import { missionId } from "@engine/domain/ids";

/** Stands in for any Event payload that requires a checked Instant and nothing else. */
function occurredAt(when: Instant): string {
  return when;
}

describe("Instant", () => {
  it("keeps the timestamp it was built from", () => {
    expect(instant("2026-08-05T12:00:00.000Z")).toBe("2026-08-05T12:00:00.000Z");
    expect(instant("2026-08-05T12:00:00Z")).toBe("2026-08-05T12:00:00Z");
  });

  it("builds from a Date the caller already read", () => {
    expect(instantFromDate(new Date("2026-08-05T12:00:00.000Z"))).toBe("2026-08-05T12:00:00.000Z");
  });

  it("refuses anything that is not a UTC ISO-8601 timestamp", () => {
    for (const rejected of [
      "",
      "2026-08-05",
      "2026-08-05T12:00:00",
      "2026-08-05T12:00:00-03:00",
      "2026-08-05T12:00:00.000000Z",
      "05/08/2026",
      "yesterday",
      "2026-13-05T12:00:00Z",
      "2026-02-30T00:00:00Z",
    ]) {
      expect(() => instant(rejected), rejected).toThrow(InvalidInstantError);
    }
  });

  it("refuses an invalid Date", () => {
    expect(() => instantFromDate(new Date("not a date"))).toThrow(InvalidInstantError);
  });

  it("refuses a raw string where an Instant is required", () => {
    // @ts-expect-error a raw string carries no brand, so it is not a checked Instant
    const rejected = (): string => occurredAt("2026-08-05T12:00:00.000Z");

    // The type error is the proof; the call still runs, because the brand is erased at runtime.
    expect(rejected()).toBe("2026-08-05T12:00:00.000Z");
  });
});

describe("MissionEvent", () => {
  it("is a closed union: a fact nobody modelled cannot be written", () => {
    const rejected = (): MissionEvent => ({
      // @ts-expect-error "mission-polished" is not an Event of a Mission
      kind: "mission-polished",
      missionId: missionId("mission-1"),
      occurredAt: instant("2026-08-05T12:00:00.000Z"),
    });

    expect(rejected().kind).toBe("mission-polished");
  });
});
