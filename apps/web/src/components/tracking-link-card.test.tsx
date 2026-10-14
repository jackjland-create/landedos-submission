import type { TrackedLinkRecord } from "@landed/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workspaceFixture } from "@/lib/campaign-workspace.fixture";
import { TrackedLinkWorkflow } from "./tracked-link-workflow";
import { TrackingLinkCard } from "./tracking-link-card";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const asset = workspaceFixture.contentAssets[0];
const link: TrackedLinkRecord = {
  id: "d1000000-0000-4000-8000-000000000001",
  generationRequestId: "d2000000-0000-4000-8000-000000000001",
  destinationUrl: "https://example.test/start",
  destinationPolicyActive: true,
  keyVersion: 1,
  expiresAt: "2026-12-01T12:00:00Z",
  issuedBy: workspaceFixture.createdBy,
  issuedAt: "2026-10-09T12:00:00Z",
  revocation: null,
  clickEvidence: {
    totalAttempts: 0,
    eligibleRedirects: 0,
    ineligibleAttempts: 0,
    firstObservedAt: null,
    lastObservedAt: null,
  },
  clickQuality: {
    ruleVersion: null,
    duplicateWindowSeconds: null,
    qualifiedClicks: 0,
    duplicateClicks: 0,
    rejectedClicks: 0,
    totalAssessed: 0,
    pendingAssessment: 0,
    firstAssessedAt: null,
    lastAssessedAt: null,
  },
  anonymousSessions: {
    sessions: 0,
    boundClicks: 0,
    firstCreatedAt: null,
    lastSeenAt: null,
  },
};
const props = {
  asset,
  canManage: true,
  campaignId: workspaceFixture.id,
  projectId: workspaceFixture.projectId,
  campaignStatus: "approved" as const,
  signingReady: true,
  signedUrl: null,
  snapshotAt: "2026-10-09T13:00:00Z",
  presentation: "card" as const,
  creatorName: "Maya",
  theme: "light" as const,
};
const linked = { ...asset, trackedLinks: [link] };
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
function create() {
  fireEvent.click(screen.getByRole("button", { name: "Create tracking link" }));
}
function submit() {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create tracking link",
    }),
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText("Where should people go?"), {
    target: { value: "https://example.test/start" },
  });
}

it("shows the creator and direct setup action, with inputs only in a labelled modal", () => {
  render(<TrackedLinkWorkflow {...props} />);
  expect(screen.getByRole("heading", { name: "Maya" })).toBeVisible();
  expect(screen.getByText("Not created")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  create();
  expect(
    screen.getByRole("dialog", { name: "Create tracking link" }),
  ).toHaveAttribute("data-mode", "setup");
  expect(
    screen.getByRole("heading", { name: "Create tracking link" }),
  ).toHaveFocus();
  expect(screen.getByLabelText("Where should people go?")).toBeRequired();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Back to tracking" }));
  expect(
    screen.getByRole("button", { name: "Create tracking link" }),
  ).toHaveFocus();
  create();
  expect(screen.getByLabelText("Where should people go?")).toHaveValue(
    "https://example.test/start",
  );
});

it("requires a destination, retains errors and reuses retry identity before successful refresh", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TrackedLinkWorkflow {...props} />);
  create();
  submit();
  expect(fetchMock).not.toHaveBeenCalled();
  fill();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  submit();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(first).toMatchObject({
    action: "issue",
    destinationUrl: "https://example.test/start",
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(
    first.requestId,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  create();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("explains the marketer handoff without treating a social post as the destination or claiming connected measurement", () => {
  render(
    <TrackedLinkWorkflow
      {...props}
      asset={{
        ...asset,
        publishedUrl: "https://social.example/post",
        submissionUrl: "https://social.example/draft",
      }}
    />,
  );
  create();
  const destination = screen.getByLabelText("Where should people go?");
  expect(destination).toHaveValue("");
  expect(destination).toHaveAccessibleDescription(
    /campaign landing page, sign-up page or app page/,
  );
  expect(
    screen.getByText(/Landed will generate a tracking link/),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "What this link measures" }),
  ).toHaveTextContent("Creating a link does not verify that setup.");
  expect(
    screen.getByText(/Nothing is sent or activated automatically/),
  ).toBeVisible();
});

it("keeps expiry adjustable under Advanced and reveals an invalid expiry before submission", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<TrackedLinkWorkflow {...props} />);
  create();
  fill();
  const advanced = screen
    .getByText("Advanced · link expiry")
    .closest("details")!;
  expect(advanced.open).toBe(false);
  expect(screen.getByText(/Link stops working:/)).toBeVisible();
  advanced.open = true;
  fireEvent.change(screen.getByLabelText(/Link expiry/), {
    target: { value: "" },
  });
  advanced.open = false;
  submit();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(advanced.open).toBe(true);
  expect(screen.getByLabelText(/Link expiry/)).toBeInvalid();
});

