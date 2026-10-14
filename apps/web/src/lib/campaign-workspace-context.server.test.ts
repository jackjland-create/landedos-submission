import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import fixture from "../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";
import { getCampaignWorkspaceContext } from "./campaign-workspace-context.server";
import { workspaceFixture as campaign } from "./campaign-workspace.fixture";
function client(plan: unknown, report: unknown, error = false) {
  const calls: unknown[][] = [];
  return {
    calls,
    value: {
      from: (table: string) => {
        const chain = {
          select: (...args: unknown[]) => {
            calls.push([table, "select", ...args]);
            return chain;
          },
          eq: (...args: unknown[]) => {
            calls.push([table, "eq", ...args]);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data:
              table === "commercial_plan_versions"
                ? { snapshot: plan }
                : report,
            error: error ? { code: "42501" } : null,
          }),
        };
        return chain;
      },
    } as unknown as SupabaseClient,
  };
}
it("reads exact plan and issued campaign context under all tenant keys", async () => {
  const db = client(fixture.review_snapshot, {
    report_id: "d2000000-0000-4000-8000-000000000001",
    version: 6,
  });
  const result = await getCampaignWorkspaceContext(db.value, campaign);
  expect(result.trackingRestricted).toBe(true);
  expect(result.planAvailable).toBe(true);
  expect(result.measurementRule).toEqual({
    state: "retained",
    name: fixture.review_snapshot.strategyBinding.conversionRule.name,
    version: fixture.review_snapshot.strategyBinding.conversionRule.version,
  });
  expect(result.flight).toEqual(
    fixture.review_snapshot.strategyBinding.timing.flight,
  );
  expect(result.report?.version).toBe(6);
  for (const table of ["commercial_plan_versions", "report_versions"]) {
    expect(db.calls).toContainEqual([
      table,
      "eq",
      "workspace_id",
      campaign.workspaceId,
    ]);
    expect(db.calls).toContainEqual([
      table,
      "eq",
      "project_id",
      campaign.projectId,
    ]);
  }
  expect(db.calls).toContainEqual([
    "commercial_plan_versions",
    "eq",
    "id",
    campaign.commercialPlanVersionId,
  ]);
  expect(db.calls).toContainEqual([
    "report_versions",
    "eq",
    "campaign_id",
    campaign.id,
  ]);
  expect(db.calls).toContainEqual([
    "report_versions",
    "eq",
    "status",
    "issued",
  ]);
});
it.each(["basket", "workspace", "project"])(
  "does not present a rule from a mismatched %s snapshot",
  async (scope) => {
    const snapshot = structuredClone(fixture.review_snapshot);
    const other = "90000000-0000-4000-8000-000000000099";
    if (scope === "basket") snapshot.basket.id = other;
    if (scope === "workspace") snapshot.workspaceId = other;
    if (scope === "project") snapshot.projectId = other;
    expect(
      (
        await getCampaignWorkspaceContext(
          client(snapshot, null).value,
          campaign,
        )
      ).measurementRule,
    ).toEqual({ state: "unavailable" });
  },
);
it("fails closed on inaccessible or malformed plan/report without inventing absence", async () => {
  const db = client(null, { report_id: "bad", version: 1 }, true);
  expect(await getCampaignWorkspaceContext(db.value, campaign)).toEqual({
    planAvailable: false,
    trackingRestricted: true,
    flight: null,
    measurement: null,
    report: null,
    reportUnavailable: true,
    measurementRule: { state: "unavailable" },
  });
});
it("keeps a successful empty issued-report read distinct from failure", async () => {
  const db = client(fixture.review_snapshot, null);
  const result = await getCampaignWorkspaceContext(db.value, campaign);
  expect(result.report).toBeNull();
  expect(result.reportUnavailable).toBe(false);
});
it("keeps a valid legacy approval unbound instead of selecting a current rule", async () => {
  const { basket, scenario, packages } = fixture.review_snapshot;
  const legacy = { schemaVersion: 1, basket, scenario, packages };
  const result = await getCampaignWorkspaceContext(
    client(legacy, null).value,
    campaign,
  );
  expect(result.measurementRule).toEqual({ state: "unbound" });
  expect(result.trackingRestricted).toBe(false);
});
