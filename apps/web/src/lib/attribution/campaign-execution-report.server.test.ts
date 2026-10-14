import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/campaign-execution-report.json";
import { loadCampaignExecutionReportReview } from "./campaign-execution.server";

const before = fixture.beforeReceipt;
const after = fixture.afterReceipt;
const scope = {
  workspaceId: before.execution.preview.review.workspaceId,
  projectId: before.execution.preview.review.projectId,
  campaignId: before.execution.preview.review.campaignId,
};
const approvalId = before.execution.approvalId;
const otherId = "99999999-0000-4000-8000-000000000001";
const client = (data: unknown = before) => ({
  rpc: vi.fn().mockResolvedValue({ data, error: null }),
});

describe("private coherent execution/report review", () => {
  it("reads once and does not interpret a missing receipt as failure or permission to retry", async () => {
    const db = client();
    const result = await loadCampaignExecutionReportReview(
      db,
      scope,
      approvalId,
    );
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_campaign_execution_report_review",
      {
        target_workspace_id: scope.workspaceId,
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_approval_id: approvalId,
      },
    );
    expect(result.execution.executionObservation).toBe("receipt_not_recorded");
    expect(result.execution.receipt).toBeNull();
    expect(result.execution).not.toHaveProperty("retryAllowed");
    expect(result.reportScope).toBe("campaign_wide");
    expect(result.reportReview.kind).toBe("unissued_campaign_metric_preview");
  });
  it("connects the real SQL receipt without declaring campaign report readiness", async () => {
    const result = await loadCampaignExecutionReportReview(
      client(after),
      scope,
      approvalId,
    );
    expect(result.execution.receipt).toEqual(after.execution.receipt);
    expect(result.execution.executionObservation).toBe("receipt_recorded");
    expect(result.reportReview.observedEvidence.resultCount).toBe(1);
    expect(result.reportIssuance).toBe("blocked");
    expect(result.completeness).toBe("not_established");
    expect(result.reportReview.issuance.reasons).toContain(
      "approved_execution_not_established",
    );
    expect(result.reportReview.historyReadiness.missingHistoryCount).toBe(2);
    expect(result.reportReview.metrics.revenueRoas.status).toBe(
      "not_available",
    );
  });
  it.each([
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "commercialPlanSnapshotHash",
    "ruleVersionId",
  ] as const)("rejects execution/report %s disagreement", async (key) => {
    const data = structuredClone(before);
    data.execution.preview.review[key] =
      key === "commercialPlanSnapshotHash" ? "0".repeat(64) : otherId;
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).rejects.toMatchObject({ outcome: "unconfirmed" });
  });
  it.each(["startedAt", "endedAt"] as const)(
    "rejects one-microsecond %s drift",
    async (key) => {
      const data = structuredClone(before);
      data.execution.preview.review.measurementWindow[key] =
        data.execution.preview.review.measurementWindow[key].replace(
          ".000000Z",
          ".000001Z",
        );
      await expect(
        loadCampaignExecutionReportReview(client(data), scope, approvalId),
      ).rejects.toThrow();
    },
  );
  it("accepts equivalent report instants without losing exact precision", async () => {
    const data = structuredClone(before);
    data.reportReview.reportSources.measurementWindow.startedAt =
      "2026-09-07T01:00:00+01:00";
    data.reportReview.historyReadiness.measurementWindow.startedAt =
      "2026-09-07T01:00:00+01:00";
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).resolves.toBeDefined();
  });
  it("rejects timed binding version2 rather than stripping timing to fit old report support", async () => {
    const data = structuredClone(before);
    const snapshot = data.reportReview.reportSources.commercialPlanSnapshot;
    snapshot.strategyBinding = {
      ...snapshot.strategyBinding,
      schemaVersion: 2,
      ...{
        timing: {
          schemaVersion: 1,
          flight: { ...snapshot.strategyBinding.measurementWindow },
          measurement: { ...snapshot.strategyBinding.measurementWindow },
        },
      },
    };
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).rejects.toThrow();
  });
  it("rejects a tampered historical receipt", async () => {
    const data = structuredClone(after);
    data.execution.receipt.batch.results[0]!.conversionFactId = otherId;
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).rejects.toThrow();
  });
  it("rejects another approval identity", async () => {
    await expect(
      loadCampaignExecutionReportReview(client(after), scope, otherId),
    ).rejects.toThrow();
  });
  it.each([
    "calculationRequestId",
    "conversionFactId",
    "attributionFactId",
  ] as const)(
    "rejects a missing receipt tuple when report %s differs",
    async (key) => {
      const data = structuredClone(after);
      data.reportReview.reportSources.results[0]![key] = otherId;
      await expect(
        loadCampaignExecutionReportReview(client(data), scope, approvalId),
      ).rejects.toThrow();
    },
  );
  it("rejects report evidence that omits the recorded batch", async () => {
    const data = structuredClone(after);
    data.reportReview.reportSources.results = [];
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).rejects.toThrow();
  });
  it("allows campaign-wide results beyond this single batch without rewriting its receipt", async () => {
    const data = structuredClone(after);
    const extra = structuredClone(data.reportReview.reportSources.results[0]!);
    extra.conversionFactId = otherId;
    extra.attributionFactId = "99999999-0000-4000-8000-000000000002";
    extra.calculationRequestId = "99999999-0000-4000-8000-000000000003";
    extra.auditId = "99999999-0000-4000-8000-000000000004";
    extra.canonicalChainEventId = "99999999-0000-4000-8000-000000000005";
    data.reportReview.reportSources.results.push(extra);
    const result = await loadCampaignExecutionReportReview(
      client(data),
      scope,
      approvalId,
    );
    expect(result.reportReview.observedEvidence.resultCount).toBe(2);
    expect(result.execution.receipt!.batch.processedCount).toBe(1);
    expect(result.reportIssuance).toBe("blocked");
  });
  it.each([
    null,
    {},
    [],
    { ...before, reportReview: null },
    { ...before, reportIssuance: "ready" },
    { ...before, completeness: "complete" },
    { ...before, reportScope: "receipt_only" },
  ])("fails closed on malformed or unsupported response", async (data) => {
    await expect(
      loadCampaignExecutionReportReview(client(data), scope, approvalId),
    ).rejects.toThrow();
  });
  it("rejects invalid scope before access", async () => {
    const db = client();
    await expect(
      loadCampaignExecutionReportReview(
        db,
        { ...scope, projectId: "invalid" },
        approvalId,
      ),
    ).rejects.toMatchObject({ outcome: "not_started" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("preserves sanitized source errors without fallback or empty reports", async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "55000", message: "PRIVATE" },
      }),
    };
    await expect(
      loadCampaignExecutionReportReview(db, scope, approvalId),
    ).rejects.toMatchObject({
      outcome: "unconfirmed",
      code: "55000",
      message: "Campaign execution request could not be confirmed.",
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("sanitizes transport errors without retry", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error("PRIVATE")) };
    await expect(
      loadCampaignExecutionReportReview(db, scope, approvalId),
    ).rejects.not.toThrow("PRIVATE");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
