import { describe, expect, it, vi } from "vitest";
import legacyFixture from "./fixtures/campaign-execution-report.json";
import sqlFixture from "./fixtures/timed-campaign-execution-report.json";
import {
  loadCampaignExecutionReportReview,
  loadTimedCampaignExecutionReportReview,
} from "./campaign-execution.server";

// Synthetic timed variation for adversarial adapter checks, not SQL provenance.
function timed() {
  const raw = structuredClone(legacyFixture.afterReceipt);
  const snapshot = raw.reportReview.reportSources.commercialPlanSnapshot;
  return {
    ...raw,
    reportReview: {
      ...raw.reportReview,
      reportSources: {
        ...raw.reportReview.reportSources,
        commercialPlanSnapshot: {
          ...snapshot,
          strategyBinding: {
            ...snapshot.strategyBinding,
            schemaVersion: 2,
            timing: {
              schemaVersion: 1,
              flight: {
                ...snapshot.strategyBinding.measurementWindow,
                endedAt: "2026-09-08T00:00:00.000000Z",
              },
              measurement: { ...snapshot.strategyBinding.measurementWindow },
            },
          },
        },
      },
    },
  };
}
const base = timed();
const scope = {
  workspaceId: base.execution.preview.review.workspaceId,
  projectId: base.execution.preview.review.projectId,
  campaignId: base.execution.preview.review.campaignId,
};
const approvalId = base.execution.approvalId;
const otherId = "99999999-0000-4000-8000-000000000001";
const client = (data: unknown = timed()) => ({
  rpc: vi.fn().mockResolvedValue({ data, error: null }),
});
const read = (data: unknown) =>
  loadTimedCampaignExecutionReportReview(client(data), scope, approvalId);

