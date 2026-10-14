import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import {
  buildSubmissionCampaign,
  submissionPeriod,
} from "@/lib/submission-campaign";
import { BasketBuilder } from "./basket-builder";
import { CampaignControlWorkspace } from "./campaign-control-workspace";
afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
it("keeps the five-step read-only plan connected to the neutral campaign route", () => {
  const data = buildSubmissionCampaign();
  render(
    <BasketBuilder basket={data.basket} canManage={false} submissionSnapshot />,
  );
  expect(
    screen.getByRole("link", { name: /Continue to campaign/ }),
  ).toHaveAttribute(
    "href",
    `/projects/demo/campaigns?plan=${data.campaign.commercialPlanVersionId}`,
  );
  expect(screen.getByRole("link", { name: "Browse creators" })).toHaveAttribute(
    "href",
    "/projects/demo/kols",
  );
  expect(
    screen.queryByRole("button", { name: "Compare" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View: Target" }));
  expect(
    screen.getByText("Step 3 of 5 · Synthetic campaign plan"),
  ).toBeInTheDocument();
  expect(screen.getByText("350 wallets")).toBeInTheDocument();
});
it("connects campaign results to the same snapshot without claiming an issued report", () => {
  const data = buildSubmissionCampaign();
  render(
    <CampaignControlWorkspace
      campaign={data.campaign}
      canManage={false}
      submissionSnapshot
      projectSlug="demo"
      view="results"
      trackingSnapshotAt={submissionPeriod.endedAt}
      context={{
        trackingRestricted: true,
        planAvailable: true,
        flight: submissionPeriod,
        measurement: submissionPeriod,
        report: { id: data.report.id, version: 1 },
        reportUnavailable: false,
        measurementRule: {
          state: "retained",
          name: "Synthetic qualified action",
          version: 1,
        },
      }}
    />,
  );
  expect(
    screen.getByRole("link", { name: "View campaign results" }),
  ).toHaveAttribute(
    "href",
    `/projects/demo/reports/${data.report.id}?version=1`,
  );
  expect(
    screen.getByText(
      /No live measurement or issued database report is claimed/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Open report v/ }),
  ).not.toBeInTheDocument();
});
