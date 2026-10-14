import { describe, expect, it } from "vitest";

import { buildReportVisualFixture } from "./visual-fixtures";
import { buildReportingStudioViewModel } from "./studio-view-model";

function buildModel(state: "ready" | "partial" | "stale") {
  const fixture = buildReportVisualFixture(state);
  return buildReportingStudioViewModel({
    campaign: fixture.campaign,
    comparisonVersion: fixture.comparisonVersion,
    evidencePaths: fixture.rankingEvidencePaths,
    selectedVersion: fixture.selectedVersion,
  });
}

describe("Landed Studio reporting view model", () => {
  it("turns the retained report fixture into a decision-led view", () => {
    const model = buildModel("ready");

    expect(model.decision).toContain("£6,200 in eligible revenue");
    expect(model.primaryMetrics.map((metric) => metric.value)).toEqual([
      "7",
      "4",
      "£6,200",
      "1.24×",
    ]);
    expect(model.chartPoints).toHaveLength(4);
    expect(model.creators.map((creator) => creator.action)).toEqual([
      "Expand",
      "Retain",
      "Retain",
    ]);
  });

  it("keeps missing evidence unavailable rather than converting it to zero", () => {
    const model = buildModel("partial");

    expect(model.decision).toContain("still needs eligible evidence");
    expect(
      model.primaryMetrics.every((metric) => metric.status === "unavailable"),
    ).toBe(true);
    expect(model.primaryMetrics.map((metric) => metric.value)).toEqual([
      "Not available",
      "Not available",
      "Not available",
      "Not available",
    ]);
    expect(
      model.creators.every((creator) => creator.qualifiedWallets === null),
    ).toBe(true);
  });
});
