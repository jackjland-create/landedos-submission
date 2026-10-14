import { describe, expect, it, vi } from "vitest";
import review from "../../../../../packages/analytics/src/fixtures/campaign-report-review.json";
import {
  loadStrategyReportPreview,
  StrategyReportPreviewError,
} from "./strategy-preview.server";

const sources = review.reportSources;
const scope = {
  workspaceId: sources.workspaceId,
  projectId: sources.projectId,
  campaignId: sources.campaignId,
};
const client = (
  data: unknown = review,
  error: { code?: string } | null = null,
) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });

describe("private strategy report preview adapter", () => {
  it("loads exact sources once without writes or an issuance fallback", async () => {
    const db = client();
    const result = await loadStrategyReportPreview(db, scope);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_campaign_report_review",
      {
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
      },
    );
    expect(result.issuance.status).toBe("blocked");
    expect(result.kind).toBe("unissued_campaign_metric_preview");
    expect(result.observedEvidence.completeness).toBe("not_established");
    expect(result.historyReadiness.mappingCount).toBe(2);
    expect(result.historyReadiness.missingHistoryCount).toBe(2);
  });
  it("rejects invalid scope before any access", async () => {
    const db = client();
    await expect(
      loadStrategyReportPreview(db, { ...scope, projectId: "bad" }),
    ).rejects.toBeInstanceOf(StrategyReportPreviewError);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects a mismatched requested %s",
    async (field) => {
      await expect(
        loadStrategyReportPreview(client(), {
          ...scope,
          [field]: "99999999-0000-4000-8000-000000000001",
        }),
      ).rejects.toBeInstanceOf(StrategyReportPreviewError);
    },
  );
  it.each([
    null,
    [],
    {},
    { reportSources: sources },
    { ...review, reportSources: { ...sources, completeness: "complete" } },
    {
      ...review,
      historyReadiness: {
        ...review.historyReadiness,
        campaignId: "99999999-0000-4000-8000-000000000001",
      },
    },
  ])("rejects malformed/unexpected source response", async (data) => {
    await expect(
      loadStrategyReportPreview(client(data), scope),
    ).rejects.toBeInstanceOf(StrategyReportPreviewError);
  });
  it("preserves permission denial code without retrying another path", async () => {
    const db = client(null, { code: "42501" });
    await expect(loadStrategyReportPreview(db, scope)).rejects.toMatchObject({
      code: "42501",
      message: "Campaign report preview is unavailable.",
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not leak transport details", async () => {
    const db = {
      rpc: vi.fn().mockRejectedValue(new Error("protected source details")),
    };
    await expect(loadStrategyReportPreview(db, scope)).rejects.toThrow(
      "Campaign report preview is unavailable.",
    );
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, undefined, {}, "invalid"])(
    "sanitizes malformed transport envelopes",
    async (response) => {
      const db = { rpc: vi.fn().mockResolvedValue(response) };
      await expect(loadStrategyReportPreview(db, scope)).rejects.toBeInstanceOf(
        StrategyReportPreviewError,
      );
    },
  );
});
