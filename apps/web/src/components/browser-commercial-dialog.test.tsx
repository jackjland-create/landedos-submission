import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";
import {
  BrowserCommercialApproval,
  BrowserCommercialRecovery,
  LocalDevnetCommercialApproval,
} from "./browser-commercial-review";
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
const props = {
  basketId: fixture.review_snapshot.basket.id,
  scenarioId: fixture.review_snapshot.scenario.id,
  revision: fixture.review_snapshot.strategyBinding.revision,
  snapshotHash: fixture.review_snapshot_hash,
  ownerId: "30990000-0000-4000-8000-000000000001",
};
const reviewId = "5f52493b-5673-4838-9d1c-d8145793938c";
const draft = () => ({
  id: reviewId,
  ownerId: props.ownerId,
  snapshotHash: props.snapshotHash,
  snapshot: structuredClone(fixture.review_snapshot),
  expiresAt: new Date(Date.now() + 900000).toISOString(),
});
function markUnpaid(
  creatorPackage: ReturnType<typeof draft>["snapshot"]["packages"][number],
) {
  Object.assign(creatorPackage, {
    compensationLines: [],
    commercialDetail: {
      schemaVersion: 2,
      revision: 1,
      creatorDisplayName: "Jack — internal devnet test participant",
      channels: [],
      deliveryDeadline: null,
      usageRights: "No content usage rights.",
      exclusivity: "No exclusivity.",
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet response proof.",
    },
  });
}
const response = (value: unknown) => ({ ok: true, json: async () => value });
const selectedId = "6f52493b-5673-4838-9d1c-d8145793938c";
const chosen = () => ({
  ...draft(),
  id: selectedId,
  snapshotHash: "selected-hash",
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  selection: {
    version: 1,
    sourceReviewId: reviewId,
    sourceSnapshotHash: props.snapshotHash,
    packageIds: fixture.review_snapshot.packages.map((p) => p.id),
  },
});
const acknowledge = () =>
  fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
