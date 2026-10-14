import {
  getProjectCampaign,
  getProjectReport,
  ReportQueryError,
} from "@landed/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConnectedClarityReport } from "@/lib/reports/connected-clarity-report.server";
import { buildReportVisualFixture } from "@/lib/reports/visual-fixtures";
import { hasSyntheticDemoReplayContext } from "@/lib/reports/guided-demo-context.server";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@landed/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@landed/db")>()),
  getProjectReport: vi.fn(),
  getProjectCampaign: vi.fn(),
}));
vi.mock("@/lib/reports/connected-clarity-report.server", () => ({
  loadConnectedClarityReport: vi.fn(),
}));
vi.mock("@/lib/reports/guided-demo-context.server", () => ({
  hasSyntheticDemoReplayContext: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));
vi.mock("@/components/clarity-reporting", () => ({
  ClarityReporting: () => null,
}));

import Page from "./page";
import { guidedDemoManifest } from "@/lib/guided-demo-manifest";

const fixture = buildReportVisualFixture("ready");
const routeParams = {
  projectId: "helios",
  reportId: fixture.report.id,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasSyntheticDemoReplayContext).mockResolvedValue(false);
  mocks.maybeSingle.mockResolvedValue({
    data: { id: fixture.report.projectId },
    error: null,
  });
  vi.mocked(getProjectReport).mockResolvedValue(fixture.report);
  vi.mocked(getProjectCampaign).mockResolvedValue(fixture.campaign);
  vi.mocked(loadConnectedClarityReport).mockImplementation(
    async (_client, report, selected) => ({
      sourceMode: "issued" as const,
      issuedContextStatus: "measurement" as const,
      evidenceProvenance: "synthetic" as const,
      fixture: {
        report,
        selectedVersion: selected,
        rankingEvidencePaths: [],
      },
      economics: {},
    }),
  );
});

describe("connected project report route", () => {
  it("loads the exact requested immutable version and preserves analysis controls", async () => {
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({
        version: "1",
        compare: "2",
        evidence: "qualified_wallets",
        theme: "dark",
      }),
    });
    const selected = fixture.report.versions[1]!;

    expect(loadConnectedClarityReport).toHaveBeenCalledWith(
      expect.anything(),
      fixture.report,
      selected,
    );
    expect(result.props.state).toBe("ready");
    expect(result.props.projectSlug).toBe("helios");
    expect(result.props.initialQuery).toEqual(
      expect.objectContaining({
        version: 1,
        compare: 2,
        evidence: "qualified_wallets",
        view: "evidence",
        theme: "dark",
      }),
    );
  });

  it("does not substitute another report version for an invalid or missing version", async () => {
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({ version: "99" }),
    });
    expect(loadConnectedClarityReport).not.toHaveBeenCalled();
    expect(result.props.state).toBe("error");
    expect(result.props.unavailableVersionHref).toBe(
      `/projects/helios/reports/${fixture.report.id}?version=99`,
    );
    expect(result.props.unavailableVersionLabel).toBe(
      "Retry requested report version",
    );
  });

  it("keeps the guide available only for the requested canonical synthetic report", async () => {
    const report = { ...fixture.report, id: guidedDemoManifest.reportId };
    vi.mocked(getProjectReport).mockResolvedValue(report);
    const args = {
      params: Promise.resolve({ ...routeParams, reportId: report.id }),
      searchParams: Promise.resolve({ demo: "1", version: "2" }),
    };
    expect((await Page(args)).props.showGuidedDemo).toBe(true);
    expect(
      (await Page({ ...args, searchParams: Promise.resolve({ version: "2" }) }))
        .props.showGuidedDemo,
    ).toBe(false);
    vi.mocked(loadConnectedClarityReport).mockResolvedValueOnce({
      sourceMode: "issued",
      issuedContextStatus: "metric_snapshot_only",
      evidenceProvenance: "non_mainnet",
      fixture: {
        report,
        selectedVersion: report.versions[0]!,
        rankingEvidencePaths: [],
      },
      economics: {},
    });
    expect((await Page(args)).props.showGuidedDemo).toBe(false);
    vi.mocked(getProjectReport).mockResolvedValue(fixture.report);
    expect((await Page(args)).props.showGuidedDemo).toBe(false);
  });

  it("retains exact unavailable version, comparison and guide state on retry", async () => {
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({
        version: "99",
        compare: "2",
        demo: "1",
        demoStep: "12",
        demoOpen: "0",
        theme: "dark",
        next: "https://foreign.test",
      }),
    });
    const retry = new URL(
      result.props.unavailableVersionHref,
      "https://landed.test",
    );
    expect(retry.searchParams.get("version")).toBe("99");
    expect(retry.searchParams.get("compare")).toBe("2");
    expect(retry.searchParams.get("demoStep")).toBe("12");
    expect(retry.searchParams.has("next")).toBe(false);
    expect(loadConnectedClarityReport).not.toHaveBeenCalled();
  });

  it("keeps verified demo replay context separate from unknown outcome provenance", async () => {
    const selected = { ...fixture.report.versions[1]!, version: 3 };
    const report = {
      ...fixture.report,
      id: guidedDemoManifest.reportId,
      versions: [selected],
    };
    vi.mocked(getProjectReport).mockResolvedValue(report);
    vi.mocked(loadConnectedClarityReport).mockResolvedValue({
      sourceMode: "issued",
      issuedContextStatus: "metric_snapshot_only",
      evidenceProvenance: "unknown",
      fixture: { report, selectedVersion: selected, rankingEvidencePaths: [] },
      economics: {},
    });
    vi.mocked(hasSyntheticDemoReplayContext).mockResolvedValue(true);
    const args = {
      params: Promise.resolve({ ...routeParams, reportId: report.id }),
      searchParams: Promise.resolve({ demo: "1", version: "3" }),
    };
    const result = await Page(args);
    expect(result.props.syntheticDemoContext).toBe(true);
    expect(result.props.showGuidedDemo).toBe(true);
    expect(result.props.evidenceProvenance).toBe("unknown");
    expect(result.props.fixture.rankingEvidencePaths).toEqual([]);
    expect(
      (await Page({ ...args, searchParams: Promise.resolve({ version: "3" }) }))
        .props.showGuidedDemo,
    ).toBe(false);
    vi.mocked(hasSyntheticDemoReplayContext).mockRejectedValue(
      new ReportQueryError("denied", "42501"),
    );
    expect((await Page(args)).props.state).toBe("permission");
  });

  it("maps the legacy decision deep link onto the accepted performance canvas", async () => {
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({ mode: "decision" }),
    });
    expect(result.props.initialQuery.view).toBe("performance");
    expect(result.props.initialQuery.version).toBe(2);
  });

  it("fails closed before report reads when the project is hidden", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({}),
    });
    expect(result.props.state).toBe("permission");
    expect(getProjectReport).not.toHaveBeenCalled();
    expect(loadConnectedClarityReport).not.toHaveBeenCalled();
  });

  it("keeps connected detail denial indistinguishable from report denial", async () => {
    vi.mocked(loadConnectedClarityReport).mockRejectedValue(
      new ReportQueryError("denied", "42501"),
    );
    const result = await Page({
      params: Promise.resolve(routeParams),
      searchParams: Promise.resolve({}),
    });
    expect(result.props.state).toBe("permission");
    expect(JSON.stringify(result.props)).not.toContain("denied");
  });
});
