import "server-only";

import { createHash } from "node:crypto";
import {
  buildCampaignReportReview,
  buildTimedCampaignReportReview,
  campaignReportReviewSchema,
  retainedReportMicros,
  timedCampaignReportReviewSchema,
} from "@landed/analytics";
import { z } from "zod";

const uuid = z.uuid().refine((value) => value === value.toLowerCase());
const requestId = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.iso.datetime().regex(/\.\d{6}Z$/);
const scopeSchema = z.strictObject({
  workspaceId: requestId,
  projectId: requestId,
  campaignId: requestId,
});
const candidateSchema = z.strictObject({
  calculationRequestId: requestId,
  conversionFactId: requestId,
  attributionFactId: requestId,
  protectedWalletMappingId: requestId,
  canonicalChainEventId: requestId,
});
const retainedCandidateSchema = candidateSchema.extend({
  calculationRequestId: uuid,
  conversionFactId: uuid,
  attributionFactId: uuid,
  protectedWalletMappingId: uuid,
  canonicalChainEventId: uuid,
});
const candidatesSchema = z
  .array(candidateSchema)
  .min(1)
  .max(100)
  .superRefine((items, ctx) => {
    for (const field of Object.keys(candidateSchema.shape) as Array<
      keyof z.infer<typeof candidateSchema>
    >) {
      if (new Set(items.map((item) => item[field])).size !== items.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate candidate identity",
        });
    }
  });
const previewSchema = z
  .strictObject({
    review: z.strictObject({
      schemaVersion: z.literal(1),
      kind: z.literal("exact_campaign_execution"),
      workspaceId: uuid,
      projectId: uuid,
      campaignId: uuid,
      commercialPlanVersionId: uuid,
      commercialPlanSnapshotHash: hash,
      ruleVersionId: uuid,
      measurementWindow: z.strictObject({
        startedAt: instant,
        endedAt: instant,
      }),
      environments: z
        .array(z.enum(["demo", "devnet", "mainnet"]))
        .min(1)
        .max(3),
      // Validate exact retained text before uniqueness validation; never
      // normalize the contents of a database-hashed review.
      candidates: z.array(retainedCandidateSchema).pipe(candidatesSchema),
    }),
    reviewHash: hash,
  })
  .superRefine(({ review }, ctx) => {
    // Canonical UTC strings have fixed microsecond precision, so lexical order
    // preserves the database's interval rather than rounding to milliseconds.
    if (review.measurementWindow.startedAt >= review.measurementWindow.endedAt)
      ctx.addIssue({ code: "custom", message: "Invalid measurement period" });
    if (
      new Set(review.environments).size !== review.environments.length ||
      [...review.environments].sort().join() !== review.environments.join()
    )
      ctx.addIssue({ code: "custom", message: "Invalid environment labels" });
  });
const receiptSchema = z.strictObject({
  approvalId: uuid,
  reviewHash: hash,
  batch: z.strictObject({
    campaignId: uuid,
    ruleVersionId: uuid,
    processedCount: z.number().int().min(1).max(100),
    insertedCount: z.number().int().min(0).max(100),
    results: z
      .array(
        z.strictObject({
          calculationRequestId: uuid,
          conversionFactId: uuid,
          attributionFactId: uuid,
          inserted: z.boolean(),
        }),
      )
      .min(1)
      .max(100),
  }),
  reportIssuance: z.literal("blocked"),
  completeness: z.literal("not_established"),
});

export type CampaignExecutionClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>;
};
type Scope = z.infer<typeof scopeSchema>;
type Preview = z.infer<typeof previewSchema>;

export class CampaignExecutionError extends Error {
  constructor(
    readonly outcome: "not_started" | "unconfirmed",
    readonly code?: string,
  ) {
    super("Campaign execution request could not be confirmed.");
    this.name = "CampaignExecutionError";
  }
}

