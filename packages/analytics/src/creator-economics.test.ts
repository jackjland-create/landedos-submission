import { describe, expect, it } from "vitest";

import { computeCreatorEconomics, type CreatorEconomicsInput } from "./index";

const ids = {
  creatorOne: "91000000-0000-4000-8000-000000000001",
  creatorTwo: "91000000-0000-4000-8000-000000000002",
  packageOne: "92000000-0000-4000-8000-000000000001",
  packageTwo: "92000000-0000-4000-8000-000000000002",
  lineOne: "93000000-0000-4000-8000-000000000001",
  lineTwo: "93000000-0000-4000-8000-000000000002",
  qualifiedOne: "94000000-0000-4000-8000-000000000001",
  qualifiedTwo: "94000000-0000-4000-8000-000000000002",
  activatedOne: "95000000-0000-4000-8000-000000000001",
  assetOne: "96000000-0000-4000-8000-000000000001",
};

function input(): CreatorEconomicsInput {
  return {
    currencyCode: "GBP",
    eligibleSpend: {
      status: "available",
      valueMinor: "750000",
      evidenceIds: [ids.lineOne, ids.lineTwo],
      evidenceLines: [
        {
          id: ids.lineOne,
          kind: "creator_compensation",
          valueMinor: "500000",
          currencyCode: "GBP",
        },
        {
          id: ids.lineTwo,
          kind: "creator_compensation",
          valueMinor: "250000",
          currencyCode: "GBP",
        },
      ],
    },
    qualifiedAttribution: {
      status: "available",
      evidenceIds: [ids.qualifiedOne, ids.qualifiedTwo],
    },
    activatedAttribution: {
      status: "available",
      evidenceIds: [ids.qualifiedOne],
    },
    creators: [
      {
        creatorId: ids.creatorOne,
        creatorName: "DeFi After Dark",
        creatorHandle: "@defiafterdark",
        package: {
          id: ids.packageOne,
          creatorId: ids.creatorOne,
          packageLabel: "Podcast package",
          deliverableSummary: "One host-read integration",
          compensationLines: [
            {
              id: ids.lineOne,
              assetType: "cash",
              model: "fixed",
              amountMinor: "500000",
              currencyCode: "GBP",
            },
          ],
        },
        qualifiedAttributionIds: [ids.qualifiedOne, ids.qualifiedTwo],
        activatedAttributionIds: [ids.qualifiedOne],
        confidence: "strong",
        contentAssets: [
          {
            id: ids.assetOne,
            label: "Host-read launch integration",
            status: "published",
            publishedUrl: "https://x.com/example/status/1",
            publicationEvidence: null,
          },
        ],
      },
      {
        creatorId: ids.creatorTwo,
        creatorName: "Mint Condition",
        creatorHandle: "@mintcondition",
        package: {
          id: ids.packageTwo,
          creatorId: ids.creatorTwo,
          packageLabel: "Community package",
          deliverableSummary: "One community activation",
          compensationLines: [
            {
              id: ids.lineTwo,
              assetType: "cash",
              model: "fixed",
              amountMinor: "250000",
              currencyCode: "GBP",
            },
          ],
        },
        qualifiedAttributionIds: [],
        activatedAttributionIds: [],
        confidence: null,
        contentAssets: [],
      },
    ],
  };
}

