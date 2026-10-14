import {
  strategyBoundCommercialPlanSnapshotSchema,
  timedStrategyCommercialPlanSnapshotSchema,
} from "@landed/contracts";
import { z } from "zod";

import {
  retainedReportInstantSchema as instant,
  retainedReportMicros as micros,
} from "./report-instants";

const resultSchema = z.strictObject({
  conversionFactId: z.uuid(),
  attributionFactId: z.uuid(),
  calculationRequestId: z.uuid(),
  auditId: z.uuid(),
  creatorId: z.uuid(),
  contentAssetId: z.uuid(),
  canonicalChainEventId: z.uuid(),
  conversionTime: instant,
  touchTime: instant,
  confidence: z.literal("strong"),
  primaryRoasEligible: z.literal(true),
  value: z.strictObject({
    kind: z.enum(["native_lamports", "token_base_units"]),
    rawAmount: z.string().regex(/^(0|[1-9]\d{0,19})$/),
    decimals: z.number().int().min(0).max(255),
    tokenMint: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .nullable(),
  }),
  revenueKind: z.literal("none"),
});

/** Structural consistency only. Permission/provenance remain the private SQL
 * reader's responsibility; a caller-supplied object is not trusted evidence. */
const strategyReportSourcesSchema = z
  .strictObject({
    kind: z.literal("retained_report_sources"),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    campaignId: z.uuid(),
    ruleVersionId: z.uuid(),
    measurementWindow: z.strictObject({ startedAt: instant, endedAt: instant }),
    commercialPlanVersionId: z.uuid(),
    commercialPlanSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
    commercialPlanSnapshot: z.union([
      strategyBoundCommercialPlanSnapshotSchema,
      timedStrategyCommercialPlanSnapshotSchema,
    ]),
    results: z.array(resultSchema).max(10_000),
    walletAttributionEvidenceIds: z.array(z.uuid()).max(10_000),
    qualifiedClickEvidence: z
      .array(
        z.strictObject({
          clickId: z.uuid(),
          assessmentId: z.uuid(),
          qualityRuleVersionId: z.uuid(),
        }),
      )
      .max(10_000),
    completeness: z.literal("not_established"),
    protocolRevenueStatus: z.literal("source_not_configured"),
  })
  .superRefine((sources, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    const plan = sources.commercialPlanSnapshot;
    const binding = plan.strategyBinding;
    if (
      [
        sources.measurementWindow.startedAt,
        sources.measurementWindow.endedAt,
        ...sources.results.flatMap((row) => [
          row.conversionTime,
          row.touchTime,
        ]),
      ].some((value) => !instant.safeParse(value).success)
    ) {
      issue("Unsupported source timestamp");
      return;
    }
    const start = micros(sources.measurementWindow.startedAt);
    const end = micros(sources.measurementWindow.endedAt);
    if (
      plan.workspaceId !== sources.workspaceId ||
      plan.projectId !== sources.projectId ||
      binding.conversionRule.id !== sources.ruleVersionId ||
      binding.conversionRule.templateCode !== "first_qualifying_transaction" ||
      binding.conversionRule.revenueMapping !== "none"
    )
      issue("Approved source scope does not match");
    const window = z
      .strictObject({ startedAt: instant, endedAt: instant })
      .safeParse(binding.measurementWindow);
    if (
      !window.success ||
      start >= end ||
      (window.success &&
        (micros(window.data.startedAt) !== start ||
          micros(window.data.endedAt) !== end))
    )
      issue("Approved measurement period does not match");
    const effectiveFrom = instant.safeParse(
      binding.conversionRule.effectiveFrom,
    );
    const effectiveUntil =
      binding.conversionRule.effectiveUntil === null
        ? null
        : instant.safeParse(binding.conversionRule.effectiveUntil);
    if (
      !effectiveFrom.success ||
      (effectiveUntil !== null && !effectiveUntil.success) ||
      (effectiveFrom.success && micros(effectiveFrom.data) > start) ||
      (effectiveUntil?.success && micros(effectiveUntil.data) < end)
    )
      issue("Approved rule does not cover the exact measurement period");
    const unique = (ids: string[]) =>
      new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
    if (
      !unique(plan.packages.map((row) => row.id)) ||
      !unique(plan.packages.map((row) => row.creatorId))
    )
      issue("Duplicate approved package or creator identity");
    for (const key of [
      "conversionFactId",
      "attributionFactId",
      "calculationRequestId",
      "auditId",
      "canonicalChainEventId",
    ] as const)
      if (!unique(sources.results.map((row) => row[key])))
        issue(`Duplicate ${key}`);
    if (!unique(sources.walletAttributionEvidenceIds))
      issue("Duplicate wallet evidence");
    for (const key of ["clickId", "assessmentId"] as const)
      if (!unique(sources.qualifiedClickEvidence.map((row) => row[key])))
        issue(`Duplicate ${key}`);
    const attributionIds = new Set(
      sources.results.map((row) => row.attributionFactId),
    );
    if (
      sources.walletAttributionEvidenceIds.some((id) => !attributionIds.has(id))
    )
      issue("Wallet evidence is not a retained result");
    if (
      (sources.results.length === 0) !==
      (sources.walletAttributionEvidenceIds.length === 0)
    )
      issue("Wallet evidence is missing");
    const creators = new Set(plan.packages.map((row) => row.creatorId));
    for (const row of sources.results) {
      const time = micros(row.conversionTime);
      const touch = micros(row.touchTime);
      if (
        time < start ||
        time >= end ||
        touch >= time ||
        time - touch > 604800000000n
      )
        issue("Result lies outside the approved period or attribution window");
      if (!creators.has(row.creatorId))
        issue("Result creator is not in the approved roster");
      if (
        (row.value.kind === "native_lamports" &&
          (row.value.decimals !== 9 || row.value.tokenMint !== null)) ||
        (row.value.kind === "token_base_units" && row.value.tokenMint === null)
      )
        issue("Transfer units are inconsistent");
    }
    const lines = plan.packages.flatMap((row) => row.compensationLines);
    if (plan.packages.length > 1000 || !unique(lines.map((line) => line.id)))
      issue("Approved compensation identities are invalid");
    if (
      lines.some(
        (line) => line.assetType === "cash" && line.amountMinor.length > 78,
      )
    )
      issue("Approved cash amount exceeds supported precision");
  });

