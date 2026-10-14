import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";
import { project } from "@/lib/demo-data";
import { PlanReviewVisibleContext } from "./basket-workspace";
import {
  BasketSavedPlanReview,
  loadSavedPlanReview,
  type SavedPlanReviewContext,
} from "./basket-saved-plan-review";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
const snapshot = structuredClone(fixture.review_snapshot);
snapshot.workspaceId = project.workspaceId;
snapshot.projectId = project.databaseId;
snapshot.strategyBinding.conversionRule.workspaceId = project.workspaceId;
snapshot.strategyBinding.conversionRule.projectId = project.databaseId;
const context: SavedPlanReviewContext = {
  basketId: snapshot.basket.id,
  scenarioId: snapshot.scenario.id,
  expectedOwnerId: "91000000-0000-4000-8000-000000000011",
  expectedRevision: snapshot.strategyBinding.revision,
  expectedTiming: snapshot.strategyBinding
    .timing as SavedPlanReviewContext["expectedTiming"],
};
const payload = {
  snapshot,
  snapshotHash: fixture.review_snapshot_hash,
  ownerId: context.expectedOwnerId,
  approvalAvailable: false as const,
};
const request = () =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
const valid = () => loadSavedPlanReview(context, request());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("saved plan review", () => {
  it("loads once when its review panel opens, without another review click", async () => {
    const load = vi.fn(valid);
    const contents = (visible: boolean) => (
      <PlanReviewVisibleContext.Provider value={visible}>
        <BasketSavedPlanReview context={context} canManage load={load} />
      </PlanReviewVisibleContext.Provider>
    );
    const view = render(contents(false));
    expect(load).not.toHaveBeenCalled();
    view.rerender(contents(true));
    await screen.findByText("Scenario A: Focused authority");
    expect(load).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Review saved plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Approval is unavailable in this preview"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    view.rerender(contents(false));
    view.rerender(contents(true));
    expect(load).toHaveBeenCalledOnce();
  });
  it("does not loop after an automatic read fails; retries only on request", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <PlanReviewVisibleContext.Provider value>
        <BasketSavedPlanReview context={context} canManage load={load} />
      </PlanReviewVisibleContext.Provider>,
    );
    const retry = await screen.findByRole("button", {
      name: "Try loading the plan again",
    });
    expect(load).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
  it("does not read when permission or saved context is missing", async () => {
    const load = vi.fn(valid);
    const view = render(
      <PlanReviewVisibleContext.Provider value>
        <BasketSavedPlanReview
          context={context}
          canManage={false}
          load={load}
        />
      </PlanReviewVisibleContext.Provider>,
    );
    expect(
      screen.getByText(/Campaign manager access is required to review/),
    ).toBeVisible();
    view.rerender(
      <PlanReviewVisibleContext.Provider value>
        <BasketSavedPlanReview context={null} canManage load={load} />
      </PlanReviewVisibleContext.Provider>,
    );
    expect(screen.getByText(/Save complete dates/)).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });
  it("does not steal focus after closing or automatically reread an invalidated review", async () => {
    let finish!: (value: Awaited<ReturnType<typeof valid>>) => void;
    const load = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof valid>>>((resolve) => {
          finish = resolve;
        }),
    );
    const contents = (visible: boolean) => (
      <>
        <input aria-label="Outside plan edit" />
        <PlanReviewVisibleContext.Provider value={visible}>
          <BasketSavedPlanReview context={context} canManage load={load} />
        </PlanReviewVisibleContext.Provider>
      </>
    );
    const view = render(contents(true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    view.rerender(contents(false));
    const outside = screen.getByLabelText("Outside plan edit");
    outside.focus();
    await act(async () => {
      finish(await valid());
    });
    await screen.findByText("Scenario A: Focused authority");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(outside).toHaveFocus();
    view.rerender(contents(true));
    fireEvent.input(outside, { target: { value: "Changed" } });
    await screen.findByRole("button", { name: "Try loading the plan again" });
    expect(
      screen.queryByText("Scenario A: Focused authority"),
    ).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });
  it("uses exact owner/scenario/timing and validates the real SQL shape", async () => {
    const fetcher = request();
    await loadSavedPlanReview(context, fetcher);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toMatchObject({
      expectedOwnerId: context.expectedOwnerId,
      scenarioId: context.scenarioId,
    });
  });
  it.each(["ownerId", "approvalAvailable", "snapshotHash"])(
    "rejects changed %s",
    async (field) => {
      const bad = { ...payload, [field]: "invalid" };
      await expect(
        loadSavedPlanReview(
          context,
          vi.fn().mockResolvedValue(new Response(JSON.stringify(bad))),
        ),
      ).rejects.toThrow();
    },
  );
  it("rejects mismatched dates and scenario", async () => {
    await expect(
      loadSavedPlanReview(
        { ...context, scenarioId: context.basketId },
        request(),
      ),
    ).rejects.toThrow();
    await expect(
      loadSavedPlanReview(
        {
          ...context,
          expectedTiming: {
            ...context.expectedTiming,
            flight: {
              ...context.expectedTiming.flight,
              endedAt: "2026-10-06T00:00:00Z",
            },
          },
        },
        request(),
      ),
    ).rejects.toThrow();
  });
  it("shows exact distinct fees without an approval action", async () => {
    render(<BasketSavedPlanReview context={context} canManage load={valid} />);
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText("Saved plan loaded. This is not an approval.");
    expect(screen.getByText("GBP 1275 fixed")).toBeInTheDocument();
    expect(screen.getByText("GBP 3920 fixed")).toBeInTheDocument();
    expect(
      screen.getByText(
        /This scenario includes 2 packages for 2 creators\. The full shortlist contains 3 creators/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
  });
  it("shows the saved reason for an unpaid internal test without inventing a fee", async () => {
    const unpaidSnapshot = {
      ...snapshot,
      packages: [
        {
          ...snapshot.packages[0],
          compensationLines: [],
          commercialDetail: {
            schemaVersion: 2,
            revision: 1,
            creatorDisplayName: "Creator 1",
            channels: [],
            deliveryDeadline: null,
            usageRights: null,
            exclusivity: null,
            commercialBasis: "unpaid_internal_test",
            unpaidReason: "Approved internal devnet response proof",
          },
        },
        ...snapshot.packages.slice(1),
      ],
    };
    render(
      <BasketSavedPlanReview
        context={context}
        canManage
        load={() =>
          loadSavedPlanReview(
            context,
            vi
              .fn()
              .mockResolvedValue(
                new Response(
                  JSON.stringify({ ...payload, snapshot: unpaidSnapshot }),
                ),
              ),
          )
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText("Saved plan loaded. This is not an approval.");
    expect(
      screen.getByText(
        "Unpaid internal test. No creator payment commitment. Reason: Approved internal devnet response proof",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This scenario includes 2 packages for 2 creators/),
    ).toBeInTheDocument();
    expect(screen.queryByText("GBP 1275 fixed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
  });
  it("links strategy blockers to purpose without enabling a review", () => {
    const load = vi.fn();
    render(
      <BasketSavedPlanReview
        context={null}
        canManage
        load={load}
        blockedReason="Save your strategy first."
        blockedTarget="#basket-strategy"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Return to purpose and measurement" }),
    ).toHaveAttribute("href", "#basket-strategy");
    expect(
      screen.getByRole("button", { name: "Review saved plan" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Saved plan review" }),
    ).toHaveAttribute("id", "basket-plan-review");
    expect(load).not.toHaveBeenCalled();
  });
  it("links missing dates to date planning and exposes no repair action without permission", () => {
    const view = render(<BasketSavedPlanReview context={null} canManage />);
    expect(
      screen.getByRole("link", { name: "Return to saved dates" }),
    ).toHaveAttribute("href", "#basket-timing");
    view.rerender(<BasketSavedPlanReview context={null} canManage={false} />);
    expect(
      screen.queryByRole("link", { name: "Return to saved dates" }),
    ).not.toBeInTheDocument();
  });
  it.each([false, true])(
    "blocks requests without permission or confirmed dates: %s",
    (canManage) => {
      const load = vi.fn();
      render(
        <BasketSavedPlanReview
          context={canManage ? null : context}
          canManage={canManage}
          load={load}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Review saved plan" }),
      ).toBeDisabled();
      expect(load).not.toHaveBeenCalled();
    },
  );
  it("ignores an old pending response after identity changes", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof valid>>) => void;
    const promise = new Promise<Awaited<ReturnType<typeof valid>>>((done) => {
      resolve = done;
    });
    const { rerender } = render(
      <BasketSavedPlanReview
        context={context}
        canManage
        load={() => promise}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    rerender(
      <BasketSavedPlanReview
        context={{ ...context, expectedOwnerId: context.basketId }}
        canManage
        load={valid}
      />,
    );
    await act(async () => resolve(await valid()));
    expect(
      screen.queryByText("Scenario A: Focused authority"),
    ).not.toBeInTheDocument();
  });
  it("clears visible review on outside edits but retains it across window blur", async () => {
    render(
      <>
        <input aria-label="Other package" />
        <BasketSavedPlanReview context={context} canManage load={valid} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText("Scenario A: Focused authority");
    fireEvent.input(screen.getByLabelText("Other package"), {
      target: { value: "changed" },
    });
    expect(
      screen.queryByText("Scenario A: Focused authority"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText("Scenario A: Focused authority");
    fireEvent.blur(window);
    fireEvent.focus(window);
    expect(
      screen.getByText("Scenario A: Focused authority"),
    ).toBeInTheDocument();
  });
  it("retains an in-flight saved-plan read across window blur without reloading", async () => {
    let finish!: (value: Awaited<ReturnType<typeof valid>>) => void;
    const load = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof valid>>>((resolve) => {
          finish = resolve;
        }),
    );
    render(<BasketSavedPlanReview context={context} canManage load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    fireEvent.blur(window);
    expect(
      screen.getByRole("button", { name: "Loading saved plan…" }),
    ).toBeDisabled();
    await act(async () => finish(await valid()));
    fireEvent.focus(window);
    expect(
      screen.getByText("Scenario A: Focused authority"),
    ).toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });
  it("shows a safe actionable transport error", async () => {
    render(
      <BasketSavedPlanReview
        context={context}
        canManage
        load={() =>
          loadSavedPlanReview(
            context,
            vi
              .fn()
              .mockResolvedValue(
                new Response("private details", { status: 503 }),
              ),
          )
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText(
      "The saved plan could not be loaded. Try again. No approval was made.",
    );
    expect(screen.queryByText("private details")).not.toBeInTheDocument();
  });
  it.each(["input", "submit"])(
    "outside %s invalidates a pending read and rejects its late result",
    async (event) => {
      let finish!: (value: Awaited<ReturnType<typeof valid>>) => void;
      const load = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof valid>>>((resolve) => {
            finish = resolve;
          }),
      );
      render(
        <>
          <form aria-label="Other edit">
            <input aria-label="Other package" />
          </form>
          <BasketSavedPlanReview context={context} canManage load={load} />
        </>,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Review saved plan" }),
      );
      if (event === "input")
        fireEvent.input(screen.getByLabelText("Other package"));
      else fireEvent.submit(screen.getByRole("form", { name: "Other edit" }));
      await act(async () => finish(await valid()));
      expect(screen.queryByText("Scenario A: Focused authority")).toBeNull();
      expect(
        screen.getByText(
          "The plan may have changed. Load a fresh saved-plan review.",
        ),
      ).toBeInTheDocument();
      expect(load).toHaveBeenCalledOnce();
    },
  );
  it("does not surface unexpected provider or network details", async () => {
    render(
      <BasketSavedPlanReview
        context={context}
        canManage
        load={async () => {
          throw new Error("private provider details");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    await screen.findByText(
      "The saved plan could not be confirmed. Reload saved dates and try again.",
    );
    expect(
      screen.queryByText("private provider details"),
    ).not.toBeInTheDocument();
  });
});

describe("saved-plan review with a mounted commercial decision", () => {
  const reviewId = "5f52493b-5673-4838-9d1c-d8145793938c";
  const selectedId = "6f52493b-5673-4838-9d1c-d8145793938c";
  const draft = () => ({
    id: reviewId,
    ownerId: context.expectedOwnerId,
    snapshotHash: payload.snapshotHash,
    snapshot: structuredClone(snapshot),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  });
  const response = (value: unknown) => ({ ok: true, json: async () => value });
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });
  async function open(mode: "browser" | "devnet" = "browser") {
    render(
      <BasketSavedPlanReview
        context={context}
        canManage
        load={valid}
        localCommercialEnabled
        localCommercialMode={mode}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Review and approve" }),
    );
    await screen.findByRole("table");
  }
  it.each(["browser", "devnet"] as const)(
    "preserves %s draft, pending confirmation and uncertain recovery across blur",
    async (mode) => {
      const prepared = draft();
      const selected = {
        ...prepared,
        id: selectedId,
        selection: {
          version: 1,
          sourceReviewId: reviewId,
          sourceSnapshotHash: prepared.snapshotHash,
          packageIds: prepared.snapshot.packages.map((p) => p.id),
        },
      };
      let rejectConfirmation!: (error: Error) => void;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(prepared))
        .mockResolvedValueOnce(response(selected))
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectConfirmation = reject;
            }),
        );
      vi.stubGlobal("fetch", fetcher);
      await open(mode);
      fireEvent.change(screen.getByLabelText("Note (optional)"), {
        target: { value: "Reviewed exact saved terms" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "Select all packages for approval",
        }),
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: /I have reviewed/ }),
      );
      fireEvent.blur(window);
      fireEvent.focus(window);
      expect(screen.getByLabelText("Note (optional)")).toHaveValue(
        "Reviewed exact saved terms",
      );
      expect(
        screen.getByRole("checkbox", { name: /I have reviewed/ }),
      ).toBeChecked();
      expect(
        screen.getByRole("checkbox", {
          name: "Select all packages for approval",
        }),
      ).toBeChecked();
      expect(fetcher).toHaveBeenCalledOnce();
      fireEvent.click(
        screen.getByRole("button", { name: "Approve selected terms" }),
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      fireEvent.blur(window);
      expect(
        screen.getByText(/Closing this view will not cancel the request/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Check approval status" }),
      ).toHaveAttribute("href", `?commercialReview=${selectedId}`);
      await act(async () =>
        rejectConfirmation(new Error("response unavailable")),
      );
      fireEvent.focus(window);
      fireEvent.blur(window);
      expect(
        screen.getByText(/Approval status is uncertain/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Approve selected terms" }),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "Check approval status" }),
      ).toHaveAttribute("href", `?commercialReview=${selectedId}`);
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );
  it("keeps an expired decision blocked after returning to the window", async () => {
    const prepared = draft();
    const fetcher = vi.fn().mockResolvedValue(response(prepared));
    vi.stubGlobal("fetch", fetcher);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all packages for approval",
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
    fireEvent.blur(window);
    // Background tabs may throttle timers; confirmation must check wall time.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(prepared.expiresAt) + 1);
    fireEvent.focus(window);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve selected terms" }),
    );
    expect(screen.getByText(/This review has expired/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve selected terms" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start a fresh review" }),
    ).toBeEnabled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
