import { describe, expect, it } from "vitest";

import {
  buildReportVisualFixture,
  isReportVisualState,
  reportVisualFixturesEnabled,
} from "./visual-fixtures";

describe("RPT-06 reporting visual fixtures", () => {
  it("stays unavailable in production even when the explicit flag is present", () => {
    expect(
      reportVisualFixturesEnabled({
        explicitFlag: "1",
        nodeEnv: "production",
        vercelEnv: "production",
      }),
    ).toBe(false);
    expect(
      reportVisualFixturesEnabled({
        nodeEnv: "production",
        vercelEnv: "preview",
      }),
    ).toBe(true);
  });

  it("accepts only the declared screenshot states", () => {
    expect(isReportVisualState("ready")).toBe(true);
    expect(isReportVisualState("permission")).toBe(true);
    expect(isReportVisualState("customer-data")).toBe(false);
  });

  it("keeps ready, stale and partial evidence semantically distinct", () => {
    const ready = buildReportVisualFixture("ready").selectedVersion;
    const stale = buildReportVisualFixture("stale").selectedVersion;
    const partial = buildReportVisualFixture("partial").selectedVersion;

    expect(ready.metricSnapshot.metrics.revenueRoas.status).toBe("available");
    expect(ready.measurementContext?.observations).toHaveLength(8);
    expect(ready.measurementContext?.benchmarks).toHaveLength(2);
    expect(
      Date.parse(ready.issuedAt) -
        Date.parse(ready.metricSnapshot.metrics.cpc.dataFreshness.dataThrough),
    ).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    expect(stale.metricSnapshot.metrics.revenueRoas.status).toBe("available");
    expect(
      Date.parse(stale.issuedAt) -
        Date.parse(stale.metricSnapshot.metrics.cpc.dataFreshness.dataThrough),
    ).toBeGreaterThan(24 * 60 * 60 * 1000);

    expect(partial.metricSnapshot.metrics.cpc.denominator.status).toBe(
      "not_available",
    );
    expect(partial.metricSnapshot.metrics.revenueRoas.status).toBe(
      "not_available",
    );
    expect(
      partial.measurementContext?.observations.every(
        (observation) => observation.status === "not_available",
      ),
    ).toBe(true);
  });
});
