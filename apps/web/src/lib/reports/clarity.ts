import type { ProjectReportVersion } from "@landed/db";
import { reportEvidenceMetricSchema } from "@landed/db";
import type { TimedReportPresentation } from "./timed-report-presentation";
type ClarityMeasurementContext = Pick<
  NonNullable<ProjectReportVersion["measurementContext"]>,
  "id" | "observations" | "benchmarks"
>;
export type ClarityReportVersion = Pick<
  ProjectReportVersion,
  "id" | "version" | "issuedAt" | "campaignName" | "metricSnapshot"
> & {
  measurementContext?: ClarityMeasurementContext | null;
  metricSnapshotSha256?: string;
};

export type EvidenceProvenance =
  "synthetic" | "non_mainnet" | "retained" | "unknown";

export const clarityViews = [
  "performance",
  "funnel",
  "creators",
  "economics",
  "evidence",
] as const;
export type ClarityView = (typeof clarityViews)[number];
export const headlineMetrics = {
  spend: "Spend",
  clicks: "Qualified clicks",
  qualified: "Qualified wallets",
  activated: "Activated wallets",
  cpc: "Cost per click",
  cpqw: "Cost per qualified wallet",
  cpa: "Cost per activation",
  revenue: "Primary revenue",
  roas: "Revenue ROAS",
} as const;
export type HeadlineMetric = keyof typeof headlineMetrics;
export const defaultHeadlineMetrics = "spend,qualified,cpqw,revenue";
export function parseHeadlineMetrics(value: string | null): HeadlineMetric[] {
  const valid = [...new Set((value ?? "").split(","))]
    .filter((key): key is HeadlineMetric => Object.hasOwn(headlineMetrics, key))
    .slice(0, 6);
  return valid.length
    ? valid
    : (defaultHeadlineMetrics.split(",") as HeadlineMetric[]);
}
export type ClarityQuery = {
  view: ClarityView;
  theme: "light" | "dark";
  version: number;
  creator: string;
  compare: number | null;
  group: "creator" | "content";
  detail: string;
  metrics: string;
  chart: "both" | "qualified" | "activated";
  evidence: "" | "all" | "qualified_wallets" | "activated_wallets";
};

export function parseClarityQuery(params: URLSearchParams): ClarityQuery {
  const view = params.get("view");
  const version = Number(params.get("version"));
  const comparison = Number(params.get("compare"));
  const evidence = reportEvidenceMetricSchema.safeParse(params.get("evidence"));
  return {
    view: clarityViews.find((item) => item === view) ?? "performance",
    theme: params.get("theme") === "dark" ? "dark" : "light",
    version: Number.isInteger(version) && version > 0 ? version : 2,
    creator: params.get("creator") ?? "all",
    compare: Number.isInteger(comparison) && comparison > 0 ? comparison : null,
    group: params.get("group") === "content" ? "content" : "creator",
    detail: params.get("detail") ?? "",
    metrics: parseHeadlineMetrics(params.get("metrics")).join(","),
    chart:
      params.get("chart") === "qualified"
        ? "qualified"
        : params.get("chart") === "activated"
          ? "activated"
          : "both",
    evidence:
      params.get("evidence") === "all"
        ? "all"
        : evidence.success
          ? evidence.data
          : "",
  };
}

