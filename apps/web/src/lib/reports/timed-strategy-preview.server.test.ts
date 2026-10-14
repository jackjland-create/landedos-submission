import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../../packages/analytics/src/fixtures/timed-campaign-report-review.json";
import { loadTimedStrategyReportPreview } from "./timed-strategy-preview.server";

const scope = {
  workspaceId: fixture.reportSources.workspaceId,
  projectId: fixture.reportSources.projectId,
  campaignId: fixture.reportSources.campaignId,
};
const client = (data: unknown = fixture) => ({
  rpc: vi.fn().mockResolvedValue({ data, error: null }),
});
describe("private timed report adapter", () => {
  it("reads the exact real SQL response once without enabling issuance", async () => {
    const db = client();
    const result = await loadTimedStrategyReportPreview(db, scope);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_timed_campaign_report_review",
      {
        target_project_id: scope.projectId,
        target_campaign_id: scope.campaignId,
      },
    );
    expect(result.approvedTiming).toEqual(
      fixture.reportSources.commercialPlanSnapshot.strategyBinding.timing,
    );
    expect(result.issuance.status).toBe("blocked");
    expect(result).not.toHaveProperty("dataFreshness");
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "denies mismatched requested %s",
    async (key) => {
      await expect(
        loadTimedStrategyReportPreview(client(), {
          ...scope,
          [key]: "99999999-0000-4000-8000-000000000001",
        }),
      ).rejects.toThrow("Campaign report preview is unavailable.");
    },
  );
  it("rejects invalid scope before any call", async () => {
    const db = client();
    await expect(
      loadTimedStrategyReportPreview(db, { ...scope, campaignId: "bad" }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects timing drift and older bindings rather than inferring flight", async () => {
    const raw = structuredClone(fixture);
    raw.reportSources.commercialPlanSnapshot.strategyBinding.timing.measurement.endedAt =
      "2026-12-01T00:00:00Z";
    await expect(
      loadTimedStrategyReportPreview(client(raw), scope),
    ).rejects.toThrow();
    raw.reportSources.commercialPlanSnapshot.strategyBinding.schemaVersion = 1;
    await expect(
      loadTimedStrategyReportPreview(client(raw), scope),
    ).rejects.toThrow();
  });
  it.each([
    null,
    {},
    { data: fixture },
    { error: null },
    { data: fixture, error: { code: "42501", message: "private detail" } },
  ])(
    "rejects malformed or denied response without fallback",
    async (response) => {
      const db = { rpc: vi.fn().mockResolvedValue(response) };
      await expect(loadTimedStrategyReportPreview(db, scope)).rejects.toThrow(
        "Campaign report preview is unavailable.",
      );
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes transport failure without retry", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error("private detail")) };
    await expect(loadTimedStrategyReportPreview(db, scope)).rejects.toThrow(
      "Campaign report preview is unavailable.",
    );
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
