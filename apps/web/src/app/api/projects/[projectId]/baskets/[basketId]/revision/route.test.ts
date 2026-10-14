import { beforeEach, expect, it, vi } from "vitest";
const { createClient, rpc, logError } = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  logError: vi.fn(() => "ref"),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/observability", () => ({ logError }));
import { POST } from "./route";
import { project } from "@/lib/demo-data";
const basketId = "90000000-0000-4000-8000-000000000001";
const newId = "90000000-0000-4000-8000-000000000002";
const body = {
  sourcePlanId: "94000000-0000-4000-8000-000000000001",
  requestId: "94000000-0000-4000-8000-000000000002",
};
const context = (projectId = "helios") => ({
  params: Promise.resolve({ projectId, basketId }),
});
const request = (data: unknown = body) =>
  new Request("https://landed.test/revision", {
    method: "POST",
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ data: newId, error: null });
});
it("passes exact source and request to authenticated RPC without caller actor or snapshot", async () => {
  const result = await POST(request(), context());
  expect(result.status).toBe(201);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await result.json()).toEqual({ ...body, basketId: newId });
  expect(rpc).toHaveBeenCalledWith("create_basket_revision_draft", {
    target_project_id: project.databaseId,
    target_basket_id: basketId,
    source_plan_id: body.sourcePlanId,
    revision_request_id: body.requestId,
  });
});
it("rejects forged actor/snapshot inputs and a foreign route before DB access", async () => {
  expect(
    (await POST(request({ ...body, actorId: newId, snapshot: {} }), context()))
      .status,
  ).toBe(400);
  expect((await POST(request(), context("other"))).status).toBe(404);
  expect(createClient).not.toHaveBeenCalled();
});
it.each([
  ["42501", 403],
  ["P0002", 404],
  ["PT409", 409],
  ["23503", 422],
  ["22023", 422],
  ["XX000", 500],
] as const)("sanitizes %s as %s", async (code, status) => {
  rpc.mockResolvedValue({
    data: null,
    error: { code, message: "private database detail" },
  });
  const result = await POST(request(), context());
  expect(result.status).toBe(status);
  expect(JSON.stringify(await result.json())).not.toContain(
    "private database detail",
  );
});
it.each([basketId, "invalid"])(
  "rejects unsafe returned ID %s",
  async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(), context())).status).toBe(500);
  },
);