describe("computeCreatorEconomics", () => {
  it("preserves intentionally different approved creator compensation", () => {
    const result = computeCreatorEconomics(input());

    expect(result.allocatedSpendMinor).toBe("750000");
    expect(result.unallocatedSpendMinor).toBe("0");
    expect(result.creators[0]).toMatchObject({
      allocation: { status: "available", valueMinor: "500000" },
      qualifiedWallets: 2,
      activatedWallets: 1,
      cpqwMinorDecimal: "250000.000000",
      cpaMinorDecimal: "500000.000000",
      action: "review_for_renewal",
    });
    expect(result.creators[1]).toMatchObject({
      allocation: { status: "available", valueMinor: "250000" },
      cpqwMinorDecimal: null,
      cpaMinorDecimal: null,
      action: "investigate_delivery",
    });
  });

  it("does not spread unallocated campaign spend across creators", () => {
    const fixture = input();
    fixture.eligibleSpend = {
      status: "available",
      valueMinor: "900000",
      evidenceIds: [ids.lineOne],
      evidenceLines: [
        {
          id: ids.lineOne,
          kind: "creator_compensation",
          valueMinor: "500000",
          currencyCode: "GBP",
        },
      ],
    };

    const result = computeCreatorEconomics(fixture);

    expect(result.allocatedSpendMinor).toBe("500000");
    expect(result.unallocatedSpendMinor).toBe("400000");
    expect(result.creators[1]?.allocation).toEqual({
      status: "not_available",
      reason: "not_included_in_issued_spend",
    });
  });

  it("keeps non-cash valuation out of creator spend without an exact allocation", () => {
    const fixture = input();
    fixture.creators[0]!.package.compensationLines = [
      {
        id: ids.lineOne,
        assetType: "token",
        model: "fixed",
        tokenMint: "So11111111111111111111111111111111111111112",
        tokenAmountRaw: "1000000000",
        tokenDecimals: 9,
        unitPriceUsd: "125.40",
        priceSource: "Approved valuation fixture",
        valuedAt: "2026-08-19T12:00:00.000Z",
      },
    ];

    expect(() => computeCreatorEconomics(fixture)).toThrow(
      "Creator spend evidence must match",
    );
  });

  it("fails closed when retained creator allocations exceed issued spend", () => {
    const fixture = input();
    fixture.eligibleSpend = {
      status: "available",
      valueMinor: "100",
      evidenceIds: [ids.lineOne],
      evidenceLines: [
        {
          id: ids.lineOne,
          kind: "creator_compensation",
          valueMinor: "500000",
          currencyCode: "GBP",
        },
      ],
    };

    expect(() => computeCreatorEconomics(fixture)).toThrow(
      "Creator allocations exceed",
    );
  });

  it("keeps unavailable or incomplete attribution unknown instead of converting it to zero", () => {
    const fixture = input();
    fixture.qualifiedAttribution = {
      status: "not_available",
      reason: "source_incomplete",
    };
    fixture.creators.forEach((creator) => {
      creator.qualifiedAttributionIds = [];
    });

    expect(computeCreatorEconomics(fixture).creators[0]).toMatchObject({
      qualifiedWallets: null,
      activatedWallets: 1,
      cpqwMinorDecimal: null,
      action: "evidence_unavailable",
    });
  });

  it("rejects attribution subsets and swapped compensation amounts", () => {
    const missingAttribution = input();
    if (missingAttribution.qualifiedAttribution.status !== "available") {
      throw new Error("Fixture attribution must be available");
    }
    missingAttribution.qualifiedAttribution.evidenceIds = [ids.qualifiedOne];
    expect(() => computeCreatorEconomics(missingAttribution)).toThrow(
      "Creator attribution must match",
    );

    const swappedSpend = input();
    if (swappedSpend.eligibleSpend.status !== "available") {
      throw new Error("Fixture spend must be available");
    }
    swappedSpend.eligibleSpend.evidenceLines[0]!.valueMinor = "250000";
    swappedSpend.eligibleSpend.evidenceLines[1]!.valueMinor = "500000";
    expect(() => computeCreatorEconomics(swappedSpend)).toThrow(
      "Creator spend evidence must match",
    );
  });

  it("rejects attribution facts assigned to two creators or activated without qualification", () => {
    const duplicateCreator = input();
    duplicateCreator.creators[1]!.qualifiedAttributionIds = [ids.qualifiedOne];
    expect(() => computeCreatorEconomics(duplicateCreator)).toThrow(
      "Creator attribution must match",
    );

    const activatedWithoutQualification = input();
    activatedWithoutQualification.creators[0]!.qualifiedAttributionIds = [
      ids.qualifiedTwo,
    ];
    if (
      activatedWithoutQualification.qualifiedAttribution.status !== "available"
    ) {
      throw new Error("Fixture attribution must be available");
    }
    activatedWithoutQualification.qualifiedAttribution.evidenceIds = [
      ids.qualifiedTwo,
    ];
    expect(() =>
      computeCreatorEconomics(activatedWithoutQualification),
    ).toThrow("Activated creator attribution must be a subset");
  });
});
