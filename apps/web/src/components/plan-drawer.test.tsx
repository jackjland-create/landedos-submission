import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PlanDrawer } from "./plan-drawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("explains that a read-only drawer leaves saved values unchanged", () => {
  render(
    <PlanDrawer
      open
      readOnly
      eyebrow="Plan details"
      title="Creator terms"
      onClose={() => {}}
    >
      <p>Saved terms</p>
    </PlanDrawer>,
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Read only. Closing leaves the saved plan unchanged.",
  );
  expect(screen.queryByText(/Unsaved changes/)).toBeNull();
});

it("wraps initial reverse tab from its heading rather than escaping to the shell", () => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  );
  render(<button type="button">Shell navigation</button>);
  renderDrawer(true);
  const heading = screen.getByRole("heading", { name: "Target" });
  fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Back to plan" })).toHaveFocus();
});

function renderDrawer(open: boolean, onClose = vi.fn()) {
  const view = render(
    <PlanDrawer
      open={open}
      eyebrow="Step 3 of 5 · Test plan"
      title="Target"
      description="A goal, not a predicted result."
      onClose={onClose}
    >
      <input aria-label="Kept draft" defaultValue="" />
    </PlanDrawer>,
  );
  return { view, onClose };
}

it("keeps drafts, focus trapping and dismissal when presented as a centred dialog", () => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  );
  const onClose = vi.fn();
  const { rerender } = render(
    <PlanDrawer
      open
      presentation="dialog"
      eyebrow="Terms"
      title="Creator terms"
      onClose={onClose}
    >
      <input aria-label="Package label" defaultValue="Saved package" />
    </PlanDrawer>,
  );
  const input = screen.getByLabelText("Package label");
  fireEvent.change(input, { target: { value: "Unsaved package" } });
  expect(screen.getByRole("dialog")).toHaveAttribute(
    "data-presentation",
    "dialog",
  );
  screen.getByRole("heading").focus();
  fireEvent.keyDown(screen.getByRole("heading"), {
    key: "Tab",
    shiftKey: true,
  });
  expect(screen.getByRole("button", { name: "Back to plan" })).toHaveFocus();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  rerender(
    <PlanDrawer
      open={false}
      presentation="drawer"
      eyebrow="Terms"
      title="Creator terms"
      onClose={onClose}
    >
      <input aria-label="Package label" defaultValue="Saved package" />
    </PlanDrawer>,
  );
  expect(input).toHaveValue("Unsaved package");
});

it("names the dialog by its step, describes it and focuses the heading", () => {
  renderDrawer(true);
  const dialog = screen.getByRole("dialog", { name: "Target" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleDescription("A goal, not a predicted result.");
  expect(screen.getByRole("heading", { name: "Target" })).toHaveFocus();
  expect(screen.getByText("Step 3 of 5 · Test plan")).toBeInTheDocument();
  expect(
    screen.getByText(/Closing doesn’t save\. Unsaved changes stay here/),
  ).toBeInTheDocument();
});

it("keeps its content mounted while closed so drafts survive", () => {
  const { view } = renderDrawer(true);
  const input = screen.getByLabelText("Kept draft");
  fireEvent.change(input, { target: { value: "draft" } });
  view.rerender(
    <PlanDrawer open={false} eyebrow="" title="Target" onClose={() => {}}>
      <input aria-label="Kept draft" defaultValue="" />
    </PlanDrawer>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Kept draft")).toBe(input);
  expect(input).toHaveValue("draft");
});

it("closes from the close button, Back to plan, the scrim and Escape", () => {
  const { view, onClose } = renderDrawer(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Close and return to the plan" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to plan" }));
  const scrim = view.container.querySelector('[aria-hidden="true"]');
  fireEvent.click(scrim!);
  fireEvent.keyDown(screen.getByLabelText("Kept draft"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(4);
});

it("leaves Escape to a nested native dialog", () => {
  const onClose = vi.fn();
  render(
    <PlanDrawer open eyebrow="" title="Review and approve" onClose={onClose}>
      <dialog open>
        <button type="button">Inside approval</button>
      </dialog>
    </PlanDrawer>,
  );
  fireEvent.keyDown(screen.getByText("Inside approval"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});