function local<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CampaignExecutionError("not_started");
  return parsed.data;
}
function sameScope(scope: Scope, preview: Preview) {
  return (
    scope.workspaceId === preview.review.workspaceId &&
    scope.projectId === preview.review.projectId &&
    scope.campaignId === preview.review.campaignId
  );
}
async function rpc(
  client: CampaignExecutionClient,
  name: string,
  args: Record<string, unknown>,
) {
  let response;
  try {
    response = await client.rpc(name, args);
  } catch {
    throw new CampaignExecutionError("unconfirmed");
  }
  if (
    !response ||
    typeof response !== "object" ||
    !("data" in response) ||
    !("error" in response)
  )
    throw new CampaignExecutionError("unconfirmed");
  if (response.error !== null) {
    const code =
      response.error &&
      typeof response.error.code === "string" &&
      /^[0-9A-Z]{5}$/.test(response.error.code)
        ? response.error.code
        : undefined;
    throw new CampaignExecutionError("unconfirmed", code);
  }
  return response.data;
}

/** Private handoff only. No routes or jobs call this adapter; SQL runtime grants
 * remain revoked. The supplied client must preserve the authenticated actor.
 * Parsing is not authorization and does not authenticate the retained hash. */
export async function previewCampaignExecution(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawCandidates: unknown,
) {
  const scope = local(scopeSchema, rawScope);
  const candidates = local(candidatesSchema, rawCandidates);
  const data = await rpc(client, "preview_campaign_execution", {
    target_project_id: scope.projectId,
    target_campaign_id: scope.campaignId,
    target_candidates: candidates,
  });
  const parsed = previewSchema.safeParse(data);
  if (
    !parsed.success ||
    !sameScope(scope, parsed.data) ||
    JSON.stringify(parsed.data.review.candidates) !== JSON.stringify(candidates)
  )
    throw new CampaignExecutionError("unconfirmed");
  return parsed.data;
}

const executionRequestSchema = z.strictObject({
  approvalId: requestId,
  preview: previewSchema,
});
const approvalRequestSchema = executionRequestSchema.extend({
  reason: z.string().trim().min(8).max(240),
});

export async function approveCampaignExecution(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawRequest: unknown,
) {
  const scope = local(scopeSchema, rawScope);
  const request = local(approvalRequestSchema, rawRequest);
  if (!sameScope(scope, request.preview))
    throw new CampaignExecutionError("not_started");
  const result = await rpc(client, "approve_campaign_execution", {
    target_project_id: scope.projectId,
    target_campaign_id: scope.campaignId,
    target_approval_id: request.approvalId,
    target_review: request.preview.review,
    target_review_hash: request.preview.reviewHash,
    target_reason: request.reason,
  });
  if (result !== request.approvalId)
    throw new CampaignExecutionError("unconfirmed");
  return result;
}

export async function executeApprovedCampaignExecution(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawRequest: unknown,
) {
  const scope = local(scopeSchema, rawScope);
  const request = local(executionRequestSchema, rawRequest);
  if (!sameScope(scope, request.preview))
    throw new CampaignExecutionError("not_started");
  // Expected context is checked in SQL BEFORE execution, not used to replace
  // stored evidence/rules. Receipt checks remain defense in depth after the call.
  const data = await rpc(client, "execute_reviewed_campaign_execution", {
    target_workspace_id: scope.workspaceId,
    target_project_id: scope.projectId,
    target_campaign_id: scope.campaignId,
    target_approval_id: request.approvalId,
    target_review: request.preview.review,
    target_review_hash: request.preview.reviewHash,
  });
  return validateReceipt(data, scope, request.approvalId, request.preview);
}

function validateReceipt(
  data: unknown,
  scope: Scope,
  approvalId: string,
  preview: Preview,
) {
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) throw new CampaignExecutionError("unconfirmed");
  const receipt = parsed.data;
  const expected = preview.review;
  if (
    receipt.approvalId !== approvalId ||
    receipt.reviewHash !== preview.reviewHash ||
    receipt.batch.campaignId !== scope.campaignId ||
    receipt.batch.ruleVersionId !== expected.ruleVersionId ||
    receipt.batch.processedCount !== expected.candidates.length ||
    receipt.batch.results.length !== expected.candidates.length ||
    receipt.batch.insertedCount !==
      receipt.batch.results.filter((result) => result.inserted).length ||
    receipt.batch.results.some((result, index) => {
      const candidate = expected.candidates[index]!;
      return (
        result.calculationRequestId !== candidate.calculationRequestId ||
        result.conversionFactId !== candidate.conversionFactId ||
        result.attributionFactId !== candidate.attributionFactId
      );
    })
  )
    throw new CampaignExecutionError("unconfirmed");
  return receipt;
}

