import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, fromMock, logErrorMock, updateMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    fromMock: vi.fn(),
    logErrorMock: vi.fn(() => "corr_outcome_test"),
    updateMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));

import { PUT } from "./route";

const basketId = "90000000-0000-4000-8000-000000000001";

function context() {
  return { params: Promise.resolve({ projectId: "helios", basketId }) };
}

function request(body: unknown) {
  return new Request("https://landed.test/outcome", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

function updateQuery(
  data: unknown,
  error: { code?: string; message?: string } | null = null,
) {
  const query = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  query.eq.mockImplementation(() => query);
  query.select.mockImplementation(() => query);
  return query;
}

const validBody = {
  objective: "Increase average order value from qualified wallets",
  outcomeProfile: {
    metric: "average_order_value",
    baselineUnits: "4200",
    targetUnits: "5200",
    currencyCode: "GBP",
  },
};

describe("basket outcome route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = updateQuery({
      objective: validBody.objective,
      outcome_metric: "average_order_value",
      outcome_baseline_units: "4200",
      outcome_target_units: "5200",
      outcome_currency_code: "GBP",
    });
    updateMock.mockReturnValue(query);
    fromMock.mockReturnValue({ update: updateMock });
    createClientMock.mockResolvedValue({ from: fromMock });
  });

  it("saves exact outcome values for a managed basket", async () => {
    const response = await PUT(request(validBody), context());

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome_metric: "average_order_value",
        outcome_target_units: "5200",
      }),
    );
    expect(await response.json()).toEqual(validBody);
  });

  it("rejects an incomplete money outcome before database access", async () => {
    const response = await PUT(
      request({
        ...validBody,
        outcomeProfile: { ...validBody.outcomeProfile, currencyCode: null },
      }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("keeps outcome changes manager-only", async () => {
    const query = updateQuery(null, { code: "42501" });
    updateMock.mockReturnValue(query);

    const response = await PUT(request(validBody), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Outcome changes require campaign manager access.",
    });
  });

  it("logs unexpected failures without exposing database detail", async () => {
    const error = { code: "XX000", message: "database detail" };
    updateMock.mockReturnValue(updateQuery(null, error));

    const response = await PUT(request(validBody), context());

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "basket_outcome_update_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Outcome setup could not be saved.",
      reference: "corr_outcome_test",
    });
  });
});
