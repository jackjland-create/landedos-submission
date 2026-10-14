import { describe, expect, it } from "vitest";
import { campaignTimingProposalSchema as schema } from "./campaign-timing";

const proposal = () => ({
  schemaVersion: 1,
  flight: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-10-12T00:00:00Z",
  },
  measurement: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-11-12T00:00:00Z",
  },
});

describe("BSK-09 proposed campaign timing", () => {
  it("retains explicit post-flight measurement without changing input", () => {
    const input = proposal();
    expect(schema.parse(input)).toEqual(input);
  });
  it("allows measurement ending exactly with flight", () => {
    const input = proposal();
    input.measurement = { ...input.flight };
    expect(schema.safeParse(input).success).toBe(true);
  });
  it("allows an explicitly earlier measurement start", () => {
    const input = proposal();
    input.measurement.startedAt = "2026-09-01T00:00:00Z";
    expect(schema.safeParse(input).success).toBe(true);
  });
  it.each(["flight", "measurement"] as const)("rejects empty %s", (key) => {
    const input = proposal();
    input[key].endedAt = input[key].startedAt;
    expect(schema.safeParse(input).success).toBe(false);
  });
  it("rejects measurement missing flight start by one microsecond", () => {
    const input = proposal();
    input.measurement.startedAt = "2026-09-14T00:00:00.000001Z";
    expect(schema.safeParse(input).success).toBe(false);
  });
  it("rejects measurement missing flight end by one microsecond", () => {
    const input = proposal();
    input.flight.endedAt = "2026-10-12T00:00:00.000001Z";
    input.measurement.endedAt = "2026-10-12T00:00:00Z";
    expect(schema.safeParse(input).success).toBe(false);
  });
  it.each([
    "2026-02-30T00:00:00Z",
    "0000-01-01T00:00:00Z",
    "2026-09-14",
    "2026-09-14T00:00:00+01:00",
    "2026-09-14T00:00:00.0000001Z",
    "bad",
  ])("rejects ambiguous or invalid %s", (date) => {
    const input = proposal();
    input.flight.startedAt = date;
    expect(schema.safeParse(input).success).toBe(false);
  });
  it("does not invent missing flight dates", () => {
    expect(
      schema.safeParse({
        schemaVersion: 1,
        measurement: proposal().measurement,
      }).success,
    ).toBe(false);
  });
  it("rejects extra policy fields", () => {
    expect(
      schema.safeParse({ ...proposal(), attributionWindowDays: 30 }).success,
    ).toBe(false);
  });
});
