import { StrictMode } from "react";
import Link from "next/link";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BasketTimingPanel } from "./basket-timing-panel";
import { forgetTimingDraft } from "@/lib/baskets/timing-recovery";
import { captureTimingEvidence } from "@/test/capture-timing";
const timing = {
  schemaVersion: 1 as const,
  flight: {
    startedAt: "2026-09-14T09:00:00Z",
    endedAt: "2026-10-05T17:00:00Z",
  },
  measurement: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-10-12T17:00:00Z",
  },
};
const basketId = "90000000-0000-4000-8000-000000000001";
const ownerId = "91000000-0000-4000-8000-000000000099";
function client() {
  return {
    load: vi.fn().mockResolvedValue({ revision: 3, timing }),
    save: vi.fn().mockResolvedValue({ revision: 4 }),
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forgetTimingDraft(ownerId, "helios", basketId);
});
describe("BSK-09 connected basket timing panel", () => {
  it("refreshes an untouched dates panel after the strategy revision advances", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
    const props = {
      projectId: "helios",
      basketId,
      canManage: true,
      client: transport,
      scenarioId: basketId,
      minimumReviewRevision: 3,
    };
    const view = render(<BasketTimingPanel {...props} />);
    await screen.findByText("Saved dates loaded.");
    transport.load.mockResolvedValue({ revision: 4, timing, ownerId });
    view.rerender(<BasketTimingPanel {...props} minimumReviewRevision={4} />);
    await screen.findByText(
      "Saved dates refreshed after the strategy changed.",
    );
    expect(transport.load).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Review saved plan" }),
    ).toBeEnabled();
  });
  it("blocks review for unsaved strategy or dates read before a newer strategy save", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
    const props = {
      projectId: "helios",
      basketId,
      canManage: true,
      client: transport,
      scenarioId: basketId,
    };
    const view = render(<BasketTimingPanel {...props} />);
    await screen.findByText("Saved dates loaded.");
    expect(
      screen.getByRole("button", { name: "Review saved plan" }),
    ).toBeEnabled();
    view.rerender(<BasketTimingPanel {...props} reviewBlocked />);
    expect(
      screen.getByRole("button", { name: "Review saved plan" }),
    ).toBeDisabled();
    expect(screen.getByText(/resolve your strategy changes/)).toBeVisible();
    view.rerender(<BasketTimingPanel {...props} minimumReviewRevision={4} />);
    expect(
      screen.getByRole("button", { name: "Review saved plan" }),
    ).toBeDisabled();
    expect(screen.getByText(/The strategy changed/)).toBeVisible();
  });
  it("requires confirmation to discard recovery and does not offer it again", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
    const mount = () =>
      render(
        <BasketTimingPanel
          projectId="helios"
          basketId={basketId}
          canManage
          client={transport}
        />,
      );
    const first = mount();
    await screen.findByText("Saved dates loaded.");
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    first.unmount();
    const next = mount();
    const discard = await screen.findByRole("button", {
      name: "Discard unsaved dates",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(discard);
    expect(discard).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(discard);
    expect(
      screen.queryByRole("button", { name: "Restore unsaved dates" }),
    ).not.toBeInTheDocument();
    next.unmount();
    mount();
    await screen.findByText("Saved dates loaded.");
    expect(
      screen.queryByRole("button", { name: "Restore unsaved dates" }),
    ).not.toBeInTheDocument();
    expect(transport.save).not.toHaveBeenCalled();
  });
  it("clears a mounted account and ignores its late load after identity reset", async () => {
    const transport = client();
    let reset!: () => void;
    let resolve!: (value: unknown) => void;
    transport.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const owned = {
      ...transport,
      onIdentityChange: (callback: () => void) => {
        reset = callback;
        return () => {};
      },
    };
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={owned}
      />,
    );
    await waitFor(() => expect(transport.load).toHaveBeenCalledTimes(1));
    await act(async () => {
      reset();
      resolve({
        revision: 3,
        ownerId,
        timing: {
          ...timing,
          measurement: {
            ...timing.measurement,
            endedAt: "2026-10-25T17:00:00Z",
          },
        },
      });
    });
    await screen.findByText("Saved dates loaded.");
    expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveValue(
      "2026-10-12T17:00",
    );
  });
  it("fresh reader permission prevents recovery and write despite an older manager prop", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
    const view = render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    expect(transport.load).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    view.unmount();
    transport.load.mockResolvedValue({
      revision: 3,
      timing,
      ownerId,
      canManage: false,
    });
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    expect(
      screen.queryByRole("button", { name: "Restore unsaved dates" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
  });
  it.each([false, true])(
    "offers unsaved dates after remount; newer saved dates=%s",
    async (newer) => {
      const transport = client();
      transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
      const mount = () =>
        render(
          <BasketTimingPanel
            projectId="helios"
            basketId={basketId}
            canManage
            client={transport}
          />,
        );
      const first = mount();
      await screen.findByText("Saved dates loaded.");
      fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
        target: { value: "2026-10-13T17:00" },
      });
      first.unmount();
      if (newer)
        transport.load.mockResolvedValue({ revision: 4, timing, ownerId });
      const restored = mount();
      await screen.findByRole("button", { name: "Restore unsaved dates" });
      expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
      captureTimingEvidence(
        newer ? "recovery-newer" : "recovery",
        restored.container,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Restore unsaved dates" }),
      );
      expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveValue(
        "2026-10-13T17:00",
      );
      expect(transport.save).not.toHaveBeenCalled();
      if (newer) {
        expect(
          screen.getByRole("button", { name: "Save dates" }),
        ).toBeDisabled();
        expect(
          screen.getByRole("region", { name: "Saved dates to review" }),
        ).toBeInTheDocument();
        captureTimingEvidence("recovery-conflict", restored.container);
      } else
        expect(
          screen.getByRole("button", { name: "Save dates" }),
        ).toBeEnabled();
    },
  );
  it("does not offer another account's edits or edits after denied reads", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing, ownerId });
    const view = render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    view.unmount();
    transport.load.mockResolvedValue({
      revision: 3,
      timing,
      ownerId: "91000000-0000-4000-8000-000000000098",
    });
    const next = render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    expect(
      screen.queryByRole("button", { name: "Restore unsaved dates" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveValue(
      "2026-10-12T17:00",
    );
    next.unmount();
    transport.load.mockRejectedValue(new Error("denied"));
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText(/We could not load your campaign dates/);
    expect(
      screen.queryByRole("button", { name: "Restore unsaved dates" }),
    ).not.toBeInTheDocument();
  });
  it("captures loading, empty, error and permission states", async () => {
    for (const state of ["loading", "empty", "error", "permission"] as const) {
      const transport = client();
      if (state === "loading")
        transport.load.mockReturnValue(new Promise(() => {}));
      if (state === "empty")
        transport.load.mockResolvedValue({ revision: 3, timing: null });
      if (state === "error")
        transport.load.mockRejectedValue(new Error("unavailable"));
      const view = render(
        <BasketTimingPanel
          projectId="helios"
          basketId={basketId}
          canManage={state !== "permission"}
          client={transport}
        />,
      );
      if (state !== "loading")
        await waitFor(() =>
          expect(
            screen.queryByText("Loading saved dates…"),
          ).not.toBeInTheDocument(),
        );
      captureTimingEvidence(state, view.container);
      view.unmount();
    }
  });
  it("loads and saves with readback in React Strict Mode", async () => {
    const transport = client();
    render(
      <StrictMode>
        <BasketTimingPanel
          projectId="helios"
          basketId={basketId}
          canManage
          client={transport}
        />
      </StrictMode>,
    );
    await screen.findByText("Saved dates loaded.");
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    transport.load.mockResolvedValue({
      revision: 4,
      timing: {
        ...timing,
        measurement: { ...timing.measurement, endedAt: "2026-10-13T17:00:00Z" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Dates saved.");
    expect(
      screen.getByText(/approval and campaign launch are not available/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-14T17:00" },
    });
    expect(screen.queryByText("Dates saved.")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You have unsaved date changes. Save dates before leaving this basket.",
    );
    expect(transport.save).toHaveBeenCalledTimes(1);
  });
  it("retains edits after conflict and requires explicit saved-version replacement", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const transport = client();
    transport.save.mockRejectedValue(new Error("conflict"));
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText(/We could not confirm the saved dates/);
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load saved dates" }));
    await screen.findByRole("button", {
      name: "Replace local edits with these saved dates",
    });
    expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveValue(
      "2026-10-13T17:00",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace local edits with these saved dates",
      }),
    );
    expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveValue(
      "2026-10-12T17:00",
    );
  });
  it("focuses the first invalid date without writing", async () => {
    const transport = client();
    transport.load.mockResolvedValue({ revision: 3, timing: null });
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Activity starts (UTC)")).toHaveFocus(),
    );
    expect(transport.save).not.toHaveBeenCalled();
  });
  it("does not expose write controls to a reader", async () => {
    const transport = client();
    render(
      <BasketTimingPanel
        projectId="helios"
        basketId={basketId}
        canManage={false}
        client={transport}
      />,
    );
    await screen.findByText("Saved dates loaded.");
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
    expect(screen.getByLabelText("Activity starts (UTC)")).toBeDisabled();
  });
  it("can cancel leaving through an application link when dates are unsaved", async () => {
    const transport = client();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <>
        <Link href="/projects/helios/campaigns">Campaigns</Link>
        <BasketTimingPanel
          projectId="helios"
          basketId={basketId}
          canManage
          client={transport}
        />
      </>,
    );
    await screen.findByText("Saved dates loaded.");
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    expect(
      fireEvent.click(screen.getByRole("link", { name: "Campaigns" })),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
