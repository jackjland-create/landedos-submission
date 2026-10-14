import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectReport, type ProjectReport } from "@landed/db";
import { buildReportVisualFixture } from "./visual-fixtures";
import { loadTimedReportClarity } from "./timed-report-presentation.server";
import { timedReportPresentationSchema } from "./timed-report-presentation";
import { parseTimedClarityArtifact } from "./timed-report-artifact.server";
import { clarityCsv } from "./clarity";

vi.mock("@landed/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@landed/db")>()),
  getProjectReport: vi.fn(),
}));
const actor = "30990000-0000-4000-8000-000000000001";
const getUser = vi.fn();
const client = { auth: { getUser } } as unknown as SupabaseClient;
function setup() {
  const report: ProjectReport = buildReportVisualFixture("partial").report;
  const version = report.versions[0]!;
  version.measurementContext = null;
  for (const metric of Object.values(version.metricSnapshot.metrics))
    metric.dataFreshness.dataThrough = metric.sourceTimeRange.endedAt;
  const request = {
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    reportId: report.id,
    reportVersionId: version.id,
  };
  const context = {
    ...request,
    schemaVersion: 1,
    campaignId: report.campaignId,
    version: version.version,
    metricSnapshotId: version.metricSnapshot.id,
    commercialPlanVersionId: "90990000-0000-4000-8000-000000000001",
    approvedFlight: { ...version.metricSnapshot.metrics.cpc.sourceTimeRange },
    measurementWindow: {
      ...version.metricSnapshot.metrics.cpc.sourceTimeRange,
    },
    costPolicy: {
      basis: "contracted",
      version: 1,
      currencyCode: "GBP",
      paid: false,
    },
    coverage: {
      scope: "retained_consented_history_only",
      conversionEvaluation: "retained_universe_reconciled",
      checkedAt: "2026-09-21T19:00:00.123456Z",
    },
    providerExhaustion: "not_independently_verified",
    unavailableMetrics: ["activation", "protocolRevenue", "impressions"],
  };
  getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  vi.mocked(getProjectReport).mockResolvedValue(report);
  const read = vi.fn().mockResolvedValue(context);
  return { report, request, context, read };
}
beforeEach(() => vi.resetAllMocks());
describe("private timed presentation orchestration", () => {
  it("validates its offline projection and exports the same cost and coverage limits", async () => {
    const { request, read } = setup();
    const result = await loadTimedReportClarity(client, read, request);
    expect(parseTimedClarityArtifact(result)).toEqual(result);
    const csv = clarityCsv(result.fixture.selectedVersion, result.timedContext);
    expect(csv).toContain("contracted");
    expect(csv).toContain("not payments made");
    expect(csv).toContain("not independently verified");
    expect(csv).toContain(result.timedContext.measurementWindow.endedAt);
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects artifact metric %s drift",
    async (key) => {
      const { request, read } = setup();
      const result = await loadTimedReportClarity(client, read, request);
      result.fixture.selectedVersion.metricSnapshot[key] = actor;
      expect(() => parseTimedClarityArtifact(result)).toThrow("inconsistent");
    },
  );
  it.each(["currency", "period", "freshness", "unavailable"])(
    "rejects artifact %s drift",
    async (kind) => {
      const { request, read } = setup();
      const result = await loadTimedReportClarity(client, read, request);
      const metrics = result.fixture.selectedVersion.metricSnapshot.metrics;
      if (kind === "currency") metrics.cpc.currencyCode = "USD";
      if (kind === "period")
        metrics.cpc.sourceTimeRange.startedAt = "2026-01-01T00:00:00.000Z";
      if (kind === "freshness")
        metrics.cpc.dataFreshness.dataThrough = "2026-01-01T00:00:00.000Z";
      if (kind === "unavailable")
        metrics.cpa.denominator = {
          status: "available",
          value: 1,
          kind: "activated_wallet_count",
          evidenceIds: [],
        };
      expect(() => parseTimedClarityArtifact(result)).toThrow();
    },
  );
  it("binds genuine reader identity and emits only the exact issued version, not protected approval data", async () => {
    const { request, read } = setup();
    const result = await loadTimedReportClarity(client, read, request);
    expect(read).toHaveBeenCalledWith({
      ...request,
      authenticatedActorId: actor,
    });
    expect(result.fixture.report.versions).toHaveLength(1);
    expect(result.timedContext.coverage.checkedAt).toBe(
      "2026-09-21T19:00:00.123456Z",
    );
    expect(result.fixture.rankingEvidencePaths).toEqual([]);
    expect(result.economics).toEqual({});
    for (const field of [
      "issuedBy",
      "payloadSha256",
      "metricSnapshotSha256",
      "sourceHash",
      "calculationHash",
      "authenticatedActorId",
    ])
      expect(JSON.stringify(result)).not.toContain(`"${field}"`);
  });
  it("does not invoke privileged reads for a signed-out user", async () => {
    const { request, read } = setup();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(loadTimedReportClarity(client, read, request)).rejects.toThrow(
      "Report access required",
    );
    expect(read).not.toHaveBeenCalled();
    expect(getProjectReport).not.toHaveBeenCalled();
  });
  it("denies RLS-hidden reports before private context access", async () => {
    const { request, read } = setup();
    vi.mocked(getProjectReport).mockResolvedValue(null);
    await expect(loadTimedReportClarity(client, read, request)).rejects.toThrow(
      "Report access required",
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects an unretained version before private context access", async () => {
    const { request, read } = setup();
    request.reportVersionId = actor;
    await expect(loadTimedReportClarity(client, read, request)).rejects.toThrow(
      "Report access required",
    );
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    "workspaceId",
    "projectId",
    "campaignId",
    "reportId",
    "reportVersionId",
    "metricSnapshotId",
  ])("rejects mismatched %s", async (key) => {
    const { request, read, context } = setup();
    read.mockResolvedValue({ ...context, [key]: actor });
    await expect(loadTimedReportClarity(client, read, request)).rejects.toThrow(
      "inconsistent",
    );
  });
  it("rejects hidden fields instead of passing them to the UI", async () => {
    const { request, read, context } = setup();
    read.mockResolvedValue({ ...context, sourceHash: "a".repeat(64) });
    await expect(
      loadTimedReportClarity(client, read, request),
    ).rejects.toThrow();
  });
  it("rejects microsecond period drift without rounding", async () => {
    const { request, read, context } = setup();
    context.measurementWindow.startedAt =
      context.measurementWindow.startedAt.replace(".000Z", ".000001Z");
    read.mockResolvedValue(context);
    await expect(
      loadTimedReportClarity(client, read, request),
    ).rejects.toThrow();
  });
  it("fails closed on missing context and private read denial", async () => {
    const { request, read } = setup();
    read.mockResolvedValue(null);
    await expect(
      loadTimedReportClarity(client, read, request),
    ).rejects.toThrow();
    read.mockRejectedValue(new Error("Private read denied"));
    await expect(loadTimedReportClarity(client, read, request)).rejects.toThrow(
      "Private read denied",
    );
  });
  it("requires an explicit unavailable-metric and contracted-not-paid policy", () => {
    const { context } = setup();
    expect(
      timedReportPresentationSchema.safeParse({
        ...context,
        unavailableMetrics: [],
      }).success,
    ).toBe(false);
    expect(
      timedReportPresentationSchema.safeParse({
        ...context,
        costPolicy: { ...context.costPolicy, paid: true },
      }).success,
    ).toBe(false);
  });
});
