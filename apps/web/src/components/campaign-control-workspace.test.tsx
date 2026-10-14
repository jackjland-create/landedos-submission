import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CampaignControlWorkspace,
  campaignView,
  fixedCampaignCommitments,
} from "./campaign-control-workspace";
import {
  workspaceFixture as campaign,
  workspaceContextFixture as context,
} from "@/lib/campaign-workspace.fixture";
import { campaignWorkspaceProgress } from "@/lib/campaign-workspace-progress";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
const props = {
  campaign,
  context,
  projectSlug: "helios",
  canManage: true,
  trackingSnapshotAt: "2026-09-22T12:00:00.000Z",
};
it("offers measurement setup only to enabled managers for an unbound approved plan", () => {
  const unbound = {
    ...context,
    measurementRule: { state: "unbound" as const },
  };
  const { rerender } = render(
    <CampaignControlWorkspace
      {...props}
      context={unbound}
      view="tracking"
      measurementSetupEnabled
    />,
  );
  expect(screen.getByRole("button", { name: "Set up results" })).toBeVisible();
  rerender(
    <CampaignControlWorkspace
      {...props}
      context={unbound}
      view="tracking"
      measurementSetupEnabled
      canManage={false}
    />,
  );
  expect(screen.queryByRole("button", { name: "Set up results" })).toBeNull();
  rerender(
    <CampaignControlWorkspace {...props} context={unbound} view="tracking" />,
  );
  expect(screen.queryByRole("button", { name: "Set up results" })).toBeNull();
  rerender(
    <CampaignControlWorkspace
      {...props}
      context={unbound}
      view="content"
      measurementSetupEnabled
    />,
  );
  expect(screen.queryByRole("button", { name: "Set up results" })).toBeNull();
});
it.each(["retained", "unavailable"] as const)(
  "does not offer a replacement rule for %s context",
  (state) => {
    render(
      <CampaignControlWorkspace
        {...props}
        view="tracking"
        measurementSetupEnabled
        context={{
          ...context,
          measurementRule:
            state === "retained"
              ? { state, name: "Exact approved result", version: 2 }
              : { state },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Set up results" })).toBeNull();
    if (state === "retained")
      expect(screen.getByText(/Exact approved result/)).toBeVisible();
  },
);
it("places the brief edit action in the content view and retains its theme", () => {
  render(<CampaignControlWorkspace {...props} view="content" theme="dark" />);
  expect(screen.getByRole("button", { name: "Edit brief" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Edit brief" }).closest("[data-theme]"),
  ).toHaveAttribute("data-theme", "dark");
  expect(
    screen.getByText(campaign.briefVersions[0].objective, { selector: "dd" }),
  ).toBeVisible();
});
it("opens the exact approved campaign without sending a draft back for approval", () => {
  render(<CampaignControlWorkspace {...props} />);
  expect(screen.getByText("GBP 1,275.00")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open brief" })).toHaveAttribute(
    "href",
    `/projects/helios/campaigns/${campaign.id}?view=content&theme=light`,
  );
  expect(screen.queryByText("REQUEST APPROVAL")).not.toBeInTheDocument();
  expect(screen.getByText(/not payment or measured spend/)).toBeVisible();
});
it("separates brief editing from delivery and keeps delivery controls discoverable", () => {
  const { rerender } = render(
    <CampaignControlWorkspace {...props} view="content" />,
  );
  expect(screen.getByRole("button", { name: "Edit brief" })).toBeVisible();
  expect(
    screen.queryByRole("heading", {
      name: "Deliverables and distribution evidence",
    }),
  ).toBeNull();
  rerender(
    <CampaignControlWorkspace
      {...props}
      campaign={{ ...campaign, status: "approved" }}
      view="delivery"
      theme="dark"
    />,
  );
  expect(campaignView("delivery")).toBe("delivery");
  expect(screen.getByRole("link", { name: "Delivery" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByRole("button", { name: "Edit brief" })).toBeNull();
  const action = screen.getByRole("button", { name: "Update delivery" });
  expect(action).toBeVisible();
  expect(action.closest("article")).toHaveTextContent(
    campaign.contentAssets[0].label,
  );
  expect(action.closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
  expect(
    screen.getByText("No traffic observed; qualified clicks remain unknown"),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("retains a delivery empty state without creating an update action", () => {
  render(
    <CampaignControlWorkspace
      {...props}
      campaign={{ ...campaign, contentAssets: [] }}
      view="delivery"
    />,
  );
  expect(screen.getByText("No content assets are planned.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Update delivery" })).toBeNull();
});

it.each(["content", "delivery", "tracking"] as const)(
  "uses natural page flow for %s, including read-only access",
  (view) => {
    render(
      <CampaignControlWorkspace {...props} view={view} canManage={false} />,
    );
    expect(
      screen.getByRole("region", { name: "Campaign workspace" }),
    ).toHaveAttribute("data-detail-scroll", "page");
    const detail = screen.getByRole("region", { name: "Campaign details" });
    expect(detail.closest("[data-detail-scroll]")).toHaveAttribute(
      "data-detail-scroll",
      "page",
    );
    expect(detail).not.toHaveAttribute("tabindex");
  },
);

it.each(["control", "roster", "results"] as const)(
  "preserves the existing bounded %s view",
  (view) => {
    render(<CampaignControlWorkspace {...props} view={view} />);
    expect(
      screen.getByRole("region", { name: "Campaign workspace" }),
    ).toHaveAttribute("data-detail-scroll", "panel");
    expect(
      screen.getByRole("region", { name: "Campaign details" }),
    ).toHaveAttribute("tabindex", "0");
  },
);
it("preserves exact record, recovery and theme across addressable views", () => {
  const executionReviewId = "a9000000-0000-4000-8000-000000000001";
  render(
    <CampaignControlWorkspace
      {...props}
      view="roster"
      theme="dark"
      executionReviewId={executionReviewId}
    />,
  );
  const link = screen.getByRole("link", { name: "Results" });
  expect(link).toHaveAttribute(
    "href",
    `/projects/helios/campaigns/${campaign.id}?view=results&theme=dark&executionReview=${executionReviewId}`,
  );
  expect(
    screen.getByRole("link", { name: "Creators & terms" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByText(/Organic repost/)).toBeInTheDocument();
  expect(campaignView("bad")).toBe("control");
});
it("does not expose tracking issuance for a strategy-bound plan", () => {
  render(<CampaignControlWorkspace {...props} view="tracking" />);
  expect(
    screen
      .getAllByText(/Live tracking is not enabled/)
      .some((node) => node.closest("dialog") === null),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: /ISSUE/ }),
  ).not.toBeInTheDocument();
});
it("withholds even a supplied signed URL while retaining historical click evidence", () => {
  const retained = structuredClone(campaign);
  retained.contentAssets[0].trackedLinks = [
    {
      id: "d1000000-0000-4000-8000-000000000001",
      generationRequestId: "d2000000-0000-4000-8000-000000000001",
      destinationUrl: "https://example.test/start",
      destinationPolicyActive: true,
      keyVersion: 1,
      expiresAt: "2026-10-10T12:00:00Z",
      issuedBy: campaign.createdBy,
      issuedAt: campaign.createdAt,
      revocation: null,
      anonymousSessions: {
        sessions: 0,
        boundClicks: 0,
        firstCreatedAt: null,
        lastSeenAt: null,
      },
      clickEvidence: {
        totalAttempts: 3,
        eligibleRedirects: 3,
        ineligibleAttempts: 0,
        firstObservedAt: null,
        lastObservedAt: null,
      },
      clickQuality: {
        ruleVersion: 1,
        duplicateWindowSeconds: 1800,
        qualifiedClicks: 2,
        duplicateClicks: 1,
        rejectedClicks: 0,
        totalAssessed: 3,
        pendingAssessment: 0,
        firstAssessedAt: null,
        lastAssessedAt: null,
      },
    },
  ];
  render(
    <CampaignControlWorkspace
      {...props}
      campaign={retained}
      view="tracking"
      signedLinkUrls={{
        "d1000000-0000-4000-8000-000000000001":
          "https://example.test/signed-secret",
      }}
      signingReady
    />,
  );
  expect(screen.queryByLabelText("Signed public URL")).not.toBeInTheDocument();
  expect(screen.queryByText(/Redirect active/)).not.toBeInTheDocument();
  expect(screen.getByText("Tracking unavailable")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
  expect(screen.getByText(/2 QUALIFIED CLICKS/)).toBeVisible();
});
it("prioritizes an issued report over an old draft brief", () => {
  render(
    <CampaignControlWorkspace
      {...props}
      context={{
        ...context,
        report: { id: "d2000000-0000-4000-8000-000000000001", version: 6 },
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Review the issued result" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Open brief" }),
  ).not.toBeInTheDocument();
});
it("uses only the exact issued report and distinguishes lookup failure from absence", () => {
  const { rerender } = render(
    <CampaignControlWorkspace
      {...props}
      view="results"
      context={{ ...context, reportUnavailable: true }}
    />,
  );
  expect(screen.getByText(/could not be checked/)).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Open report/ }),
  ).not.toBeInTheDocument();
  rerender(
    <CampaignControlWorkspace
      {...props}
      view="results"
      context={{
        ...context,
        report: { id: "d2000000-0000-4000-8000-000000000001", version: 6 },
      }}
    />,
  );
  expect(screen.getByRole("link", { name: "Open report v6" })).toHaveAttribute(
    "href",
    "/projects/helios/reports/d2000000-0000-4000-8000-000000000001?version=6",
  );
});
it("keeps currencies separate and variable compensation outside fixed totals", () => {
  const value = structuredClone(campaign);
  value.roster[0].commercialTerms.compensationLines.push(
    {
      id: "a4000000-0000-4000-8000-000000000002",
      assetType: "cash",
      model: "fixed",
      amountMinor: "900719925474099301",
      currencyCode: "USD",
    },
    {
      id: "a4000000-0000-4000-8000-000000000003",
      assetType: "cash",
      model: "variable",
      amountMinor: "250",
      currencyCode: "GBP",
      variableUnit: "qualified_wallet",
    },
  );
  expect(fixedCampaignCommitments(value)).toEqual({
    totals: ["GBP 1,275.00", "USD 9,007,199,254,740,993.01"],
    additional: true,
  });
});

it("keeps URL view values while showing the approved view labels", () => {
  render(<CampaignControlWorkspace {...props} />);
  const nav = screen.getByRole("navigation", { name: "Campaign views" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual([
    "Status",
    "Creators & terms",
    "Brief",
    "Delivery",
    "Tracking",
    "Results",
  ]);
  expect(
    links.map((a) => new URL(a.href, "http://x").searchParams.get("view")),
  ).toEqual([
    "control",
    "roster",
    "content",
    "delivery",
    "tracking",
    "results",
  ]);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(nav.querySelector("[role=tablist]")).toBeNull();
});
it("shows the manager the next step and a view-only user who owns it", () => {
  const { rerender } = render(<CampaignControlWorkspace {...props} />);
  const manager = screen.getByRole("region", { name: "Next campaign action" });
  expect(manager).toHaveAttribute("data-tone", "attention");
  expect(manager).toHaveTextContent("Next step");
  expect(screen.queryByText("View only")).not.toBeInTheDocument();
  rerender(<CampaignControlWorkspace {...props} canManage={false} />);
  const viewer = screen.getByRole("region", { name: "Next campaign action" });
  expect(viewer).toHaveTextContent("Waiting on the campaign manager");
  expect(viewer).toHaveAttribute("data-tone", "neutral");
  expect(screen.getByRole("link", { name: "View brief" })).toBeVisible();
  expect(screen.getByText("View only")).toBeVisible();
  expect(screen.getByText(/Read-only access/)).toBeVisible();
});
it("does not present an issued result or unavailable plan as the manager's decision", () => {
  const { rerender } = render(
    <CampaignControlWorkspace
      {...props}
      canManage={false}
      context={{
        ...context,
        report: { id: "d2000000-0000-4000-8000-000000000001", version: 6 },
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Next campaign action" });
  expect(region).toHaveAttribute("data-tone", "progress");
  expect(region).not.toHaveTextContent("Waiting on the campaign manager");
  rerender(
    <CampaignControlWorkspace
      {...props}
      context={{ ...context, planAvailable: false }}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Next campaign action" }),
  ).toHaveAttribute("data-tone", "blocked");
  expect(screen.getByRole("link", { name: "Reload workspace" })).toBeVisible();
});
it("shows stored state truthfully: no published claim, no zero for missing data", () => {
  render(<CampaignControlWorkspace {...props} />);
  expect(screen.getByText("Campaign draft")).toBeVisible();
  expect(screen.getByText("Brief v1 · draft")).toBeVisible();
  expect(screen.getByText("approved or published")).toBeVisible();
  expect(screen.queryByText(/\bpublished\b \/|0 published/)).toBeNull();
  expect(screen.getByText(/^1 planned$/)).toBeVisible();
  expect(screen.getAllByText("Empty")).toHaveLength(4);
  expect(screen.getAllByText("Set")).toHaveLength(1);
  expect(screen.queryByText(/Campaign state:/)).toBeNull();
  expect(screen.getByText("Payment status not tracked here")).toBeVisible();
  expect(screen.queryByText(/Agreed, not paid/)).toBeNull();
});
it("does not tell viewers to wait for a manager when only reviewing evidence", () => {
  const value = structuredClone(campaign);
  value.status = "finalized";
  const { rerender } = render(
    <CampaignControlWorkspace {...props} campaign={value} canManage={false} />,
  );
  expect(
    screen.getByRole("heading", { name: "Review campaign evidence" }),
  ).toBeVisible();
  expect(screen.queryByText("Waiting on the campaign manager")).toBeNull();
  value.status = "approved";
  value.briefVersions[0]!.status = "approved";
  rerender(
    <CampaignControlWorkspace {...props} campaign={value} canManage={false} />,
  );
  expect(
    screen.getByRole("link", { name: "Open evidence review" }),
  ).toBeVisible();
  expect(screen.queryByText("Waiting on the campaign manager")).toBeNull();
  rerender(
    <CampaignControlWorkspace
      {...props}
      campaign={value}
      canManage={false}
      activationReview={<p>Existing activation control</p>}
    />,
  );
  expect(screen.getByText("Waiting on the campaign manager")).toBeVisible();
});
it("keeps empty deliverables and a missing flight unavailable rather than zero", () => {
  const value = structuredClone(campaign);
  value.contentAssets = [];
  render(
    <CampaignControlWorkspace
      {...props}
      campaign={value}
      context={{ ...context, flight: null, measurement: null }}
    />,
  );
  expect(screen.getByText("None recorded")).toBeVisible();
  expect(screen.queryByText("0 / 0")).toBeNull();
  expect(screen.getByText("Not available")).toBeVisible();
  expect(
    screen.getAllByText("Not available in the retained plan"),
  ).toHaveLength(2);
});

it("renders exactly the supplied progress facts and none when absent", () => {
  const snapshotAt = "2026-09-22T12:00:00.000Z";
  const { rerender } = render(<CampaignControlWorkspace {...props} />);
  expect(
    screen.queryByRole("region", { name: "Campaign progress" }),
  ).toBeNull();
  rerender(
    <CampaignControlWorkspace
      {...props}
      context={{
        ...context,
        progress: {
          snapshotAt,
          steps: campaignWorkspaceProgress(campaign, context, snapshotAt),
        },
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Campaign progress" });
  const steps = region.querySelectorAll("li");
  expect([...steps].map((li) => li.getAttribute("data-state"))).toEqual([
    "complete",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  expect(region).toHaveTextContent("0 / 1 assets with a current link");
  expect(region).not.toHaveTextContent("published · ");
});
