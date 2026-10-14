import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/campaign-execution.json";
import {
  previewCampaignExecution,
  approveCampaignExecution,
  executeApprovedCampaignExecution,
} from "./campaign-execution.server";

const { preview, receipt } = fixture;
const scope = {
  workspaceId: preview.review.workspaceId,
  projectId: preview.review.projectId,
  campaignId: preview.review.campaignId,
};
const candidates = preview.review.candidates;
const approvalId = receipt.approvalId;
const reason = "Review exact retained candidates";
const client = (data: unknown, error: unknown = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
});
const otherId = "99999999-0000-4000-8000-000000000001";

describe("private campaign execution handoff", () => {
  it("rejects noncanonical retained candidate text rather than rewriting a hashed review", async () => {
    const data = structuredClone(preview);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const requested = structuredClone(candidates);
    requested[0]!.calculationRequestId = id;
    data.review.candidates[0]!.calculationRequestId = id.toUpperCase();
    await expect(
      previewCampaignExecution(client(data), scope, requested),
    ).rejects.toThrow();
  });
  it("preserves an exact microsecond interval without rounding", async () => {
    const data = structuredClone(preview);
    data.review.measurementWindow = {
      startedAt: "2026-09-07T00:00:00.000001Z",
      endedAt: "2026-09-07T00:00:00.000002Z",
    };
    expect(
      await previewCampaignExecution(client(data), scope, candidates),
    ).toEqual(data);
  });
  it("rejects a reversed submillisecond interval", async () => {
    const data = structuredClone(preview);
    data.review.measurementWindow = {
      startedAt: "2026-09-07T00:00:00.000002Z",
      endedAt: "2026-09-07T00:00:00.000001Z",
    };
    await expect(
      previewCampaignExecution(client(data), scope, candidates),
    ).rejects.toThrow();
  });
  it("distinguishes local rejection from an unconfirmed write response", async () => {
    const db = client(null);
    await expect(
      approveCampaignExecution(db, scope, {
        approvalId,
        preview,
        reason: "short",
      }),
    ).rejects.toMatchObject({ outcome: "not_started" });
    expect(db.rpc).not.toHaveBeenCalled();
    await expect(
      approveCampaignExecution(db, scope, { approvalId, preview, reason }),
    ).rejects.toMatchObject({ outcome: "unconfirmed" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, undefined, [], {}, { data: receipt }, { error: null }])(
    "rejects malformed response envelope without retry",
    async (response) => {
      const db = { rpc: vi.fn().mockResolvedValue(response) };
      await expect(
        executeApprovedCampaignExecution(db, scope, { approvalId, preview }),
      ).rejects.toMatchObject({ outcome: "unconfirmed" });
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("retains only safe SQLSTATE codes from database errors", async () => {
    await expect(
      executeApprovedCampaignExecution(
        client(null, { code: "42501", message: "SECRET" }),
        scope,
        { approvalId, preview },
      ),
    ).rejects.toMatchObject({ code: "42501", outcome: "unconfirmed" });
    await expect(
      executeApprovedCampaignExecution(
        client(null, { code: "SECRET" }),
        scope,
        { approvalId, preview },
      ),
    ).rejects.toMatchObject({ code: undefined });
  });
  it("decodes an actual SQL preview and calls only preview with exact IDs", async () => {
    const db = client(preview);
    expect(await previewCampaignExecution(db, scope, candidates)).toEqual(
      preview,
    );
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "preview_campaign_execution",
      {
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_candidates: candidates,
      },
    );
  });
  it("approval submits the retained review and hash without executing", async () => {
    const db = client(approvalId);
    await approveCampaignExecution(db, scope, { approvalId, preview, reason });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "approve_campaign_execution",
      {
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_approval_id: approvalId,
        target_review: preview.review,
        target_review_hash: preview.reviewHash,
        target_reason: reason,
      },
    );
  });
  it("execution sends exact comparison context before any database writes", async () => {
    const db = client(receipt);
    expect(
      await executeApprovedCampaignExecution(db, scope, {
        approvalId,
        preview,
      }),
    ).toEqual(receipt);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "execute_reviewed_campaign_execution",
      {
        target_workspace_id: scope.workspaceId,
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
        target_approval_id: approvalId,
        target_review: preview.review,
        target_review_hash: preview.reviewHash,
      },
    );
  });
  it("preserves historical insertion flags on repeated receipt", async () => {
    const db = client(receipt);
    expect(
      (
        await executeApprovedCampaignExecution(db, scope, {
          approvalId,
          preview,
        })
      ).batch.insertedCount,
    ).toBe(2);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects preview returned for wrong %s",
    async (field) => {
      await expect(
        previewCampaignExecution(
          client(preview),
          { ...scope, [field]: otherId },
          candidates,
        ),
      ).rejects.toThrow();
    },
  );
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects wrong approval scope %s before RPC",
    async (field) => {
      const db = client(approvalId);
      await expect(
        approveCampaignExecution(
          db,
          { ...scope, [field]: otherId },
          { approvalId, preview, reason },
        ),
      ).rejects.toThrow();
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed manifest before RPC", async () => {
    const db = client(preview);
    await expect(previewCampaignExecution(db, scope, [])).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects changed preview result candidate order", async () => {
    const data = structuredClone(preview);
    data.review.candidates.reverse();
    await expect(
      previewCampaignExecution(client(data), scope, candidates),
    ).rejects.toThrow();
  });
  it("rejects unexpected approval identity without retry", async () => {
    const db = client(otherId);
    await expect(
      approveCampaignExecution(db, scope, { approvalId, preview, reason }),
    ).rejects.toThrow();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["approvalId", "reviewHash"] as const)(
    "rejects receipt %s mismatch",
    async (field) => {
      const data = {
        ...receipt,
        [field]: field === "reviewHash" ? "0".repeat(64) : otherId,
      };
      await expect(
        executeApprovedCampaignExecution(client(data), scope, {
          approvalId,
          preview,
        }),
      ).rejects.toThrow();
    },
  );
  it.each(["campaignId", "ruleVersionId"] as const)(
    "rejects receipt batch %s mismatch",
    async (field) => {
      const data = structuredClone(receipt);
      data.batch[field] = otherId;
      await expect(
        executeApprovedCampaignExecution(client(data), scope, {
          approvalId,
          preview,
        }),
      ).rejects.toThrow();
    },
  );
  it.each([
    "conversionFactId",
    "attributionFactId",
    "calculationRequestId",
  ] as const)("rejects altered result %s", async (field) => {
    const data = structuredClone(receipt);
    data.batch.results[0]![field] = otherId;
    await expect(
      executeApprovedCampaignExecution(client(data), scope, {
        approvalId,
        preview,
      }),
    ).rejects.toThrow();
  });
  it("rejects reordered results", async () => {
    const data = structuredClone(receipt);
    data.batch.results.reverse();
    await expect(
      executeApprovedCampaignExecution(client(data), scope, {
        approvalId,
        preview,
      }),
    ).rejects.toThrow();
  });
  it.each(["processedCount", "insertedCount"] as const)(
    "rejects inconsistent %s",
    async (field) => {
      const data = structuredClone(receipt);
      data.batch[field] = 1;
      await expect(
        executeApprovedCampaignExecution(client(data), scope, {
          approvalId,
          preview,
        }),
      ).rejects.toThrow();
    },
  );
  it("accepts accurately labelled reuse without asserting new writes", async () => {
    const data = structuredClone(receipt);
    data.batch.insertedCount = 0;
    data.batch.results.forEach((result) => {
      result.inserted = false;
    });
    expect(
      await executeApprovedCampaignExecution(client(data), scope, {
        approvalId,
        preview,
      }),
    ).toEqual(data);
  });
  it.each([
    null,
    [],
    {},
    { data: null },
    { data: receipt, error: null, extra: true },
  ])("rejects malformed RPC data", async (data) => {
    await expect(
      executeApprovedCampaignExecution(client(data), scope, {
        approvalId,
        preview,
      }),
    ).rejects.toThrow();
  });
  it.each(["preview", "approve", "execute"] as const)(
    "does not retry %s transport errors or expose provider details",
    async (action) => {
      const db = {
        rpc: vi.fn().mockRejectedValue(new Error("SECRET provider details")),
      };
      const promise =
        action === "preview"
          ? previewCampaignExecution(db, scope, candidates)
          : action === "approve"
            ? approveCampaignExecution(db, scope, {
                approvalId,
                preview,
                reason,
              })
            : executeApprovedCampaignExecution(db, scope, {
                approvalId,
                preview,
              });
      await expect(promise).rejects.not.toThrow("SECRET");
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
});
