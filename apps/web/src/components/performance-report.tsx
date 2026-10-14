import type { CampaignRecord } from "@landed/contracts";
import {
  computeCreatorEconomics,
  type CreatorEconomicsResult,
} from "@landed/analytics";
import type {
  ProjectReport,
  ProjectReportBenchmarkClaim,
  ProjectReportEvidencePath,
  ProjectReportVersion,
  ReportEvidenceMetric,
} from "@landed/db";
import { Eyebrow, Status } from "@landed/ui";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ReportMode } from "@/lib/reports/modes";
import { ReportEvidenceDrawer } from "./report-evidence-drawer";
import { ReportFunnelChart } from "./report-funnel-chart";
import { ReportModeDock } from "./report-mode-dock";
import { ReportSnapshotChart } from "./report-snapshot-chart";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatExactCount(value: string) {
  return new Intl.NumberFormat("en-GB").format(BigInt(value));
}

function chartPlotCount(value: string | null) {
  if (value === null) return null;
  const exact = BigInt(value);
  return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
}

function benchmarkKindLabel(kind: ProjectReportBenchmarkClaim["kind"]) {
  if (kind === "approved_target") return "APPROVED TARGET";
  return "COMPARABLE PORTFOLIO";
}

function formatMinor(valueMinor: string, currency: string) {
  const value = BigInt(valueMinor);
  const major = value / 100n;
  const remainder = value % 100n;
  const grouped = new Intl.NumberFormat("en-GB").format(major);
  const symbols: Record<string, string> = { EUR: "€", GBP: "£", USD: "$" };
  const suffix =
    remainder === 0n ? "" : `.${remainder.toString().padStart(2, "0")}`;

  return `${symbols[currency] ?? `${currency} `}${grouped}${suffix}`;
}

function formatRateMinor(value: string, currency: string) {
  const [minor = "0", fraction = ""] = value.split(".");
  const roundedMinor =
    BigInt(minor) + (fraction[0] && fraction[0] >= "5" ? 1n : 0n);
  return formatMinor(roundedMinor.toString(), currency);
}

function formatRatio(value: string) {
  const [whole = "0", fraction = "000000"] = value.split(".");
  const scaled = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2));
  const rounded = scaled + (fraction[2] && fraction[2] >= "5" ? 1n : 0n);
  return `${rounded / 100n}.${(rounded % 100n).toString().padStart(2, "0")}×`;
}

function unavailableReason(reason: string) {
  return reason.replaceAll("_", " ");
}

function availableCount(
  metric: ProjectReportVersion["metricSnapshot"]["metrics"]["cpc"],
) {
  return metric.denominator.status === "available"
    ? metric.denominator.value
    : null;
}