const selectAll = () =>
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select all packages for approval" }),
  );
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
    },
  });
});
afterEach(() => {
  cleanup();
  search.value = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
  await screen.findByRole("table");
}
it("renders explicit retained identity, channel, deadline and rights without inventing missing terms", async () => {
  const retained = draft();
  Object.assign(retained.snapshot.packages[0], {
    commercialDetail: {
      schemaVersion: 1,
      revision: 3,
      creatorDisplayName: "Retained creator name",
      channels: [
        {
          id: "91000000-0000-4000-8000-000000000071",
          channelType: "x",
          handle: "@retained",
        },
      ],
      deliveryDeadline: "2026-10-01T12:30:00.123456Z",
      usageRights: "Organic repost only. No paid use.",
      exclusivity: null,
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(retained)));
  render(<BrowserCommercialApproval {...props} />);
  await open();
  expect(screen.getByText("Retained creator name")).toBeVisible();
  expect(screen.getByText(/@retained/)).toBeVisible();
  expect(screen.getByText(/Organic repost only. No paid use./)).toBeVisible();
  expect(screen.getByText("2026-10-01T12:30:00.123456Z")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
});
it("loads the exact snapshot on opening; closing/reopening does not duplicate preparation or approve", async () => {
  const fetch = vi.fn().mockResolvedValue(response(draft()));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  expect(fetch).not.toHaveBeenCalled();
  await open();
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      `0 of ${fixture.review_snapshot.packages.length} creators selected`,
    ),
  ).toBeVisible();
  selectAll();
  expect(screen.getByText("GBP 5,195.00")).toBeVisible();
  // Rate quote, deadline, usage and exclusivity are all unspecified for
  // both retained packages; each says so rather than implying permission.
  expect(screen.getAllByText("Not specified")).toHaveLength(8);
  expect(screen.getAllByText("Not specified is not permission.")).toHaveLength(
    2,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Close approval review" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await open();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).action).toBe("prepare");
});
it("Back to edit discards acknowledgement and obtains a fresh exact review", async () => {
  const fetch = vi.fn().mockResolvedValue(response(draft()));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  fireEvent.change(screen.getByLabelText("Note (optional)"), {
    target: { value: "Ready" },
  });
  acknowledge();
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  await open();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("checkbox", { name: /I have reviewed/ }),
  ).not.toBeChecked();
  expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
});
it("a changed saved-plan identity discards the old modal and does not confirm it", async () => {
  const fetch = vi.fn().mockResolvedValue(response(draft()));
  vi.stubGlobal("fetch", fetch);
  const view = render(<BrowserCommercialApproval {...props} />);
  await open();
  view.rerender(
    <BrowserCommercialApproval {...props} revision={props.revision + 1} />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects mismatched snapshot identity and offers recovery from loading errors", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(response({ ...draft(), snapshotHash: "different" }));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
  await screen.findByText(
    "The plan changed. Reload the saved plan before approving.",
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
});
it("expired and empty snapshots cannot be approved", async () => {
  const fetch = vi.fn().mockResolvedValue(
    response({
      ...draft(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const view = render(<BrowserCommercialApproval {...props} />);
  await open();
  await screen.findByText(/This review has expired/);
  // Expired: no acknowledgement or approve action is offered at all.
  expect(
    screen.queryByRole("checkbox", { name: /I have reviewed/ }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Approve selected terms" }),
  ).toBeNull();
  view.unmount();
  fetch.mockResolvedValue(
    response({
      ...draft(),
      snapshot: { ...fixture.review_snapshot, packages: [] },
    }),
  );
  render(<BrowserCommercialApproval {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("table")).toBeNull();
});
it("allows omitted note with explicit selection and acknowledgement; interrupted confirmation never retries automatically", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(draft()))
    .mockResolvedValueOnce(response(chosen()))
    .mockRejectedValue(new Error("response lost"));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  selectAll();
  acknowledge();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve selected terms" }),
  );
  await screen.findByText(/Approval status is uncertain/);
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    action: "confirmSelected",
    basketId: props.basketId,
    reviewId: selectedId,
    acknowledged: true,
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We couldn’t confirm whether the approval was saved.",
  );
  expect(
    screen.getByText(/Don’t approve again\. Check the status first/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Check approval status" }),
  ).toHaveAttribute("href", `?commercialReview=${selectedId}`);
  expect(screen.getByRole("button", { name: "Back to edit" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Approve selected terms" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Close approval review" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check approval status" }),
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    screen.queryByRole("button", {
      name: "Approve selected terms",
      hidden: true,
    }),
  ).toBeNull();
});
it("closing during preparation retains the same pending request and loaded result", async () => {
  let finish!: (value: unknown) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
  await screen.findByText("Checking the saved plan…");
  fireEvent.click(
    screen.getByRole("button", { name: "Close approval review" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(draft()));
  await waitFor(() => expect(screen.getByRole("table")).toBeVisible());
});
it("row selection is local, mixed-state and exact-cost; changing it clears acknowledgement", async () => {
  const fetch = vi.fn().mockResolvedValue(response(draft()));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  const entry = fixture.review_snapshot.packages[0]!;
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: `Select ${entry.packageLabel} for approval`,
    }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Select all packages for approval" }),
  ).toHaveProperty("indeterminate", true);
  expect(
    screen.getByText(
      `1 of ${fixture.review_snapshot.packages.length} creators selected`,
    ),
  ).toBeVisible();
  acknowledge();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeEnabled();
  selectAll();
  expect(
    screen.getByRole("checkbox", { name: /I have reviewed/ }),
  ).not.toBeChecked();
  selectAll();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("never confirms a server-selected subset with altered terms", async () => {
  const altered = chosen();
  altered.snapshot.packages[0]!.deliverableSummary = "Changed terms";
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(draft()))
    .mockResolvedValueOnce(response(altered));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  selectAll();
  acknowledge();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve selected terms" }),
  );
  await screen.findByText(/No approval was submitted/);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("link", { name: "Check approval status" }),
  ).toBeNull();
});
it("explains an ineligible variable-only subset before submitting it", async () => {
  const value = draft();
  value.snapshot.packages[0]!.compensationLines =
    value.snapshot.packages[0]!.compensationLines.map((line) => ({
      ...line,
      model: "variable",
      variableUnit: "qualified visit",
    }));
  const fetch = vi.fn().mockResolvedValue(response(value));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: `Select ${value.snapshot.packages[0]!.packageLabel} for approval`,
    }),
  );
  acknowledge();
  expect(
    screen.getByText(
      "Compensated selections need a fixed commitment. An explicitly unpaid internal test can be approved with no compensation.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("allows an explicitly unpaid internal test and retains its reason without inventing a payment", async () => {
  const unpaidDraft = draft();
  const unpaidPackage = unpaidDraft.snapshot.packages[0]!;
  unpaidDraft.snapshot.packages = [unpaidPackage];
  markUnpaid(unpaidPackage);
  const selected = {
    ...unpaidDraft,
    id: selectedId,
    snapshotHash: "selected-unpaid-hash",
    selection: {
      version: 1,
      sourceReviewId: reviewId,
      sourceSnapshotHash: props.snapshotHash,
      packageIds: [unpaidPackage.id],
    },
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(unpaidDraft))
    .mockResolvedValueOnce(response(selected))
    .mockRejectedValueOnce(new Error("response lost"));
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetCommercialApproval {...props} />);
  await open();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: `Select ${unpaidPackage.packageLabel} for approval`,
    }),
  );
  expect(screen.getByText("Unpaid internal test")).toBeVisible();
  expect(
    screen.getByText("Approved internal devnet response proof."),
  ).toBeVisible();
  expect(
    screen.getByText("Unpaid internal test — no creator payment"),
  ).toBeVisible();
  acknowledge();
  expect(
    screen.getByRole("button", { name: "Approve selected terms" }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve selected terms" }),
  );
  await screen.findByText(/Approval status is uncertain/);
  expect(JSON.parse(fetch.mock.calls[1][1].body).action).toBe(
    "selectCommercial",
  );
  expect(JSON.parse(fetch.mock.calls[2][1].body).action).toBe(
    "confirmCommercial",
  );
});

it.each([
  ["fixed paid terms", "eligible"],
  ["variable-only paid terms", "ineligible"],
  ["two paid currencies", "ineligible"],
] as const)("keeps unpaid plus %s %s", async (variant, expected) => {
  const value = draft();
  markUnpaid(value.snapshot.packages[0]!);
  if (variant === "variable-only paid terms") {
    value.snapshot.packages[1]!.compensationLines =
      value.snapshot.packages[1]!.compensationLines.map((line) => ({
        ...line,
        model: "variable",
        variableUnit: "qualified visit",
      }));
  }
  if (variant === "two paid currencies") {
    const additional = structuredClone(value.snapshot.packages[1]!);
    additional.id = "403e1429-07d1-411e-8e19-47f4ca14e442";
    additional.creatorId = "40990000-0000-4000-8000-000000000003";
    additional.packageLabel = "Creator 3";
    additional.compensationLines[0]!.currencyCode = "EUR";
    value.snapshot.packages.push(additional);
  }
  const fetch = vi.fn().mockResolvedValue(response(value));
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetCommercialApproval {...props} />);
  await open();
  selectAll();
  acknowledge();
  const approve = screen.getByRole("button", {
    name: "Approve selected terms",
  });
  if (expected === "eligible") {
    expect(approve).toBeEnabled();
    expect(screen.getAllByText("GBP 3,920.00")).toHaveLength(2);
  } else {
    expect(approve).toBeDisabled();
    expect(
      screen.getByText(
        variant === "two paid currencies"
          ? "The selected creators use more than one currency. Select creators paid in one currency to approve."
          : "Compensated selections need a fixed commitment. An explicitly unpaid internal test can be approved with no compensation.",
      ),
    ).toBeVisible();
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("uses the devnet review actions without accepting destination or rule fields from the browser", async () => {
  const fetch = vi.fn().mockResolvedValue(response(draft()));
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetCommercialApproval {...props} />);
  await open();
  expect(fetch.mock.calls[0][0]).toBe("/api/isolated-devnet-rehearsal");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    action: "prepareCommercial",
    basketId: props.basketId,
    scenarioId: props.scenarioId,
    revision: props.revision,
  });
  expect(screen.getByText(/does not call a provider or wallet/i)).toBeVisible();
});

it("states the effect once, shows the server expiry beside the action and offers a fresh review when expired", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        ...draft(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    )
    .mockResolvedValueOnce(response(draft()));
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCommercialApproval {...props} />);
  await open();
  expect(
    screen.getAllByText(
      "Approving locks the selected terms into the plan. It doesn’t send offers, pay creators or go live.",
    ),
  ).toHaveLength(1);
  await screen.findByText(/This review has expired at/);
  expect(
    screen.queryByRole("button", { name: "Approve selected terms" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Start a fresh review" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body).action).toBe("prepare");
  expect(
    await screen.findByRole("button", { name: "Approve selected terms" }),
  ).toBeDisabled();
  expect(screen.getByText(/^Review valid until /)).toHaveAttribute(
    "title",
    expect.stringMatching(/ UTC$/),
  );
  expect(
    screen.getByRole("checkbox", { name: /I have reviewed/ }),
  ).not.toBeChecked();
});

describe("approved plan continuation", () => {
  const recovered = (campaignId: string | null) =>
    response({
      status: "approved",
      reviewId: selectedId,
      commercialPlanVersionId: "7f52493b-5673-4838-9d1c-d8145793938c",
      snapshotHash: "selected-hash",
      campaignId,
    });

  it("checks status read-only, then creates the campaign only on an explicit click", async () => {
    search.value = `commercialReview=${selectedId}`;
    const campaignId = "8f52493b-5673-4838-9d1c-d8145793938c";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(recovered(null))
      .mockResolvedValueOnce(recovered(campaignId));
    vi.stubGlobal("fetch", fetch);
    render(
      <BrowserCommercialRecovery
        basketId={props.basketId}
        projectId="helios"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Check your approval" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Plan approved" }),
    ).toBeInTheDocument();
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    expect(
      screen.getByText("It didn’t send offers to creators."),
    ).toBeVisible();
    expect(screen.getByText("It didn’t pay anyone.")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    const workspace = await screen.findByRole("link", {
      name: /Open campaign workspace/,
    });
    expect(workspace).toHaveAttribute(
      "href",
      `/projects/helios/campaigns/${campaignId}`,
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      action: "create",
      basketId: props.basketId,
      reviewId: selectedId,
      acknowledged: true,
    });
    expect(
      screen.queryByRole("button", { name: "Create campaign" }),
    ).toBeNull();
  });

  it("is honest when nothing was recorded or the check fails", async () => {
    search.value = `commercialReview=${selectedId}`;
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        response({ status: "not_recorded", reviewId: selectedId }),
      );
    vi.stubGlobal("fetch", fetch);
    render(
      <BrowserCommercialRecovery
        basketId={props.basketId}
        projectId="helios"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    expect(
      await screen.findByText(/We couldn’t check the saved decision/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check approval status" }),
    );
    expect(
      await screen.findByRole("heading", { name: "No approval recorded" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create campaign" }),
    ).toBeNull();
  });
});
