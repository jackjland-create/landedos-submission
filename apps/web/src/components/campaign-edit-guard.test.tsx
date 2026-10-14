import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  CampaignEditGuard,
  campaignEditSavedEvent,
} from "./campaign-edit-guard";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])(
  "preserves unsaved-edit protection after a %s click",
  (modifier) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <CampaignEditGuard>
        <form>
          <label>
            Brief
            <input name="brief" />
          </label>
        </form>
        <a href="?view=tracking">Tracking</a>
      </CampaignEditGuard>,
    );
    fireEvent.change(screen.getByLabelText("Brief"), {
      target: { value: "Unsaved direction" },
    });
    const link = screen.getByRole("link", { name: "Tracking" });
    link.addEventListener("click", (event) => event.preventDefault());
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    confirm.mockReturnValue(false);
    const ordinaryClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(ordinaryClick);
    expect(confirm).toHaveBeenCalledOnce();
    expect(ordinaryClick.defaultPrevented).toBe(true);
  },
);

it("clears the navigation warning only after a confirmed brief save", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <CampaignEditGuard>
      <form>
        <label>
          Brief
          <input name="brief" />
        </label>
      </form>
      <a href="?view=tracking">Tracking</a>
    </CampaignEditGuard>,
  );
  const brief = screen.getByLabelText("Brief");
  const tracking = screen.getByRole("link", { name: "Tracking" });
  tracking.addEventListener("click", (event) => event.preventDefault());
  fireEvent.change(brief, { target: { value: "Saved direction" } });
  document.dispatchEvent(new Event(campaignEditSavedEvent));
  const savedClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  tracking.dispatchEvent(savedClick);
  expect(confirm).not.toHaveBeenCalled();

  fireEvent.change(brief, { target: { value: "Another unsaved change" } });
  const dirtyClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  tracking.dispatchEvent(dirtyClick);
  expect(dirtyClick.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledOnce();
});
it("allows ordinary links but warns before leaving edited campaign forms", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <CampaignEditGuard>
      <form>
        <label>
          Brief
          <input name="brief" />
        </label>
      </form>
      <a href="?view=roster">Roster</a>
    </CampaignEditGuard>,
  );
  fireEvent.change(screen.getByLabelText("Brief"), {
    target: { value: "Unsaved direction" },
  });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByRole("link", { name: "Roster" }).dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledWith(
    "Leave this view? Unsaved campaign edits will be lost.",
  );
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