function formatSignedCountDelta(
  current: number | null,
  previous: number | null,
) {
  if (current === null || previous === null) return "NOT COMPARABLE";
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${formatInteger(delta)}`;
}

function formatSignedMinorDelta(
  current: string | null,
  previous: string | null,
  currency: string,
) {
  if (current === null || previous === null) return "NOT COMPARABLE";
  const delta = BigInt(current) - BigInt(previous);
  if (delta === 0n) return formatMinor("0", currency);
  return `${delta > 0n ? "+" : "−"}${formatMinor(
    (delta > 0n ? delta : -delta).toString(),
    currency,
  )}`;
}

function BenchmarkMetric({
  current,
  delta,
  label,
}: {
  current: string;
  delta: string;
  label: string;
}) {
  return (
    <article className="report-benchmark-metric">
      <span>{label}</span>
      <strong>{current}</strong>
      <p>{delta} vs comparison</p>
    </article>
  );
}

function ReportHistoryTable({
  initialMode,
  projectSlug,
  report,
  selectedVersion,
}: {
  initialMode: ReportMode;
  projectSlug: string;
  report: ProjectReport;
  selectedVersion: ProjectReportVersion;
}) {
  return (
    <div className="report-history-table" role="table">
      <div className="report-history-table__head" role="row">
        <span role="columnheader">VERSION</span>
        <span role="columnheader">ISSUED</span>
        <span role="columnheader">QUALIFIED WALLETS</span>
        <span role="columnheader">ACTIVATED</span>
        <span role="columnheader">PRIMARY REVENUE</span>
      </div>
      {report.versions.map((version) => {
        const versionMetrics = version.metricSnapshot.metrics;
        const versionRevenue =
          versionMetrics.revenueRoas.numerator.status === "available"
            ? formatMinor(
                versionMetrics.revenueRoas.numerator.valueMinor,
                versionMetrics.cpc.currencyCode,
              )
            : "NOT AVAILABLE";

        return (
          <div
            className="report-history-table__row"
            key={version.id}
            role="row"
          >
            <span role="cell">
              <Link
                aria-current={
                  version.id === selectedVersion.id ? "page" : undefined
                }
                href={`/projects/${projectSlug}/reports/${report.id}?version=${version.version}${initialMode === "funnel" ? "" : `&mode=${initialMode}`}`}
              >
                V{version.version.toString().padStart(2, "0")}
              </Link>
            </span>
            <span role="cell">{formatDate(version.issuedAt)}</span>
            <span role="cell">{countValue(versionMetrics.cpqw)}</span>
            <span role="cell">{countValue(versionMetrics.cpa)}</span>
            <span role="cell">{versionRevenue}</span>
          </div>
        );
      })}
    </div>
  );
}

const confidenceOrder = {
  verified: 4,
  strong: 3,
  indicative: 2,
  unattributed: 1,
} as const;

function strongestConfidence(paths: ProjectReportEvidencePath[]) {
  return paths.reduce<ProjectReportEvidencePath["confidence"] | null>(
    (current, path) =>
      current === null ||
      confidenceOrder[path.confidence] > confidenceOrder[current]
        ? path.confidence
        : current,
    null,
  );
}

function creatorConfidenceSummary(paths: ProjectReportEvidencePath[]) {
  const byFact = new Map<string, ProjectReportEvidencePath["confidence"]>();
  for (const path of paths) {
    const retained = byFact.get(path.attributionFactId);
    if (
      !retained ||
      confidenceOrder[path.confidence] < confidenceOrder[retained]
    ) {
      byFact.set(path.attributionFactId, path.confidence);
    }
  }
  const counts = (["verified", "strong", "indicative", "unattributed"] as const)
    .map((confidence) => ({
      confidence,
      count: [...byFact.values()].filter((value) => value === confidence)
        .length,
    }))
    .filter(({ count }) => count > 0);
  if (counts.length === 0) {
    return { label: "NO ATTRIBUTION", tone: "forecast" as const };
  }
  return {
    label: counts
      .map(({ confidence, count }) =>
        counts.length === 1 && count === 1
          ? confidence.toUpperCase()
          : `${count} ${confidence.toUpperCase()}`,
      )
      .join(" / "),
    tone: counts.every(
      ({ confidence }) => confidence === "verified" || confidence === "strong",
    )
      ? ("verified" as const)
      : ("forecast" as const),
  };
}

function exactAttributionState(
  denominator:
    | { status: "available"; evidenceIds: string[] }
    | {
        status: "not_available";
        reason: "source_not_configured" | "source_incomplete";
      },
  paths: ProjectReportEvidencePath[],
  metric: ProjectReportEvidencePath["metric"],
) {
  if (denominator.status === "not_available") {
    return { status: "not_available" as const, reason: denominator.reason };
  }
  const pathIds = [
    ...new Set(
      paths
        .filter((path) => path.metric === metric)
        .map((path) => path.attributionFactId),
    ),
  ].sort();
  const retainedIds = [...denominator.evidenceIds].sort();
  return pathIds.join("\0") === retainedIds.join("\0")
    ? { status: "available" as const, evidenceIds: retainedIds }
    : {
        status: "not_available" as const,
        reason: "source_incomplete" as const,
      };
}

export function buildCreatorEconomics(
  campaign: CampaignRecord | null,
  paths: ProjectReportEvidencePath[],
  selectedVersion: ProjectReportVersion,
): CreatorEconomicsResult | null {
  if (!campaign || campaign.id !== selectedVersion.metricSnapshot.campaignId) {
    return null;
  }

  const spend = selectedVersion.metricSnapshot.metrics.cpc.numerator;
  const eligibleSpend =
    spend.status === "available" &&
    spend.kind === "eligible_campaign_spend_minor"
      ? spend
      : null;
  const currencyCode = selectedVersion.metricSnapshot.metrics.cpc.currencyCode;
  const approvedCashLines = campaign.roster.flatMap((entry) =>
    entry.commercialTerms.compensationLines.flatMap((line) =>
      line.assetType === "cash" && line.currencyCode === currencyCode
        ? [
            {
              id: line.id,
              kind: "creator_compensation" as const,
              valueMinor: line.amountMinor,
              currencyCode: line.currencyCode,
            },
          ]
        : [],
    ),
  );
  const spendEvidenceLines =
    eligibleSpend !== null
      ? eligibleSpend.evidenceIds.flatMap((id) =>
          approvedCashLines.filter((line) => line.id === id),
        )
      : [];
  const spendHasValidCompensationBindings =
    eligibleSpend !== null &&
    new Set(spendEvidenceLines.map((line) => line.id)).size ===
      spendEvidenceLines.length &&
    spendEvidenceLines.reduce(
      (total, line) => total + BigInt(line.valueMinor),
      0n,
    ) <= BigInt(eligibleSpend.valueMinor);
  const qualifiedAttribution = exactAttributionState(
    selectedVersion.metricSnapshot.metrics.cpqw.denominator,
    paths,
    "qualified_wallets",
  );
  const activatedAttribution = exactAttributionState(
    selectedVersion.metricSnapshot.metrics.cpa.denominator,
    paths,
    "activated_wallets",
  );
  const issuedAt = new Date(selectedVersion.issuedAt).getTime();

  return computeCreatorEconomics({
    currencyCode,
    eligibleSpend:
      eligibleSpend !== null && spendHasValidCompensationBindings
        ? {
            status: "available",
            valueMinor: eligibleSpend.valueMinor,
            evidenceIds: eligibleSpend.evidenceIds,
            evidenceLines: spendEvidenceLines,
          }
        : {
            status: "not_available",
            reason:
              spend.status === "not_available"
                ? spend.reason
                : "source_incomplete",
          },
    qualifiedAttribution,
    activatedAttribution,
    creators: campaign.roster.map((rosterEntry) => {
      const creatorPaths = paths.filter(
        (path) => path.creatorId === rosterEntry.creatorId,
      );
      return {
        creatorId: rosterEntry.creatorId,
        creatorName: rosterEntry.creatorName,
        creatorHandle: rosterEntry.creatorHandle,
        package: rosterEntry.commercialTerms,
        qualifiedAttributionIds:
          qualifiedAttribution.status === "available"
            ? creatorPaths
                .filter((path) => path.metric === "qualified_wallets")
                .map((path) => path.attributionFactId)
            : [],
        activatedAttributionIds:
          activatedAttribution.status === "available"
            ? creatorPaths
                .filter((path) => path.metric === "activated_wallets")
                .map((path) => path.attributionFactId)
            : [],
        confidence: strongestConfidence(creatorPaths),
        contentAssets: campaign.contentAssets
          .filter(
            (asset) =>
              asset.creatorId === rosterEntry.creatorId &&
              new Date(asset.createdAt).getTime() <= issuedAt,
          )
          .map((asset) => {
            const publicationEvidence = asset.publicationEvidence.find(
              (evidence) =>
                new Date(evidence.observedAt).getTime() <= issuedAt &&
                new Date(evidence.createdAt).getTime() <= issuedAt,
            );
            const activityAtIssue = asset.activity
              .filter(
                (activity) =>
                  new Date(activity.createdAt).getTime() <= issuedAt,
              )
              .sort(
                (left, right) =>
                  new Date(right.createdAt).getTime() -
                    new Date(left.createdAt).getTime() ||
                  right.id.localeCompare(left.id),
              )[0];

            return {
              id: asset.id,
              label: asset.label,
              status: publicationEvidence
                ? ("published" as const)
                : (activityAtIssue?.toStatus ?? "planned"),
              publishedUrl: publicationEvidence?.publishedUrl ?? null,
              publicationEvidence: publicationEvidence
                ? {
                    platform: publicationEvidence.platform,
                    publishedUrl: publicationEvidence.publishedUrl,
                    publishedAt: publicationEvidence.publishedAt,
                    thumbnailStatus: publicationEvidence.thumbnailStatus,
                    thumbnailUrl: publicationEvidence.thumbnailUrl,
                    thumbnailUnavailableReason:
                      publicationEvidence.thumbnailUnavailableReason,
                    sourceLabel: publicationEvidence.sourceLabel,
                    observedAt: publicationEvidence.observedAt,
                    createdAt: publicationEvidence.createdAt,
                  }
                : null,
            };
          }),
      };
    }),
  });
}

function creatorActionLabel(
  action: CreatorEconomicsResult["creators"][number]["action"],
) {
  if (action === "review_for_renewal") return "REVIEW FOR RENEWAL";
  if (action === "investigate_conversion") return "INVESTIGATE CONVERSION";
  if (action === "evidence_unavailable") return "REVIEW EVIDENCE READINESS";
  return "INVESTIGATE DELIVERY";
}

function creatorActionHref(
  action: CreatorEconomicsResult["creators"][number]["action"],
  creatorId: string,
  campaignId: string,
  projectSlug: string,
  reportHref: string,
) {
  if (action === "review_for_renewal") {
    return `/projects/${projectSlug}/kols?creator=${creatorId}&intent=renew`;
  }
  if (action === "investigate_conversion") {
    return `${reportHref}&evidence=qualified_wallets#evidence`;
  }
  if (action === "evidence_unavailable") {
    return `${reportHref}&evidence=qualified_wallets#evidence`;
  }
  return `/projects/${projectSlug}/campaigns/${campaignId}#content-assets`;
}

