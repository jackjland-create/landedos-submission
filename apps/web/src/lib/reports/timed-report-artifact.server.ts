import "server-only";
import { z } from "zod";
import { campaignMetricSnapshotSchema } from "@landed/analytics";
import { timedReportPresentationSchema } from "./timed-report-presentation";
import { assertTimedReportBinding } from "./timed-report-binding";
import { projectReportEvidencePathSchema } from "@landed/db";
import {
  buildTimedCreatorEconomics,
  timedReportDetailsSchema,
} from "./timed-report-details";

const version = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  issuedAt: z.iso.datetime(),
  campaignName: z.string().min(1),
  metricSnapshot: campaignMetricSnapshotSchema,
  // The connected rehearsal has no retained observation/benchmark context yet.
  measurementContext: z.null().optional(),
});
const artifact = z.strictObject({
  sourceMode: z.literal("isolated-issued"),
  timedContext: timedReportPresentationSchema,
  timedDetail: timedReportDetailsSchema.optional(),
  fixture: z.strictObject({
    report: z.strictObject({
      id: z.uuid(),
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      campaignId: z.uuid(),
      createdAt: z.iso.datetime(),
      versions: z.array(version).length(1),
    }),
    selectedVersion: version,
    rankingEvidencePaths: z.array(projectReportEvidencePathSchema).max(10000),
  }),
  economics: z.unknown(),
});

/** Offline rendering evidence only. This validates shape/binding, not origin or
 * user authorization; authenticated source reads are tested separately. */
export function parseTimedClarityArtifact(raw: unknown) {
  const result = artifact.parse(raw);
  const { report, selectedVersion } = result.fixture;
  const context = result.timedContext;
  if (
    JSON.stringify(report.versions[0]) !== JSON.stringify(selectedVersion) ||
    context.workspaceId !== report.workspaceId ||
    context.projectId !== report.projectId ||
    context.campaignId !== report.campaignId ||
    context.reportId !== report.id ||
    context.reportVersionId !== selectedVersion.id ||
    context.version !== selectedVersion.version ||
    context.metricSnapshotId !== selectedVersion.metricSnapshot.id
  )
    throw new Error("Retained presentation artifact is inconsistent.");
  assertTimedReportBinding(report, selectedVersion, context);
  const economics = result.timedDetail
    ? {
        [selectedVersion.version]: buildTimedCreatorEconomics(
          selectedVersion,
          context,
          result.timedDetail,
        ),
      }
    : {};
  if (
    JSON.stringify(result.economics) !== JSON.stringify(economics) ||
    JSON.stringify(result.fixture.rankingEvidencePaths) !==
      JSON.stringify(result.timedDetail?.paths ?? [])
  )
    throw new Error("Retained historical detail projection is inconsistent.");
  return { ...result, economics };
}