export const campaignReportSourcesSchema = strategyReportSourcesSchema.refine(
  (sources) =>
    sources.commercialPlanSnapshot.strategyBinding.schemaVersion === 1,
  "Legacy report preparation requires binding version 1",
);
export const timedCampaignReportSourcesSchema =
  strategyReportSourcesSchema.refine(
    (sources) =>
      sources.commercialPlanSnapshot.strategyBinding.schemaVersion === 2,
    "Timed report preparation requires binding version 2",
  );
export type CampaignReportSources = z.infer<typeof strategyReportSourcesSchema>;

function approvedCommitment(sources: CampaignReportSources) {
  const lines = sources.commercialPlanSnapshot.packages.flatMap(
    (entry) => entry.compensationLines,
  );
  if (lines.some((line) => line.model !== "fixed"))
    return {
      status: "not_available",
      reason: "variable_compensation",
    } as const;
  if (lines.some((line) => line.assetType !== "cash"))
    return {
      status: "not_available",
      reason: "non_cash_valuation_required",
    } as const;
  const cash = lines.filter((line) => line.assetType === "cash");
  if (new Set(cash.map((line) => line.currencyCode)).size !== 1)
    return { status: "not_available", reason: "mixed_currency" } as const;
  return {
    status: "available" as const,
    amountMinor: cash
      .reduce((total, line) => total + BigInt(line.amountMinor), 0n)
      .toString(),
    currencyCode: cash[0]!.currencyCode,
    compensationLineIds: cash.map((line) => line.id),
  };
}

/** Unissued preview, not CampaignMetricSnapshot. No coverage, valuation or
 * freshness values are manufactured to satisfy the issuance contract. */
