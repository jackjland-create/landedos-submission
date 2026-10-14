import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReportModeDock } from "./report-mode-dock";

const panels = {
  funnel: <p>Funnel panel</p>,
  creators: <p>Creators panel</p>,
  economics: <p>Economics panel</p>,
  evidence: <p>Evidence panel</p>,
  decision: <p>Decision panel</p>,
};

describe("report mode dock", () => {
  beforeEach(() => window.history.replaceState(null, "", "/reports/demo"));
  afterEach(cleanup);

  it("shows one bounded report mode at a time", () => {
    render(<ReportModeDock {...panels} />);

    expect(screen.getByRole("tab", { name: "01 Funnel" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Funnel panel")).toBeVisible();
    expect(screen.getByText("Creators panel")).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "02 Creators" }));
    expect(screen.getByText("Creators panel")).toBeVisible();
    expect(screen.getByText("Funnel panel")).not.toBeVisible();
    expect(window.location.search).toBe("?mode=creators");
  });

  it("opens a deep-linked report mode", () => {
    render(<ReportModeDock {...panels} initialMode="creators" />);

    expect(screen.getByRole("tab", { name: "02 Creators" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Creators panel")).toBeVisible();
  });

  it("supports arrow, home and end navigation", () => {
    render(<ReportModeDock {...panels} />);
    const funnel = screen.getByRole("tab", { name: "01 Funnel" });

    fireEvent.keyDown(funnel, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "02 Creators" })).toHaveFocus();
    expect(screen.getByText("Creators panel")).toBeVisible();

    fireEvent.keyDown(screen.getByRole("tab", { name: "02 Creators" }), {
      key: "End",
    });
    expect(screen.getByRole("tab", { name: "05 Decision" })).toHaveFocus();
    expect(screen.getByText("Decision panel")).toBeVisible();

    fireEvent.keyDown(screen.getByRole("tab", { name: "05 Decision" }), {
      key: "Home",
    });
    expect(funnel).toHaveFocus();
  });
});
