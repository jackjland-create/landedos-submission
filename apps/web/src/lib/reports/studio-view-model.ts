import type { CampaignRecord } from "@landed/contracts";
import type {
  ProjectReportEvidencePath,
  ProjectReportVersion,
} from "@landed/db";

export type ReportingStudioMetric = {
  delta: string;
  detail: string;
  label: string;
  status: "available" | "unavailable";
  value: string;
};

export type ReportingStudioCreator = {
  action: "Expand" | "Retain" | "Review";
  activatedWallets: number | null;
  confidence: "Strong" | "Indicative" | "Unavailable";
  creatorId: string;
  deliverable: string;
  handle: string | null;
  name: string;
  packageLabel: string;
  qualifiedWallets: number | null;
  spend: string;
  thumbnailUrl: string | null;
};

export type ReportingStudioViewModel = {
  campaignName: string;
  chartPoints: Array<{
    activatedWallets: number | null;
    activatedWalletsExact: string | null;
    date: string;
    label: string;
    qualifiedWallets: number | null;
    qualifiedWalletsExact: string | null;
  }>;
  creators: ReportingStudioCreator[];
  dataThrough: string;
  decision: string;
  evidenceSummary: string;
  issuedAt: string;
  objective: string;
  primaryMetrics: ReportingStudioMetric[];
  sourceWindow: string;
  supportingMetrics: ReportingStudioMetric[];
  version: number;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function formatMinor(valueMinor: string, currency: string) {
  const value = BigInt(valueMinor);
  const major = value / 100n;
  const remainder = value % 100n;
  const symbols: Record<string, string> = { EUR: "€", GBP: "£", USD: "$" };
  const decimals =
    remainder === 0n ? "" : `.${remainder.toString().padStart(2, "0")}`;
  return `${symbols[currency] ?? `${currency} `}${new Intl.NumberFormat("en-GB").format(major)}${decimals}`;
}

function formatRateMinor(value: string, currency: string) {
  const [minor = "0", fraction = ""] = value.split(".");
  const rounded = BigInt(minor) + (fraction[0] && fraction[0] >= "5" ? 1n : 0n);
  return formatMinor(rounded.toString(), currency);
}

function formatRatio(value: string) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}×` : "Not available";
}

function availableCount(metric: {
  denominator: { status: string; value?: number };
}) {
  return metric.denominator.status === "available"
    ? (metric.denominator.value ?? null)
    : null;
}

function signedCountDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return "Not comparable";
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("en-GB").format(delta)} vs previous`;
}

function signedMoneyDelta(
  current: string | null,
  previous: string | null,
  currency: string,
) {
  if (current === null || previous === null) return "Not comparable";
  const delta = BigInt(current) - BigInt(previous);
  const absolute = delta < 0n ? -delta : delta;
  return `${delta > 0n ? "+" : delta < 0n ? "−" : ""}${formatMinor(absolute.toString(), currency)} vs previous`;
}

function metricValue(value: number | null, unavailable = "Not available") {
  return value === null
    ? unavailable
    : new Intl.NumberFormat("en-GB").format(value);
}

function compensationForCreator(
  creator: CampaignRecord["roster"][number],
  currency: string,
) {
  const cash = creator.commercialTerms.compensationLines.find(
    (line) => line.assetType === "cash",
  );
  return cash?.assetType === "cash"
    ? formatMinor(cash.amountMinor, cash.currencyCode)
    : `No ${currency} cash term`;
}

function creatorRows(
  campaign: CampaignRecord,
  evidencePaths: ProjectReportEvidencePath[],
  unavailable: boolean,
  currency: string,
) {
  return campaign.roster
    .map((creator) => {
      const qualified = evidencePaths.filter(
        (path) =>
          path.creatorId === creator.creatorId &&
          path.metric === "qualified_wallets",
      );
      const activated = evidencePaths.filter(
        (path) =>
          path.creatorId === creator.creatorId &&
          path.metric === "activated_wallets",
      );
      const strongest = qualified.some((path) => path.confidence === "strong")
        ? "Strong"
        : qualified.length > 0
          ? "Indicative"
          : "Unavailable";
      const publishedAsset = campaign.contentAssets.find(
        (asset) => asset.creatorId === creator.creatorId,
      );
      const thumbnailUrl =
        publishedAsset?.publicationEvidence.find(
          (item) => item.thumbnailStatus === "available",
        )?.thumbnailUrl ?? null;
      const qualifiedCount = unavailable ? null : qualified.length;
      const activatedCount = unavailable ? null : activated.length;
      const action =
        qualifiedCount === null
          ? "Review"
          : activatedCount !== null && activatedCount >= 2
            ? "Expand"
            : activatedCount === 1
              ? "Retain"
              : "Review";

      return {
        action,
        activatedWallets: activatedCount,
        confidence: unavailable ? "Unavailable" : strongest,
        creatorId: creator.creatorId,
        deliverable: creator.deliverableSummary,
        handle: creator.creatorHandle,
        name: creator.creatorName,
        packageLabel: creator.packageLabel,
        qualifiedWallets: qualifiedCount,
        spend: compensationForCreator(creator, currency),
        thumbnailUrl,
      } satisfies ReportingStudioCreator;
    })
    .sort(
      (left, right) =>
        (right.activatedWallets ?? -1) - (left.activatedWallets ?? -1) ||
        (right.qualifiedWallets ?? -1) - (left.qualifiedWallets ?? -1),
    );
}

