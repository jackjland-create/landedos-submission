import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadCampaignPlanLaunch } from "./campaign-plan-launch";

const projectId = "20000000-0000-4000-8000-000000000001";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const planId = "a2000000-0000-4000-8000-000000000002";
const basketId = "90000000-0000-4000-8000-000000000002";
const campaignId = "a1000000-0000-4000-8000-000000000002";
const selected = {
  id: planId,
  basket_id: basketId,
  version: 2,
  approved_at: "2026-09-01T12:00:00Z",
  snapshot: { basket: { name: "Selected launch" } },
};
function clientFor(
  plan: unknown = selected,
  campaign: unknown = null,
  canManage = true,
  error: { code: string } | null = null,
  campaignError: { code: string } | null = null,
) {
  const queries: Record<string, ReturnType<typeof vi.fn>> = {};
  const client = {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === "campaigns" ? campaign : plan,
          error: table === "campaigns" ? campaignError : error,
        }),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      queries[table] = query.eq;
      return query;
    }),
    rpc: vi.fn().mockResolvedValue({ data: canManage, error: null }),
  };
  return { client: client as unknown as SupabaseClient, raw: client, queries };
}

describe("exact approved-plan campaign handoff", () => {
  it("loads only the selected approved version, scoped to workspace and project", async () => {
    const { client, queries } = clientFor();
    const result = await loadCampaignPlanLaunch(
      client,
      projectId,
      workspaceId,
      planId,
    );
    expect(result).toEqual({
      kind: "plan",
      canManage: true,
      pendingPlan: {
        id: planId,
        basketId,
        name: "Selected launch",
        version: 2,
        approvedAt: selected.approved_at,
      },
    });
    for (const table of ["campaigns", "commercial_plan_versions"]) {
      expect(queries[table]).toHaveBeenCalledWith("project_id", projectId);
      expect(queries[table]).toHaveBeenCalledWith("workspace_id", workspaceId);
    }
    expect(queries.commercial_plan_versions).toHaveBeenCalledWith("id", planId);
    expect(queries.campaigns).toHaveBeenCalledWith(
      "commercial_plan_version_id",
      planId,
    );
  });
  it("reopens the matching campaign without preparing another creation", async () => {
    const { client, raw } = clientFor(selected, { id: campaignId });
    expect(
      await loadCampaignPlanLaunch(client, projectId, workspaceId, planId),
    ).toEqual({ kind: "campaign", id: campaignId });
    expect(raw.rpc).not.toHaveBeenCalled();
  });
  it("does not substitute a latest plan for missing or inaccessible selections", async () => {
    const { client, raw } = clientFor(null);
    expect(
      await loadCampaignPlanLaunch(client, projectId, workspaceId, planId),
    ).toEqual({ kind: "missing" });
    expect(raw.from).toHaveBeenCalledTimes(1);
    const denied = clientFor(null, null, false, { code: "42501" });
    expect(
      await loadCampaignPlanLaunch(
        denied.client,
        projectId,
        workspaceId,
        planId,
      ),
    ).toEqual({ kind: "permission" });
  });
  it("rejects malformed IDs before querying and preserves read-only access", async () => {
    const { client, raw } = clientFor(selected, null, false);
    expect(
      await loadCampaignPlanLaunch(client, projectId, workspaceId, "wrong"),
    ).toEqual({ kind: "missing" });
    expect(raw.from).not.toHaveBeenCalled();
    expect(
      await loadCampaignPlanLaunch(client, projectId, workspaceId, planId),
    ).toMatchObject({ kind: "plan", canManage: false });
  });
  it("fails on query errors rather than showing an unrelated campaign", async () => {
    const { client } = clientFor(null, null, false, { code: "08006" });
    await expect(
      loadCampaignPlanLaunch(client, projectId, workspaceId, planId),
    ).rejects.toThrow("selected commercial plan could not be loaded");
  });
  it("fails closed when the campaign lookup or permission check fails", async () => {
    const broken = clientFor(selected, null, true, null, { code: "08006" });
    await expect(
      loadCampaignPlanLaunch(broken.client, projectId, workspaceId, planId),
    ).rejects.toThrow("campaign could not be loaded");
    expect(broken.raw.rpc).not.toHaveBeenCalled();
    const denied = clientFor(selected, null, true, null, { code: "42501" });
    expect(
      await loadCampaignPlanLaunch(
        denied.client,
        projectId,
        workspaceId,
        planId,
      ),
    ).toEqual({ kind: "permission" });
    const permissionFailure = clientFor();
    permissionFailure.raw.rpc.mockResolvedValue({
      data: true,
      error: { code: "08006" },
    });
    await expect(
      loadCampaignPlanLaunch(
        permissionFailure.client,
        projectId,
        workspaceId,
        planId,
      ),
    ).rejects.toThrow("permissions could not be prepared");
  });
});
