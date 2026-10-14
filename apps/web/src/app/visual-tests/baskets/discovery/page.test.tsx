import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const { enabled, client, rpc, getUser } = vi.hoisted(() => ({
  enabled: vi.fn(),
  client: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/baskets/timing-enabled", () => ({
  basketTimingEnabled: enabled,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: client }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/basket-discovery", () => ({
  BasketDiscovery: ({ canManage }: { canManage: boolean }) => (
    <button disabled={!canManage}>Create rehearsal basket</button>
  ),
}));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ENABLE_TIMING_REHEARSAL", "1");
  enabled.mockReturnValue(true);
  getUser.mockResolvedValue({
    data: { user: { id: "test-owner" } },
    error: null,
  });
  rpc.mockResolvedValue({ data: true, error: null });
  client.mockResolvedValue({ auth: { getUser }, rpc });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe("BSK-08 local discovery route", () => {
  it("rejects outside the local integration gate before reading identity", async () => {
    enabled.mockReturnValue(false);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "not-found",
    );
    expect(client).not.toHaveBeenCalled();
  });
  it("requires the separate rehearsal switch", async () => {
    vi.stubEnv("ENABLE_TIMING_REHEARSAL", "0");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "not-found",
    );
    expect(client).not.toHaveBeenCalled();
  });
  it("rejects repeated template parameters", async () => {
    await expect(
      Page({
        searchParams: Promise.resolve({
          template: ["custom", "investor_reach"],
        }),
      }),
    ).rejects.toThrow("not-found");
  });
  it("allows a scoped manager and states approval is unavailable", async () => {
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button")).toBeEnabled();
    expect(
      screen.getByText(/approval and campaign activation remain unavailable/),
    ).toBeVisible();
    expect(rpc).toHaveBeenCalledWith(
      "can_manage_project",
      expect.objectContaining({
        target_project_id: "20000000-0000-4000-8000-000000000001",
      }),
    );
  });
  it("keeps a non-manager read-only", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button")).toBeDisabled();
  });
  it("fails closed when access cannot be confirmed", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "private" } });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not confirm basket access",
    );
    expect(screen.queryByText("private")).not.toBeInTheDocument();
  });
  it("does not query manager access without a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