export function buildReportingStudioViewModel({
  campaign,
  comparisonVersion,
  evidencePaths,
  selectedVersion,
}: {
  campaign: CampaignRecord;
  comparisonVersion: ProjectReportVersion | null;
  evidencePaths: ProjectReportEvidencePath[];
  selectedVersion: ProjectReportVersion;
}): ReportingStudioViewModel {
  const metrics = selectedVersion.metricSnapshot.metrics;
  const comparisonMetrics = comparisonVersion?.metricSnapshot.metrics ?? null;
  const currency = metrics.cpc.currencyCode;
  const qualifiedClicks = availableCount(metrics.cpc);
  const qualifiedWallets = availableCount(metrics.cpqw);
  const activatedWallets = availableCount(metrics.cpa);
  const previousQualified = comparisonMetrics
    ? availableCount(comparisonMetrics.cpqw)
    : null;
  const previousActivated = comparisonMetrics
    ? availableCount(comparisonMetrics.cpa)
    : null;
  const spendMinor =
    metrics.revenueRoas.denominator.status === "available"
      ? metrics.revenueRoas.denominator.valueMinor
      : null;
  const revenueMinor =
    metrics.revenueRoas.numerator.status === "available"
      ? metrics.revenueRoas.numerator.valueMinor
      : null;
  const comparisonRevenueMinor =
    comparisonMetrics?.revenueRoas.numerator.status === "available"
      ? comparisonMetrics.revenueRoas.numerator.valueMinor
      : null;
  const revenue = revenueMinor ? formatMinor(revenueMinor, currency) : null;
  const roas =
    metrics.revenueRoas.status === "available"
      ? formatRatio(metrics.revenueRoas.ratioDecimal)
      : null;
  const cpa =
    metrics.cpa.status === "available"
      ? formatRateMinor(metrics.cpa.rateMinorDecimal, currency)
      : null;
  const unavailable = revenueMinor === null || qualifiedWallets === null;
  const observations = selectedVersion.measurementContext?.observations ?? [];
  const dates = [...new Set(observations.map((item) => item.periodStartedAt))];
  const chartPoints = unavailable
    ? []
    : dates.map((date, index) => {
        const period = observations.filter(
          (item) => item.periodStartedAt === date,
        );
        const qualified = period.find(
          (item) => item.metric === "qualified_wallets",
        );
        const activated = period.find(
          (item) => item.metric === "activated_wallets",
        );
        return {
          activatedWallets:
            activated?.valueDecimal === undefined
              ? null
              : Number(activated.valueDecimal),
          activatedWalletsExact: activated?.valueDecimal ?? null,
          date:
            qualified?.observedThrough ?? activated?.observedThrough ?? date,
          label: `D${String(index + 1).padStart(2, "0")}`,
          qualifiedWallets:
            qualified?.valueDecimal === undefined
              ? null
              : Number(qualified.valueDecimal),
          qualifiedWalletsExact: qualified?.valueDecimal ?? null,
        };
      });
  const sourceStart = metrics.cpc.sourceTimeRange.startedAt;
  const sourceEnd = metrics.cpc.sourceTimeRange.endedAt;

  return {
    campaignName: selectedVersion.campaignName,
    chartPoints,
    creators: creatorRows(campaign, evidencePaths, unavailable, currency),
    dataThrough: formatDate(metrics.cpc.dataFreshness.dataThrough),
    decision:
      revenue && roas && qualifiedWallets !== null && activatedWallets !== null
        ? `${revenue} in eligible revenue from ${metricValue(qualifiedWallets)} qualified wallets and ${metricValue(activatedWallets)} activations.`
        : "The report is issued, but the commercial outcome still needs eligible evidence.",
    evidenceSummary: unavailable
      ? "Some campaign sources are not connected. Missing evidence remains unavailable, never zero."
      : "Verified and strong attribution only. Indicative and unattributed revenue stays outside primary ROAS.",
    issuedAt: formatDate(selectedVersion.issuedAt),
    objective: campaign.objective,
    primaryMetrics: [
      {
        delta: signedCountDelta(qualifiedWallets, previousQualified),
        detail: "Eligible attributed wallets",
        label: "Qualified wallets",
        status: qualifiedWallets === null ? "unavailable" : "available",
        value: metricValue(qualifiedWallets),
      },
      {
        delta: signedCountDelta(activatedWallets, previousActivated),
        detail: "First qualifying transaction",
        label: "Activated wallets",
        status: activatedWallets === null ? "unavailable" : "available",
        value: metricValue(activatedWallets),
      },
      {
        delta: signedMoneyDelta(revenueMinor, comparisonRevenueMinor, currency),
        detail: "Verified + strong only",
        label: "Eligible revenue",
        status: revenue === null ? "unavailable" : "available",
        value: revenue ?? "Not available",
      },
      {
        delta: "Primary outcome ratio",
        detail: "Eligible revenue / spend",
        label: "Revenue ROAS",
        status: roas === null ? "unavailable" : "available",
        value: roas ?? "Not available",
      },
    ],
    sourceWindow: `${formatDate(sourceStart)} – ${formatDate(sourceEnd)}`,
    supportingMetrics: [
      {
        delta: "Approved campaign ledger",
        detail: "Eligible campaign commitment",
        label: "Spend",
        status: spendMinor === null ? "unavailable" : "available",
        value: spendMinor ? formatMinor(spendMinor, currency) : "Not available",
      },
      {
        delta: "Retained click evidence",
        detail: "Qualified campaign entries",
        label: "Qualified clicks",
        status: qualifiedClicks === null ? "unavailable" : "available",
        value: metricValue(qualifiedClicks),
      },
      {
        delta: "Spend / activated wallet",
        detail: "Cost of first qualifying action",
        label: "CPA",
        status: cpa === null ? "unavailable" : "available",
        value: cpa ?? "Not available",
      },
    ],
    version: selectedVersion.version,
  };
}
