import { computeCampaignMetrics } from "@landed/analytics";
import type { CampaignRecord } from "@landed/contracts";
import type { ProjectReport, ProjectReportEvidencePath } from "@landed/db";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import {
  PerformanceReport,
  ReportLoadingState,
  ReportPermission,
  ReportRecoverableError,
  ReportVersionUnavailable,
  ReportsEmpty,
} from "./performance-report";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  campaign: "30000000-0000-4000-8000-000000000001",
  snapshot: "40000000-0000-4000-8000-000000000001",
  rule: "50000000-0000-4000-8000-000000000001",
  report: "60000000-0000-4000-8000-000000000001",
  version: "70000000-0000-4000-8000-000000000001",
  attribution: "71000000-0000-4000-8000-000000000001",
  conversion: "72000000-0000-4000-8000-000000000001",
  creator: "73000000-0000-4000-8000-000000000001",
  asset: "74000000-0000-4000-8000-000000000001",
  click: "75000000-0000-4000-8000-000000000001",
  chainEvent: "76000000-0000-4000-8000-000000000001",
  basket: "77000000-0000-4000-8000-000000000001",
  commercialPlan: "78000000-0000-4000-8000-000000000001",
  campaignCreator: "79000000-0000-4000-8000-000000000001",
  package: "80000000-0000-4000-8000-000000000001",
  compensationLine: "81000000-0000-4000-8000-000000000001",
};

const evidencePath: ProjectReportEvidencePath = {
  reportVersionId: ids.version,
  metricSnapshotId: ids.snapshot,
  metric: "qualified_wallets",
  attributionFactId: ids.attribution,
  confidence: "strong",
  primaryRoasEligible: true,
  attributionModel: "last_eligible_creator_touch",
  attributionWindowSeconds: 604800,
  touchTime: "2026-08-10T12:00:00.000Z",
  creatorId: ids.creator,
  creatorName: "Ava Sol",
  contentAssetId: ids.asset,
  contentAssetLabel: "Launch thread",
  clickEventId: ids.click,
  clickQuality: "qualified",
  walletProofState: "signed_nonce_and_consent",
  conversionFactId: ids.conversion,
  conversionTime: "2026-08-11T12:00:00.000Z",
  conversionRuleVersionId: ids.rule,
  conversionRuleVersion: 2,
  conversionRuleName: "First qualifying transaction",
  conversionRuleTemplate: "first_qualifying_transaction",
  conversionEvaluatorVersion: 1,
  valueKind: "native_lamports",
  rawAmount: "250000000",
  decimals: 9,
  tokenMint: null,
  canonicalChainEventId: ids.chainEvent,
  transactionSignature: "5".repeat(88),
  instructionIndex: null,
  eventName: "solana.native_transfer",
  finality: "finalized",
  eventTime: "2026-08-11T12:00:00.000Z",
  transactionSlot: "345678901",
  environment: "demo",
};

function metricSnapshot(unavailable = false) {
  return computeCampaignMetrics({
    id: ids.snapshot,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    currencyCode: "GBP",
    valuationPolicy: {
      id: "approved-campaign-ledger",
      version: 1,
      description: "Approved campaign ledger in GBP",
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
    spend: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          lines: [
            {
              id: ids.compensationLine,
              kind: "creator_compensation",
              amountMinor: "10000",
              inclusion: "included",
              exclusionReason: null,
              sourceEvidenceId: ids.compensationLine,
            },
          ],
        },
    qualifiedClicks: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : { status: "complete", evidenceIds: ["click:1", "click:2"] },
    qualifiedWallets: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : { status: "complete", evidenceIds: [ids.attribution] },
    activatedWallets: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : { status: "complete", evidenceIds: [ids.attribution] },
    activationDefinition: { ruleVersionId: ids.rule, label: "Funded account" },
    protocolRevenue: unavailable
      ? { status: "not_available", reason: "source_not_configured" }
      : {
          status: "complete",
          lines: [
            {
              id: "82000000-0000-4000-8000-000000000001",
              attributionEvidenceId: "attribution:verified:1",
              sourceRevenueEvidenceId: "revenue:verified:1",
              confidence: "verified",
              protocolRevenueMinor: "20000",
            },
            {
              id: "82000000-0000-4000-8000-000000000002",
              attributionEvidenceId: "attribution:indicative:1",
              sourceRevenueEvidenceId: "revenue:indicative:1",
              confidence: "indicative",
              protocolRevenueMinor: "9000",
            },
          ],
        },
  });
}

