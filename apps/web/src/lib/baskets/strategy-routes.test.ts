import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftCustomBasket, getPreparedBasket } from "@landed/contracts";

const { rpc, createClient, getSavedBasketStrategy, logError } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    createClient: vi.fn(),
    getSavedBasketStrategy: vi.fn(),
    logError: vi.fn(() => "corr_strategy"),
  }),
);
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/observability", () => ({ logError }));
vi.mock("@landed/db", () => ({ getSavedBasketStrategy }));
import { POST as createDraft } from "@/app/api/projects/[projectId]/baskets/drafts/route";
import {
  GET,
  PUT,
} from "@/app/api/projects/[projectId]/baskets/[basketId]/strategy/route";
import { POST as addCreators } from "@/app/api/projects/[projectId]/baskets/[basketId]/creators/route";

const basketId = "90000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
const context = (projectId = "helios") => ({
  params: Promise.resolve({ projectId, basketId }),
});
const request = (body: unknown, method = "POST") =>
  new Request("https://landed.test/api/projects/helios/baskets/drafts", {
    method,
    body: JSON.stringify(body),
  });
const saveInput = {
  expectedRevision: 1,
  name: "Plan",
  strategy: draftCustomBasket({ name: "Plan" }).strategy,
};
describe("BSK-08 strategy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ rpc });
  });
  it("creates a goal-first empty draft without fabricating creators", async () => {
    rpc.mockResolvedValue({ data: basketId, error: null });
    const response = await createDraft(
      request({ kind: "custom", name: "Plan", goal: "Reach investors" }),
      context(),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith(
      "create_goal_led_basket",
      expect.objectContaining({
        target_project_id: "20000000-0000-4000-8000-000000000001",
        creator_ids: [],
        template_key: null,
        initial_strategy: expect.objectContaining({ goal: "Reach investors" }),
      }),
    );
  });
  it("passes an exact prepared reference and canonical starting strategy", async () => {
    rpc.mockResolvedValue({ data: basketId, error: null });
    expect(
      (
        await createDraft(
          request({
            kind: "prepared",
            templateKey: "investor_reach",
            templateVersion: 1,
            creatorIds: [creatorId],
          }),
          context(),
        )
      ).status,
    ).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "create_goal_led_basket",
      expect.objectContaining({
        template_key: "investor_reach",
        template_version: 1,
        initial_strategy: getPreparedBasket("investor_reach", 1)!.strategy,
      }),
    );
  });
  it("rejects unknown template versions and forged provenance before DB access", async () => {
    for (const body of [
      { kind: "prepared", templateKey: "investor_reach", templateVersion: 999 },
      { kind: "custom", name: "Plan", origin: { kind: "prepared" } },
    ]) {
      expect((await createDraft(request(body), context())).status).toBe(400);
    }
    expect(createClient).not.toHaveBeenCalled();
  });
  it("resumes through the authenticated scoped query", async () => {
    getSavedBasketStrategy.mockResolvedValue({ basketId, revision: 2 });
    const response = await GET(new Request("https://landed.test"), context());
    expect(response.status).toBe(200);
    expect(getSavedBasketStrategy).toHaveBeenCalledWith(
      { rpc },
      "20000000-0000-4000-8000-000000000001",
      basketId,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("keeps hidden records indistinguishable from missing records", async () => {
    getSavedBasketStrategy.mockResolvedValue(null);
    expect(
      (await GET(new Request("https://landed.test"), context())).status,
    ).toBe(404);
  });
  it("saves using expected revision and cannot send origin changes", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(
      await (await PUT(request(saveInput, "PUT"), context())).json(),
    ).toEqual({ revision: 2 });
    expect(rpc).toHaveBeenCalledWith(
      "save_basket_strategy",
      expect.objectContaining({
        expected_revision: 1,
        target_basket_id: basketId,
      }),
    );
    expect(
      (
        await PUT(
          request({ ...saveInput, origin: { kind: "custom" } }, "PUT"),
          context(),
        )
      ).status,
    ).toBe(400);
  });
  it("rejects an owner-bound save after an account switch before the RPC", async () => {
    createClient.mockResolvedValue({
      rpc,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: creatorId } },
          error: null,
        }),
      },
    });
    expect(
      (
        await PUT(
          request({ ...saveInput, expectedOwnerId: basketId }, "PUT"),
          context(),
        )
      ).status,
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a fresh recovery read for a different authenticated owner", async () => {
    createClient.mockResolvedValue({
      rpc,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: creatorId } },
          error: null,
        }),
      },
    });
    const response = await GET(
      new Request("https://landed.test", {
        headers: { "X-Landed-Expected-Owner": basketId },
      }),
      context(),
    );
    expect(response.status).toBe(403);
    expect(getSavedBasketStrategy).not.toHaveBeenCalled();
  });
  it("appends creators to the exact basket instead of creating another", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect(
      (
        await addCreators(
          request({ expectedRevision: 2, creatorIds: [creatorId] }),
          context(),
        )
      ).status,
    ).toBe(200);
    expect(rpc).toHaveBeenCalledWith("add_basket_strategy_creators", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_basket_id: basketId,
      expected_revision: 2,
      creator_ids: [creatorId],
    });
  });
  it.each([
    ["42501", 403],
    ["40001", 409],
    ["PT409", 409],
    ["55000", 409],
    ["22023", 400],
    ["23503", 400],
    ["XX000", 500],
  ])("safely maps database error %s", async (code, status) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: "private provider details" },
    });
    const response = await PUT(request(saveInput, "PUT"), context());
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private provider details",
    );
  });
  it("rejects wrong project and malformed payload without DB access", async () => {
    expect(
      (await PUT(request(saveInput, "PUT"), context("other"))).status,
    ).toBe(404);
    expect(
      (
        await addCreators(
          request({ expectedRevision: 1, creatorIds: [] }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("rejects malformed RPC results and handles network failures", async () => {
    rpc.mockResolvedValue({ data: "wrong", error: null });
    expect((await PUT(request(saveInput, "PUT"), context())).status).toBe(500);
    createClient.mockRejectedValue(new Error("private connection detail"));
    expect(
      (await createDraft(request({ kind: "custom", name: "Plan" }), context()))
        .status,
    ).toBe(500);
  });
});