const recoverySchema = z.strictObject({
  approvalId: uuid,
  preview: previewSchema,
  reason: z.string().min(8).max(240),
  approvedAt: instant,
  readAt: instant,
  receipt: receiptSchema.nullable(),
});

/** A null receipt means not recorded in this read snapshot. It is not a failed
 * run, a zero result or permission to create another approval/retry automatically.
 * readAt describes this read, not provider freshness or campaign completeness. */
export async function loadCampaignExecutionReview(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawApprovalId: unknown,
) {
  const scope = local(scopeSchema, rawScope);
  const approvalId = local(requestId, rawApprovalId);
  const data = await rpc(client, "load_campaign_execution_review", {
    target_workspace_id: scope.workspaceId,
    target_project_id: scope.projectId,
    target_campaign_id: scope.campaignId,
    target_approval_id: approvalId,
  });
  return validateRecovery(data, scope, approvalId);
}

function validateRecovery(data: unknown, scope: Scope, approvalId: string) {
  const parsed = recoverySchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.approvalId !== approvalId ||
    !sameScope(scope, parsed.data.preview)
  )
    throw new CampaignExecutionError("unconfirmed");
  const retained = parsed.data;
  if (retained.receipt !== null)
    validateReceipt(retained.receipt, scope, approvalId, retained.preview);
  return {
    ...retained,
    executionObservation:
      retained.receipt === null
        ? ("receipt_not_recorded" as const)
        : ("receipt_recorded" as const),
  };
}

const executionReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("execution_report_review"),
  execution: recoverySchema,
  reportReview: campaignReportReviewSchema,
  reportScope: z.literal("campaign_wide"),
  reportIssuance: z.literal("blocked"),
  completeness: z.literal("not_established"),
});
const timedExecutionReportSchema = executionReportSchema.extend({
  reportReview: timedCampaignReportReviewSchema,
});

/** Structural validation for the private coherent report bundle, whose
 * observation clock is intentionally omitted from the retained source hash. */
export function validateCompletedTimedReportExecution(raw: unknown) {
  const bridge = local(
    z.object({
      execution: z.object({
        approvalId: uuid,
        preview: previewSchema,
        receipt: receiptSchema,
      }),
      reportReview: timedCampaignReportReviewSchema,
    }),
    raw,
  );
  const sources = bridge.reportReview.reportSources;
  const approved = bridge.execution.preview.review;
  for (const key of [
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "commercialPlanSnapshotHash",
    "ruleVersionId",
  ] as const)
    if (sources[key] !== approved[key])
      throw new CampaignExecutionError("unconfirmed");
  for (const key of ["startedAt", "endedAt"] as const)
    if (
      retainedReportMicros(sources.measurementWindow[key]) !==
      retainedReportMicros(approved.measurementWindow[key])
    )
      throw new CampaignExecutionError("unconfirmed");
  const receipt = validateReceipt(
    bridge.execution.receipt,
    {
      workspaceId: sources.workspaceId,
      projectId: sources.projectId,
      campaignId: sources.campaignId,
    },
    bridge.execution.approvalId,
    bridge.execution.preview,
  );
  if (
    receipt.batch.results.some(
      (retained) =>
        !sources.results.some(
          (result) =>
            result.calculationRequestId === retained.calculationRequestId &&
            result.conversionFactId === retained.conversionFactId &&
            result.attributionFactId === retained.attributionFactId,
        ),
    )
  )
    throw new CampaignExecutionError("unconfirmed");
  return bridge.execution.approvalId;
}

const sourceFingerprintProtocol = "landed:timed-report-retained-sources:v1";
const sourceFingerprintSchema = z.strictObject({
  protocol: z.literal(sourceFingerprintProtocol),
  algorithm: z.literal("sha256"),
  digest: hash,
  meaning: z.literal("retained_observations_only"),
});

