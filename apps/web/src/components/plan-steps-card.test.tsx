import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PlanStepsCard, type PlanStep } from "./plan-steps-card";

afterEach(cleanup);

function steps(onAction = vi.fn()): PlanStep[] {
  return [
    {
      id: "purpose",
      title: "Goal and audience",
      status: "done",
      summary: "Reach investors · Solana funds",
      actionLabel: "Edit",
      onAction,
    },
    {
      id: "measurement",
      title: "What counts as a result",
      status: "unsaved",
      summary: "Save the strategy to keep your rule choice",
      detail: "Rule: First qualifying transaction · version 1 · shared",
      actionLabel: "Choose rule",
      onAction,
    },
    {
      id: "target",
      title: "Target",
      status: "todo",
      summary: "Set a baseline and the number you’re aiming for",
      actionLabel: "Set target",
      onAction,
    },
    {
      id: "dates",
      title: "Dates",
      status: "checking",
      summary: "Loading saved dates",
      actionLabel: "Add dates",
      actionDisabled: true,
      onAction,
    },
  ];
}

it("counts only done steps and names the card by the real number of steps", () => {
  render(<PlanStepsCard steps={steps()} intro="Do them in any order." />);
  const card = screen.getByRole("region", { name: "4 steps to approval" });
  expect(within(card).getByText("1 of 4 done")).toBeInTheDocument();
  expect(within(card).getAllByRole("listitem")).toHaveLength(4);
  expect(
    within(card).getByRole("heading", {
      name: /^Step 2:\s*What counts as a result$/,
    }),
  ).toBeInTheDocument();
});

it("shows status in words, not colour alone, with the saved summary", () => {
  render(<PlanStepsCard steps={steps()} intro="Do them in any order." />);
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Done · Reach investors · Solana funds");
  expect(items[1]).toHaveTextContent(
    "Unsaved · Save the strategy to keep your rule choice",
  );
  expect(items[1]).toHaveTextContent(
    "Rule: First qualifying transaction · version 1 · shared",
  );
  expect(items[2]).toHaveTextContent("To do · Set a baseline");
  expect(items[3]).toHaveTextContent("Checking · Loading saved dates");
});

it("gives every step a real, specifically named button", () => {
  const onAction = vi.fn();
  render(
    <PlanStepsCard steps={steps(onAction)} intro="Do them in any order." />,
  );
  expect(
    screen.getByRole("button", { name: "Edit: Goal and audience" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", {
      name: "Choose rule: What counts as a result",
    }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(onAction).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Add dates" })).toBeDisabled();
});

it("shows a locked approved card without a progress count", () => {
  render(
    <PlanStepsCard
      steps={steps()}
      title="Plan details"
      intro="These are the approved details."
      locked
      currentId="purpose"
    />,
  );
  const card = screen.getByRole("region", { name: "Plan details" });
  expect(within(card).getByText("Locked")).toBeInTheDocument();
  expect(within(card).queryByText(/of 4 done/)).toBeNull();
  expect(within(card).getByText("Viewing now")).toBeInTheDocument();
  expect(within(card).queryByText(/Editing now/)).toBeNull();
});

it("marks the step whose drawer is open without hiding unsaved work", () => {
  render(
    <PlanStepsCard
      steps={steps()}
      intro="Do them in any order."
      currentId="measurement"
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items[1]).toHaveAttribute("aria-current", "step");
  expect(items[1]).toHaveTextContent("Editing now · unsaved");
  expect(items[0]).not.toHaveAttribute("aria-current");
});
