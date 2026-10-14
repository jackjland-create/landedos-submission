import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: "127.0.0.1:3212",
  getUser: vi.fn(),
  rpc: vi.fn(),
  load: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: mocks.host }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/reports/timed-report-presentation.server", () => ({
  loadTimedReportClarityDetails: mocks.load,
}));
vi.mock("@/components/clarity-reporting", () => ({
  ClarityReporting: () => null,
}));
import Page from "./page";

const scope = {
  workspaceId: "10990000-0000-4000-8000-000000000001",
  projectId: "20990000-0000-4000-8000-000000000001",
  reportId: "40990000-0000-4000-8000-000000000001",
  reportVersionId: "50990000-0000-4000-8000-000000000001",
};
describe("isolated authenticated report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("LANDED_TIMED_BROWSER_INTEGRATION", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
    mocks.host = "127.0.0.1:3212";
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "derived-actor" } },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ["NODE_ENV", "production"],
    ["VERCEL_ENV", "preview"],
    ["LANDED_TIMED_BROWSER_INTEGRATION", "0"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://hosted.example.test"],
  ])("rejects unsafe %s", async (name, value) => {
    vi.stubEnv(name, value);
    await expect(
      Page({ searchParams: Promise.resolve(scope) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("rejects a non-loopback host", async () => {
    mocks.host = "hosted.example.test";
    await expect(
      Page({ searchParams: Promise.resolve(scope) }),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("denies signed-out users without reading report data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await Page({ searchParams: Promise.resolve(scope) });
    expect(result.props.state).toBe("permission");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes four scope IDs to the fixed wrapper, never caller actor/metrics", async () => {
    mocks.rpc.mockResolvedValue({ data: { retained: true }, error: null });
    mocks.load.mockImplementation(async (_client, reader, request) => {
      expect(request).toEqual(scope);
      expect(
        await reader({ ...request, authenticatedActorId: "derived-actor" }),
      ).toEqual({ retained: true });
      return {
        fixture: { selectedVersion: { version: 1 } },
        economics: {},
        sourceMode: "isolated-issued",
      };
    });
    const result = await Page({
      searchParams: Promise.resolve({
        ...scope,
        actor: "spoof",
        metrics: "spoof",
      }),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("read_issued_timed_report_details", {
      target_workspace_id: scope.workspaceId,
      target_project_id: scope.projectId,
      target_report_id: scope.reportId,
      target_version_id: scope.reportVersionId,
    });
    expect(result.props.state).toBe("ready");
  });
  it("fails closed without fixture fallback", async () => {
    mocks.load.mockRejectedValue(new Error("denied"));
    const result = await Page({ searchParams: Promise.resolve(scope) });
    expect(result.props.state).toBe("error");
    expect(result.props.fixture).toBeNull();
    expect(result.props.economics).toEqual({});
  });
});
