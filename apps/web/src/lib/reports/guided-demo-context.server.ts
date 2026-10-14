import "server-only";

import {
  getProjectReportEvidence,
  type ProjectReport,
  type ProjectReportEvidencePath,
  type ProjectReportVersion,
} from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guidedDemoManifest } from "@/lib/guided-demo-manifest";
import type { EvidenceProvenance } from "./clarity";

/** DEM-01: walkthrough context, never provenance for the selected outcome.
 * The zero-outcome replay has no paths. Verify the canonical measured version
 * separately without adding its evidence or values to the selected snapshot. */
export async function hasSyntheticDemoReplayContext(
  client: SupabaseClient,
  report: ProjectReport,
  selected: ProjectReportVersion,
  provenance: EvidenceProvenance,
  selectedPaths: ProjectReportEvidencePath[],
): Promise<boolean> {
  if (
    report.id !== guidedDemoManifest.reportId ||
    report.projectId !== guidedDemoManifest.projectDatabaseId ||
    selected.version !== guidedDemoManifest.replayedReportVersion ||
    !report.versions.some((version) => version.id === selected.id) ||
    provenance !== "unknown" ||
    selectedPaths.length !== 0
  ) {
    return false;
  }
  const measured = report.versions.find(
    (version) => version.version === guidedDemoManifest.measuredReportVersion,
  );
  if (!measured) return false;

  const paths = (
    await Promise.all(
      (["qualified_wallets", "activated_wallets"] as const).map((metric) =>
        getProjectReportEvidence(client, report.projectId, measured.id, metric),
      ),
    )
  ).flat();
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        path.environment === "demo" &&
        path.reportVersionId === measured.id &&
        path.metricSnapshotId === measured.metricSnapshot.id,
    )
  );
}
