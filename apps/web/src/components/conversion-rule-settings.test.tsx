import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { ConversionRuleSettings } from "./conversion-rule-settings";

// Existing form/replay tests explicitly enter their separate task surfaces.
function render(ui: Parameters<typeof renderView>[0]) {
  const view = renderView(ui);
  view.container.querySelectorAll("details").forEach((details) => {
    details.open = true;
  });
  const create = screen.queryByRole("button", {
    name: "Create a new success rule version",
  });
  if (create) fireEvent.click(create);
  return view;
}

const rule = {
  id: "a1000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  stableKey: "primary-outcome" as const,
  createdBy: "30000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-12T14:00:00.000Z",
  versions: [
    {
      id: "a2000000-0000-4000-8000-000000000001",
      ruleId: "a1000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000001",
      version: 1,
      templateCode: "first_qualifying_transaction" as const,
      name: "First qualifying transaction",
      description: "Count the first finalized Solana transfer after consent.",
      effectiveFrom: "2026-08-12T14:00:00.000Z",
      effectiveUntil: null,
      chain: "solana" as const,
      requiresWalletBinding: true as const,
      minimumFinality: "finalized" as const,
      valueMapping: "transfer_amount" as const,
      revenueMapping: "none" as const,
      attributionWindowSeconds: 604800 as const,
      attributionModel: "last_eligible_creator_touch" as const,
      programId: null,
      eventDiscriminator: null,
      evidenceCapability: "ready" as const,
      configuredEnvironment: "devnet" as const,
      destinationAddress: "Vote111111111111111111111111111111111111111",
      nativeAmountLamports: "1",
      changeReason: "Create the initial campaign outcome definition",
      createdBy: "30000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-12T14:00:00.000Z",
    },
  ],
};

const replayJob = {
  id: "a4000000-0000-4000-8000-000000000001",
  ruleId: rule.id,
  ruleVersionId: rule.versions[0].id,
  workspaceId: rule.workspaceId,
  projectId: rule.projectId,
  status: "pending" as const,
  affectedCampaignCount: 2,
  eligibleCampaignCount: 2,
  requestedBy: rule.createdBy,
  requestedAt: "2026-08-12T14:00:00.000Z",
  execution: null,
};

const replayResponse = {
  replay: {
    id: "a5000000-0000-4000-8000-000000000001",
    status: "queued" as const,
    approved: true,
    campaignCount: 2,
    sourceStartedAt: "2026-08-12T14:00:00.000Z",
    sourceEndedAt: "2026-08-17T14:00:00.000Z",
  },
};

let cryptoSequence = 0;

