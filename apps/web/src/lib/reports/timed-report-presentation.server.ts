import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectReport } from "@landed/db";
import { assertTimedReportBinding } from "./timed-report-binding";
import { z } from "zod";
import { timedReportPresentationSchema } from "./timed-report-presentation";
import {
  timedReportDetailsSchema,
  buildTimedCreatorEconomics,
} from "./timed-report-details";

const requestSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
});
export type TimedPresentationRequest = z.infer<typeof requestSchema>;
export type PrivateTimedPresentationReader = (
  request: TimedPresentationRequest & { authenticatedActorId: string },
) => Promise<unknown>;

/** Trusted server orchestration only. The reader uses either the isolated test
 * bridge or the reviewed fixed authenticated wrapper, never a caller-chosen
 * RPC/SQL endpoint. REST access does not grant direct private SQL execution.
 */
export async function loadTimedReportClarity(
  client: SupabaseClient,
  privateReader: PrivateTimedPresentationReader,
  rawRequest: unknown,
) {
  const request = requestSchema.parse(rawRequest);
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) throw new Error("Report access required.");
  const report = await getProjectReport(
    client,
    request.projectId,
    request.reportId,
  );
  const version = report?.versions.find(
    (item) => item.id === request.reportVersionId,
  );
  if (!report || !version || report.workspaceId !== request.workspaceId)
    throw new Error("Report access required.");
  if (version.measurementContext)
    throw new Error(
      "Observation context requires its own presentation allowlist.",
    );
  const context = timedReportPresentationSchema.parse(
    await privateReader({
      ...request,
      authenticatedActorId: user.data.user.id,
    }),
  );
  assertTimedReportBinding(report, version, context);
  // Only this exact issued version has an independently bound timed context.
  // Do not expose other versions for comparison before their contexts are read.
  const selectedVersion = {
    id: version.id,
    version: version.version,
    issuedAt: version.issuedAt,
    campaignName: version.campaignName,
    metricSnapshot: version.metricSnapshot,
    measurementContext: null,
  };
  return {
    sourceMode: "isolated-issued" as const,
    timedContext: context,
    fixture: {
      report: {
        id: report.id,
        workspaceId: report.workspaceId,
        projectId: report.projectId,
        campaignId: report.campaignId,
        createdAt: report.createdAt,
        versions: [selectedVersion],
      },
      selectedVersion,
      // No demo/current roster, allocation or outcome paths are substituted.
      // Their exact approved-plan consumer remains a separate gate.
      rankingEvidencePaths: [],
    },
    economics: {},
  };
}

/** Same current-reader authorization, one atomic private historical projection. */
export async function loadTimedReportClarityDetails(
  client: SupabaseClient,
  privateReader: PrivateTimedPresentationReader,
  rawRequest: unknown,
) {
  let envelope: z.infer<typeof detailEnvelope> | null = null;
  const base = await loadTimedReportClarity(
    client,
    async (request) => {
      envelope = detailEnvelope.parse(await privateReader(request));
      return envelope.context;
    },
    rawRequest,
  );
  if (!envelope) throw new Error("Historical report detail is unavailable.");
  // Callback assignment is synchronous before the awaited loader returns.
  const retained = envelope as z.infer<typeof detailEnvelope>;
  const economics = buildTimedCreatorEconomics(
    base.fixture.selectedVersion,
    base.timedContext,
    retained.detail,
  );
  return {
    ...base,
    timedDetail: retained.detail,
    fixture: { ...base.fixture, rankingEvidencePaths: retained.detail.paths },
    economics: { [base.fixture.selectedVersion.version]: economics },
  };
}

const detailEnvelope = z.strictObject({
  context: timedReportPresentationSchema,
  detail: timedReportDetailsSchema,
});
