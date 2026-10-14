import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, getProjectBasketMock, logErrorMock, rpcMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    getProjectBasketMock: vi.fn(),
    logErrorMock: vi.fn(() => "corr_package_terms_test"),
    rpcMock: vi.fn(),
  }));

vi.mock("@landed/db", () => ({
  BasketQueryError: class BasketQueryError extends Error {
    code: string | undefined;

    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
  getProjectBasket: getProjectBasketMock,
}));

vi.mock("@/lib/observability", () => ({
  logError: logErrorMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { PUT } from "./route";

const basketId = "90000000-0000-4000-8000-000000000001";
const packageId = "92000000-0000-4000-8000-000000000001";

function context() {
  return {
    params: Promise.resolve({ projectId: "helios", basketId, packageId }),
  };
}

function request(body: unknown) {
  return new Request("https://landed.test/package-terms", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

const savedPackage = {
  id: packageId,
  creatorId: "40000000-0000-4000-8000-000000000001",
  creatorName: "Maya / Chain Mode",
  creatorHandle: "@chainmode",
  packageLabel: "Launch package",
  deliverableSummary: "One X thread",
  sourceRateQuoteId: null,
  compensationLines: [],
};

describe("package commercial terms route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: packageId, error: null });
    getProjectBasketMock.mockResolvedValue({ packages: [savedPackage] });
  });

  it("converts cash and token display amounts to exact stored units", async () => {
    const response = await PUT(
      request({
        packageLabel: "Launch package",
        deliverableSummary: "One X thread",
        compensationLines: [
          {
            assetType: "cash",
            model: "fixed",
            variableUnit: null,
            amount: "1250.42",
            currencyCode: "GBP",
          },
          {
            assetType: "token",
            model: "variable",
            variableUnit: "qualified wallet",
            amount: "12500.5",
            tokenMint: "So11111111111111111111111111111111111111112",
            tokenDecimals: 9,
            unitPriceUsd: "0.0425",
            priceSource: "Project treasury policy",
            valuedAt: "2026-08-04T12:00:00.000Z",
          },
        ],
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "update_package_commercial_terms",
      expect.objectContaining({
        target_package_id: packageId,
        next_compensation_lines: [
          expect.objectContaining({ amountMinor: "125042" }),
          expect.objectContaining({
            tokenAmountRaw: "12500500000000",
            unitPriceUsd: "0.0425",
          }),
        ],
      }),
    );
  });

  it("saves explicit detail with its revision and returns a terminal conflict", async () => {
    const commercialDetail = {
      schemaVersion: 1,
      channelIds: [],
      deliveryDeadline: "2026-10-01T12:00:00.123456Z",
      usageRights: "Organic repost only",
      exclusivity: null,
    };
    const body = {
      packageLabel: "Launch package",
      deliverableSummary: "One X thread",
      compensationLines: [],
      commercialDetail,
      expectedDetailRevision: 2,
    };
    expect((await PUT(request(body), context())).status).toBe(200);
    expect(rpcMock).toHaveBeenLastCalledWith(
      "save_package_commercial_detail",
      expect.objectContaining({
        next_detail: commercialDetail,
        expected_detail_revision: 2,
      }),
    );
    rpcMock.mockResolvedValue({ error: { code: "PT409" } });
    expect((await PUT(request(body), context())).status).toBe(409);
    rpcMock.mockClear();
    expect(
      (
        await PUT(
          request({ ...body, expectedDetailRevision: undefined }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("saves an explicit unpaid internal test without a compensation line", async () => {
    const commercialDetail = {
      schemaVersion: 2,
      channelIds: [],
      deliveryDeadline: null,
      usageRights: null,
      exclusivity: null,
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet response proof.",
    };
    const response = await PUT(
      request({
        packageLabel: "Internal response proof",
        deliverableSummary: "One consented devnet response",
        compensationLines: [],
        commercialDetail,
        expectedDetailRevision: 3,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "save_package_commercial_detail",
      expect.objectContaining({
        next_compensation_lines: [],
        next_detail: commercialDetail,
        expected_detail_revision: 3,
      }),
    );
  });

  it("rejects incomplete token valuation evidence before database access", async () => {
    const response = await PUT(
      request({
        packageLabel: "Launch package",
        deliverableSummary: null,
        compensationLines: [
          {
            assetType: "token",
            model: "fixed",
            variableUnit: null,
            amount: "12500",
            tokenMint: "So11111111111111111111111111111111111111112",
            tokenDecimals: 9,
            unitPriceUsd: "0.04",
            priceSource: "",
            valuedAt: "2026-08-04T12:00:00.000Z",
          },
        ],
      }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("fails closed when the caller cannot change commercial terms", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });

    const response = await PUT(
      request({
        packageLabel: "Launch package",
        deliverableSummary: null,
        compensationLines: [],
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Commercial changes require campaign manager access.",
    });
  });

  it("logs unexpected database failures without exposing detail", async () => {
    const error = { code: "XX000", message: "database detail" };
    rpcMock.mockResolvedValue({ data: null, error });

    const response = await PUT(
      request({
        packageLabel: "Launch package",
        deliverableSummary: null,
        compensationLines: [],
      }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "package_terms_update_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Package terms could not be saved.",
      reference: "corr_package_terms_test",
    });
  });

  it("does not expose unexpected client setup details", async () => {
    const error = new TypeError("private client configuration detail");
    createClientMock.mockRejectedValue(error);

    const response = await PUT(
      request({
        packageLabel: "Launch package",
        deliverableSummary: null,
        compensationLines: [],
      }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "package_terms_update_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Package terms could not be saved.",
      reference: "corr_package_terms_test",
    });
  });
});