function campaign(): CampaignRecord {
  return {
    id: ids.campaign,
    workspaceId: ids.workspace,
    projectId: ids.project,
    basketId: ids.basket,
    commercialPlanVersionId: ids.commercialPlan,
    commercialPlanVersion: 1,
    name: "Summer activation",
    objective: "Qualify retained wallets",
    outcomeProfile: {
      metric: "qualified_wallets",
      baselineUnits: "0",
      targetUnits: "10",
      currencyCode: null,
    },
    status: "finalized",
    createdBy: "90000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
    roster: [
      {
        id: ids.campaignCreator,
        creatorId: ids.creator,
        creatorName: "Ava Sol",
        creatorHandle: "@avasol",
        sourcePackageId: ids.package,
        rosterPosition: 1,
        packageLabel: "Launch package",
        deliverableSummary: "One launch thread",
        commercialTerms: {
          id: ids.package,
          creatorId: ids.creator,
          packageLabel: "Launch package",
          deliverableSummary: "One launch thread",
          compensationLines: [
            {
              id: ids.compensationLine,
              assetType: "cash",
              model: "fixed",
              amountMinor: "10000",
              currencyCode: "GBP",
            },
          ],
        },
        termsHash: "c".repeat(64),
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    briefVersions: [],
    contentAssets: [
      {
        id: ids.asset,
        campaignCreatorId: ids.campaignCreator,
        creatorId: ids.creator,
        assetIndex: 1,
        label: "Launch thread",
        status: "published",
        submissionUrl: "https://x.com/avasol/status/1",
        publishedUrl: "https://x.com/avasol/status/1",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z",
        publicationEvidence: [
          {
            id: "83000000-0000-4000-8000-000000000001",
            requestId: "84000000-0000-4000-8000-000000000001",
            version: 2,
            platform: "x",
            publishedUrl: "https://x.com/avasol/status/1",
            publishedAt: "2026-08-10T12:00:00.000Z",
            thumbnailStatus: "available",
            thumbnailUrl: "https://images.example.com/launch-v2.jpg",
            thumbnailUnavailableReason: null,
            sourceLabel: "Later media enrichment",
            observedAt: "2026-08-14T12:00:00.000Z",
            createdAt: "2026-08-14T12:00:00.000Z",
          },
          {
            id: "82000000-0000-4000-8000-000000000001",
            requestId: "83000000-0000-4000-8000-000000000002",
            version: 1,
            platform: "x",
            publishedUrl: "https://x.com/avasol/status/1",
            publishedAt: "2026-08-10T12:00:00.000Z",
            thumbnailStatus: "available",
            thumbnailUrl: "https://images.example.com/launch.jpg",
            thumbnailUnavailableReason: null,
            sourceLabel: "Campaign publication workflow",
            observedAt: "2026-08-10T12:00:00.000Z",
            createdAt: "2026-08-10T12:00:00.000Z",
          },
        ],
        trackedLinks: [],
        activity: [],
      },
    ],
    activity: [],
  };
}

function report(unavailable = false): ProjectReport {
  const version = {
    id: ids.version,
    version: 1,
    issuedAt: "2026-08-13T12:00:00.000Z",
    issuedBy: "90000000-0000-4000-8000-000000000001",
    payloadSha256: "a".repeat(64),
    campaignName: "Summer activation",
    attributionModel: "last_eligible_creator_touch" as const,
    attributionWindowSeconds: 604800 as const,
    metricSnapshotSha256: "b".repeat(64),
    metricSnapshot: metricSnapshot(unavailable),
    measurementContext: null,
  };

  return {
    id: ids.report,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    createdAt: version.issuedAt,
    versions: [version],
  };
}

function comparableReport(): ProjectReport {
  const value = report();
  const selected = value.versions[0]!;
  selected.version = 2;
  const previous = structuredClone(selected);
  previous.id = "70000000-0000-4000-8000-000000000002";
  previous.version = 1;
  previous.issuedAt = "2026-08-12T12:00:00.000Z";
  previous.metricSnapshot.id = "40000000-0000-4000-8000-000000000002";
  const previousMetrics = previous.metricSnapshot.metrics;
  if (
    previousMetrics.cpqw.denominator.status !== "available" ||
    previousMetrics.cpa.denominator.status !== "available" ||
    previousMetrics.revenueRoas.numerator.status !== "available"
  ) {
    throw new Error("Comparable fixture metrics must be available");
  }
  previousMetrics.cpqw.denominator.value = 0;
  previousMetrics.cpa.denominator.value = 0;
  previousMetrics.revenueRoas.numerator.valueMinor = "10000";
  value.versions = [selected, previous];
  return value;
}

describe("performance report", () => {
  beforeEach(() => replace.mockReset());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders primary revenue separately from excluded and influenced value", () => {
    const value = report();
    render(
      <PerformanceReport
        campaign={campaign()}
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(
      screen.getByText("£200 PRIMARY REVENUE. 2.00× REVENUE ROAS."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("£200").length).toBeGreaterThan(0);
    expect(screen.getByText("£90")).toBeInTheDocument();
    expect(screen.getByText("STALE AT ISSUE")).toBeInTheDocument();
    const volume = screen
      .getByText("VALUE / INFLUENCED VOLUME")
      .closest("section");
    expect(volume).not.toBeNull();
    expect(within(volume!).getByText("NOT AVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("EVIDENCE INCOMPLETE")).toBeInTheDocument();
    expect(
      screen.getByText(/Protected wallet addresses are never shown/),
    ).toBeInTheDocument();
  });

  it("keeps incomplete evidence unknown instead of converting it to zero", () => {
    const value = report(true);
    render(
      <PerformanceReport
        campaign={campaign()}
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(screen.getAllByText("NOT AVAILABLE").length).toBeGreaterThan(4);
    expect(screen.queryByText("£0")).not.toBeInTheDocument();
    expect(screen.getAllByText("EVIDENCE INCOMPLETE").length).toBeGreaterThan(
      1,
    );
    expect(screen.getByText("PRIMARY ROAS NOT AVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("PRIMARY ROAS ELIGIBLE")).not.toBeInTheDocument();
  });

  it("compares immutable versions without inventing missing benchmarks", () => {
    const value = comparableReport();
    render(
      <PerformanceReport
        comparisonVersion={value.versions[1]!}
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "05 Decision" }));

    expect(
      screen.getByRole("heading", { name: "V02 against immutable V01." }),
    ).toBeInTheDocument();
    expect(screen.getByText("PRIOR ISSUED REPORT")).toBeInTheDocument();
    expect(screen.getAllByText("+1 vs comparison").length).toBe(2);
    expect(screen.getByText("+£100 vs comparison")).toBeInTheDocument();
    expect(
      screen.getByText("APPROVED TARGET / NOT RETAINED IN THIS REPORT"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("EXTERNAL BENCHMARK / NO SOURCE CONFIGURED"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Comparison version" }),
      ).getByRole("link", { name: "V01" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/reports/${ids.report}?version=2&compare=1`,
    );
  });

  it("uses retained daily evidence and names approved, baseline and cohort references", () => {
    const value = report();
    value.versions[0]!.measurementContext = {
      id: "77000000-0000-4000-8000-000000000001",
      issuedAt: "2026-08-13T12:10:00.000Z",
      issuedBy: "90000000-0000-4000-8000-000000000001",
      payloadSha256: "c".repeat(64),
      observations: [
        ...(["qualified_wallets", "activated_wallets"] as const).map(
          (metric, index) => ({
            id: `78000000-0000-4000-8000-00000000000${index + 1}`,
            metric,
            periodStartedAt: "2026-08-11T00:00:00.000Z",
            periodEndedAt: "2026-08-12T00:00:00.000Z",
            observedThrough: "2026-08-12T00:00:00.000Z",
            periodState: "complete" as const,
            status: "available" as const,
            valueDecimal: metric === "qualified_wallets" ? "0" : "0",
            unavailableReason: null,
            sourceEvidenceIds: [],
          }),
        ),
        ...(["qualified_wallets", "activated_wallets"] as const).map(
          (metric, index) => ({
            id: `79000000-0000-4000-8000-00000000000${index + 1}`,
            metric,
            periodStartedAt: "2026-08-12T00:00:00.000Z",
            periodEndedAt: "2026-08-12T12:00:00.000Z",
            observedThrough: "2026-08-12T11:55:00.000Z",
            periodState: "partial" as const,
            status: "available" as const,
            valueDecimal: "1",
            unavailableReason: null,
            sourceEvidenceIds: [],
          }),
        ),
      ],
      benchmarks: [
        {
          id: "7a000000-0000-4000-8000-000000000001",
          kind: "approved_target",
          metric: "qualified_wallets",
          label: "Approved wallet target",
          sourceLabel: "Commercial plan approval / 01 Aug",
          status: "available",
          valueDecimal: "5",
          unavailableReason: null,
          sourceStartedAt: null,
          sourceEndedAt: null,
          approvedAt: "2026-08-01T00:00:00.000Z",
          cohortSampleSize: null,
        },
        {
          id: "7a000000-0000-4000-8000-000000000002",
          kind: "portfolio_cohort",
          metric: "qualified_wallets",
          label: "Comparable launch cohort",
          sourceLabel: "Anonymised portfolio / July",
          status: "not_available",
          valueDecimal: null,
          unavailableReason: "source_not_configured",
          sourceStartedAt: null,
          sourceEndedAt: null,
          approvedAt: null,
          cohortSampleSize: null,
        },
      ],
    };

    render(
      <PerformanceReport
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(screen.getByText("PARTIAL PERIOD LABELLED")).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        /D02.*Qualified wallets: 1, partial period.*Activated wallets: 1, partial period/,
      ),
    ).toHaveAttribute("tabindex", "0");
    fireEvent.click(screen.getByRole("tab", { name: "05 Decision" }));
    expect(screen.getByText("RETAINED REFERENCES")).toBeInTheDocument();
    expect(screen.getByText(/Approved wallet target/)).toBeInTheDocument();
    const cohort = screen.getByText("COMPARABLE PORTFOLIO").closest("article");
    expect(cohort).not.toBeNull();
    expect(within(cohort!).getByText("NOT AVAILABLE")).toBeInTheDocument();
    expect(within(cohort!).queryByText(/campaigns/)).not.toBeInTheDocument();
  });

  it("ranks creators only from retained attribution evidence", () => {
    const value = report();
    const activatedPath: ProjectReportEvidencePath = {
      ...evidencePath,
      metric: "activated_wallets",
    };
    render(
      <PerformanceReport
        campaign={campaign()}
        projectSlug="helios"
        rankingEvidencePaths={[evidencePath, activatedPath]}
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));

    const ranking = screen
      .getByRole("heading", { name: "Who created qualified movement?" })
      .closest("section");
    expect(ranking).not.toBeNull();
    expect(within(ranking!).getByText("Ava Sol")).toBeInTheDocument();
    expect(within(ranking!).getByText(/Launch package/)).toBeInTheDocument();
    expect(
      within(ranking!).getByText("REVIEW FOR RENEWAL"),
    ).toBeInTheDocument();
    expect(within(ranking!).getAllByText("£100").length).toBeGreaterThan(0);
    expect(within(ranking!).getByText(/UNALLOCATED/)).toHaveTextContent("£0");
    expect(
      within(ranking!).getByText(/Campaign publication workflow/),
    ).toBeInTheDocument();
    expect(
      within(ranking!).queryByText(/Later media enrichment/),
    ).not.toBeInTheDocument();
    expect(
      within(ranking!).getByRole("link", { name: "VIEW PUBLISHED POST" }),
    ).toHaveAttribute("href", "https://x.com/avasol/status/1");
    expect(within(ranking!).getByRole("img")).toHaveAttribute(
      "src",
      "https://images.example.com/launch.jpg",
    );
    expect(screen.getByText("50.0% OF PRIOR STAGE")).toBeInTheDocument();
    expect(screen.getByText("100.0% OF PRIOR STAGE")).toBeInTheDocument();
  });

  it("keeps unavailable creator attribution unknown and gives no delivery verdict", () => {
    const value = report(true);
    render(
      <PerformanceReport
        campaign={campaign()}
        projectSlug="helios"
        rankingEvidencePaths={[]}
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));
    const ranking = screen
      .getByRole("heading", { name: "Who created qualified movement?" })
      .closest("section");
    expect(ranking).not.toBeNull();
    expect(
      within(ranking!).getAllByText("NOT AVAILABLE / NOT AVAILABLE"),
    ).toHaveLength(2);
    expect(
      within(ranking!).getByText("ATTRIBUTION NOT AVAILABLE"),
    ).toBeInTheDocument();
    expect(
      within(ranking!).getByRole("link", {
        name: "REVIEW EVIDENCE READINESS",
      }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/reports/${ids.report}?version=1&evidence=qualified_wallets#evidence`,
    );
    expect(
      within(ranking!).queryByText("INVESTIGATE DELIVERY"),
    ).not.toBeInTheDocument();
  });

  it("shows mixed creator confidence instead of promoting the strongest path", () => {
    const value = report();
    const activatedPath: ProjectReportEvidencePath = {
      ...evidencePath,
      metric: "activated_wallets",
    };
    const indicativePath: ProjectReportEvidencePath = {
      ...activatedPath,
      attributionFactId: "71000000-0000-4000-8000-000000000002",
      confidence: "indicative",
      primaryRoasEligible: false,
    };
    const indicativeQualifiedPath: ProjectReportEvidencePath = {
      ...indicativePath,
      metric: "qualified_wallets",
    };
    const qualifiedDenominator =
      value.versions[0]!.metricSnapshot.metrics.cpqw.denominator;
    const activatedDenominator =
      value.versions[0]!.metricSnapshot.metrics.cpa.denominator;
    if (
      qualifiedDenominator.status !== "available" ||
      activatedDenominator.status !== "available"
    ) {
      throw new Error("Fixture attribution must be available");
    }
    qualifiedDenominator.evidenceIds = [
      ids.attribution,
      indicativePath.attributionFactId,
    ];
    qualifiedDenominator.value = 2;
    activatedDenominator.evidenceIds = [
      ids.attribution,
      indicativePath.attributionFactId,
    ];
    activatedDenominator.value = 2;

    render(
      <PerformanceReport
        campaign={campaign()}
        projectSlug="helios"
        rankingEvidencePaths={[
          evidencePath,
          activatedPath,
          indicativeQualifiedPath,
          indicativePath,
        ]}
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));
    const mixed = screen.getByText("1 STRONG / 1 INDICATIVE");
    expect(mixed.closest(".status")).toHaveClass("status--forecast");
    expect(mixed.closest(".status")).not.toHaveClass("status--verified");
  });

  it("names unavailable thumbnails and ignores enrichment created after issue", () => {
    const value = report();
    const retainedCampaign = campaign();
    const evidence = retainedCampaign.contentAssets[0]!.publicationEvidence;
    evidence[0]!.observedAt = "2026-08-12T12:00:00.000Z";
    evidence[0]!.createdAt = "2026-08-14T12:00:00.000Z";
    evidence[1]!.thumbnailStatus = "not_available";
    evidence[1]!.thumbnailUrl = null;
    evidence[1]!.thumbnailUnavailableReason = "not_captured";

    render(
      <PerformanceReport
        campaign={retainedCampaign}
        projectSlug="helios"
        rankingEvidencePaths={[
          evidencePath,
          { ...evidencePath, metric: "activated_wallets" },
        ]}
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));
    expect(
      screen.getByText("THUMBNAIL NOT AVAILABLE / NOT CAPTURED"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Campaign publication workflow/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Later media enrichment/),
    ).not.toBeInTheDocument();
  });

  it("does not leak later asset creation or mutable current status into an older report", () => {
    const value = report();
    const retainedCampaign = campaign();
    const sourceAsset = retainedCampaign.contentAssets[0]!;
    sourceAsset.publicationEvidence = [];
    sourceAsset.activity = [];
    sourceAsset.status = "published";
    retainedCampaign.contentAssets.push({
      ...structuredClone(sourceAsset),
      id: "74000000-0000-4000-8000-000000000002",
      label: "Later campaign extension",
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });

    render(
      <PerformanceReport
        campaign={retainedCampaign}
        projectSlug="helios"
        rankingEvidencePaths={[
          evidencePath,
          { ...evidencePath, metric: "activated_wallets" },
        ]}
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));
    expect(
      screen.getByText("PLANNED / MEDIA NOT RETAINED"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Later campaign extension"),
    ).not.toBeInTheDocument();
  });

  it("renders first-use and filtered-empty states with a recovery action", () => {
    const { rerender } = render(<ReportsEmpty />);
    expect(
      screen.getByText("No issued campaign report yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "REVIEW CAMPAIGNS" }),
    ).toHaveAttribute("href", "/projects/helios/campaigns");

    rerender(<ReportVersionUnavailable href="/projects/helios/reports/one" />);
    expect(
      screen.getByRole("link", { name: "VIEW LATEST VERSION" }),
    ).toHaveAttribute("href", "/projects/helios/reports/one");
  });

  it("keeps loading, recoverable error and permission states distinct", () => {
    const { rerender } = render(<ReportLoadingState />);
    expect(
      screen.getByRole("status", {
        name: "Loading issued performance report",
      }),
    ).toHaveAttribute("aria-busy", "true");

    rerender(
      <ReportRecoverableError
        retryControl={<button type="button">TRY AGAIN</button>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The issued report could not be loaded.",
    );
    expect(
      screen.getByRole("button", { name: "TRY AGAIN" }),
    ).toBeInTheDocument();

    rerender(<ReportPermission />);
    expect(screen.getByText("ACCESS RESTRICTED")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("formats large retained ROAS exactly without binary floating point", () => {
    const value = report();
    const revenueRoas = value.versions[0]!.metricSnapshot.metrics.revenueRoas;
    if (revenueRoas.status !== "available")
      throw new Error("Fixture must be available");
    revenueRoas.ratioDecimal = "9007199254740993.125000";

    render(
      <PerformanceReport
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(
      screen.getByText(/9007199254740993\.13× REVENUE ROAS/),
    ).toBeInTheDocument();
  });

  it("opens the metric evidence path without exposing a wallet address", () => {
    const value = report();
    render(
      <PerformanceReport
        evidenceMetric="qualified_wallets"
        evidencePaths={[evidencePath]}
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "From result to transaction." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /QUALIFIED WALLETS/i }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Ava Sol")).toBeInTheDocument();
    expect(
      screen.getByText("Controller verified. Consent retained."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("First qualifying transaction"),
    ).toBeInTheDocument();
    expect(screen.getByText("Finalized on demo.")).toBeInTheDocument();
    expect(screen.getByText("NO INDEX RETAINED")).toBeInTheDocument();
    expect(screen.getAllByText(/wallet address/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/111111111111111/)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: "Close evidence" }),
    ).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(replace).toHaveBeenCalledWith(
      `/projects/helios/reports/${ids.report}?version=1`,
    );
  });

  it("keeps the evidence dialog outside the inert report and closes into the active comparison", () => {
    const value = comparableReport();
    const selectedVersion = value.versions[0]!;
    const comparisonVersion = value.versions[1]!;

    render(
      <PerformanceReport
        comparisonVersion={comparisonVersion}
        evidenceMetric="qualified_wallets"
        evidencePaths={[evidencePath]}
        projectSlug="helios"
        report={value}
        selectedVersion={selectedVersion}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.closest(".report-cockpit")).toBeNull();
    expect(document.querySelector(".report-cockpit")).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    expect(replace).toHaveBeenCalledWith(
      `/projects/helios/reports/${ids.report}?version=2&compare=1`,
    );
  });

  it("keeps a missing immutable evidence path explicit", () => {
    const value = report();
    render(
      <PerformanceReport
        evidenceMetric="activated_wallets"
        evidencePaths={[]}
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(screen.getByText("PATH NOT RETAINED")).toBeInTheDocument();
    expect(
      screen.getByText(
        /will not infer a creator, wallet action or transaction/i,
      ),
    ).toBeInTheDocument();
  });

  it("links only attribution-backed metrics into the evidence drawer", () => {
    const value = report();
    render(
      <PerformanceReport
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(
      screen.getByRole("link", { name: /QUALIFIED WALLETS/i }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/reports/${ids.report}?version=1&evidence=qualified_wallets#evidence`,
    );
    expect(screen.getByText("SPEND").closest("a")).toBeNull();
    expect(
      screen
        .getAllByText("PRIMARY REVENUE")
        .every((label) => !label.closest("a")),
    ).toBe(true);
    expect(
      screen.getAllByText("REVENUE ROAS").every((label) => !label.closest("a")),
    ).toBe(true);
    expect(
      screen.getByText(
        /activated-wallet denominator only; spend stays separate/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps evidence permission failure inside the loaded report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const value = report();
    render(
      <PerformanceReport
        evidenceMetric="qualified_wallets"
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Summer activation" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("ACCESS RESTRICTED")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/No creator, wallet-proof or transaction evidence/),
    ).toBeInTheDocument();
  });

  it("contains malformed evidence responses as a recoverable drawer error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ paths: [{ transactionSignature: "not-evidence" }] }),
      ),
    );
    const value = report();
    render(
      <PerformanceReport
        evidenceMetric="qualified_wallets"
        projectSlug="helios"
        report={value}
        selectedVersion={value.versions[0]!}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("EVIDENCE INTERRUPTED")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Summer activation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "RETRY EVIDENCE" }),
    ).toBeInTheDocument();
  });
});
