import type {
  BasketPackageRecord,
  ScenarioForecastSummary,
  ScenarioSpendSummary,
} from "@landed/contracts";
import { calculateScenarioSpend } from "@landed/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  costPerQualifiedWallet,
  formatExactTotal,
  PlanForecast,
} from "./plan-forecast";

afterEach(cleanup);

// Synthetic test fixtures only. Numbers exercise the arithmetic rules.
const packageId = "92000000-0000-4000-8000-000000000001";
const cashPackage: BasketPackageRecord = {
  id: packageId,
  creatorId: "40000000-0000-4000-8000-000000000001",
  creatorName: "Fixture creator",
  creatorHandle: null,
  audience: null,
  packageLabel: "Fixture package",
  deliverableSummary: "Fixture deliverable",
  sourceRateQuoteId: null,
  compensationLines: [
    {
      id: "93000000-0000-4000-8000-000000000001",
      assetType: "cash",
      model: "fixed",
      variableUnit: null,
      amountMinor: "460000",
      currencyCode: "GBP",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
};

function spend(
  overrides: Partial<ScenarioSpendSummary> = {},
): ScenarioSpendSummary {
  return {
    status: "single_currency",
    fixedTotals: [
      { currencyCode: "GBP", amount: "4600.00", units: "460000", scale: 2 },
    ],
    variableRates: [],
    incompletePackageIds: [],
    missingPackageIds: [],
    largestPackageId: packageId,
    largestPackageShareBps: 10_000,
    ...overrides,
  };
}

function forecast(
  overrides: Partial<ScenarioForecastSummary> = {},
): ScenarioForecastSummary {
  const range = { p25: 8, base: 28, p75: 85 };
  return {
    status: "ready",
    confidence: "very_low",
    modelVersion: "planning-v1",
    includedPackageCount: 1,
    sampleSize: 1,
    missingPackageIds: [],
    potentialAudience: 142000,
    estimatedUniqueAudience: 142000,
    forecastReach: range,
    qualifiedWallets: range,
    points: [],
    sourceLabels: [],
    freshestObservedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

const base = {
  packages: [cashPackage],
  packageIds: [packageId],
};

describe("costPerQualifiedWallet", () => {
  it("rejects a mixed paid and explicitly unpaid roster using the real spend calculation", () => {
    const unpaid: BasketPackageRecord = {
      ...cashPackage,
      id: "92000000-0000-4000-8000-000000000002",
      compensationLines: [],
      commercialDetailRevision: 1,
      commercialDetail: {
        schemaVersion: 2,
        channelIds: [],
        deliveryDeadline: null,
        usageRights: null,
        exclusivity: null,
        commercialBasis: "unpaid_internal_test",
        unpaidReason: "Synthetic internal test",
      },
    };
    const packages = [cashPackage, unpaid];
    const packageIds = packages.map(({ id }) => id);
    expect(
      costPerQualifiedWallet({
        packages,
        packageIds,
        spend: calculateScenarioSpend(packages, packageIds),
        forecast: forecast(),
      }),
    ).toMatchObject({
      kind: "unavailable",
      reason: "An unpaid test is included, so the cost isn't comparable.",
    });
  });
  it("rejects missing packages through the authoritative spend calculator", () => {
    const packageIds = [packageId, "missing-package"];
    expect(
      costPerQualifiedWallet({
        ...base,
        packageIds,
        spend: calculateScenarioSpend(base.packages, packageIds),
        forecast: forecast(),
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid forecast denominator %s",
    (value) => {
      expect(
        costPerQualifiedWallet({
          ...base,
          spend: spend(),
          forecast: forecast({
            qualifiedWallets: { p25: value, base: 28, p75: 85 },
          }),
        }),
      ).toMatchObject({ kind: "unavailable" });
    },
  );
  it("normalizes exact integer scales before division", () => {
    expect(
      costPerQualifiedWallet({
        ...base,
        spend: spend({
          fixedTotals: [
            {
              currencyCode: "GBP",
              amount: "4600",
              units: "46000000",
              scale: 4,
            },
          ],
        }),
        forecast: forecast(),
      }),
    ).toEqual({
      kind: "available",
      currencyCode: "GBP",
      low: "54",
      base: "164",
      high: "575",
    });
  });
  it("divides complete fixed cash by the forecast, low cost by P75 and high by P25", () => {
    expect(
      costPerQualifiedWallet({ ...base, spend: spend(), forecast: forecast() }),
    ).toEqual({
      kind: "available",
      currencyCode: "GBP",
      low: "54",
      base: "164",
      high: "575",
    });
  });

  it("rounds half up in whole units without floating point", () => {
    const halves = costPerQualifiedWallet({
      ...base,
      spend: spend({
        fixedTotals: [
          { currencyCode: "USD", amount: "5.00", units: "500", scale: 2 },
        ],
      }),
      forecast: forecast({ qualifiedWallets: { p25: 2, base: 2, p75: 2 } }),
    });
    expect(halves).toMatchObject({ low: "3", base: "3", high: "3" });
    const below = costPerQualifiedWallet({
      ...base,
      spend: spend({
        fixedTotals: [
          { currencyCode: "USD", amount: "4.98", units: "498", scale: 2 },
        ],
      }),
      forecast: forecast({ qualifiedWallets: { p25: 2, base: 2, p75: 2 } }),
    });
    expect(below).toMatchObject({ base: "2" });
    const huge = costPerQualifiedWallet({
      ...base,
      spend: spend({
        fixedTotals: [
          {
            currencyCode: "GBP",
            amount: "90071992547409.93",
            units: "9007199254740993",
            scale: 2,
          },
        ],
      }),
      forecast: forecast({ qualifiedWallets: { p25: 1, base: 1, p75: 1 } }),
    });
    expect(huge).toMatchObject({ base: "90071992547410" });
  });

  it.each([
    [
      "empty",
      { spend: spend({ status: "empty", fixedTotals: [] }) },
      "Add creators to this scenario first.",
    ],
    [
      "incomplete",
      {
        spend: spend({ status: "incomplete", incompletePackageIds: ["x"] }),
      },
      "Shows once every included creator has terms.",
    ],
    [
      "mixed currency",
      { spend: spend({ status: "mixed_currency" }) },
      "Terms use more than one currency, so there's no single cost.",
    ],
    [
      "unpaid",
      { spend: spend({ status: "unpaid", fixedTotals: [] }) },
      "There's no fixed cash cost to divide.",
    ],
    [
      "variable",
      {
        spend: spend({
          variableRates: [
            {
              currencyCode: "GBP",
              amount: "25.00",
              units: "2500",
              scale: 2,
              variableUnit: "Qualified wallet",
              lineCount: 1,
            },
          ],
        }),
      },
      "Variable terms are included, so the cost isn't fixed.",
    ],
    [
      "partial forecast",
      { forecast: forecast({ status: "partial" }) },
      "Some included creators have no audience evidence, so the wallet forecast is partial.",
    ],
    [
      "no forecast",
      { forecast: forecast({ status: "unavailable" }) },
      "There's no wallet forecast for this scenario yet.",
    ],
    [
      "zero wallets",
      { forecast: forecast({ qualifiedWallets: { p25: 0, base: 1, p75: 2 } }) },
      "The wallet forecast is too small to divide by.",
    ],
  ] as const)(
    "is unavailable with a reason when %s",
    (_label, input, reason) => {
      expect(
        costPerQualifiedWallet({
          ...base,
          spend: "spend" in input ? input.spend : spend(),
          forecast: "forecast" in input ? input.forecast : forecast(),
        }),
      ).toEqual({ kind: "unavailable", reason });
    },
  );

  it("is unavailable for token or unpaid components even with a single fixed total", () => {
    const token: BasketPackageRecord = {
      ...cashPackage,
      compensationLines: [
        ...cashPackage.compensationLines,
        {
          id: "93000000-0000-4000-8000-000000000009",
          assetType: "token",
          model: "fixed",
          variableUnit: null,
          tokenMint: "So11111111111111111111111111111111111111112",
          tokenAmountRaw: "1000000",
          tokenDecimals: 6,
          unitPriceUsd: "1",
          priceSource: "Fixture",
          valuedAt: "2026-08-05T00:00:00.000Z",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    };
    expect(
      costPerQualifiedWallet({
        packages: [token],
        packageIds: [packageId],
        spend: spend(),
        forecast: forecast(),
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
});

describe("PlanForecast", () => {
  it("labels the cost as a forecast target and the commitment as agreed, not paid", () => {
    render(
      <PlanForecast
        {...base}
        spend={spend()}
        forecast={forecast()}
        targetWallets="150"
        largestCreatorName="Fixture creator"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Expected qualified wallets" }),
    ).toHaveTextContent("28likely · range 8–85");
    expect(
      screen.getByRole("region", { name: "Cost per qualified wallet" }),
    ).toHaveTextContent(
      "£164likelyRange £54 – £575Target until results · forecast · lower is better",
    );
    const commitment = screen.getByRole("region", {
      name: "Known fixed commitment",
    });
    expect(commitment).toHaveTextContent("£4,600agreed, not paid");
    expect(commitment).toHaveTextContent(
      "Fixture creator is 100% of fixed spend · review concentration",
    );
  });

  it("shows Not available yet with reasons, never zero, when nothing is known", () => {
    render(
      <PlanForecast
        packages={[]}
        packageIds={[]}
        spend={spend({
          status: "empty",
          fixedTotals: [],
          largestPackageId: null,
          largestPackageShareBps: null,
        })}
        forecast={forecast({ status: "empty" })}
        targetWallets={null}
        largestCreatorName={null}
      />,
    );
    expect(screen.getAllByText("Not available yet")).toHaveLength(2);
    expect(
      screen.getByText("Add creators to this scenario first."),
    ).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.queryByText(/£0|\b0 wallets/)).toBeNull();
    expect(screen.queryByText(/of fixed spend/)).toBeNull();
  });

  it("keeps a concentration under half without a warning", () => {
    render(
      <PlanForecast
        {...base}
        spend={spend({ largestPackageShareBps: 4200 })}
        forecast={forecast()}
        targetWallets={null}
        largestCreatorName="Fixture creator"
      />,
    );
    expect(
      screen.getByText("Largest creator is 42% of fixed spend"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/review concentration/)).toBeNull();
  });

  it("formats exact totals without inventing decimals", () => {
    expect(
      formatExactTotal({
        currencyCode: "USD",
        amount: "1250.40",
        units: "125040",
        scale: 2,
      }),
    ).toBe("$1,250.40");
    expect(
      formatExactTotal({
        currencyCode: "EUR",
        amount: "500.00",
        units: "50000",
        scale: 2,
      }),
    ).toBe("€500");
  });

  it("keeps pence on contract-normalised totals and says when a total is fixed terms only", () => {
    expect(
      formatExactTotal({
        currencyCode: "GBP",
        amount: "1250.4",
        units: "12504",
        scale: 1,
      }),
    ).toBe("£1,250.40");
    render(
      <PlanForecast
        {...base}
        spend={spend({
          largestPackageShareBps: 5001,
          variableRates: [
            {
              currencyCode: "GBP",
              amount: "5",
              units: "5",
              scale: 0,
              variableUnit: "post",
              lineCount: 1,
            },
          ],
        })}
        forecast={forecast()}
        targetWallets={null}
        largestCreatorName="Fixture creator"
      />,
    );
    const commitment = screen.getByRole("region", {
      name: "Known fixed commitment",
    });
    expect(commitment).toHaveTextContent(
      "This total covers the fixed terms only.",
    );
    expect(commitment).not.toHaveTextContent(
      "Every included creator has fixed terms",
    );
    expect(commitment).toHaveTextContent(
      "Fixture creator is over 50% of fixed spend · review concentration",
    );
  });
});
