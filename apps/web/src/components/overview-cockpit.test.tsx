import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildReportVisualFixture } from "@/lib/reports/visual-fixtures";
import { OverviewCockpit } from "./overview-cockpit";
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
describe("merged Overview", () => {
  it("keeps historical missing names honest, readable and without fabricated initials", () => {
    const fixture = buildReportVisualFixture("ready");
    for (const path of fixture.rankingEvidencePaths)
      path.creatorName = `Creator ${path.creatorId}`;
    render(
      <OverviewCockpit
        state="ready"
        fixture={fixture}
        evidenceProvenance="synthetic"
      />,
    );
    expect(screen.queryByText("Nn")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Name not retained/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "How it counts" }));
    expect(
      screen.getAllByText(/current profile name has not been substituted/)
        .length,
    ).toBeGreaterThan(0);
    expect(fixture.rankingEvidencePaths[0]!.creatorName).toMatch(/^Creator /);
  });
  it("shows signed-in name and sidebar theme with no Reports navigation", () => {
    render(
      <OverviewCockpit
        state="ready"
        fixture={buildReportVisualFixture("ready")}
        evidenceProvenance="synthetic"
        accountName="Jack"
      />,
    );
    const rail = document.querySelector("aside.rail")! as HTMLElement;
    expect(within(rail).getByText("Jack")).toBeInTheDocument();
    expect(
      within(rail).getByRole("switch", { name: "Dark mode" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).queryByText("Reports"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Qualified wallets: 7. Open evidence",
      }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });
  it("opens exact evidence with provenance and retains version/export controls", () => {
    render(
      <OverviewCockpit
        state="ready"
        fixture={buildReportVisualFixture("ready")}
        evidenceProvenance="synthetic"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Qualified wallets: 7. Open evidence",
      }),
    );
    const drawer = screen.getByRole("dialog");
    expect(
      within(drawer).getAllByText("Founder interview launch clip"),
    ).toHaveLength(1);
    expect(within(drawer).getByText("exactly · goal 12")).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Wallet signatures and consent are simulated in this demo.",
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).queryByRole("link", { name: "Transaction ↗" }),
    ).not.toBeInTheDocument();
    expect(
      within(drawer).getByRole("link", { name: "Compare with v1" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        "version=2&theme=light&view=performance&compare=1",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each(["loading", "empty", "error", "permission"] as const)(
    "handles %s without leaking report data",
    (state) => {
      render(<OverviewCockpit state={state} />);
      expect(
        screen.queryByRole("button", { name: /^Qualified wallets:/ }),
      ).not.toBeInTheDocument();
    },
  );
  it("keeps unknown metrics unavailable and viewer actions neutral", () => {
    render(
      <OverviewCockpit
        state="ready"
        fixture={buildReportVisualFixture("partial")}
        canManage={false}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Qualified wallets: Not available. Open evidence",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector(".application-button--hero")).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Performance" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "Funnel" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("shows activated-only partial coverage on chart, table and trust details", () => {
    const fixture = buildReportVisualFixture("ready");
    fixture.selectedVersion.measurementContext!.observations.forEach((o) => {
      o.periodState = o.metric === "activated_wallets" ? "partial" : "complete";
    });
    render(<OverviewCockpit state="ready" fixture={fixture} />);
    expect(screen.getByRole("status")).toHaveTextContent("Partial coverage");
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getAllByRole("rowheader", { name: /partial/ })).toHaveLength(
      4,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Qualified wallets:/ }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Partial last day explicitly labelled.",
      ),
    ).toBeInTheDocument();
  });
  it("retries the exact requested report context rather than the latest report", () => {
    const href =
      "/projects/helios/overview?report=exact&version=2&compare=1&view=economics&theme=dark";
    render(<OverviewCockpit state="error" retryHref={href} />);
    expect(
      screen.getByRole("link", { name: "Retry overview" }),
    ).toHaveAttribute("href", href);
  });
  it("does not claim signed proof when its provenance is unavailable", () => {
    const fixture = buildReportVisualFixture("ready");
    fixture.rankingEvidencePaths.forEach((p) => {
      p.environment = "devnet";
    });
    render(
      <OverviewCockpit
        state="ready"
        fixture={fixture}
        evidenceProvenance="unknown"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Qualified wallets:/ }),
    );
    expect(
      within(screen.getByRole("dialog")).getAllByText(
        /Proof status not available/,
      ).length,
    ).toBeGreaterThan(1);
    expect(
      within(screen.getByRole("dialog")).queryByText(/Signed nonce \+ consent/),
    ).not.toBeInTheDocument();
  });
});
