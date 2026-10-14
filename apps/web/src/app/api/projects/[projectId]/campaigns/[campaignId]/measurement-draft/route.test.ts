import { beforeEach, expect, it, vi } from "vitest";
const { createClient, rpc, basketTimingEnabled } = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  basketTimingEnabled: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/baskets/timing-enabled", () => ({ basketTimingEnabled }));
vi.mock("@/lib/observability", () => ({ logError: () => "reference" }));
import { POST } from "./route";
import { project } from "@/lib/demo-data";
const campaignId = "90000000-0000-4000-8000-000000000001";
const newId = "90000000-0000-4000-8000-000000000002";
const body = {
  sourcePlanId: "94000000-0000-4000-8000-000000000001",
  requestId: "94000000-0000-4000-8000-000000000002",
};
const context = (projectId = "helios", id = campaignId) => ({
  params: Promise.resolve({ projectId, campaignId: id }),
});
const request = (data: unknown = body) =>
  new Request("https://landed.test/setup", {
    method: "POST",
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  basketTimingEnabled.mockReturnValue(true);
  createClient.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ data: newId, error: null });
});
it("passes exact campaign, approval and retry key through authenticated scope", async () => {
  const result = await POST(request(), context());
  expect(result.status).toBe(201);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await result.json()).toEqual({ ...body, campaignId, basketId: newId });
  expect(rpc).toHaveBeenCalledWith("create_campaign_measurement_draft", {
    target_project_id: project.databaseId,
    target_campaign_id: campaignId,
    expected_source_plan_id: body.sourcePlanId,
    target_request_id: body.requestId,
  });
});
it("keeps environment gating ahead of database access", async () => {
  basketTimingEnabled.mockReturnValue(false);
  expect((await POST(request(), context())).status).toBe(503);
  expect(createClient).not.toHaveBeenCalled();
});
it("rejects caller supplied rules, actors, snapshots and foreign routes", async () => {
  for (const extra of [{ actorId: newId }, { snapshot: {} }, { ruleId: newId }])
    expect((await POST(request({ ...body, ...extra }), context())).status).toBe(
      400,
    );
  expect((await POST(request(), context("other"))).status).toBe(404);
  expect((await POST(request(), context("helios", "bad"))).status).toBe(404);
  expect(createClient).not.toHaveBeenCalled();
});
it.each([
  ["42501", 403],
  ["PT409", 409],
  ["P0002", 409],
  ["22023", 422],
  ["23503", 422],
  ["23514", 422],
  ["55000", 422],
  ["XX000", 500],
] as const)("sanitizes %s as %s", async (code, status) => {
  rpc.mockResolvedValue({
    data: null,
    error: { code, message: "private detail" },
  });
  const result = await POST(request(), context());
  expect(result.status).toBe(status);
  expect(JSON.stringify(await result.json())).not.toContain("private detail");
});
it("treats invalid returned identities as uncertain creation", async () => {
  rpc.mockResolvedValue({ data: "https://evil.test", error: null });
  expect((await POST(request(), context())).status).toBe(500);
});
