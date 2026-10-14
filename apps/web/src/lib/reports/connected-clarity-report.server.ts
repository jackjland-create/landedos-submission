import "server-only";

import {
  getProjectReportEvidence,
  ReportQueryError,
  type ProjectReport,
  type ProjectReportEvidencePath,
  type ProjectReportVersion,
} from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClarityReportVersion, EvidenceProvenance } from "./clarity";
import { loadTimedReportClarityDetails } from "./timed-report-presentation.server";

class TimedContextAbsentError extends Error {}

function evidenceProvenance(
  paths: ProjectReportEvidencePath[],
): EvidenceProvenance {
  if (paths.length === 0) return "unknown";
  if (paths.some((path) => path.environment === "demo")) return "synthetic";
  if (paths.some((path) => path.environment !== "mainnet"))
    return "non_mainnet";
  return "retained";
}

function neutralEvidenceIdentity(
  paths: ProjectReportEvidencePath[],
): ProjectReportEvidencePath[] {
  return paths.map((path) => ({
    ...path,
    // Existing public evidence joins current profile/display fields. Historical
    // issued views keep only retained IDs until immutable issue-time labels exist.
    creatorName: `Creator ${path.creatorId}`,
    contentAssetLabel: `Content asset ${path.contentAssetId}`,
  }));
}

function safeVersion(version: ProjectReportVersion): ClarityReportVersion {
  const measurementContext = version.measurementContext
    ? {
        id: version.measurementContext.id,
        observations: version.measurementContext.observations,
        benchmarks: version.measurementContext.benchmarks,
      }
    : null;
  return {
    id: version.id,
    version: version.version,
    issuedAt: version.issuedAt,
    campaignName: version.campaignName,
    metricSnapshot: version.metricSnapshot,
    measurementContext,
  };
}

function safeReport(report: ProjectReport) {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    campaignId: report.campaignId,
    createdAt: report.createdAt,
    versions: report.versions.map(safeVersion),
  };
}

function assertExactPaths(
  paths: ProjectReportEvidencePath[],
  version: ClarityReportVersion,
) {
  if (
    paths.some(
      (path) =>
        path.reportVersionId !== version.id ||
        path.metricSnapshotId !== version.metricSnapshot.id,
    )
  ) {
    throw new ReportQueryError("Issued report evidence is inconsistent.");
  }
}

/** RPT-02/03/06: one authorized, immutable client projection. No campaign-current
 * roster or demo identity is used to complete missing issued history. */
export async function loadConnectedClarityReport(
  client: SupabaseClient,
  report: ProjectReport,
  selected: ProjectReportVersion,
) {
  const selectedVersion = safeVersion(selected);
  if (!selected.measurementContext) {
    try {
      const timed = await loadTimedReportClarityDetails(
        client,
        async (request) => {
          const { data, error } = await client.rpc(
            "read_issued_timed_report_details",
            {
              target_workspace_id: request.workspaceId,
              target_project_id: request.projectId,
              target_report_id: request.reportId,
              target_version_id: request.reportVersionId,
            },
          );
          if (error) {
            if (
              error.code === "55000" &&
              error.message.includes("Issued report context is unavailable")
            ) {
              throw new TimedContextAbsentError();
            }
            throw new ReportQueryError(
              "Retained report context could not be loaded.",
              error.code,
            );
          }
          return data;
        },
        {
          workspaceId: report.workspaceId,
          projectId: report.projectId,
          reportId: report.id,
          reportVersionId: selected.id,
        },
      );
      const rankingEvidencePaths = neutralEvidenceIdentity(
        timed.fixture.rankingEvidencePaths,
      );
      assertExactPaths(rankingEvidencePaths, selectedVersion);
      return {
        ...timed,
        sourceMode: "issued" as const,
        issuedContextStatus: "timed" as const,
        evidenceProvenance: evidenceProvenance(rankingEvidencePaths),
        fixture: {
          report: safeReport(report),
          selectedVersion,
          rankingEvidencePaths,
        },
      };
    } catch (error) {
      if (!(error instanceof TimedContextAbsentError)) throw error;
    }
  }

  const rankingEvidencePaths = neutralEvidenceIdentity(
    await Promise.all([
      getProjectReportEvidence(
        client,
        report.projectId,
        selected.id,
        "qualified_wallets",
      ),
      getProjectReportEvidence(
        client,
        report.projectId,
        selected.id,
        "activated_wallets",
      ),
    ]).then((results) => results.flat()),
  );
  assertExactPaths(rankingEvidencePaths, selectedVersion);
  return {
    sourceMode: "issued" as const,
    issuedContextStatus: selected.measurementContext
      ? ("measurement" as const)
      : ("metric_snapshot_only" as const),
    evidenceProvenance: evidenceProvenance(rankingEvidencePaths),
    fixture: {
      report: safeReport(report),
      selectedVersion,
      rankingEvidencePaths,
    },
    economics: {},
  };
}
