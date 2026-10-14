import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/timed-campaign-execution-report.json";
import { loadTimedCampaignExecutionReportReview } from "./campaign-execution.server";
import { buildTimedSourceEvidenceManifest } from "./source-evidence-manifest.server";

type Review = Awaited<
  ReturnType<typeof loadTimedCampaignExecutionReportReview>
>;
const otherId = "99999999-0000-4000-8000-000000000001";

async function read(key: "beforeReceipt" | "afterReceipt" = "afterReceipt") {
  const raw = structuredClone(fixture[key]);
  const review = raw.execution.preview.review;
  const client = { rpc: vi.fn().mockResolvedValue({ data: raw, error: null }) };
  const result = await loadTimedCampaignExecutionReportReview(
    client,
    {
      workspaceId: review.workspaceId,
      projectId: review.projectId,
      campaignId: review.campaignId,
    },
    raw.execution.approvalId,
  );
  return { result, client };
}

describe("server-only timed source evidence manifest", () => {
  it.each(["beforeReceipt", "afterReceipt"] as const)(
    "projects real SQL %s without another RPC or changing evidence",
    async (key) => {
      const { result, client } = await read(key);
      const original = structuredClone(result);
      const manifest = buildTimedSourceEvidenceManifest(result);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(result).toEqual(original);
      expect(manifest.databaseReadAt).toBe(result.execution.readAt);
      expect(manifest.approvedTiming).toEqual({
        flight: result.reportReview.approvedTiming.flight,
        measurement: result.reportReview.approvedTiming.measurement,
      });
      expect(manifest.execution.receiptObservation).toBe(
        key === "afterReceipt" ? "recorded" : "not_recorded",
      );
      expect(manifest.candidateEvidence).toHaveLength(1);
      expect(manifest.candidateEvidence[0]?.receiptEvidence).toBe(
        key === "afterReceipt" ? "recorded" : "not_recorded",
      );
      expect(manifest.candidateEvidence[0]?.reportEvidence).toBe(
        key === "afterReceipt" ? "retained" : "not_observed",
      );
      expect(manifest.observedSources.retainedResultCount).toBe(
        key === "afterReceipt" ? 1 : 0,
      );
      expect(manifest.completeness).toBe("not_established");
      expect(manifest.dataFreshness).toBe("not_established");
      expect(manifest.reportIssuance).toBe("blocked");
      expect(manifest.metricV1PeriodCompatibility).toMatchObject({
        status: "exactly_representable",
        retainedRange: result.reportReview.approvedTiming.measurement,
        metricV1Range: {
          startedAt: "2026-09-07T00:00:00.000Z",
          endedAt: "2026-10-05T00:00:00.000Z",
        },
      });
      expect(manifest.unresolvedSourceRequirements).toEqual([
        "campaign_coverage_not_established",
        "data_freshness_not_established",
      ]);
      expect(manifest.diagnosticMeaning).toBe(
        "retained_observations_not_issuance_authority",
      );
      expect(manifest.candidateEvidence[0]?.diagnostics).toEqual(
        key === "afterReceipt"
          ? ["required_history_not_established"]
          : [
              "execution_receipt_not_recorded",
              "report_result_not_observed",
              "required_history_not_established",
            ],
      );
      expect(manifest.historyRelationshipScope).toBe(
        "approved_candidate_subset_only",
      );
    },
  );

  it("joins only the exact candidate mapping, never another mapping for the same creator", async () => {
    const { result } = await read();
    const mappingId =
      result.execution.preview.review.candidates[0]!.protectedWalletMappingId;
    result.reportReview.historyReadiness.mappings =
      result.reportReview.historyReadiness.mappings.filter(
        (mapping) => mapping.mappingId !== mappingId,
      );
    const row = buildTimedSourceEvidenceManifest(result).candidateEvidence[0]!;
    expect(row.historyObservation).toBe("history_not_established");
    expect(row.requiredHistory).toBeNull();
    expect(row.matchingJob).toBeNull();
    expect(row.latestJob).toBeNull();
    expect(row.diagnostics).toEqual(["required_history_not_established"]);
    expect(row.reportEvidence).toBe("retained");
  });

  it("retains older matching history, latest failure and separate source environments without certifying coverage", async () => {
    const { result } = await read();
    const history = result.reportReview.historyReadiness.mappings[0]!;
    // Synthetic diagnostic variation, not a claim that the SQL fixture acquired history.
    history.status = "history_recorded";
    history.matchingJob = {
      id: otherId,
      environment: "mainnet",
      ...history.requiredHistory,
      completedAt: "2026-09-14T00:00:00.000001Z",
    };
    history.latestJob = {
      id: "99999999-0000-4000-8000-000000000002",
      environment: "devnet",
      ...history.requiredHistory,
      status: "failed",
      normalizationIssueCount: 3,
      completedAt: null,
    };
    const manifest = buildTimedSourceEvidenceManifest(result);
    expect(manifest.candidateEvidence[0]?.matchingJob).toMatchObject({
      id: otherId,
      environment: "mainnet",
      completedAt: "2026-09-14T00:00:00.000001Z",
    });
    expect(manifest.candidateEvidence[0]?.latestJob).toMatchObject({
      environment: "devnet",
      status: "failed",
      normalizationIssueCount: 3,
    });
    expect(manifest.execution.candidateEnvironments).toEqual(["demo"]);
    expect(manifest.candidateEvidence[0]?.diagnostics).toEqual([
      "latest_history_job_failed",
      "latest_history_job_has_normalization_issues",
    ]);
    expect(manifest.completeness).toBe("not_established");
    expect(manifest.dataFreshness).toBe("not_established");
    expect(manifest.reportIssuance).toBe("blocked");
  });

  it("empty source/history records remain observations rather than known-zero outcomes", async () => {
    const { result } = await read("beforeReceipt");
    result.reportReview.historyReadiness.mappings = [];
    const manifest = buildTimedSourceEvidenceManifest(result);
    expect(manifest.observedSources.retainedResultCount).toBe(0);
    expect(manifest.execution.receiptObservation).toBe("not_recorded");
    expect(manifest.candidateEvidence[0]?.historyObservation).toBe(
      "history_not_established",
    );
    expect(manifest.completeness).toBe("not_established");
    expect(manifest).not.toHaveProperty("ready");
    expect(manifest).not.toHaveProperty("retryAllowed");
  });

  it("clean recorded candidate history never removes campaign-wide uncertainty", async () => {
    const { result } = await read();
    const history = result.reportReview.historyReadiness.mappings[0]!;
    history.status = "history_recorded";
    history.matchingJob = {
      id: otherId,
      environment: "demo",
      ...history.requiredHistory,
      completedAt: "2026-09-14T00:00:00.000001Z",
    };
    history.latestJob = {
      ...history.matchingJob,
      status: "completed",
      normalizationIssueCount: 0,
    };
    const manifest = buildTimedSourceEvidenceManifest(result);
    expect(manifest.candidateEvidence[0]?.diagnostics).toEqual([]);
    expect(manifest.unresolvedSourceRequirements).toHaveLength(2);
    expect(manifest.reportIssuance).toBe("blocked");
    expect(manifest).not.toHaveProperty("ready");
    expect(manifest).not.toHaveProperty("retryAllowed");
  });

  it.each(["queued", "running", "completed"] as const)(
    "does not mislabel a %s latest job as failed or infer history from job status",
    async (status) => {
      const { result } = await read();
      const history = result.reportReview.historyReadiness.mappings[0]!;
      history.latestJob = {
        id: otherId,
        environment: "demo",
        ...history.requiredHistory,
        status,
        normalizationIssueCount: 1,
        completedAt:
          status === "completed" ? "2026-09-14T00:00:00.000001Z" : null,
      };
      const manifest = buildTimedSourceEvidenceManifest(result);
      expect(manifest.candidateEvidence[0]?.diagnostics).toEqual([
        "required_history_not_established",
        "latest_history_job_has_normalization_issues",
      ]);
      expect(manifest.reportIssuance).toBe("blocked");
    },
  );

  it("preserves post-flight evidence and microseconds without treating planned duration as observed coverage", async () => {
    const { result } = await read();
    const manifest = buildTimedSourceEvidenceManifest(result);
    expect(
      manifest.observedSources.periods.map((p) => [
        p.period,
        p.retainedResultCount,
      ]),
    ).toEqual([
      ["in_flight", 0],
      ["post_flight", 1],
    ]);
    expect(manifest.databaseReadAt).toMatch(/\.\d{6}Z$/);
    expect(manifest.readTimeMeaning).toBe("database_snapshot_only");
    for (const period of manifest.observedSources.periods)
      expect(period.observedCoverage).toBe("not_established");
    expect(manifest).not.toHaveProperty("dataThrough");
    expect(manifest).not.toHaveProperty("observedDuration");
  });

  it("emits an allowlisted projection without protected mapping IDs, raw reviews, free text or money", async () => {
    const { result } = await read();
    const manifest = buildTimedSourceEvidenceManifest(result);
    const serialized = JSON.stringify(manifest);
    for (const candidate of result.execution.preview.review.candidates)
      expect(serialized).not.toContain(candidate.protectedWalletMappingId);
    for (const mapping of result.reportReview.historyReadiness.mappings)
      expect(serialized).not.toContain(mapping.mappingId);
    expect(serialized).not.toMatch(
      /protectedWallet|mappingId|walletAddress|approvedCommitment|amountMinor|valuation|currencyCode/,
    );
    expect(manifest).not.toHaveProperty("preview");
    expect(manifest).not.toHaveProperty("reason");
    expect(manifest).not.toHaveProperty("metrics");
    expect(manifest).not.toHaveProperty("eligibleSpend");
  });

  const mutations: Array<[string, (result: Review) => void]> = [
    [
      "duplicate candidate",
      (r) => {
        r.execution.preview.review.candidates.push(
          r.execution.preview.review.candidates[0]!,
        );
      },
    ],
    [
      "duplicate history",
      (r) => {
        r.reportReview.historyReadiness.mappings.push(
          r.reportReview.historyReadiness.mappings[0]!,
        );
      },
    ],
    [
      "receipt tuple drift",
      (r) => {
        r.execution.receipt!.batch.results[0]!.attributionFactId = otherId;
      },
    ],
    [
      "missing receipt result",
      (r) => {
        r.execution.receipt!.batch.results = [];
      },
    ],
    [
      "duplicate receipt result",
      (r) => {
        r.execution.receipt!.batch.results.push(
          r.execution.receipt!.batch.results[0]!,
        );
      },
    ],
    [
      "receipt approval mismatch",
      (r) => {
        r.execution.receipt!.approvalId = otherId;
      },
    ],
    [
      "missing report result",
      (r) => {
        r.reportReview.temporalEvidence.periods.forEach((p) => {
          p.resultEvidence = [];
        });
      },
    ],
    [
      "report event mismatch",
      (r) => {
        r.reportReview.temporalEvidence.periods.flatMap(
          (p) => p.resultEvidence,
        )[0]!.canonicalChainEventId = otherId;
      },
    ],
    [
      "report attribution mismatch",
      (r) => {
        r.reportReview.temporalEvidence.periods.flatMap(
          (p) => p.resultEvidence,
        )[0]!.attributionFactId = otherId;
      },
    ],
    [
      "mapping creator mismatch",
      (r) => {
        r.reportReview.historyReadiness.mappings[0]!.creatorId = otherId;
      },
    ],
    [
      "mapping asset mismatch",
      (r) => {
        r.reportReview.historyReadiness.mappings[0]!.contentAssetId = otherId;
      },
    ],
    [
      "false history recorded",
      (r) => {
        r.reportReview.historyReadiness.mappings[0]!.status =
          "history_recorded";
      },
    ],
    [
      "plan mismatch",
      (r) => {
        r.reportReview.commercialPlanVersionId = otherId;
      },
    ],
    [
      "microsecond measurement mismatch",
      (r) => {
        r.reportReview.approvedTiming.measurement.endedAt =
          "2026-10-05T00:00:00.000001Z";
      },
    ],
  ];
  it.each(mutations)("fails closed on %s", async (_name, mutate) => {
    const { result } = await read();
    mutate(result);
    expect(() => buildTimedSourceEvidenceManifest(result)).toThrow(
      "Source evidence relationships could not be confirmed.",
    );
  });
});
