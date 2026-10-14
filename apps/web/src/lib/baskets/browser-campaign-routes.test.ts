// @vitest-environment node
// HTTP gates only: no database, Auth service or retained resource is contacted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/baskets/browser-campaign-runtime.server", async (original) => {
  const actual =
    await original<typeof import("./browser-campaign-runtime.server")>();
  return {
    ...actual,
    assertBrowserCampaignHost: mocks.gate,
    runBrowserCommercialAction: async (client: unknown, input: unknown) =>
      mocks.run(client, actual.commercialActionSchema.parse(input)),
    withBrowserCampaignTransaction: mocks.transaction,
  };
});
import * as commercial from "@/app/api/isolated-campaign-commercial/route";
import * as execution from "@/app/api/isolated-campaign-execution/route";
const origin = "http://127.0.0.1:3213";
const id = "90000000-0000-4000-8000-000000000001";
function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
  headers: Record<string, string> = {},
  raw?: string,
) {
  return new NextRequest(
    origin +
      "/api/test" +
      (method === "GET"
        ? "?" + new URLSearchParams(input as Record<string, string>)
        : ""),
    {
      method,
      headers: {
        host: "127.0.0.1:3213",
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...headers,
      },
      ...(method === "POST" ? { body: raw ?? JSON.stringify(input) } : {}),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.run.mockResolvedValue({ status: "not_recorded" });
  mocks.transaction.mockResolvedValue({ status: "not_recorded" });
});
for (const [name, route, prepare, recover] of [
  [
    "commercial",
    commercial,
    { action: "prepare", basketId: id, scenarioId: id, revision: 1 },
    { action: "recover", basketId: id, reviewId: id },
  ],
  [
    "execution",
    execution,
    { action: "prepare", campaignId: id },
    { action: "recover", campaignId: id, reviewId: id },
  ],
] as const)
  describe(`${name} isolated HTTP boundary`, () => {
    it.each<Record<string, string>>([
      { origin: "" },
      { origin: "https://outsider.test" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ])(
      "rejects hostile/missing origin metadata before client work: %j",
      async (headers) => {
        const input = request("POST", prepare, headers);
        if (headers.origin === "") input.headers.delete("origin");
        const result = await route.POST(input);
        expect(result.status).toBe(403);
        expect(result.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.client).not.toHaveBeenCalled();
      },
    );
    it("hides unavailable runtime before parsing or opening Auth", async () => {
      mocks.gate.mockImplementation(() => {
        throw Error("disabled");
      });
      const result = await route.POST(request("POST", prepare, {}, "invalid"));
      expect(result.status).toBe(404);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.client).not.toHaveBeenCalled();
    });
    it.each(["GET-write", "POST-read", "unknown"])(
      "rejects wrong method/action: %s",
      async (kind) => {
        const result =
          kind === "GET-write"
            ? await route.GET(request("GET", prepare))
            : await route.POST(
                request(
                  "POST",
                  kind === "POST-read" ? recover : { action: "invented" },
                ),
              );
        expect(result.status).toBe(409);
        expect(mocks.run).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
      },
    );
    it.each(["bad-json", "too-large", "wrong-content"])(
      "rejects malformed body: %s",
      async (kind) => {
        const result = await route.POST(
          request(
            "POST",
            prepare,
            kind === "wrong-content" ? { "content-type": "text/plain" } : {},
            kind === "bad-json"
              ? "{"
              : kind === "too-large"
                ? " ".repeat(16001)
                : undefined,
          ),
        );
        expect(result.status).toBe(409);
        expect(mocks.client).not.toHaveBeenCalled();
      },
    );
    it("rejects actor override using the real strict input schema", async () => {
      const result = await route.POST(
        request("POST", { ...prepare, actorId: id }),
      );
      expect(result.status).toBe(409);
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it.each(["auth", "runtime"])(
      "sanitizes %s failure without automatic retry",
      async (kind) => {
        if (kind === "auth")
          mocks.client.mockRejectedValue(Error("private Auth detail"));
        else {
          mocks.run.mockRejectedValue(Error("private database detail"));
          mocks.transaction.mockRejectedValue(Error("private database detail"));
        }
        const result = await route.POST(request("POST", prepare));
        expect(result.status).toBe(409);
        expect(await result.text()).not.toContain("private");
        expect(result.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.client).toHaveBeenCalledTimes(1);
      },
    );
    it("returns private, noncached successful recovery without a write action", async () => {
      const result = await route.GET(request("GET", recover));
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    });
  });
