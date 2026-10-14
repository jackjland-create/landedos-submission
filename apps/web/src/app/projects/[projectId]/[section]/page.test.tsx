import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  list: vi.fn(),
  client: vi.fn(),
  records: vi.fn(),
  creators: vi.fn(),
  strategy: vi.fn(),
  gate: vi.fn(),
  overview: vi.fn(),
}));
vi.mock("@/lib/reports/project-overview.server", () => ({
  loadProjectOverview: mocks.overview,
}));
vi.mock("@/lib/project-record-index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadProjectRecordIndex: mocks.records,
}));
vi.mock("@/lib/campaign-plan-launch", () => ({
  loadCampaignPlanLaunch: mocks.launch,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@landed/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listProjectCampaigns: mocks.list,
  listProjectCreators: mocks.creators,
  getSavedBasketStrategy: mocks.strategy,
}));
vi.mock("@/lib/baskets/timing-enabled", () => ({
  basketTimingEnabled: mocks.gate,
}));
vi.mock("@/components/basket-creator-directory", () => ({
  BasketCreatorDirectory: ({
    basketId,
    canManage,
  }: {
    basketId: string;
    canManage: boolean;
  }) => (
    <p>
      Context {basketId} {canManage ? "manager" : "reader"}
    </p>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
import Page from "./page";
import { buildReportVisualFixture } from "@/lib/reports/visual-fixtures";

const planId = "a2000000-0000-4000-8000-000000000002";
const params = Promise.resolve({ projectId: "helios", section: "campaigns" });

describe("RPT-06 exact issued-report entry into Overview", () => {
  const overviewParams = Promise.resolve({
    projectId: "helios",
    section: "overview",
  });
  const fixture = buildReportVisualFixture("ready");
  const client = {};
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.client.mockResolvedValue(client);
    mocks.overview.mockResolvedValue({
      state: "ready",
      fixture,
      evidenceProvenance: "synthetic",
    });
  });

  it("passes the issued link's exact report and version to the reader", async () => {
    const result = await Page({
      params: overviewParams,
      searchParams: Promise.resolve({
        report: fixture.report.id,
        version: "2",
        compare: "1",
        view: "economics",
        theme: "dark",
      }),
    });
    expect(mocks.overview).toHaveBeenCalledExactlyOnceWith(client, {
      report: fixture.report.id,
      version: 2,
    });
    expect(result.props).toMatchObject({
      state: "ready",
      fixture,
      initialTheme: "dark",
      initialView: "economics",
      compareVersion: 1,
      projectSlug: "helios",
    });
    expect(mocks.records).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("keeps an unavailable exact version and its analysis context on retry", async () => {
    mocks.overview.mockResolvedValue({ state: "error" });
    const result = await Page({
      params: overviewParams,
      searchParams: Promise.resolve({
        report: fixture.report.id,
        version: "99",
        compare: "1",
        view: "economics",
        theme: "dark",
      }),
    });
    render(result);
    expect(
      screen.getByRole("link", { name: "Retry overview" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/overview?report=${fixture.report.id}&version=99&compare=1&view=economics&theme=dark`,
    );
    expect(mocks.overview).toHaveBeenCalledExactlyOnceWith(client, {
      report: fixture.report.id,
      version: 99,
    });
    expect(
      screen.queryByRole("button", { name: /^Qualified wallets:/ }),
    ).toBeNull();
  });

  it.each([
    { report: "not-a-report-id" },
    { report: [fixture.report.id, fixture.report.id] },
    { version: "0" },
    { version: "1.5" },
    { version: "9007199254740992" },
    { version: ["1", "2"] },
    { compare: "-1" },
    { compare: ["1", "2"] },
  ])(
    "rejects malformed or ambiguous report links before loading: %j",
    async (query) => {
      await expect(
        Page({
          params: overviewParams,
          searchParams: Promise.resolve(query),
        }),
      ).rejects.toThrow("NOT_FOUND");
      expect(mocks.overview).not.toHaveBeenCalled();
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );

  it.each(["empty", "permission"])(
    "retains the reader's %s state without substituting sample results",
    async (state) => {
      mocks.overview.mockResolvedValue({ state });
      const result = await Page({
        params: overviewParams,
        searchParams: Promise.resolve({
          report: fixture.report.id,
          version: "2",
        }),
      });
      expect(result.props.state).toBe(state);
      expect(result.props.fixture).toBeUndefined();
      render(result);
      expect(
        screen.queryByRole("button", { name: /^Qualified wallets:/ }),
      ).toBeNull();
    },
  );
});

describe("explicit campaign plan entry", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.gate.mockReturnValue(false);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: "project" }, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    mocks.client.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
    mocks.list.mockRejectedValue(new Error("Must not select latest campaign"));
    mocks.records.mockResolvedValue({
      kind: "ready",
      records: [],
      hasNext: false,
    });
  });
  it("opens the selected plan even when another campaign exists", async () => {
    mocks.launch.mockResolvedValue({
      kind: "plan",
      canManage: true,
      pendingPlan: {
        id: planId,
        version: 2,
        approvedAt: "2026-09-01T12:00:00Z",
        name: "Next launch",
      },
    });
    render(
      await Page({ params, searchParams: Promise.resolve({ plan: planId }) }),
    );
    expect(screen.getByText("Next launch")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create campaign" }),
    ).toBeVisible();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.launch.mock.calls[0]?.[3]).toBe(planId);
  });
  it("reopens only the campaign returned for the selected plan", async () => {
    mocks.launch.mockResolvedValue({
      kind: "campaign",
      id: "a1000000-0000-4000-8000-000000000002",
    });
    await expect(
      Page({ params, searchParams: Promise.resolve({ plan: planId }) }),
    ).rejects.toThrow(
      "REDIRECT:/projects/helios/campaigns/a1000000-0000-4000-8000-000000000002",
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("opts only the selected-plan handoff into the application canvas and retains dark theme", async () => {
    mocks.launch.mockResolvedValue({
      kind: "plan",
      canManage: true,
      pendingPlan: {
        id: planId,
        version: 1,
        approvedAt: "2026-10-09T12:00:00Z",
        name: "Exact selected plan",
      },
    });
    const result = await Page({
      params,
      searchParams: Promise.resolve({ plan: planId, theme: "dark" }),
    });
    expect(result.props).toMatchObject({
      contentAppearance: "application",
      theme: "dark",
    });
    const { container } = render(result);
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull();
    mocks.launch.mockResolvedValue({ kind: "campaign", id: "exact-campaign" });
    await expect(
      Page({
        params,
        searchParams: Promise.resolve({ plan: planId, theme: "dark" }),
      }),
    ).rejects.toThrow(
      "REDIRECT:/projects/helios/campaigns/exact-campaign?theme=dark",
    );
  });
  it("does not fall back when the selection is missing or ambiguous", async () => {
    mocks.launch.mockResolvedValue({ kind: "missing" });
    await expect(
      Page({ params, searchParams: Promise.resolve({ plan: planId }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      Page({
        params,
        searchParams: Promise.resolve({ plan: [planId, planId] }),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("keeps denied plan access distinct and does not expose another campaign", async () => {
    mocks.launch.mockResolvedValue({ kind: "permission" });
    render(
      await Page({ params, searchParams: Promise.resolve({ plan: planId }) }),
    );
    expect(screen.getByText("Permission required")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create campaign" }),
    ).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("lists campaigns without selecting a latest campaign or approval", async () => {
    mocks.records.mockResolvedValue({
      kind: "ready",
      hasNext: false,
      records: [
        {
          id: "a1000000-0000-4000-8000-000000000001",
          name: "Chosen launch",
          updated_at: "2026-09-08T10:00:00Z",
          status: "approved",
        },
      ],
    });
    render(await Page({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Chosen launch" })).toHaveAttribute(
      "href",
      "/projects/helios/campaigns/a1000000-0000-4000-8000-000000000001",
    );
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("lists baskets and forwards the requested page without a latest redirect", async () => {
    render(
      await Page({
        params: Promise.resolve({ projectId: "helios", section: "baskets" }),
        searchParams: Promise.resolve({ page: "2" }),
      }),
    );
    expect(screen.getByText("No more records on this page")).toBeVisible();
    expect(mocks.records.mock.calls[0]?.slice(-2)).toEqual(["baskets", 2]);
  });
});

describe("BSK-08 explicit creator return context", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.gate.mockReturnValue(true);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: "project" }, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    mocks.client.mockResolvedValue({
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    mocks.creators.mockResolvedValue([]);
    mocks.strategy.mockResolvedValue({ persistence: "saved" });
  });
  const contextParams = Promise.resolve({
    projectId: "helios",
    section: "kols",
  });
  it("keeps the exact basket in the local creator journey", async () => {
    render(
      await Page({
        params: contextParams,
        searchParams: Promise.resolve({ basket: planId }),
      }),
    );
    expect(screen.getByText(`Context ${planId} manager`)).toBeVisible();
  });
  it.each(["bad", [planId, planId]])(
    "rejects malformed or repeated context %s",
    async (basket) => {
      await expect(
        Page({
          params: contextParams,
          searchParams: Promise.resolve({ basket }),
        }),
      ).rejects.toThrow("NOT_FOUND");
      expect(mocks.strategy).not.toHaveBeenCalled();
    },
  );
  it("does not fall back to new-basket creation when the gate is closed", async () => {
    mocks.gate.mockReturnValue(false);
    await expect(
      Page({
        params: contextParams,
        searchParams: Promise.resolve({ basket: planId }),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("does not adopt a legacy or missing basket", async () => {
    mocks.strategy.mockResolvedValue(null);
    await expect(
      Page({
        params: contextParams,
        searchParams: Promise.resolve({ basket: planId }),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