function CreatorCreativeContext({
  asset,
}: {
  asset:
    CreatorEconomicsResult["creators"][number]["contentAssets"][number] | null;
}) {
  if (!asset) {
    return <span>MEDIA NOT RETAINED</span>;
  }

  const evidence = asset.publicationEvidence;
  return (
    <div className="report-creator-media">
      {evidence?.thumbnailStatus === "available" && evidence.thumbnailUrl ? (
        <Image
          alt={`Published creative preview for ${asset.label}`}
          height={48}
          src={evidence.thumbnailUrl}
          unoptimized
          width={72}
        />
      ) : (
        <span aria-hidden="true" className="report-creator-media__placeholder">
          {evidence?.platform.toUpperCase() ?? "MEDIA"}
        </span>
      )}
      <span>
        <strong>{asset.label}</strong>
        <small>
          {evidence
            ? `${evidence.platform.toUpperCase()} / ${formatDate(evidence.publishedAt)}`
            : `${asset.status.toUpperCase()} / MEDIA NOT RETAINED`}
        </small>
        {evidence ? (
          <>
            {evidence.thumbnailStatus === "not_available" ? (
              <small className="report-creator-media__unavailable">
                THUMBNAIL NOT AVAILABLE /{" "}
                {evidence.thumbnailUnavailableReason
                  ?.replaceAll("_", " ")
                  .toUpperCase() ?? "REASON NOT RETAINED"}
              </small>
            ) : null}
            <small>
              SOURCE / {evidence.sourceLabel} / OBSERVED{" "}
              {formatDate(evidence.observedAt)}
            </small>
            <a href={evidence.publishedUrl} rel="noreferrer" target="_blank">
              VIEW PUBLISHED POST
            </a>
          </>
        ) : null}
      </span>
    </div>
  );
}

function allocationLabel(
  allocation: CreatorEconomicsResult["creators"][number]["allocation"],
  currency: string,
) {
  if (allocation.status === "available") {
    return formatMinor(allocation.valueMinor, currency);
  }
  if (allocation.reason === "non_cash_valuation_not_allocated") {
    return "VALUATION NOT ALLOCATED";
  }
  if (allocation.reason === "not_included_in_issued_spend") {
    return "NOT IN ISSUED SPEND";
  }
  return "NOT AVAILABLE";
}

function approvedTermsLabel(
  creator: CreatorEconomicsResult["creators"][number],
  currency: string,
) {
  return (
    creator.package.compensationLines
      .map((line) => {
        if (line.assetType === "cash") {
          return `${formatMinor(line.amountMinor, line.currencyCode)} ${line.model}`;
        }
        return `${line.assetType.toUpperCase()} ${line.model} / valuation retained${line.assetType === "token" ? ` / ${line.tokenDecimals} decimals` : ""}`;
      })
      .join(" + ") || `NO ${currency} TERMS RETAINED`
  );
}

