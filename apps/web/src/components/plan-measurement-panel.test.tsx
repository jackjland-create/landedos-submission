import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { BasketMeasurementChoice } from "@/lib/baskets/measurement-choices";
import { PlanMeasurementPanel } from "./plan-measurement-panel";

afterEach(cleanup);

// Synthetic test fixture, not a real project rule.
const supported: BasketMeasurementChoice = {
  id: "92000000-0000-4000-8000-000000000001",
  name: "Fixture rule A",
  description: "Fixture description for a supported rule.",
  version: 2,
  effectiveFrom: "2026-09-01T00:00:00Z",
  effectiveUntil: null,
  supported: true,
};
const unsupported: BasketMeasurementChoice = {
  ...supported,
  id: "92000000-0000-4000-8000-000000000002",
  name: "Fixture rule B",
  description: "Fixture description for an unsupported rule.",
  version: 1,
  supported: false,
};

function renderPanel(
  overrides: Partial<Parameters<typeof PlanMeasurementPanel>[0]> = {},
) {
  const onChoose = vi.fn();
  render(
    <PlanMeasurementPanel
      kind="ready"
      choices={[supported, unsupported]}
      selectedId={null}
      savedId={null}
      disabled={false}
      canManage
      onChoose={onChoose}
      settingsHref="/projects/p/settings/conversions"
      {...overrides}
    />,
  );
  return onChoose;
}

it("offers only supported rules and reports a choice without saving", () => {
  const onChoose = renderPanel();
  expect(
    screen.getByRole("radiogroup", { name: "Rules in this project" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Fixture rule B/ })).toBeDisabled();
  expect(screen.getByText("Not supported yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /Fixture rule A/ }));
  expect(onChoose).toHaveBeenCalledWith(supported);
  expect(screen.getByText(/No rule chosen yet/)).toBeInTheDocument();
});

it("describes the selected rule from its own wording and only its supported facts", () => {
  renderPanel({ selectedId: supported.id, savedId: supported.id });
  fireEvent.click(screen.getByText("Rule details and limits"));
  expect(
    screen.getByRole("heading", { name: "Fixture rule A · version 2" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText("Fixture description for a supported rule.").length,
  ).toBeGreaterThan(0);
  const facts = screen.getByRole("list", { name: "How this rule measures" });
  expect(facts).toHaveTextContent("Signing alone isn’t a result.");
  expect(facts).toHaveTextContent(
    "A result is credited to the last eligible creator touch in the 7 days before it.",
  );
  expect(facts).toHaveTextContent("Revenue isn’t counted by this rule.");
  expect(facts).not.toHaveTextContent(/sign in within|deadline/i);
  expect(screen.getByText("Saved on this plan")).toBeInTheDocument();
});

it("warns instead of listing facts for an unsupported selection", () => {
  renderPanel({ selectedId: unsupported.id });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This rule isn’t supported for plans yet.",
  );
  expect(
    screen.queryByRole("list", { name: "How this rule measures" }),
  ).toBeNull();
});

it("shows structured qualifying requirements even when the editable description omits them", () => {
  renderPanel({
    selectedId: supported.id,
    choices: [
      {
        ...supported,
        qualifyingFacts: [
          "The transaction must be finalized before it counts.",
        ],
      },
    ],
  });
  expect(
    screen.getByRole("list", { name: "How this rule measures" }),
  ).toHaveTextContent("The transaction must be finalized before it counts.");
});

it.each([
  ["unavailable", "unavailable" as const, [] as BasketMeasurementChoice[]],
  ["empty", "ready" as const, [] as BasketMeasurementChoice[]],
])(
  "keeps a saved choice that is missing when rules are %s",
  (_label, kind, choices) => {
    renderPanel({ kind, choices, selectedId: "missing-id", disabled: true });
    const saved = screen.getByRole("radio", { checked: true });
    expect(saved).toBeDisabled();
    expect(saved).toHaveAttribute("value", "missing-id");
    expect(
      screen.getAllByText(/saved on this plan isn’t available right now/)
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Clear rule choice" }),
    ).toBeNull();
  },
);

it("keeps secondary rule management behind one disclosure without changing the choice", () => {
  const onChoose = renderPanel({ selectedId: supported.id });
  fireEvent.click(screen.getByText("Need a different rule?"));
  const create = screen.getByRole("link", {
    name: "Create a new success rule version",
  });
  expect(create).toBeVisible();
  expect(create.closest("details")).toHaveAttribute("open");
  expect(create).toHaveAttribute(
    "href",
    "/projects/p/settings/conversions#create-rule",
  );
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear rule choice" }));
  expect(onChoose).toHaveBeenCalledWith(null);
});

it("keeps the plan and theme in the creation link", () => {
  renderPanel({
    settingsHref: "/projects/p/settings/conversions?plan=b&theme=dark",
  });
  fireEvent.click(screen.getByText("Need a different rule?"));
  expect(
    screen.getByRole("link", { name: "Create a new success rule version" }),
  ).toHaveAttribute(
    "href",
    "/projects/p/settings/conversions?plan=b&theme=dark#create-rule",
  );
});

it("offers creation when the project has no rules", () => {
  renderPanel({ choices: [], disabled: true });
  expect(
    screen.getByText(/Create the first version, then return here/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Create a new success rule version" }),
  ).toBeVisible();
});

it("lets read-only users inspect history without offering creation", () => {
  renderPanel({ canManage: false, disabled: true });
  fireEvent.click(screen.getByText("Need a different rule?"));
  expect(
    screen.queryByRole("link", { name: "Create a new success rule version" }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: "View shared rules and history" }),
  ).toBeVisible();
  expect(screen.getByRole("radio", { name: /Fixture rule A/ })).toBeDisabled();
});