describe("conversion rule settings", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.unstubAllGlobals();
  });

  it("starts with a simple overview even when historical jobs exist", () => {
    const view = renderView(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
        replayJobs={[replayJob]}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Create version/ }),
    ).toBeNull();
    expect(
      screen.getByText("Version history (1)").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("Advanced: recalculate past results").closest("details"),
    ).not.toHaveAttribute("open");
    expect(view.container.querySelector("#revenue-boundary")).toHaveTextContent(
      rule.versions[0].description,
    );
    expect(
      screen.getByRole("link", { name: "Choose a rule in a campaign plan" }),
    ).toHaveAttribute("href", "/projects/helios/baskets");
  });

  it("keeps unfinished text when the focused editor closes and reopens", () => {
    renderView(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Create a new success rule version",
    });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Unfinished new name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close rule editor" }));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Name")).toHaveValue("Unfinished new name");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows saving immediately and blocks duplicate submissions and template changes", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why this change"), {
      target: { value: "Test the pending save state" },
    });
    const form = screen.getByLabelText("Name").closest("form")!;
    fireEvent.submit(form);
    expect(
      screen.getByRole("button", { name: "Saving version…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Wallet connected/ }),
    ).toBeDisabled();
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(
      new Response(
        JSON.stringify({ rule: { version: 2, affectedCampaignCount: 0 } }),
        { status: 201 },
      ),
    );
    await screen.findByText(/Version 2 is retained/);
  });

  it("starts from template wording instead of copying a previous custom name and description", () => {
    const custom = {
      ...rule,
      versions: [
        {
          ...rule.versions[0],
          name: "Previous custom name",
          description: "Previous custom description",
        },
      ],
    };
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={custom}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue(
      "First qualifying transaction",
    );
    expect(
      screen.getByLabelText("What it counts, in plain words"),
    ).not.toHaveValue("Previous custom description");
    fireEvent.focus(screen.getByLabelText("Name"));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
    expect(screen.getByText("Previous custom description")).toBeInTheDocument();
  });

  it("opens a plan's creation deep link without changing its query context", () => {
    window.history.replaceState(
      null,
      "",
      "/?plan=fixture&theme=dark#create-rule",
    );
    renderView(
      <ConversionRuleSettings
        affectedCampaignCount={0}
        canManage
        projectId="helios"
        rule={null}
      />,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to success rules" }),
    );
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?plan=fixture&theme=dark");
    window.history.replaceState(null, "", "/");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes when history removes the creation hash and preserves entered text", () => {
    renderView(
      <ConversionRuleSettings
        affectedCampaignCount={0}
        canManage
        projectId="helios"
        rule={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create a new success rule version" }),
    );
    expect(window.location.hash).toBe("#create-rule");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Keep this draft" },
    });
    window.history.replaceState(null, "", "/");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Create a new success rule version" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Keep this draft");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cryptoSequence = 0;
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
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => cryptoId()) });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              rule: {
                version: 2,
                created: true,
                affectedCampaignCount: 2,
              },
            }),
            { status: 201 },
          ),
      ),
    );
  });

  it("shows the active definition, all three templates and immutable impact", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /· version 1$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Success rules")).toBeInTheDocument();
    expect(
      screen.getByText("Not counted by this rule").closest("section"),
    ).toHaveAttribute("id", "revenue-boundary");
    expect(
      screen.getAllByText("First qualifying transaction").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Wallet connected")).toBeInTheDocument();
    expect(screen.getByText("Customer programme action")).toBeInTheDocument();
    expect(
      screen.getByText("Issued reports remain unchanged."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revenue stays separate and unmapped."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 existing campaigns in project scope."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/12 Aug 2026, 14:00 UTC/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("Approved devnet receiver")).toHaveValue(
      "Vote111111111111111111111111111111111111111",
    );
    expect(screen.getByText("devnet")).toBeInTheDocument();
    expect(screen.getByText("1 lamport")).toBeInTheDocument();
  });

  it("reveals programme evidence requirements without claiming readiness", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /customer programme action/i }),
    );
    expect(screen.getByLabelText("Programme address")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue(
      "Customer programme action",
    );
    expect(
      screen.getByText(/matching remains unavailable/i),
    ).toBeInTheDocument();
  });

  it("returns to the plan it came from without changing that plan", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
        planContext={{
          name: "Fixture plan",
          href: "/projects/helios/baskets/b?step=measurement",
          versionId: rule.versions[0]!.id,
        }}
      />,
    );
    const bar = screen.getByRole("region", { name: "Where you came from" });
    expect(bar).toHaveTextContent(
      "You came from Fixture plan. Nothing here changes that plan.",
    );
    expect(
      within(bar).getByRole("link", { name: /Back to plan/ }),
    ).toHaveAttribute("href", "/projects/helios/baskets/b?step=measurement");
    expect(screen.getByText("Fixture plan uses this")).toBeInTheDocument();
    expect(
      screen.getByText(/It doesn’t change any plan’s saved choice/),
    ).toBeInTheDocument();
  });

  it("keeps analysts read-only", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage={false}
        projectId="helios"
        rule={rule}
      />,
    );
    expect(screen.getByText("Read only.")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create a new success rule version" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Create version \d+$/ }),
    ).toBeNull();
  });

  it("creates the next version through the protected route", async () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
        planContext={{
          name: "Fixture plan",
          href: "/projects/helios/baskets/b?step=measurement&theme=dark",
        }}
      />,
    );
    const createHeading = screen.getByRole("heading", {
      name: "Create a new success rule version",
    });
    expect(createHeading.closest("dialog")).toHaveAttribute(
      "id",
      "create-rule",
    );
    expect(
      screen.getByRole("button", { name: "Create a new success rule version" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Version 2 · available across this project/),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Return to plan and choose a rule" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Why this change"), {
      target: { value: "Refine the project outcome for the next campaign" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Create version \d+$/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Version 2 is retained. 2 campaigns have a pending replay request.",
        ),
      ).toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Return to plan and choose a rule" }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/baskets/b?step=measurement&theme=dark",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/helios/conversion-rules",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retries an uncertain save with the same idempotency identity", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rule: {
              version: 2,
              created: false,
              affectedCampaignCount: 2,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why this change"), {
      target: { value: "Safely reconcile the uncertain save outcome" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Create version \d+$/ }),
    );
    await screen.findByText(/save outcome is not yet known/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the same request" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [first, second] = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(second.ruleVersionId).toBe(first.ruleVersionId);
    expect(second.changeRequestId).toBe(first.changeRequestId);
  });

  it("shows decoder-required current evidence without verified tone", () => {
    const programmeRule = {
      ...rule,
      versions: [
        {
          ...rule.versions[0],
          templateCode: "programme_action" as const,
          programId: "11111111111111111111111111111111",
          eventDiscriminator: "deposit_completed",
          valueMapping: "none" as const,
          evidenceCapability: "requires_programme_decoder" as const,
          configuredEnvironment: null,
          destinationAddress: null,
          nativeAmountLamports: null,
        },
      ],
    };
    render(
      <ConversionRuleSettings
        affectedCampaignCount={1}
        canManage
        projectId="helios"
        rule={programmeRule}
      />,
    );
    expect(screen.getByText("Programme decoder required")).toBeInTheDocument();
    const latest = screen.getByRole("region", { name: /· version 1$/ });
    expect(within(latest).queryByText("Ready for evaluation")).toBeNull();
  });

  it("preserves the complete first-use request identity after uncertainty", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rule: {
              version: 1,
              created: false,
              affectedCampaignCount: 0,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConversionRuleSettings
        affectedCampaignCount={0}
        canManage
        projectId="helios"
        rule={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why this change"), {
      target: { value: "Create the first project conversion definition" },
    });
    fireEvent.change(screen.getByLabelText("Approved devnet receiver"), {
      target: { value: "Vote111111111111111111111111111111111111111" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Create version \d+$/ }),
    );
    await screen.findByText(/save outcome is not yet known/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the same request" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [first, second] = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(second).toEqual(first);
  });

  it("does not offer uncertain retry for a definitive HTTP rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: "Retained evidence conflicts." }),
            { status: 409 },
          ),
      ),
    );
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        rule={rule}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why this change"), {
      target: { value: "Test a definitive retained evidence response" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Create version \d+$/ }),
    );
    await screen.findByText("Retained evidence conflicts.");
    expect(
      screen.queryByRole("button", { name: /retry the same/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Create version \d+$/ }),
    ).toBeEnabled();
  });

  it("requires human approval before queueing reviewed historical replay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(replayResponse), { status: 202 }),
      ),
    );
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[replayJob]}
        rule={rule}
      />,
    );

    expect(screen.getByText("Approval required")).toBeInTheDocument();
    expect(screen.getByText(/prior reports never change/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "Approve historical comparison for campaign review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and queue replay" }),
    );

    await screen.findByText(
      "Replay queued for 2 campaigns. Existing reports remain unchanged.",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/helios/conversion-replays",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requires an issued baseline before offering replay approval", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[{ ...replayJob, eligibleCampaignCount: 0 }]}
        rule={rule}
      />,
    );

    expect(screen.getByText("Baseline required")).toBeInTheDocument();
    expect(
      screen.getByText(/issue a baseline report first/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve and queue replay" }),
    ).toBeNull();
  });

  it("shows queued replay counts as unknown rather than zero", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[
          {
            ...replayJob,
            execution: {
              id: "a5000000-0000-4000-8000-000000000001",
              status: "queued",
              approvedAt: "2026-08-13T14:00:00.000Z",
              sourceStartedAt: "2026-08-12T14:00:00.000Z",
              sourceEndedAt: "2026-08-13T14:00:00.000Z",
              candidateCount: 0,
              matchedCount: 0,
              unmatchedCount: 0,
              reportCount: 0,
              failureCode: null,
              comparisons: [],
            },
          },
        ]}
        rule={rule}
      />,
    );

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getAllByText("Not measured yet")).toHaveLength(2);
    expect(screen.getByText("Not issued yet")).toBeInTheDocument();
  });

  it("retries an uncertain replay with the complete retained approval", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            replay: { ...replayResponse.replay, approved: false },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[replayJob]}
        rule={rule}
      />,
    );
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "Safely reconcile the replay approval outcome" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and queue replay" }),
    );
    await screen.findByText(/approval outcome is not known/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the same approval" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [first, second] = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(second).toEqual(first);
  });

  it("blocks every replay approval while one retained request is in flight", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[
          replayJob,
          {
            ...replayJob,
            id: "a4000000-0000-4000-8000-000000000002",
            requestedAt: "2026-08-13T14:00:00.000Z",
          },
        ]}
        rule={rule}
      />,
    );
    const reasons = screen.getAllByLabelText("Approval reason");
    fireEvent.change(reasons[0]!, {
      target: { value: "Approve the first retained comparison request" },
    });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Approve and queue replay",
      })[0]!,
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: /replay/i })
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /replay/i })[1]!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest?.(
      new Response(JSON.stringify(replayResponse), { status: 202 }),
    );
    await screen.findByText(/replay queued for 2 campaigns/i);
  });

  it("does not turn a malformed replay response into zero campaigns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ replay: {} }), { status: 202 }),
      ),
    );
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[replayJob]}
        rule={rule}
      />,
    );
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "Verify malformed retained response handling" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and queue replay" }),
    );
    expect(
      await screen.findByText(/retained status could not be verified/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/queued for 0 campaigns/i)).toBeNull();
  });

  it("shows retained failure evidence and opens the completed comparison", () => {
    render(
      <ConversionRuleSettings
        affectedCampaignCount={2}
        canManage
        projectId="helios"
        replayJobs={[
          {
            ...replayJob,
            execution: {
              id: "a5000000-0000-4000-8000-000000000001",
              status: "completed",
              approvedAt: "2026-08-13T14:00:00.000Z",
              sourceStartedAt: "2026-08-12T14:00:00.000Z",
              sourceEndedAt: "2026-08-13T14:00:00.000Z",
              candidateCount: 1,
              matchedCount: 1,
              unmatchedCount: 0,
              reportCount: 2,
              failureCode: null,
              comparisons: [
                {
                  campaignId: "30000000-0000-4000-8000-000000000001",
                  campaignName: "Helios launch",
                  status: "completed",
                  baselineVersion: 1,
                  reportId: "d2000000-0000-4000-8000-000000000001",
                  replayVersion: 2,
                },
                {
                  campaignId: "30000000-0000-4000-8000-000000000002",
                  campaignName: "Nova launch",
                  status: "completed",
                  baselineVersion: 1,
                  reportId: "d2000000-0000-4000-8000-000000000002",
                  replayVersion: 2,
                },
              ],
            },
          },
          {
            ...replayJob,
            id: "a4000000-0000-4000-8000-000000000002",
            execution: {
              id: "a5000000-0000-4000-8000-000000000002",
              status: "failed",
              approvedAt: "2026-08-14T14:00:00.000Z",
              sourceStartedAt: "2026-08-12T14:00:00.000Z",
              sourceEndedAt: "2026-08-14T14:00:00.000Z",
              candidateCount: 0,
              matchedCount: 0,
              unmatchedCount: 0,
              reportCount: 0,
              failureCode: "job_retries_exhausted",
              comparisons: [],
            },
          },
        ]}
        rule={rule}
      />,
    );
    expect(
      screen.getByRole("link", {
        name: "Helios launch · compare version 1 with 2",
      }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/reports/d2000000-0000-4000-8000-000000000001?version=2",
    );
    expect(
      screen.getByRole("link", {
        name: "Nova launch · compare version 1 with 2",
      }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/reports/d2000000-0000-4000-8000-000000000002?version=2",
    );
    expect(screen.getByText("Replay stopped.")).toBeInTheDocument();
    expect(screen.getByText("job_retries_exhausted")).toBeInTheDocument();
  });
});

function cryptoId() {
  cryptoSequence += 1;
  return `a9000000-0000-4000-8000-${String(cryptoSequence).padStart(12, "0")}`;
}
