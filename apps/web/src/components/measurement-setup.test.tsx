import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MeasurementSetup, type SetupRuleSummary } from "./measurement-setup";
afterEach(cleanup);

function setup({
  active = false,
  admin = false,
  rule = { state: "missing" },
  open = false,
}: {
  active?: boolean;
  admin?: boolean;
  rule?: SetupRuleSummary;
  open?: boolean;
} = {}) {
  return render(
    <MeasurementSetup
      projectId="helios"
      hasActiveWebsite={active}
      canApproveWebsite={admin}
      rule={rule}
      snapshotAt="2026-10-09T18:00:00Z"
      operationsInitiallyOpen={open}
    >
      <section id="tracking-destination-control">
        Existing admin controls
      </section>
      <h2 id="data-quality-heading">Existing source evidence</h2>
    </MeasurementSetup>,
  );
}

describe("project measurement setup", () => {
  it("makes missing prerequisites and their owners clear without an enable action", () => {
    setup();
    expect(screen.getByText("Website approval needed")).toBeInTheDocument();
    expect(screen.getByText("No saved rule")).toBeInTheDocument();
    expect(screen.getByText("Not verified here")).toBeInTheDocument();
    expect(screen.getByText(/ask your admin/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Success rules" }),
    ).toHaveAttribute("href", "/projects/helios/settings/conversions");
    expect(screen.getByText(/Settings read/)).toHaveTextContent("9 Oct 2026");
  });
  it("does not promote an approved host or a saved rule to campaign measurement readiness", () => {
    setup({
      active: true,
      admin: true,
      rule: {
        state: "saved",
        name: "Example outcome",
        version: 4,
        createdAt: "2026-10-08T12:00:00Z",
      },
    });
    expect(screen.getByText("Approved website on record")).toBeInTheDocument();
    expect(
      screen.getByText(/Another approved website does not cover yours/),
    ).toBeInTheDocument();
    expect(screen.getByText("Saved rule · version 4")).toBeInTheDocument();
    expect(
      screen.getByText(/not confirmation of the rule retained by a campaign/),
    ).toBeInTheDocument();
    expect(screen.getByText("Not verified here")).toBeInTheDocument();
    expect(
      screen.getByText(/Provider health alone does not verify/),
    ).toBeInTheDocument();
  });
  it("distinguishes a failed rule read from a missing rule", () => {
    setup({ rule: { state: "unavailable" } });
    expect(screen.getByText("Rule status unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No saved rule")).not.toBeInTheDocument();
    expect(screen.getByText(/Open Success rules to retry/)).toBeInTheDocument();
  });
  it.each(["Review website approvals", "Review connection evidence"])(
    "reveals advanced controls before navigating via %s",
    (name) => {
      const { container } = setup();
      const details = container.querySelector("details")!;
      expect(details.open).toBe(false);
      fireEvent.click(screen.getByRole("link", { name }));
      expect(details.open).toBe(true);
    },
  );
  it("keeps a supervised approval handoff visible", () => {
    const { container } = setup({ open: true });
    expect(container.querySelector("details")!.open).toBe(true);
  });
});
