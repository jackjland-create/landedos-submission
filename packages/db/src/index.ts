import {
  basketRecordSchema,
  campaignRecordSchema,
  commercialPlanSnapshotPackageSchema,
  conversionReplayJobRecordSchema,
  conversionRuleRecordSchema,
  conversionRuleVersionRecordSchema,
  commercialPlanApprovalRecordSchema,
  creatorDirectoryRecordSchema,
  creatorEvidenceRecordSchema,
  compensationLineRecordSchema,
  type BasketRecord,
  type CampaignRecord,
  type CompensationLineRecord,
  type ConversionReplayJobRecord,
  type ConversionRuleRecord,
  type CreatorDirectoryRecord,
  type CreatorEvidenceRecord,
  type CreatorRateQuoteRecord,
} from "@landed/contracts";
import {
  campaignMetricSnapshotSchema,
  retainedReportInstantSchema,
  retainedReportMicros,
  type CampaignMetricSnapshot,
} from "@landed/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const creatorSelect = `
  id,
  workspace_id,
  project_id,
  display_name,
  relationship_status,
  country_code,
  language_codes,
  created_at,
  updated_at,
  creator_channels (
    id,
    channel_type,
    handle,
    profile_url,
    language_code,
    audience_size,
    observed_at,
    source_label,
    is_primary
  ),
  creator_tags (
    tags (
      id,
      name,
      slug
    )
  ),
  creator_rate_quotes (
    id,
    package_label,
    deliverable_summary,
    amount_minor,
    currency_code,
    quoted_at,
    valid_until,
    source_label
  )
`;

const databaseTimestampSchema = z.iso.datetime({ offset: true });
const httpProfileUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "profile_url must use HTTP or HTTPS",
  });
const databaseEmailSchema = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

const creatorRateQuoteDatabaseRowSchema = z.object({
  id: z.uuid(),
  package_label: z.string(),
  deliverable_summary: z.string(),
  amount_minor: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().refine(Number.isSafeInteger, {
      message: "amount_minor exceeds the JavaScript safe integer range",
    }),
  ]),
  currency_code: z.enum(["GBP", "USD", "EUR"]),
  quoted_at: databaseTimestampSchema,
  valid_until: databaseTimestampSchema.nullable(),
  source_label: z.string(),
});

const creatorDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  display_name: z.string(),
  relationship_status: z.enum(["prospect", "active", "paused"]),
  country_code: z.string().nullable(),
  language_codes: z.array(z.string()),
  created_at: databaseTimestampSchema,
  updated_at: databaseTimestampSchema,
  creator_channels: z.array(
    z.object({
      id: z.uuid(),
      channel_type: z.enum([
        "x",
        "youtube",
        "tiktok",
        "instagram",
        "podcast",
        "telegram",
        "discord",
        "other",
      ]),
      handle: z.string(),
      profile_url: httpProfileUrlSchema.nullable(),
      language_code: z.string().nullable(),
      audience_size: z.coerce
        .number()
        .int()
        .nonnegative()
        .refine(Number.isSafeInteger, {
          message: "audience_size exceeds the JavaScript safe integer range",
        })
        .nullable(),
      observed_at: databaseTimestampSchema.nullable(),
      source_label: z.string().nullable(),
      is_primary: z.boolean(),
    }),
  ),
  creator_tags: z.array(
    z.object({
      tags: z
        .object({
          id: z.uuid(),
          name: z.string(),
          slug: z.string(),
        })
        .nullable(),
    }),
  ),
  creator_rate_quotes: z.array(creatorRateQuoteDatabaseRowSchema),
});

type CreatorDatabaseRow = z.infer<typeof creatorDatabaseRowSchema>;

const creatorEvidenceDatabaseRowSchema = creatorDatabaseRowSchema.extend({
  profile_summary: z.string().nullable(),
  profile_observed_at: databaseTimestampSchema.nullable(),
  profile_source_label: z.string().nullable(),
  creator_contacts: z.array(
    z.object({
      id: z.uuid(),
      contact_name: z.string(),
      contact_role: z.string().nullable(),
      email: databaseEmailSchema,
      observed_at: databaseTimestampSchema,
      source_label: z.string(),
    }),
  ),
});

const creatorEvidenceSelect = `
  ${creatorSelect},
  profile_summary,
  profile_observed_at,
  profile_source_label,
  creator_contacts (
    id,
    contact_name,
    contact_role,
    email,
    observed_at,
    source_label
  )
