import { describe, expect, it } from "vitest";
import fixture from "./fixtures/campaign-report-review.json";
import timedSqlFixture from "./fixtures/timed-campaign-report-review.json";
import {
  buildCampaignReportPreview,
  buildTimedCampaignReportPreview,
} from "./campaign-report-preview";
import {
  buildCampaignReportReview,
  buildTimedCampaignReportReview,
} from "./campaign-report-readiness";

// Synthetic timing variant of retained SQL evidence; not a new issued approval.
function timed() {
  const raw = structuredClone(fixture);
  const binding = raw.reportSources.commercialPlanSnapshot.strategyBinding;
  return {
    ...raw,
    reportSources: {
      ...raw.reportSources,
      commercialPlanSnapshot: {
        ...raw.reportSources.commercialPlanSnapshot,
        strategyBinding: {
          ...binding,
          schemaVersion: 2,
          timing: {
            schemaVersion: 1,
            flight: {
              ...binding.measurementWindow,
              endedAt: "2026-09-08T00:00:00.000000Z",
            },
            measurement: { ...binding.measurementWindow },
          },
        },
      },
    },
  };
}

describe("BSK-09 private timed report preparation", () => {
  it("accepts actual isolated timed SQL output without rewriting retained timing", () => {
    const preview = buildTimedCampaignReportReview(timedSqlFixture);
    expect(preview.approvedTiming).toEqual(
      timedSqlFixture.reportSources.commercialPlanSnapshot.strategyBinding
        .timing,
    );
    expect(preview.issuance.status).toBe("blocked");
    expect(preview.observedEvidence.completeness).toBe("not_established");
  });
  it("retains exact timing and post-flight observations without inventing report readiness", () => {
    const raw = timed();
    const retained = structuredClone(raw);
    const preview = buildTimedCampaignReportReview(raw);
    expect(preview.approvedTiming).toEqual(
      raw.reportSources.commercialPlanSnapshot.strategyBinding.timing,
    );
    expect(preview.measurementWindow).toEqual(
      raw.reportSources.measurementWindow,
    );
    expect(preview.observedEvidence.resultCount).toBe(
      raw.reportSources.results.length,
    );
    expect(preview.approvedCommitment).toEqual(
      buildCampaignReportReview(fixture).approvedCommitment,
    );
    expect(preview.issuance).toEqual(
      buildCampaignReportReview(fixture).issuance,
    );
    expect(preview.metrics).toEqual(buildCampaignReportReview(fixture).metrics);
    expect(preview).not.toHaveProperty("dataFreshness");
    expect(raw).toEqual(retained);
  });
  it("keeps legacy readers closed to timed bindings", () => {
    expect(() => buildCampaignReportReview(timed())).toThrow();
    expect(() => buildCampaignReportPreview(timed().reportSources)).toThrow();
  });
  it("does not invent flight for old bindings", () => {
    expect(buildCampaignReportReview(fixture)).not.toHaveProperty(
      "approvedTiming",
    );
    expect(() => buildTimedCampaignReportReview(fixture)).toThrow();
    expect(buildCampaignReportReview(fixture)).not.toHaveProperty(
      "temporalEvidence",
    );
  });
  it.each(["startedAt", "endedAt"] as const)(
    "rejects one-microsecond measurement %s drift",
    (key) => {
      const raw = timed();
      const timing =
        raw.reportSources.commercialPlanSnapshot.strategyBinding.timing;
      timing.measurement[key] = timing.measurement[key].replace(
        ".000000Z",
        ".000001Z",
      );
      expect(() => buildTimedCampaignReportReview(raw)).toThrow();
    },
  );
  it("rejects flight beyond measurement", () => {
    const raw = timed();
    raw.reportSources.commercialPlanSnapshot.strategyBinding.timing.flight.endedAt =
      "2026-11-01T00:00:00Z";
    expect(() => buildTimedCampaignReportReview(raw)).toThrow();
  });
  it("rejects unknown timing version and fields", () => {
    const raw = timed();
    raw.reportSources.commercialPlanSnapshot.strategyBinding.timing.schemaVersion = 3;
    expect(() => buildTimedCampaignReportReview(raw)).toThrow();
    const clean = timed();
    const plan = clean.reportSources.commercialPlanSnapshot;
    expect(() =>
      buildTimedCampaignReportPreview({
        ...clean.reportSources,
        commercialPlanSnapshot: {
          ...plan,
          strategyBinding: {
            ...plan.strategyBinding,
            timing: { ...plan.strategyBinding.timing, inferred: true },
          },
        },
      }),
    ).toThrow();
  });
  it("keeps empty timed evidence incomplete rather than claiming zero performance", () => {
    const raw = timed();
    raw.reportSources.results = [];
    raw.reportSources.walletAttributionEvidenceIds = [];
    const result = buildTimedCampaignReportReview(raw);
    expect(result.observedEvidence).toMatchObject({
      completeness: "not_established",
      resultCount: 0,
    });
    expect(result.issuance.status).toBe("blocked");
    expect(result.metrics.cpa.status).toBe("not_available");
  });
  it("rejects results outside approved measurement even when flight is valid", () => {
    const raw = timed();
    raw.reportSources.results[0]!.conversionTime =
      raw.reportSources.measurementWindow.endedAt;
    expect(() => buildTimedCampaignReportReview(raw)).toThrow();
  });
  it("preserves history scope and period checks", () => {
    const raw = timed();
    raw.historyReadiness.campaignId = "99999999-0000-4000-8000-000000000001";
    expect(() => buildTimedCampaignReportReview(raw)).toThrow();
  });
});