function ReportMetric({
  detail,
  href,
  label,
  selected = false,
  tone = "default",
  value,
}: {
  detail: string;
  href?: string;
  label: string;
  selected?: boolean;
  tone?: "default" | "verified" | "forecast" | "action";
  value: string;
}) {
  if (href) {
    return (
      <Link
        aria-current={selected ? "page" : undefined}
        className={`report-metric report-metric-link report-metric--${tone}`}
        href={href}
      >
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
        <span className="report-metric__drill">OPEN EVIDENCE</span>
      </Link>
    );
  }

  return (
    <article className={`report-metric report-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function countValue(
  metric: ProjectReportVersion["metricSnapshot"]["metrics"]["cpc"],
) {
  return metric.denominator.status === "available"
    ? formatInteger(metric.denominator.value)
    : "NOT AVAILABLE";
}

function metricEvidenceCount(
  metric: ProjectReportVersion["metricSnapshot"]["metrics"]["cpc"],
) {
  const numerator =
    metric.numerator.status === "available" &&
    metric.numerator.kind === "eligible_campaign_spend_minor"
      ? metric.numerator.evidenceIds.length
      : 0;
  const denominator =
    metric.denominator.status === "available"
      ? metric.denominator.evidenceIds.length
      : 0;
  return numerator + denominator;
}

export function PerformanceReport({
  campaign = null,
  comparisonVersion = null,
  evidenceMetric = null,
  evidencePaths,
  initialMode = "funnel",
  projectSlug,
  rankingEvidencePaths = [],
  report,
  selectedVersion,
}: {
  campaign?: CampaignRecord | null;
  comparisonVersion?: ProjectReportVersion | null;
  evidenceMetric?: ReportEvidenceMetric | null;
  evidencePaths?: ProjectReportEvidencePath[];
  initialMode?: ReportMode;
  projectSlug: string;
  rankingEvidencePaths?: ProjectReportEvidencePath[];
  report: ProjectReport;
  selectedVersion: ProjectReportVersion;
}) {
  const { metrics } = selectedVersion.metricSnapshot;
  const currency = metrics.cpc.currencyCode;
  const spend =
    metrics.revenueRoas.denominator.status === "available"
      ? formatMinor(metrics.revenueRoas.denominator.valueMinor, currency)
      : "NOT AVAILABLE";
  const revenue =
    metrics.revenueRoas.numerator.status === "available"
      ? formatMinor(metrics.revenueRoas.numerator.valueMinor, currency)
      : "NOT AVAILABLE";
  const roas =
    metrics.revenueRoas.status === "available"
      ? formatRatio(metrics.revenueRoas.ratioDecimal)
      : "NOT AVAILABLE";
  const cpa =
    metrics.cpa.status === "available"
      ? formatRateMinor(metrics.cpa.rateMinorDecimal, currency)
      : "NOT AVAILABLE";
  const decisive =
    metrics.revenueRoas.status === "available"
      ? `${revenue} PRIMARY REVENUE. ${roas} REVENUE ROAS.`
      : "REPORT ISSUED. COMMERCIAL OUTCOME AWAITS ELIGIBLE EVIDENCE.";
  const dataThrough = metrics.cpc.dataFreshness.dataThrough;
  const sourceStart = metrics.cpc.sourceTimeRange.startedAt;
  const sourceEnd = metrics.cpc.sourceTimeRange.endedAt;
  const excluded = metrics.revenueRoas.excludedAttributionRevenue;
  const freshnessGap =
    Date.parse(selectedVersion.issuedAt) - Date.parse(dataThrough);
  const isStaleAtIssue = freshnessGap > 24 * 60 * 60 * 1000;
  const qualifiedWalletsAvailable =
    metrics.cpqw.denominator.status === "available";
  const revenueAvailable = metrics.revenueRoas.numerator.status === "available";
  const qualifiedClicks = availableCount(metrics.cpc);
  const qualifiedWallets = availableCount(metrics.cpqw);
  const activatedWallets = availableCount(metrics.cpa);
  const funnelValues = [qualifiedClicks, qualifiedWallets, activatedWallets];
  const funnelComplete =
    funnelValues.every(
      (value) => value !== null && Number.isSafeInteger(value) && value >= 0,
    ) &&
    funnelValues.every(
      (value, index) =>
        index === 0 ||
        (value !== null &&
          funnelValues[index - 1] !== null &&
          value <= funnelValues[index - 1]!),
    );
  const comparisonMetrics = comparisonVersion?.metricSnapshot.metrics ?? null;
  const comparisonQualifiedWallets = comparisonMetrics
    ? availableCount(comparisonMetrics.cpqw)
    : null;
  const comparisonActivatedWallets = comparisonMetrics
    ? availableCount(comparisonMetrics.cpa)
    : null;
  const primaryRevenueMinor =
    metrics.revenueRoas.numerator.status === "available"
      ? metrics.revenueRoas.numerator.valueMinor
      : null;
  const comparisonRevenueMinor =
    comparisonMetrics?.revenueRoas.numerator.status === "available"
      ? comparisonMetrics.revenueRoas.numerator.valueMinor
      : null;
  const spendMinor =
    metrics.revenueRoas.denominator.status === "available"
      ? metrics.revenueRoas.denominator.valueMinor
      : null;
  const comparisonSpendMinor =
    comparisonMetrics?.revenueRoas.denominator.status === "available"
      ? comparisonMetrics.revenueRoas.denominator.valueMinor
      : null;
  const reportHref = `/projects/${projectSlug}/reports/${report.id}?version=${selectedVersion.version}${initialMode === "funnel" ? "" : `&mode=${initialMode}`}`;
  const creatorEconomics = buildCreatorEconomics(
    campaign,
    rankingEvidencePaths,
    selectedVersion,
  );
  const creatorEconomicsRows = creatorEconomics
    ? [...creatorEconomics.creators].sort(
        (left, right) =>
          (right.activatedWallets ?? -1) - (left.activatedWallets ?? -1) ||
          (right.qualifiedWallets ?? -1) - (left.qualifiedWallets ?? -1) ||
          left.creatorName.localeCompare(right.creatorName),
      )
    : [];
  const creatorEvidenceComplete = creatorEconomicsRows.every(
    (creator) =>
      creator.qualifiedWallets !== null && creator.activatedWallets !== null,
  );
  const comparisonHref = (version: number) =>
    `${reportHref}&compare=${version}`;
  const evidenceHref = (metric: ReportEvidenceMetric) =>
    `${reportHref}${comparisonVersion ? `&compare=${comparisonVersion.version}` : ""}&evidence=${metric}#evidence`;
  const closeEvidenceHref = comparisonVersion
    ? comparisonHref(comparisonVersion.version)
    : reportHref;
  const measurementContext = selectedVersion.measurementContext;
  const dailyPoints = measurementContext
    ? [
        ...new Set(
          measurementContext.observations.map(
            (observation) => observation.periodStartedAt,
          ),
        ),
      ].map((periodStartedAt, index) => {
        const periodObservations = measurementContext.observations.filter(
          (observation) => observation.periodStartedAt === periodStartedAt,
        );
        const qualified = periodObservations.find(
          (observation) => observation.metric === "qualified_wallets",
        );
        const activated = periodObservations.find(
          (observation) => observation.metric === "activated_wallets",
        );
        return {
          activatedPeriodState: activated?.periodState,
          activatedWallets: chartPlotCount(activated?.valueDecimal ?? null),
          activatedWalletsExact: activated?.valueDecimal ?? null,
          date:
            qualified?.observedThrough ??
            activated?.observedThrough ??
            periodStartedAt,
          label: `D${String(index + 1).padStart(2, "0")}`,
          qualifiedPeriodState: qualified?.periodState,
          qualifiedWallets: chartPlotCount(qualified?.valueDecimal ?? null),
          qualifiedWalletsExact: qualified?.valueDecimal ?? null,
        };
      })
    : [];
  const snapshotChartPoints =
    dailyPoints.length > 0
      ? dailyPoints
      : report.versions.map((version) => ({
          activatedPeriodState: undefined,
          activatedWallets: availableCount(version.metricSnapshot.metrics.cpa),
          activatedWalletsExact:
            version.metricSnapshot.metrics.cpa.denominator.status ===
            "available"
              ? String(version.metricSnapshot.metrics.cpa.denominator.value)
              : null,
          date: version.issuedAt,
          label: `V${version.version.toString().padStart(2, "0")}`,
          qualifiedPeriodState: undefined,
          qualifiedWallets: availableCount(version.metricSnapshot.metrics.cpqw),
          qualifiedWalletsExact:
            version.metricSnapshot.metrics.cpqw.denominator.status ===
            "available"
              ? String(version.metricSnapshot.metrics.cpqw.denominator.value)
              : null,
          version: version.version,
        }));
  const retainedChartBenchmarks = (measurementContext?.benchmarks ?? [])
    .filter((benchmark) => benchmark.status === "available")
    .map((benchmark) => ({
      kind: benchmark.kind,
      label: benchmarkKindLabel(benchmark.kind),
      metric: benchmark.metric,
      sourceLabel: benchmark.sourceLabel,
      value: chartPlotCount(benchmark.valueDecimal),
      valueDecimal: formatExactCount(benchmark.valueDecimal!),
    }));

  return (
    <div className="performance-report">
      <header className="report-header">
        <div>
          <Eyebrow>05 / REPORTING DECISION COCKPIT</Eyebrow>
          <h1>{selectedVersion.campaignName}</h1>
          <p>
            Immutable campaign report / issued{" "}
            {formatDate(selectedVersion.issuedAt)}
          </p>
        </div>
        <Link className="action-button" href={`/projects/${projectSlug}/kols`}>
          BUILD NEXT BASKET
        </Link>
      </header>

      <div className="report-cockpit">
        <section
          aria-label="Report view and comparison"
          className="report-controls"
        >
          <div className="report-controls__intro">
            <div>
              <Eyebrow>VIEW / IMMUTABLE CONTEXT</Eyebrow>
              <h2>Evidence version and source.</h2>
            </div>
            <Status tone="verified">ISSUED / IMMUTABLE</Status>
          </div>
          <dl className="report-context-grid">
            <div>
              <dt>CAMPAIGN</dt>
              <dd>{selectedVersion.campaignName}</dd>
            </div>
            <div>
              <dt>SOURCE WINDOW</dt>
              <dd>
                {formatDate(sourceStart)} — {formatDate(sourceEnd)}
              </dd>
            </div>
            <div>
              <dt>PRIMARY CONFIDENCE</dt>
              <dd>VERIFIED + STRONG</dd>
            </div>
            <div>
              <dt>DATA THROUGH</dt>
              <dd>{formatDate(dataThrough)}</dd>
            </div>
          </dl>
          <div className="report-version-controls">
            <nav aria-label="Report versions">
              <span>VIEW VERSION</span>
              <div>
                {report.versions.map((version) => (
                  <Link
                    aria-current={
                      version.id === selectedVersion.id ? "page" : undefined
                    }
                    href={`/projects/${projectSlug}/reports/${report.id}?version=${version.version}${initialMode === "funnel" ? "" : `&mode=${initialMode}`}`}
                    key={version.id}
                  >
                    V{version.version.toString().padStart(2, "0")}
                  </Link>
                ))}
              </div>
            </nav>
            <nav aria-label="Comparison version">
              <span>COMPARE AGAINST</span>
              <div>
                {report.versions
                  .filter((version) => version.id !== selectedVersion.id)
                  .map((version) => (
                    <Link
                      aria-current={
                        version.id === comparisonVersion?.id
                          ? "page"
                          : undefined
                      }
                      href={comparisonHref(version.version)}
                      key={version.id}
                    >
                      V{version.version.toString().padStart(2, "0")}
                    </Link>
                  ))}
                {report.versions.length === 1 ? (
                  <span className="report-controls__unavailable">
                    NO PRIOR ISSUED VERSION
                  </span>
                ) : null}
              </div>
            </nav>
          </div>
        </section>

        <section className="report-decision">
          <div>
            <Eyebrow>DECISIVE OUTCOME / PRIMARY MEASUREMENT</Eyebrow>
            <h2>{decisive}</h2>
          </div>
          <div className="report-decision__evidence">
            <Status
              tone={
                metrics.revenueRoas.status === "available" && !isStaleAtIssue
                  ? "verified"
                  : "forecast"
              }
            >
              {metrics.revenueRoas.status === "available"
                ? isStaleAtIssue
                  ? "STALE AT ISSUE"
                  : "VERIFIED + STRONG"
                : "EVIDENCE INCOMPLETE"}
            </Status>
            <span>Last eligible creator touch / 7 days</span>
            <span>Data through {formatDate(dataThrough)}</span>
          </div>
        </section>

        <section
          aria-label="Primary report metrics"
          className="report-metric-grid"
        >
          <ReportMetric
            detail="Eligible campaign commitment"
            label="SPEND"
            value={spend}
          />
          <ReportMetric
            detail={metrics.cpc.definition}
            label="QUALIFIED CLICKS"
            value={countValue(metrics.cpc)}
          />
          <ReportMetric
            detail={metrics.cpqw.definition}
            href={evidenceHref("qualified_wallets")}
            label="QUALIFIED WALLETS"
            selected={evidenceMetric === "qualified_wallets"}
            tone={qualifiedWalletsAvailable ? "verified" : "default"}
            value={countValue(metrics.cpqw)}
          />
          <ReportMetric
            detail={`${metrics.cpa.definition}. Evidence opens the activated-wallet denominator only; spend stays separate.`}
            href={evidenceHref("activated_wallets")}
            label="CPA"
            selected={evidenceMetric === "activated_wallets"}
            value={cpa}
          />
          <ReportMetric
            detail="Protocol revenue / verified + strong only"
            label="PRIMARY REVENUE"
            tone={revenueAvailable ? "verified" : "default"}
            value={revenue}
          />
          <ReportMetric
            detail="Indicative and unattributed revenue excluded"
            label="REVENUE ROAS"
            tone={
              metrics.revenueRoas.status === "available" ? "action" : "default"
            }
            value={roas}
          />
        </section>

        <ReportModeDock
          initialMode={initialMode}
          funnel={
            <section className="report-panel report-panel--funnel">
              <header>
                <div>
                  <Eyebrow>CAMPAIGN FUNNEL</Eyebrow>
                  <h2>From qualified attention to action.</h2>
                </div>
                <Status tone={funnelComplete ? "verified" : "forecast"}>
                  {funnelComplete ? "RETAINED EVIDENCE" : "PARTIAL EVIDENCE"}
                </Status>
              </header>
              <ReportFunnelChart
                activatedWallets={activatedWallets}
                qualifiedClicks={qualifiedClicks}
                qualifiedWallets={qualifiedWallets}
              />
              <p className="report-note">
                Retention is shown only when a retained-wallet source is
                included in the issued version. It is never inferred from
                activation.
              </p>
            </section>
          }
          creators={
            <section className="report-panel report-panel--ranking">
              <header>
                <div>
                  <Eyebrow>CREATOR DECISIONS</Eyebrow>
                  <h2>Who created qualified movement?</h2>
                </div>
                <Status
                  tone={
                    creatorEconomicsRows.length > 0 && creatorEvidenceComplete
                      ? "verified"
                      : "forecast"
                  }
                >
                  {creatorEconomicsRows.length > 0 && creatorEvidenceComplete
                    ? "COMMERCIAL + ATTRIBUTION EVIDENCE"
                    : "EVIDENCE INCOMPLETE"}
                </Status>
              </header>
              {creatorEconomicsRows.length > 0 ? (
                <div className="report-creator-ranking">
                  {creatorEconomicsRows.map((creator, index) => {
                    const primaryAsset = creator.contentAssets[0] ?? null;
                    const confidence = creatorConfidenceSummary(
                      rankingEvidencePaths.filter(
                        (path) => path.creatorId === creator.creatorId,
                      ),
                    );
                    const displayedConfidence =
                      creator.action === "evidence_unavailable"
                        ? {
                            label: "ATTRIBUTION NOT AVAILABLE",
                            tone: "forecast" as const,
                          }
                        : confidence;
                    const actionHref = creatorActionHref(
                      creator.action,
                      creator.creatorId,
                      report.campaignId,
                      projectSlug,
                      reportHref,
                    );
                    return (
                      <article key={creator.creatorId}>
                        <span className="report-creator-ranking__index">
                          {(index + 1).toString().padStart(2, "0")}
                        </span>
                        <div className="report-creator-ranking__identity">
                          <strong>{creator.creatorName}</strong>
                          <span>
                            {creator.creatorHandle ?? "HANDLE NOT RETAINED"}
                          </span>
                          <p>
                            {creator.package.packageLabel} /{" "}
                            {creator.package.deliverableSummary}
                          </p>
                          <small>{approvedTermsLabel(creator, currency)}</small>
                        </div>
                        <dl>
                          <div>
                            <dt>ALLOCATED SPEND</dt>
                            <dd>
                              {allocationLabel(creator.allocation, currency)}
                            </dd>
                          </div>
                          <div>
                            <dt>QUALIFIED / ACTIVATED</dt>
                            <dd>
                              {creator.qualifiedWallets === null
                                ? "NOT AVAILABLE"
                                : formatInteger(creator.qualifiedWallets)}
                              {" / "}
                              {creator.activatedWallets === null
                                ? "NOT AVAILABLE"
                                : formatInteger(creator.activatedWallets)}
                            </dd>
                          </div>
                          <div>
                            <dt>CPQW / CPA</dt>
                            <dd>
                              {creator.cpqwMinorDecimal
                                ? formatRateMinor(
                                    creator.cpqwMinorDecimal,
                                    currency,
                                  )
                                : "NOT AVAILABLE"}
                              {" / "}
                              {creator.cpaMinorDecimal
                                ? formatRateMinor(
                                    creator.cpaMinorDecimal,
                                    currency,
                                  )
                                : "NOT AVAILABLE"}
                            </dd>
                          </div>
                          <div>
                            <dt>CREATIVE CONTEXT</dt>
                            <dd>
                              <CreatorCreativeContext asset={primaryAsset} />
                            </dd>
                          </div>
                        </dl>
                        <div className="report-creator-ranking__action">
                          <Status tone={displayedConfidence.tone}>
                            {displayedConfidence.label}
                          </Status>
                          <Link href={actionHref}>
                            {creatorActionLabel(creator.action)}
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                  <div className="report-creator-ranking__reconciliation">
                    <span>
                      CREATOR ALLOCATED /{" "}
                      {creatorEconomics?.allocatedSpendMinor !== null &&
                      creatorEconomics?.allocatedSpendMinor !== undefined
                        ? formatMinor(
                            creatorEconomics.allocatedSpendMinor,
                            currency,
                          )
                        : "NOT AVAILABLE"}
                    </span>
                    <span>
                      UNALLOCATED /{" "}
                      {creatorEconomics?.unallocatedSpendMinor !== null &&
                      creatorEconomics?.unallocatedSpendMinor !== undefined
                        ? formatMinor(
                            creatorEconomics.unallocatedSpendMinor,
                            currency,
                          )
                        : "NOT AVAILABLE"}
                    </span>
                    <p>
                      Only approved compensation line IDs included in this
                      immutable report are allocated. Campaign costs are never
                      spread across creators.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="report-inline-empty">
                  <strong>
                    Creator economics are not available for version{" "}
                    {selectedVersion.version}.
                  </strong>
                  <p>
                    The report has not manufactured an allocation from campaign
                    totals. Retained commercial terms and exact spend evidence
                    are required before creator CPQW or CPA can appear.
                  </p>
                </div>
              )}
            </section>
          }
          economics={
            <div className="report-mode-grid report-mode-grid--economics">
              <section className="report-panel report-panel--revenue">
                <Eyebrow>VALUE / REVENUE</Eyebrow>
                <strong
                  className={`report-value ${revenueAvailable ? "report-value--verified" : ""}`}
                >
                  {revenue}
                </strong>
                <Status
                  tone={
                    metrics.revenueRoas.status === "available"
                      ? "verified"
                      : "forecast"
                  }
                >
                  {metrics.revenueRoas.status === "available"
                    ? "PRIMARY ROAS ELIGIBLE"
                    : "PRIMARY ROAS NOT AVAILABLE"}
                </Status>
                <p>
                  Only verified and strong attribution enters primary revenue
                  ROAS.
                </p>
                {excluded ? (
                  <dl className="report-value-breakdown">
                    <div>
                      <dt>INDICATIVE / EXCLUDED</dt>
                      <dd>{formatMinor(excluded.indicativeMinor, currency)}</dd>
                    </div>
                    <div>
                      <dt>UNATTRIBUTED / EXCLUDED</dt>
                      <dd>
                        {formatMinor(excluded.unattributedMinor, currency)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <span className="report-unknown">
                    EXCLUDED REVENUE NOT AVAILABLE
                  </span>
                )}
              </section>
              <section className="report-panel report-panel--volume">
                <Eyebrow>VALUE / INFLUENCED VOLUME</Eyebrow>
                <strong className="report-value">NOT AVAILABLE</strong>
                <Status>SEPARATE SOURCE REQUIRED</Status>
                <p>
                  No influenced-volume evidence is retained in this report
                  version. Volume is never inferred from protocol revenue.
                </p>
              </section>
            </div>
          }
          evidence={
            <div className="report-mode-grid report-mode-grid--evidence">
              <section className="report-panel report-panel--definitions">
                <header>
                  <div>
                    <Eyebrow>DEFINITIONS / EVIDENCE PATH</Eyebrow>
                    <h2>Know what every number means.</h2>
                  </div>
                  <span className="report-hash">
                    SNAPSHOT {selectedVersion.metricSnapshotSha256.slice(0, 12)}
                  </span>
                </header>
                <div className="report-definition-grid">
                  {[metrics.cpc, metrics.cpqw, metrics.cpa].map((metric) => (
                    <article key={metric.metric}>
                      <span>{metric.metric.toUpperCase()}</span>
                      <strong>{metric.definition}</strong>
                      <p>
                        {metric.status === "available"
                          ? `${metricEvidenceCount(metric)} retained evidence references`
                          : `Not available / ${unavailableReason(metric.reason)}`}
                      </p>
                    </article>
                  ))}
                  <article>
                    <span>REVENUE ROAS</span>
                    <strong>{metrics.revenueRoas.definition}</strong>
                    <p>
                      {metrics.revenueRoas.status === "available"
                        ? `${metrics.revenueRoas.numerator.sourceRevenueEvidenceIds.length + metrics.revenueRoas.numerator.attributionEvidenceIds.length} retained revenue and attribution references`
                        : `Not available / ${unavailableReason(metrics.revenueRoas.reason)}`}
                    </p>
                  </article>
                </div>
                <footer>
                  <span>
                    Source window / {formatDate(sourceStart)} —{" "}
                    {formatDate(sourceEnd)}
                  </span>
                  <span>
                    Calculation v
                    {selectedVersion.metricSnapshot.calculationVersion}
                  </span>
                  <span>Protected wallet addresses are never shown here</span>
                </footer>
              </section>
              <section className="report-panel report-panel--versions">
                <header>
                  <div>
                    <Eyebrow>ISSUED VERSIONS</Eyebrow>
                    <h2>Immutable observations.</h2>
                  </div>
                </header>
                <ReportHistoryTable
                  initialMode={initialMode}
                  projectSlug={projectSlug}
                  report={report}
                  selectedVersion={selectedVersion}
                />
              </section>
            </div>
          }
          decision={
            <section
              aria-label="Performance benchmarks"
              className="report-benchmarks"
            >
              <header>
                <div>
                  <Eyebrow>BENCHMARK / SOURCE NAMED</Eyebrow>
                  <h2>
                    {measurementContext?.benchmarks.length
                      ? `${measurementContext.benchmarks.length} retained decision reference${measurementContext.benchmarks.length === 1 ? "" : "s"}.`
                      : comparisonVersion
                        ? `V${selectedVersion.version.toString().padStart(2, "0")} against immutable V${comparisonVersion.version.toString().padStart(2, "0")}.`
                        : "No comparable issued version yet."}
                  </h2>
                </div>
                <Status
                  tone={
                    measurementContext?.benchmarks.length
                      ? "verified"
                      : comparisonVersion
                        ? "forecast"
                        : "default"
                  }
                >
                  {measurementContext?.benchmarks.length
                    ? "RETAINED REFERENCES"
                    : comparisonVersion
                      ? "PRIOR ISSUED REPORT"
                      : "BENCHMARK UNAVAILABLE"}
                </Status>
              </header>
              {measurementContext?.benchmarks.length ? (
                <div className="report-retained-benchmarks">
                  {measurementContext.benchmarks.map((benchmark) => (
                    <article key={benchmark.id}>
                      <span>{benchmarkKindLabel(benchmark.kind)}</span>
                      <strong>
                        {benchmark.status === "available" &&
                        benchmark.valueDecimal !== null
                          ? formatExactCount(benchmark.valueDecimal)
                          : "NOT AVAILABLE"}
                      </strong>
                      <p>
                        {benchmark.metric.replaceAll("_", " ")} /{" "}
                        {benchmark.label}
                      </p>
                      <small>
                        {benchmark.sourceLabel}
                        {benchmark.cohortSampleSize
                          ? ` / ${benchmark.cohortSampleSize} campaigns`
                          : ""}
                      </small>
                    </article>
                  ))}
                </div>
              ) : null}
              {comparisonVersion ? (
                <div className="report-benchmark-grid">
                  <BenchmarkMetric
                    current={countValue(metrics.cpqw)}
                    delta={formatSignedCountDelta(
                      qualifiedWallets,
                      comparisonQualifiedWallets,
                    )}
                    label="QUALIFIED WALLETS"
                  />
                  <BenchmarkMetric
                    current={countValue(metrics.cpa)}
                    delta={formatSignedCountDelta(
                      activatedWallets,
                      comparisonActivatedWallets,
                    )}
                    label="ACTIVATED WALLETS"
                  />
                  <BenchmarkMetric
                    current={revenue}
                    delta={formatSignedMinorDelta(
                      primaryRevenueMinor,
                      comparisonRevenueMinor,
                      currency,
                    )}
                    label="PRIMARY REVENUE"
                  />
                  <BenchmarkMetric
                    current={spend}
                    delta={formatSignedMinorDelta(
                      spendMinor,
                      comparisonSpendMinor,
                      currency,
                    )}
                    label="ELIGIBLE SPEND"
                  />
                </div>
              ) : measurementContext?.benchmarks.length ? (
                <p className="report-benchmarks__empty">
                  Retained decision references are shown above. Issue or replay
                  a second comparable report to add immutable version movement.
                </p>
              ) : (
                <p className="report-benchmarks__empty">
                  Issue or replay a second comparable report to show movement.
                  An approved target, pre-campaign baseline or category
                  benchmark has not been inferred from campaign totals.
                </p>
              )}
              <footer>
                {measurementContext ? (
                  <>
                    <span>
                      CONTEXT ISSUED / {formatDate(measurementContext.issuedAt)}
                    </span>
                    <span>
                      CONTEXT HASH /{" "}
                      {measurementContext.payloadSha256.slice(0, 12)}
                    </span>
                    <span>COHORT MEMBERS / NEVER EXPOSED</span>
                  </>
                ) : (
                  <>
                    <span>APPROVED TARGET / NOT RETAINED IN THIS REPORT</span>
                    <span>PRE-CAMPAIGN BASELINE / NOT RETAINED</span>
                    <span>PORTFOLIO COHORT / NOT CONFIGURED</span>
                    <span>EXTERNAL BENCHMARK / NO SOURCE CONFIGURED</span>
                  </>
                )}
              </footer>
            </section>
          }
        />

        <section className="report-panel report-panel--history">
          <header>
            <div>
              <Eyebrow>
                PERFORMANCE OVER TIME /{" "}
                {measurementContext ? "DAILY RETAINED" : "ISSUED SNAPSHOTS"}
              </Eyebrow>
              <h2>
                {measurementContext
                  ? "Cumulative evidence, day by day."
                  : "Comparable evidence, version by version."}
              </h2>
            </div>
            <Status tone={measurementContext ? "verified" : "forecast"}>
              {measurementContext
                ? snapshotChartPoints.some(
                    (point) =>
                      point.qualifiedPeriodState === "partial" ||
                      point.activatedPeriodState === "partial",
                  )
                  ? "PARTIAL PERIOD LABELLED"
                  : "COMPLETE RETAINED SERIES"
                : "DAILY SERIES NOT RETAINED"}
            </Status>
          </header>
          <ReportSnapshotChart
            benchmarks={retainedChartBenchmarks}
            points={snapshotChartPoints}
            revealSignature={
              measurementContext?.id ??
              `report-version-${selectedVersion.version}`
            }
          />
        </section>
      </div>

      {evidenceMetric ? (
        <ReportEvidenceDrawer
          closeHref={closeEvidenceHref}
          initialPaths={evidencePaths}
          metric={evidenceMetric}
          projectSlug={projectSlug}
          reportVersionId={selectedVersion.id}
        />
      ) : null}
    </div>
  );
}

export function ReportsEmpty({
  projectSlug = "helios",
}: {
  projectSlug?: string;
}) {
  return (
    <section className="directory-state">
      <Eyebrow>REPORTS / FIRST USE</Eyebrow>
      <h2>No issued campaign report yet.</h2>
      <p>
        Issue an immutable campaign report when metric evidence is ready. Draft
        or mutable totals are not presented as final performance.
      </p>
      <Status>AWAITING ISSUED EVIDENCE</Status>
      <Link
        className="action-button"
        href={`/projects/${projectSlug}/campaigns`}
      >
        REVIEW CAMPAIGNS
      </Link>
    </section>
  );
}

export function ReportLoadingState() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading issued performance report"
      className="report-loading"
      role="status"
    >
      <div className="loading-panel report-loading__hero" />
      <div className="report-loading__grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="loading-panel" key={index} />
        ))}
      </div>
    </div>
  );
}

export function ReportRecoverableError({
  retryControl,
}: {
  retryControl: ReactNode;
}) {
  return (
    <section className="directory-state" role="alert">
      <Eyebrow>REPORTS / RECOVERABLE ERROR</Eyebrow>
      <h2>The issued report could not be loaded.</h2>
      <p>No metric, report version or attribution evidence was changed.</p>
      {retryControl}
    </section>
  );
}

export function ReportPermission() {
  return (
    <section className="directory-state">
      <Eyebrow>REPORTS / PERMISSION</Eyebrow>
      <h2>This report is not available to your account.</h2>
      <p>
        Project access is checked before any campaign or report evidence is
        returned.
      </p>
      <Status>ACCESS RESTRICTED</Status>
    </section>
  );
}

export function ReportVersionUnavailable({ href }: { href: string }) {
  return (
    <section className="directory-state">
      <Eyebrow>REPORTS / FILTERED EMPTY</Eyebrow>
      <h2>That immutable version is not retained.</h2>
      <p>Choose the latest issued report version to continue.</p>
      <Link className="action-button" href={href}>
        VIEW LATEST VERSION
      </Link>
    </section>
  );
}