export function buildCampaignReportPreview(rawSources: unknown) {
  const sources = campaignReportSourcesSchema.parse(rawSources);
  return buildRetainedPreview(sources);
}

/** Private timing-aware preparation only; retained flight is not fresh evidence. */
export function buildTimedCampaignReportPreview(rawSources: unknown) {
  const sources = timedCampaignReportSourcesSchema.parse(rawSources);
  const plan = timedStrategyCommercialPlanSnapshotSchema.parse(
    sources.commercialPlanSnapshot,
  );
  return {
    ...buildRetainedPreview(sources),
    approvedTiming: plan.strategyBinding.timing,
    temporalEvidence: partitionTimedEvidence(
      sources,
      plan.strategyBinding.timing,
    ),
  };
}

/** Event-time evidence partition only. Planned duration is not observed
 * coverage; a zero retained row count is not proof of zero campaign outcomes.
 * Wallet representatives are deduplicated over the whole source period and
 * clicks have no timestamps here, so neither is split into invented cohorts. */
function partitionTimedEvidence(
  sources: CampaignReportSources,
  timing: z.infer<
    typeof timedStrategyCommercialPlanSnapshotSchema
  >["strategyBinding"]["timing"],
) {
  const intervals = [
    {
      period: "pre_flight" as const,
      startedAt: timing.measurement.startedAt,
      endedAt: timing.flight.startedAt,
    },
    {
      period: "in_flight" as const,
      startedAt: timing.flight.startedAt,
      endedAt: timing.flight.endedAt,
    },
    {
      period: "post_flight" as const,
      startedAt: timing.flight.endedAt,
      endedAt: timing.measurement.endedAt,
    },
  ].filter((interval) => micros(interval.startedAt) < micros(interval.endedAt));
  return {
    basis: "conversion_event_time" as const,
    completeness: "not_established" as const,
    dataFreshness: "not_established" as const,
    periods: intervals.map(({ period, startedAt, endedAt }) => {
      const start = micros(startedAt),
        end = micros(endedAt);
      const results = sources.results.filter((row) => {
        const time = micros(row.conversionTime);
        return time >= start && time < end;
      });
      return {
        period,
        window: { startedAt, endedAt },
        plannedDurationMicroseconds: (end - start).toString(),
        observedCoverage: "not_established" as const,
        retainedResultCount: results.length,
        resultEvidence: results.map((row) => ({
          conversionFactId: row.conversionFactId,
          attributionFactId: row.attributionFactId,
          canonicalChainEventId: row.canonicalChainEventId,
          creatorId: row.creatorId,
          contentAssetId: row.contentAssetId,
          conversionTime: row.conversionTime,
          confidence: row.confidence,
        })),
      };
    }),
  };
}

function buildRetainedPreview(sources: CampaignReportSources) {
  return {
    kind: "unissued_campaign_metric_preview" as const,
    workspaceId: sources.workspaceId,
    projectId: sources.projectId,
    campaignId: sources.campaignId,
    ruleVersionId: sources.ruleVersionId,
    measurementWindow: sources.measurementWindow,
    commercialPlanVersionId: sources.commercialPlanVersionId,
    commercialPlanSnapshotHash: sources.commercialPlanSnapshotHash,
    approvedCommitment: approvedCommitment(sources),
    observedEvidence: {
      completeness: "not_established" as const,
      resultCount: sources.results.length,
      walletCount: sources.walletAttributionEvidenceIds.length,
      qualifiedClickCount: sources.qualifiedClickEvidence.length,
    },
    metrics: {
      cpc: { status: "not_available", reason: "source_incomplete" },
      cpqw: { status: "not_available", reason: "source_incomplete" },
      cpa: { status: "not_available", reason: "source_incomplete" },
      revenueRoas: { status: "not_available", reason: "source_not_configured" },
    },
    issuance: {
      status: "blocked" as const,
      reasons: [
        "source_coverage_not_established",
        "data_freshness_not_established",
        "eligible_spend_not_established",
        "approved_execution_not_established",
      ] as const,
    },
  };
}
