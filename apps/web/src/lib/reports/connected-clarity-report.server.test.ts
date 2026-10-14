import { getProjectReportEvidence, ReportQueryError } from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConnectedClarityReport } from "./connected-clarity-report.server";
import { loadTimedReportClarityDetails } from "./timed-report-presentation.server";
import { buildReportVisualFixture } from "./visual-fixtures";

vi.mock("@landed/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@landed/db")>()),
  getProjectReportEvidence: vi.fn(),
}));
vi.mock("./timed-report-presentation.server", () => ({
  loadTimedReportClarityDetails: vi.fn(),
}));

const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient;

beforeEach(() => vi.clearAllMocks());

describe("connected Clarity issued-report projection", () => {
  it("loads exact public evidence for a measurement-bound version and strips protected issue fields", async () => {
    const fixture = buildReportVisualFixture("ready");
    const selected = fixture.report.versions[0]!;
    const qualified = fixture.rankingEvidencePaths.filter(
      (path) => path.metric === "qualified_wallets",
    );
    const activated = fixture.rankingEvidencePaths.filter(
      (path) => path.metric === "activated_wallets",
    );
    vi.mocked(getProjectReportEvidence)
      .mockResolvedValueOnce(qualified)
      .mockResolvedValueOnce(activated);

    const result = await loadConnectedClarityReport(
      client,
      fixture.report,
      selected,
    );

    expect(result.sourceMode).toBe("issued");
    expect(result.issuedContextStatus).toBe("measurement");
    expect(result.fixture.selectedVersion.id).toBe(selected.id);
    expect(
      result.fixture.report.versions.map((version) => version.version),
    ).toEqual([2, 1]);
    expect(result.fixture.rankingEvidencePaths).toHaveLength(
      fixture.rankingEvidencePaths.length,
    );
    expect(result.evidenceProvenance).toBe("synthetic");
    for (const path of result.fixture.rankingEvidencePaths) {
      expect(path.creatorName).toBe(`Creator ${path.creatorId}`);
      expect(path.contentAssetLabel).toBe(
        `Content asset ${path.contentAssetId}`,
      );
    }
    expect(JSON.stringify(result)).not.toContain("DeFi After Dark");
    expect(loadTimedReportClarityDetails).not.toHaveBeenCalled();
    for (const field of ["issuedBy", "payloadSha256", "metricSnapshotSha256"])
      expect(JSON.stringify(result)).not.toContain(`"${field}"`);
  });

  it("uses the private retained projection only for the exact selected version", async () => {
    const fixture = buildReportVisualFixture("ready");
    const selected = fixture.report.versions[1]!;
    const currentLabels = fixture.rankingEvidencePaths.map((path) => ({
      ...path,
      reportVersionId: selected.id,
      metricSnapshotId: selected.metricSnapshot.id,
      creatorName: "Mutable current creator name",
      contentAssetLabel: "Mutable current content label",
    }));
    const timed = {
      fixture: {
        report: { ...fixture.report, versions: [selected] },
        selectedVersion: selected,
        rankingEvidencePaths: currentLabels,
      },
      economics: { [selected.version]: null },
      timedContext: { retained: true },
      timedDetail: { exact: true },
      sourceMode: "isolated-issued" as const,
    };
    vi.mocked(loadTimedReportClarityDetails).mockResolvedValue(timed as never);

    const result = await loadConnectedClarityReport(
      client,
      fixture.report,
      selected,
    );

    expect(loadTimedReportClarityDetails).toHaveBeenCalledWith(
      client,
      expect.any(Function),
      {
        workspaceId: fixture.report.workspaceId,
        projectId: fixture.report.projectId,
        reportId: fixture.report.id,
        reportVersionId: selected.id,
      },
    );
    expect(result.sourceMode).toBe("issued");
    expect(result.issuedContextStatus).toBe("timed");
    expect(result.evidenceProvenance).toBe("synthetic");
    expect(result.fixture.selectedVersion.id).toBe(selected.id);
    expect(result.fixture.report.versions).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("Mutable current");
    for (const path of result.fixture.rankingEvidencePaths) {
      expect(path.creatorName).toBe(`Creator ${path.creatorId}`);
      expect(path.contentAssetLabel).toBe(
        `Content asset ${path.contentAssetId}`,
      );
    }
  });

  it("falls back only for the exact database signal that retained context is absent", async () => {
    const fixture = buildReportVisualFixture("ready");
    const selected = fixture.report.versions[1]!;
    vi.mocked(loadTimedReportClarityDetails).mockImplementation(
      async (_client, reader, request) => reader(request as never) as never,
    );
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "55000",
        message: "Issued report context is unavailable",
      },
    });
    vi.mocked(getProjectReportEvidence)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await loadConnectedClarityReport(
      client,
      fixture.report,
      selected,
    );

    expect(result.issuedContextStatus).toBe("metric_snapshot_only");
    expect(result.evidenceProvenance).toBe("unknown");
    expect(rpc).toHaveBeenCalledWith("read_issued_timed_report_details", {
      target_workspace_id: fixture.report.workspaceId,
      target_project_id: fixture.report.projectId,
      target_report_id: fixture.report.id,
      target_version_id: selected.id,
    });
  });

  it("fails closed on denial, read failure, or evidence borrowed from another version", async () => {
    const fixture = buildReportVisualFixture("ready");
    const current = fixture.report.versions[0]!;
    vi.mocked(getProjectReportEvidence)
      .mockResolvedValueOnce([
        {
          ...fixture.rankingEvidencePaths[0]!,
          reportVersionId: fixture.report.versions[1]!.id,
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      loadConnectedClarityReport(client, fixture.report, current),
    ).rejects.toThrow("inconsistent");

    const previous = fixture.report.versions[1]!;
    vi.mocked(loadTimedReportClarityDetails).mockImplementation(
      async (_client, reader, request) => reader(request as never) as never,
    );
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    await expect(
      loadConnectedClarityReport(client, fixture.report, previous),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({ code: "42501" }),
    );
  });
});
