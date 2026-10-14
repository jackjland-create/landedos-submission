import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  preview: vi.fn(),
  user: vi.fn(),
  log: vi.fn(() => "review-ref"),
}));
vi.mock("@landed/db", async (original) => ({
  ...(await original<typeof import("@landed/db")>()),
  previewTimedBasketApproval: mocks.preview,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/observability", () => ({ logError: mocks.log }));
import { BasketTimedReviewError } from "@landed/db";
import { POST } from "@/app/api/projects/[projectId]/baskets/[basketId]/timing/review/route";
const id = "90000000-0000-4000-8000-000000000001";
const owner = "91000000-0000-4000-8000-000000000001";
const url = `http://localhost:3210/api/projects/helios/baskets/${id}/timing/review`;
const body = {
  expectedOwnerId: owner,
  scenarioId: id,
  expectedRevision: 3,
  expectedTiming: {
    schemaVersion: 1,
    flight: {
      startedAt: "2026-09-14T00:00:00Z",
      endedAt: "2026-10-01T00:00:00Z",
    },
    measurement: {
      startedAt: "2026-09-14T00:00:00Z",
      endedAt: "2026-10-12T00:00:00Z",
    },
  },
};
const context = (projectId = "helios", basketId = id) => ({
  params: Promise.resolve({ projectId, basketId }),
});
const request = (value: unknown = body, origin = "http://localhost:3210") =>
  new Request(url, {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ENABLE_BASKET_TIMING", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.user } });
  mocks.preview.mockResolvedValue({
    snapshot: { retained: true },
    snapshotHash: "abc",
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("local saved timed-plan review route", () => {
  it("allows the highest saved revision for a read-only review", async () => {
    expect(
      (
        await POST(
          request({ ...body, expectedRevision: 2147483647 }),
          context(),
        )
      ).status,
    ).toBe(200);
  });
  it("returns only a preview with approval explicitly unavailable", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      ownerId: owner,
      approvalAvailable: false,
    });
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(
      await mocks.createClient(),
      {
        workspaceId: "10000000-0000-4000-8000-000000000001",
        projectId: "20000000-0000-4000-8000-000000000001",
        basketId: id,
        scenarioId: id,
        expectedRevision: 3,
        expectedTiming: body.expectedTiming,
      },
    );
  });
  it.each(["", "null", "https://evil.test"])(
    "rejects origin %s before access",
    async (origin) => {
      expect((await POST(request(body, origin), context())).status).toBe(403);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
  it("rejects hosted and disabled access before authentication", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request(), context())).status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects scope overrides, malformed dates and wrong routes", async () => {
    for (const value of [
      { ...body, workspaceId: id },
      { ...body, expectedRevision: 0 },
      { ...body, expectedTiming: null },
    ])
      expect((await POST(request(value), context())).status).toBe(400);
    expect((await POST(request(), context("other"))).status).toBe(404);
    expect((await POST(request(), context("helios", "invalid"))).status).toBe(
      404,
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects changed identity and signout before preview", async () => {
    expect(
      (await POST(request({ ...body, expectedOwnerId: id }), context())).status,
    ).toBe(403);
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request(), context())).status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([
    ["forbidden", 403],
    ["changed", 409],
    ["unavailable", 503],
  ] as const)("maps %s without retry", async (code, status) => {
    mocks.preview.mockRejectedValue(new BasketTimedReviewError(code));
    expect((await POST(request(), context())).status).toBe(status);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
  it("does not expose private failure text", async () => {
    mocks.preview.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider");
  });
});
