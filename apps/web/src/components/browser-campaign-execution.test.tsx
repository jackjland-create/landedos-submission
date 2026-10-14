import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserCampaignExecution } from "./browser-campaign-execution";

const campaignId = "9aa1d656-4075-4c91-935d-cd2f510fff75";
const jobId = "8aa1d656-4075-4c91-935d-cd2f510fff75";
const reviewId = "7aa1d656-4075-4c91-935d-cd2f510fff75";
const otherId = "6aa1d656-4075-4c91-935d-cd2f510fff75";
const preview = {
  reviewId,
  campaignId,
  candidateCount: 1,
  reviewHash: "a".repeat(64),
  manifestHash: "b".repeat(64),
  expiresAt: "2026-10-05T12:45:00Z",
  reconciliation: {
    jobId,
    rangeStartedAt: "2026-10-05T12:00:00Z",
    rangeEndedAt: "2026-10-05T12:10:00Z",
    completedAt: "2026-10-05T12:15:00Z",
    normalizationIssueCount: 0,
    providerCoverage: "helius_history_exhausted_for_exact_range",
    completeness: "provider_observed_only",
  },
};
const result = {
  reviewId,
  campaignId,
  status: "completed",
  processedCount: 1,
  reconciliationJobId: jobId,
  manifestHash: "b".repeat(64),
  insertedCount: 1,
  providerCoverage: "helius_history_exhausted_for_exact_range",
  completeness: "provider_observed_only",
};
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => {
  window.history.replaceState(null, "", "/?executionJob=" + jobId);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-05T12:30:00Z"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function renderDevnet(canManage = true) {
  render(
    <BrowserCampaignExecution
      campaignId={campaignId}
      canManage={canManage}
      devnetBoundary={{ reconciliationJobId: jobId }}
    />,
  );
}
async function prepare() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Review devnet evidence" }),
  );
}
async function decide() {
  fireEvent.change(
    await screen.findByLabelText("Reason for calculating this evidence"),
    {
      target: { value: "Reviewed exact provider range and coverage limits" },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I reviewed this exact devnet/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approve and calculate evidence" }),
  );
}
it("uses the exact devnet job and preserves separate human calculation and report decisions", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(preview))
    .mockResolvedValueOnce(response(result));
  vi.stubGlobal("fetch", fetch);
  renderDevnet();
  await prepare();
  const confirm = await screen.findByRole("button", {
    name: "Approve and calculate evidence",
  });
  expect(confirm).toBeDisabled();
  expect(screen.queryByRole("link", { name: /prepare report/ })).toBeNull();
  expect(fetch.mock.calls[0][0]).toBe("/api/isolated-devnet-rehearsal");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    action: "prepare",
    campaignId,
    reconciliationJobId: jobId,
  });
  await decide();
  const link = await screen.findByRole("link", {
    name: "Review costs and prepare report",
  });
  expect(link.getAttribute("href")).toContain("executionId=" + reviewId);
  expect(screen.getByRole("status")).toHaveTextContent(
    "not ledger-wide completeness",
  );
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    action: "confirm",
    campaignId,
    reviewId,
    reason: "Reviewed exact provider range and coverage limits",
    acknowledged: true,
  });
  expect(fetch.mock.calls[1][1]).toMatchObject({
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
});
for (const [name, changed] of [
  ["wrong campaign", { ...preview, campaignId: otherId }],
  [
    "wrong job",
    {
      ...preview,
      reconciliation: { ...preview.reconciliation, jobId: otherId },
    },
  ],
  ["expired review", { ...preview, expiresAt: "2026-10-05T12:29:00Z" }],
  [
    "open range",
    {
      ...preview,
      reconciliation: {
        ...preview.reconciliation,
        rangeEndedAt: "2026-10-05T12:40:00Z",
      },
    },
  ],
  [
    "normalization issues",
    {
      ...preview,
      reconciliation: { ...preview.reconciliation, normalizationIssueCount: 1 },
    },
  ],
  [
    "invented completeness",
    {
      ...preview,
      reconciliation: { ...preview.reconciliation, completeness: "complete" },
    },
  ],
  ["synthetic proof marker", { ...preview, simulation: true }],
] as const)
  it(`rejects ${name} before a human confirmation is offered`, async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(changed)));
    renderDevnet();
    await prepare();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Unable to confirm"),
    );
    expect(
      screen.queryByRole("button", { name: "Approve and calculate evidence" }),
    ).toBeNull();
  });
for (const [name, changed] of [
  ["wrong review", { ...result, reviewId: otherId }],
  ["wrong job", { ...result, reconciliationJobId: otherId }],
  ["changed manifest", { ...result, manifestHash: "c".repeat(64) }],
  ["synthetic result", { ...result, simulation: true }],
] as const)
  it(`keeps uncertain ${name} confirmation from opening a report or preparing another execution`, async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(preview))
        .mockResolvedValueOnce(response(changed)),
    );
    renderDevnet();
    await prepare();
    await decide();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Unable to confirm"),
    );
    expect(screen.queryByRole("link", { name: /prepare report/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review devnet evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Check execution status" }),
    ).toBeEnabled();
  });
it("recovers the exact retained review using GET after confirmation is interrupted", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(preview))
    .mockRejectedValueOnce(new Error("Interrupted"))
    .mockResolvedValueOnce(response(result));
  vi.stubGlobal("fetch", fetch);
  renderDevnet();
  await prepare();
  await decide();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Unable to confirm"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check execution status" }),
  );
  await screen.findByRole("link", { name: /prepare report/ });
  expect(fetch.mock.calls[2][0]).toBe(
    `/api/isolated-devnet-rehearsal?action=recover&campaignId=${campaignId}&reviewId=${reviewId}`,
  );
  expect(fetch.mock.calls[2][1].method).toBe("GET");
  expect(fetch.mock.calls[2][1]).not.toHaveProperty("body");
});
it("does not expose approval controls to read-only users", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  renderDevnet(false);
  expect(screen.getByText(/campaign manager must review/)).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps the default synthetic endpoint and disclaimer unchanged", async () => {
  const fetch = vi.fn().mockResolvedValue(
    response({
      reviewId,
      campaignId,
      candidateCount: 1,
      reviewHash: "a".repeat(64),
      expiresAt: preview.expiresAt,
      measurementWindow: {
        startedAt: preview.reconciliation.rangeStartedAt,
        endedAt: preview.reconciliation.rangeEndedAt,
      },
      simulation: true,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<BrowserCampaignExecution campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review simulated evidence" }),
  );
  await screen.findByRole("button", { name: "Approve and calculate evidence" });
  expect(fetch.mock.calls[0][0]).toBe("/api/isolated-campaign-execution");
  expect(screen.getByText(/Historical simulated evidence only/)).toBeVisible();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty(
    "reconciliationJobId",
  );
});