describe("timed event evidence partition", () => {
  function withEvents(times: string[]) {
    const raw = timed();
    const row = raw.reportSources.results[0]!;
    raw.reportSources.results = times.map((conversionTime, index) => ({
      ...row,
      conversionTime,
      touchTime: new Date(Date.parse(conversionTime) - 3_600_000).toISOString(),
      ...Object.fromEntries(
        [
          "conversionFactId",
          "attributionFactId",
          "calculationRequestId",
          "auditId",
          "canonicalChainEventId",
        ].map((key, field) => [
          key,
          `99999999-0000-4000-8000-${String(index * 10 + field + 1).padStart(12, "0")}`,
        ]),
      ),
    }));
    raw.reportSources.walletAttributionEvidenceIds =
      raw.reportSources.results.map((result) => result.attributionFactId);
    return raw;
  }
  it("assigns every retained result exactly once at microsecond half-open boundaries", () => {
    const raw = withEvents([
      "2026-09-07T00:00:00.000000Z",
      "2026-09-07T12:00:00.000000Z",
      "2026-09-07T12:00:00.000001Z",
      "2026-09-08T00:00:00.000000Z",
      "2026-09-08T00:00:00.000001Z",
      "2026-10-04T23:59:59.999999Z",
    ]);
    const timing =
      raw.reportSources.commercialPlanSnapshot.strategyBinding.timing;
    timing.flight.startedAt = "2026-09-07T12:00:00.000001Z";
    timing.flight.endedAt = "2026-09-08T00:00:00.000001Z";
    const result = buildTimedCampaignReportReview(raw).temporalEvidence;
    expect(
      result.periods.map((period) => [
        period.period,
        period.retainedResultCount,
      ]),
    ).toEqual([
      ["pre_flight", 2],
      ["in_flight", 2],
      ["post_flight", 2],
    ]);
    const ids = result.periods.flatMap((period) =>
      period.resultEvidence.map((row) => row.attributionFactId),
    );
    expect(ids).toEqual(
      raw.reportSources.results.map((row) => row.attributionFactId),
    );
    expect(new Set(ids).size).toBe(6);
    expect(result.periods[0]!.plannedDurationMicroseconds).toBe("43200000001");
    expect(result.periods[1]!.plannedDurationMicroseconds).toBe("43200000000");
    expect(
      result.periods.reduce(
        (sum, period) => sum + BigInt(period.plannedDurationMicroseconds),
        0n,
      ),
    ).toBe(28n * 86_400_000_000n);
  });
  it("uses conversion time rather than touch time, source order or refresh time", () => {
    const raw = withEvents(["2026-09-08T01:00:00Z", "2026-09-07T01:00:00Z"]);
    raw.reportSources.results[0]!.touchTime = "2026-09-07T23:59:59Z";
    const result = buildTimedCampaignReportReview(raw).temporalEvidence;
    expect(result.basis).toBe("conversion_event_time");
    expect(result.periods[0]!.resultEvidence[0]!.attributionFactId).toBe(
      raw.reportSources.results[1]!.attributionFactId,
    );
    expect(result.periods[1]!.resultEvidence[0]!.attributionFactId).toBe(
      raw.reportSources.results[0]!.attributionFactId,
    );
  });
  it("preserves exact offset timestamps and confidence in evidence references", () => {
    const raw = withEvents(["2026-09-08T01:00:00.000001+01:00"]);
    const row = raw.reportSources.results[0]!;
    const result = buildTimedCampaignReportReview(raw).temporalEvidence;
    expect(result.periods[1]!.resultEvidence).toEqual([
      {
        conversionFactId: row.conversionFactId,
        attributionFactId: row.attributionFactId,
        canonicalChainEventId: row.canonicalChainEventId,
        creatorId: row.creatorId,
        contentAssetId: row.contentAssetId,
        conversionTime: row.conversionTime,
        confidence: row.confidence,
      },
    ]);
  });
  it("omits zero-duration outer periods rather than inventing a measurement extension", () => {
    const raw = withEvents([]);
    const timing =
      raw.reportSources.commercialPlanSnapshot.strategyBinding.timing;
    timing.flight = { ...timing.measurement };
    const result = buildTimedCampaignReportReview(raw).temporalEvidence;
    expect(result.periods.map((p) => p.period)).toEqual(["in_flight"]);
    expect(result.periods[0]!.retainedResultCount).toBe(0);
    expect(result.periods[0]!.observedCoverage).toBe("not_established");
    expect(result.completeness).toBe("not_established");
    expect(result.dataFreshness).toBe("not_established");
  });
  it("does not introduce unsupported wallet/click cohorts, financial metrics or baseline claims", () => {
    const raw = withEvents(["2026-09-07T01:00:00Z"]);
    raw.reportSources.commercialPlanSnapshot.strategyBinding.timing.flight.startedAt =
      "2026-09-07T12:00:00Z";
    const result = buildTimedCampaignReportReview(raw);
    expect(result.temporalEvidence.periods[0]!.period).toBe("pre_flight");
    for (const period of result.temporalEvidence.periods) {
      expect(Object.keys(period).sort()).toEqual(
        [
          "observedCoverage",
          "period",
          "plannedDurationMicroseconds",
          "resultEvidence",
          "retainedResultCount",
          "window",
        ].sort(),
      );
    }
    expect(result.issuance.status).toBe("blocked");
    expect(result.metrics.cpa.status).toBe("not_available");
    expect(result.metrics.revenueRoas.status).toBe("not_available");
  });
  it.each(["2026-09-06T23:59:59.999999Z", "2026-10-05T00:00:00.000000Z"])(
    "rejects out-of-measurement event %s instead of silently dropping it",
    (time) => {
      expect(() =>
        buildTimedCampaignReportReview(withEvents([time])),
      ).toThrow();
    },
  );
  it("is deterministic and does not mutate retained input", () => {
    const raw = withEvents(["2026-09-08T12:00:00Z"]);
    const copy = structuredClone(raw);
    expect(buildTimedCampaignReportReview(raw).temporalEvidence).toEqual(
      buildTimedCampaignReportReview(raw).temporalEvidence,
    );
    expect(raw).toEqual(copy);
  });
});
