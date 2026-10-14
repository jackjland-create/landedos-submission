import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  log: vi.fn(() => "timing-ref"),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@landed/db", () => ({
  loadBasketTiming: mocks.load,
  saveBasketTiming: mocks.save,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/observability", () => ({ logError: mocks.log }));
import {
  GET,
  PUT,
} from "@/app/api/projects/[projectId]/baskets/[basketId]/timing/route";
import { basketTimingClient } from "./timing-client";
import { createTimingSession } from "./timing-session";
import { basketTimingEnabled } from "./timing-enabled";
const basketId = "90000000-0000-4000-8000-000000000001";
const timing = {
  schemaVersion: 1 as const,
  flight: {
    startedAt: "2026-09-14T09:00:00Z",
    endedAt: "2026-10-05T17:00:00Z",
  },
  measurement: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-10-12T17:00:00Z",
  },
};
const context = (projectId = "helios") => ({
  params: Promise.resolve({ projectId, basketId }),
});
const url = `http://localhost:3210/api/projects/helios/baskets/${basketId}/timing`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ENABLE_BASKET_TIMING", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "91000000-0000-4000-8000-000000000011" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
  mocks.load.mockResolvedValue({ revision: 3, timing });
  mocks.save.mockResolvedValue({ revision: 4 });
});
afterEach(() => vi.unstubAllEnvs());
const write = (body: unknown, origin = "http://localhost:3210") =>
  new Request(url, {
    method: "PUT",
    headers: { origin },
    body: JSON.stringify(
      body && typeof body === "object"
        ? {
            expectedOwnerId: "91000000-0000-4000-8000-000000000011",
            ...body,
          }
        : body,
    ),
  });

