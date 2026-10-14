import { computeCampaignMetrics } from "@landed/analytics";
import type { CampaignRecord } from "@landed/contracts";
import type { ProjectReport, ProjectReportEvidencePath } from "@landed/db";

export const reportVisualStates = [
  "ready",
  "loading",
  "empty",
  "partial",
  "stale",
  "error",
  "permission",
] as const;

export type ReportVisualState = (typeof reportVisualStates)[number];

type FixtureEnvironment = {
  explicitFlag?: string;
  nodeEnv?: string;
  vercelEnv?: string;
};

const ids = {
  campaign: "30000000-0000-4000-8000-000000000061",
  project: "20000000-0000-4000-8000-000000000001",
  report: "60000000-0000-4000-8000-000000000061",
  rule: "50000000-0000-4000-8000-000000000061",
  snapshotCurrent: "40000000-0000-4000-8000-000000000062",
  snapshotPrevious: "40000000-0000-4000-8000-000000000061",
  versionCurrent: "70000000-0000-4000-8000-000000000062",
  versionPrevious: "70000000-0000-4000-8000-000000000061",
  workspace: "10000000-0000-4000-8000-000000000001",
  creatorOne: "91000000-0000-4000-8000-000000000061",
  creatorTwo: "91000000-0000-4000-8000-000000000062",
  creatorThree: "91000000-0000-4000-8000-000000000063",
  campaignCreatorOne: "92000000-0000-4000-8000-000000000061",
  campaignCreatorTwo: "92000000-0000-4000-8000-000000000062",
  campaignCreatorThree: "92000000-0000-4000-8000-000000000063",
  packageOne: "93000000-0000-4000-8000-000000000061",
  packageTwo: "93000000-0000-4000-8000-000000000062",
  packageThree: "93000000-0000-4000-8000-000000000063",
  compensationOne: "94000000-0000-4000-8000-000000000061",
  compensationTwo: "94000000-0000-4000-8000-000000000062",
  compensationThree: "94000000-0000-4000-8000-000000000063",
  assetOne: "95000000-0000-4000-8000-000000000061",
  assetTwo: "95000000-0000-4000-8000-000000000062",
  assetThree: "95000000-0000-4000-8000-000000000063",
} as const;

const visualCreatorThumbnail =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 720 480'%3E%3Crect width='720' height='480' fill='%23161616'/%3E%3Ccircle cx='570' cy='110' r='170' fill='%23FF462E'/%3E%3Cpath d='M0 390L230 170 470 480H0Z' fill='%23009DFF'/%3E%3Ctext x='42' y='82' fill='white' font-family='sans-serif' font-size='34' font-weight='700'%3EHELIOS / FOUNDER SIGNAL%3C/text%3E%3C/svg%3E";

export function isReportVisualState(value: string): value is ReportVisualState {
  return reportVisualStates.some((state) => state === value);
}

export function reportVisualFixturesEnabled({
  explicitFlag,
  nodeEnv,
  vercelEnv,
}: FixtureEnvironment) {
  if (vercelEnv === "production") return false;
  return (
    nodeEnv === "development" || vercelEnv === "preview" || explicitFlag === "1"
  );
}

