import { describe, expect, it } from "vitest";
import {
  clarityCsv,
  clarityMetrics,
  clarityMoney,
  clarityRate,
  parseClarityQuery,
  parseHeadlineMetrics,
} from "./clarity";
import { buildReportVisualFixture } from "./visual-fixtures";

describe("Clarity issued report presentation", () => {
  it("normalizes metric preferences without accepting invented measures", () => {
    expect(
      parseHeadlineMetrics("impressions,activated,activated,spend"),
    ).toEqual(["activated", "spend"]);
    expect(parseHeadlineMetrics("__proto__,unknown")).toEqual([
      "spend",
      "qualified",
      "cpqw",
      "revenue",
    ]);
    expect(
      parseHeadlineMetrics(
        "spend,clicks,qualified,activated,cpc,cpqw,cpa,revenue,roas",
      ),
    ).toHaveLength(6);
    expect(
      parseClarityQuery(new URLSearchParams("chart=impressions")),
    ).toMatchObject({ chart: "both" });
  });
  it("formats exact minor units without floating-point loss", () => {
    expect(clarityMoney("900719925474099301")).toBe(
      "£9,007,199,254,740,993.01",
    );
    expect(clarityMoney("0")).toBe("£0.00");
    expect(clarityMoney(null)).toBe("Not available");
    expect(clarityMoney("-101")).toBe("−£1.01");
    expect(clarityRate("999.50", "GBP")).toBe("£10.00");
  });
  it("retains issued counts, spend and known zero independently", () => {
    const fixture = buildReportVisualFixture("ready");
    const result = clarityMetrics(fixture.selectedVersion);
    expect(result).toMatchObject({
      qualified: 7,
      clicks: 24,
      activated: 4,
      spend: "£5,000.00",
      revenue: "£6,200.00",
      cpqw: "£714.29",
      cpa: "£1,250.00",
    });
    const version = structuredClone(fixture.selectedVersion);
    if (version.metricSnapshot.metrics.cpqw.denominator.status === "available")
      version.metricSnapshot.metrics.cpqw.denominator.value = 0;
    expect(clarityMetrics(version).qualified).toBe(0);
  });
  it("does not suppress wallet counts merely because revenue is absent", () => {
    const version = structuredClone(
      buildReportVisualFixture("ready").selectedVersion,
    );
    const partial = buildReportVisualFixture("partial").selectedVersion;
    version.metricSnapshot.metrics.revenueRoas =
      partial.metricSnapshot.metrics.revenueRoas;
    expect(clarityMetrics(version)).toMatchObject({
      qualified: 7,
      revenue: "Not available",
    });
  });
  it("exports selected immutable version with unavailable values explicit", () => {
    const fixture = buildReportVisualFixture("partial");
    const csv = clarityCsv(fixture.comparisonVersion);
    expect(csv).toContain('"1","2026-08-12T12:00:00.000Z"');
    expect(csv).toContain('"qualified","not_available"');
    expect(csv).toContain("complete issued campaign snapshot");
    expect(csv).toContain("exact outcome provenance unavailable");
  });
  it("exports each metric's retained freshness and evidence provenance", () => {
    const version = structuredClone(
      buildReportVisualFixture("ready").selectedVersion,
    );
    version.metricSnapshot.metrics.cpc.dataFreshness.dataThrough =
      "2026-08-01T01:00:00.000Z";
    version.metricSnapshot.metrics.cpqw.dataFreshness.dataThrough =
      "2026-08-02T02:00:00.000Z";
    version.metricSnapshot.metrics.cpa.dataFreshness.dataThrough =
      "2026-08-03T03:00:00.000Z";
    version.metricSnapshot.metrics.revenueRoas.dataFreshness.dataThrough =
      "2026-08-04T04:00:00.000Z";
    const csv = clarityCsv(
      version,
      undefined,
      "selected issued result",
      "synthetic",
    );
    const lines = csv.split("\r\n");
    expect(lines.find((line) => line.includes('"qualified"'))).toContain(
      "2026-08-02T02:00:00.000Z",
    );
    expect(lines.find((line) => line.includes('"activated"'))).toContain(
      "2026-08-03T03:00:00.000Z",
    );
    expect(lines.find((line) => line.includes('"revenue"'))).toContain(
      "2026-08-04T04:00:00.000Z",
    );
    expect(csv).toContain(
      "synthetic demo evidence; wallet signatures and consent simulated",
    );
  });
  it("normalizes URL state without widening the fixture boundary", () => {
    expect(
      parseClarityQuery(
        new URLSearchParams(
          "view=funnel&theme=dark&version=1&compare=1&creator=alice",
        ),
      ),
    ).toEqual({
      view: "funnel",
      theme: "dark",
      version: 1,
      compare: 1,
      creator: "alice",
      group: "creator",
      detail: "",
      metrics: "spend,qualified,cpqw,revenue",
      chart: "both",
      evidence: "",
    });
    expect(
      parseClarityQuery(
        new URLSearchParams("view=secret&version=100&theme=bad"),
      ),
    ).toMatchObject({ view: "performance", version: 100, theme: "light" });
    expect(
      parseClarityQuery(
        new URLSearchParams("version=28&compare=11&evidence=qualified_wallets"),
      ),
    ).toMatchObject({
      version: 28,
      compare: 11,
      evidence: "qualified_wallets",
    });
    expect(
      parseClarityQuery(new URLSearchParams("evidence=all")),
    ).toMatchObject({ evidence: "all" });
  });
});