// Only called with the already parsed, coherent RPC snapshot. Object key order
// is irrelevant; array order and exact timestamp representations remain bound.
function canonicalSourceJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSourceJson).join(",")}]`;
  if (typeof value !== "object" || value === undefined)
    throw new CampaignExecutionError("unconfirmed");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSourceJson(record[key])}`)
    .join(",")}}`;
}

function fingerprintTimedSources(
  result: Awaited<ReturnType<typeof readExecutionReport>>,
) {
  // Exclude exactly this volatile read clock, never evidence/job/approval times.
  const { readAt: _readAt, ...execution } = result.execution;
  void _readAt;
  return {
    protocol: sourceFingerprintProtocol,
    algorithm: "sha256" as const,
    digest: createHash("sha256")
      .update(`${sourceFingerprintProtocol}\0`, "utf8")
      .update(canonicalSourceJson({ ...result, execution }), "utf8")
      .digest("hex"),
    meaning: "retained_observations_only" as const,
  };
}

/** Private change detection only. Neither a supplied digest nor equality proves
 * authorization, completeness, freshness, recognized costs or permission to
 * issue. A future consumer must re-run the authorized coherent reader and all
 * issuance gates; never accept a client fingerprint as an approval token. */
export function compareTimedReportSourceFingerprints(
  previous: unknown,
  current: unknown,
) {
  const before = local(sourceFingerprintSchema, previous);
  const after = local(sourceFingerprintSchema, current);
  return {
    observation:
      before.digest === after.digest
        ? ("same_retained_sources" as const)
        : ("changed_retained_sources" as const),
    reportIssuance: "blocked" as const,
  };
}

/** One private coherent read, never execute/retry/issue. Campaign-wide evidence
 * may include other approved batches: this receipt does not certify coverage.
 * Timed strategy schemaVersion 2 remains unsupported by the existing report parser. */
export async function loadCampaignExecutionReportReview(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawApprovalId: unknown,
) {
  const result = await readExecutionReport(
    client,
    rawScope,
    rawApprovalId,
    "load_campaign_execution_report_review",
    executionReportSchema,
  );
  return {
    ...result,
    reportReview: buildCampaignReportReview(result.reportReview),
  };
}

/** Separate timed private read: SQL verifies retained flight against campaign
 * columns, and this parser preserves the complete timing binding. It does not
 * execute a batch, authorize a retry, establish coverage or issue a report. */
export async function loadTimedCampaignExecutionReportReview(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawApprovalId: unknown,
) {
  const result = await readExecutionReport(
    client,
    rawScope,
    rawApprovalId,
    "load_timed_campaign_execution_report_review",
    timedExecutionReportSchema,
  );
  return {
    ...result,
    reportReview: buildTimedCampaignReportReview(result.reportReview),
    sourceFingerprint: fingerprintTimedSources(result),
  };
}

async function readExecutionReport(
  client: CampaignExecutionClient,
  rawScope: unknown,
  rawApprovalId: unknown,
  functionName:
    | "load_campaign_execution_report_review"
    | "load_timed_campaign_execution_report_review",
  schema: z.ZodType<z.infer<typeof executionReportSchema>>,
) {
  const scope = local(scopeSchema, rawScope);
  const approvalId = local(requestId, rawApprovalId);
  const data = await rpc(client, functionName, {
    target_workspace_id: scope.workspaceId,
    target_project_id: scope.projectId,
    target_campaign_id: scope.campaignId,
    target_approval_id: approvalId,
  });
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CampaignExecutionError("unconfirmed");
  const execution = validateRecovery(parsed.data.execution, scope, approvalId);
  const approved = execution.preview.review;
  const sources = parsed.data.reportReview.reportSources;
  if (
    (
      [
        "workspaceId",
        "projectId",
        "campaignId",
        "commercialPlanVersionId",
        "commercialPlanSnapshotHash",
        "ruleVersionId",
      ] as const
    ).some((key) => approved[key] !== sources[key]) ||
    (["startedAt", "endedAt"] as const).some(
      (key) =>
        retainedReportMicros(approved.measurementWindow[key]) !==
        retainedReportMicros(sources.measurementWindow[key]),
    )
  )
    throw new CampaignExecutionError("unconfirmed");
  if (
    execution.receipt?.batch.results.some(
      (retained) =>
        !sources.results.some(
          (result) =>
            result.calculationRequestId === retained.calculationRequestId &&
            result.conversionFactId === retained.conversionFactId &&
            result.attributionFactId === retained.attributionFactId,
        ),
    )
  )
    throw new CampaignExecutionError("unconfirmed");
  return {
    ...parsed.data,
    execution,
  };
}