function buildMetricSnapshot({
  current,
  unavailable,
}: {
  current: boolean;
  unavailable: boolean;
}) {
  const snapshotId = current ? ids.snapshotCurrent : ids.snapshotPrevious;
  const sourceEndedAt = current
    ? "2026-08-13T12:00:00.000Z"
    : "2026-08-12T12:00:00.000Z";
  const dataThrough = current
    ? "2026-08-13T11:55:00.000Z"
    : "2026-08-12T11:55:00.000Z";
  const clickCount = current ? 24 : 17;
  const qualifiedWalletCount = current ? 7 : 4;
  const activatedWalletCount = current ? 4 : 2;
  const currentAttributionIds = [
    ...Array.from(
      { length: 4 },
      (_, index) =>
        `a1${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
    ),
    ...Array.from(
      { length: 2 },
      (_, index) =>
        `a2${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
    ),
    "a3010000-0000-4000-8000-000000000061",
  ];
  const previousAttributionIds = Array.from(
    { length: qualifiedWalletCount },
    (_, index) =>
      `e${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
  );

  return computeCampaignMetrics({
    id: snapshotId,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    currencyCode: "GBP",
    valuationPolicy: {
      id: "approved-campaign-ledger",
      version: 1,
      description: "Approved campaign ledger in GBP",
      currencyCode: "GBP",
      valuedAt: sourceEndedAt,
    },
    conversionRuleVersionIds: [ids.rule],
    attributionClassifierVersion: 1,
    sourceTimeRange: {
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: sourceEndedAt,
    },
    dataFreshness: {
      dataThrough,
      calculatedAt: sourceEndedAt,
    },
    spend: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          lines: [
            [ids.compensationOne, current ? "240000" : "220000"],
            [ids.compensationTwo, current ? "160000" : "150000"],
            [ids.compensationThree, current ? "100000" : "90000"],
          ].map(([id, amountMinor]) => ({
            id,
            kind: "creator_compensation" as const,
            amountMinor,
            inclusion: "included" as const,
            exclusionReason: null,
            sourceEvidenceId: id,
          })),
        },
    qualifiedClicks: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          evidenceIds: Array.from(
            { length: clickCount },
            (_, index) =>
              `visual-click:${current ? "current" : "previous"}:${index + 1}`,
          ),
        },
    qualifiedWallets: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          evidenceIds: current ? currentAttributionIds : previousAttributionIds,
        },
    activatedWallets: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          evidenceIds: current
            ? [
                currentAttributionIds[0]!,
                currentAttributionIds[1]!,
                currentAttributionIds[4]!,
                currentAttributionIds[6]!,
              ]
            : previousAttributionIds.slice(0, activatedWalletCount),
        },
    activationDefinition: {
      ruleVersionId: ids.rule,
      label: "First qualifying transaction",
    },
    protocolRevenue: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          lines: [
            {
              id: current
                ? "82000000-0000-4000-8000-000000000062"
                : "82000000-0000-4000-8000-000000000061",
              attributionEvidenceId: current
                ? "visual-attribution-current"
                : "visual-attribution-previous",
              sourceRevenueEvidenceId: current
                ? "visual-revenue-evidence-current"
                : "visual-revenue-evidence-previous",
              confidence: "strong",
              protocolRevenueMinor: current ? "620000" : "520000",
            },
          ],
        },
  });
}

function buildMeasurementContext(unavailable: boolean) {
  const qualifiedValues = [1, 3, 5, 7];
  const activatedValues = [0, 1, 2, 4];
  const observations = qualifiedValues.flatMap((qualified, index) => {
    const day = 10 + index;
    const finalPeriod = index === qualifiedValues.length - 1;
    const periodStartedAt = `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;
    const periodEndedAt = `2026-08-${String(day + 1).padStart(2, "0")}T00:00:00.000Z`;
    const observedThrough = finalPeriod
      ? "2026-08-13T11:55:00.000Z"
      : periodEndedAt;

    return (
      [
        ["qualified_wallets", qualified, 1],
        ["activated_wallets", activatedValues[index]!, 2],
      ] as const
    ).map(([metric, value, metricIndex]) => ({
      id: `83000000-0000-4000-8${index}${metricIndex}0-000000000001`,
      metric,
      periodStartedAt,
      periodEndedAt,
      observedThrough,
      periodState: finalPeriod ? ("partial" as const) : ("complete" as const),
      status: unavailable ? ("not_available" as const) : ("available" as const),
      valueDecimal: unavailable ? null : String(value),
      unavailableReason: unavailable ? "source_not_configured" : null,
      sourceEvidenceIds: unavailable
        ? []
        : Array.from(
            { length: value },
            (_, evidenceIndex) =>
              `86000000-0000-4000-8${metricIndex}${String(evidenceIndex).padStart(2, "0")}-000000000001`,
          ),
    }));
  });

  return {
    id: "84000000-0000-4000-8000-000000000001",
    issuedAt: "2026-08-13T12:02:00.000Z",
    issuedBy: "90000000-0000-4000-8000-000000000061",
    payloadSha256: "e".repeat(64),
    observations,
    benchmarks: [
      {
        id: "85000000-0000-4000-8000-000000000001",
        kind: "approved_target" as const,
        metric: "qualified_wallets" as const,
        label: "Approved campaign target",
        sourceLabel: "Commercial plan approval / 01 Aug",
        status: "available" as const,
        valueDecimal: "12",
        unavailableReason: null,
        sourceStartedAt: null,
        sourceEndedAt: null,
        approvedAt: "2026-08-01T00:00:00.000Z",
        cohortSampleSize: null,
      },
      {
        id: "85000000-0000-4000-8000-000000000003",
        kind: "portfolio_cohort" as const,
        metric: "qualified_wallets" as const,
        label: "Comparable launch cohort",
        sourceLabel: "Retained cohort result not configured",
        status: "not_available" as const,
        valueDecimal: null,
        unavailableReason: "source_not_configured",
        sourceStartedAt: null,
        sourceEndedAt: null,
        approvedAt: null,
        cohortSampleSize: null,
      },
    ],
  };
}

