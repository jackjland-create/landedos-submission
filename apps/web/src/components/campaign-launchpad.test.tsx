import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandoff } from "@/test/capture-handoff";

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import {
  CampaignLaunchpad,
  CampaignLaunchpadPermission,
} from "./campaign-launchpad";

const pendingPlan = {
  id: "a2000000-0000-4000-8000-000000000001",
  version: 1,
  approvedAt: "2026-08-05T12:00:00.000Z",
  basketId: "90000000-0000-4000-8000-000000000002",
  name: "Selected basket",
};

describe("campaign launchpad", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.stubGlobal("crypto", {
      randomUUID: () => "a6000000-0000-4000-8000-000000000001",
    });
  });

  it("creates the campaign from the issued plan and opens it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          campaign: { id: "a1000000-0000-4000-8000-000000000001" },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CampaignLaunchpad canManage pendingPlan={pendingPlan} />);
    captureHandoff("launch-ready", "campaigns");
    expect(screen.getByText("Selected basket")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to approved plan" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/baskets/${pendingPlan.basketId}#commercial-approval`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    captureHandoff("launch-saving", "campaigns");

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/projects/helios/campaigns/a1000000-0000-4000-8000-000000000001",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/helios/campaigns",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commercialPlanVersionId: pendingPlan.id,
          activationRequestId: "a6000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("shows read-only, empty and recoverable failure states", async () => {
    const { rerender } = render(
      <CampaignLaunchpad canManage={false} pendingPlan={pendingPlan} />,
    );
    captureHandoff("launch-readonly", "campaigns");

    expect(
      screen.queryByRole("button", { name: "Create campaign" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Campaign manager access is required to create the roster.",
      ),
    ).toBeVisible();

    rerender(<CampaignLaunchpad canManage={false} pendingPlan={null} />);
    captureHandoff("launch-empty", "campaigns");
    expect(
      screen.getByRole("heading", {
        name: "Approve a plan first",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open campaign plans" }),
    ).toHaveAttribute("href", "/projects/helios/baskets");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "Plan is no longer available." }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    rerender(<CampaignLaunchpad canManage pendingPlan={pendingPlan} />);
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Plan is no longer available.",
    );
    captureHandoff("launch-error", "campaigns");
  });

  it("keeps denied project access distinct from first-use emptiness", () => {
    render(<CampaignLaunchpadPermission />);
    captureHandoff("launch-permission", "campaigns");

    expect(
      screen.getByRole("heading", {
        name: "This campaign workspace is outside your project access.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Permission required")).toBeVisible();
  });

  it("preserves dark theme, approved identity and exact creation payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ campaign: { id: "created-campaign" } }),
            { status: 201 },
          ),
        ),
    );
    const { container } = render(
      <CampaignLaunchpad canManage pendingPlan={pendingPlan} theme="dark" />,
    );
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      pendingPlan.name,
    );
    expect(screen.getByText("Approved · version 1")).toBeVisible();
    expect(
      screen.getByText(
        /doesn’t send offers, pay creators or put anything live/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to approved plan" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/baskets/${pendingPlan.basketId}?theme=dark#commercial-approval`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/projects/helios/campaigns/created-campaign?theme=dark",
      ),
    );
  });

  it("announces a pending request and prevents repeat clicks", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<CampaignLaunchpad canManage pendingPlan={pendingPlan} />);
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    const pending = screen.getByRole("button", { name: "Creating campaign…" });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Creating campaign…");
    fireEvent.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
