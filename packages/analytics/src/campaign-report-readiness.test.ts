import { describe, expect, it } from "vitest";

import fixture from "./fixtures/campaign-report-review.json";
import { buildCampaignReportReview } from "./campaign-report-readiness";

const input = () => structuredClone(fixture);
const missingId = "99999999-9999-4999-8999-999999999999";

function recordedInput() {
  const raw = input();
  return {
    ...raw,
    historyReadiness: {
      ...raw.historyReadiness,
      mappings: raw.historyReadiness.mappings.map((mapping, index) => {
        const job = {
          id: `80808080-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          environment: index === 0 ? "demo" : "devnet",
          startedAt: mapping.requiredHistory.startedAt,
          endedAt: "2026-09-10T12:00:00+00:00",
          completedAt: "2026-09-11T02:00:00+00:00",
        };
        return {
          ...mapping,
          requiredHistory: { ...mapping.requiredHistory, endedAt: job.endedAt },
          status: "history_recorded",
          matchingJob: job,
          latestJob: {
            ...job,
            status: "completed",
            normalizationIssueCount: 0,
          },
        };
      }),
    },
  };
}

describe("BSK-09 coherent unissued report review", () => {
  it("accepts actual SQL sources and two same-creator mapping diagnostics", () => {
    const review = buildCampaignReportReview(fixture);
    expect(review.historyReadiness).toMatchObject({
      completeness: "not_established",
      mappingCount: 2,
      recordedHistoryCount: 0,
      missingHistoryCount: 2,
      latestFailedCount: 0,
      latestNormalizationIssueCount: 0,
      environments: [],
    });
    expect(review.observedEvidence.resultCount).toBe(2);
    expect(review.approvedCommitment).toMatchObject({
      status: "available",
      amountMinor: "519500",
    });
    expect(review.issuance.status).toBe("blocked");
  });

  it("all recorded-job diagnostics never upgrade completeness or ratios", () => {
    const review = buildCampaignReportReview(recordedInput());
    expect(review.historyReadiness).toMatchObject({
      mappingCount: 2,
      recordedHistoryCount: 2,
      missingHistoryCount: 0,
      completeness: "not_established",
      environments: ["demo", "devnet"],
    });
    expect(review.observedEvidence.completeness).toBe("not_established");
    expect(review.metrics.cpa).toEqual({
      status: "not_available",
      reason: "source_incomplete",
    });
    expect(review.metrics.revenueRoas).toEqual({
      status: "not_available",
      reason: "source_not_configured",
    });
    expect(review.issuance.status).toBe("blocked");
  });

  it("keeps latest failure and normalization warnings beside older recorded history", () => {
    const raw = recordedInput();
    const first = raw.historyReadiness.mappings[0]!;
    const failed = {
      ...first.latestJob,
      id: missingId,
      status: "failed",
      completedAt: null,
      normalizationIssueCount: 2,
    };
    const review = buildCampaignReportReview({
      ...raw,
      historyReadiness: {
        ...raw.historyReadiness,
        mappings: [
          { ...first, latestJob: failed },
          raw.historyReadiness.mappings[1]!,
        ],
      },
    });
    expect(review.historyReadiness).toMatchObject({
      recordedHistoryCount: 2,
      latestFailedCount: 1,
      latestNormalizationIssueCount: 1,
    });
    expect(review.issuance.status).toBe("blocked");
  });

  it("partial mapping history remains explicit", () => {
    const raw = recordedInput();
    const review = buildCampaignReportReview({
      ...raw,
      historyReadiness: {
        ...raw.historyReadiness,
        mappings: [
          raw.historyReadiness.mappings[0]!,
          fixture.historyReadiness.mappings[1]!,
        ],
      },
    });
    expect(review.historyReadiness).toMatchObject({
      recordedHistoryCount: 1,
      missingHistoryCount: 1,
      completeness: "not_established",
    });
  });

  it("zero mappings do not prove all result histories covered", () => {
    const raw = input();
    raw.historyReadiness.mappings = [];
    const review = buildCampaignReportReview(raw);
    expect(review.historyReadiness).toMatchObject({
      mappingCount: 0,
      recordedHistoryCount: 0,
      completeness: "not_established",
    });
    expect(review.issuance.status).toBe("blocked");
  });

  it.each(["workspaceId", "projectId", "campaignId", "ruleVersionId"] as const)(
    "rejects differing %s across composed sources",
    (key) => {
      const raw = input();
      raw.historyReadiness[key] = missingId;
      expect(() => buildCampaignReportReview(raw)).toThrow();
    },
  );

  it("rejects one-microsecond difference between approved windows", () => {
    const raw = input();
    raw.historyReadiness.measurementWindow.startedAt =
      "2026-09-07T00:00:00.000001Z";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("accepts equivalent offsets without discarding microseconds", () => {
    const raw = input();
    raw.historyReadiness.measurementWindow.startedAt =
      "2026-09-07T01:00:00+01:00";
    expect(() => buildCampaignReportReview(raw)).not.toThrow();
  });

  it("allows the required first-event history to precede measurement start", () => {
    const raw = input();
    expect(raw.historyReadiness.mappings[0]!.requiredHistory.startedAt).toBe(
      "2026-09-06T13:00:00+00:00",
    );
    expect(() => buildCampaignReportReview(raw)).not.toThrow();
  });

  it("rejects required history preceding rule effectiveness", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.requiredHistory.startedAt =
      "2026-08-31T23:59:59.999999Z";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects a non-overlapping required range", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.requiredHistory.endedAt =
      raw.historyReadiness.measurementWindow.startedAt;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects range exceeding approved end", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.requiredHistory.endedAt =
      "2026-10-05T00:00:00.000001Z";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects duplicate mapping identities", () => {
    const raw = input();
    raw.historyReadiness.mappings[1]!.mappingId =
      raw.historyReadiness.mappings[0]!.mappingId;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects mapping creator outside approved packages", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.creatorId = missingId;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects recorded status without a matching job", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.status = "history_recorded";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects matching job when status is not established", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.status = "history_not_established";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects matching job missing required pre-window history", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.matchingJob.startedAt =
      raw.historyReadiness.measurementWindow.startedAt;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects matching job ending one microsecond too early", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.matchingJob.endedAt =
      "2026-09-10T11:59:59.999999Z";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects matching job completed before range end", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.matchingJob.completedAt =
      "2026-09-09T00:00:00Z";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects matching and latest metadata disagreement for same ID", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.latestJob.normalizationIssueCount = 1;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects unsupported job environment", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[0]!.matchingJob.environment = "production";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects same job reused for distinct mappings", () => {
    const raw = recordedInput();
    raw.historyReadiness.mappings[1]!.matchingJob.id =
      raw.historyReadiness.mappings[0]!.matchingJob.id;
    raw.historyReadiness.mappings[1]!.latestJob.id =
      raw.historyReadiness.mappings[0]!.latestJob.id;
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });

  it("rejects unknown diagnostic fields", () => {
    const raw = input();
    expect(() =>
      buildCampaignReportReview({
        ...raw,
        historyReadiness: {
          ...raw.historyReadiness,
          walletAddress: "protected",
        },
      }),
    ).toThrow();
    expect(() =>
      buildCampaignReportReview({ ...raw, coverage: "complete" }),
    ).toThrow();
  });

  it("rejects an upgraded completeness or issuance claim", () => {
    const raw = input();
    raw.historyReadiness.completeness = "complete";
    expect(() => buildCampaignReportReview(raw)).toThrow();
    expect(() =>
      buildCampaignReportReview({
        ...fixture,
        historyReadiness: { ...fixture.historyReadiness, issuance: "ready" },
      }),
    ).toThrow();
  });

  it("rejects invalid time without uncaught bigint conversion errors", () => {
    const raw = input();
    raw.historyReadiness.mappings[0]!.requiredHistory.startedAt = "not-a-time";
    expect(() => buildCampaignReportReview(raw)).toThrow();
  });
});
