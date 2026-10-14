import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReportVisualFixture } from "./visual-fixtures";
const mocks = vi.hoisted(() => ({
  getReport: vi.fn(),
  getCampaign: vi.fn(),
  connected: vi.fn(),
}));
vi.mock("@landed/db", async (original) => ({
  ...(await original<typeof import("@landed/db")>()),
  getProjectReport: mocks.getReport,
  getProjectCampaign: mocks.getCampaign,
}));
vi.mock("./connected-clarity-report.server", () => ({
  loadConnectedClarityReport: mocks.connected,
}));
import { loadProjectOverview } from "./project-overview.server";
import { project } from "@/lib/demo-data";

function client({
  signedIn = true,
  projectResult = { data: { id: project.databaseId }, error: null } as {
    data: unknown;
    error: unknown;
  },
  latest = { data: { report_id: "retained-report" }, error: null } as {
    data: unknown;
    error: unknown;
  },
  manage = false,
} = {}) {
  const scopes: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((...args: unknown[]) => {
        scopes.push(args);
        return query;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue(table === "projects" ? projectResult : latest),
    };
    return query;
  });
  return {
    scopes,
    from,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: signedIn ? { user_metadata: { full_name: "Jack" } } : null,
        },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: manage, error: null }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  const fixture = buildReportVisualFixture("ready");
  mocks.getReport.mockResolvedValue(fixture.report);
  mocks.getCampaign.mockResolvedValue(fixture.campaign);
  mocks.connected.mockResolvedValue({
    fixture,
    economics: {},
    evidenceProvenance: "synthetic",
  });
});
describe("authorized Overview loader", () => {
  it("uses scoped RLS reads and existing connected reader, returning own name", async () => {
    const db = client();
    const result = await loadProjectOverview(
      db as unknown as SupabaseClient,
      {},
    );
    expect(result.state).toBe("ready");
    expect(result.accountName).toBe("Jack");
    expect(result.canManage).toBe(false);
    expect(db.scopes).toContainEqual(["project_id", project.databaseId]);
    expect(mocks.getReport).toHaveBeenCalledWith(
      db,
      project.databaseId,
      "retained-report",
    );
    expect(mocks.connected).toHaveBeenCalledTimes(1);
  });
  it("returns no data without verified user or project membership", async () => {
    const db = client({ signedIn: false });
    expect(
      await loadProjectOverview(db as unknown as SupabaseClient, {}),
    ).toEqual({ state: "permission" });
    expect(db.from).not.toHaveBeenCalled();
    const denied = client({ projectResult: { data: null, error: null } });
    expect(
      (await loadProjectOverview(denied as unknown as SupabaseClient, {}))
        .state,
    ).toBe("permission");
    expect(mocks.getReport).not.toHaveBeenCalled();
  });
  it("does not replace an unavailable exact version with latest", async () => {
    const db = client();
    const result = await loadProjectOverview(db as unknown as SupabaseClient, {
      report: "exact-id",
      version: 99,
    });
    expect(result.state).toBe("error");
    expect(result.fixture).toBeUndefined();
    expect(mocks.getReport).toHaveBeenCalledWith(
      db,
      project.databaseId,
      "exact-id",
    );
    expect(mocks.connected).not.toHaveBeenCalled();
  });
  it("does not leak inaccessible or inconsistent campaign evidence", async () => {
    mocks.getCampaign.mockResolvedValue(null);
    const result = await loadProjectOverview(
      client() as unknown as SupabaseClient,
      {},
    );
    expect(result.state).toBe("error");
    expect(result.fixture).toBeUndefined();
    expect(mocks.connected).not.toHaveBeenCalled();
  });
  it("keeps a genuine no-report state empty, not synthetic numbers", async () => {
    const result = await loadProjectOverview(
      client({
        latest: { data: null, error: null },
      }) as unknown as SupabaseClient,
      {},
    );
    expect(result.state).toBe("empty");
    expect(result.fixture).toBeUndefined();
    expect(mocks.getReport).not.toHaveBeenCalled();
  });
});
