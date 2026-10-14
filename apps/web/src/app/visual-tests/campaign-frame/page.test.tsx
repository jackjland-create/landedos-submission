import { afterEach, expect, it, vi } from "vitest";
import { CampaignControlWorkspace } from "@/components/campaign-control-workspace";
import Page from "./page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
afterEach(() => vi.unstubAllEnvs());

it("keeps embedded preview workflows read-only even when manager is requested", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  for (const view of ["control", "roster", "content", "tracking", "results"]) {
    const result = await Page({
      searchParams: Promise.resolve({ view, role: "manager", stage: "live" }),
    });
    const workspace = result.props.children;
    expect(workspace.type).toBe(CampaignControlWorkspace);
    expect(workspace.props.canManage).toBe(view === "control");
  }
});

it.each(["production", "test", "hosted-development"])(
  "does not expose a frame in %s",
  async (mode) => {
    vi.stubEnv(
      "NODE_ENV",
      mode === "hosted-development" ? "development" : mode,
    );
    vi.stubEnv("VERCEL", mode === "hosted-development" ? "1" : "");
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NOT_FOUND",
    );
  },
);
