import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutcomeSetup } from "./basket-builder";

const props = {
  basketId: "90000000-0000-4000-8000-000000000001",
  initialObjective: null,
  initialProfile: null,
  onSaved: vi.fn(),
  guided: true,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("reuses only the goal after an explicit click and preserves numerical inputs", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<OutcomeSetup {...props} savedGoal="Reach relevant investors" />);
  expect(screen.getByLabelText("Campaign objective")).toHaveValue("");
  const destination = document.getElementById("basket-outcome")!;
  destination.focus();
  expect(destination).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Baseline"), {
    target: { value: "15" },
  });
  fireEvent.change(screen.getByLabelText("Target"), {
    target: { value: "45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use saved goal" }));
  expect(screen.getByLabelText("Campaign objective")).toHaveValue(
    "Reach relevant investors",
  );
  expect(screen.getByLabelText("Baseline")).toHaveValue("15");
  expect(screen.getByLabelText("Target")).toHaveValue("45");
  expect(screen.getByLabelText("Primary KPI")).toHaveValue("qualified_wallets");
  expect(fetcher).not.toHaveBeenCalled();
});
it("never replaces existing objective text without confirmation", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <OutcomeSetup
      {...props}
      initialObjective="Keep my objective"
      savedGoal="New saved goal"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use saved goal" }));
  expect(screen.getByLabelText("Campaign objective")).toHaveValue(
    "Keep my objective",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Use saved goal" }));
  expect(screen.getByLabelText("Campaign objective")).toHaveValue(
    "New saved goal",
  );
});
it("does not truncate a long goal or silently copy a changing prop", () => {
  const view = render(<OutcomeSetup {...props} savedGoal={"a".repeat(241)} />);
  expect(
    screen.queryByRole("button", { name: "Use saved goal" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/longer than the 240-character/)).toBeInTheDocument();
  view.rerender(<OutcomeSetup {...props} savedGoal="Short saved goal" />);
  expect(screen.getByLabelText("Campaign objective")).toHaveValue("");
});
it("keeps legacy outcome setup unchanged and links unavailable goals back to purpose", () => {
  const view = render(<OutcomeSetup {...props} />);
  expect(
    screen.getByRole("link", { name: "Goal and audience" }),
  ).toHaveAttribute("href", "#basket-strategy");
  view.rerender(<OutcomeSetup {...props} guided={false} />);
  expect(screen.queryByText(/Your goal describes/)).not.toBeInTheDocument();
});
