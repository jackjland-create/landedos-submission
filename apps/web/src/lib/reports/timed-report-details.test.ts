import { describe, expect, it } from "vitest";
import { buildReportVisualFixture } from "./visual-fixtures";
import {
  buildTimedCreatorEconomics,
  type TimedReportDetails,
} from "./timed-report-details";
import type { TimedReportPresentation } from "./timed-report-presentation";

function setup() {
  const fixture = buildReportVisualFixture("ready");
  const version = fixture.selectedVersion;
  const pkg = structuredClone(fixture.campaign.roster[0]!.commercialTerms);
  const original = pkg.compensationLines.find((l) => l.assetType === "cash")!;
  if (original.assetType !== "cash") throw Error("cash fixture required");
  const terms = {
    ...original,
    model: "fixed" as const,
    amountMinor: "10000",
    currencyCode: "GBP" as const,
  };
  pkg.compensationLines = [terms];
  const plan = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const path = {
    ...fixture.rankingEvidencePaths[0]!,
    reportVersionId: version.id,
    metricSnapshotId: version.metricSnapshot.id,
    creatorId: pkg.creatorId,
    creatorName: `Creator ${pkg.creatorId}`,
    contentAssetLabel: `Approved package: ${pkg.packageLabel}`,
    metric: "qualified_wallets" as const,
  };
  delete (path as unknown as Record<string, unknown>).revenueKind;
  version.metricSnapshot.metrics.cpqw.denominator = {
    status: "available",
    kind: "qualified_wallet_count",
    value: 1,
    evidenceIds: [path.attributionFactId],
  };
  version.metricSnapshot.metrics.cpc.numerator = {
    status: "available",
    kind: "eligible_campaign_spend_minor",
    valueMinor: "10000",
    evidenceIds: [`${plan}:${terms.id}`],
  };
  const context: TimedReportPresentation = {
    schemaVersion: 1,
    workspaceId: fixture.report.workspaceId,
    projectId: fixture.report.projectId,
    campaignId: fixture.report.campaignId,
    reportId: fixture.report.id,
    reportVersionId: version.id,
    version: version.version,
    metricSnapshotId: version.metricSnapshot.id,
    commercialPlanVersionId: plan,
    approvedFlight: version.metricSnapshot.metrics.cpc.sourceTimeRange,
    measurementWindow: version.metricSnapshot.metrics.cpc.sourceTimeRange,
    costPolicy: {
      basis: "contracted",
      version: 1,
      currencyCode: "GBP",
      paid: false,
    },
    coverage: {
      scope: "retained_consented_history_only",
      conversionEvaluation: "retained_universe_reconciled",
      checkedAt: version.issuedAt,
    },
    providerExhaustion: "not_independently_verified",
    unavailableMetrics: ["activation", "protocolRevenue", "impressions"],
  };
  const detail: TimedReportDetails = {
    schemaVersion: 1,
    reportVersionId: version.id,
    metricSnapshotId: version.metricSnapshot.id,
    commercialPlanVersionId: plan,
    packages: [pkg],
    additionalCosts: "none_declared",
    costLines: [
      {
        packageId: pkg.id,
        creatorId: pkg.creatorId,
        compensationLineId: terms.id,
        terms,
        inclusion: "included",
        reason: "Reviewed fixed creator fee",
      },
    ],
    paths: [path],
  };
  return { version, context, detail };
}
describe("historical timed report detail", () => {
  it.each(["0", "9007199254740993"])(
    "preserves exact included minor units %s",
    (amount) => {
      const { version, context, detail } = setup();
      const fee = detail.packages[0]!.compensationLines[0]!;
      if (fee.assetType !== "cash") throw Error("cash fixture");
      fee.amountMinor = amount;
      detail.costLines[0]!.terms = { ...fee };
      const spend = version.metricSnapshot.metrics.cpc.numerator;
      if (spend.status !== "available") throw Error("spend fixture");
      spend.valueMinor = amount;
      expect(
        buildTimedCreatorEconomics(version, context, detail).creators[0]!
          .allocation,
      ).toEqual({ status: "available", valueMinor: amount });
    },
  );
  it("rejects denominator count and sub-millisecond temporal drift", () => {
    const { version, context, detail } = setup();
    const denominator = version.metricSnapshot.metrics.cpqw.denominator;
    if (denominator.status !== "available") throw Error("count fixture");
    denominator.value = 2;
    expect(() =>
      buildTimedCreatorEconomics(version, context, detail),
    ).toThrow();
    denominator.value = 1;
    detail.paths[0]!.conversionTime = context.measurementWindow.endedAt.replace(
      ".000Z",
      ".000001Z",
    );
    detail.paths[0]!.eventTime = detail.paths[0]!.conversionTime;
    expect(() =>
      buildTimedCreatorEconomics(version, context, detail),
    ).toThrow();
  });
  it("allocates exact qualified source line IDs without changing issued evidence", () => {
    const { version, context, detail } = setup(),
      before = JSON.stringify(version);
    const result = buildTimedCreatorEconomics(version, context, detail);
    expect(result.allocatedSpendMinor).toBe("10000");
    expect(result.unallocatedSpendMinor).toBe("0");
    expect(result.creators[0]).toMatchObject({
      creatorHandle: null,
      contentAssets: [],
      qualifiedWallets: 1,
      activatedWallets: null,
      cpqwMinorDecimal: "10000.000000",
    });
    expect(JSON.stringify(version)).toBe(before);
  });
  it("retains an explicit unpaid internal test without inventing spend", () => {
    const { version, context, detail } = setup();
    const pkg = detail.packages[0]!;
    pkg.commercialDetail = {
      schemaVersion: 2,
      revision: 4,
      creatorDisplayName: "Approved internal participant",
      channels: [],
      deliveryDeadline: null,
      usageRights: null,
      exclusivity: null,
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet response proof.",
    };
    pkg.compensationLines = [];
    detail.costLines = [];
    version.metricSnapshot.metrics.cpc.numerator = {
      status: "available",
      kind: "eligible_campaign_spend_minor",
      valueMinor: "0",
      evidenceIds: [],
    };

    const result = buildTimedCreatorEconomics(version, context, detail);
    expect(result).toMatchObject({
      allocatedSpendMinor: "0",
      unallocatedSpendMinor: "0",
      creators: [
        {
          allocation: {
            status: "not_available",
            reason: "not_included_in_issued_spend",
          },
          cpqwMinorDecimal: null,
        },
      ],
    });
  });
  it.each([
    "scope",
    "missing-path",
    "duplicate-path",
    "extra-line",
    "wrong-owner",
    "terms",
    "unknown-extra-cost",
    "current-name",
    "wrong-time",
    "wrong-rule",
  ])("rejects %s", (kind) => {
    const { version, context, detail } = setup();
    if (kind === "scope") detail.reportVersionId = context.campaignId;
    if (kind === "missing-path") detail.paths = [];
    if (kind === "duplicate-path") detail.paths.push(detail.paths[0]!);
    if (kind === "extra-line") detail.costLines.push(detail.costLines[0]!);
    if (kind === "wrong-owner")
      detail.costLines[0]!.creatorId = context.campaignId;
    if (kind === "terms")
      detail.costLines[0]!.terms = {
        ...detail.costLines[0]!.terms,
        model: "variable",
      };
    if (kind === "unknown-extra-cost") detail.additionalCosts = "unknown";
    if (kind === "current-name")
      detail.paths[0]!.creatorName = "Current renamed profile";
    if (kind === "wrong-time")
      detail.paths[0]!.conversionTime = context.measurementWindow.endedAt;
    if (kind === "wrong-rule")
      detail.paths[0]!.conversionRuleVersionId = context.campaignId;
    expect(() =>
      buildTimedCreatorEconomics(version, context, detail),
    ).toThrow();
  });
  it("keeps exclusions unavailable rather than claiming a zero fee", () => {
    const { version, context, detail } = setup();
    detail.costLines[0]!.inclusion = "excluded";
    version.metricSnapshot.metrics.cpc.numerator = {
      status: "available",
      kind: "eligible_campaign_spend_minor",
      valueMinor: "0",
      evidenceIds: [],
    };
    const result = buildTimedCreatorEconomics(version, context, detail);
    expect(result.creators[0]!.allocation).toEqual({
      status: "not_available",
      reason: "not_included_in_issued_spend",
    });
  });
  it("preserves unknown total costs and known excluded decisions", () => {
    const { version, context, detail } = setup();
    detail.additionalCosts = "unknown";
    version.metricSnapshot.metrics.cpc.numerator = {
      status: "not_available",
      kind: "eligible_campaign_spend_minor",
      reason: "source_incomplete",
    };
    expect(
      buildTimedCreatorEconomics(version, context, detail).creators[0]!
        .allocation,
    ).toEqual({ status: "not_available", reason: "spend_not_available" });
  });
  it("rejects protected extra fields", () => {
    const { version, context, detail } = setup();
    expect(() =>
      buildTimedCreatorEconomics(version, context, {
        ...detail,
        walletMappingId: context.campaignId,
      }),
    ).toThrow();
  });
});
