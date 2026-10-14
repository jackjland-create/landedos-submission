import { describe, expect, it } from "vitest";

import {
  computeCampaignMetrics,
  metricSnapshotInputSchema,
  type MetricSnapshotInput,
} from "./index";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  campaign: "30000000-0000-4000-8000-000000000001",
  snapshot: "40000000-0000-4000-8000-000000000001",
  rule: "50000000-0000-4000-8000-000000000001",
  activationRule: "60000000-0000-4000-8000-000000000001",
};

function input(
  overrides: Partial<MetricSnapshotInput> = {},
): MetricSnapshotInput {
  return {
    id: ids.snapshot,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    currencyCode: "GBP",
    valuationPolicy: {
      id: "approved-campaign-ledger",
      version: 1,
      description: "Approved compensation and campaign costs valued in GBP",
      currencyCode: "GBP",
      valuedAt: "2026-08-12T12:00:00.000Z",
    },
    conversionRuleVersionIds: [ids.rule],
    attributionClassifierVersion: 1,
    sourceTimeRange: {
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: "2026-08-12T12:00:00.000Z",
    },
    dataFreshness: {
      dataThrough: "2026-08-12T11:55:00.000Z",
      calculatedAt: "2026-08-12T12:05:00.000Z",
    },
    spend: {
      status: "complete",
      lines: [
        {
          id: "70000000-0000-4000-8000-000000000001",
          kind: "creator_compensation",
          amountMinor: "8000",
          inclusion: "included",
          exclusionReason: null,
          sourceEvidenceId: "commercial:creator:1",
        },
        {
          id: "70000000-0000-4000-8000-000000000002",
          kind: "campaign_cost",
          amountMinor: "2000",
          inclusion: "included",
          exclusionReason: null,
          sourceEvidenceId: "commercial:cost:1",
        },
        {
          id: "70000000-0000-4000-8000-000000000003",
          kind: "campaign_cost",
          amountMinor: "5000",
          inclusion: "excluded",
          exclusionReason: "Customer excluded internal staff cost",
          sourceEvidenceId: "commercial:excluded:1",
        },
      ],
    },
    qualifiedClicks: {
      status: "complete",
      evidenceIds: ["click:4", "click:2", "click:1", "click:3"],
    },
    qualifiedWallets: {
      status: "complete",
      evidenceIds: ["wallet:2", "wallet:1"],
    },
    activatedWallets: {
      status: "complete",
      evidenceIds: ["wallet:1"],
    },
    activationDefinition: {
      ruleVersionId: ids.activationRule,
      label: "First funded account",
    },
    protocolRevenue: {
      status: "complete",
      lines: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          attributionEvidenceId: "attribution:verified:1",
          sourceRevenueEvidenceId: "revenue:verified:1",
          confidence: "verified",
          protocolRevenueMinor: "15000",
        },
        {
          id: "80000000-0000-4000-8000-000000000002",
          attributionEvidenceId: "attribution:strong:1",
          sourceRevenueEvidenceId: "revenue:strong:1",
          confidence: "strong",
          protocolRevenueMinor: "5000",
        },
        {
          id: "80000000-0000-4000-8000-000000000003",
          attributionEvidenceId: "attribution:indicative:1",
          sourceRevenueEvidenceId: "revenue:indicative:1",
          confidence: "indicative",
          protocolRevenueMinor: "9000",
        },
        {
          id: "80000000-0000-4000-8000-000000000004",
          attributionEvidenceId: "attribution:unattributed:1",
          sourceRevenueEvidenceId: "revenue:unattributed:1",
          confidence: "unattributed",
          protocolRevenueMinor: "1000",
        },
      ],
    },
    ...overrides,
  };
}

