import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import review from "../../contracts/src/fixtures/bsk09-timed-review.json";
import retainedCampaign from "./fixtures/bsk09-campaign-timing.json";
import { loadApprovedCampaignTiming } from "./campaign-timing";

const snapshot = review.review_snapshot;
const timing = snapshot.strategyBinding.timing;
const scope = {
  workspaceId: snapshot.workspaceId,
  projectId: snapshot.projectId,
  campaignId: "80000000-0000-4000-8000-000000000001",
};
const row = {
  id: scope.campaignId,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  basket_id: snapshot.basket.id,
  commercial_plan_version_id: "70000000-0000-4000-8000-000000000001",
  approved_conversion_rule_version_id:
    snapshot.strategyBinding.conversionRule.id,
  approved_flight_started_at: timing.flight.startedAt,
  approved_flight_ended_at: timing.flight.endedAt,
  measurement_started_at: timing.measurement.startedAt,
  measurement_ended_at: timing.measurement.endedAt,
  commercial_plan_versions: {
    id: "70000000-0000-4000-8000-000000000001",
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    basket_id: snapshot.basket.id,
    snapshot,
  },
};
function mock(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as SupabaseClient, from, chain };
}
describe("BSK-09 retained campaign timing read", () => {
  it("decodes the actual isolated campaign and approval join", async () => {
    const m = mock(retainedCampaign);
    expect(
      await loadApprovedCampaignTiming(m.client, {
        workspaceId: retainedCampaign.workspace_id,
        projectId: retainedCampaign.project_id,
        campaignId: retainedCampaign.id,
      }),
    ).toEqual({
      campaignId: retainedCampaign.id,
      approvalId: retainedCampaign.commercial_plan_version_id,
      timing:
        retainedCampaign.commercial_plan_versions.snapshot.strategyBinding
          .timing,
    });
  });
  it("reads once with exact scope and returns retained timing", async () => {
    const m = mock(row);
    expect(await loadApprovedCampaignTiming(m.client, scope)).toEqual({
      campaignId: scope.campaignId,
      approvalId: row.commercial_plan_version_id,
      timing,
    });
    expect(m.from).toHaveBeenCalledExactlyOnceWith("campaigns");
    expect(m.chain.eq.mock.calls).toEqual([
      ["workspace_id", scope.workspaceId],
      ["project_id", scope.projectId],
      ["id", scope.campaignId],
    ]);
  });
  it("accepts equivalent UTC offsets without rounding", async () => {
    const m = mock({
      ...row,
      approved_flight_started_at: timing.flight.startedAt.replace(
        "Z",
        "+00:00",
      ),
    });
    expect((await loadApprovedCampaignTiming(m.client, scope))?.timing).toEqual(
      timing,
    );
  });
  it.each([
    "approved_flight_started_at",
    "approved_flight_ended_at",
    "measurement_started_at",
    "measurement_ended_at",
  ])("rejects mismatched %s", async (field) => {
    const m = mock({ ...row, [field]: "2026-09-14T00:00:00.000001Z" });
    await expect(loadApprovedCampaignTiming(m.client, scope)).rejects.toThrow(
      "Approved campaign timing could not be loaded.",
    );
  });
  it.each([
    "workspace_id",
    "project_id",
    "id",
    "basket_id",
    "commercial_plan_version_id",
    "approved_conversion_rule_version_id",
  ])("rejects mismatched %s", async (field) => {
    await expect(
      loadApprovedCampaignTiming(
        mock({ ...row, [field]: "99999999-9999-4999-8999-999999999999" })
          .client,
        scope,
      ),
    ).rejects.toThrow();
  });
  it("rejects cross-scope joined approval", async () => {
    await expect(
      loadApprovedCampaignTiming(
        mock({
          ...row,
          commercial_plan_versions: {
            ...row.commercial_plan_versions,
            workspace_id: "99999999-9999-4999-8999-999999999999",
          },
        }).client,
        scope,
      ),
    ).rejects.toThrow();
  });
  it("preserves missing/RLS-hidden results without inventing dates", async () => {
    expect(
      await loadApprovedCampaignTiming(mock(null).client, scope),
    ).toBeNull();
  });
  it("rejects missing response envelope and sanitizes transport errors", async () => {
    const m = mock(null);
    m.chain.maybeSingle.mockResolvedValue({ data: null });
    await expect(loadApprovedCampaignTiming(m.client, scope)).rejects.toThrow();
    m.chain.maybeSingle.mockRejectedValue(new Error("secret server detail"));
    await expect(loadApprovedCampaignTiming(m.client, scope)).rejects.toThrow(
      "Approved campaign timing could not be loaded.",
    );
  });
  it("rejects absent legacy flight rather than backfilling", async () => {
    await expect(
      loadApprovedCampaignTiming(
        mock({
          ...row,
          approved_flight_started_at: null,
          approved_flight_ended_at: null,
        }).client,
        scope,
      ),
    ).rejects.toThrow();
  });
  it("validates input before accessing data", async () => {
    const m = mock(row);
    await expect(
      loadApprovedCampaignTiming(m.client, { ...scope, campaignId: "bad" }),
    ).rejects.toThrow();
    expect(m.from).not.toHaveBeenCalled();
  });
});
