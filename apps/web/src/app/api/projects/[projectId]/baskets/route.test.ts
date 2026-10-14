import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, logErrorMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_basket_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  logError: logErrorMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { POST } from "./route";

const creatorId = "40000000-0000-4000-8000-000000000001";
const basketId = "90000000-0000-4000-8000-000000000001";

function context(projectId = "helios") {
  return { params: Promise.resolve({ projectId }) };
}

function request(body: unknown) {
  return new Request("https://landed.test/api/projects/helios/baskets", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("basket creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
  });

  it("creates three-scenario basket setup through the atomic database boundary", async () => {
    rpcMock.mockResolvedValue({ data: basketId, error: null });

    const response = await POST(
      request({
        creatorIds: [creatorId, "40000000-0000-4000-8000-000000000002"],
      }),
      context(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpcMock).toHaveBeenCalledWith("create_goal_led_basket", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      basket_name: "Helios Mobile roster",
      initial_strategy: {
        goal: null,
        audience: null,
        sector: null,
        rationale: null,
        allocations: [],
        measurement: null,
        assumptions: [],
        missingEvidence: [],
        exclusions: [],
        rebalanceQuestions: [],
      },
      creator_ids: [creatorId, "40000000-0000-4000-8000-000000000002"],
      template_key: null,
      template_version: null,
    });
    expect(await response.json()).toEqual({ basketId });
  });

  it("rejects an empty creator selection before database access", async () => {
    const response = await POST(request({ creatorIds: [] }), context());

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid"],
    Array.from(
      { length: 21 },
      (_, index) =>
        `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ])(
    "rejects invalid roster %j before database access",
    async (...creatorIds) => {
      const response = await POST(request({ creatorIds }), context());
      expect(response.status).toBe(400);
      expect(createClientMock).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown project before database access", async () => {
    const response = await POST(
      request({ creatorIds: [creatorId] }),
      context("other-project"),
    );
    expect(response.status).toBe(404);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns a safe selection error for a duplicate roster before database access", async () => {
    const response = await POST(
      request({ creatorIds: [creatorId, creatorId] }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "The selected creators could not be added to a basket.",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("does not return a malformed basket identifier", async () => {
    rpcMock.mockResolvedValue({ data: "invalid", error: null });
    const response = await POST(
      request({ creatorIds: [creatorId] }),
      context(),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Basket setup could not be created.",
      reference: "corr_basket_test",
    });
  });

  it("fails closed when the caller cannot manage the project", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501" },
    });

    const response = await POST(
      request({ creatorIds: [creatorId] }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Basket setup requires campaign manager access.",
    });
  });

  it("logs unexpected database failures as safe server errors", async () => {
    const error = { code: "XX000", message: "database detail" };
    rpcMock.mockResolvedValue({ data: null, error });

    const response = await POST(
      request({ creatorIds: [creatorId] }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "basket_creation_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Basket setup could not be created.",
      reference: "corr_basket_test",
    });
  });
});
