import { beforeEach, expect, it, vi } from "vitest";
import { project } from "@/lib/demo-data";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  basket: vi.fn(),
  strategy: vi.fn(),
  rule: vi.fn(),
  jobs: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@landed/db", async (original) => ({
  ...(await original<object>()),
  getProjectBasket: mocks.basket,
  getSavedBasketStrategy: mocks.strategy,
  getProjectConversionRule: mocks.rule,
  getProjectConversionReplayJobs: mocks.jobs,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
import Page from "./page";

const planId = "90000000-0000-4000-8000-000000000001";
const params = Promise.resolve({ projectId: "helios" });
let client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetAllMocks();
  const result = { data: { id: project.databaseId }, error: null, count: 0 };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue({
    ...query,
    then: (resolve: (v: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  });
  client = {
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  mocks.client.mockResolvedValue(client);
  mocks.rule.mockResolvedValue(null);
  mocks.jobs.mockResolvedValue([]);
  mocks.basket.mockResolvedValue({
    id: planId,
    projectId: project.databaseId,
    workspaceId: project.workspaceId,
    name: "Verified plan",
  });
  mocks.strategy.mockResolvedValue({
    draft: {
      strategy: { measurement: { conversionRuleVersionId: "exact-version" } },
    },
  });
});

it("constructs a same-project measurement return from authenticated plan data", async () => {
  const page = await Page({
    params,
    searchParams: Promise.resolve({ plan: planId, theme: "dark" }),
  });
  expect(mocks.basket).toHaveBeenCalledWith(client, project.databaseId, planId);
  expect(page.props).toMatchObject({
    theme: "dark",
    contentAppearance: "application",
  });
  expect(page.props.children.props).toMatchObject({
    theme: "dark",
    planContext: {
      name: "Verified plan",
      href: `/projects/helios/baskets/${planId}?step=measurement&theme=dark`,
      versionId: "exact-version",
    },
  });
});

it.each(["https://example.com/redirect", "../other-project", [planId, planId]])(
  "ignores invalid return context %s",
  async (plan) => {
    const page = await Page({
      params,
      searchParams: Promise.resolve({ plan }),
    });
    expect(mocks.basket).not.toHaveBeenCalled();
    expect(page.props.children.props.planContext).toBeUndefined();
  },
);

it.each([
  null,
  {
    id: planId,
    projectId: "other",
    workspaceId: project.workspaceId,
    name: "Other plan",
  },
])("does not expose an inaccessible or mismatched plan", async (plan) => {
  mocks.basket.mockResolvedValue(plan);
  const page = await Page({
    params,
    searchParams: Promise.resolve({ plan: planId }),
  });
  expect(mocks.strategy).not.toHaveBeenCalled();
  expect(page.props.children.props.planContext).toBeUndefined();
});
