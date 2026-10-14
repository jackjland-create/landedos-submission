import type {
  BasketPackageRecord,
  BasketScenarioRecord,
} from "@landed/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PlanCandidates, termsSummary } from "./plan-candidates";

afterEach(cleanup);

// Synthetic test fixtures only.
const created = "2026-08-05T00:00:00.000Z";
const priced: BasketPackageRecord = {
  id: "92000000-0000-4000-8000-000000000001",
  creatorId: "40000000-0000-4000-8000-000000000001",
  creatorName: "Fixture One",
  creatorHandle: "@fixture_one",
  audience: {
    channelType: "x",
    size: 142000,
    observedAt: "2026-07-01T12:00:00.000Z",
    sourceLabel: "Fixture evidence",
  },
  packageLabel: "Launch package",
  deliverableSummary: "One thread",
  sourceRateQuoteId: null,
  compensationLines: [
    {
      id: "93000000-0000-4000-8000-000000000001",
      assetType: "cash",
      model: "fixed",
      variableUnit: null,
      amountMinor: "460000",
      currencyCode: "GBP",
      createdAt: created,
      updatedAt: created,
    },
    {
      id: "93000000-0000-4000-8000-000000000002",
      assetType: "cash",
      model: "variable",
      variableUnit: "Qualified wallet",
      amountMinor: "2500",
      currencyCode: "GBP",
      createdAt: created,
      updatedAt: created,
    },
  ],
};
const unpriced: BasketPackageRecord = {
  ...priced,
  id: "92000000-0000-4000-8000-000000000002",
  creatorId: "40000000-0000-4000-8000-000000000002",
  creatorName: "Fixture Two",
  creatorHandle: null,
  audience: null,
  compensationLines: [],
};
const scenario: BasketScenarioRecord = {
  id: "91000000-0000-4000-8000-000000000001",
  code: "A",
  name: "Fixture scenario",
  packageIds: [priced.id, unpriced.id],
};

function renderCandidates(
  overrides: Partial<Parameters<typeof PlanCandidates>[0]> = {},
) {
  const onToggle = vi.fn();
  const onOpenTerms = vi.fn();
  render(
    <PlanCandidates
      packages={[priced, unpriced]}
      scenario={scenario}
      pendingKeys={new Set()}
      blockersByPackage={new Map()}
      canManage
      addHref="/projects/p/kols?basket=b"
      notice=""
      onToggle={onToggle}
      onOpenTerms={onOpenTerms}
      {...overrides}
    />,
  );
  return { onToggle, onOpenTerms };
}

it("summarises fixed, variable, token and unpaid terms honestly", () => {
  expect(termsSummary(priced)).toEqual({
    label: "£4,600 fixed",
    detail: "+ £25 per Qualified wallet",
    missing: false,
  });
  expect(termsSummary(unpriced)).toMatchObject({
    label: "Terms needed",
    missing: true,
  });
  expect(
    termsSummary({
      ...unpriced,
      commercialDetailRevision: 1,
      commercialDetail: {
        schemaVersion: 2,
        channelIds: [],
        deliveryDeadline: null,
        usageRights: null,
        exclusivity: null,
        commercialBasis: "unpaid_internal_test",
        unpaidReason: "Fixture",
      },
    }),
  ).toMatchObject({ label: "Unpaid test", missing: false });
  expect(
    termsSummary({
      ...unpriced,
      compensationLines: [
        {
          id: "93000000-0000-4000-8000-000000000003",
          assetType: "token",
          model: "fixed",
          variableUnit: null,
          tokenMint: "So11111111111111111111111111111111111111112",
          tokenAmountRaw: "125000000",
          tokenDecimals: 6,
          unitPriceUsd: "2.5",
          priceSource: "Fixture",
          valuedAt: created,
          createdAt: created,
          updatedAt: created,
        },
      ],
    }),
  ).toEqual({
    label: "125 tokens fixed",
    detail: "Token value recorded with its price source",
    missing: false,
  });
});

it("shows missing history as not available, never as new or zero", () => {
  renderCandidates();
  const table = screen.getByRole("table");
  expect(within(table).getAllByText("Not available yet")).toHaveLength(2);
  expect(screen.queryByText(/New on Landed|0 results/i)).toBeNull();
  expect(screen.getByText(/Audience not recorded/)).toBeInTheDocument();
});

it("toggles scenario inclusion and opens the right terms action", () => {
  const { onToggle, onOpenTerms } = renderCandidates();
  expect(
    screen.getByRole("heading", { name: "2 of 2 candidates in scenario A" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Include Fixture One in scenario A"));
  expect(onToggle).toHaveBeenCalledWith(priced.id, false);
  fireEvent.click(
    screen.getByRole("button", { name: "Add terms for Fixture Two" }),
  );
  expect(onOpenTerms).toHaveBeenCalledWith(unpriced.id);
  expect(
    screen.getByRole("button", { name: "Edit terms for Fixture One" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add candidates" })).toHaveAttribute(
    "href",
    "/projects/p/kols?basket=b",
  );
});

it("disables a row while its change is pending and shows blockers in place", () => {
  renderCandidates({
    pendingKeys: new Set([`${scenario.id}:${priced.id}`]),
    blockersByPackage: new Map([
      [priced.id, ["Every included package needs a deliverable summary."]],
    ]),
    notice: "Scenario changes require access.",
  });
  expect(
    screen.getByLabelText("Include Fixture One in scenario A"),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Fix terms for Fixture One" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Every included package needs a deliverable summary."),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Scenario changes require access.",
  );
});

it("lets viewers read terms without changing the scenario", () => {
  renderCandidates({ canManage: false });
  for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "View terms for Fixture Two" }),
  ).toBeEnabled();
});

it("explains an empty plan instead of showing an empty table", () => {
  renderCandidates({ packages: [], scenario: { ...scenario, packageIds: [] } });
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "No creators in this plan yet" }),
  ).toBeInTheDocument();
});
