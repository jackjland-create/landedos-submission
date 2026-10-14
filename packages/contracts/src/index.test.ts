import { describe, expect, it } from "vitest";

import {
  approveConversionReplayInputSchema,
  baseUnitsToDecimal,
  basketOutcomeProfileSchema,
  basketRecordSchema,
  calculateScenarioForecast,
  calculateScenarioSpend,
  campaignBriefMutationInputSchema,
  campaignRecordSchema,
  campaignTransitionInputSchema,
  configureConversionRuleInputSchema,
  conversionRuleVersionRecordSchema,
  contentAssetTransitionInputSchema,
  createBasketInputSchema,
  createCampaignFromCommercialPlanInputSchema,
  creatorDirectoryRecordSchema,
  creatorEvidenceRecordSchema,
  decimalToBaseUnits,
  evaluateBasketScenarioApproval,
  formatMinor,
  navigationSectionSchema,
  safeRate,
  savePackageCommercialTermsInputSchema,
  trackedLinkClickEvidenceSchema,
  trackedLinkClickQualityEvidenceSchema,
  trackedLinkAnonymousSessionEvidenceSchema,
  trackedClickQueryParameter,
  trackedLinkMutationInputSchema,
  trackedLinkPayloadSchema,
  solanaWalletAddressSchema,
  walletNonceChallengeRequestSchema,
  walletNonceChallengeResponseSchema,
  walletMappingUnlinkRequestSchema,
  walletMappingUnlinkResponseSchema,
  walletMeasurementConsentRequestSchema,
  walletMeasurementConsentResponseSchema,
  walletMeasurementConsentStatement,
  walletSignatureProofRequestSchema,
  type BasketPackageRecord,
  type BasketRecord,
} from "./index";

const packageIdOne = "81000000-0000-4000-8000-000000000001";
const packageIdTwo = "81000000-0000-4000-8000-000000000002";

function basketPackage(
  id: string,
  compensationLines: BasketPackageRecord["compensationLines"],
): BasketPackageRecord {
  return {
    audience: null,
    compensationLines,
    creatorHandle: "@creator",
    creatorId: id.replace("81000000", "82000000"),
    creatorName: `Creator ${id.slice(-1)}`,
    deliverableSummary: "One launch thread",
    id,
    packageLabel: "Launch package",
    sourceRateQuoteId: null,
  };
}

function unpaidInternalTestPackage(id: string): BasketPackageRecord {
  return {
    ...basketPackage(id, []),
    commercialDetailRevision: 1,
    commercialDetail: {
      schemaVersion: 2,
      channelIds: [],
      deliveryDeadline: null,
      usageRights: null,
      exclusivity: null,
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet response proof.",
    },
  };
}

function cashLine(
  id: string,
  amountMinor: string,
  currencyCode: "GBP" | "USD" | "EUR" = "GBP",
  model: "fixed" | "variable" = "fixed",
  variableUnit: string | null = null,
): BasketPackageRecord["compensationLines"][number] {
  return {
    amountMinor,
    assetType: "cash",
    createdAt: "2026-08-04T12:00:00.000Z",
    currencyCode,
    id,
    model,
    updatedAt: "2026-08-04T12:00:00.000Z",
    variableUnit,
  };
}

function tokenLine(
  id: string,
  tokenAmountRaw: string,
  tokenDecimals: number,
  unitPriceUsd: string,
  model: "fixed" | "variable" = "fixed",
  variableUnit: string | null = null,
): BasketPackageRecord["compensationLines"][number] {
  return {
    assetType: "token",
    createdAt: "2026-08-04T12:00:00.000Z",
    id,
    model,
    priceSource: "Project treasury policy",
    tokenAmountRaw,
    tokenDecimals,
    tokenMint: "So11111111111111111111111111111111111111112",
    unitPriceUsd,
    updatedAt: "2026-08-04T12:00:00.000Z",
    valuedAt: "2026-08-04T12:00:00.000Z",
    variableUnit,
  };
}

function approvalBasket(
  packages: BasketPackageRecord[],
  packageIds: string[],
): BasketRecord {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000001",
    projectId: "20000000-0000-4000-8000-000000000001",
    name: "Helios roster",
    objective: "Increase qualified wallets",
    outcomeProfile: {
      baselineUnits: "50",
      currencyCode: null,
      metric: "qualified_wallets",
      targetUnits: "150",
    },
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
    latestApproval: null,
    latestApprovalIsCurrent: null,
    scenarios: [
      {
        code: "A",
        id: "91000000-0000-4000-8000-000000000001",
        name: "Focused authority",
        packageIds,
      },
      {
        code: "B",
        id: "91000000-0000-4000-8000-000000000002",
        name: "Broad reach",
        packageIds: [],
      },
      {
        code: "C",
        id: "91000000-0000-4000-8000-000000000003",
        name: "Proof first",
        packageIds: [],
      },
    ],
    packages,
  };
}

