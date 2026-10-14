import { describe, expect, it } from "vitest";

import fixture from "./fixtures/campaign-report-sources.json";
import {
  buildCampaignReportPreview,
  campaignReportSourcesSchema,
} from "./campaign-report-preview";

const sources = () => structuredClone(fixture);
const missingId = "99999999-9999-4999-8999-999999999999";

describe("BSK-09 unissued campaign metric preview", () => {
  it("accepts actual isolated SQL sources and separates commitment from partial observations", () => {
    const preview = buildCampaignReportPreview(fixture);
    expect(preview).toMatchObject({
      kind: "unissued_campaign_metric_preview",
      approvedCommitment: {
        status: "available",
        amountMinor: "519500",
        currencyCode: "GBP",
      },
      observedEvidence: {
        completeness: "not_established",
        resultCount: 2,
        walletCount: 2,
        qualifiedClickCount: 0,
      },
      issuance: { status: "blocked" },
    });
    expect(preview.metrics).toEqual({
      cpc: { status: "not_available", reason: "source_incomplete" },
      cpqw: { status: "not_available", reason: "source_incomplete" },
      cpa: { status: "not_available", reason: "source_incomplete" },
      revenueRoas: { status: "not_available", reason: "source_not_configured" },
    });
    expect(preview).not.toHaveProperty("dataFreshness");
    expect(preview).not.toHaveProperty("dataThrough");
    expect(preview).not.toHaveProperty("metricSnapshotId");
    expect(JSON.stringify(preview)).not.toContain("9007199254740993123");
  });

  it("empty observations remain incomplete rather than issued zero metrics", () => {
    const raw = sources();
    raw.results = [];
    raw.walletAttributionEvidenceIds = [];
    const preview = buildCampaignReportPreview(raw);
    expect(preview.observedEvidence).toEqual({
      completeness: "not_established",
      resultCount: 0,
      walletCount: 0,
      qualifiedClickCount: 0,
    });
    expect(preview.metrics.cpa).toEqual({
      status: "not_available",
      reason: "source_incomplete",
    });
    expect(preview.issuance.status).toBe("blocked");
  });

  it("fixed zero commitment is available zero, not unavailable", () => {
    const raw = sources();
    for (const pkg of raw.commercialPlanSnapshot.packages)
      pkg.compensationLines[0]!.amountMinor = "0";
    expect(buildCampaignReportPreview(raw).approvedCommitment).toMatchObject({
      status: "available",
      amountMinor: "0",
      currencyCode: "GBP",
    });
  });

  it("sums large fixed cash commitments using exact integer arithmetic", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.amountMinor =
      "9007199254740993";
    raw.commercialPlanSnapshot.packages[1]!.compensationLines[0]!.amountMinor =
      "7";
    expect(buildCampaignReportPreview(raw).approvedCommitment).toMatchObject({
      status: "available",
      amountMinor: "9007199254741000",
    });
  });

  it("variable cash is not a fixed approved commitment", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.model =
      "variable";
    expect(buildCampaignReportPreview(raw).approvedCommitment).toEqual({
      status: "not_available",
      reason: "variable_compensation",
    });
  });

  it("mixed currency does not invent an exchange rate", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.currencyCode =
      "USD";
    expect(buildCampaignReportPreview(raw).approvedCommitment).toEqual({
      status: "not_available",
      reason: "mixed_currency",
    });
  });

  it.each(["token", "usdc"])(
    "%s compensation remains unavailable despite retained valuation metadata",
    (assetType) => {
      const raw = sources();
      const pkg = raw.commercialPlanSnapshot.packages[0]!;
      const tokenLine = {
        id: pkg.compensationLines[0]!.id,
        model: "fixed",
        assetType,
        tokenMint: "11111111111111111111111111111111",
        tokenAmountRaw: "1000000",
        tokenDecimals: 6,
        unitPriceUsd: "1",
        priceSource: "synthetic test source",
        valuedAt: "2026-09-01T00:00:00Z",
      };
      const changed = {
        ...raw,
        commercialPlanSnapshot: {
          ...raw.commercialPlanSnapshot,
          packages: [
            { ...pkg, compensationLines: [tokenLine] },
            raw.commercialPlanSnapshot.packages[1]!,
          ],
        },
      };
      expect(buildCampaignReportPreview(changed).approvedCommitment).toEqual({
        status: "not_available",
        reason: "non_cash_valuation_required",
      });
    },
  );

  it.each(["workspaceId", "projectId", "ruleVersionId"] as const)(
    "rejects mismatched %s",
    (key) => {
      const raw = sources();
      raw[key] = missingId;
      expect(() => buildCampaignReportPreview(raw)).toThrow();
    },
  );

  it("rejects altered approved period", () => {
    const raw = sources();
    raw.measurementWindow.startedAt = "2026-09-07T00:00:00.000001Z";
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("compares timezone-equivalent measurement instants precisely", () => {
    const raw = sources();
    raw.measurementWindow.startedAt = "2026-09-07T01:00:00+01:00";
    expect(() => buildCampaignReportPreview(raw)).not.toThrow();
  });

  it("rejects a rule starting one microsecond after the approved start", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.strategyBinding.conversionRule.effectiveFrom =
      "2026-09-07T00:00:00.000001Z";
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects result at exclusive window end", () => {
    const raw = sources();
    raw.results[0]!.conversionTime = raw.measurementWindow.endedAt;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects result touch at or after conversion", () => {
    const raw = sources();
    raw.results[0]!.touchTime = raw.results[0]!.conversionTime;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects a touch exceeding seven days", () => {
    const raw = sources();
    raw.results[0]!.touchTime = "2026-08-01T00:00:00Z";
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects finer than database timestamp precision", () => {
    const raw = sources();
    raw.results[0]!.conversionTime = "2026-09-08T12:00:00.0000001Z";
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects a result creator absent from approved packages", () => {
    const raw = sources();
    raw.results[0]!.creatorId = missingId;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it.each([
    "conversionFactId",
    "attributionFactId",
    "calculationRequestId",
    "auditId",
    "canonicalChainEventId",
  ] as const)("rejects duplicate %s", (key) => {
    const raw = sources();
    raw.results[1]![key] = raw.results[0]![key];
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects duplicate package identities", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[1]!.id =
      raw.commercialPlanSnapshot.packages[0]!.id;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects duplicate approved package creators", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.creatorId =
      raw.commercialPlanSnapshot.packages[1]!.creatorId;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects duplicate compensation identities", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[1]!.compensationLines[0]!.id =
      raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.id;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects wallet IDs outside retained attributions", () => {
    const raw = sources();
    raw.walletAttributionEvidenceIds[0] = missingId;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects repeated wallet representative IDs", () => {
    const raw = sources();
    raw.walletAttributionEvidenceIds[1] = raw.walletAttributionEvidenceIds[0]!;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects missing wallet representatives for populated results", () => {
    const raw = sources();
    raw.walletAttributionEvidenceIds = [];
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it.each(["clickId", "assessmentId"] as const)(
    "rejects duplicate qualified %s",
    (key) => {
      const a = {
        clickId: fixture.results[0]!.conversionFactId,
        assessmentId: fixture.results[0]!.auditId,
        qualityRuleVersionId: missingId,
      };
      const b = {
        clickId: fixture.results[1]!.conversionFactId,
        assessmentId: fixture.results[1]!.auditId,
        qualityRuleVersionId: missingId,
      };
      b[key] = a[key];
      expect(() =>
        buildCampaignReportPreview({
          ...sources(),
          qualifiedClickEvidence: [a, b],
        }),
      ).toThrow();
    },
  );

  it("rejects native units with wrong decimals", () => {
    const raw = sources();
    raw.results[0]!.value.decimals = 6;
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects token units without a mint", () => {
    const raw = sources();
    raw.results[0]!.value.kind = "token_base_units";
    expect(() => buildCampaignReportPreview(raw)).toThrow();
  });

  it("rejects transfer amount numeric coercion", () => {
    const raw = sources();
    expect(() =>
      buildCampaignReportPreview({
        ...raw,
        results: [
          {
            ...raw.results[0],
            value: { ...raw.results[0]!.value, rawAmount: 100 },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects undeclared fields and invented completeness", () => {
    expect(() =>
      buildCampaignReportPreview({
        ...sources(),
        dataThrough: "2026-09-11T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      buildCampaignReportPreview({ ...sources(), completeness: "complete" }),
    ).toThrow();
  });

  it("checks hash syntax without claiming to authenticate arbitrary caller JSON", () => {
    expect(
      campaignReportSourcesSchema.safeParse({
        ...sources(),
        commercialPlanSnapshotHash: "invalid",
      }).success,
    ).toBe(false);
    expect(buildCampaignReportPreview(fixture).issuance.status).toBe("blocked");
  });
});
