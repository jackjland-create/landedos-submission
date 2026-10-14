import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, deleteMock, fromMock, insertMock, logErrorMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    deleteMock: vi.fn(),
    fromMock: vi.fn(),
    insertMock: vi.fn(),
    logErrorMock: vi.fn(() => "corr_assignment_test"),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/observability", () => ({
  logError: logErrorMock,
}));

import { POST } from "./route";

const basketId = "90000000-0000-4000-8000-000000000001";
const scenarioId = "91000000-0000-4000-8000-000000000001";
const packageId = "92000000-0000-4000-8000-000000000001";

function context() {
  return {
    params: Promise.resolve({ projectId: "helios", basketId }),
  };
}

function request(included: boolean) {
  return new Request("https://landed.test/assignments", {
    body: JSON.stringify({ included, packageId, scenarioId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function readQuery(data: unknown, error: { code?: string } | null = null) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  query.eq.mockImplementation(() => query);
  return query;
}

describe("scenario package route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const scenarioQuery = readQuery({
      id: scenarioId,
      workspace_id: "10000000-0000-4000-8000-000000000001",
      project_id: "20000000-0000-4000-8000-000000000001",
      basket_id: basketId,
    });
    const packageQuery = readQuery({
      id: packageId,
      workspace_id: "10000000-0000-4000-8000-000000000001",
      project_id: "20000000-0000-4000-8000-000000000001",
      basket_id: basketId,
      creator_id: "40000000-0000-4000-8000-000000000001",
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "basket_scenarios") {
        return { select: vi.fn(() => scenarioQuery) };
      }
      if (table === "creator_packages") {
        return { select: vi.fn(() => packageQuery) };
      }
      return {
        insert: insertMock,
        delete: deleteMock,
      };
    });
    insertMock.mockResolvedValue({ error: null });
    createClientMock.mockResolvedValue({ from: fromMock });
  });

  it("adds an existing basket package to one scenario", async () => {
    const response = await POST(request(true), context());

    expect(response.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        basket_id: basketId,
        scenario_id: scenarioId,
        package_id: packageId,
      }),
    );
  });

  it("rejects malformed assignment identifiers before database access", async () => {
    const malformed = new Request("https://landed.test/assignments", {
      body: JSON.stringify({
        included: true,
        packageId: "not-a-package",
        scenarioId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const response = await POST(malformed, context());

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("logs unexpected mutation failures as safe server errors", async () => {
    const error = { code: "XX000", message: "database detail" };
    insertMock.mockResolvedValue({ error });

    const response = await POST(request(true), context());

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "basket_assignment_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "The scenario package could not be updated.",
      reference: "corr_assignment_test",
    });
  });
});