describe("BSK-09 local timing connection", () => {
  it("accepts the exact loopback browser origin when Next normalizes its internal URL", async () => {
    vi.stubEnv("LANDED_BROWSER_CAMPAIGN", "1");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
    const request = write(
      { expectedRevision: 3, timing },
      "http://127.0.0.1:3210",
    );
    request.headers.set("host", "127.0.0.1:3210");
    request.headers.set("sec-fetch-site", "same-origin");
    expect((await PUT(request, context())).status).toBe(200);
  });
  it("accepts only the exact loopback origin in the production-shaped external devnet rehearsal", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REHEARSAL", "1");
    vi.stubEnv("LANDED_EXTERNAL_DEVNET_SESSION", "1");
    vi.stubEnv("EXTERNAL_DEVNET_PUBLIC_GATE", "1");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");

    const accepted = write(
      { expectedRevision: 3, timing },
      "http://127.0.0.1:3210",
    );
    accepted.headers.set("host", "127.0.0.1:3210");
    accepted.headers.set("sec-fetch-site", "same-origin");
    expect((await PUT(accepted, context())).status).toBe(200);

    const rejected = write(
      { expectedRevision: 3, timing },
      "http://127.0.0.1:3210",
    );
    rejected.headers.set("host", "127.0.0.1:3210");
    rejected.headers.set("sec-fetch-site", "cross-site");
    expect((await PUT(rejected, context())).status).toBe(403);
  });
  it.each([
    ["evil.test:3210", "http://evil.test:3210", "same-origin"],
    ["127.0.0.1:3211", "http://127.0.0.1:3211", "same-origin"],
    ["127.0.0.1:3210", "http://127.0.0.1:3210", "cross-site"],
    ["127.0.0.1:3210", "http://localhost:3210", "same-origin"],
  ])(
    "rejects mismatched local authority or cross-site metadata",
    async (host, origin, site) => {
      vi.stubEnv("LANDED_BROWSER_CAMPAIGN", "1");
      vi.stubEnv("VERCEL_ENV", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
      const request = write({ expectedRevision: 3, timing }, origin);
      request.headers.set("host", host);
      request.headers.set("sec-fetch-site", site);
      expect((await PUT(request, context())).status).toBe(403);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
  it("rejects incomplete identity or permission at the browser read boundary", async () => {
    for (const body of [
      { revision: 3, timing },
      { ownerId: "91000000-0000-4000-8000-000000000011", revision: 3, timing },
    ]) {
      const transport = basketTimingClient(
        "helios",
        basketId,
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      await expect(transport.load()).rejects.toThrow();
    }
  });
  it("rejects a changed account before saving and denies signed-out reads", async () => {
    const response = await PUT(
      write({
        expectedRevision: 3,
        timing,
        expectedOwnerId: "91000000-0000-4000-8000-000000000099",
      }),
      context(),
    );
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(new Request(url), context())).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("requires an explicit loopback database for local enablement", () => {
    expect(
      basketTimingEnabled({
        NODE_ENV: "development",
        ENABLE_BASKET_TIMING: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBe(true);
    for (const url of [
      undefined,
      "https://project.supabase.co",
      "http://127.0.0.1.evil.test:54321",
      "invalid",
    ])
      expect(
        basketTimingEnabled({
          NODE_ENV: "development",
          ENABLE_BASKET_TIMING: "1",
          NEXT_PUBLIC_SUPABASE_URL: url,
        }),
      ).toBe(false);
  });
  it("enables only the exact production-shaped isolated external rehearsal", () => {
    const external = {
      NODE_ENV: "production",
      ENABLE_BASKET_TIMING: "1",
      LANDED_LOCAL_DEVNET_REHEARSAL: "1",
      LANDED_EXTERNAL_DEVNET_SESSION: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
    };
    expect(basketTimingEnabled(external)).toBe(true);
    expect(
      basketTimingEnabled({
        ...external,
        LANDED_EXTERNAL_DEVNET_SESSION: undefined,
      }),
    ).toBe(false);
    expect(
      basketTimingEnabled({
        ...external,
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toBe(false);
    expect(basketTimingEnabled({ ...external, VERCEL: "1" })).toBe(false);
  });
  it("connects browser transport, session and routes through a confirmed save", async () => {
    mocks.save.mockImplementation(async (_client, input) => {
      mocks.load.mockResolvedValue({
        revision: input.expectedRevision + 1,
        timing: input.timing,
      });
      return { revision: input.expectedRevision + 1 };
    });
    const fetcher = vi.fn(async (_url, init) => {
      const request = new Request(url, {
        ...init,
        headers: { ...init?.headers, origin: "http://localhost:3210" },
      });
      return init?.method === "PUT"
        ? PUT(request, context())
        : GET(request, context());
    });
    const session = createTimingSession(
      basketTimingClient("helios", basketId, fetcher),
    );
    expect(await session.loadSaved()).toBe(true);
    session.edit("measurementEnd", "2026-10-13T17:00");
    expect(await session.save()).toBe(true);
    expect(session.reviewContext()?.expectedRevision).toBe(4);
    expect(session.read().saved?.timing?.measurement.endedAt).toBe(
      "2026-10-13T17:00:00Z",
    );
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    expect(
      fetcher.mock.calls.every(
        (call) =>
          call[1]?.credentials === "same-origin" &&
          call[1]?.redirect === "error" &&
          call[1]?.cache === "no-store",
      ),
    ).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(
      { auth: { getUser: mocks.getUser }, rpc: mocks.rpc },
      expect.objectContaining({
        workspaceId: "10000000-0000-4000-8000-000000000001",
        projectId: "20000000-0000-4000-8000-000000000001",
        basketId,
        expectedRevision: 3,
      }),
    );
  });
  it.each([
    { NODE_ENV: "production", ENABLE_BASKET_TIMING: "1" },
    { NODE_ENV: "development", ENABLE_BASKET_TIMING: "1", VERCEL: "1" },
    { NODE_ENV: "development" },
  ])("cannot enable hosted or unflagged runtime", (env) =>
    expect(basketTimingEnabled(env)).toBe(false),
  );
  it("blocks disabled route before any database access", async () => {
    vi.stubEnv("ENABLE_BASKET_TIMING", "");
    expect((await GET(new Request(url), context())).status).toBe(404);
    expect(
      (await PUT(write({ expectedRevision: 3, timing }), context())).status,
    ).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects wrong project and forged scope before database access", async () => {
    expect((await GET(new Request(url), context("other"))).status).toBe(404);
    expect(
      (
        await PUT(
          write({ expectedRevision: 3, timing, workspaceId: "forged" }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", "null", ""])(
    "rejects cross-origin or missing-origin writes",
    async (origin) => {
      expect(
        (await PUT(write({ expectedRevision: 3, timing }, origin), context()))
          .status,
      ).toBe(403);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
  it("keeps scoped missing records private and unavailable", async () => {
    mocks.load.mockResolvedValue(null);
    const response = await GET(new Request(url), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("fails closed on write rejection without provider text or retries", async () => {
    mocks.save.mockRejectedValue(new Error("private provider details"));
    const response = await PUT(
      write({ expectedRevision: 3, timing }),
      context(),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { expectedRevision: 0, timing },
    { expectedRevision: 3, timing: null },
  ])("validates before writes", async (body) => {
    expect((await PUT(write(body), context())).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
