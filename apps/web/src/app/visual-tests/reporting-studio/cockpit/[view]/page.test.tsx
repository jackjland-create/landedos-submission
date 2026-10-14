import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
afterEach(() => vi.unstubAllEnvs());
describe("cockpit proposal boundary", () => {
  it.each(["production", "test"])(
    "rejects %s regardless of visual fixture flag",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
      await expect(
        Page({
          params: Promise.resolve({ view: "home" }),
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toThrow("not found");
    },
  );
  it("rejects unknown states in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(
      Page({
        params: Promise.resolve({ view: "home" }),
        searchParams: Promise.resolve({ state: "complete" }),
      }),
    ).rejects.toThrow("not found");
  });
  it("allows only the explicit read-only development proposal", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await Page({
      params: Promise.resolve({ view: "home" }),
      searchParams: Promise.resolve({ state: "partial" }),
    });
    expect(result.props.proposalOnly).toBe(true);
    expect(result.props.showGuidedDemo).toBe(false);
  });
});
