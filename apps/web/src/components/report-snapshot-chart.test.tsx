import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReportSnapshotChart } from "./report-snapshot-chart";

afterEach(cleanup);

describe("report snapshot chart", () => {
  it("shows only the chosen series while retaining exact observations", () => {
    render(
      <ReportSnapshotChart
        visibleSeries="activated"
        compact
        revealSignature="activated"
        points={[
          {
            date: "2026-08-11T00:00:00Z",
            qualifiedWallets: 3,
            activatedWallets: 1,
          },
          {
            date: "2026-08-12T00:00:00Z",
            qualifiedWallets: 5,
            activatedWallets: 2,
          },
        ]}
      />,
    );
    const legend = screen.getByLabelText("Chart legend");
    expect(
      within(legend).queryByText("Qualified wallets"),
    ).not.toBeInTheDocument();
    expect(within(legend).getByText("Activated wallets")).toBeInTheDocument();
    expect(
      screen.getByText("Exact observations & period coverage"),
    ).toBeInTheDocument();
  });
  it("keeps exact observations behind a native disclosure only in compact mode", () => {
    const points = [
      {
        activatedWallets: 2,
        date: "2026-08-17T12:00:00.000Z",
        qualifiedWallets: 4,
        version: 1,
      },
      {
        activatedWallets: null,
        date: "2026-08-18T12:00:00.000Z",
        qualifiedWallets: 8,
        version: 2,
      },
    ];
    const { container, rerender } = render(
      <ReportSnapshotChart compact points={points} revealSignature="compact" />,
    );
    const disclosure = container.querySelector("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Exact observations & period coverage"));
    expect(disclosure).toHaveAttribute("open");
    expect(
      screen.getByLabelText(
        "Version 2, 18 Aug 2026. Qualified wallets: 8. Activated wallets: not available.",
      ),
    ).toHaveAttribute("tabindex", "0");
    rerender(<ReportSnapshotChart points={points} revealSignature="default" />);
    expect(disclosure).toHaveAttribute("open");
    expect(disclosure.querySelector("summary")).toHaveAttribute("hidden");
  });

  it("refuses to infer a trend from one immutable observation", () => {
    render(
      <ReportSnapshotChart
        points={[
          {
            activatedWallets: 2,
            date: "2026-08-18T12:00:00.000Z",
            qualifiedWallets: 4,
            version: 1,
          },
        ]}
        revealSignature="version-1"
      />,
    );

    const status = screen.getByRole("status");
    expect(
      within(status).getByText(
        "A second issued version is required to show movement.",
      ),
    ).toBeInTheDocument();
    expect(within(status).getByText(/not been inferred/)).toBeInTheDocument();
  });

  it("describes same-unit series and preserves missing observations", () => {
    render(
      <ReportSnapshotChart
        points={[
          {
            activatedWallets: null,
            date: "2026-08-18T12:00:00.000Z",
            qualifiedWallets: 8,
            version: 2,
          },
          {
            activatedWallets: 2,
            date: "2026-08-17T12:00:00.000Z",
            qualifiedWallets: 4,
            version: 1,
          },
        ]}
        revealSignature="version-2"
      />,
    );

    const figure = screen.getByRole("figure", { name: "WALLET OUTCOMES" });
    expect(
      within(figure).getByText("Issued evidence over time"),
    ).toBeInTheDocument();
    expect(within(figure).getByText("Qualified wallets")).toBeInTheDocument();
    expect(within(figure).getByText("Activated wallets")).toBeInTheDocument();
    expect(
      within(figure).getByText(
        /2 immutable report versions.*Qualified-wallet data is available in 2.*activated-wallet data is available in 1.*Missing observations remain blank\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(figure).getByLabelText(
        "Version 1, 17 Aug 2026. Qualified wallets: 4. Activated wallets: 2.",
      ),
    ).toHaveAttribute("tabindex", "0");
    expect(
      within(figure).getByLabelText(
        "Version 2, 18 Aug 2026. Qualified wallets: 8. Activated wallets: not available.",
      ),
    ).toHaveAttribute("tabindex", "0");
  });

  it("labels partial daily evidence and names retained benchmark sources", () => {
    render(
      <ReportSnapshotChart
        benchmarks={[
          {
            kind: "approved_target",
            label: "APPROVED TARGET",
            metric: "qualified_wallets",
            sourceLabel: "Brand approval / 18 Aug",
            value: 12,
            valueDecimal: "12",
          },
        ]}
        points={[
          {
            activatedWallets: 1,
            date: "2026-08-17T23:59:59.000Z",
            label: "D01",
            activatedPeriodState: "complete",
            qualifiedPeriodState: "complete",
            qualifiedWallets: 4,
          },
          {
            activatedWallets: 2,
            date: "2026-08-18T12:00:00.000Z",
            label: "D02",
            activatedPeriodState: "partial",
            qualifiedPeriodState: "partial",
            qualifiedWallets: 7,
          },
        ]}
        revealSignature="context-1"
      />,
    );

    expect(
      screen.getByLabelText(
        "D02, 18 Aug 2026. Qualified wallets: 7, partial period. Activated wallets: 2, partial period.",
      ),
    ).toHaveAttribute("tabindex", "0");
    const references = screen.getByRole("list", {
      name: "Retained chart references",
    });
    expect(within(references).getByText("APPROVED TARGET")).toBeInTheDocument();
    expect(
      within(references).getByText(/Brand approval \/ 18 Aug/),
    ).toBeInTheDocument();
  });

  it("keeps exact retained counts visible when they exceed the chart scale", () => {
    const exact = "900719925474099312345678901";
    render(
      <ReportSnapshotChart
        benchmarks={[
          {
            kind: "approved_target",
            label: "APPROVED TARGET",
            metric: "qualified_wallets",
            sourceLabel: "Commercial plan approval",
            value: null,
            valueDecimal: "900,719,925,474,099,312,345,678,901",
          },
        ]}
        points={[
          {
            activatedPeriodState: "complete",
            activatedWallets: 1,
            activatedWalletsExact: "1",
            date: "2026-08-17T23:59:59.000Z",
            label: "D01",
            qualifiedPeriodState: "complete",
            qualifiedWallets: null,
            qualifiedWalletsExact: exact,
          },
          {
            activatedPeriodState: "complete",
            activatedWallets: 2,
            activatedWalletsExact: "2",
            date: "2026-08-18T23:59:59.000Z",
            label: "D02",
            qualifiedPeriodState: "complete",
            qualifiedWallets: null,
            qualifiedWalletsExact: exact,
          },
        ]}
        revealSignature="large-exact-values"
      />,
    );

    expect(
      screen.getAllByLabelText(
        /Qualified wallets: 900,719,925,474,099,312,345,678,901/,
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(/exact value retained; outside chart scale/i),
    ).toBeInTheDocument();
  });

  it("keeps partial state specific to each retained metric", () => {
    render(
      <ReportSnapshotChart
        points={[
          {
            activatedPeriodState: "complete",
            activatedWallets: 1,
            activatedWalletsExact: "1",
            date: "2026-08-17T23:59:59.000Z",
            label: "D01",
            qualifiedPeriodState: "complete",
            qualifiedWallets: 2,
            qualifiedWalletsExact: "2",
          },
          {
            activatedPeriodState: "complete",
            activatedWallets: 2,
            activatedWalletsExact: "2",
            date: "2026-08-18T12:00:00.000Z",
            label: "D02",
            qualifiedPeriodState: "partial",
            qualifiedWallets: 3,
            qualifiedWalletsExact: "3",
          },
          {
            activatedPeriodState: "complete",
            activatedWallets: 3,
            activatedWalletsExact: "3",
            date: "2026-08-19T23:59:59.000Z",
            label: "D03",
            qualifiedPeriodState: "complete",
            qualifiedWallets: 4,
            qualifiedWalletsExact: "4",
          },
        ]}
        revealSignature="independent-partial-state"
      />,
    );

    expect(
      screen.getByLabelText(
        /D02.*Qualified wallets: 3, partial period.*Activated wallets: 2, complete period/,
      ),
    ).toHaveTextContent("Q 3 PARTIAL · A 2");
    expect(
      screen.getByLabelText(
        /D03.*Qualified wallets: 4, complete period.*Activated wallets: 3, complete period/,
      ),
    ).toBeInTheDocument();
  });
});