`;

export class CreatorQueryError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CreatorQueryError";
    this.code = code;
  }
}

export class BasketQueryError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "BasketQueryError";
    this.code = code;
  }
}

export class CampaignQueryError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CampaignQueryError";
    this.code = code;
  }
}

export class ConversionRuleQueryError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ConversionRuleQueryError";
    this.code = code;
  }
}

export class ReportQueryError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ReportQueryError";
    this.code = code;
  }
}

const reportPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.literal("issued"),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
  version: z.number().int().positive(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  campaignName: z.string().min(1),
  metricSnapshotId: z.uuid(),
  metricSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  metricSnapshot: campaignMetricSnapshotSchema,
  attributionModel: z.literal("last_eligible_creator_touch"),
  attributionWindowSeconds: z.literal(604800),
  issuedBy: z.uuid(),
  issuedAt: databaseTimestampSchema,
});

const reportDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  created_at: databaseTimestampSchema,
});

const reportVersionDatabaseRowSchema = z.object({
  id: z.uuid(),
  report_id: z.uuid(),
  metric_snapshot_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  version: z.coerce.number().int().positive(),
  status: z.literal("issued"),
  issued_by: z.uuid(),
  issued_at: databaseTimestampSchema,
  payload: reportPayloadSchema,
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const metricSnapshotDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  calculation_version: z.literal(1),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  source_started_at: databaseTimestampSchema,
  source_ended_at: databaseTimestampSchema,
  data_through: databaseTimestampSchema,
  calculated_at: databaseTimestampSchema,
  snapshot: campaignMetricSnapshotSchema,
  snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ProjectReportVersion = {
  id: string;
  version: number;
  issuedAt: string;
  issuedBy: string;
  payloadSha256: string;
  campaignName: string;
  attributionModel: "last_eligible_creator_touch";
  attributionWindowSeconds: 604800;
  metricSnapshotSha256: string;
  metricSnapshot: CampaignMetricSnapshot;
  measurementContext?: ProjectReportMeasurementContext | null;
};

export const reportTrendMetricSchema = z.enum([
  "qualified_wallets",
  "activated_wallets",
]);
export const reportBenchmarkKindSchema = z.enum([
  "approved_target",
  "portfolio_cohort",
]);

const exactCountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

export type ProjectReportDailyObservation = {
  id: string;
  metric: z.infer<typeof reportTrendMetricSchema>;
  periodStartedAt: string;
  periodEndedAt: string;
  observedThrough: string;
  periodState: "complete" | "partial";
  status: "available" | "not_available";
  valueDecimal: string | null;
  unavailableReason: string | null;
  sourceEvidenceIds: string[];
};

export type ProjectReportBenchmarkClaim = {
  id: string;
  kind: z.infer<typeof reportBenchmarkKindSchema>;
  metric: z.infer<typeof reportTrendMetricSchema>;
  label: string;
  sourceLabel: string;
  status: "available" | "not_available";
  valueDecimal: string | null;
  unavailableReason: string | null;
  sourceStartedAt: string | null;
  sourceEndedAt: string | null;
  approvedAt: string | null;
  cohortSampleSize: number | null;
};

export type ProjectReportMeasurementContext = {
  id: string;
  issuedAt: string;
  issuedBy: string;
  payloadSha256: string;
  observations: ProjectReportDailyObservation[];
  benchmarks: ProjectReportBenchmarkClaim[];
};

const reportMeasurementContextDatabaseRowSchema = z.object({
  id: z.uuid(),
  report_id: z.uuid(),
  report_version_id: z.uuid(),
  metric_snapshot_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  schema_version: z.literal(1),
  evidence_bound: z.boolean(),
  issued_by: z.uuid(),
  issued_at: databaseTimestampSchema,
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const reportDailyObservationDatabaseRowSchema = z.object({
  id: z.uuid(),
  context_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  metric: reportTrendMetricSchema,
  period_started_at: databaseTimestampSchema,
  period_ended_at: databaseTimestampSchema,
  observed_through: databaseTimestampSchema,
  period_state: z.enum(["complete", "partial"]),
  status: z.enum(["available", "not_available"]),
  value_decimal: exactCountSchema.nullable(),
  unavailable_reason: z.string().min(1).nullable(),
  source_evidence_ids: z.array(z.uuid()),
});

const reportBenchmarkClaimDatabaseRowSchema = z.object({
  id: z.uuid(),
  context_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  kind: reportBenchmarkKindSchema,
  metric: reportTrendMetricSchema,
  label: z.string().min(1),
  source_label: z.string().min(1),
  status: z.enum(["available", "not_available"]),
  value_decimal: exactCountSchema.nullable(),
  unavailable_reason: z.string().min(1).nullable(),
  source_started_at: databaseTimestampSchema.nullable(),
  source_ended_at: databaseTimestampSchema.nullable(),
  approved_at: databaseTimestampSchema.nullable(),
  cohort_sample_size: z.coerce.number().int().positive().nullable(),
});

export type ProjectReport = {
  id: string;
  workspaceId: string;
  projectId: string;
  campaignId: string;
  createdAt: string;
  versions: ProjectReportVersion[];
};

export const reportEvidenceMetricSchema = z.enum([
  "qualified_wallets",
  "activated_wallets",
]);

export type ReportEvidenceMetric = z.infer<typeof reportEvidenceMetricSchema>;

const reportEvidenceDatabaseRowSchema = z.object({
  report_version_id: z.uuid(),
  metric_snapshot_id: z.uuid(),
  metric: reportEvidenceMetricSchema,
  attribution_fact_id: z.uuid(),
  confidence: z.enum(["verified", "strong", "indicative", "unattributed"]),
  primary_roas_eligible: z.boolean(),
  attribution_model: z.literal("last_eligible_creator_touch"),
  attribution_window_seconds: z.literal(604800),
  touch_time: databaseTimestampSchema,
  creator_id: z.uuid(),
  creator_name: z.string().min(1),
  content_asset_id: z.uuid(),
  content_asset_label: z.string().min(1),
  click_event_id: z.uuid(),
  click_quality: z.literal("qualified"),
  wallet_proof_state: z.literal("signed_nonce_and_consent"),
  conversion_fact_id: z.uuid(),
  conversion_time: databaseTimestampSchema,
  conversion_rule_version_id: z.uuid(),
  conversion_rule_version: z.coerce.number().int().positive(),
  conversion_rule_name: z.string().min(1),
  conversion_rule_template: z.enum([
    "wallet_connected",
    "first_qualifying_transaction",
    "programme_action",
  ]),
  conversion_evaluator_version: z.union([z.literal(1), z.literal(2)]),
  value_kind: z.enum(["native_lamports", "token_base_units"]),
  raw_amount: z.string().regex(/^\d+$/),
  decimals: z.coerce.number().int().min(0).max(255),
  token_mint: z.string().nullable(),
  canonical_chain_event_id: z.uuid(),
  transaction_signature: z.string().min(64).max(88),
  instruction_index: z.coerce.number().int().nonnegative().nullable(),
  event_name: z.enum(["solana.native_transfer", "solana.token_transfer"]),
  finality: z.literal("finalized"),
  event_time: databaseTimestampSchema,
  transaction_slot: z.string().regex(/^\d+$/),
  environment: z.enum(["demo", "devnet", "mainnet"]),
});

export const projectReportEvidencePathSchema = z
  .strictObject({
    reportVersionId: z.uuid(),
    metricSnapshotId: z.uuid(),
    metric: reportEvidenceMetricSchema,
    attributionFactId: z.uuid(),
    confidence: z.enum(["verified", "strong", "indicative", "unattributed"]),
    primaryRoasEligible: z.boolean(),
    attributionModel: z.literal("last_eligible_creator_touch"),
    attributionWindowSeconds: z.literal(604800),
    touchTime: z.iso.datetime(),
    creatorId: z.uuid(),
    creatorName: z.string().min(1),
    contentAssetId: z.uuid(),
    contentAssetLabel: z.string().min(1),
    clickEventId: z.uuid(),
    clickQuality: z.literal("qualified"),
    walletProofState: z.literal("signed_nonce_and_consent"),
    conversionFactId: z.uuid(),
    conversionTime: z.iso.datetime(),
    conversionRuleVersionId: z.uuid(),
    conversionRuleVersion: z.number().int().positive(),
    conversionRuleName: z.string().min(1),
    conversionRuleTemplate: z.enum([
      "wallet_connected",
      "first_qualifying_transaction",
      "programme_action",
    ]),
    conversionEvaluatorVersion: z.union([z.literal(1), z.literal(2)]),
    valueKind: z.enum(["native_lamports", "token_base_units"]),
    rawAmount: z.string().regex(/^\d+$/),
    decimals: z.number().int().min(0).max(255),
    tokenMint: z.string().nullable(),
    canonicalChainEventId: z.uuid(),
    transactionSignature: z.string().min(64).max(88),
    instructionIndex: z.number().int().nonnegative().nullable(),
    eventName: z.enum(["solana.native_transfer", "solana.token_transfer"]),
    finality: z.literal("finalized"),
    eventTime: z.iso.datetime(),
    transactionSlot: z.string().regex(/^\d+$/),
    environment: z.enum(["demo", "devnet", "mainnet"]),
  })
  .refine(
    (path) =>
      path.conversionEvaluatorVersion === 1 ||
      (path.environment === "devnet" &&
        path.conversionRuleTemplate === "first_qualifying_transaction" &&
        path.eventName === "solana.native_transfer" &&
        path.valueKind === "native_lamports" &&
        path.rawAmount === "1" &&
        path.decimals === 9 &&
        path.tokenMint === null),
    "Evaluator V2 evidence requires the exact Devnet response scope",
  );

export type ProjectReportEvidencePath = z.infer<
  typeof projectReportEvidencePathSchema
>;

function mapReportEvidencePath(raw: unknown): ProjectReportEvidencePath {
  const row = reportEvidenceDatabaseRowSchema.parse(raw);
  if (
    row.conversion_evaluator_version === 2 &&
    (row.environment !== "devnet" ||
      row.conversion_rule_template !== "first_qualifying_transaction" ||
      row.event_name !== "solana.native_transfer" ||
      row.value_kind !== "native_lamports" ||
      row.raw_amount !== "1")
  ) {
    throw new ReportQueryError("Evaluator V2 evidence scope is unsupported.");
  }
  const evidenceInstant = (value: string) => {
    if (row.conversion_evaluator_version === 1)
      return new Date(value).toISOString();
    const micros = retainedReportMicros(
      retainedReportInstantSchema.parse(value),
    );
    const remainder = ((micros % 1000n) + 1000n) % 1000n;
    return new Date(Number((micros - remainder) / 1000n))
      .toISOString()
      .replace("Z", `${remainder.toString().padStart(3, "0")}Z`);
  };
  if (row.event_time !== row.conversion_time) {
    throw new ReportQueryError("Conversion and transaction evidence disagree.");
  }

  return projectReportEvidencePathSchema.parse({
    reportVersionId: row.report_version_id,
    metricSnapshotId: row.metric_snapshot_id,
    metric: row.metric,
    attributionFactId: row.attribution_fact_id,
    confidence: row.confidence,
    primaryRoasEligible: row.primary_roas_eligible,
    attributionModel: row.attribution_model,
    attributionWindowSeconds: row.attribution_window_seconds,
    touchTime: evidenceInstant(row.touch_time),
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    contentAssetId: row.content_asset_id,
    contentAssetLabel: row.content_asset_label,
    clickEventId: row.click_event_id,
    clickQuality: row.click_quality,
    walletProofState: row.wallet_proof_state,
    conversionFactId: row.conversion_fact_id,
    conversionTime: evidenceInstant(row.conversion_time),
    conversionRuleVersionId: row.conversion_rule_version_id,
    conversionRuleVersion: row.conversion_rule_version,
    conversionRuleName: row.conversion_rule_name,
    conversionRuleTemplate: row.conversion_rule_template,
    conversionEvaluatorVersion: row.conversion_evaluator_version,
    valueKind: row.value_kind,
    rawAmount: row.raw_amount,
    decimals: row.decimals,
    tokenMint: row.token_mint,
    canonicalChainEventId: row.canonical_chain_event_id,
    transactionSignature: row.transaction_signature,
    instructionIndex: row.instruction_index,
    eventName: row.event_name,
    finality: row.finality,
    eventTime: evidenceInstant(row.event_time),
    transactionSlot: row.transaction_slot,
    environment: row.environment,
  });
}

export async function getProjectReportEvidence(
  client: SupabaseClient,
  projectId: string,
  reportVersionId: string,
  metric: ReportEvidenceMetric,
): Promise<ProjectReportEvidencePath[]> {
  const result = await client.rpc("get_report_metric_evidence", {
    target_project_id: projectId,
    target_report_version_id: reportVersionId,
    target_metric: metric,
  });

  if (result.error) {
    throw new ReportQueryError(
      "Report evidence could not be loaded.",
      result.error.code,
    );
  }

  return (result.data ?? []).map(mapReportEvidencePath);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function mapReportVersion(
  raw: unknown,
  report: z.infer<typeof reportDatabaseRowSchema>,
  retainedSnapshot: z.infer<typeof metricSnapshotDatabaseRowSchema>,
  measurementContext: ProjectReportMeasurementContext | null,
): ProjectReportVersion {
  const row = reportVersionDatabaseRowSchema.parse(raw);
  const payload = row.payload;

  if (
    row.report_id !== report.id ||
    row.workspace_id !== report.workspace_id ||
    row.project_id !== report.project_id ||
    row.campaign_id !== report.campaign_id ||
    payload.reportId !== row.report_id ||
    payload.reportVersionId !== row.id ||
    payload.version !== row.version ||
    payload.workspaceId !== row.workspace_id ||
    payload.projectId !== row.project_id ||
    payload.campaignId !== row.campaign_id ||
    payload.metricSnapshotId !== row.metric_snapshot_id ||
    payload.issuedBy !== row.issued_by ||
    new Date(payload.issuedAt).toISOString() !==
      new Date(row.issued_at).toISOString() ||
    payload.metricSnapshot.id !== row.metric_snapshot_id ||
    payload.metricSnapshot.workspaceId !== row.workspace_id ||
    payload.metricSnapshot.projectId !== row.project_id ||
    payload.metricSnapshot.campaignId !== row.campaign_id ||
    retainedSnapshot.id !== row.metric_snapshot_id ||
    retainedSnapshot.workspace_id !== row.workspace_id ||
    retainedSnapshot.project_id !== row.project_id ||
    retainedSnapshot.campaign_id !== row.campaign_id ||
    retainedSnapshot.snapshot_sha256 !== payload.metricSnapshotSha256 ||
    canonicalJson(retainedSnapshot.snapshot) !==
      canonicalJson(payload.metricSnapshot) ||
    retainedSnapshot.calculation_version !==
      payload.metricSnapshot.calculationVersion ||
    retainedSnapshot.currency_code !==
      payload.metricSnapshot.metrics.cpc.currencyCode ||
    new Date(retainedSnapshot.source_started_at).toISOString() !==
      payload.metricSnapshot.metrics.cpc.sourceTimeRange.startedAt ||
    new Date(retainedSnapshot.source_ended_at).toISOString() !==
      payload.metricSnapshot.metrics.cpc.sourceTimeRange.endedAt ||
    new Date(retainedSnapshot.data_through).toISOString() !==
      payload.metricSnapshot.metrics.cpc.dataFreshness.dataThrough ||
    new Date(retainedSnapshot.calculated_at).toISOString() !==
      payload.metricSnapshot.metrics.cpc.dataFreshness.calculatedAt
  ) {
    throw new ReportQueryError("Issued report evidence is inconsistent.");
  }

  return {
    id: row.id,
    version: row.version,
    issuedAt: new Date(row.issued_at).toISOString(),
    issuedBy: row.issued_by,
    payloadSha256: row.payload_sha256,
    campaignName: payload.campaignName,
    attributionModel: payload.attributionModel,
    attributionWindowSeconds: payload.attributionWindowSeconds,
    metricSnapshotSha256: payload.metricSnapshotSha256,
    metricSnapshot: payload.metricSnapshot,
    measurementContext,
  };
}

function mapMeasurementContext(
  raw: unknown,
  report: z.infer<typeof reportDatabaseRowSchema>,
  observations: unknown[],
  benchmarks: unknown[],
): [
  string,
  {
    context: ProjectReportMeasurementContext;
    metricSnapshotId: string;
  },
] {
  const context = reportMeasurementContextDatabaseRowSchema.parse(raw);
  if (
    context.report_id !== report.id ||
    context.workspace_id !== report.workspace_id ||
    context.project_id !== report.project_id ||
    context.campaign_id !== report.campaign_id
  ) {
    throw new ReportQueryError("Retained report context is inconsistent.");
  }

  const mappedObservations = observations
    .map((value) => reportDailyObservationDatabaseRowSchema.parse(value))
    .filter((value) => value.context_id === context.id)
    .map((value) => {
      if (
        value.workspace_id !== context.workspace_id ||
        value.project_id !== context.project_id ||
        value.campaign_id !== context.campaign_id ||
        (value.status === "available") !== (value.value_decimal !== null) ||
        (value.status === "not_available") !==
          (value.unavailable_reason !== null)
      ) {
        throw new ReportQueryError("Retained daily evidence is inconsistent.");
      }
      return {
        id: value.id,
        metric: value.metric,
        periodStartedAt: new Date(value.period_started_at).toISOString(),
        periodEndedAt: new Date(value.period_ended_at).toISOString(),
        observedThrough: new Date(value.observed_through).toISOString(),
        periodState: value.period_state,
        status: value.status,
        valueDecimal: value.value_decimal,
        unavailableReason: value.unavailable_reason,
        sourceEvidenceIds: [...value.source_evidence_ids].sort(),
      } satisfies ProjectReportDailyObservation;
    })
    .sort((left, right) =>
      left.periodStartedAt.localeCompare(right.periodStartedAt),
    );

  const mappedBenchmarks = benchmarks
    .map((value) => reportBenchmarkClaimDatabaseRowSchema.parse(value))
    .filter((value) => value.context_id === context.id)
    .map((value) => {
      if (
        value.workspace_id !== context.workspace_id ||
        value.project_id !== context.project_id ||
        value.campaign_id !== context.campaign_id ||
        (value.status === "available") !== (value.value_decimal !== null) ||
        (value.status === "not_available") !==
          (value.unavailable_reason !== null)
      ) {
        throw new ReportQueryError(
          "Retained benchmark evidence is inconsistent.",
        );
      }
      return {
        id: value.id,
        kind: value.kind,
        metric: value.metric,
        label: value.label,
        sourceLabel: value.source_label,
        status: value.status,
        valueDecimal: value.value_decimal,
        unavailableReason: value.unavailable_reason,
        sourceStartedAt: value.source_started_at
          ? new Date(value.source_started_at).toISOString()
          : null,
        sourceEndedAt: value.source_ended_at
          ? new Date(value.source_ended_at).toISOString()
          : null,
        approvedAt: value.approved_at
          ? new Date(value.approved_at).toISOString()
          : null,
        cohortSampleSize: value.cohort_sample_size,
      } satisfies ProjectReportBenchmarkClaim;
    })
    .sort((left, right) =>
      `${left.metric}:${left.kind}`.localeCompare(
        `${right.metric}:${right.kind}`,
      ),
    );

  return [
    context.report_version_id,
    {
      context: {
        id: context.id,
        issuedAt: new Date(context.issued_at).toISOString(),
        issuedBy: context.issued_by,
        payloadSha256: context.payload_sha256,
        observations: mappedObservations,
        benchmarks: mappedBenchmarks,
      },
      metricSnapshotId: context.metric_snapshot_id,
    },
  ];
}

export async function getProjectReport(
  client: SupabaseClient,
  projectId: string,
  reportId: string,
): Promise<ProjectReport | null> {
  const reportResult = await client
    .from("reports")
    .select("id, workspace_id, project_id, campaign_id, created_at")
    .eq("project_id", projectId)
    .eq("id", reportId)
    .maybeSingle();

  if (reportResult.error) {
    throw new ReportQueryError(
      "Issued report could not be loaded.",
      reportResult.error.code,
    );
  }

  if (!reportResult.data) return null;

  const report = reportDatabaseRowSchema.parse(reportResult.data);
  const versionResult = await client
    .from("report_versions")
    .select(
      "id, report_id, metric_snapshot_id, workspace_id, project_id, campaign_id, version, status, issued_by, issued_at, payload, payload_sha256",
    )
    .eq("project_id", projectId)
    .eq("report_id", reportId)
    .order("version", { ascending: false });

  if (versionResult.error) {
    throw new ReportQueryError(
      "Issued report versions could not be loaded.",
      versionResult.error.code,
    );
  }

  const versions = (versionResult.data ?? []).map((row) =>
    reportVersionDatabaseRowSchema.parse(row),
  );

  if (versions.length === 0) {
    throw new ReportQueryError("Issued report has no retained version.");
  }

  const snapshotResult = await client
    .from("metric_snapshots")
    .select(
      "id, workspace_id, project_id, campaign_id, calculation_version, currency_code, source_started_at, source_ended_at, data_through, calculated_at, snapshot, snapshot_sha256",
    )
    .eq("project_id", projectId)
    .in(
      "id",
      versions.map((version) => version.metric_snapshot_id),
    );

  if (snapshotResult.error) {
    throw new ReportQueryError(
      "Issued metric evidence could not be loaded.",
      snapshotResult.error.code,
    );
  }

  const retainedSnapshots = new Map(
    (snapshotResult.data ?? []).map((raw) => {
      const snapshot = metricSnapshotDatabaseRowSchema.parse(raw);
      return [snapshot.id, snapshot] as const;
    }),
  );
  const versionIds = versions.map((version) => version.id);
  const contextResult = await client
    .from("report_measurement_contexts")
    .select(
      "id, report_id, report_version_id, metric_snapshot_id, workspace_id, project_id, campaign_id, schema_version, evidence_bound, issued_by, issued_at, payload_sha256",
    )
    .eq("project_id", projectId)
    .in("report_version_id", versionIds);

  if (contextResult.error) {
    throw new ReportQueryError(
      "Report trend context could not be loaded.",
      contextResult.error.code,
    );
  }

  const contexts = (contextResult.data ?? [])
    .map((row) => reportMeasurementContextDatabaseRowSchema.parse(row))
    .filter((context) => context.evidence_bound);
  const contextIds = contexts.map((context) => context.id);
  let rawObservations: unknown[] = [];
  let rawBenchmarks: unknown[] = [];

  if (contextIds.length > 0) {
    const [observationResult, benchmarkResult] = await Promise.all([
      client
        .from("report_daily_observations")
        .select(
          "id, context_id, workspace_id, project_id, campaign_id, metric, period_started_at, period_ended_at, observed_through, period_state, status, value_decimal, unavailable_reason, source_evidence_ids",
        )
        .eq("project_id", projectId)
        .in("context_id", contextIds),
      client
        .from("report_benchmark_claims")
        .select(
          "id, context_id, workspace_id, project_id, campaign_id, kind, metric, label, source_label, status, value_decimal, unavailable_reason, source_started_at, source_ended_at, approved_at, cohort_sample_size",
        )
        .eq("project_id", projectId)
        .in("context_id", contextIds),
    ]);
    if (observationResult.error || benchmarkResult.error) {
      throw new ReportQueryError(
        "Report trend evidence could not be loaded.",
        observationResult.error?.code ?? benchmarkResult.error?.code,
      );
    }
    rawObservations = observationResult.data ?? [];
    rawBenchmarks = benchmarkResult.data ?? [];
  }

  const contextsByVersion = new Map(
    contexts.map((context) =>
      mapMeasurementContext(context, report, rawObservations, rawBenchmarks),
    ),
  );
  const mappedVersions = versions.map((version) => {
    const retainedSnapshot = retainedSnapshots.get(version.metric_snapshot_id);
    if (!retainedSnapshot) {
      throw new ReportQueryError("Issued metric evidence is missing.");
    }
    const mappedContext = contextsByVersion.get(version.id);
    if (
      mappedContext &&
      mappedContext.metricSnapshotId !== version.metric_snapshot_id
    ) {
      throw new ReportQueryError(
        "Retained report context does not match the issued metric snapshot.",
      );
    }
    return mapReportVersion(
      version,
      report,
      retainedSnapshot,
      mappedContext?.context ?? null,
    );
  });

  return {
    id: report.id,
    workspaceId: report.workspace_id,
    projectId: report.project_id,
    campaignId: report.campaign_id,
    createdAt: new Date(report.created_at).toISOString(),
    versions: mappedVersions,
  };
}

function toCreatorRateQuoteRecord(
  row: z.infer<typeof creatorRateQuoteDatabaseRowSchema>,
): CreatorRateQuoteRecord {
  return {
    id: row.id,
    packageLabel: row.package_label,
    deliverableSummary: row.deliverable_summary,
    amountMinor: String(row.amount_minor),
    currencyCode: row.currency_code,
    quotedAt: new Date(row.quoted_at).toISOString(),
    validUntil: row.valid_until
      ? new Date(row.valid_until).toISOString()
      : null,
    sourceLabel: row.source_label,
  };
}

function sortedRateQuotes(row: CreatorDatabaseRow) {
  return row.creator_rate_quotes
    .map(toCreatorRateQuoteRecord)
    .sort((left, right) => right.quotedAt.localeCompare(left.quotedAt));
}

function toCreatorDirectoryRecord(
  unparsedRow: unknown,
): CreatorDirectoryRecord {
  const row: CreatorDatabaseRow = creatorDatabaseRowSchema.parse(unparsedRow);
  const rateQuotes = sortedRateQuotes(row);

  return creatorDirectoryRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    displayName: row.display_name,
    relationshipStatus: row.relationship_status,
    countryCode: row.country_code,
    languageCodes: row.language_codes,
    channels: row.creator_channels
      .map((channel) => ({
        id: channel.id,
        type: channel.channel_type,
        handle: channel.handle,
        profileUrl: channel.profile_url,
        languageCode: channel.language_code,
        audienceSize: channel.audience_size,
        observedAt: channel.observed_at
          ? new Date(channel.observed_at).toISOString()
          : null,
        sourceLabel: channel.source_label,
        isPrimary: channel.is_primary,
      }))
      .sort(
        (left, right) =>
          Number(right.isPrimary) - Number(left.isPrimary) ||
          left.type.localeCompare(right.type) ||
          left.handle.localeCompare(right.handle),
      ),
    tags: row.creator_tags
      .flatMap(({ tags }) => (tags ? [tags] : []))
      .sort((left, right) => left.name.localeCompare(right.name)),
    currentRate: rateQuotes[0] ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function toCreatorEvidenceRecord(
  unparsedRow: unknown,
  canViewContacts: boolean,
): CreatorEvidenceRecord {
  const row = creatorEvidenceDatabaseRowSchema.parse(unparsedRow);
  const directoryRecord = toCreatorDirectoryRecord(row);
  const contact = canViewContacts ? row.creator_contacts[0] : undefined;

  return creatorEvidenceRecordSchema.parse({
    ...directoryRecord,
    profileSummary: row.profile_summary,
    profileObservedAt: row.profile_observed_at
      ? new Date(row.profile_observed_at).toISOString()
      : null,
    profileSourceLabel: row.profile_source_label,
    contactAccess: canViewContacts
      ? contact
        ? "available"
        : "missing"
      : "restricted",
    contact: contact
      ? {
          id: contact.id,
          contactName: contact.contact_name,
          contactRole: contact.contact_role,
          email: contact.email,
          observedAt: new Date(contact.observed_at).toISOString(),
          sourceLabel: contact.source_label,
        }
      : null,
    rateQuotes: sortedRateQuotes(row),
  });
}

export async function listProjectCreators(
  client: SupabaseClient,
  projectId: string,
): Promise<CreatorDirectoryRecord[]> {
  const parsedProjectId = z.uuid().parse(projectId);
  const { data, error } = await client
    .from("creators")
    .select(creatorSelect)
    .eq("project_id", parsedProjectId)
    .order("display_name", { ascending: true });

  if (error) {
    throw new CreatorQueryError(
      "Creator directory could not be prepared.",
      error.code,
    );
  }

  return z.array(z.unknown()).parse(data).map(toCreatorDirectoryRecord);
}

export async function getProjectCreator(
  client: SupabaseClient,
  projectId: string,
  creatorId: string,
): Promise<CreatorDirectoryRecord | null> {
  const parsedProjectId = z.uuid().parse(projectId);
  const parsedCreatorId = z.uuid().parse(creatorId);
  const { data, error } = await client
    .from("creators")
    .select(creatorSelect)
    .eq("project_id", parsedProjectId)
    .eq("id", parsedCreatorId)
    .maybeSingle();

  if (error) {
    throw new CreatorQueryError(
      "Creator evidence could not be prepared.",
      error.code,
    );
  }

  return data ? toCreatorDirectoryRecord(data) : null;
}

export async function getProjectCreatorEvidence(
  client: SupabaseClient,
  projectId: string,
  creatorId: string,
): Promise<CreatorEvidenceRecord | null> {
  const parsedProjectId = z.uuid().parse(projectId);
  const parsedCreatorId = z.uuid().parse(creatorId);
  const { data, error } = await client
    .from("creators")
    .select(creatorEvidenceSelect)
    .eq("project_id", parsedProjectId)
    .eq("id", parsedCreatorId)
    .maybeSingle();

  if (error) {
    throw new CreatorQueryError(
      "Creator evidence could not be prepared.",
      error.code,
    );
  }

  if (!data) {
    return null;
  }

  const row = creatorEvidenceDatabaseRowSchema.parse(data);
  const { data: canViewContacts, error: permissionError } = await client.rpc(
    "can_manage_project",
    {
      target_project_id: parsedProjectId,
      target_workspace_id: row.workspace_id,
    },
  );

  if (permissionError) {
    throw new CreatorQueryError(
      "Creator contact access could not be prepared.",
      permissionError.code,
    );
  }

  return toCreatorEvidenceRecord(row, canViewContacts === true);
}

const basketDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  name: z.string(),
  objective: z.string().nullable(),
  outcome_metric: z
    .enum(["qualified_wallets", "average_order_value", "verified_revenue"])
    .nullable(),
  outcome_baseline_units: z
    .union([
      z.string().regex(/^\d+$/),
      z.number().int().nonnegative().refine(Number.isSafeInteger),
    ])
    .nullable(),
  outcome_target_units: z
    .union([
      z.string().regex(/^\d+$/),
      z.number().int().positive().refine(Number.isSafeInteger),
    ])
    .nullable(),
  outcome_currency_code: z.enum(["GBP", "USD", "EUR"]).nullable(),
  created_at: databaseTimestampSchema,
  updated_at: databaseTimestampSchema,
});

const basketScenarioDatabaseRowSchema = z.object({
  id: z.uuid(),
  code: z.enum(["A", "B", "C"]),
  name: z.string(),
});

const basketPackageDatabaseRowSchema = z.object({
  id: z.uuid(),
  creator_id: z.uuid(),
  source_rate_quote_id: z.uuid().nullable(),
  package_label: z.string(),
  deliverable_summary: z.string().nullable(),
  commercial_detail_revision: z.number().int().positive().optional(),
  commercial_basis: z.enum(["compensated", "unpaid_internal_test"]).optional(),
  unpaid_reason: z.string().nullable().optional(),
  channel_ids: z.array(z.uuid()).optional(),
  delivery_deadline: databaseTimestampSchema.nullable().optional(),
  usage_rights: z.string().nullable().optional(),
  exclusivity: z.string().nullable().optional(),
  compensation_lines: z.array(
    z.object({
      id: z.uuid(),
      asset_type: z.enum(["cash", "usdc", "token"]),
      compensation_model: z.enum(["fixed", "variable"]),
      amount_minor: z
        .union([
          z.string().regex(/^\d+$/),
          z.number().int().nonnegative().refine(Number.isSafeInteger),
        ])
        .nullable(),
      currency_code: z.enum(["GBP", "USD", "EUR"]).nullable(),
      token_mint: z.string().nullable(),
      token_amount_raw: z
        .union([
          z.string().regex(/^\d+$/),
          z.number().int().nonnegative().refine(Number.isSafeInteger),
        ])
        .nullable(),
      token_decimals: z.number().int().min(0).max(18).nullable(),
      unit_price_usd: z
        .union([
          z.string().regex(/^\d+(?:\.\d+)?$/),
          z.number().positive().refine(Number.isFinite),
        ])
        .nullable(),
      price_source: z.string().nullable(),
      valued_at: databaseTimestampSchema.nullable(),
      variable_unit: z.string().nullable(),
      created_at: databaseTimestampSchema,
      updated_at: databaseTimestampSchema,
    }),
  ),
  creators: z
    .object({
      display_name: z.string(),
      creator_channels: z.array(
        z.object({
          id: z.uuid().optional(),
          channel_type: z.enum([
            "x",
            "youtube",
            "tiktok",
            "instagram",
            "podcast",
            "telegram",
            "discord",
            "other",
          ]),
          handle: z.string(),
          audience_size: z.coerce
            .number()
            .int()
            .nonnegative()
            .refine(Number.isSafeInteger)
            .nullable(),
          observed_at: databaseTimestampSchema.nullable(),
          source_label: z.string().nullable(),
          is_primary: z.boolean(),
        }),
      ),
    })
    .nullable(),
});

const basketScenarioPackageDatabaseRowSchema = z.object({
  scenario_id: z.uuid(),
  package_id: z.uuid(),
});

const commercialPlanVersionDatabaseRowSchema = z.object({
  id: z.uuid(),
  scenario_id: z.uuid(),
  version: z.number().int().positive(),
  approved_by: z.uuid(),
  approved_at: databaseTimestampSchema,
  approval_record_version: z.union([z.literal(1), z.literal(2)]).default(1),
  approval_reason: z.string().nullable(),
  snapshot_hash: z.string(),
  basket_scenarios: z.object({
    code: z.enum(["A", "B", "C"]),
    name: z.string(),
  }),
});

type CompensationLineDatabaseRow = z.infer<
  typeof basketPackageDatabaseRowSchema
>["compensation_lines"][number];

function toCompensationLineRecord(
  row: CompensationLineDatabaseRow,
): CompensationLineRecord {
  const shared = {
    id: row.id,
    assetType: row.asset_type,
    model: row.compensation_model,
    variableUnit: row.variable_unit,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };

  return compensationLineRecordSchema.parse(
    row.asset_type === "cash"
      ? {
          ...shared,
          assetType: "cash",
          amountMinor: String(row.amount_minor),
          currencyCode: row.currency_code,
        }
      : {
          ...shared,
          assetType: row.asset_type,
          tokenMint: row.token_mint,
          tokenAmountRaw: String(row.token_amount_raw),
          tokenDecimals: row.token_decimals,
          unitPriceUsd: String(row.unit_price_usd),
          priceSource: row.price_source,
          valuedAt: row.valued_at
            ? new Date(row.valued_at).toISOString()
            : null,
        },
  );
}

// BSK-02 / BSK-09: older saved plans remain readable without weakening
// their validation or approval checks. Retry only the exact missing optional
// column, never all modern columns or a failed permission/network request.
// PGRST204 is not proof of absence: a stale cache could hide a V2 discriminator.
async function readBasketOptionalColumns<
  T extends {
    error: { code?: string; message?: string } | null;
  },
>(
  table: "creator_packages" | "commercial_plan_versions",
  optionalColumns: readonly string[],
  read: (columns: readonly string[]) => PromiseLike<T>,
): Promise<T> {
  let columns = [...optionalColumns];
  for (;;) {
    const result = await read(columns);
    const error = result.error;
    const missing = columns.find((column) =>
      error?.code === "42703"
        ? [
            `column ${table}.${column} does not exist`,
            `column "${table}"."${column}" does not exist`,
            `column public.${table}.${column} does not exist`,
            `column "public"."${table}"."${column}" does not exist`,
          ].includes(error.message ?? "")
        : false,
    );
    if (!missing) return result;
    // Each retry removes one still-selected allowlisted field. A repeated
    // error for an already omitted field terminates rather than looping.
    columns = columns.filter((column) => column !== missing);
  }
}

export async function getProjectBasket(
  client: SupabaseClient,
  projectId: string,
  basketId: string,
): Promise<BasketRecord | null> {
  const parsedProjectId = z.uuid().parse(projectId);
  const parsedBasketId = z.uuid().parse(basketId);
  const { data: basketData, error: basketError } = await client
    .from("baskets")
    .select(
      "id, workspace_id, project_id, name, objective, outcome_metric, outcome_baseline_units, outcome_target_units, outcome_currency_code, created_at, updated_at",
    )
    .eq("project_id", parsedProjectId)
    .eq("id", parsedBasketId)
    .maybeSingle();

  if (basketError) {
    throw new BasketQueryError(
      "Basket setup could not be prepared.",
      basketError.code,
    );
  }

  if (!basketData) {
    return null;
  }

  const basket = basketDatabaseRowSchema.parse(basketData);
  const [scenarioResult, packageResult, assignmentResult, approvalResult] =
    await Promise.all([
      client
        .from("basket_scenarios")
        .select("id, code, name")
        .eq("project_id", parsedProjectId)
        .eq("basket_id", parsedBasketId)
        .order("code", { ascending: true }),
      readBasketOptionalColumns(
        "creator_packages",
        [
          "commercial_detail_revision",
          "commercial_basis",
          "unpaid_reason",
          "channel_ids",
          "delivery_deadline",
          "usage_rights",
          "exclusivity",
        ],
        (columns) =>
          client
            .from("creator_packages")
            .select(
              `
          id,
          creator_id,
          source_rate_quote_id,
          package_label,
          deliverable_summary,
          ${columns.map((column) => `${column},`).join("\n")}
          compensation_lines (
            id,
            asset_type,
            compensation_model,
            amount_minor,
            currency_code,
            token_mint,
            token_amount_raw,
            token_decimals,
            unit_price_usd,
            price_source,
            valued_at,
            variable_unit,
            created_at,
            updated_at
          ),
          creators (
            display_name,
            creator_channels (
              id,
              channel_type,
              handle,
              audience_size,
              observed_at,
              source_label,
              is_primary
            )
          )
        `,
            )
            .eq("project_id", parsedProjectId)
            .eq("basket_id", parsedBasketId),
      ),
      client
        .from("basket_scenario_packages")
        .select("scenario_id, package_id")
        .eq("project_id", parsedProjectId)
        .eq("basket_id", parsedBasketId),
      readBasketOptionalColumns(
        "commercial_plan_versions",
        ["approval_record_version"],
        (columns) =>
          client
            .from("commercial_plan_versions")
            .select(
              `
          id,
          scenario_id,
          version,
          approved_by,
          approved_at,
          approval_reason,
          ${columns.map((column) => `${column},`).join("\n")}
          snapshot_hash,
          basket_scenarios (
            code,
            name
          )
        `,
            )
            .eq("project_id", parsedProjectId)
            .eq("basket_id", parsedBasketId)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle(),
      ),
    ]);

  const firstError =
    scenarioResult.error ??
    packageResult.error ??
    assignmentResult.error ??
    approvalResult.error;

  if (firstError) {
    throw new BasketQueryError(
      "Basket setup could not be prepared.",
      firstError.code,
    );
  }

  const scenarios = z
    .array(basketScenarioDatabaseRowSchema)
    .parse(scenarioResult.data);
  const packages = z
    .array(basketPackageDatabaseRowSchema)
    .parse(packageResult.data);
  // A partial upgrade/cache mismatch must not silently hide retained modern
  // terms merely because their revision discriminator was unavailable.
  if (
    packages.some(
      (row) =>
        row.commercial_detail_revision === undefined &&
        [
          row.commercial_basis,
          row.unpaid_reason,
          row.channel_ids,
          row.delivery_deadline,
          row.usage_rights,
          row.exclusivity,
        ].some((value) => value !== undefined),
    )
  ) {
    throw new BasketQueryError(
      "Package commercial details could not be verified.",
    );
  }
  const assignments = z
    .array(basketScenarioPackageDatabaseRowSchema)
    .parse(assignmentResult.data);
  const approval = approvalResult.data
    ? commercialPlanVersionDatabaseRowSchema.parse(approvalResult.data)
    : null;
  let latestApprovalIsCurrent: boolean | null = null;

  if (approval) {
    const { data: currentSnapshotHash, error: currentSnapshotError } =
      await client.rpc(
        approval.approval_record_version === 2
          ? "get_selected_basket_commercial_hash"
          : "get_basket_scenario_commercial_hash",
        {
          target_project_id: parsedProjectId,
          target_basket_id: parsedBasketId,
          ...(approval.approval_record_version === 2
            ? { target_plan_id: approval.id }
            : { target_scenario_id: approval.scenario_id }),
        },
      );

    if (currentSnapshotError) {
      throw new BasketQueryError(
        "Commercial approval status could not be verified.",
        currentSnapshotError.code,
      );
    }

    const parsedCurrentSnapshotHash = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(currentSnapshotHash);
    latestApprovalIsCurrent =
      parsedCurrentSnapshotHash === approval.snapshot_hash;
  }

  return basketRecordSchema.parse({
    id: basket.id,
    workspaceId: basket.workspace_id,
    projectId: basket.project_id,
    name: basket.name,
    objective: basket.objective,
    outcomeProfile:
      basket.outcome_metric &&
      basket.outcome_baseline_units !== null &&
      basket.outcome_target_units !== null
        ? {
            metric: basket.outcome_metric,
            baselineUnits: String(basket.outcome_baseline_units),
            targetUnits: String(basket.outcome_target_units),
            currencyCode: basket.outcome_currency_code,
          }
        : null,
    createdAt: new Date(basket.created_at).toISOString(),
    updatedAt: new Date(basket.updated_at).toISOString(),
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      code: scenario.code,
      name: scenario.name,
      packageIds: assignments
        .filter(({ scenario_id }) => scenario_id === scenario.id)
        .map(({ package_id }) => package_id),
    })),
    packages: packages
      .map((creatorPackage) => {
        const primaryChannel =
          creatorPackage.creators?.creator_channels.find(
            ({ is_primary }) => is_primary,
          ) ?? creatorPackage.creators?.creator_channels[0];

        return {
          id: creatorPackage.id,
          creatorId: creatorPackage.creator_id,
          creatorName:
            creatorPackage.creators?.display_name ?? "Creator unavailable",
          creatorHandle: primaryChannel?.handle ?? null,
          audience:
            primaryChannel?.audience_size !== null &&
            primaryChannel?.audience_size !== undefined &&
            primaryChannel.observed_at &&
            primaryChannel.source_label
              ? {
                  channelType: primaryChannel.channel_type,
                  size: primaryChannel.audience_size,
                  observedAt: new Date(
                    primaryChannel.observed_at,
                  ).toISOString(),
                  sourceLabel: primaryChannel.source_label,
                }
              : null,
          packageLabel: creatorPackage.package_label,
          deliverableSummary: creatorPackage.deliverable_summary,
          sourceRateQuoteId: creatorPackage.source_rate_quote_id,
          ...(creatorPackage.commercial_detail_revision
            ? {
                commercialDetailRevision:
                  creatorPackage.commercial_detail_revision,
                commercialDetail: {
                  schemaVersion: 2 as const,
                  channelIds: creatorPackage.channel_ids ?? [],
                  // Preserve PostgreSQL sub-millisecond precision, normalizing only the UTC suffix.
                  deliveryDeadline:
                    creatorPackage.delivery_deadline
                      ?.replace("+00:00", "Z")
                      .replace("+00", "Z") ?? null,
                  usageRights: creatorPackage.usage_rights ?? null,
                  exclusivity: creatorPackage.exclusivity ?? null,
                  commercialBasis:
                    creatorPackage.commercial_basis ?? "compensated",
                  unpaidReason: creatorPackage.unpaid_reason ?? null,
                },
                availableChannels: (
                  creatorPackage.creators?.creator_channels ?? []
                )
                  .filter((c) => c.id)
                  .map((c) => ({
                    id: c.id!,
                    channelType: c.channel_type,
                    handle: c.handle,
                  })),
              }
            : {}),
          compensationLines: creatorPackage.compensation_lines
            .map(toCompensationLineRecord)
            .sort((left, right) =>
              left.createdAt.localeCompare(right.createdAt),
            ),
        };
      })
      .sort((left, right) => left.creatorName.localeCompare(right.creatorName)),
    latestApproval: approval
      ? commercialPlanApprovalRecordSchema.parse({
          id: approval.id,
          scenarioId: approval.scenario_id,
          scenarioCode: approval.basket_scenarios.code,
          scenarioName: approval.basket_scenarios.name,
          version: approval.version,
          approvedBy: approval.approved_by,
          approvedAt: new Date(approval.approved_at).toISOString(),
          reason: approval.approval_reason,
          ...(approval.approval_record_version === 2
            ? { approvalRecordVersion: 2 }
            : {}),
          snapshotHash: approval.snapshot_hash,
        })
      : null,
    latestApprovalIsCurrent,
  });
}

const campaignDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  basket_id: z.uuid(),
  commercial_plan_version_id: z.uuid(),
  name: z.string(),
  objective: z.string(),
  outcome_metric: z.enum([
    "qualified_wallets",
    "average_order_value",
    "verified_revenue",
  ]),
  outcome_baseline_units: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().refine(Number.isSafeInteger),
  ]),
  outcome_target_units: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().positive().refine(Number.isSafeInteger),
  ]),
  outcome_currency_code: z.enum(["GBP", "USD", "EUR"]).nullable(),
  status: z.enum(["draft", "approved", "live", "finalizing", "finalized"]),
  created_by: z.uuid(),
  created_at: databaseTimestampSchema,
  updated_at: databaseTimestampSchema,
  commercial_plan_versions: z.object({
    version: z.number().int().positive(),
  }),
  campaign_creators: z.array(
    z.object({
      id: z.uuid(),
      creator_id: z.uuid(),
      source_package_id: z.uuid(),
      roster_position: z.number().int().positive(),
      package_label: z.string(),
      deliverable_summary: z.string(),
      commercial_terms: z.unknown(),
      terms_hash: z.string().regex(/^[0-9a-f]{64}$/),
      created_at: databaseTimestampSchema,
      creators: z
        .object({
          display_name: z.string(),
          creator_channels: z.array(
            z.object({
              handle: z.string(),
              is_primary: z.boolean(),
            }),
          ),
        })
        .nullable(),
    }),
  ),
  campaign_brief_versions: z.array(
    z.object({
      id: z.uuid(),
      version: z.number().int().positive(),
      request_id: z.uuid(),
      status: z.enum(["draft", "submitted", "revision_requested", "approved"]),
      objective: z.string(),
      audience: z.string().nullable(),
      key_message: z.string().nullable(),
      creator_direction: z.string().nullable(),
      compliance_notes: z.string().nullable(),
      reason: z.string(),
      actor_user_id: z.uuid(),
      created_at: databaseTimestampSchema,
    }),
  ),
  content_assets: z.array(
    z.object({
      id: z.uuid(),
      campaign_creator_id: z.uuid(),
      creator_id: z.uuid(),
      asset_index: z.number().int().positive(),
      label: z.string(),
      status: z.enum([
        "planned",
        "draft",
        "submitted",
        "revision_requested",
        "approved",
        "published",
      ]),
      submission_url: httpProfileUrlSchema.nullable(),
      published_url: httpProfileUrlSchema.nullable(),
      created_at: databaseTimestampSchema,
      updated_at: databaseTimestampSchema,
      content_asset_publication_evidence: z.array(
        z.object({
          id: z.uuid(),
          request_id: z.uuid(),
          version: z.number().int().positive(),
          platform: z.enum(["x", "instagram", "tiktok", "youtube", "other"]),
          published_url: httpProfileUrlSchema,
          published_at: databaseTimestampSchema,
          thumbnail_status: z.enum(["available", "not_available"]),
          thumbnail_url: httpProfileUrlSchema.nullable(),
          thumbnail_unavailable_reason: z.string().nullable(),
          source_label: z.string(),
          observed_at: databaseTimestampSchema,
          created_at: databaseTimestampSchema,
        }),
      ),
      tracked_links: z.array(
        z.object({
          id: z.uuid(),
          generation_request_id: z.uuid(),
          destination_url: httpProfileUrlSchema,
          project_tracking_destination_hosts: z.union([
            z.object({ revoked_at: databaseTimestampSchema.nullable() }),
            z
              .array(
                z.object({ revoked_at: databaseTimestampSchema.nullable() }),
              )
              .max(1),
            z.null(),
          ]),
          key_version: z.number().int().positive(),
          expires_at: databaseTimestampSchema,
          issued_by: z.uuid(),
          issued_at: databaseTimestampSchema,
          revoked_at: databaseTimestampSchema.nullable(),
          revoked_by: z.uuid().nullable(),
          revocation_request_id: z.uuid().nullable(),
          revocation_reason: z.string().nullable(),
          tracked_link_click_summaries: z.union([
            z.object({
              eligible_redirect_count: z.number().int().nonnegative(),
              ineligible_attempt_count: z.number().int().nonnegative(),
              total_attempt_count: z.number().int().nonnegative(),
              first_observed_at: databaseTimestampSchema,
              last_observed_at: databaseTimestampSchema,
            }),
            z
              .array(
                z.object({
                  eligible_redirect_count: z.number().int().nonnegative(),
                  ineligible_attempt_count: z.number().int().nonnegative(),
                  total_attempt_count: z.number().int().nonnegative(),
                  first_observed_at: databaseTimestampSchema,
                  last_observed_at: databaseTimestampSchema,
                }),
              )
              .max(1),
            z.null(),
          ]),
          tracked_link_click_quality_summaries: z.array(
            z.object({
              rule_version: z.number().int().positive(),
              duplicate_window_seconds: z.literal(1800),
              qualified_click_count: z.number().int().nonnegative(),
              duplicate_click_count: z.number().int().nonnegative(),
              rejected_click_count: z.number().int().nonnegative(),
              total_assessed_count: z.number().int().nonnegative(),
              first_assessed_at: databaseTimestampSchema,
              last_assessed_at: databaseTimestampSchema,
            }),
          ),
          tracked_link_anonymous_session_summaries: z.union([
            z.object({
              session_count: z.number().int().nonnegative(),
              bound_click_count: z.number().int().nonnegative(),
              first_created_at: databaseTimestampSchema,
              last_seen_at: databaseTimestampSchema,
            }),
            z
              .array(
                z.object({
                  session_count: z.number().int().nonnegative(),
                  bound_click_count: z.number().int().nonnegative(),
                  first_created_at: databaseTimestampSchema,
                  last_seen_at: databaseTimestampSchema,
                }),
              )
              .max(1),
            z.null(),
          ]),
        }),
      ),
      content_asset_activity: z.array(
        z.object({
          id: z.uuid(),
          request_id: z.uuid(),
          actor_user_id: z.uuid(),
          from_status: z
            .enum([
              "planned",
              "draft",
              "submitted",
              "revision_requested",
              "approved",
              "published",
            ])
            .nullable(),
          to_status: z.enum([
            "planned",
            "draft",
            "submitted",
            "revision_requested",
            "approved",
            "published",
          ]),
          evidence_url: httpProfileUrlSchema.nullable(),
          note: z.string(),
          created_at: databaseTimestampSchema,
        }),
      ),
    }),
  ),
  campaign_activity: z.array(
    z.object({
      id: z.uuid(),
      transition_request_id: z.uuid(),
      actor_user_id: z.uuid(),
      from_status: z.enum([
        "draft",
        "approved",
        "live",
        "finalizing",
        "finalized",
      ]),
      to_status: z.enum([
        "draft",
        "approved",
        "live",
        "finalizing",
        "finalized",
      ]),
      reason: z.string(),
      created_at: databaseTimestampSchema,
    }),
  ),
});

const campaignSelect = `
  id,
  workspace_id,
  project_id,
  basket_id,
  commercial_plan_version_id,
  name,
  objective,
  outcome_metric,
  outcome_baseline_units,
  outcome_target_units,
  outcome_currency_code,
  status,
  created_by,
  created_at,
  updated_at,
  commercial_plan_versions (
    version
  ),
  campaign_creators (
    id,
    creator_id,
    source_package_id,
    roster_position,
    package_label,
    deliverable_summary,
    commercial_terms,
    terms_hash,
    created_at,
    creators (
      display_name,
      creator_channels (
        handle,
        is_primary
      )
    )
  ),
  campaign_brief_versions (
    id,
    version,
    request_id,
    status,
    objective,
    audience,
    key_message,
    creator_direction,
    compliance_notes,
    reason,
    actor_user_id,
    created_at
  ),
  content_assets (
    id,
    campaign_creator_id,
    creator_id,
    asset_index,
    label,
    status,
    submission_url,
    published_url,
    created_at,
    updated_at,
    content_asset_publication_evidence (
      id,
      request_id,
      version,
      platform,
      published_url,
      published_at,
      thumbnail_status,
      thumbnail_url,
      thumbnail_unavailable_reason,
      source_label,
      observed_at,
      created_at
    ),
    tracked_links (
      id,
      generation_request_id,
      destination_url,
      project_tracking_destination_hosts (
        revoked_at
      ),
      key_version,
      expires_at,
      issued_by,
      issued_at,
      revoked_at,
      revoked_by,
      revocation_request_id,
      revocation_reason,
      tracked_link_click_summaries (
        eligible_redirect_count,
        ineligible_attempt_count,
        total_attempt_count,
        first_observed_at,
        last_observed_at
      ),
      tracked_link_click_quality_summaries (
        rule_version,
        duplicate_window_seconds,
        qualified_click_count,
        duplicate_click_count,
        rejected_click_count,
        total_assessed_count,
        first_assessed_at,
        last_assessed_at
      ),
      tracked_link_anonymous_session_summaries (
        session_count,
        bound_click_count,
        first_created_at,
        last_seen_at
      )
    ),
    content_asset_activity (
      id,
      request_id,
      actor_user_id,
      from_status,
      to_status,
      evidence_url,
      note,
      created_at
    )
  ),
  campaign_activity (
    id,
    transition_request_id,
    actor_user_id,
    from_status,
    to_status,
    reason,
    created_at
  )
