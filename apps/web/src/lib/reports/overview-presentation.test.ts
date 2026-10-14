import { describe, expect, it } from "vitest";
import { buildReportVisualFixture } from "./visual-fixtures";
import {
  overviewDelta,
  overviewPoints,
  roundedOverviewMoney,
  retainedDisplayName,
  signedInDisplayName,
} from "./overview-presentation";

describe("issued Overview presentation", () => {
  it("rounds without floating point or losing large currency values", () => {
    expect(roundedOverviewMoney("£714.29")).toBe("£714");
    expect(roundedOverviewMoney("£9,007,199,254,740,993.50")).toBe(
      "£9,007,199,254,740,994",
    );
    expect(roundedOverviewMoney("Not available")).toBe("Not available");
  });
  it("retains partial and missing observations, never substitutes zero", () => {
    const fixture = buildReportVisualFixture("partial");
    const points = overviewPoints(fixture.selectedVersion);
    expect(points).toHaveLength(4);
    expect(points.at(-1)?.qualifiedPeriodState).toBe("partial");
    expect(points.every((p) => p.qualifiedWallets === null)).toBe(true);
    expect(
      overviewPoints({ ...fixture.selectedVersion, measurementContext: null }),
    ).toEqual([]);
  });
  it("compares only issued same-currency metrics and handles lower costs", () => {
    const fixture = buildReportVisualFixture("ready");
    const prior = fixture.report.versions.find((v) => v.version === 1)!;
    expect(
      overviewDelta(fixture.selectedVersion, prior, "qualified")?.text,
    ).toBe("↑ 3");
    expect(
      overviewDelta(fixture.selectedVersion, prior, "cpqw")?.positive,
    ).toBe(true);
    expect(
      overviewDelta(fixture.selectedVersion, undefined, "revenue"),
    ).toBeNull();
  });
  it("uses own verified-user metadata for display, not generic Account", () => {
    expect(signedInDisplayName({ user_metadata: { full_name: "Jack" } })).toBe(
      "Jack",
    );
    expect(signedInDisplayName({ email: "reviewer@example.test" })).toBe(
      "reviewer@example.test",
    );
    expect(retainedDisplayName("Creator abc123", "abc123")).toBe(
      "Name not retained · c123",
    );
  });
  it("does not color changed definitions or valuation bases as growth", () => {
    const fixture = buildReportVisualFixture("ready");
    const prior = structuredClone(
      fixture.report.versions.find((v) => v.version === 1)!,
    );
    prior.metricSnapshot.metrics.cpqw.conversionRuleVersionIds = [
      "50000000-0000-4000-8000-000000000099",
    ];
    expect(
      overviewDelta(fixture.selectedVersion, prior, "qualified"),
    ).toBeNull();
    prior.metricSnapshot.metrics.revenueRoas.valuationPolicy.version = 99;
    expect(overviewDelta(fixture.selectedVersion, prior, "revenue")).toBeNull();
  });
});
