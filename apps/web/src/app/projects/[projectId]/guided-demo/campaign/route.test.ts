import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { GET } from "./route";

const campaignId = "aa000000-0000-4000-8000-000000000001";

function context(projectId = "helios") {
  return { params: Promise.resolve({ projectId }) };
}

function request(view = "workspace") {
  return new Request(
    `https://landed.test/projects/helios/guided-demo/campaign?view=${view}&demo=1&demoStep=6&demoOpen=0`,
  );
}

describe("guided demo campaign resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: vi.fn(async () => ({
              data: { campaign_id: campaignId },
              error: null,
            })),
          }),
        }),
      }),
    });
  });

  it("resolves the canonical report to one exact campaign and preserves guide state", async () => {
    const response = await GET(request("content-assets"), context());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://landed.test/projects/helios/campaigns/${campaignId}?view=content&demo=1&demoStep=6&demoOpen=0#content-assets`,
    );
  });

  it.each([
    ["workspace", "control", ""],
    ["content-assets", "content", "#content-assets"],
    ["tracking", "tracking", "#content-assets"],
  ])("opens the mounted %s view", async (input, view, hash) => {
    const response = await GET(request(input), context());
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("view")).toBe(view);
    expect(destination.hash).toBe(hash);
  });

  it("does not propagate arbitrary review or destination parameters", async () => {
    const source = new URL(request("tracking").url);
    source.searchParams.set("executionReview", "foreign-review");
    source.searchParams.set("executionJob", "foreign-job");
    source.searchParams.set("next", "https://foreign.test/");
    const response = await GET(new Request(source), context());
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe(source.origin);
    expect([...destination.searchParams.keys()]).toEqual([
      "view",
      "demo",
      "demoStep",
      "demoOpen",
    ]);
  });

  it("rejects unknown views before accessing the database", async () => {
    expect((await GET(request("unexpected"), context())).status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid project, missing manifest or restricted record", async () => {
    expect((await GET(request(), context("foreign"))).status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();

    fromMock.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
      }),
    });
    expect((await GET(request(), context())).status).toBe(404);

    fromMock.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: vi.fn(async () => ({
              data: null,
              error: { code: "42501" },
            })),
          }),
        }),
      }),
    });
    expect((await GET(request(), context())).status).toBe(403);
  });
});
