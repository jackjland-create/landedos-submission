import "server-only";

import { z } from "zod";

const identitySchema = z.strictObject({
  contextId: z.uuid(),
  issueRequestId: z.uuid(),
  projectId: z.uuid(),
  reportVersionId: z.uuid(),
  requestedBy: z.uuid(),
});

const exactCountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const nullableTimestampSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.null(),
]);

const observationSchema = z
  .strictObject({
    id: z.uuid(),
    metric: z.enum(["qualified_wallets", "activated_wallets"]),
    periodStartedAt: z.iso.datetime({ offset: true }),
    periodEndedAt: z.iso.datetime({ offset: true }),
    observedThrough: z.iso.datetime({ offset: true }),
    periodState: z.enum(["complete", "partial"]),
    status: z.enum(["available", "not_available"]),
    valueDecimal: z.union([exactCountSchema, z.null()]),
    unavailableReason: z.union([z.string().trim().min(1).max(120), z.null()]),
    sourceEvidenceIds: z.array(z.uuid()),
  })
  .superRefine((observation, context) => {
    if (
      observation.status === "available" &&
      (observation.valueDecimal === null ||
        observation.unavailableReason !== null ||
        BigInt(observation.valueDecimal) !==
          BigInt(observation.sourceEvidenceIds.length))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Available observations must match their retained evidence set",
      });
    }
    if (
      observation.status === "not_available" &&
      (observation.valueDecimal !== null ||
        observation.unavailableReason === null ||
        observation.sourceEvidenceIds.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable observations cannot claim values or evidence",
      });
    }
  });

const benchmarkSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["approved_target", "portfolio_cohort"]),
    metric: z.enum(["qualified_wallets", "activated_wallets"]),
    label: z.string().trim().min(1).max(80),
    sourceLabel: z.string().trim().min(1).max(120),
    status: z.enum(["available", "not_available"]),
    valueDecimal: z.union([exactCountSchema, z.null()]),
    unavailableReason: z.union([z.string().trim().min(1).max(120), z.null()]),
    sourceStartedAt: nullableTimestampSchema,
    sourceEndedAt: nullableTimestampSchema,
    approvedBy: z.union([z.uuid(), z.null()]),
    approvedAt: nullableTimestampSchema,
    cohortSampleSize: z.union([z.number().int().positive(), z.null()]),
  })
  .superRefine((benchmark, context) => {
    if (
      benchmark.kind === "portfolio_cohort" &&
      (benchmark.status !== "not_available" ||
        benchmark.valueDecimal !== null ||
        benchmark.sourceStartedAt !== null ||
        benchmark.sourceEndedAt !== null ||
        benchmark.cohortSampleSize !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Portfolio cohorts require a retained cohort result version",
      });
    }
  });

export const reportMeasurementContextPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contextId: z.uuid(),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
  metricSnapshotId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  observations: z.array(observationSchema).min(2),
  benchmarks: z.array(benchmarkSchema),
});

const resultSchema = z
  .array(
    z.strictObject({
      context_id: z.uuid(),
      inserted: z.boolean(),
      issued_at: z.iso.datetime({ offset: true }),
      payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .length(1);

export type ReportMeasurementContextIdentity = z.infer<typeof identitySchema>;
export type ReportMeasurementContextPayload = z.infer<
  typeof reportMeasurementContextPayloadSchema
>;

export type ReportMeasurementContextClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export type ReportMeasurementContextAuth = {
  getUser: () => PromiseLike<{
    data: { user: { id: string } | null };
    error: { code?: string } | null;
  }>;
};

export class ReportMeasurementContextError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ReportMeasurementContextError";
    this.code = code;
  }
}

export async function issueReportMeasurementContext(
  client: ReportMeasurementContextClient,
  auth: ReportMeasurementContextAuth,
  rawIdentity: ReportMeasurementContextIdentity,
  rawPayload: ReportMeasurementContextPayload,
) {
  const identityResult = identitySchema.safeParse(rawIdentity);
  const payloadResult =
    reportMeasurementContextPayloadSchema.safeParse(rawPayload);
  if (!identityResult.success || !payloadResult.success) {
    throw new ReportMeasurementContextError(
      "Report measurement context is invalid.",
    );
  }

  const identity = identityResult.data;
  const payload = payloadResult.data;
  const authenticated = await auth.getUser();
  if (
    authenticated.error ||
    !authenticated.data.user ||
    authenticated.data.user.id !== identity.requestedBy
  ) {
    throw new ReportMeasurementContextError(
      "Report context issuance requires a verified matching user.",
      authenticated.error?.code,
    );
  }
  if (
    payload.contextId !== identity.contextId ||
    payload.reportVersionId !== identity.reportVersionId ||
    payload.projectId !== identity.projectId
  ) {
    throw new ReportMeasurementContextError(
      "Report measurement context does not match the issuance scope.",
    );
  }

  const rpcResult = await client.rpc("issue_report_measurement_context", {
    target_context_id: identity.contextId,
    target_issue_request_id: identity.issueRequestId,
    target_payload: payload,
    target_project_id: identity.projectId,
    target_report_version_id: identity.reportVersionId,
    target_requested_by: identity.requestedBy,
  });
  if (rpcResult.error) {
    throw new ReportMeasurementContextError(
      "Report measurement context could not be issued.",
      rpcResult.error.code,
    );
  }

  const result = resultSchema.safeParse(rpcResult.data);
  if (!result.success || result.data[0].context_id !== identity.contextId) {
    throw new ReportMeasurementContextError(
      "Retained report context did not match the request.",
    );
  }

  const retained = result.data[0];
  return {
    contextId: retained.context_id,
    inserted: retained.inserted,
    issuedAt: new Date(retained.issued_at).toISOString(),
    payloadSha256: retained.payload_sha256,
  };
}
