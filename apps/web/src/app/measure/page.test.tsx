import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { contextMock, onwardMock, cookieValue } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  onwardMock: vi.fn(),
  cookieValue: { current: "90990000-0000-4000-8000-000000000005" },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () =>
      cookieValue.current ? { value: cookieValue.current } : undefined,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({ rpc: vi.fn() })),
}));
vi.mock("@/lib/wallet/measurement-context.server", () => ({
  readWalletMeasurementRuleContext: contextMock,
}));
vi.mock("@/lib/wallet/continuation.server", () => ({
  readHostedContinuation: onwardMock,
}));
vi.mock("@/lib/tracking/signing.server", () => ({
  getTrackedLinkApplicationOrigin: () => "https://landed.example",
}));
vi.mock("@/components/wallet-measurement-flow", () => ({
  WalletMeasurementFlow: (props: {
    available: boolean;
    receiverAddress?: string;
    continuationHostname?: string;
  }) => (
    <div>
      <span>{props.available ? "available" : "unavailable"}</span>
      <span>{props.receiverAddress ?? "no receiver"}</span>
      <span>{props.continuationHostname ?? "no continuation"}</span>
    </div>
  ),
}));

import MeasurePage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onwardMock.mockReset();
  cookieValue.current = "90990000-0000-4000-8000-000000000005";
});

describe("measurement page", () => {
  it("only exposes the trusted hostname and keeps consent recovery when onward lookup fails", async () => {
    contextMock.mockResolvedValue({
      receiverAddress: "Vote111111111111111111111111111111111111111",
    });
    onwardMock.mockResolvedValue({
      url: "https://brand.example/path",
      hostname: "brand.example",
    });
    render(await MeasurePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("brand.example")).toBeVisible();
    expect(onwardMock).toHaveBeenCalledWith(
      expect.anything(),
      cookieValue.current,
      "https://landed.example",
    );
    cleanup();
    onwardMock.mockRejectedValue(new Error("unavailable"));
    render(await MeasurePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("available")).toBeVisible();
    expect(screen.getByText("no continuation")).toBeVisible();
  });
  it("renders the receiver from the session's exact approved rule", async () => {
    contextMock.mockResolvedValue({
      ruleVersionId: "61990000-0000-4000-8000-000000000001",
      chainId: "solana:devnet",
      receiverAddress: "Vote111111111111111111111111111111111111111",
      nativeAmountLamports: "1",
    });

    render(await MeasurePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("available")).toBeVisible();
    expect(
      screen.getByText("Vote111111111111111111111111111111111111111"),
    ).toBeVisible();
    expect(contextMock).toHaveBeenCalledWith(
      expect.anything(),
      cookieValue.current,
    );
  });

  it("fails closed when the cookie or approved rule is unavailable", async () => {
    contextMock.mockResolvedValue(null);
    render(await MeasurePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("unavailable")).toBeVisible();
    expect(screen.getByText("no receiver")).toBeVisible();

    cleanup();
    contextMock.mockClear();
    cookieValue.current = "not-a-session";
    render(await MeasurePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("unavailable")).toBeVisible();
    expect(contextMock).not.toHaveBeenCalled();
  });
});