function buildVisualCampaign(): CampaignRecord {
  const roster = [
    {
      id: ids.campaignCreatorOne,
      creatorId: ids.creatorOne,
      creatorName: "DeFi After Dark",
      creatorHandle: "@defiafterdark",
      sourcePackageId: ids.packageOne,
      rosterPosition: 1,
      packageLabel: "Podcast package",
      deliverableSummary: "One host-read integration and one founder interview",
      amountMinor: "240000",
    },
    {
      id: ids.campaignCreatorTwo,
      creatorId: ids.creatorTwo,
      creatorName: "Maya / Chain Mode",
      creatorHandle: "@chainmode",
      sourcePackageId: ids.packageTwo,
      rosterPosition: 2,
      packageLabel: "Launch package",
      deliverableSummary: "One X thread and one short-form video",
      amountMinor: "160000",
    },
    {
      id: ids.campaignCreatorThree,
      creatorId: ids.creatorThree,
      creatorName: "Mint Condition",
      creatorHandle: "@mintcondition",
      sourcePackageId: ids.packageThree,
      rosterPosition: 3,
      packageLabel: "Community package",
      deliverableSummary: "One X thread and one community activation",
      amountMinor: "100000",
    },
  ].map((creator, index) => ({
    id: creator.id,
    creatorId: creator.creatorId,
    creatorName: creator.creatorName,
    creatorHandle: creator.creatorHandle,
    sourcePackageId: creator.sourcePackageId,
    rosterPosition: creator.rosterPosition,
    packageLabel: creator.packageLabel,
    deliverableSummary: creator.deliverableSummary,
    commercialTerms: {
      id: creator.sourcePackageId,
      creatorId: creator.creatorId,
      packageLabel: creator.packageLabel,
      deliverableSummary: creator.deliverableSummary,
      compensationLines: [
        {
          id: [ids.compensationOne, ids.compensationTwo, ids.compensationThree][
            index
          ]!,
          assetType: "cash" as const,
          model: "fixed" as const,
          amountMinor: creator.amountMinor,
          currencyCode: "GBP" as const,
        },
      ],
    },
    termsHash: String(index + 1).repeat(64),
    createdAt: "2026-08-01T09:00:00.000Z",
  }));

  const assets = roster.map((creator, index) => {
    const publishedUrl = [
      "https://x.com/defiafterdark/status/1",
      "https://x.com/chainmode/status/2",
      null,
    ][index]!;
    return {
      id: [ids.assetOne, ids.assetTwo, ids.assetThree][index]!,
      campaignCreatorId: creator.id,
      creatorId: creator.creatorId,
      assetIndex: 1,
      label: [
        "Founder interview launch clip",
        "Launch thesis thread",
        "Community activation",
      ][index]!,
      status: (publishedUrl ? "published" : "approved") as
        "published" | "approved",
      submissionUrl: publishedUrl,
      publishedUrl,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      publicationEvidence: publishedUrl
        ? [
            {
              id: `96000000-0000-4000-8000-00000000006${index + 1}`,
              requestId: `97000000-0000-4000-8000-00000000006${index + 1}`,
              version: 1,
              platform: "x" as const,
              publishedUrl,
              publishedAt: "2026-08-10T12:00:00.000Z",
              thumbnailStatus:
                index === 0
                  ? ("available" as const)
                  : ("not_available" as const),
              thumbnailUrl: index === 0 ? visualCreatorThumbnail : null,
              thumbnailUnavailableReason: index === 0 ? null : "not_captured",
              sourceLabel: "Sanitized publication monitor",
              observedAt: "2026-08-10T12:05:00.000Z",
              createdAt: "2026-08-10T12:05:00.000Z",
            },
          ]
        : [],
      trackedLinks: [],
      activity: [],
    };
  });

  return {
    id: ids.campaign,
    workspaceId: ids.workspace,
    projectId: ids.project,
    basketId: "98000000-0000-4000-8000-000000000061",
    commercialPlanVersionId: "98000000-0000-4000-8000-000000000062",
    commercialPlanVersion: 1,
    name: "Helios Mobile Roster",
    objective: "Grow qualified wallets through creator-led education",
    outcomeProfile: {
      metric: "qualified_wallets",
      baselineUnits: "0",
      targetUnits: "12",
      currencyCode: null,
    },
    status: "live",
    createdBy: "90000000-0000-4000-8000-000000000061",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
    roster,
    briefVersions: [],
    contentAssets: assets,
    activity: [],
  };
}