describe("private timed execution/report recovery", () => {
  it.each(["beforeReceipt", "afterReceipt"] as const)(
    "reads real isolated timed SQL %s output without changing its evidence",
    async (key) => {
      const raw = sqlFixture[key];
      const review = raw.execution.preview.review;
      const result = await loadTimedCampaignExecutionReportReview(
        client(raw),
        {
          workspaceId: review.workspaceId,
          projectId: review.projectId,
          campaignId: review.campaignId,
        },
        raw.execution.approvalId,
      );
      expect(result.execution.receipt).toEqual(raw.execution.receipt);
      expect(result.execution.preview).toEqual(raw.execution.preview);
      expect(result.reportReview.approvedTiming).toEqual(
        raw.reportReview.reportSources.commercialPlanSnapshot.strategyBinding
          .timing,
      );
      expect(result.reportReview.observedEvidence.resultCount).toBe(
        key === "afterReceipt" ? 1 : 0,
      );
      expect(result.reportReview.issuance.status).toBe("blocked");
      expect(result.completeness).toBe("not_established");
      expect(
        result.reportReview.temporalEvidence.periods.map((period) => [
          period.period,
          period.retainedResultCount,
        ]),
      ).toEqual([
        ["in_flight", 0],
        ["post_flight", key === "afterReceipt" ? 1 : 0],
      ]);
      if (key === "afterReceipt") {
        const eventTime = Date.parse(
          raw.reportReview.reportSources.results[0]!.conversionTime,
        );
        expect(eventTime).toBeGreaterThan(
          Date.parse(result.reportReview.approvedTiming.flight.endedAt),
        );
        expect(eventTime).toBeLessThan(
          Date.parse(result.reportReview.approvedTiming.measurement.endedAt),
        );
      }
    },
  );
  it("uses one timing-aware read and retains exact dates without issuing or retrying", async () => {
    const raw = timed();
    const retained = structuredClone(raw);
    const db = client(raw);
    const result = await loadTimedCampaignExecutionReportReview(
      db,
      scope,
      approvalId,
    );
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_timed_campaign_execution_report_review",
      {
        target_workspace_id: scope.workspaceId,
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_approval_id: approvalId,
      },
    );
    expect(result.reportReview.approvedTiming).toEqual(
      raw.reportReview.reportSources.commercialPlanSnapshot.strategyBinding
        .timing,
    );
    expect(result.execution.receipt).toEqual(raw.execution.receipt);
    expect(result.execution.executionObservation).toBe("receipt_recorded");
    expect(result.reportIssuance).toBe("blocked");
    expect(result.reportReview.issuance.status).toBe("blocked");
    expect(result.reportReview.metrics.cpa.status).toBe("not_available");
    expect(result.completeness).toBe("not_established");
    expect(result.reportScope).toBe("campaign_wide");
    expect(raw).toEqual(retained);
  });
  it("retains absence as an observation, not failure or retry authority", async () => {
    const raw = timed();
    const result = await read({
      ...raw,
      execution: { ...raw.execution, receipt: null },
    });
    expect(result.execution.executionObservation).toBe("receipt_not_recorded");
    expect(result.execution).not.toHaveProperty("retryAllowed");
    expect(result.reportIssuance).toBe("blocked");
  });
  it("keeps legacy and timed entry points mutually version-gated", async () => {
    await expect(read(legacyFixture.afterReceipt)).rejects.toThrow();
    await expect(
      loadCampaignExecutionReportReview(client(), scope, approvalId),
    ).rejects.toThrow();
  });
  it.each([
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "commercialPlanSnapshotHash",
    "ruleVersionId",
  ] as const)("rejects execution/report %s disagreement", async (key) => {
    const raw = timed();
    raw.execution.preview.review[key] =
      key === "commercialPlanSnapshotHash" ? "0".repeat(64) : otherId;
    await expect(read(raw)).rejects.toMatchObject({ outcome: "unconfirmed" });
  });
  it.each(["startedAt", "endedAt"] as const)(
    "rejects microsecond execution %s drift",
    async (key) => {
      const raw = timed();
      raw.execution.preview.review.measurementWindow[key] =
        raw.execution.preview.review.measurementWindow[key].replace(
          ".000000Z",
          ".000001Z",
        );
      await expect(read(raw)).rejects.toThrow();
    },
  );
  it("rejects disagreement inside the full retained timing binding", async () => {
    const raw = timed();
    raw.reportReview.reportSources.commercialPlanSnapshot.strategyBinding.timing.measurement.endedAt =
      "2026-10-05T00:00:00.000001Z";
    await expect(read(raw)).rejects.toThrow();
  });
  it("rejects unknown binding and timing versions", async () => {
    const raw = timed();
    raw.reportReview.reportSources.commercialPlanSnapshot.strategyBinding.schemaVersion = 3;
    await expect(read(raw)).rejects.toThrow();
    const second = timed();
    second.reportReview.reportSources.commercialPlanSnapshot.strategyBinding.timing.schemaVersion = 2;
    await expect(read(second)).rejects.toThrow();
  });
  it.each([
    "calculationRequestId",
    "conversionFactId",
    "attributionFactId",
  ] as const)(
    "requires the entire receipt tuple when report %s differs",
    async (key) => {
      const raw = timed();
      raw.reportReview.reportSources.results[0]![key] = otherId;
      await expect(read(raw)).rejects.toThrow();
    },
  );
  it("rejects a recorded receipt whose result is omitted", async () => {
    const raw = timed();
    raw.reportReview.reportSources.results = [];
    raw.reportReview.reportSources.walletAttributionEvidenceIds = [];
    await expect(read(raw)).rejects.toThrow();
  });
  it("does not reinterpret campaign-wide additional evidence as this batch", async () => {
    const raw = timed();
    const extra = structuredClone(raw.reportReview.reportSources.results[0]!);
    extra.conversionFactId = otherId;
    extra.attributionFactId = "99999999-0000-4000-8000-000000000002";
    extra.calculationRequestId = "99999999-0000-4000-8000-000000000003";
    extra.auditId = "99999999-0000-4000-8000-000000000004";
    extra.canonicalChainEventId = "99999999-0000-4000-8000-000000000005";
    raw.reportReview.reportSources.results.push(extra);
    const result = await read(raw);
    expect(result.reportReview.observedEvidence.resultCount).toBe(2);
    expect(result.execution.receipt!.batch.processedCount).toBe(1);
    expect(result.reportIssuance).toBe("blocked");
  });
  it("rejects altered receipt identity and count", async () => {
    const raw = timed();
    raw.execution.receipt.batch.insertedCount = 0;
    await expect(read(raw)).rejects.toThrow();
    const second = timed();
    second.execution.receipt.approvalId = otherId;
    await expect(read(second)).rejects.toThrow();
  });
  it.each([
    null,
    {},
    [],
    { ...base, reportIssuance: "ready" },
    { ...base, completeness: "complete" },
    { ...base, reportScope: "receipt_only" },
  ])("rejects malformed or unsupported data", async (data) => {
    await expect(read(data)).rejects.toThrow();
  });
  it.each([null, {}, { data: base }, { error: null }])(
    "rejects malformed RPC envelope",
    async (envelope) => {
      const db = { rpc: vi.fn().mockResolvedValue(envelope) };
      await expect(
        loadTimedCampaignExecutionReportReview(db, scope, approvalId),
      ).rejects.toThrow();
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects invalid local scope and unexpected actor input without calling", async () => {
    const db = client();
    await expect(
      loadTimedCampaignExecutionReportReview(
        db,
        { ...scope, actorId: otherId },
        approvalId,
      ),
    ).rejects.toMatchObject({ outcome: "not_started" });
    await expect(
      loadTimedCampaignExecutionReportReview(db, scope, "invalid"),
    ).rejects.toMatchObject({ outcome: "not_started" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("sanitizes denial and transport failure without fallback", async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({
        data: base,
        error: { code: "42501", message: "PRIVATE" },
      }),
    };
    await expect(
      loadTimedCampaignExecutionReportReview(db, scope, approvalId),
    ).rejects.toMatchObject({
      outcome: "unconfirmed",
      code: "42501",
      message: "Campaign execution request could not be confirmed.",
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    db.rpc.mockRejectedValue(new Error("PRIVATE"));
    await expect(
      loadTimedCampaignExecutionReportReview(db, scope, approvalId),
    ).rejects.not.toThrow("PRIVATE");
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
});
