/** DEM-01 / RPT-02: deterministic synthetic dataset for the existing read-only app.
 * No database writes, fabricated live integrations, credentials, or provider calls.
 * This dataset is never inserted into protected commercial/report history. */
import {
  computeCampaignMetrics,
  computeCreatorEconomics,
} from "@landed/analytics";
import type { BasketRecord, CreatorDirectoryRecord } from "@landed/contracts";
import { buildReportVisualFixture } from "./reports/visual-fixtures";

export const submissionPeriod = {
  startedAt: "2026-09-28T00:00:00.000Z",
  endedAt: "2026-10-12T00:00:00.000Z",
};
export const submissionName = "Consumer launch · autumn pilot";
export const submissionDaily = [
  10, 15, 20, 25, 30, 35, 25, 20, 35, 40, 40, 40, 35, 30,
];
export const submissionRoster = [
  {
    name: "DeFi After Dark",
    handle: "@defiafterdark",
    cost: "180500",
    visits: 650,
    consent: 200,
    qualified: 100,
    audience: 78000,
    channel: "podcast" as const,
    decision: "Retain: £18.05 per qualified wallet, below the £20 target.",
  },
  {
    name: "Maya / Chain Mode",
    handle: "@chainmode",
    cost: "127500",
    visits: 850,
    consent: 300,
    qualified: 150,
    audience: 142000,
    channel: "x" as const,
    decision:
      "Prioritise a repeat test: £8.50 per qualified wallet, with the strongest visit-to-result rate.",
  },
  {
    name: "Mint Condition",
    handle: "@mintcondition",
    cost: "392000",
    visits: 1100,
    consent: 300,
    qualified: 150,
    audience: 93000,
    channel: "x" as const,
    decision:
      "Renegotiate or test another creator: £26.13 per qualified wallet exceeds the £20 target.",
  },
];
const uid = (family: number, n: number) =>
  `${String(family).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (index: number) =>
  new Date(
    Date.parse(submissionPeriod.startedAt) + index * 86400000,
  ).toISOString();

export function buildSubmissionCampaign() {
  const base = buildReportVisualFixture("ready");
  const campaign = base.campaign;
  campaign.name = submissionName;
  campaign.objective =
    "Acquire at least 350 qualified wallets at a campaign cost of £20 or less per qualified wallet.";
  campaign.outcomeProfile = {
    metric: "qualified_wallets",
    baselineUnits: "0",
    targetUnits: "350",
    currencyCode: null,
  };
  campaign.status = "finalized";
  campaign.createdAt = "2026-09-27T12:00:00.000Z";
  campaign.updatedAt = submissionPeriod.endedAt;
  campaign.roster.forEach((row, i) => {
    const source = submissionRoster[i]!;
    row.creatorName = source.name;
    row.creatorHandle = source.handle;
    row.commercialTerms.compensationLines = [
      {
        id: row.commercialTerms.compensationLines[0]!.id,
        assetType: "cash",
        model: "fixed",
        amountMinor: source.cost,
        currencyCode: "GBP",
      },
    ];
    row.createdAt = campaign.createdAt;
  });
  campaign.contentAssets.forEach((asset, i) => {
    asset.status = "published";
    asset.createdAt = campaign.createdAt;
    asset.updatedAt = day(i);
    const visits = submissionRoster[i]!.visits;
    asset.trackedLinks = [
      {
        id: uid(98000008, i + 1),
        generationRequestId: uid(98000009, i + 1),
        destinationUrl: "https://example.test/synthetic-onboarding",
        destinationPolicyActive: false,
        keyVersion: 1,
        issuedBy: campaign.createdBy,
        issuedAt: campaign.createdAt,
        expiresAt: submissionPeriod.endedAt,
        clickEvidence: {
          eligibleRedirects: visits,
          ineligibleAttempts: 0,
          totalAttempts: visits,
          firstObservedAt: day(i),
          lastObservedAt: new Date(
            Date.parse(submissionPeriod.endedAt) - 1,
          ).toISOString(),
        },
        clickQuality: {
          ruleVersion: 1,
          duplicateWindowSeconds: 1800,
          qualifiedClicks: visits,
          duplicateClicks: 0,
          rejectedClicks: 0,
          totalAssessed: visits,
          pendingAssessment: 0,
          firstAssessedAt: day(i),
          lastAssessedAt: new Date(
            Date.parse(submissionPeriod.endedAt) - 1,
          ).toISOString(),
        },
        anonymousSessions: {
          sessions: visits,
          boundClicks: visits,
          firstCreatedAt: day(i),
          lastSeenAt: new Date(
            Date.parse(submissionPeriod.endedAt) - 1,
          ).toISOString(),
        },
        revocation: null,
      },
    ];
    asset.submissionUrl = null;
    asset.publishedUrl = null;
    asset.publicationEvidence = [];
    asset.label = [
      "Product introduction and founder interview",
      "Product walkthrough and follow-up thread",
      "Onboarding tutorial and community Q&A",
    ][i]!;
  });
  campaign.roster.forEach((row, i) => {
    row.deliverableSummary = campaign.contentAssets[i]!.label;
  });
  campaign.briefVersions = [
    {
      id: uid(98000001, 1),
      version: 1,
      requestId: uid(98000002, 1),
      status: "approved",
      objective: campaign.objective,
      audience: "Solana consumers trying a new application for the first time.",
      keyMessage:
        "Understand the product, try its onboarding, and complete your first qualifying action.",
      creatorDirection:
        "Explain the product in your own voice. Use your assigned link and describe the optional measurement step clearly.",
      complianceNotes:
        "Synthetic campaign. No real creator booking, publication, wallet consent or commercial performance is claimed.",
      reason: "Synthetic approved brief for prototype review",
      actorUserId: campaign.createdBy,
      createdAt: campaign.createdAt,
    },
  ];
  let offset = 0;
  const paths = campaign.roster.flatMap((row, i) =>
    Array.from({ length: submissionRoster[i]!.qualified }, (_, n) => {
      const index = offset++;
      let cumulative = 0;
      const d = submissionDaily.findIndex((v) => {
        cumulative += v;
        return index < cumulative;
      });
      const at = new Date(
        Date.parse(day(d)) + 12 * 3600000 + (n % 60) * 60000,
      ).toISOString();
      return {
        ...base.rankingEvidencePaths[0]!,
        metric: "qualified_wallets" as const,
        attributionFactId: uid(91000001, index + 1),
        conversionFactId: uid(91000002, index + 1),
        clickEventId: uid(91000003, index + 1),
        canonicalChainEventId: uid(91000004, index + 1),
        creatorId: row.creatorId,
        creatorName: row.creatorName,
        contentAssetId: campaign.contentAssets[i]!.id,
        contentAssetLabel: campaign.contentAssets[i]!.label,
        confidence: "strong" as const,
        primaryRoasEligible: true,
        touchTime: new Date(Date.parse(at) - 3600000).toISOString(),
        conversionTime: at,
        eventTime: at,
        transactionSignature: `synthetic-${index + 1}`,
        rawAmount: "1",
        environment: "demo" as const,
      };
    }),
  );
  const version = base.selectedVersion;
  version.version = 1;
  version.campaignName = submissionName;
  version.issuedAt = submissionPeriod.endedAt;
  const lines = campaign.roster
    .flatMap((row) => row.commercialTerms.compensationLines)
    .map((line) => ({
      id: line.id,
      kind: "creator_compensation" as const,
      amountMinor: line.assetType === "cash" ? line.amountMinor : "0",
      inclusion: "included" as const,
      exclusionReason: null,
      sourceEvidenceId: line.id,
    }));
  version.metricSnapshot = computeCampaignMetrics({
    id: version.metricSnapshot.id,
    workspaceId: campaign.workspaceId,
    projectId: campaign.projectId,
    campaignId: campaign.id,
    currencyCode: "GBP",
    valuationPolicy: {
      id: "synthetic-campaign-costs",
      version: 1,
      description: "Synthetic creator fees; no payments made",
      currencyCode: "GBP",
      valuedAt: submissionPeriod.endedAt,
    },
    conversionRuleVersionIds: [paths[0]!.conversionRuleVersionId],
    attributionClassifierVersion: 1,
    sourceTimeRange: submissionPeriod,
    dataFreshness: {
      dataThrough: submissionPeriod.endedAt,
      calculatedAt: submissionPeriod.endedAt,
    },
    spend: { status: "complete", lines },
    qualifiedClicks: {
      status: "complete",
      evidenceIds: Array.from({ length: 2600 }, (_, i) => uid(91000005, i + 1)),
    },
    qualifiedWallets: {
      status: "complete",
      evidenceIds: paths.map((p) => p.attributionFactId),
    },
    activatedWallets: {
      status: "not_available",
      reason: "source_not_configured",
    },
    activationDefinition: {
      ruleVersionId: paths[0]!.conversionRuleVersionId,
      label: "Activation not measured in this prototype",
    },
    protocolRevenue: {
      status: "not_available",
      reason: "source_not_configured",
    },
  });
  version.measurementContext!.observations = submissionDaily.map(
    (value, i) => ({
      id: uid(91000006, i + 1),
      metric: "qualified_wallets" as const,
      periodStartedAt: day(i),
      periodEndedAt: day(i + 1),
      observedThrough: day(i + 1),
      periodState: "complete" as const,
      status: "available" as const,
      valueDecimal: String(
        submissionDaily.slice(0, i + 1).reduce((a, b) => a + b, 0),
      ),
      unavailableReason: null,
      sourceEvidenceIds: paths
        .filter((p) => p.eventTime < day(i + 1))
        .map((p) => p.attributionFactId),
    }),
  );
  version.measurementContext!.issuedAt = submissionPeriod.endedAt;
  version.measurementContext!.benchmarks = [];
  const report = {
    ...base.report,
    createdAt: version.issuedAt,
    versions: [version],
  };
  const economics = computeCreatorEconomics({
    currencyCode: "GBP",
    eligibleSpend: {
      status: "available",
      valueMinor: "700000",
      evidenceIds: lines.map((l) => l.id),
      evidenceLines: lines.map((l) => ({
        id: l.id,
        kind: "creator_compensation",
        valueMinor: l.amountMinor,
        currencyCode: "GBP",
      })),
    },
    qualifiedAttribution: {
      status: "available",
      evidenceIds: paths.map((p) => p.attributionFactId),
    },
    activatedAttribution: {
      status: "not_available",
      reason: "source_not_configured",
    },
    creators: campaign.roster.map((row) => ({
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      creatorHandle: row.creatorHandle,
      package: row.commercialTerms,
      qualifiedAttributionIds: paths
        .filter((p) => p.creatorId === row.creatorId)
        .map((p) => p.attributionFactId),
      activatedAttributionIds: [],
      confidence: "strong",
      contentAssets: [],
    })),
  });
  const basket: BasketRecord = {
    id: campaign.basketId,
    workspaceId: campaign.workspaceId,
    projectId: campaign.projectId,
    name: submissionName,
    objective: campaign.objective,
    outcomeProfile: campaign.outcomeProfile,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    latestApproval: {
      id: campaign.commercialPlanVersionId,
      scenarioId: uid(98000003, 1),
      scenarioCode: "A",
      scenarioName: "Three-creator pilot",
      version: 1,
      approvedBy: campaign.createdBy,
      approvedAt: campaign.createdAt,
      reason: "Synthetic approval state for prototype review",
      snapshotHash: "0".repeat(64),
    },
    latestApprovalIsCurrent: true,
    scenarios: (["A", "B", "C"] as const).map((code, i) => ({
      id: uid(98000003, i + 1),
      code,
      name: i === 0 ? "Three-creator pilot" : `Alternative ${code}`,
      packageIds: i === 0 ? campaign.roster.map((r) => r.sourcePackageId) : [],
    })),
    packages: campaign.roster.map((row, i) => ({
      id: row.sourcePackageId,
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      creatorHandle: row.creatorHandle,
      audience: {
        size: submissionRoster[i]!.audience,
        channelType: submissionRoster[i]!.channel,
        observedAt: campaign.createdAt,
        sourceLabel: "Synthetic audience",
      },
      packageLabel: row.packageLabel,
      deliverableSummary: campaign.contentAssets[i]!.label,
      sourceRateQuoteId: null,
      commercialDetailRevision: 1,
      commercialDetail: {
        schemaVersion: 2,
        channelIds: [uid(98000004, i + 1)],
        deliveryDeadline: submissionPeriod.endedAt,
        usageRights: "Organic reposts for 30 days",
        exclusivity: "No direct competitors during the campaign",
        commercialBasis: "compensated",
        unpaidReason: null,
      },
      availableChannels: [
        {
          id: uid(98000004, i + 1),
          channelType: submissionRoster[i]!.channel,
          handle: row.creatorHandle!,
          isPrimary: true,
        },
      ],
      compensationLines: row.commercialTerms.compensationLines.map((line) => ({
        ...line,
        variableUnit: null,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
      })),
    })),
  };
  const creators: CreatorDirectoryRecord[] = campaign.roster.map((row, i) => ({
    id: row.creatorId,
    workspaceId: campaign.workspaceId,
    projectId: campaign.projectId,
    displayName: row.creatorName,
    relationshipStatus: "active",
    countryCode: i === 2 ? "US" : "GB",
    languageCodes: ["en"],
    channels: [
      {
        id: uid(98000004, i + 1),
        type: submissionRoster[i]!.channel,
        handle: row.creatorHandle!,
        profileUrl: null,
        languageCode: "en",
        audienceSize: submissionRoster[i]!.audience,
        observedAt: campaign.createdAt,
        sourceLabel: "Synthetic audience",
        isPrimary: true,
      },
    ],
    tags: [
      { id: uid(98000005, 1), name: "Consumer", slug: "consumer" },
      { id: uid(98000005, 2), name: "Solana", slug: "solana" },
    ],
    currentRate: {
      id: uid(98000007, i + 1),
      packageLabel: row.packageLabel,
      deliverableSummary: campaign.contentAssets[i]!.label,
      amountMinor: submissionRoster[i]!.cost,
      currencyCode: "GBP",
      quotedAt: campaign.createdAt,
      validUntil: null,
      sourceLabel: "Synthetic campaign fee",
    },
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  }));
  return {
    submissionContext: {
      consentingWallets: submissionRoster.reduce(
        (sum, row) => sum + row.consent,
        0,
      ),
      targetCpqw: "20",
    },
    campaign,
    basket,
    creators,
    report,
    selectedVersion: version,
    rankingEvidencePaths: paths,
    economics: { "1": economics },
  };
}
