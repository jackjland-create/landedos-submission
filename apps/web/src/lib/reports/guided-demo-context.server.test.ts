import {
  getProjectReportEvidence,
  ReportQueryError,
  type ProjectReport,
} from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guidedDemoManifest } from "@/lib/guided-demo-manifest";
import { buildReportVisualFixture } from "./visual-fixtures";
import { hasSyntheticDemoReplayContext } from "./guided-demo-context.server";

vi.mock("@landed/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@landed/db")>()),
  getProjectReportEvidence: vi.fn(),
}));

const client = {} as SupabaseClient;
function setup() {
  const fixture = buildReportVisualFixture("ready");
  const measured = fixture.report.versions[0]!;
  const selected = { ...fixture.report.versions[1]!, version: 3 };
  const report: ProjectReport = {
    ...fixture.report,
    id: guidedDemoManifest.reportId,
    projectId: guidedDemoManifest.projectDatabaseId,
    versions: [selected, measured],
  };
  const path = {
    ...fixture.rankingEvidencePaths[0]!,
    environment: "demo" as const,
    reportVersionId: measured.id,
    metricSnapshotId: measured.metricSnapshot.id,
  };
  vi.mocked(getProjectReportEvidence).mockResolvedValue([path]);
  return { report, selected, measured, path };
}

beforeEach(() => vi.resetAllMocks());

describe("DEM-01 zero-outcome replay context", () => {
  it("verifies the measured version without copying it into the replay", async () => {
    const { report, selected, measured } = setup();
    const before = JSON.stringify({ report, selected });
    expect(
      await hasSyntheticDemoReplayContext(
        client,
        report,
        selected,
        "unknown",
        [],
      ),
    ).toBe(true);
    expect(getProjectReportEvidence).toHaveBeenCalledTimes(2);
    for (const metric of ["qualified_wallets", "activated_wallets"])
      expect(getProjectReportEvidence).toHaveBeenCalledWith(
        client,
        report.projectId,
        measured.id,
        metric,
      );
    expect(JSON.stringify({ report, selected })).toBe(before);
  });

  it.each([
    "report",
    "project",
    "version",
    "membership",
    "provenance",
    "paths",
  ])("does not look up demo context for mismatched %s", async (kind) => {
    const { report, selected, path } = setup();
    if (kind === "report") report.id = "not-canonical";
    if (kind === "project") report.projectId = "other-project";
    if (kind === "version") selected.version = 4;
    if (kind === "membership") report.versions = [];
    expect(
      await hasSyntheticDemoReplayContext(
        client,
        report,
        selected,
        kind === "provenance" ? "non_mainnet" : "unknown",
        kind === "paths" ? [path] : [],
      ),
    ).toBe(false);
    expect(getProjectReportEvidence).not.toHaveBeenCalled();
  });

  it.each(["absent", "empty", "mixed", "version", "snapshot"])(
    "does not classify from %s measured evidence",
    async (kind) => {
      const { report, selected, path } = setup();
      if (kind === "absent") report.versions = [selected];
      if (kind === "empty")
        vi.mocked(getProjectReportEvidence).mockResolvedValue([]);
      if (kind === "mixed")
        vi.mocked(getProjectReportEvidence).mockResolvedValue([
          path,
          { ...path, environment: "mainnet" },
        ]);
      if (kind === "version") path.reportVersionId = selected.id;
      if (kind === "snapshot")
        path.metricSnapshotId = selected.metricSnapshot.id;
      expect(
        await hasSyntheticDemoReplayContext(
          client,
          report,
          selected,
          "unknown",
          [],
        ),
      ).toBe(false);
    },
  );

  it("propagates permission and read failures without an identity-only fallback", async () => {
    const { report, selected } = setup();
    const error = new ReportQueryError("denied", "42501");
    vi.mocked(getProjectReportEvidence).mockRejectedValue(error);
    await expect(
      hasSyntheticDemoReplayContext(client, report, selected, "unknown", []),
    ).rejects.toBe(error);
  });
});