it("keeps pending setup open and prevents duplicate requests", async () => {
  let resolve!: (value: unknown) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<TrackedLinkWorkflow {...props} />);
  create();
  fill();
  submit();
  expect(screen.getByRole("button", { name: "Close tracking" })).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.submit(
    screen.getByLabelText("Where should people go?").closest("form")!,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
  resolve({
    ok: false,
    json: async () => ({ message: "Host is not allowed." }),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Host is not allowed.",
  );
});

it("copies only a current permitted URL and separates evidence from editing", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(
    <TrackedLinkWorkflow
      {...props}
      asset={linked}
      signedUrl="https://example.test/t/signed"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("https://example.test/t/signed"),
  );
  expect(await screen.findByText("Link copied.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
  expect(
    screen.getByRole("dialog", { name: "Tracking evidence" }),
  ).toHaveAttribute("data-mode", "evidence");
  expect(screen.queryByLabelText("Revocation reason")).toBeNull();
  expect(screen.getByText(/Unassessed clicks remain unknown/)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Anonymous sessions · key v1" }),
  ).toBeVisible();
});

it.each([
  { restricted: true, asset: linked, signedUrl: "https://example.test/secret" },
  {
    asset: {
      ...asset,
      trackedLinks: [{ ...link, expiresAt: "2026-01-01T00:00:00Z" }],
    },
    signedUrl: "https://example.test/secret",
  },
  {
    asset: {
      ...asset,
      trackedLinks: [{ ...link, destinationPolicyActive: false }],
    },
    signedUrl: "https://example.test/secret",
  },
  { asset: linked, signedUrl: null },
])("never renders/copies unavailable URL: $restricted", (overrides) => {
  render(<TrackedLinkWorkflow {...props} {...overrides} />);
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  expect(document.body.innerHTML).not.toContain("https://example.test/secret");
  fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
  expect(screen.queryByLabelText("Public tracking URL")).toBeNull();
});

it.each([
  { canManage: false },
  { signingReady: false },
  { campaignStatus: "finalized" as const },
  { restricted: true },
])("preserves issuance gates: %o", (overrides) => {
  render(<TrackedLinkWorkflow {...props} {...overrides} />);
  expect(
    screen.queryByRole("button", { name: "Create tracking link" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
  expect(screen.queryByLabelText("Where should people go?")).toBeNull();
  expect(screen.getByText("No tracking history recorded yet.")).toBeVisible();
});

it("requires explicit revocation confirmation and preserves evidence after revocation", async () => {
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  const { rerender } = render(
    <TrackedLinkWorkflow
      {...props}
      asset={linked}
      signingReady={false}
      signedUrl="https://example.test/t/signed"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage link" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ method: "PATCH" }),
  );
  rerender(<TrackedLinkWorkflow {...props} signingReady={false} />);
  // A later close remains safe even when server refresh removed the former trigger.
  fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Close tracking" }));
  expect(screen.getByRole("button", { name: "View evidence" })).toHaveFocus();
});

it("restores focus to evidence when a completed save removes the Manage action", () => {
  const cardProps = {
    asset: linked,
    creatorName: "Maya",
    theme: "light" as const,
    snapshotAt: props.snapshotAt,
    currentLink: link,
    isExpired: false,
    isVerifiable: false,
    restricted: false,
    canIssue: false,
    canRevoke: true,
    signedUrl: null,
    unavailable: null,
    busy: false,
    error: null,
    savedRevision: 0,
    editor: <p>Revoke form</p>,
    evidence: <p>Retained evidence</p>,
  };
  const { rerender } = render(<TrackingLinkCard {...cardProps} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage link" }));
  rerender(<TrackingLinkCard {...cardProps} busy />);
  rerender(
    <TrackingLinkCard
      {...cardProps}
      currentLink={null}
      canRevoke={false}
      savedRevision={1}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage link" })).toBeNull();
  expect(screen.getByRole("button", { name: "View evidence" })).toHaveFocus();
});
