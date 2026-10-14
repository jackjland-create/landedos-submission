import { renderToString } from "react-dom/server";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserCommercialRecovery,
  LocalDevnetCommercialRecovery,
} from "./browser-commercial-review";

const state = vi.hoisted(() => ({
  reviewId: "90000000-0000-4000-8000-000000000001",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({ commercialReview: state.reviewId }),
}));
const basketId = "90000000-0000-4000-8000-000000000002";
const projectId = "helios";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  state.reviewId = "90000000-0000-4000-8000-000000000001";
});
describe("isolated commercial recovery hydration boundary", () => {
  it("renders its server-side action disabled and sends no automatic request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const element = document.createElement("div");
    element.innerHTML = renderToString(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    expect(element.querySelector("button")).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("enables after mount and only reads the exact retained decision on explicit click", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "not_recorded", reviewId: state.reviewId }),
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    const button = screen.getByRole("button", {
      name: "Check approval status",
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText(
      "Nothing was approved. Return to the saved plan and review it again.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url, "http://localhost").searchParams.get("reviewId")).toBe(
      state.reviewId,
    );
    expect(new URL(url, "http://localhost").searchParams.get("basketId")).toBe(
      basketId,
    );
    expect(options).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    expect(options.body).toBeUndefined();
    expect(
      screen.queryByRole("button", {
        name: "Create campaign",
      }),
    ).not.toBeInTheDocument();
  });
  it("does not render an action for a malformed review identity", () => {
    state.reviewId = "invalid";
    render(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("recovers an approved decision, creates once, and links to the current project", async () => {
    const campaignId = "90000000-0000-4000-8000-000000000003";
    const approved = {
      status: "approved",
      reviewId: state.reviewId,
      commercialPlanVersionId: "90000000-0000-4000-8000-000000000004",
      snapshotHash: "selected-hash",
      campaignId: null,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => approved })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...approved, campaignId }),
      });
    vi.stubGlobal("fetch", fetch);
    render(
      <BrowserCommercialRecovery
        basketId={basketId}
        projectId="another-project"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    const create = await screen.findByRole("button", {
      name: "Create campaign",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(create);
    const link = await screen.findByRole("link", {
      name: /Open campaign workspace/,
    });
    expect(link).toHaveAttribute(
      "href",
      `/projects/another-project/campaigns/${campaignId}`,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      action: "create",
      basketId,
      reviewId: state.reviewId,
      acknowledged: true,
    });
  });
  it("requires a fresh status read after an uncertain campaign creation", async () => {
    const approved = {
      status: "approved",
      reviewId: state.reviewId,
      commercialPlanVersionId: "90000000-0000-4000-8000-000000000004",
      snapshotHash: "selected-hash",
      campaignId: null,
    };
    const campaignId = "90000000-0000-4000-8000-000000000003";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => approved })
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...approved, campaignId }),
      });
    vi.stubGlobal("fetch", fetch);
    render(
      <LocalDevnetCommercialRecovery
        basketId={basketId}
        projectId={projectId}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create campaign",
      }),
    );
    await screen.findByText(
      /We couldn’t (check the saved decision|confirm whether the campaign was created)/,
    );
    expect(
      screen.queryByRole("button", {
        name: "Create campaign",
      }),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    expect(
      await screen.findByRole("link", { name: /Open campaign workspace/ }),
    ).toHaveAttribute("href", `/projects/${projectId}/campaigns/${campaignId}`);
    expect(fetch.mock.calls[0][0]).toContain("/api/isolated-devnet-rehearsal?");
    expect(JSON.parse(fetch.mock.calls[1][1].body).action).toBe(
      "createCampaign",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not issue a second campaign write while creation is pending", async () => {
    const approved = {
      status: "approved",
      reviewId: state.reviewId,
      commercialPlanVersionId: "90000000-0000-4000-8000-000000000004",
      snapshotHash: "selected-hash",
      campaignId: null,
    };
    let finish!: (value: unknown) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => approved })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    render(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    const create = await screen.findByRole("button", {
      name: "Create campaign",
    });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(create).toBeDisabled();
    finish({
      ok: true,
      json: async () => ({
        ...approved,
        campaignId: "90000000-0000-4000-8000-000000000003",
      }),
    });
    expect(
      await screen.findByRole("link", { name: /Open campaign workspace/ }),
    ).toBeVisible();
  });
  it("discards an approved decision when the URL switches to another review", async () => {
    const nextReviewId = "90000000-0000-4000-8000-000000000005";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "approved",
          reviewId: state.reviewId,
          commercialPlanVersionId: "90000000-0000-4000-8000-000000000004",
          snapshotHash: "selected-hash",
          campaignId: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "not_recorded", reviewId: nextReviewId }),
      });
    vi.stubGlobal("fetch", fetch);
    const view = render(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Create campaign",
      }),
    ).toBeVisible();
    state.reviewId = nextReviewId;
    view.rerender(
      <BrowserCommercialRecovery basketId={basketId} projectId={projectId} />,
    );
    expect(
      screen.queryByRole("button", {
        name: "Create campaign",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    await screen.findByText(
      "Nothing was approved. Return to the saved plan and review it again.",
    );
    expect(
      new URL(fetch.mock.calls[1][0], "http://localhost").searchParams.get(
        "reviewId",
      ),
    ).toBe(nextReviewId);
  });
});
