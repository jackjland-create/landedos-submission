import type { ClarityReportVersion } from "./clarity";
import { clarityMetrics, clarityMoney } from "./clarity";
import type { ReportSnapshotChartPoint } from "@/components/report-snapshot-chart";

/** RPT-06: presentation only; never fills a missing issued observation. */
export function overviewPoints(
  version: ClarityReportVersion,
): ReportSnapshotChartPoint[] {
  const observations = version.measurementContext?.observations ?? [];
  const safe = (value: string | null) =>
    value !== null &&
    /^\d+$/.test(value) &&
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  return [...new Set(observations.map((o) => o.periodStartedAt))]
    .sort()
    .map((date) => {
      const rows = observations.filter((o) => o.periodStartedAt === date);
      const q = rows.find((o) => o.metric === "qualified_wallets");
      const a = rows.find((o) => o.metric === "activated_wallets");
      const qualified = q?.status === "available" ? q.valueDecimal : null;
      const activated = a?.status === "available" ? a.valueDecimal : null;
      return {
        date,
        label: new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(date)),
        qualifiedWallets: safe(qualified),
        activatedWallets: safe(activated),
        qualifiedWalletsExact: qualified,
        activatedWalletsExact: activated,
        qualifiedPeriodState: q?.periodState,
        activatedPeriodState: a?.periodState,
      };
    });
}

export function roundedOverviewMoney(exact: string) {
  if (exact === "Not available") return exact;
  // Format already-issued decimal values; never convert money through floating point.
  return exact.replace(
    /(\d[\d,]*)\.(\d{2})$/,
    (_, whole: string, fraction: string) =>
      new Intl.NumberFormat("en-GB").format(
        BigInt(whole.replaceAll(",", "")) + (BigInt(fraction) >= 50n ? 1n : 0n),
      ),
  );
}

export function overviewDelta(
  version: ClarityReportVersion,
  previous: ClarityReportVersion | undefined,
  metric: "qualified" | "cpqw" | "revenue",
) {
  if (!previous || !overviewComparable(version, previous, metric)) return null;
  const now = clarityMetrics(version)[metric];
  const before = clarityMetrics(previous)[metric];
  if (
    now === null ||
    before === null ||
    now === "Not available" ||
    before === "Not available"
  )
    return null;
  const minor = (value: string | number) =>
    BigInt(String(value).replace(/[^0-9]/g, ""));
  const difference = minor(now) - minor(before);
  const magnitude = difference < 0n ? -difference : difference;
  const amount =
    metric === "qualified"
      ? String(magnitude)
      : roundedOverviewMoney(
          clarityMoney(
            String(magnitude),
            version.metricSnapshot.metrics.cpc.currencyCode,
          ),
        );
  return {
    text: `${difference > 0n ? "↑" : difference < 0n ? "↓" : ""} ${amount}`.trim(),
    positive:
      difference === 0n
        ? null
        : metric === "cpqw"
          ? difference < 0n
          : difference > 0n,
    before: String(before),
  };
}

export function overviewComparable(
  version: ClarityReportVersion,
  previous: ClarityReportVersion,
  metric: "qualified" | "cpqw" | "revenue",
) {
  const key = metric === "revenue" ? "revenueRoas" : "cpqw";
  const basis = (v: ClarityReportVersion) => {
    const m = v.metricSnapshot.metrics[key];
    return JSON.stringify({
      currency: m.currencyCode,
      calculation: m.calculationVersion,
      rules: [...m.conversionRuleVersionIds].sort(),
      classifier: m.attributionClassifierVersion,
      confidence: [...m.includedAttributionConfidence].sort(),
      start: m.sourceTimeRange.startedAt,
      valuationId: m.valuationPolicy.id,
      valuationVersion: m.valuationPolicy.version,
      activation: m.activationDefinition,
      definition: m.definition,
    });
  };
  return basis(version) === basis(previous);
}

export function retainedDisplayName(name: string, id: string) {
  return !hasRetainedDisplayName(name, id)
    ? `Name not retained · ${id.slice(-4)}`
    : name;
}

/** Display only: the original saved title remains unchanged. */
export function reportCampaignLabel(name: string) {
  return name.replace(/(?:\s+—\s+revised draft){2,}$/i, " — revised draft");
}

export function hasRetainedDisplayName(name: string, id: string) {
  return Boolean(name.trim()) && !name.includes(id);
}

/** Display-only identity from a verified Auth user, never an authorization claim. */
export function signedInDisplayName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  for (const key of ["full_name", "display_name", "name"]) {
    const value = user.user_metadata?.[key];
    if (typeof value === "string" && value.trim())
      return value.trim().slice(0, 80);
  }
  return user.email ?? "Signed-in user";
}
