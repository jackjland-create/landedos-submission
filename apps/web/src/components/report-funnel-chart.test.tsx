import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReportFunnelChart } from "./report-funnel-chart";

describe("report funnel chart", () => {
  afterEach(cleanup);

  it("renders only the three retained observed stages as a shared-hover funnel", () => {
    render(
      <ReportFunnelChart
        activatedWallets={2}
        qualifiedClicks={10}
        qualifiedWallets={4}
      />,
    );

    expect(screen.getByTestId("report-funnel-visual")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Qualified clicks.*10.*ENTRY STAGE/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Qualified wallets.*4.*40.0% OF PRIOR STAGE/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Activated wallets.*2.*50.0% OF PRIOR STAGE/i,
      }),
    ).toBeInTheDocument();

    const retained = screen
      .getByText("Retained wallets")
      .closest(".report-funnel-chart__retention");
    expect(retained).not.toBeNull();
    expect(
      within(retained as HTMLElement).getByText("NOT AVAILABLE"),
    ).toBeInTheDocument();

    const walletControl = screen.getByRole("button", {
      name: /Qualified wallets.*4/i,
    });
    fireEvent.focus(walletControl);
    expect(walletControl).toHaveAttribute("data-hovered");
    expect(
      document.querySelector('[data-funnel-stage="Qualified clicks"]'),
    ).toHaveAttribute("data-faded");
    expect(
      document.querySelector('[data-funnel-stage="Qualified wallets"]'),
    ).not.toHaveAttribute("data-faded");
  });

  it("keeps missing evidence unknown instead of drawing a numeric funnel", () => {
    render(
      <ReportFunnelChart
        activatedWallets={null}
        qualifiedClicks={10}
        qualifiedWallets={4}
      />,
    );

    expect(
      screen.queryByTestId("report-funnel-visual"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("PARTIAL EVIDENCE")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Activated wallets.*NOT AVAILABLE.*SOURCE NOT AVAILABLE/i,
      }),
    ).toBeInTheDocument();
  });

  it("does not relabel a later retained stage as the entry when clicks are missing", () => {
    render(
      <ReportFunnelChart
        activatedWallets={2}
        qualifiedClicks={null}
        qualifiedWallets={4}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Qualified wallets.*4.*PRIOR STAGE NOT AVAILABLE/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Activated wallets.*2.*50.0% OF PRIOR STAGE/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Qualified wallets.*ENTRY STAGE/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps an activated count explicit when its wallet denominator is missing", () => {
    render(
      <ReportFunnelChart
        activatedWallets={2}
        qualifiedClicks={10}
        qualifiedWallets={null}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Activated wallets.*2.*PRIOR STAGE NOT AVAILABLE/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("20.0% OF PRIOR STAGE")).not.toBeInTheDocument();
  });

  it("distinguishes an observed zero from an unavailable value", () => {
    render(
      <ReportFunnelChart
        activatedWallets={0}
        qualifiedClicks={0}
        qualifiedWallets={0}
      />,
    );

    expect(
      screen.queryByTestId("report-funnel-visual"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ZERO OBSERVED ENTRY")).toBeInTheDocument();
    expect(screen.getAllByRole("button")[0]).toHaveAccessibleName(
      /Qualified clicks.*0.*ENTRY STAGE/i,
    );
    expect(screen.queryByText("PARTIAL EVIDENCE")).not.toBeInTheDocument();
  });

  it("refuses to visualise an impossible widening funnel", () => {
    render(
      <ReportFunnelChart
        activatedWallets={3}
        qualifiedClicks={5}
        qualifiedWallets={6}
      />,
    );

    expect(
      screen.queryByTestId("report-funnel-visual"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("RETAINED STAGES REQUIRE REVIEW"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no misleading funnel shape has been drawn/i),
    ).toBeInTheDocument();
  });
});
