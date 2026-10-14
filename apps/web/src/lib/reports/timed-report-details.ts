import { z } from "zod";
import {
  commercialPlanSnapshotCompensationLineSchema,
  commercialPlanSnapshotPackageSchema,
} from "@landed/contracts";
import {
  computeCreatorEconomics,
  retainedReportMicros,
} from "@landed/analytics";
import { projectReportEvidencePathSchema } from "@landed/db";
import type { ClarityReportVersion } from "./clarity";
import type { TimedReportPresentation } from "./timed-report-presentation";

const options = commercialPlanSnapshotCompensationLineSchema.options;
const terms = z.discriminatedUnion("assetType", [
  options[0].strict(),
  options[1].strict(),
]);
const historicalPackage = commercialPlanSnapshotPackageSchema
  .strict()
  .safeExtend({ compensationLines: z.array(terms).max(5) });
export const timedReportDetailsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reportVersionId: z.uuid(),
  metricSnapshotId: z.uuid(),
  commercialPlanVersionId: z.uuid(),
  packages: z.array(historicalPackage).min(1).max(1000),
  additionalCosts: z.enum(["none_declared", "unknown"]),
  costLines: z
    .array(
      z.strictObject({
        packageId: z.uuid(),
        creatorId: z.uuid(),
        compensationLineId: z.uuid(),
        terms,
        inclusion: z.enum(["included", "excluded"]),
        reason: z.string().min(1).max(500),
      }),
    )
    .max(5000),
  paths: z.array(projectReportEvidencePathSchema).max(10000),
});
export type TimedReportDetails = z.infer<typeof timedReportDetailsSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sameSet(actual: string[], expected: string[]) {
  const a = actual.map((x) => x.toLowerCase()),
    b = expected.map((x) => x.toLowerCase());
  return (
    new Set(a).size === a.length &&
    new Set(b).size === b.length &&
    a.sort().join("|") === b.sort().join("|")
  );
}
/** Pure historical projection. SQL provenance and caller authorization remain server-side. */
export function buildTimedCreatorEconomics(
  version: ClarityReportVersion,
  context: TimedReportPresentation,
  raw: unknown,
) {
  const detail = timedReportDetailsSchema.parse(raw);
  const fail = () => {
    throw new Error("Issued historical detail is inconsistent.");
  };
  if (
    detail.reportVersionId !== version.id ||
    detail.metricSnapshotId !== version.metricSnapshot.id ||
    detail.commercialPlanVersionId !== context.commercialPlanVersionId
  )
    fail();
  if (
    new Set(detail.packages.map((p) => p.creatorId)).size !==
      detail.packages.length ||
    new Set(detail.packages.map((p) => p.id)).size !== detail.packages.length
  )
    fail();
  const expected = detail.packages.flatMap((p) =>
    p.compensationLines.map((line) => ({ p, line })),
  );
  if (
    !sameSet(
      detail.costLines.map((l) => l.compensationLineId),
      expected.map((x) => x.line.id),
    )
  )
    fail();
  for (const l of detail.costLines) {
    const match = expected.find((x) => x.line.id === l.compensationLineId);
    if (
      !match ||
      match.p.id !== l.packageId ||
      match.p.creatorId !== l.creatorId ||
      canonical(match.line) !== canonical(l.terms)
    )
      fail();
  }
  const qualified = version.metricSnapshot.metrics.cpqw.denominator;
  if (
    qualified.status !== "available" ||
    qualified.kind !== "qualified_wallet_count" ||
    qualified.value !== detail.paths.length ||
    !sameSet(
      detail.paths.map((p) => p.attributionFactId),
      qualified.evidenceIds,
    )
  )
    fail();
  for (const path of detail.paths) {
    const pkg = detail.packages.find((p) => p.creatorId === path.creatorId);
    if (
      !pkg ||
      path.reportVersionId !== version.id ||
      path.metricSnapshotId !== version.metricSnapshot.id ||
      path.metric !== "qualified_wallets" ||
      path.creatorName !== `Creator ${path.creatorId}` ||
      path.contentAssetLabel !== `Approved package: ${pkg.packageLabel}` ||
      !path.primaryRoasEligible ||
      !["verified", "strong"].includes(path.confidence) ||
      path.conversionTime !== path.eventTime ||
      !version.metricSnapshot.metrics.cpqw.conversionRuleVersionIds.includes(
        path.conversionRuleVersionId,
      )
    )
      fail();
    const time = retainedReportMicros(path.conversionTime),
      touch = retainedReportMicros(path.touchTime);
    if (
      time < retainedReportMicros(context.measurementWindow.startedAt) ||
      time >= retainedReportMicros(context.measurementWindow.endedAt) ||
      touch >= time ||
      time - touch > 604800000000n
    )
      fail();
  }
  const spend = version.metricSnapshot.metrics.cpc.numerator;
  const included = detail.costLines.filter((l) => l.inclusion === "included");
  const lines = included.map((l) => {
    if (
      l.terms.assetType !== "cash" ||
      l.terms.model !== "fixed" ||
      l.terms.currencyCode !== context.costPolicy.currencyCode
    )
      return null;
    return {
      id: l.compensationLineId,
      kind: "creator_compensation" as const,
      valueMinor: l.terms.amountMinor,
      currencyCode: l.terms.currencyCode,
    };
  });
  if (spend.status === "available") {
    if (
      detail.additionalCosts !== "none_declared" ||
      spend.kind !== "eligible_campaign_spend_minor" ||
      lines.some((l) => l === null) ||
      !sameSet(
        spend.evidenceIds,
        included.map(
          (l) => `${detail.commercialPlanVersionId}:${l.compensationLineId}`,
        ),
      ) ||
      lines.reduce((sum, l) => sum + BigInt(l?.valueMinor ?? "0"), 0n) !==
        BigInt(spend.valueMinor)
    )
      fail();
  }
  const result = computeCreatorEconomics({
    currencyCode: context.costPolicy.currencyCode,
    eligibleSpend:
      spend.status === "available"
        ? {
            status: "available",
            valueMinor: spend.valueMinor,
            evidenceIds: included.map((l) => l.compensationLineId),
            evidenceLines: lines.filter((l) => l !== null),
          }
        : { status: "not_available", reason: spend.reason },
    qualifiedAttribution:
      qualified.status === "available"
        ? { status: "available", evidenceIds: qualified.evidenceIds }
        : { status: "not_available", reason: "source_incomplete" },
    activatedAttribution: {
      status: "not_available",
      reason: "source_not_configured",
    },
    creators: detail.packages.map((pkg) => ({
      creatorId: pkg.creatorId,
      creatorName: `Creator ${pkg.creatorId}`,
      creatorHandle: null,
      package: pkg,
      contentAssets: [],
      qualifiedAttributionIds: detail.paths
        .filter((p) => p.creatorId === pkg.creatorId)
        .map((p) => p.attributionFactId),
      activatedAttributionIds: [],
      confidence: detail.paths.some(
        (p) => p.creatorId === pkg.creatorId && p.confidence === "verified",
      )
        ? "verified"
        : detail.paths.some((p) => p.creatorId === pkg.creatorId)
          ? "strong"
          : null,
    })),
  });
  if (spend.status === "available" && result.unallocatedSpendMinor !== "0")
    fail();
  return result;
}
