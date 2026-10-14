import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanRevisionAction } from "./plan-revision-action";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const props = {
  projectId: "helios",
  basketId: "90000000-0000-4000-8000-000000000001",
  sourcePlanId: "94000000-0000-4000-8000-000000000001",
  theme: "dark" as const,
};
const newId = "90000000-0000-4000-8000-000000000002";
const campaignId = "91000000-0000-4000-8000-000000000001";
it("does not navigate for a late measurement receipt after changing campaign", async () => {
  let finish!: (response: Response) => void;
  let sent: { sourcePlanId: string; requestId: string };
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      sent = JSON.parse(init.body);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const view = render(
    <PlanRevisionAction {...props} measurementCampaignId={campaignId} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Set up results" }));
  view.rerender(
    <PlanRevisionAction {...props} measurementCampaignId={newId} />,
  );
  await act(async () =>
    finish(Response.json({ ...sent!, basketId: newId, campaignId })),
  );
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Set up results" })).toBeEnabled();
});
it("does not carry a created draft into another campaign on same-page navigation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) =>
      Response.json({
        ...JSON.parse(init.body),
        basketId: newId,
        campaignId,
      }),
    ),
  );
  const { rerender } = render(
    <PlanRevisionAction {...props} measurementCampaignId={campaignId} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Set up results" }));
  await screen.findByRole("link", { name: "Continue setup" });
  rerender(<PlanRevisionAction {...props} measurementCampaignId={newId} />);
  expect(screen.queryByRole("link", { name: "Continue setup" })).toBeNull();
  expect(screen.getByRole("button", { name: "Set up results" })).toBeVisible();
});
it("ignores a late draft receipt after the approved source changes", async () => {
  let finish!: (response: Response) => void;
  let sent: { sourcePlanId: string; requestId: string };
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      sent = JSON.parse(init.body);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const { rerender } = render(<PlanRevisionAction {...props} />);
  begin();
  rerender(<PlanRevisionAction {...props} sourcePlanId={newId} />);
  await act(async () => {
    finish(Response.json({ ...sent!, basketId: newId }));
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Creating draft…" }),
    ).toBeNull(),
  );
  expect(
    screen.queryByRole("link", { name: "Open editable draft" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Edit as new draft" }),
  ).toBeVisible();
});
afterEach(() => {
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function begin() {
  fireEvent.click(screen.getByRole("button", { name: "Edit as new draft" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Create editable draft" }),
  );
}
it("explains the draft up front and creates then opens it with one click", async () => {
  const fetcher = vi.fn(async (_url, init) =>
    Response.json({
      ...JSON.parse(init.body),
      basketId: newId,
      campaignId,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PlanRevisionAction {...props} measurementCampaignId={campaignId} />);
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByText(/You’ll review and approve the draft/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Set up results" }));
  expect(
    await screen.findByRole("link", { name: "Continue setup" }),
  ).toHaveAttribute(
    "href",
    `/projects/helios/baskets/${newId}?theme=dark&step=measurement`,
  );
  expect(push).toHaveBeenCalledWith(
    `/projects/helios/baskets/${newId}?theme=dark&step=measurement`,
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `/api/projects/helios/campaigns/${campaignId}/measurement-draft`,
  );
});
it("does not accept a measurement receipt belonging to another campaign", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) =>
      Response.json({
        ...JSON.parse(init.body),
        basketId: newId,
        campaignId: newId,
      }),
    ),
  );
  render(<PlanRevisionAction {...props} measurementCampaignId={campaignId} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up results" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("not confirmed"),
  );
  expect(screen.queryByRole("link")).toBeNull();
});
it("recovers uncertain measurement creation using its own stable request key", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockImplementationOnce(async (_url, init) =>
      Response.json({
        ...JSON.parse(init.body),
        basketId: newId,
        campaignId,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const first = render(
    <PlanRevisionAction {...props} measurementCampaignId={campaignId} />,
  );
  const start = () => {
    fireEvent.click(screen.getByRole("button", { name: "Set up results" }));
  };
  start();
  await screen.findByText("Response lost");
  first.unmount();
  render(<PlanRevisionAction {...props} measurementCampaignId={campaignId} />);
  start();
  await screen.findByRole("link", { name: "Continue setup" });
  expect(fetcher.mock.calls[0]![1].body).toBe(fetcher.mock.calls[1]![1].body);
  expect(
    sessionStorage.getItem(
      `plan-revision:${props.projectId}:${props.basketId}:${props.sourcePlanId}`,
    ),
  ).toBeNull();
});
it("requires confirmation and links only an exact returned draft without automatic navigation", async () => {
  const fetcher = vi.fn(async (_url, init) =>
    Response.json(
      { ...JSON.parse(init.body), basketId: newId },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PlanRevisionAction {...props} />);
  expect(fetcher).not.toHaveBeenCalled();
  begin();
  expect(
    await screen.findByRole("link", { name: "Open editable draft" }),
  ).toHaveAttribute(
    "href",
    `/projects/helios/baskets/${newId}?theme=dark&step=target`,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `/api/projects/helios/baskets/${props.basketId}/revision`,
  );
});
it("recovers an uncertain response using the same key even after remount", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockImplementationOnce(async (_url, init) =>
      Response.json({ ...JSON.parse(init.body), basketId: newId }),
    );
  vi.stubGlobal("fetch", fetcher);
  const first = render(<PlanRevisionAction {...props} />);
  begin();
  await screen.findByText("Response lost");
  first.unmount();
  render(<PlanRevisionAction {...props} />);
  begin();
  await screen.findByRole("link", { name: "Open editable draft" });
  expect(fetcher.mock.calls[0]![1].body).toBe(fetcher.mock.calls[1]![1].body);
});
it.each(["wrong-source", "wrong-request", "same-basket", "invalid-id"])(
  "does not offer navigation for %s responses",
  async (kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) =>
        Response.json({
          ...JSON.parse(init.body),
          ...(kind === "wrong-source" ? { sourcePlanId: newId } : {}),
          ...(kind === "wrong-request" ? { requestId: newId } : {}),
          basketId:
            kind === "same-basket"
              ? props.basketId
              : kind === "invalid-id"
                ? "https://evil.test"
                : newId,
        }),
      ),
    );
    render(<PlanRevisionAction {...props} />);
    begin();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("not confirmed"),
    );
    expect(screen.queryByRole("link")).toBeNull();
  },
);