describe("shared contracts", () => {
  it("accepts only the five primary product destinations", () => {
    expect(navigationSectionSchema.safeParse("reports").success).toBe(true);
    expect(navigationSectionSchema.safeParse("marketplace").success).toBe(
      false,
    );
  });

  it("keeps conversion templates explicit and programme evidence honest", () => {
    const base = {
      ruleId: "a1000000-0000-4000-8000-000000000001",
      ruleVersionId: "a2000000-0000-4000-8000-000000000001",
      changeRequestId: "a3000000-0000-4000-8000-000000000001",
      name: "First qualifying transaction",
      description: "Count the first finalized Solana transfer after consent.",
      effectiveFrom: "2026-08-12T14:00:00.000Z",
      effectiveUntil: null,
      changeReason: "Create the initial campaign outcome definition",
    };

    expect(
      configureConversionRuleInputSchema.safeParse({
        ...base,
        templateCode: "first_qualifying_transaction",
        programId: null,
        eventDiscriminator: null,
      }).success,
    ).toBe(false);

    expect(
      configureConversionRuleInputSchema.safeParse({
        ...base,
        templateCode: "first_qualifying_transaction",
        programId: null,
        eventDiscriminator: null,
        configuredEnvironment: "devnet",
        destinationAddress: "Vote111111111111111111111111111111111111111",
        nativeAmountLamports: "1",
      }).success,
    ).toBe(true);

    expect(
      configureConversionRuleInputSchema.safeParse({
        ...base,
        templateCode: "first_qualifying_transaction",
        programId: null,
        eventDiscriminator: null,
        configuredEnvironment: "mainnet",
        destinationAddress: "Vote111111111111111111111111111111111111111",
        nativeAmountLamports: "1",
      }).success,
    ).toBe(false);

    expect(
      configureConversionRuleInputSchema.safeParse({
        ...base,
        templateCode: "programme_action",
        programId: null,
        eventDiscriminator: "deposit",
      }).success,
    ).toBe(false);

    expect(
      conversionRuleVersionRecordSchema.safeParse({
        id: base.ruleVersionId,
        ruleId: base.ruleId,
        workspaceId: "10000000-0000-4000-8000-000000000001",
        projectId: "20000000-0000-4000-8000-000000000001",
        version: 1,
        templateCode: "programme_action",
        name: "Customer programme action",
        description: "Count a finalized programme action after wallet consent.",
        effectiveFrom: base.effectiveFrom,
        effectiveUntil: null,
        chain: "solana",
        requiresWalletBinding: true,
        minimumFinality: "finalized",
        valueMapping: "none",
        revenueMapping: "none",
        attributionWindowSeconds: 604800,
        attributionModel: "last_eligible_creator_touch",
        programId: "So11111111111111111111111111111111111111112",
        eventDiscriminator: "deposit",
        evidenceCapability: "requires_programme_decoder",
        changeReason: base.changeReason,
        createdBy: "30000000-0000-4000-8000-000000000001",
        createdAt: base.effectiveFrom,
      }).success,
    ).toBe(true);
  });

  it("requires a deliberate replay reason and three distinct identities", () => {
    const input = {
      replayJobId: "a4000000-0000-4000-8000-000000000001",
      replayRunId: "a5000000-0000-4000-8000-000000000001",
      approvalRequestId: "a6000000-0000-4000-8000-000000000001",
      approvalReason: "Approve a comparable historical calculation run",
    };
    expect(approveConversionReplayInputSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      approveConversionReplayInputSchema.safeParse({
        ...input,
        approvalRequestId: input.replayRunId,
      }).success,
    ).toBe(false);
    expect(
      approveConversionReplayInputSchema.safeParse({
        ...input,
        approvalReason: "short",
      }).success,
    ).toBe(false);
  });

  it("formats money from integer minor units", () => {
    expect(formatMinor(124000n, "GBP")).toBe("£1,240");
  });

  it("keeps an unknown denominator unavailable", () => {
    expect(safeRate(420000n, 0)).toBeNull();
    expect(safeRate(420000n, 7)).toBe(60000n);
  });

  it("validates a project-scoped creator directory record", () => {
    const result = creatorDirectoryRecordSchema.safeParse({
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      displayName: "Maya / Chain Mode",
      relationshipStatus: "active",
      countryCode: "GB",
      languageCodes: ["en"],
      channels: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          type: "x",
          handle: "@chainmode",
          profileUrl: "https://x.com/chainmode",
          languageCode: "en",
          audienceSize: 142000,
          observedAt: "2026-07-01T12:00:00.000Z",
          sourceLabel: "Seeded demonstration evidence",
          isPrimary: true,
        },
      ],
      tags: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          name: "Solana",
          slug: "solana",
        },
      ],
      currentRate: null,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("keeps protected contact access explicit in creator evidence", () => {
    const result = creatorEvidenceRecordSchema.safeParse({
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      displayName: "Maya / Chain Mode",
      relationshipStatus: "active",
      countryCode: "GB",
      languageCodes: ["en"],
      channels: [],
      tags: [],
      currentRate: null,
      profileSummary: null,
      profileObservedAt: null,
      profileSourceLabel: null,
      contactAccess: "restricted",
      contact: null,
      rateQuotes: [],
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-web creator profile links", () => {
    const result = creatorDirectoryRecordSchema.safeParse({
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      displayName: "Maya / Chain Mode",
      relationshipStatus: "active",
      countryCode: "GB",
      languageCodes: ["en"],
      channels: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          type: "x",
          handle: "@chainmode",
          profileUrl: "javascript:alert(document.domain)",
          languageCode: "en",
          audienceSize: 142000,
          observedAt: "2026-07-01T12:00:00.000Z",
          sourceLabel: "Hostile fixture",
          isPrimary: true,
        },
      ],
      tags: [],
      currentRate: null,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects every partial profile provenance combination", () => {
    const baseEvidence = {
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      displayName: "Maya / Chain Mode",
      relationshipStatus: "active",
      countryCode: "GB",
      languageCodes: ["en"],
      channels: [],
      tags: [],
      currentRate: null,
      contactAccess: "restricted",
      contact: null,
      rateQuotes: [],
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    };
    const summary = "Consumer-focused Solana educator.";
    const observedAt = "2026-07-15T12:00:00.000Z";
    const sourceLabel = "Seeded workspace profile";
    const partialCombinations = [
      [summary, null, null],
      [null, observedAt, null],
      [null, null, sourceLabel],
      [summary, observedAt, null],
      [summary, null, sourceLabel],
      [null, observedAt, sourceLabel],
    ] as const;

    for (const [
      profileSummary,
      profileObservedAt,
      profileSourceLabel,
    ] of partialCombinations) {
      expect(
        creatorEvidenceRecordSchema.safeParse({
          ...baseEvidence,
          profileSummary,
          profileObservedAt,
          profileSourceLabel,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps basket scenarios explicit and bounded to A/B/C", () => {
    const result = basketRecordSchema.safeParse({
      id: "90000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      name: "Helios roster",
      objective: null,
      outcomeProfile: null,
      createdAt: "2026-07-30T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
      latestApproval: null,
      latestApprovalIsCurrent: null,
      scenarios: [
        {
          id: "91000000-0000-4000-8000-000000000001",
          code: "A",
          name: "Focused authority",
          packageIds: [],
        },
        {
          id: "91000000-0000-4000-8000-000000000002",
          code: "B",
          name: "Broad reach",
          packageIds: [],
        },
        {
          id: "91000000-0000-4000-8000-000000000003",
          code: "C",
          name: "Proof first",
          packageIds: [],
        },
      ],
      packages: [],
    });

    expect(result.success).toBe(true);
  });

  it("requires complete, positive basket outcome targets", () => {
    const result = basketOutcomeProfileSchema.safeParse({
      metric: "average_order_value",
      baselineUnits: "4200",
      targetUnits: "0",
      currencyCode: "GBP",
    });

    expect(result.success).toBe(false);
  });

  it("converts display decimals without floating-point arithmetic", () => {
    expect(decimalToBaseUnits("1250.42", 2)).toBe("125042");
    expect(decimalToBaseUnits("0.000001", 6)).toBe("1");
    expect(baseUnitsToDecimal("125042", 2)).toBe("1250.42");
    expect(baseUnitsToDecimal("1000000", 6)).toBe("1");
    expect(() => decimalToBaseUnits("1.001", 2)).toThrow(
      "more than 2 decimal places",
    );
  });

  it("requires complete valuation evidence for USDC and token terms", () => {
    const tokenTerms = {
      packageLabel: "Launch package",
      deliverableSummary: "One X thread",
      compensationLines: [
        {
          assetType: "token",
          model: "fixed",
          variableUnit: null,
          amount: "12500",
          tokenMint: "So11111111111111111111111111111111111111112",
          tokenDecimals: 9,
          unitPriceUsd: "0.0425",
          priceSource: "Project treasury policy",
          valuedAt: "2026-08-04T12:00:00.000Z",
        },
      ],
    };

    expect(
      savePackageCommercialTermsInputSchema.safeParse(tokenTerms).success,
    ).toBe(true);
    expect(
      savePackageCommercialTermsInputSchema.safeParse({
        ...tokenTerms,
        compensationLines: [
          {
            ...tokenTerms.compensationLines[0],
            priceSource: "",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires variable compensation to name its unit", () => {
    expect(
      savePackageCommercialTermsInputSchema.safeParse({
        packageLabel: "Performance package",
        deliverableSummary: null,
        compensationLines: [
          {
            assetType: "cash",
            model: "variable",
            variableUnit: null,
            amount: "15.00",
            currencyCode: "GBP",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("records an unpaid internal test without inventing a zero-valued fee", () => {
    const input = {
      packageLabel: "Internal response proof",
      deliverableSummary: "One consented devnet response",
      compensationLines: [],
      expectedDetailRevision: 1,
      commercialDetail: {
        schemaVersion: 2,
        channelIds: [],
        deliveryDeadline: null,
        usageRights: null,
        exclusivity: null,
        commercialBasis: "unpaid_internal_test",
        unpaidReason: "Approved internal devnet response proof.",
      },
    } as const;

    expect(savePackageCommercialTermsInputSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      savePackageCommercialTermsInputSchema.safeParse({
        ...input,
        compensationLines: [
          {
            assetType: "cash",
            model: "fixed",
            variableUnit: null,
            amount: "0",
            currencyCode: "GBP",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      savePackageCommercialTermsInputSchema.safeParse({
        ...input,
        commercialDetail: { ...input.commercialDetail, unpaidReason: null },
      }).success,
    ).toBe(false);
  });

  it("adds fixed cash commitments without floating-point arithmetic", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000001", "125042"),
        ]),
        basketPackage(packageIdTwo, [
          cashLine("83000000-0000-4000-8000-000000000002", "99958"),
        ]),
      ],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("single_currency");
    expect(summary.fixedTotals).toEqual([
      { amount: "2250", currencyCode: "GBP", scale: 0, units: "2250" },
    ]);
  });

  it("values token commitments exactly at their stored USD evidence price", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          tokenLine(
            "83000000-0000-4000-8000-000000000003",
            "12500500000000",
            9,
            "0.0425",
          ),
        ]),
      ],
      [packageIdOne],
    );

    expect(summary.fixedTotals).toEqual([
      {
        amount: "531.27125",
        currencyCode: "USD",
        scale: 5,
        units: "53127125",
      },
    ]);
  });

  it("retains the full 36-place precision of token quantity and price", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          tokenLine(
            "83000000-0000-4000-8000-000000000012",
            "1",
            18,
            "0.000000000000000001",
          ),
        ]),
      ],
      [packageIdOne],
    );

    expect(summary.fixedTotals[0]).toEqual({
      amount: "0.000000000000000000000000000000000001",
      currencyCode: "USD",
      scale: 36,
      units: "1",
    });
  });

  it("combines USD cash and token evidence when their currency is common", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000004", "10050", "USD"),
          tokenLine(
            "83000000-0000-4000-8000-000000000005",
            "1000000",
            6,
            "1.000000000000000000",
          ),
        ]),
      ],
      [packageIdOne],
    );

    expect(summary.fixedTotals[0]?.amount).toBe("101.5");
    expect(summary.status).toBe("single_currency");
  });

  it("keeps mixed currencies separate instead of inventing an FX rate", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000006", "460000"),
        ]),
        basketPackage(packageIdTwo, [
          cashLine("83000000-0000-4000-8000-000000000007", "125000", "USD"),
        ]),
      ],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("mixed_currency");
    expect(
      summary.fixedTotals.map(({ amount, currencyCode }) => [
        currencyCode,
        amount,
      ]),
    ).toEqual([
      ["GBP", "4600"],
      ["USD", "1250"],
    ]);
    expect(summary.largestPackageShareBps).toBeNull();
  });

  it("treats fixed and variable currencies as one approval boundary", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000017", "460000"),
          cashLine(
            "83000000-0000-4000-8000-000000000018",
            "2500",
            "USD",
            "variable",
            "Qualified wallet",
          ),
        ]),
      ],
      [packageIdOne],
    );

    expect(summary.status).toBe("mixed_currency");
    expect(
      evaluateBasketScenarioApproval(
        approvalBasket(
          [
            basketPackage(packageIdOne, [
              cashLine("83000000-0000-4000-8000-000000000017", "460000"),
              cashLine(
                "83000000-0000-4000-8000-000000000018",
                "2500",
                "USD",
                "variable",
                "Qualified wallet",
              ),
            ]),
          ],
          [packageIdOne],
        ),
        "91000000-0000-4000-8000-000000000001",
      ).blockers.map(({ code }) => code),
    ).toContain("currency_unresolved");
  });

  it("marks missing commercial evidence incomplete rather than zero", () => {
    const summary = calculateScenarioSpend(
      [basketPackage(packageIdOne, [])],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("incomplete");
    expect(summary.fixedTotals).toEqual([]);
    expect(summary.incompletePackageIds).toEqual([packageIdOne, packageIdTwo]);
    expect(summary.missingPackageIds).toEqual([packageIdTwo]);
  });

  it("treats an explicit unpaid internal test as complete without paid spend", () => {
    const creatorPackage = unpaidInternalTestPackage(packageIdOne);
    const summary = calculateScenarioSpend(
      [creatorPackage],
      [creatorPackage.id],
    );

    expect(summary).toMatchObject({
      status: "unpaid",
      fixedTotals: [],
      incompletePackageIds: [],
      variableRates: [],
    });
    expect(
      evaluateBasketScenarioApproval(
        approvalBasket([creatorPackage], [creatorPackage.id]),
        "91000000-0000-4000-8000-000000000001",
      ),
    ).toMatchObject({ eligible: true, blockers: [] });
  });

  it("reports variable rates separately from committed fixed spend", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine(
            "83000000-0000-4000-8000-000000000008",
            "1500",
            "GBP",
            "variable",
            "Qualified wallet",
          ),
        ]),
        basketPackage(packageIdTwo, [
          cashLine(
            "83000000-0000-4000-8000-000000000009",
            "2500",
            "GBP",
            "variable",
            "Qualified wallet",
          ),
        ]),
      ],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("variable_only");
    expect(summary.fixedTotals).toEqual([]);
    expect(summary.variableRates).toEqual([
      {
        amount: "40",
        currencyCode: "GBP",
        lineCount: 2,
        scale: 0,
        units: "40",
        variableUnit: "Qualified wallet",
      },
    ]);
  });

  it("calculates committed-spend concentration in integer basis points", () => {
    const summary = calculateScenarioSpend(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000010", "75000"),
        ]),
        basketPackage(packageIdTwo, [
          cashLine("83000000-0000-4000-8000-000000000011", "25000"),
        ]),
      ],
      [packageIdOne, packageIdTwo, packageIdOne],
    );

    expect(summary.largestPackageId).toBe(packageIdOne);
    expect(summary.largestPackageShareBps).toBe(7500);
  });

  it("approves only a complete single-currency commercial scenario", () => {
    const basket = approvalBasket(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000012", "460000"),
        ]),
      ],
      [packageIdOne],
    );

    expect(
      evaluateBasketScenarioApproval(
        basket,
        "91000000-0000-4000-8000-000000000001",
      ),
    ).toMatchObject({ eligible: true, blockers: [] });
  });

  it("explains approval blockers without treating them as zero", () => {
    const missingTerms = {
      ...basketPackage(packageIdOne, []),
      deliverableSummary: null,
    };
    const mixedCurrency = basketPackage(packageIdTwo, [
      cashLine("83000000-0000-4000-8000-000000000013", "125000", "USD"),
    ]);
    const basket = approvalBasket(
      [missingTerms, mixedCurrency],
      [packageIdOne, packageIdTwo],
    );
    const evaluation = evaluateBasketScenarioApproval(
      { ...basket, objective: null, outcomeProfile: null },
      "91000000-0000-4000-8000-000000000001",
    );

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.blockers.map(({ code }) => code)).toEqual([
      "outcome_missing",
      "deliverable_missing",
      "commercial_terms_incomplete",
    ]);
    expect(evaluation.spend.status).toBe("incomplete");
  });

  it("blocks unresolved currency and variable-only commitments", () => {
    const mixedBasket = approvalBasket(
      [
        basketPackage(packageIdOne, [
          cashLine("83000000-0000-4000-8000-000000000014", "460000"),
        ]),
        basketPackage(packageIdTwo, [
          cashLine("83000000-0000-4000-8000-000000000015", "125000", "USD"),
        ]),
      ],
      [packageIdOne, packageIdTwo],
    );
    const variableBasket = approvalBasket(
      [
        basketPackage(packageIdOne, [
          cashLine(
            "83000000-0000-4000-8000-000000000016",
            "2500",
            "GBP",
            "variable",
            "Qualified wallet",
          ),
        ]),
      ],
      [packageIdOne],
    );

    expect(
      evaluateBasketScenarioApproval(
        mixedBasket,
        "91000000-0000-4000-8000-000000000001",
      ).blockers.map(({ code }) => code),
    ).toContain("currency_unresolved");
    expect(
      evaluateBasketScenarioApproval(
        variableBasket,
        "91000000-0000-4000-8000-000000000001",
      ).blockers.map(({ code }) => code),
    ).toContain("fixed_commitment_missing");
  });

  it("forecasts cumulative reach and wallets from dated audience evidence", () => {
    const first = {
      ...basketPackage(packageIdOne, []),
      audience: {
        channelType: "x" as const,
        size: 100000,
        observedAt: "2026-08-01T12:00:00.000Z",
        sourceLabel: "Sanitized audience evidence",
      },
    };
    const second = {
      ...basketPackage(packageIdTwo, []),
      audience: {
        channelType: "youtube" as const,
        size: 50000,
        observedAt: "2026-08-02T12:00:00.000Z",
        sourceLabel: "Sanitized audience evidence",
      },
    };
    const summary = calculateScenarioForecast(
      [first, second],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("ready");
    expect(summary.sampleSize).toBe(2);
    expect(summary.potentialAudience).toBe(150000);
    expect(summary.estimatedUniqueAudience).toBe(142500);
    expect(summary.forecastReach).toEqual({
      p25: 17100,
      base: 28500,
      p75: 42750,
    });
    expect(summary.qualifiedWallets).toEqual({ p25: 8, base: 28, p75: 85 });
  });

  it("keeps missing audience evidence explicit in forecast summaries", () => {
    const summary = calculateScenarioForecast(
      [basketPackage(packageIdOne, [])],
      [packageIdOne, packageIdTwo],
    );

    expect(summary.status).toBe("unavailable");
    expect(summary.missingPackageIds).toEqual([packageIdOne, packageIdTwo]);
    expect(summary.sampleSize).toBe(0);
  });

  it("rejects duplicate or oversized creator selections at the boundary", () => {
    const creatorId = "40000000-0000-4000-8000-000000000001";

    expect(createBasketInputSchema.safeParse({ creatorIds: [] }).success).toBe(
      false,
    );
    expect(
      createBasketInputSchema.safeParse({
        creatorIds: Array.from({ length: 21 }, () => creatorId),
      }).success,
    ).toBe(false);
  });

  it("accepts a campaign whose roster terms remain bound to an issued plan", () => {
    const parsed = campaignRecordSchema.parse({
      id: "a1000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      basketId: "90000000-0000-4000-8000-000000000001",
      commercialPlanVersionId: "a2000000-0000-4000-8000-000000000001",
      commercialPlanVersion: 1,
      name: "Helios roster",
      objective: "Increase qualified wallets",
      outcomeProfile: {
        baselineUnits: "50",
        currencyCode: null,
        metric: "qualified_wallets",
        targetUnits: "150",
      },
      status: "approved",
      createdBy: "30000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:00:00.000Z",
      roster: [
        {
          id: "a3000000-0000-4000-8000-000000000001",
          creatorId: "82000000-0000-4000-8000-000000000001",
          creatorName: "Chain Mode",
          creatorHandle: "@chainmode",
          sourcePackageId: packageIdOne,
          rosterPosition: 1,
          packageLabel: "Launch package",
          deliverableSummary: "One launch thread",
          commercialTerms: {
            id: packageIdOne,
            creatorId: "82000000-0000-4000-8000-000000000001",
            packageLabel: "Launch package",
            deliverableSummary: "One launch thread",
            sourceRateQuoteId: null,
            compensationLines: [
              {
                id: "a4000000-0000-4000-8000-000000000001",
                assetType: "cash",
                model: "fixed",
                amountMinor: "460000",
                currencyCode: "GBP",
              },
            ],
          },
          termsHash:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          createdAt: "2026-08-05T12:00:00.000Z",
        },
      ],
      briefVersions: [
        {
          id: "a8000000-0000-4000-8000-000000000001",
          version: 1,
          requestId: "a9000000-0000-4000-8000-000000000001",
          status: "draft",
          objective: "Increase qualified wallets",
          audience: null,
          keyMessage: null,
          creatorDirection: null,
          complianceNotes: null,
          reason: "Initial brief created from campaign objective",
          actorUserId: "30000000-0000-4000-8000-000000000001",
          createdAt: "2026-08-05T12:00:00.000Z",
        },
      ],
      contentAssets: [
        {
          id: "a5000000-0000-4000-8000-000000000001",
          campaignCreatorId: "a3000000-0000-4000-8000-000000000001",
          creatorId: "82000000-0000-4000-8000-000000000001",
          assetIndex: 1,
          label: "One launch thread",
          status: "planned",
          submissionUrl: null,
          publishedUrl: null,
          createdAt: "2026-08-05T12:00:00.000Z",
          updatedAt: "2026-08-05T12:00:00.000Z",
          publicationEvidence: [],
          trackedLinks: [],
          activity: [
            {
              id: "aa000000-0000-4000-8000-000000000001",
              requestId: "ab000000-0000-4000-8000-000000000001",
              actorUserId: "30000000-0000-4000-8000-000000000001",
              fromStatus: null,
              toStatus: "planned",
              evidenceUrl: null,
              note: "Initial content commitment materialized",
              createdAt: "2026-08-05T12:00:00.000Z",
            },
          ],
        },
      ],
      activity: [
        {
          id: "a7000000-0000-4000-8000-000000000001",
          transitionRequestId: "a6000000-0000-4000-8000-000000000001",
          actorUserId: "30000000-0000-4000-8000-000000000001",
          fromStatus: "draft",
          toStatus: "approved",
          reason: "Commercial plan approved",
          createdAt: "2026-08-05T12:00:00.000Z",
        },
      ],
    });

    expect(
      parsed.roster[0]?.commercialTerms.compensationLines[0],
    ).toMatchObject({ amountMinor: "460000", currencyCode: "GBP" });
    expect(parsed.status).toBe("approved");
    expect(parsed.activity[0]?.toStatus).toBe("approved");
  });

  it("requires retry identity and an issued plan when creating a campaign", () => {
    expect(
      createCampaignFromCommercialPlanInputSchema.safeParse({
        commercialPlanVersionId: "a2000000-0000-4000-8000-000000000001",
        activationRequestId: "a6000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      createCampaignFromCommercialPlanInputSchema.safeParse({
        commercialPlanVersionId: "not-a-plan",
        activationRequestId: "not-a-request",
      }).success,
    ).toBe(false);
  });

  it("requires a target state, retry identity and auditable reason", () => {
    expect(
      campaignTransitionInputSchema.parse({
        targetStatus: "live",
        transitionRequestId: "a6000000-0000-4000-8000-000000000002",
        reason: "Tracking activation approved",
      }),
    ).toEqual({
      targetStatus: "live",
      transitionRequestId: "a6000000-0000-4000-8000-000000000002",
      reason: "Tracking activation approved",
    });

    expect(
      campaignTransitionInputSchema.safeParse({
        targetStatus: "paused",
        transitionRequestId: "not-a-request",
        reason: "short",
      }).success,
    ).toBe(false);
  });

  it("requires complete, auditable brief revisions and explicit review actions", () => {
    expect(
      campaignBriefMutationInputSchema.safeParse({
        action: "save",
        requestId: "b1000000-0000-4000-8000-000000000001",
        objective: "Increase qualified wallets",
        audience: "Solana mobile users",
        keyMessage: "Verified progress before claims",
        creatorDirection: "Show the product journey clearly",
        complianceNotes: null,
        reason: "Complete the campaign brief",
      }).success,
    ).toBe(true);
    expect(
      campaignBriefMutationInputSchema.safeParse({
        action: "transition",
        requestId: "b1000000-0000-4000-8000-000000000002",
        targetStatus: "approved",
        reason: "Brief approved by campaign manager",
      }).success,
    ).toBe(true);
    expect(
      campaignBriefMutationInputSchema.safeParse({
        action: "save",
        requestId: "not-a-request",
        objective: "",
      }).success,
    ).toBe(false);
  });

  it("requires a controlled deliverable state, retry identity and review note", () => {
    expect(
      contentAssetTransitionInputSchema.safeParse({
        targetStatus: "submitted",
        requestId: "c1000000-0000-4000-8000-000000000001",
        evidenceUrl: "https://example.test/review/launch-thread",
        note: "Creator submitted content for review",
      }).success,
    ).toBe(true);
    expect(
      contentAssetTransitionInputSchema.safeParse({
        targetStatus: "unknown",
        requestId: "not-a-request",
        evidenceUrl: "javascript:alert(1)",
        note: "short",
      }).success,
    ).toBe(false);
  });

  it("keeps the signed-link payload canonical, versioned and tenant-opaque", () => {
    expect(trackedClickQueryParameter).toBe("lnd_click");
    expect(
      trackedLinkPayloadSchema.parse({
        schemaVersion: 1,
        linkId: "d1000000-0000-4000-8000-000000000001",
        campaignId: "a1000000-0000-4000-8000-000000000001",
        creatorId: "40000000-0000-4000-8000-000000000001",
        contentAssetId: "a5000000-0000-4000-8000-000000000001",
        expiresAt: "2026-09-10T12:00:00.000Z",
        keyVersion: 1,
      }),
    ).toEqual({
      schemaVersion: 1,
      linkId: "d1000000-0000-4000-8000-000000000001",
      campaignId: "a1000000-0000-4000-8000-000000000001",
      creatorId: "40000000-0000-4000-8000-000000000001",
      contentAssetId: "a5000000-0000-4000-8000-000000000001",
      expiresAt: "2026-09-10T12:00:00.000Z",
      keyVersion: 1,
    });
    expect(
      trackedLinkPayloadSchema.safeParse({
        schemaVersion: 1,
        linkId: "d1000000-0000-4000-8000-000000000001",
        campaignId: "a1000000-0000-4000-8000-000000000001",
        creatorId: "40000000-0000-4000-8000-000000000001",
        contentAssetId: "a5000000-0000-4000-8000-000000000001",
        expiresAt: "2026-09-10T12:00:00.000Z",
        keyVersion: 1,
        workspaceId: "10000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("accepts only explicit HTTPS issuance and auditable revocation requests", () => {
    expect(
      trackedLinkMutationInputSchema.safeParse({
        action: "issue",
        requestId: "d2000000-0000-4000-8000-000000000001",
        destinationUrl: "https://helios.example.test/start",
        expiresAt: "2026-09-10T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      trackedLinkMutationInputSchema.safeParse({
        action: "issue",
        requestId: "d2000000-0000-4000-8000-000000000001",
        destinationUrl: "http://helios.example.test/start",
        expiresAt: "not-a-time",
      }).success,
    ).toBe(false);
    expect(
      trackedLinkMutationInputSchema.safeParse({
        action: "issue",
        requestId: "d2000000-0000-4000-8000-000000000001",
        destinationUrl:
          "https://trusted.example:disguised-secret@phishing.example/start",
        expiresAt: "2026-09-10T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      trackedLinkMutationInputSchema.safeParse({
        action: "revoke",
        requestId: "d2000000-0000-4000-8000-000000000002",
        trackedLinkId: "d1000000-0000-4000-8000-000000000001",
        reason: "Campaign destination has changed",
      }).success,
    ).toBe(true);
  });

  it("keeps observed redirects separate from later qualified-click scoring", () => {
    expect(
      trackedLinkClickEvidenceSchema.safeParse({
        eligibleRedirects: 4,
        ineligibleAttempts: 2,
        totalAttempts: 6,
        firstObservedAt: "2026-08-10T12:00:00.000Z",
        lastObservedAt: "2026-08-10T13:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      trackedLinkClickEvidenceSchema.safeParse({
        eligibleRedirects: -1,
        ineligibleAttempts: 0,
        totalAttempts: -1,
        firstObservedAt: null,
        lastObservedAt: null,
      }).success,
    ).toBe(false);
  });

  it("reconciles versioned qualified, duplicate and rejected click decisions", () => {
    expect(
      trackedLinkClickQualityEvidenceSchema.safeParse({
        ruleVersion: 1,
        duplicateWindowSeconds: 1800,
        qualifiedClicks: 3,
        duplicateClicks: 1,
        rejectedClicks: 1,
        totalAssessed: 5,
        pendingAssessment: 2,
        firstAssessedAt: "2026-08-10T12:00:00.000Z",
        lastAssessedAt: "2026-08-10T13:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      trackedLinkClickQualityEvidenceSchema.safeParse({
        ruleVersion: 1,
        duplicateWindowSeconds: 1800,
        qualifiedClicks: 3,
        duplicateClicks: 1,
        rejectedClicks: 1,
        totalAssessed: 6,
        pendingAssessment: 0,
        firstAssessedAt: "2026-08-10T12:00:00.000Z",
        lastAssessedAt: "2026-08-10T13:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      trackedLinkClickQualityEvidenceSchema.safeParse({
        ruleVersion: null,
        duplicateWindowSeconds: null,
        qualifiedClicks: 0,
        duplicateClicks: 0,
        rejectedClicks: 0,
        totalAssessed: 0,
        pendingAssessment: 2,
        firstAssessedAt: null,
        lastAssessedAt: null,
      }).success,
    ).toBe(true);
  });

  it("keeps anonymous session evidence bounded and explicit", () => {
    expect(
      trackedLinkAnonymousSessionEvidenceSchema.safeParse({
        sessions: 2,
        boundClicks: 3,
        firstCreatedAt: "2026-08-10T12:00:00.000Z",
        lastSeenAt: "2026-08-10T12:30:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      trackedLinkAnonymousSessionEvidenceSchema.safeParse({
        sessions: 2,
        boundClicks: 1,
        firstCreatedAt: "2026-08-10T12:00:00.000Z",
        lastSeenAt: "2026-08-10T12:30:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      trackedLinkAnonymousSessionEvidenceSchema.safeParse({
        sessions: 0,
        boundClicks: 0,
        firstCreatedAt: null,
        lastSeenAt: null,
      }).success,
    ).toBe(true);
    expect(
      trackedLinkAnonymousSessionEvidenceSchema.safeParse({
        sessions: 0,
        boundClicks: 3,
        firstCreatedAt: null,
        lastSeenAt: null,
      }).success,
    ).toBe(false);
  });

  it("accepts canonical 32-byte Solana addresses for wallet proof", () => {
    expect(
      solanaWalletAddressSchema.safeParse(
        "So11111111111111111111111111111111111111112",
      ).success,
    ).toBe(true);
    expect(
      walletNonceChallengeRequestSchema.safeParse({
        walletAddress: "11111111111111111111111111111111",
      }).success,
    ).toBe(true);
    expect(
      solanaWalletAddressSchema.safeParse(
        "0oIl-not-base58-and-not-a-solana-address",
      ).success,
    ).toBe(false);
    expect(solanaWalletAddressSchema.safeParse("1".repeat(31)).success).toBe(
      false,
    );
  });

  it("keeps the server-issued Solana sign-in challenge complete and strict", () => {
    const response = {
      challengeId: "f1000000-0000-4000-8000-000000000001",
      expiresAt: "2026-08-11T12:05:00.000Z",
      signInInput: {
        domain: "landed.example.test",
        address: "So11111111111111111111111111111111111111112",
        statement:
          "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
        uri: "https://landed.example.test",
        version: "1",
        chainId: "solana:mainnet",
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expirationTime: "2026-08-11T12:05:00.000Z",
        requestId: "f1000000-0000-4000-8000-000000000001",
      },
    };

    expect(walletNonceChallengeResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      walletNonceChallengeResponseSchema.safeParse({
        ...response,
        signInInput: {
          ...response.signInInput,
          domain: "attacker.example.test",
          statement: "Line one\nLine two",
        },
      }).success,
    ).toBe(false);
    expect(
      walletNonceChallengeResponseSchema.safeParse({
        ...response,
        privateKey: "never accepted",
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded, matching Wallet Standard signature proof", () => {
    const request = {
      challengeId: "f1000000-0000-4000-8000-000000000001",
      signInInput: {
        domain: "landed.example.test",
        address: "So11111111111111111111111111111111111111112",
        statement:
          "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
        uri: "https://landed.example.test",
        version: "1" as const,
        chainId: "solana:mainnet" as const,
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expirationTime: "2026-08-11T12:05:00.000Z",
        requestId: "f1000000-0000-4000-8000-000000000001",
      },
      signInOutput: {
        accountAddress: "So11111111111111111111111111111111111111112",
        accountPublicKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        signedMessage: "Y2Fub25pY2FsIFNJV1MgbWVzc2FnZQ==",
        signature:
          "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg==",
        signatureType: "ed25519" as const,
      },
    };

    expect(walletSignatureProofRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      walletSignatureProofRequestSchema.safeParse({
        ...request,
        challengeId: "f1000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
    expect(
      walletSignatureProofRequestSchema.safeParse({
        ...request,
        signInInput: {
          ...request.signInInput,
          issuedAt: "2026-08-11T13:00:00.000+01:00",
        },
      }).success,
    ).toBe(false);
    expect(
      walletSignatureProofRequestSchema.safeParse({
        ...request,
        signInOutput: {
          ...request.signInOutput,
          signature:
            "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC",
        },
      }).success,
    ).toBe(false);
    expect(
      walletSignatureProofRequestSchema.safeParse({
        ...request,
        privateKey: "never accepted",
      }).success,
    ).toBe(false);
  });

  it("requires explicit versioned consent and a canonical unlink request", () => {
    const proofId = "f3000000-0000-4000-8000-000000000001";
    const consent = {
      proofId,
      accepted: true as const,
      consentVersion: 1 as const,
    };

    expect(walletMeasurementConsentRequestSchema.parse(consent)).toEqual(
      consent,
    );
    expect(
      walletMeasurementConsentRequestSchema.safeParse({
        ...consent,
        accepted: false,
      }).success,
    ).toBe(false);
    expect(
      walletMeasurementConsentRequestSchema.safeParse({
        ...consent,
        monitorForever: true,
      }).success,
    ).toBe(false);

    expect(
      walletMeasurementConsentResponseSchema.safeParse({
        consentId: "f4000000-0000-4000-8000-000000000001",
        mappingId: "f5000000-0000-4000-8000-000000000001",
        state: "accepted",
        consentVersion: 1,
        consentStatement: walletMeasurementConsentStatement,
        historicalLookbackDays: 90,
        acceptedAt: "2026-08-11T12:00:00.000Z",
        monitoringEndsAt: "2026-08-18T12:00:00.000Z",
      }).success,
    ).toBe(true);

    const unlink = {
      unlinkRequestId: "f6000000-0000-4000-8000-000000000001",
    };
    expect(walletMappingUnlinkRequestSchema.parse(unlink)).toEqual(unlink);
    expect(
      walletMappingUnlinkResponseSchema.safeParse({
        mappingId: "f5000000-0000-4000-8000-000000000001",
        state: "unlinked",
        unlinkedAt: "2026-08-11T12:10:00.000Z",
      }).success,
    ).toBe(true);
  });
});
