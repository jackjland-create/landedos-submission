import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getPreparedBasket } from "@landed/contracts";
import { BasketPurposeField } from "./basket-purpose-field";

function Harness({
  initial = null,
  disabled = false,
}: {
  initial?: string | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <fieldset disabled={disabled}>
      <BasketPurposeField field="goal" value={value} onChange={setValue} />
    </fieldset>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("starts without an inferred goal and applies exact editorial wording", () => {
  render(<Harness />);
  const select = screen.getByLabelText("Goal starting point");
  expect(select).toHaveValue("");
  fireEvent.change(select, { target: { value: "investor_reach" } });
  expect(screen.getByLabelText("Goal")).toHaveValue(
    getPreparedBasket("investor_reach", 1)!.strategy.goal,
  );
});
it("retains custom text when replacement is cancelled", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Harness initial="Our exact existing goal" />);
  fireEvent.change(screen.getByLabelText("Goal starting point"), {
    target: { value: "investor_reach" },
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Goal")).toHaveValue("Our exact existing goal");
  expect(screen.getByLabelText("Goal starting point")).toHaveValue("custom");
});
it("opens custom refinement without replacing or clearing a prepared answer", () => {
  const goal = getPreparedBasket("investor_reach", 1)!.strategy.goal;
  render(<Harness initial={goal} />);
  fireEvent.change(screen.getByLabelText("Goal starting point"), {
    target: { value: "custom" },
  });
  const input = screen.getByLabelText("Goal");
  expect(input.closest("details")).toHaveAttribute("open");
  expect(input).toHaveFocus();
  expect(input).toHaveValue(goal);
  expect((input as HTMLTextAreaElement).selectionStart).toBe(0);
  expect((input as HTMLTextAreaElement).selectionEnd).toBe(goal!.length);
  fireEvent.change(input, { target: { value: "A more specific result" } });
  expect(screen.getByLabelText("Goal starting point")).toHaveValue("custom");
});
it("preserves read-only permission on suggestions and refinement", () => {
  render(<Harness initial="Private draft goal" disabled />);
  expect(screen.getByLabelText("Goal starting point")).toBeDisabled();
  expect(screen.getByLabelText("Goal")).toBeDisabled();
});
