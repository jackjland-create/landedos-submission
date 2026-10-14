import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimedReportReview } from "./timed-report-review";
import fixture from "@/lib/reports/fixtures/retained-report-reconciled.json";
import { projectTimedCampaignHandoff } from "@/lib/reports/timed-campaign-handoff.server";
import { project } from "@/lib/demo-data";

const parameters = {
  workspaceId: "10990000-0000-4000-8000-000000000001",
  projectId: "20990000-0000-4000-8000-000000000001",
  campaignId: "40990000-0000-4000-8000-000000000001",
  executionId: "90990000-0000-4000-8000-000000000300",
};
const draft = {
  kind: "draft",
  draftId: "90990000-0000-4000-8000-000000000400",
  scope: parameters,
  receipt: null,
  expired: false,
  expiresAt: "2026-09-21T14:15:00Z",
  checkedAt: "2026-09-21T14:00:00Z",
  measurementWindow: {
    startedAt: "2026-09-01T00:00:00Z",
    endedAt: "2026-09-07T00:00:00Z",
  },
  costs: {
    currencyCode: "GBP",
    total: { status: "available", amountMinor: "519500" },
    lines: [],
  },
  qualifiedWallets: 2,
  costPerQualifiedWallet: "259750",
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function respond(value: unknown, ok = true) {
  fetchMock.mockResolvedValueOnce({ ok, json: async () => value });
}
describe("human report review", () => {
  it.each(["receipt", "draft"])(
    "does not request approval again after %s receipt recovery",
    async (kind) => {
      const receipt = {
        reportId: "90990000-0000-4000-8000-000000000500",
        reportVersionId: "90990000-0000-4000-8000-000000000501",
        version: 1,
      };
      respond(kind === "draft" ? { ...draft, receipt } : { kind, receipt });
      render(
        <TimedReportReview
          signedIn
          parameters={{ ...parameters, draftId: draft.draftId }}
          reviewTiming={{ decisionsCloseAt: "2026-09-21T14:13:00Z" }}
        />,
      );
      await screen.findByRole("heading", { name: "Report issued" });
      expect(
        screen.queryByText(/Complete report approval before/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Approve and issue report" }),
      ).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("opens the exact Overview receipt after explicit human confirmation", async () => {
    const receipt = {
      reportId: "90990000-0000-4000-8000-000000000500",
      reportVersionId: "90990000-0000-4000-8000-000000000501",
      version: 2,
    };
    respond(draft);
    render(
      <TimedReportReview
        signedIn
        parameters={{
          ...parameters,
          workspaceId: project.workspaceId,
          projectId: project.databaseId,
          draftId: draft.draftId,
        }}
      />,
    );
    const heading = await screen.findByRole("heading", {
      name: "2. Confirm the reviewed result",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "Exact result and costs reviewed" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    respond({ kind: "receipt", receipt });
    fireEvent.submit(heading.closest("form")!);
    expect(
      await screen.findByRole("link", { name: "Open issued report" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/overview?report=${receipt.reportId}&version=2&theme=light`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      action: "confirm",
      draftId: draft.draftId,
      confirmed: true,
      reason: "Exact result and costs reviewed",
    });
  });
  it.each(["receipt", "draft"])(
    "opens the exact issued Helios version in Overview after %s recovery",
    async (kind) => {
      const receipt = {
        reportId: "90990000-0000-4000-8000-000000000500",
        reportVersionId: "90990000-0000-4000-8000-000000000501",
        version: 3,
      };
      respond({ ...draft, kind, receipt });
      render(
        <TimedReportReview
          signedIn
          parameters={{
            ...parameters,
            projectId: project.databaseId,
            workspaceId: project.workspaceId,
            draftId: draft.draftId,
            theme: "dark",
          }}
        />,
      );
      const link = await screen.findByRole("link", {
        name: "Open issued report",
      });
      expect(link).toHaveAttribute(
        "href",
        `/projects/helios/overview?report=${receipt.reportId}&version=3&theme=dark`,
      );
      fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
      expect(link).toHaveAttribute(
        "href",
        `/projects/helios/overview?report=${receipt.reportId}&version=3&theme=light`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-store" });
      expect(
        screen.queryByRole("button", { name: "Approve and issue report" }),
      ).toBeNull();
    },
  );
  it.each([parameters, { ...parameters, projectId: project.databaseId }])(
    "does not redirect another workspace's retained fixture to Helios",
    async (scope) => {
      const receipt = {
        reportId: "90990000-0000-4000-8000-000000000500",
        reportVersionId: "90990000-0000-4000-8000-000000000501",
        version: 3,
      };
      respond({ kind: "receipt", receipt });
      render(
        <TimedReportReview
          signedIn
          parameters={{ ...scope, draftId: draft.draftId }}
        />,
      );
      expect(
        await screen.findByRole("link", { name: "Open issued report" }),
      ).toHaveAttribute(
        "href",
        `/visual-tests/reporting-studio/authenticated?${new URLSearchParams({ workspaceId: scope.workspaceId, projectId: scope.projectId, reportId: receipt.reportId, reportVersionId: receipt.reportVersionId, theme: "light" })}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps the initial source-load action disabled until hydrated without an automatic read", () => {
    const element = document.createElement("div");
    element.innerHTML = renderToString(
      <TimedReportReview signedIn parameters={parameters} />,
    );
    const button = Array.from(element.querySelectorAll("button")).find(
      (node) => node.textContent === "Load campaign review",
    );
    expect(button).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    render(<TimedReportReview signedIn parameters={parameters} />);
    expect(
      screen.getByRole("button", { name: "Load campaign review" }),
    ).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("connects retained plan and execution to cost review without claiming browser approval", async () => {
    const source = fixture.evidence.executionReview.reportReview.reportSources;
    respond({
      kind: "sources",
      sourceHash: fixture.sourceHash,
      checkedAt: fixture.checkedAt,
      measurementWindow: source.measurementWindow,
      lines: [],
      handoff: projectTimedCampaignHandoff(
        fixture,
        source,
        parameters.executionId,
      ),
    });
    render(<TimedReportReview signedIn parameters={parameters} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load campaign review" }),
    );
    await screen.findByRole("heading", {
      name: "Strategy preview: campaign handoff",
    });
    expect(
      screen.getByText(/not by browser approval or live ingestion/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Commercial plan: ${source.commercialPlanVersionId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue to cost review" }),
    ).toHaveAttribute("href", "#campaign-cost-review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-store" });
  });
  it("makes no request for a signed-out visitor", () => {
    render(
      <TimedReportReview
        signedIn={false}
        parameters={{ ...parameters, draftId: draft.draftId }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Reporting access is required" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not implicitly prepare or approve and toggles the theme", () => {
    render(<TimedReportReview signedIn parameters={parameters} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(window.location.search).toContain("theme=dark");
  });
  it("shows exact amounts and requires explicit human confirmation", async () => {
    respond(draft);
    render(
      <TimedReportReview
        signedIn
        parameters={{ ...parameters, draftId: draft.draftId }}
      />,
    );
    await screen.findByRole("heading", {
      name: "2. Confirm the reviewed result",
    });
    expect(screen.getByText(/Contracted spend:/)).toHaveTextContent(
      "£5,195.00",
    );
    expect(screen.getByText(/Cost per qualified wallet:/)).toHaveTextContent(
      "£2,597.50",
    );
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-store" });
  });
  it("never renders an approval action for an expired review", async () => {
    respond({ ...draft, expired: true });
    render(
      <TimedReportReview
        signedIn
        parameters={{ ...parameters, draftId: draft.draftId }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "review expired",
    );
    expect(
      screen.queryByRole("button", { name: "Approve and issue report" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start a fresh cost review" }),
    ).toBeEnabled();
  });
  it("explains an empty cost source without inventing spend", async () => {
    respond({
      kind: "sources",
      sourceHash: "a".repeat(64),
      measurementWindow: draft.measurementWindow,
      lines: [],
    });
    render(<TimedReportReview signedIn parameters={parameters} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load campaign review" }),
    );
    await screen.findByText(/No approved cost lines are available/);
    expect(screen.queryByText("£0.00", { exact: false })).toBeNull();
    expect(screen.getByLabelText("Other campaign costs")).toHaveValue("");
  });
  it("preserves unavailable amounts instead of displaying zero", async () => {
    respond({
      ...draft,
      costs: {
        ...draft.costs,
        total: { status: "not_available", amountMinor: null },
      },
      qualifiedWallets: null,
      costPerQualifiedWallet: null,
    });
    render(
      <TimedReportReview
        signedIn
        parameters={{ ...parameters, draftId: draft.draftId }}
      />,
    );
    await screen.findByRole("heading", {
      name: "2. Confirm the reviewed result",
    });
    expect(screen.getByText(/Contracted spend:/)).toHaveTextContent(
      "Not available",
    );
    expect(screen.queryByText("£0.00", { exact: false })).toBeNull();
  });
  it("offers read-only recovery after a failed confirmation without auto-retry", async () => {
    respond(draft);
    render(
      <TimedReportReview
        signedIn
        parameters={{ ...parameters, draftId: draft.draftId }}
      />,
    );
    const heading = await screen.findByRole("heading", {
      name: "2. Confirm the reviewed result",
    });
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "Exact result reviewed" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fetchMock.mockRejectedValueOnce(new Error("Confirmation interrupted"));
    fireEvent.submit(heading.closest("form")!);
    await screen.findByText(
      "Confirmation could not be verified. Check issuance status below before trying again.",
    );
    expect(screen.getByRole("status")).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    respond({ kind: "receipt", receipt: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Check issuance status" }),
    );
    await screen.findByText("No issued result is recorded for this request.");
    expect(fetchMock.mock.calls[2]![0]).toContain("action=recover");
    expect(fetchMock.mock.calls[2]![1]).toEqual({ cache: "no-store" });
  });
});
