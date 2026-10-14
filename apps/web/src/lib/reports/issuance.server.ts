import "server-only";

import {
  campaignMetricSnapshotSchema,
  computeCampaignMetrics,
  metricSnapshotInputSchema,
  type MetricSnapshotInput,
} from "@landed/analytics";
import { z } from "zod";

const reportIssuanceIdentitySchema = z.strictObject({
  campaignId: z.uuid(),
  issueRequestId: z.uuid(),
  metricSnapshotId: z.uuid(),
  projectId: z.uuid(),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
  requestedBy: z.uuid(),
});

const reportIssuanceResultSchema = z
  .array(
    z.strictObject({
      inserted: z.boolean(),
      issued_at: z.iso.datetime({ offset: true }),
      metric_snapshot_id: z.uuid(),
      metric_snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      report_id: z.uuid(),
      report_payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      report_version_id: z.uuid(),
      version: z.number().int().positive(),
    }),
  )
  .length(1);

const reportContextResultSchema = z
  .array(
    z.strictObject({
      context_id: z.uuid(),
      inserted: z.boolean(),
      issued_at: z.iso.datetime({ offset: true }),
      payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .length(1);

export type ReportIssuanceClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export type ReportIssuanceAuth = {
  getUser: () => PromiseLike<{
    data: { user: { id: string } | null };
    error: { code?: string } | null;
  }>;
};

export type ReportIssuanceIdentity = z.infer<
  typeof reportIssuanceIdentitySchema
>;

export type ReportIssuanceResult = {
  inserted: boolean;
  issuedAt: string;
  metricSnapshotId: string;
  metricSnapshotSha256: string;
  reportId: string;
  reportPayloadSha256: string;
  reportVersionId: string;
  version: number;
};

export class ReportIssuanceError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ReportIssuanceError";
    this.code = code;
  }
}

export async function issueVersionedCampaignReport(
  client: ReportIssuanceClient,
  auth: ReportIssuanceAuth,
  rawIdentity: ReportIssuanceIdentity,
  rawMetricInput: MetricSnapshotInput,
): Promise<ReportIssuanceResult> {
  const identityResult = reportIssuanceIdentitySchema.safeParse(rawIdentity);
  const metricInputResult = metricSnapshotInputSchema.safeParse(rawMetricInput);
  if (!identityResult.success || !metricInputResult.success) {
    throw new ReportIssuanceError("Report evidence is invalid.");
  }

  const identity = identityResult.data;
  const metricInput = metricInputResult.data;
  const authenticated = await auth.getUser();
  if (
    authenticated.error ||
    !authenticated.data.user ||
    authenticated.data.user.id !== identity.requestedBy
  ) {
    throw new ReportIssuanceError(
      "Report issuance requires a verified matching user.",
      authenticated.error?.code,
    );
  }
  if (
    metricInput.id !== identity.metricSnapshotId ||
    metricInput.projectId !== identity.projectId ||
    metricInput.campaignId !== identity.campaignId
  ) {
    throw new ReportIssuanceError(
      "Report evidence does not match the issuance scope.",
    );
  }

  const metricSnapshot = campaignMetricSnapshotSchema.parse(
    computeCampaignMetrics(metricInput),
  );
  const rpcResult = await client.rpc("issue_campaign_report", {
    target_campaign_id: identity.campaignId,
    target_issue_request_id: identity.issueRequestId,
    target_metric_snapshot: metricSnapshot,
    target_metric_snapshot_id: identity.metricSnapshotId,
    target_project_id: identity.projectId,
    target_report_id: identity.reportId,
    target_report_version_id: identity.reportVersionId,
    target_requested_by: identity.requestedBy,
  });

  if (rpcResult.error) {
    throw new ReportIssuanceError(
      "The report could not be issued.",
      rpcResult.error.code,
    );
  }

  const result = reportIssuanceResultSchema.safeParse(rpcResult.data);
  if (!result.success) {
    throw new ReportIssuanceError(
      "Issued report evidence did not match the request.",
    );
  }

  const retained = result.data[0];
  if (
    retained.report_id !== identity.reportId ||
    retained.report_version_id !== identity.reportVersionId ||
    retained.metric_snapshot_id !== identity.metricSnapshotId
  ) {
    throw new ReportIssuanceError(
      "Issued report evidence did not match the request.",
    );
  }

  const contextRpcResult = await client.rpc(
    "issue_report_measurement_context_from_retained_evidence",
    {
      target_project_id: identity.projectId,
      target_report_version_id: retained.report_version_id,
      target_requested_by: identity.requestedBy,
    },
  );
  if (contextRpcResult.error) {
    throw new ReportIssuanceError(
      "The report was issued, but its retained trend context could not be attached. Retry the same request.",
      contextRpcResult.error.code,
    );
  }
  if (!reportContextResultSchema.safeParse(contextRpcResult.data).success) {
    throw new ReportIssuanceError(
      "Retained report context did not match the issued report.",
    );
  }

  return {
    inserted: retained.inserted,
    issuedAt: new Date(retained.issued_at).toISOString(),
    metricSnapshotId: retained.metric_snapshot_id,
    metricSnapshotSha256: retained.metric_snapshot_sha256,
    reportId: retained.report_id,
    reportPayloadSha256: retained.report_payload_sha256,
    reportVersionId: retained.report_version_id,
    version: retained.version,
  };
}
