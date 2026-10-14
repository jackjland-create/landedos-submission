import { describe, expect, it } from "vitest";
import { inspectMetricV1RangeCompatibility } from "./metric-time-compatibility";
import { retainedReportMicros } from "./report-instants";
import { metricSnapshotInputSchema } from "./index";

describe("retained range / unchanged metric V1 precision boundary", () => {
  it.each([
    ["9999-12-31T23:00:00-01:00", "9999-12-31T23:59:59-01:00"],
    ["0000-01-01T00:00:00+01:00", "0000-01-01T00:01:00+01:00"],
  ])(
    "does not mislabel expanded UTC year as V1 compatible",
    (startedAt, endedAt) => {
      expect(inspectMetricV1RangeCompatibility({ startedAt, endedAt })).toEqual(
        {
          status: "outside_metric_v1_calendar_range",
          retainedRange: { startedAt, endedAt },
          metricV1Range: null,
        },
      );
    },
  );
  it.each([
    ["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.001Z"],
    ["2026-08-01T00:00:00.000000Z", "2026-08-02T00:00:00.001000Z"],
    ["2026-08-01T01:00:00+01:00", "2026-08-02T01:00:00.001000+01:00"],
    ["1969-12-31T23:59:59.999000Z", "1970-01-01T00:00:00.000000Z"],
  ])(
    "converts only mathematically exact boundaries: %s",
    (startedAt, endedAt) => {
      const source = { startedAt, endedAt };
      const output = inspectMetricV1RangeCompatibility(source);
      expect(output.status).toBe("exactly_representable");
      expect(output.retainedRange).toEqual(source);
      expect(
        metricSnapshotInputSchema.shape.sourceTimeRange.safeParse(
          output.metricV1Range,
        ).success,
      ).toBe(true);
      for (const key of ["startedAt", "endedAt"] as const) {
        expect(retainedReportMicros(output.metricV1Range![key])).toBe(
          retainedReportMicros(source[key]),
        );
        expect(output.metricV1Range![key]).toMatch(/\.\d{3}Z$/);
      }
    },
  );

  it.each([
    ["2026-08-01T00:00:00.000001Z", "2026-08-01T00:00:00.000002Z"],
    ["2026-08-01T00:00:00Z", "2026-08-02T00:00:00.999999Z"],
    ["1969-12-31T23:59:59.999999Z", "1970-01-01T00:00:00Z"],
    ["2026-08-01T01:00:00.000001+01:00", "2026-08-02T00:00:00Z"],
  ])("never rounds away retained precision: %s", (startedAt, endedAt) => {
    const source = { startedAt, endedAt };
    expect(inspectMetricV1RangeCompatibility(source)).toEqual({
      status: "requires_microsecond_metric_version",
      retainedRange: source,
      metricV1Range: null,
    });
  });

  it.each([
    {
      startedAt: "2026-08-01T00:00:00.000002Z",
      endedAt: "2026-08-01T00:00:00.000001Z",
    },
    { startedAt: "2026-08-01T00:00:00Z", endedAt: "2026-08-01T01:00:00+01:00" },
    {
      startedAt: "2026-08-01T00:00:00.0000001Z",
      endedAt: "2026-08-02T00:00:00Z",
    },
    { startedAt: "2026-02-30T00:00:00Z", endedAt: "2026-08-02T00:00:00Z" },
    { startedAt: "2026-08-01T00:00:00", endedAt: "2026-08-02T00:00:00Z" },
    { startedAt: "invalid", endedAt: "2026-08-02T00:00:00Z" },
    {
      startedAt: "2026-08-01T00:00:00Z",
      endedAt: "2026-08-02T00:00:00Z",
      dataThrough: "2026-08-02T00:00:00Z",
    },
  ])("rejects invalid or ambiguous range %#", (range) => {
    expect(() => inspectMetricV1RangeCompatibility(range)).toThrow();
  });
});