export function clarityMoney(minor: string | null, currency = "GBP") {
  if (minor === null) return "Not available";
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  const symbol =
    ({ GBP: "£", USD: "$", EUR: "€" } as Record<string, string>)[currency] ??
    `${currency} `;
  return `${amount < 0n ? "−" : ""}${symbol}${new Intl.NumberFormat("en-GB").format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function clarityRate(minor: string | null, currency: string) {
  if (minor === null) return "Not available";
  const [whole = "0", fraction = ""] = minor.split(".");
  return clarityMoney(
    (BigInt(whole) + (Number(fraction[0] ?? 0) >= 5 ? 1n : 0n)).toString(),
    currency,
  );
}

export function clarityDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function clarityMetrics(version: ClarityReportVersion) {
  const m = version.metricSnapshot.metrics;
  const count = (metric: typeof m.cpc) =>
    metric.denominator.status === "available" ? metric.denominator.value : null;
  const money = (v: string | null) => clarityMoney(v, m.cpc.currencyCode);
  const rate = (metric: typeof m.cpc) =>
    metric.status === "available"
      ? clarityRate(metric.rateMinorDecimal, metric.currencyCode)
      : "Not available";
  return {
    clicks: count(m.cpc),
    qualified: count(m.cpqw),
    activated: count(m.cpa),
    spend: money(
      m.revenueRoas.denominator.status === "available"
        ? m.revenueRoas.denominator.valueMinor
        : null,
    ),
    revenue: money(
      m.revenueRoas.numerator.status === "available"
        ? m.revenueRoas.numerator.valueMinor
        : null,
    ),
    roas:
      m.revenueRoas.status === "available"
        ? `${m.revenueRoas.ratioDecimal}×`
        : "Not available",
    cpc: rate(m.cpc),
    cpqw: rate(m.cpqw),
    cpa: rate(m.cpa),
  };
}

// Issued snapshot export, not a new calculation or filtered campaign total.
export function clarityCsv(
  version: ClarityReportVersion,
  context?: TimedReportPresentation,
  explicitScope?: string,
  provenance: EvidenceProvenance = "unknown",
) {
  const metrics = clarityMetrics(version);
  const raw = version.metricSnapshot.metrics;
  const metricFreshness: Record<keyof typeof metrics, string> = {
    clicks: raw.cpc.dataFreshness.dataThrough,
    qualified: raw.cpqw.dataFreshness.dataThrough,
    activated: raw.cpa.dataFreshness.dataThrough,
    spend: raw.revenueRoas.dataFreshness.dataThrough,
    revenue: raw.revenueRoas.dataFreshness.dataThrough,
    roas: raw.revenueRoas.dataFreshness.dataThrough,
    cpc: raw.cpc.dataFreshness.dataThrough,
    cpqw: raw.cpqw.dataFreshness.dataThrough,
    cpa: raw.cpa.dataFreshness.dataThrough,
  };
  const provenanceScope = {
    synthetic:
      "synthetic demo evidence; wallet signatures and consent simulated",
    non_mainnet: "non-mainnet retained evidence",
    retained: "retained issued evidence",
    unknown: "exact outcome provenance unavailable",
  }[provenance];
  const scope = `${
    explicitScope ??
    (context
      ? "issued campaign snapshot; retained consented history only"
      : "complete issued campaign snapshot")
  }; ${provenanceScope}`;
  const rows = [
    ["report_version", "issued_at", "data_through", "metric", "value", "scope"],
    ...Object.entries(metrics).map(([name, value]) => [
      String(version.version),
      version.issuedAt,
      metricFreshness[name as keyof typeof metrics],
      name,
      value === null ? "not_available" : String(value),
      scope,
    ]),
  ];
  if (context)
    rows.push(
      ...[
        ["cost_basis", "Reviewed contracted costs; not payments made"],
        ["approved_flight_start", context.approvedFlight.startedAt],
        ["approved_flight_end", context.approvedFlight.endedAt],
        ["measurement_start", context.measurementWindow.startedAt],
        ["measurement_end", context.measurementWindow.endedAt],
        ["evidence_checked_at", context.coverage.checkedAt],
        [
          "coverage",
          "Retained consented history only; provider exhaustion not independently verified",
        ],
        ["unavailable", "Activation, protocol revenue and impressions"],
      ].map(([name, value]) => [
        String(version.version),
        version.issuedAt,
        "",
        name!,
        value!,
        "Report context",
      ]),
    );
  return rows
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
}
