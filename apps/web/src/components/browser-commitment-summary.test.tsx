import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { timedStrategyCommercialPlanSnapshotSchema } from "@landed/contracts";
import fixture from "../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";
import { BrowserCommitmentSummary } from "./browser-commercial-review";
import { ApprovalDates } from "./browser-approval-terms";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(cleanup);
function snapshot() {
  return timedStrategyCommercialPlanSnapshotSchema.parse(
    structuredClone(fixture.review_snapshot),
  );
}
it("shows retained package labels and deliverables without collapsing terms", () => {
  const value = snapshot();
  render(<BrowserCommitmentSummary snapshot={value} />);
  for (const entry of value.packages) {
    expect(screen.getAllByText(entry.packageLabel).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(entry.deliverableSummary).length,
    ).toBeGreaterThan(0);
  }
  expect(
    screen.getByText("Contracted terms being approved, not a payment."),
  ).toBeVisible();
});
it("keeps variable and token commitments separate and exposes their retained valuation", () => {
  const value = snapshot();
  value.packages = [value.packages[0]];
  value.packages[0].compensationLines.push(
    {
      id: "90000000-0000-4000-8000-000000000004",
      model: "variable",
      variableUnit: "qualified wallet",
      assetType: "cash",
      amountMinor: "2500",
      currencyCode: "GBP",
    },
    {
      id: "90000000-0000-4000-8000-000000000005",
      model: "fixed",
      assetType: "token",
      tokenAmountRaw: "5000000",
      tokenDecimals: 6,
      tokenMint: "So11111111111111111111111111111111111111112",
      unitPriceUsd: "1.25",
      priceSource: "Retained test quote",
      valuedAt: "2026-09-14T00:00:00Z",
    },
  );
  const { container } = render(<BrowserCommitmentSummary snapshot={value} />);
  expect(screen.getAllByText("GBP 1,275.00")).toHaveLength(2);
  expect(screen.getByText("GBP 25.00")).toBeVisible();
  expect(screen.getByText("Variable · per qualified wallet")).toBeVisible();
  expect(screen.getByText("TOKEN 5")).toBeVisible();
  expect(screen.getByText(/Not an all-in total/)).toBeVisible();
  expect(container.textContent).toContain("Retained test quote");
  expect(container.textContent).toContain(
    "So11111111111111111111111111111111111111112",
  );
});
it("does not turn the shortlist or narrative allocations into package identities or terms", () => {
  const value = snapshot();
  const { container } = render(<BrowserCommitmentSummary snapshot={value} />);
  expect(screen.getAllByRole("rowheader")).toHaveLength(value.packages.length);
  expect(container.textContent).not.toContain(
    value.strategyBinding.selectedCreatorIds[2],
  );
  expect(screen.getAllByText("Channel: Not specified")).toHaveLength(2);
  expect(screen.getAllByText("Not specified is not permission.")).toHaveLength(
    2,
  );
});
it("retains exact sub-millisecond timing separately from readable date summaries", () => {
  const value = snapshot();
  value.strategyBinding.timing.flight.startedAt = "2026-09-14T00:00:00.123456Z";
  const { container } = render(<ApprovalDates snapshot={value} />);
  expect(container.textContent).toContain("2026-09-14T00:00:00.123456Z");
  expect(screen.getByText("Exact times (UTC)")).toBeVisible();
});
it("sums fixed cash with integer precision and keeps currencies separate", () => {
  const value = snapshot();
  const base = value.packages[0].compensationLines[0];
  value.packages[0].compensationLines = [
    {
      ...base,
      id: "90000000-0000-4000-8000-000000000001",
      assetType: "cash",
      model: "fixed",
      amountMinor: "9007199254740993",
      currencyCode: "GBP",
    },
    {
      ...base,
      id: "90000000-0000-4000-8000-000000000002",
      assetType: "cash",
      model: "fixed",
      amountMinor: "7",
      currencyCode: "GBP",
    },
    {
      ...base,
      id: "90000000-0000-4000-8000-000000000003",
      assetType: "cash",
      model: "fixed",
      amountMinor: "123",
      currencyCode: "USD",
    },
  ];
  value.packages = [value.packages[0]];
  render(<BrowserCommitmentSummary snapshot={value} />);
  expect(screen.getByText("GBP 90,071,992,547,410.00")).toBeVisible();
  expect(screen.getAllByText("USD 1.23")).toHaveLength(2);
});
