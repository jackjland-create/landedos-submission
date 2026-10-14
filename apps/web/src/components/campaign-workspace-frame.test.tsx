import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  CampaignNextStep,
  CampaignProgress,
  CampaignWorkspaceFrame,
  CampaignWorkspaceFrameState,
  FrameDot,
} from "./campaign-workspace-frame";

afterEach(cleanup);

const frame = {
  theme: "light" as const,
  canManage: true,
  breadcrumb: { href: "/projects/helios/campaigns", label: "Campaigns" },
  meta: "Plan v1 · updated 22/09/2026, 12:00:00 UTC",
  title: "Synthetic campaign",
  objective: "Synthetic objective",
  status: {
    label: "Campaign draft",
    state: "pending" as const,
    tone: "neutral" as const,
  },
  brief: {
    label: "Brief v1 · draft",
    state: "pending" as const,
    tone: "neutral" as const,
  },
  approvalRecordHref: "/projects/helios/baskets/b?view=approval",
  themeHref: "?view=control&theme=dark",
  themeLabel: "Dark mode",
  tiles: [{ label: "Selected roster", value: "1 creator", detail: "Plan v1" }],
  navigation: [
    { key: "control", label: "Status", href: "?view=control", current: true },
    {
      key: "roster",
      label: "Creators & terms",
      href: "?view=roster",
      current: false,
    },
  ],
};

it("renders one heading, page navigation and no action for view-only users", () => {
  const { rerender } = render(
    <CampaignWorkspaceFrame {...frame}>
      <p>Body</p>
    </CampaignWorkspaceFrame>,
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Synthetic campaign",
  );
  expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    screen.getByRole("link", { name: "Creators & terms" }),
  ).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Approval record" })).toBeVisible();
  expect(screen.queryByText("View only")).toBeNull();
  rerender(
    <CampaignWorkspaceFrame {...frame} canManage={false}>
      <p>Body</p>
    </CampaignWorkspaceFrame>,
  );
  expect(screen.getByText("View only")).toBeVisible();
  expect(screen.getByRole("note")).toHaveTextContent("Read-only access");
});

it("pairs every status colour with a word and a dot state", () => {
  render(
    <>
      <FrameDot state="confirmed" tone="progress">
        Set
      </FrameDot>
      <FrameDot state="pending" tone="attention">
        Empty
      </FrameDot>
      <FrameDot state="unavailable">Not tracked</FrameDot>
    </>,
  );
  expect(screen.getByText("Set")).toHaveAttribute("data-state", "confirmed");
  expect(screen.getByText("Empty")).toHaveAttribute("data-state", "pending");
  expect(screen.getByText("Not tracked")).toHaveAttribute(
    "data-state",
    "unavailable",
  );
});

it("keeps the next-step destination for both roles and names who acts", () => {
  const props = {
    ownerAction: true,
    tone: "attention" as const,
    title: "Complete the campaign brief",
    detail: "Detail",
    href: "?view=content",
    label: "Open brief",
  };
  const { rerender } = render(<CampaignNextStep {...props} canManage />);
  expect(screen.getByText("Next step")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open brief" })).toHaveClass(
    "application-button--attention",
  );
  rerender(
    <CampaignNextStep {...props} canManage={false} label="View brief" />,
  );
  expect(screen.getByText("Waiting on the campaign manager")).toBeVisible();
  const link = screen.getByRole("link", { name: "View brief" });
  expect(link).toHaveAttribute("href", "?view=content");
  expect(link).not.toHaveClass("application-button--attention");
});

it("announces errors and permission states and marks loading busy", () => {
  const { rerender } = render(
    <CampaignWorkspaceFrameState
      state="error"
      title="The campaign could not be prepared."
      detail="No record was changed."
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("could not be prepared");
  rerender(
    <CampaignWorkspaceFrameState
      state="permission"
      title="This campaign is outside your project access."
      detail="Ask an administrator."
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "outside your project access",
  );
  rerender(
    <CampaignWorkspaceFrameState
      state="loading"
      title="Loading campaign"
      detail="Reading the retained plan."
    />,
  );
  expect(
    screen.getByRole("region", { name: "Loading campaign" }),
  ).toHaveAttribute("aria-busy", "true");
});

it("shows supplied progress as words with freshness and no current-step claim", () => {
  render(
    <CampaignProgress
      progress={{
        snapshotAt: "2026-09-22T12:00:00.000Z",
        steps: [
          {
            id: "plan",
            label: "Plan",
            state: "complete",
            detail: "Commercial plan v1 retained",
          },
          {
            id: "brief",
            label: "Brief",
            state: "pending",
            detail: "Brief v1 · draft",
          },
          {
            id: "links",
            label: "Tracking links",
            state: "unavailable",
            detail: "No content assets recorded",
          },
        ],
      }}
    />,
  );
  const list = screen.getByRole("list");
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent("Plan");
  expect(items[1]).toHaveTextContent("Brief");
  expect(items[2]).toHaveTextContent("Tracking links");
  expect(items[2]).toHaveAttribute("data-state", "unavailable");
  for (const word of ["Done", "Not yet", "Unavailable"]) {
    expect(screen.getByText(word)).toBeVisible();
    expect(screen.getByText(word)).not.toHaveClass("sr-only");
  }
  expect(list.querySelector("[aria-current]")).toBeNull();
  expect(screen.getByText("Progress as of 22 Sept, 12:00 UTC")).toBeVisible();
  const detail = screen.getByText("Commercial plan v1 retained");
  expect(detail).not.toBeVisible();
  const disclosure = detail.closest("details")!;
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(disclosure).toHaveAttribute("open");
  expect(detail).toBeVisible();
});

it("keeps the next action outside the keyboard-accessible scrolling details", () => {
  render(
    <CampaignWorkspaceFrame
      {...frame}
      nextAction={<a href="?view=content">Open brief</a>}
    >
      <p>Working details</p>
    </CampaignWorkspaceFrame>,
  );
  const body = screen.getByRole("region", { name: "Campaign details" });
  expect(body).toHaveAttribute("tabindex", "0");
  expect(body).toHaveTextContent("Working details");
  expect(body).not.toContainElement(
    screen.getByRole("link", { name: "Open brief" }),
  );
});

it("omits the stepper when the route supplies no progress", () => {
  render(
    <CampaignWorkspaceFrame {...frame}>
      <p>Body</p>
    </CampaignWorkspaceFrame>,
  );
  expect(
    screen.queryByRole("region", { name: "Campaign progress" }),
  ).toBeNull();
});

it("lets short views use page flow without an extra keyboard scroll stop", () => {
  const { rerender } = render(
    <CampaignWorkspaceFrame {...frame} detailScroll="page">
      <details>
        <summary>History</summary>
        <p>Retained detail</p>
      </details>
    </CampaignWorkspaceFrame>,
  );
  const body = screen.getByRole("region", { name: "Campaign details" });
  expect(body.closest("[data-detail-scroll]")).toHaveAttribute(
    "data-detail-scroll",
    "page",
  );
  expect(body).not.toHaveAttribute("tabindex");
  fireEvent.click(screen.getByText("History"));
  expect(screen.getByText("Retained detail")).toBeVisible();
  rerender(
    <CampaignWorkspaceFrame {...frame}>
      <p>Dense view</p>
    </CampaignWorkspaceFrame>,
  );
  expect(body.closest("[data-detail-scroll]")).toHaveAttribute(
    "data-detail-scroll",
    "panel",
  );
  expect(body).toHaveAttribute("tabindex", "0");
});
