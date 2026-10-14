import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/campaign-execution-recovery.json";
import { loadCampaignExecutionReview } from "./campaign-execution.server";

const before = fixture.beforeReceipt;
const after = fixture.afterReceipt;
const scope = {
  workspaceId: before.preview.review.workspaceId,
  projectId: before.preview.review.projectId,
  campaignId: before.preview.review.campaignId,
};
const client = (data: unknown) => ({
  rpc: vi.fn().mockResolvedValue({ data, error: null }),
});
const otherId = "99999999-0000-4000-8000-000000000001";

describe("private execution recovery", () => {
  it("reads once without approving, executing or refreshing a preview", async () => {
    const db = client(before);
    expect(
      await loadCampaignExecutionReview(db, scope, before.approvalId),
    ).toEqual({ ...before, executionObservation: "receipt_not_recorded" });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_campaign_execution_review",
      {
        target_workspace_id: scope.workspaceId,
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_approval_id: before.approvalId,
      },
    );
  });
  it("retains receipt and historical insertion counts", async () => {
    expect(
      await loadCampaignExecutionReview(
        client(after),
        scope,
        before.approvalId,
      ),
    ).toEqual({ ...after, executionObservation: "receipt_recorded" });
  });
  it("does not interpret missing receipt as failed, ready or zero", async () => {
    const result = await loadCampaignExecutionReview(
      client(before),
      scope,
      before.approvalId,
    );
    expect(result.receipt).toBeNull();
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("retryAllowed");
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects wrong %s",
    async (field) => {
      await expect(
        loadCampaignExecutionReview(
          client(before),
          { ...scope, [field]: otherId },
          before.approvalId,
        ),
      ).rejects.toThrow();
    },
  );
  it("rejects another approval ID", async () => {
    await expect(
      loadCampaignExecutionReview(client(before), scope, otherId),
    ).rejects.toThrow();
  });
  it("rejects invalid identity before calling", async () => {
    const db = client(before);
    await expect(
      loadCampaignExecutionReview(db, scope, "invalid"),
    ).rejects.toMatchObject({ outcome: "not_started" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { ...before, receipt: undefined },
    { ...before, reason: "short" },
    { ...before, approvedAt: "bad" },
    { ...before, readAt: "2026-09-13T12:00:01Z" },
    { ...before, status: "failed" },
  ])("rejects malformed retained response", async (data) => {
    await expect(
      loadCampaignExecutionReview(client(data), scope, before.approvalId),
    ).rejects.toMatchObject({ outcome: "unconfirmed" });
  });
  it.each(["approvalId", "reviewHash"] as const)(
    "rejects mismatched receipt %s",
    async (field) => {
      const data = structuredClone(after);
      data.receipt[field] = field === "reviewHash" ? "0".repeat(64) : otherId;
      await expect(
        loadCampaignExecutionReview(client(data), scope, before.approvalId),
      ).rejects.toThrow();
    },
  );
  it.each(["campaignId", "ruleVersionId"] as const)(
    "rejects mismatched receipt batch %s",
    async (field) => {
      const data = structuredClone(after);
      data.receipt.batch[field] = otherId;
      await expect(
        loadCampaignExecutionReview(client(data), scope, before.approvalId),
      ).rejects.toThrow();
    },
  );
  it("rejects changed retained result identity", async () => {
    const data = structuredClone(after);
    data.receipt.batch.results[0]!.conversionFactId = otherId;
    await expect(
      loadCampaignExecutionReview(client(data), scope, before.approvalId),
    ).rejects.toThrow();
  });
  it("rejects additional receipt results", async () => {
    const data = structuredClone(after);
    data.receipt.batch.results.push(data.receipt.batch.results[0]!);
    await expect(
      loadCampaignExecutionReview(client(data), scope, before.approvalId),
    ).rejects.toThrow();
  });
  it("rejects inconsistent insertion counts", async () => {
    const data = structuredClone(after);
    data.receipt.batch.insertedCount = 0;
    await expect(
      loadCampaignExecutionReview(client(data), scope, before.approvalId),
    ).rejects.toThrow();
  });
  it.each([null, undefined, {}, { data: before }])(
    "rejects malformed envelope",
    async (envelope) => {
      const db = { rpc: vi.fn().mockResolvedValue(envelope) };
      await expect(
        loadCampaignExecutionReview(db, scope, before.approvalId),
      ).rejects.toMatchObject({ outcome: "unconfirmed" });
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("does not retry or expose transport errors", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error("SECRET")) };
    await expect(
      loadCampaignExecutionReview(db, scope, before.approvalId),
    ).rejects.not.toThrow("SECRET");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
