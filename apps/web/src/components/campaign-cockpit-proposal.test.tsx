import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCockpitProposal,
  cockpitStates,
} from "./campaign-cockpit-proposal";

afterEach(cleanup);
describe("read-only cockpit proposal", () => {
  it("shows in-flight performance without gating it behind issuance", () => {
    render(<CampaignCockpitProposal view="home" />);
    expect(screen.getAllByText("Qualified wallets")).toHaveLength(2);
    expect(screen.getByText("Campaign costs")).toBeInTheDocument();
    expect(screen.getByText("Cost basis not yet agreed")).toBeInTheDocument();
    expect(screen.getByText("Partial evidence")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review campaign" }),
    ).toHaveAttribute(
      "href",
      "/visual-tests/reporting-studio/cockpit/campaign",
    );
    expect(screen.getByText("Approved measurement")).toBeInTheDocument();
    expect(screen.getByText("Reconciliation")).toBeInTheDocument();
  });
  it("keeps issuance unavailable with explicit cost and coverage blockers", () => {
    render(<CampaignCockpitProposal view="review" />);
    expect(
      screen.getByRole("button", { name: "Issue report unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Agree the campaign cost basis"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Verify source coverage and freshness"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to running campaign" }),
    ).toHaveAttribute(
      "href",
      "/visual-tests/reporting-studio/cockpit/campaign",
    );
  });
  it.each(cockpitStates.filter((s) => s !== "partial"))(
    "does not expose figures in %s state",
    (state) => {
      render(<CampaignCockpitProposal view="home" state={state} />);
      expect(screen.queryByText("Qualified wallets")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Helios Mobile Roster"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    },
  );
  it("retains links into existing reporting depth rather than faking its capabilities", () => {
    render(<CampaignCockpitProposal view="campaign" />);
    expect(
      screen.getByRole("link", { name: "Inspect existing creator results" }),
    ).toHaveAttribute("href", "/visual-tests/reporting/ready?mode=creators");
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
  });
});