`;

function toCampaignRecord(unparsedRow: unknown): CampaignRecord {
  const row = campaignDatabaseRowSchema.parse(unparsedRow);

  return campaignRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    basketId: row.basket_id,
    commercialPlanVersionId: row.commercial_plan_version_id,
    commercialPlanVersion: row.commercial_plan_versions.version,
    name: row.name,
    objective: row.objective,
    outcomeProfile: {
      metric: row.outcome_metric,
      baselineUnits: String(row.outcome_baseline_units),
      targetUnits: String(row.outcome_target_units),
      currencyCode: row.outcome_currency_code,
    },
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    roster: row.campaign_creators
      .map((rosterEntry) => {
        const commercialTerms = commercialPlanSnapshotPackageSchema.parse(
          rosterEntry.commercial_terms,
        );
        const primaryChannel =
          rosterEntry.creators?.creator_channels.find(
            ({ is_primary }) => is_primary,
          ) ?? rosterEntry.creators?.creator_channels[0];

        return {
          id: rosterEntry.id,
          creatorId: rosterEntry.creator_id,
          creatorName:
            commercialTerms.commercialDetail?.creatorDisplayName ??
            rosterEntry.creators?.display_name ??
            "Creator unavailable",
          creatorHandle: commercialTerms.commercialDetail
            ? (commercialTerms.commercialDetail.channels[0]?.handle ?? null)
            : (primaryChannel?.handle ?? null),
          sourcePackageId: rosterEntry.source_package_id,
          rosterPosition: rosterEntry.roster_position,
          packageLabel: rosterEntry.package_label,
          deliverableSummary: rosterEntry.deliverable_summary,
          commercialTerms,
          termsHash: rosterEntry.terms_hash,
          createdAt: new Date(rosterEntry.created_at).toISOString(),
        };
      })
      .sort((left, right) => left.rosterPosition - right.rosterPosition),
    briefVersions: row.campaign_brief_versions
      .map((brief) => ({
        id: brief.id,
        version: brief.version,
        requestId: brief.request_id,
        status: brief.status,
        objective: brief.objective,
        audience: brief.audience,
        keyMessage: brief.key_message,
        creatorDirection: brief.creator_direction,
        complianceNotes: brief.compliance_notes,
        reason: brief.reason,
        actorUserId: brief.actor_user_id,
        createdAt: new Date(brief.created_at).toISOString(),
      }))
      .sort((left, right) => right.version - left.version),
    contentAssets: row.content_assets
      .map((asset) => ({
        id: asset.id,
        campaignCreatorId: asset.campaign_creator_id,
        creatorId: asset.creator_id,
        assetIndex: asset.asset_index,
        label: asset.label,
        status: asset.status,
        submissionUrl: asset.submission_url,
        publishedUrl: asset.published_url,
        createdAt: new Date(asset.created_at).toISOString(),
        updatedAt: new Date(asset.updated_at).toISOString(),
        publicationEvidence: asset.content_asset_publication_evidence
          .map((evidence) => ({
            id: evidence.id,
            requestId: evidence.request_id,
            version: evidence.version,
            platform: evidence.platform,
            publishedUrl: evidence.published_url,
            publishedAt: new Date(evidence.published_at).toISOString(),
            thumbnailStatus: evidence.thumbnail_status,
            thumbnailUrl: evidence.thumbnail_url,
            thumbnailUnavailableReason: evidence.thumbnail_unavailable_reason,
            sourceLabel: evidence.source_label,
            observedAt: new Date(evidence.observed_at).toISOString(),
            createdAt: new Date(evidence.created_at).toISOString(),
          }))
          .sort(
            (left, right) =>
              right.version - left.version || left.id.localeCompare(right.id),
          ),
        trackedLinks: asset.tracked_links
          .map((link) => {
            const destinationPolicy = Array.isArray(
              link.project_tracking_destination_hosts,
            )
              ? (link.project_tracking_destination_hosts[0] ?? null)
              : link.project_tracking_destination_hosts;
            const clickSummary = Array.isArray(
              link.tracked_link_click_summaries,
            )
              ? (link.tracked_link_click_summaries[0] ?? null)
              : link.tracked_link_click_summaries;
            const qualitySummary = [
              ...link.tracked_link_click_quality_summaries,
            ].sort((left, right) => right.rule_version - left.rule_version)[0];
            const totalAttempts = clickSummary?.total_attempt_count ?? 0;
            const totalAssessed = qualitySummary?.total_assessed_count ?? 0;
            const sessionSummary = Array.isArray(
              link.tracked_link_anonymous_session_summaries,
            )
              ? (link.tracked_link_anonymous_session_summaries[0] ?? null)
              : link.tracked_link_anonymous_session_summaries;

            return {
              id: link.id,
              generationRequestId: link.generation_request_id,
              destinationUrl: link.destination_url,
              destinationPolicyActive: Boolean(
                destinationPolicy && destinationPolicy.revoked_at === null,
              ),
              keyVersion: link.key_version,
              expiresAt: new Date(link.expires_at).toISOString(),
              issuedBy: link.issued_by,
              issuedAt: new Date(link.issued_at).toISOString(),
              clickEvidence: {
                eligibleRedirects: clickSummary?.eligible_redirect_count ?? 0,
                ineligibleAttempts: clickSummary?.ineligible_attempt_count ?? 0,
                totalAttempts,
                firstObservedAt: clickSummary
                  ? new Date(clickSummary.first_observed_at).toISOString()
                  : null,
                lastObservedAt: clickSummary
                  ? new Date(clickSummary.last_observed_at).toISOString()
                  : null,
              },
              clickQuality: {
                ruleVersion: qualitySummary?.rule_version ?? null,
                duplicateWindowSeconds:
                  qualitySummary?.duplicate_window_seconds ?? null,
                qualifiedClicks: qualitySummary?.qualified_click_count ?? 0,
                duplicateClicks: qualitySummary?.duplicate_click_count ?? 0,
                rejectedClicks: qualitySummary?.rejected_click_count ?? 0,
                totalAssessed,
                pendingAssessment: totalAttempts - totalAssessed,
                firstAssessedAt: qualitySummary
                  ? new Date(qualitySummary.first_assessed_at).toISOString()
                  : null,
                lastAssessedAt: qualitySummary
                  ? new Date(qualitySummary.last_assessed_at).toISOString()
                  : null,
              },
              anonymousSessions: {
                sessions: sessionSummary?.session_count ?? 0,
                boundClicks: sessionSummary?.bound_click_count ?? 0,
                firstCreatedAt: sessionSummary
                  ? new Date(sessionSummary.first_created_at).toISOString()
                  : null,
                lastSeenAt: sessionSummary
                  ? new Date(sessionSummary.last_seen_at).toISOString()
                  : null,
              },
              revocation: link.revoked_at
                ? {
                    requestId: link.revocation_request_id,
                    actorUserId: link.revoked_by,
                    reason: link.revocation_reason,
                    revokedAt: new Date(link.revoked_at).toISOString(),
                  }
                : null,
            };
          })
          .sort(
            (left, right) =>
              new Date(right.issuedAt).getTime() -
              new Date(left.issuedAt).getTime(),
          ),
        activity: asset.content_asset_activity
          .map((activity) => ({
            id: activity.id,
            requestId: activity.request_id,
            actorUserId: activity.actor_user_id,
            fromStatus: activity.from_status,
            toStatus: activity.to_status,
            evidenceUrl: activity.evidence_url,
            note: activity.note,
            createdAt: new Date(activity.created_at).toISOString(),
          }))
          .sort(
            (left, right) =>
              new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime(),
          ),
      }))
      .sort(
        (left, right) =>
          left.assetIndex - right.assetIndex || left.id.localeCompare(right.id),
      ),
    activity: row.campaign_activity
      .map((entry) => ({
        id: entry.id,
        transitionRequestId: entry.transition_request_id,
        actorUserId: entry.actor_user_id,
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        reason: entry.reason,
        createdAt: new Date(entry.created_at).toISOString(),
      }))
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      ),
  });
}

export async function listProjectCampaigns(
  client: SupabaseClient,
  projectId: string,
): Promise<CampaignRecord[]> {
  const parsedProjectId = z.uuid().parse(projectId);
  const { data, error } = await client
    .from("campaigns")
    .select(campaignSelect)
    .eq("project_id", parsedProjectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new CampaignQueryError(
      "Campaign workspace could not be prepared.",
      error.code,
    );
  }

  return z.array(z.unknown()).parse(data).map(toCampaignRecord);
}

export async function getProjectCampaign(
  client: SupabaseClient,
  projectId: string,
  campaignId: string,
): Promise<CampaignRecord | null> {
  const parsedProjectId = z.uuid().parse(projectId);
  const parsedCampaignId = z.uuid().parse(campaignId);
  const { data, error } = await client
    .from("campaigns")
    .select(campaignSelect)
    .eq("project_id", parsedProjectId)
    .eq("id", parsedCampaignId)
    .maybeSingle();

  if (error) {
    throw new CampaignQueryError(
      "Campaign workspace could not be prepared.",
      error.code,
    );
  }

  return data ? toCampaignRecord(data) : null;
}

const conversionRuleVersionDatabaseRowSchema = z.object({
  id: z.uuid(),
  rule_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  version: z.coerce.number().int().positive(),
  template_code: z.enum([
    "wallet_connected",
    "first_qualifying_transaction",
    "programme_action",
  ]),
  name: z.string(),
  description: z.string(),
  effective_from: databaseTimestampSchema,
  effective_until: databaseTimestampSchema.nullable(),
  chain: z.literal("solana"),
  requires_wallet_binding: z.literal(true),
  minimum_finality: z.enum(["finalized", "not_applicable"]),
  value_mapping: z.enum(["none", "transfer_amount"]),
  revenue_mapping: z.literal("none"),
  attribution_window_seconds: z.coerce.number().int(),
  attribution_model: z.literal("last_eligible_creator_touch"),
  program_id: z.string().nullable(),
  event_discriminator: z.string().nullable(),
  evidence_capability: z.enum(["ready", "requires_programme_decoder"]),
  configured_environment: z
    .enum(["demo", "devnet", "mainnet"])
    .nullable()
    .optional(),
  destination_address: z.string().nullable().optional(),
  native_amount_lamports: z.coerce.string().nullable().optional(),
  change_reason: z.string(),
  created_by: z.uuid(),
  created_at: databaseTimestampSchema,
});

const conversionRuleDatabaseRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  stable_key: z.literal("primary-outcome"),
  created_by: z.uuid(),
  created_at: databaseTimestampSchema,
  conversion_rule_versions: z.array(conversionRuleVersionDatabaseRowSchema),
});

const conversionReplayRunDatabaseRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  approved_at: databaseTimestampSchema,
  source_started_at: databaseTimestampSchema,
  source_ended_at: databaseTimestampSchema,
  candidate_count: z.coerce.number().int().nonnegative(),
  matched_count: z.coerce.number().int().nonnegative(),
  unmatched_count: z.coerce.number().int().nonnegative(),
  report_count: z.coerce.number().int().nonnegative(),
  failure_code: z.string().nullable(),
  conversion_replay_campaigns: z.array(
    z.object({
      campaign_id: z.uuid(),
      campaign: z.union([
        z.object({ name: z.string().min(1).max(120) }),
        z.array(z.object({ name: z.string().min(1).max(120) })).max(1),
      ]),
      status: z.enum(["queued", "running", "completed", "failed"]),
      prior_report_version: z.object({
        id: z.uuid(),
        report_id: z.uuid(),
        version: z.coerce.number().int().positive(),
      }),
      output_report_version: z
        .object({
          id: z.uuid(),
          report_id: z.uuid(),
          version: z.coerce.number().int().positive(),
        })
        .nullable(),
    }),
  ),
});

const conversionReplayPreviewDatabaseRowSchema = z.object({
  replay_job_id: z.uuid(),
  eligible_campaign_count: z.coerce.number().int().nonnegative(),
});

const conversionReplayJobDatabaseRowSchema = z.object({
  id: z.uuid(),
  rule_id: z.uuid(),
  rule_version_id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  status: z.literal("pending"),
  affected_campaign_count: z.coerce.number().int().nonnegative(),
  requested_by: z.uuid(),
  requested_at: databaseTimestampSchema,
  conversion_replay_runs: z.union([
    z.array(conversionReplayRunDatabaseRowSchema).max(1),
    conversionReplayRunDatabaseRowSchema.nullable(),
  ]),
});

export async function getProjectConversionRule(
  client: SupabaseClient,
  projectId: string,
): Promise<ConversionRuleRecord | null> {
  const parsedProjectId = z.uuid().parse(projectId);
  const { data, error } = await client
    .from("conversion_rules")
    .select(
      `
        id,
        workspace_id,
        project_id,
        stable_key,
        created_by,
        created_at,
        conversion_rule_versions (
          id,
          rule_id,
          workspace_id,
          project_id,
          version,
          template_code,
          name,
          description,
          effective_from,
          effective_until,
          chain,
          requires_wallet_binding,
          minimum_finality,
          value_mapping,
          revenue_mapping,
          attribution_window_seconds,
          attribution_model,
          program_id,
          event_discriminator,
          evidence_capability,
          configured_environment,
          destination_address,
          native_amount_lamports,
          change_reason,
          created_by,
          created_at
        )
      `,
    )
    .eq("project_id", parsedProjectId)
    .eq("stable_key", "primary-outcome")
    .maybeSingle();

  if (error) {
    throw new ConversionRuleQueryError(
      "Conversion definitions could not be prepared.",
      error.code,
    );
  }

  if (!data) return null;
  const row = conversionRuleDatabaseRowSchema.parse(data);
  const versions = row.conversion_rule_versions
    .map((version) =>
      conversionRuleVersionRecordSchema.parse({
        id: version.id,
        ruleId: version.rule_id,
        workspaceId: version.workspace_id,
        projectId: version.project_id,
        version: version.version,
        templateCode: version.template_code,
        name: version.name,
        description: version.description,
        effectiveFrom: new Date(version.effective_from).toISOString(),
        effectiveUntil: version.effective_until
          ? new Date(version.effective_until).toISOString()
          : null,
        chain: version.chain,
        requiresWalletBinding: version.requires_wallet_binding,
        minimumFinality: version.minimum_finality,
        valueMapping: version.value_mapping,
        revenueMapping: version.revenue_mapping,
        attributionWindowSeconds: version.attribution_window_seconds,
        attributionModel: version.attribution_model,
        programId: version.program_id,
        eventDiscriminator: version.event_discriminator,
        evidenceCapability: version.evidence_capability,
        configuredEnvironment: version.configured_environment ?? null,
        destinationAddress: version.destination_address ?? null,
        nativeAmountLamports: version.native_amount_lamports ?? null,
        changeReason: version.change_reason,
        createdBy: version.created_by,
        createdAt: new Date(version.created_at).toISOString(),
      }),
    )
    .sort((left, right) => right.version - left.version);

  return conversionRuleRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    stableKey: row.stable_key,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    versions,
  });
}

export async function getProjectConversionReplayJobs(
  client: SupabaseClient,
  projectId: string,
): Promise<ConversionReplayJobRecord[]> {
  const parsedProjectId = z.uuid().parse(projectId);
  const [historyResult, previewResult] = await Promise.all([
    client
      .from("conversion_rule_replay_jobs")
      .select(
        `
        id,
        rule_id,
        rule_version_id,
        workspace_id,
        project_id,
        status,
        affected_campaign_count,
        requested_by,
        requested_at,
        conversion_replay_runs (
          id,
          status,
          approved_at,
          source_started_at,
          source_ended_at,
          candidate_count,
          matched_count,
          unmatched_count,
          report_count,
          failure_code,
          conversion_replay_campaigns (
            campaign_id,
            status,
            campaign:campaigns!conversion_replay_campaigns_campaign_scope_fkey (
              name
            ),
            prior_report_version:report_versions!conversion_replay_campaigns_prior_report_fkey (
              id,
              report_id,
              version
            ),
            output_report_version:report_versions!conversion_replay_campaigns_output_version_fkey (
              id,
              report_id,
              version
            )
          )
        )
      `,
      )
      .eq("project_id", parsedProjectId)
      .order("requested_at", { ascending: false }),
    client.rpc("get_project_conversion_replay_previews", {
      target_project_id: parsedProjectId,
    }),
  ]);

  if (historyResult.error || previewResult.error) {
    throw new ConversionRuleQueryError(
      "Conversion replay history could not be prepared.",
      historyResult.error?.code ?? previewResult.error?.code,
    );
  }

  const previews = new Map(
    z
      .array(conversionReplayPreviewDatabaseRowSchema)
      .parse(previewResult.data ?? [])
      .map((preview) => [
        preview.replay_job_id,
        preview.eligible_campaign_count,
      ]),
  );

  return z
    .array(conversionReplayJobDatabaseRowSchema)
    .parse(historyResult.data ?? [])
    .map((row) => {
      const execution = Array.isArray(row.conversion_replay_runs)
        ? row.conversion_replay_runs[0]
        : row.conversion_replay_runs;
      const eligibleCampaignCount = previews.get(row.id);
      if (eligibleCampaignCount === undefined) {
        throw new ConversionRuleQueryError(
          "Conversion replay eligibility could not be verified.",
          "REPLAY_PREVIEW_MISSING",
        );
      }
      return conversionReplayJobRecordSchema.parse({
        id: row.id,
        ruleId: row.rule_id,
        ruleVersionId: row.rule_version_id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        status: row.status,
        affectedCampaignCount: row.affected_campaign_count,
        eligibleCampaignCount,
        requestedBy: row.requested_by,
        requestedAt: new Date(row.requested_at).toISOString(),
        execution: execution
          ? {
              id: execution.id,
              status: execution.status,
              approvedAt: new Date(execution.approved_at).toISOString(),
              sourceStartedAt: new Date(
                execution.source_started_at,
              ).toISOString(),
              sourceEndedAt: new Date(execution.source_ended_at).toISOString(),
              candidateCount: execution.candidate_count,
              matchedCount: execution.matched_count,
              unmatchedCount: execution.unmatched_count,
              reportCount: execution.report_count,
              failureCode: execution.failure_code,
              comparisons: execution.conversion_replay_campaigns.map(
                (campaign) => {
                  const campaignRecord = Array.isArray(campaign.campaign)
                    ? campaign.campaign[0]
                    : campaign.campaign;
                  if (!campaignRecord) {
                    throw new ConversionRuleQueryError(
                      "Replay campaign identity could not be verified.",
                      "REPLAY_CAMPAIGN_MISSING",
                    );
                  }
                  return {
                    campaignId: campaign.campaign_id,
                    campaignName: campaignRecord.name,
                    status: campaign.status,
                    baselineVersion: campaign.prior_report_version.version,
                    reportId:
                      campaign.output_report_version?.report_id ??
                      campaign.prior_report_version.report_id,
                    replayVersion:
                      campaign.output_report_version?.version ?? null,
                  };
                },
              ),
            }
          : null,
      });
    });
}
export * from "./basket-strategy";
export * from "./basket-approval";
export * from "./campaign-measurement";
export { loadBasketTiming, saveBasketTiming } from "./basket-timing";
export {
  BasketTimedReviewError,
  previewTimedBasketApproval,
} from "./basket-timed-review";