function buildVisualEvidencePaths(): ProjectReportEvidencePath[] {
  const creators = [
    [
      ids.creatorOne,
      "DeFi After Dark",
      ids.assetOne,
      "Founder interview launch clip",
      4,
      2,
    ],
    [
      ids.creatorTwo,
      "Maya / Chain Mode",
      ids.assetTwo,
      "Launch thesis thread",
      2,
      1,
    ],
    [
      ids.creatorThree,
      "Mint Condition",
      ids.assetThree,
      "Community activation",
      1,
      1,
    ],
  ] as const;

  return creators.flatMap(
    (
      [
        creatorId,
        creatorName,
        contentAssetId,
        contentAssetLabel,
        qualified,
        activated,
      ],
      creatorIndex,
    ) => {
      const qualifiedPaths = Array.from({ length: qualified }, (_, index) => ({
        reportVersionId: ids.versionCurrent,
        metricSnapshotId: ids.snapshotCurrent,
        metric: "qualified_wallets" as const,
        attributionFactId: `a${creatorIndex + 1}${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
        confidence:
          index < activated ? ("strong" as const) : ("indicative" as const),
        primaryRoasEligible: index < activated,
        attributionModel: "last_eligible_creator_touch" as const,
        attributionWindowSeconds: 604800 as const,
        touchTime: "2026-08-10T12:00:00.000Z",
        creatorId,
        creatorName,
        contentAssetId,
        contentAssetLabel,
        clickEventId: `b${creatorIndex + 1}${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
        clickQuality: "qualified" as const,
        walletProofState: "signed_nonce_and_consent" as const,
        conversionFactId: `c${creatorIndex + 1}${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
        conversionTime: "2026-08-11T12:00:00.000Z",
        conversionRuleVersionId: ids.rule,
        conversionRuleVersion: 1,
        conversionRuleName: "First qualifying transaction",
        conversionRuleTemplate: "first_qualifying_transaction" as const,
        conversionEvaluatorVersion: 1 as const,
        valueKind: "native_lamports" as const,
        rawAmount: "10000000",
        decimals: 9,
        tokenMint: null,
        canonicalChainEventId: `d${creatorIndex + 1}${String(index + 1).padStart(2, "0")}0000-0000-4000-8000-000000000061`,
        transactionSignature: "5".repeat(88),
        transactionSlot: String(358040003 + creatorIndex * 10 + index),
        instructionIndex: null,
        eventName: "solana.native_transfer" as const,
        eventTime: "2026-08-11T12:00:00.000Z",
        finality: "finalized" as const,
        environment: "demo" as const,
        revenueKind: "none" as const,
      }));
      return [
        ...qualifiedPaths,
        ...qualifiedPaths.slice(0, activated).map((path) => ({
          ...path,
          metric: "activated_wallets" as const,
        })),
      ];
    },
  );
}

export function buildReportVisualFixture(
  state: Extract<ReportVisualState, "ready" | "partial" | "stale">,
) {
  const unavailable = state === "partial";
  const currentIssuedAt =
    state === "stale" ? "2026-08-15T12:00:00.000Z" : "2026-08-13T12:00:00.000Z";
  const currentVersion = {
    id: ids.versionCurrent,
    version: 2,
    issuedAt: currentIssuedAt,
    issuedBy: "90000000-0000-4000-8000-000000000061",
    payloadSha256: "a".repeat(64),
    campaignName: "Helios Mobile Roster",
    attributionModel: "last_eligible_creator_touch" as const,
    attributionWindowSeconds: 604800 as const,
    metricSnapshotSha256: "b".repeat(64),
    metricSnapshot: buildMetricSnapshot({ current: true, unavailable }),
    measurementContext: buildMeasurementContext(unavailable),
  };
  const previousVersion = {
    id: ids.versionPrevious,
    version: 1,
    issuedAt: "2026-08-12T12:00:00.000Z",
    issuedBy: "90000000-0000-4000-8000-000000000061",
    payloadSha256: "c".repeat(64),
    campaignName: "Helios Mobile Roster",
    attributionModel: "last_eligible_creator_touch" as const,
    attributionWindowSeconds: 604800 as const,
    metricSnapshotSha256: "d".repeat(64),
    metricSnapshot: buildMetricSnapshot({ current: false, unavailable }),
    measurementContext: null,
  };
  const report = {
    id: ids.report,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    createdAt: previousVersion.issuedAt,
    versions: [currentVersion, previousVersion],
  } satisfies ProjectReport;

  return {
    campaign: buildVisualCampaign(),
    comparisonVersion: previousVersion,
    rankingEvidencePaths: unavailable ? [] : buildVisualEvidencePaths(),
    report,
    selectedVersion: currentVersion,
  };
}