describe("computeCampaignMetrics", () => {
  it("computes CPC, CPQW, CPA and revenue ROAS from exposed exact components", () => {
    const result = computeCampaignMetrics(input());

    expect(result.metrics.cpc).toMatchObject({
      metric: "cpc",
      definition: "Eligible campaign spend / qualified clicks",
      status: "available",
      numerator: {
        valueMinor: "10000",
        evidenceIds: ["commercial:cost:1", "commercial:creator:1"],
      },
      denominator: {
        value: 4,
        evidenceIds: ["click:1", "click:2", "click:3", "click:4"],
      },
      rateMinorDecimal: "2500.000000",
      includedAttributionConfidence: [],
      activationDefinition: {
        ruleVersionId: ids.activationRule,
        label: "First funded account",
      },
      excludedSpend: {
        status: "available",
        valueMinor: "5000",
        evidenceIds: ["commercial:excluded:1"],
      },
    });
    expect(result.metrics.cpqw).toMatchObject({
      status: "available",
      denominator: { value: 2 },
      rateMinorDecimal: "5000.000000",
    });
    expect(result.metrics.cpa).toMatchObject({
      status: "available",
      denominator: { value: 1 },
      rateMinorDecimal: "10000.000000",
    });
    expect(result.metrics.revenueRoas).toMatchObject({
      status: "available",
      numerator: {
        valueMinor: "20000",
        sourceRevenueEvidenceIds: ["revenue:strong:1", "revenue:verified:1"],
        attributionEvidenceIds: [
          "attribution:strong:1",
          "attribution:verified:1",
        ],
      },
      denominator: { valueMinor: "10000" },
      ratioDecimal: "2.000000",
      includedAttributionConfidence: ["verified", "strong"],
      excludedAttributionRevenue: {
        indicativeMinor: "9000",
        unattributedMinor: "1000",
        sourceRevenueEvidenceIds: [
          "revenue:indicative:1",
          "revenue:unattributed:1",
        ],
        attributionEvidenceIds: [
          "attribution:indicative:1",
          "attribution:unattributed:1",
        ],
      },
    });
  });

  it("returns not_available rather than zero or infinity for empty denominators", () => {
    const result = computeCampaignMetrics(
      input({
        qualifiedClicks: { status: "complete", evidenceIds: [] },
        qualifiedWallets: { status: "complete", evidenceIds: [] },
        activatedWallets: { status: "complete", evidenceIds: [] },
      }),
    );

    expect(result.metrics.cpc).toMatchObject({
      status: "not_available",
      reason: "no_qualified_clicks",
      denominator: { status: "available", value: 0 },
    });
    expect(result.metrics.cpqw).toMatchObject({
      status: "not_available",
      reason: "no_qualified_wallets",
    });
    expect(result.metrics.cpa).toMatchObject({
      status: "not_available",
      reason: "no_activated_wallets",
    });
  });

  it("retains an unknown spend source instead of treating it as zero", () => {
    const result = computeCampaignMetrics(
      input({
        spend: { status: "not_available", reason: "source_incomplete" },
      }),
    );

    for (const metric of [
      result.metrics.cpc,
      result.metrics.cpqw,
      result.metrics.cpa,
      result.metrics.revenueRoas,
    ]) {
      expect(metric).toMatchObject({
        status: "not_available",
        reason: "spend_not_available",
        denominator:
          metric.metric === "revenue_roas"
            ? { status: "not_available", reason: "source_incomplete" }
            : expect.any(Object),
      });
      expect(metric.excludedSpend).toEqual({
        status: "not_available",
        reason: "source_incomplete",
      });
    }
  });

  it("keeps cost metrics available while unknown revenue makes only ROAS unavailable", () => {
    const result = computeCampaignMetrics(
      input({
        protocolRevenue: {
          status: "not_available",
          reason: "source_not_configured",
        },
      }),
    );

    expect(result.metrics.cpc.status).toBe("available");
    expect(result.metrics.cpqw.status).toBe("available");
    expect(result.metrics.cpa.status).toBe("available");
    expect(result.metrics.revenueRoas).toMatchObject({
      status: "not_available",
      reason: "revenue_not_available",
      numerator: {
        status: "not_available",
        reason: "source_not_configured",
      },
    });
  });

  it("returns ROAS not_available when complete eligible spend is exactly zero", () => {
    const result = computeCampaignMetrics(
      input({ spend: { status: "complete", lines: [] } }),
    );

    expect(result.metrics.cpc).toMatchObject({
      status: "available",
      rateMinorDecimal: "0.000000",
    });
    expect(result.metrics.revenueRoas).toMatchObject({
      status: "not_available",
      reason: "no_eligible_spend",
      denominator: { status: "available", valueMinor: "0" },
    });
  });

  it("rounds exact BigInt ratios half-up without floating-point conversion", () => {
    const base = input();
    if (base.spend.status !== "complete") throw new Error("Invalid fixture");
    const oneMinorSpend = {
      status: "complete" as const,
      lines: [
        {
          ...base.spend.lines[0],
          amountMinor: "1",
        },
      ],
    };
    const result = computeCampaignMetrics(
      input({
        spend: oneMinorSpend,
        qualifiedClicks: {
          status: "complete",
          evidenceIds: ["1", "2", "3", "4", "5", "6"],
        },
        protocolRevenue: {
          status: "complete",
          lines: [
            {
              id: "80000000-0000-4000-8000-000000000099",
              attributionEvidenceId: "attribution:verified:99",
              sourceRevenueEvidenceId: "revenue:verified:99",
              confidence: "verified",
              protocolRevenueMinor: "9007199254740993123",
            },
          ],
        },
      }),
    );

    expect(result.metrics.cpc).toMatchObject({
      rateMinorDecimal: "0.166667",
    });
    expect(result.metrics.revenueRoas).toMatchObject({
      ratioDecimal: "9007199254740993123.000000",
    });
  });

  it("is independent of spend, count, revenue and rule input order", () => {
    const original = input();
    if (
      original.spend.status !== "complete" ||
      original.qualifiedClicks.status !== "complete" ||
      original.protocolRevenue.status !== "complete"
    ) {
      throw new Error("Invalid fixture");
    }
    const reversed = input({
      conversionRuleVersionIds: [
        "50000000-0000-4000-8000-000000000002",
        ids.rule,
      ],
      spend: { status: "complete", lines: [...original.spend.lines].reverse() },
      qualifiedClicks: {
        status: "complete",
        evidenceIds: [...original.qualifiedClicks.evidenceIds].reverse(),
      },
      protocolRevenue: {
        status: "complete",
        lines: [...original.protocolRevenue.lines].reverse(),
      },
    });
    const ordered = input({
      conversionRuleVersionIds: [
        ids.rule,
        "50000000-0000-4000-8000-000000000002",
      ],
    });

    expect(computeCampaignMetrics(reversed)).toEqual(
      computeCampaignMetrics(ordered),
    );
  });

  it("rejects duplicate evidence IDs rather than double counting", () => {
    expect(
      metricSnapshotInputSchema.safeParse(
        input({
          qualifiedClicks: {
            status: "complete",
            evidenceIds: ["click:1", "click:1"],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects activated wallets that are not in the qualified-wallet set", () => {
    expect(
      metricSnapshotInputSchema.safeParse(
        input({
          activatedWallets: {
            status: "complete",
            evidenceIds: ["wallet:unknown"],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects transaction volume masquerading as protocol revenue", () => {
    const candidate = input() as unknown as Record<string, unknown>;
    candidate.protocolRevenue = {
      status: "complete",
      lines: [
        {
          id: "80000000-0000-4000-8000-000000000099",
          attributionEvidenceId: "attribution:verified:99",
          sourceRevenueEvidenceId: "volume:99",
          confidence: "verified",
          protocolRevenueMinor: "10",
          transactionVolumeMinor: "1000000",
        },
      ],
    };
    expect(metricSnapshotInputSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects invalid source ranges and stale data outside the range", () => {
    expect(
      metricSnapshotInputSchema.safeParse(
        input({
          dataFreshness: {
            dataThrough: "2026-07-31T23:59:59.999Z",
            calculatedAt: "2026-08-12T12:05:00.000Z",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects valuation currency that does not match the snapshot", () => {
    expect(
      metricSnapshotInputSchema.safeParse(
        input({
          valuationPolicy: {
            ...input().valuationPolicy,
            currencyCode: "USD",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects valuation evidence created after the calculation", () => {
    expect(
      metricSnapshotInputSchema.safeParse(
        input({
          valuationPolicy: {
            ...input().valuationPolicy,
            valuedAt: "2026-08-12T12:05:00.001Z",
          },
        }),
      ).success,
    ).toBe(false);
  });
});
