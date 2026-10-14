import type { CampaignRecord } from "@landed/contracts";
import { captureHandoff } from "@/test/capture-handoff";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () =>
    "/projects/helios/campaigns/a1000000-0000-4000-8000-000000000001",
  useSearchParams: () => new URLSearchParams("theme=dark&view=content"),
}));

import {
  CampaignWorkspace,
  CampaignWorkspacePermission,
} from "./campaign-workspace";

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
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

const campaign: CampaignRecord = {
  id: "a1000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  basketId: "90000000-0000-4000-8000-000000000001",
  commercialPlanVersionId: "a2000000-0000-4000-8000-000000000001",
  commercialPlanVersion: 1,
  name: "Helios roster",
  objective: "Increase qualified wallets",
  outcomeProfile: {
    baselineUnits: "50",
    currencyCode: null,
    metric: "qualified_wallets",
    targetUnits: "150",
  },
  status: "approved",
  createdBy: "30000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-05T12:00:00.000Z",
  updatedAt: "2026-08-05T12:00:00.000Z",
  roster: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      creatorId: "40000000-0000-4000-8000-000000000001",
      creatorName: "Maya / Chain Mode",
      creatorHandle: "@chainmode",
      sourcePackageId: "81000000-0000-4000-8000-000000000001",
      rosterPosition: 1,
      packageLabel: "Launch package",
      deliverableSummary: "One launch thread",
      commercialTerms: {
        id: "81000000-0000-4000-8000-000000000001",
        creatorId: "40000000-0000-4000-8000-000000000001",
        packageLabel: "Launch package",
        deliverableSummary: "One launch thread",
        sourceRateQuoteId: null,
        compensationLines: [
          {
            id: "a4000000-0000-4000-8000-000000000001",
            assetType: "cash",
            model: "fixed",
            amountMinor: "460000",
            currencyCode: "GBP",
          },
        ],
      },
      termsHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      createdAt: "2026-08-05T12:00:00.000Z",
    },
  ],
  briefVersions: [
    {
      id: "a8000000-0000-4000-8000-000000000001",
      version: 1,
      requestId: "a9000000-0000-4000-8000-000000000001",
      status: "approved",
      objective: "Increase qualified wallets",
      audience: null,
      keyMessage: null,
      creatorDirection: null,
      complianceNotes: null,
      reason: "Brief approved by campaign manager",
      actorUserId: "30000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-05T12:00:00.000Z",
    },
  ],
  contentAssets: [
    {
      id: "a5000000-0000-4000-8000-000000000001",
      campaignCreatorId: "a3000000-0000-4000-8000-000000000001",
      creatorId: "40000000-0000-4000-8000-000000000001",
      assetIndex: 1,
      label: "One launch thread",
      status: "planned",
      submissionUrl: null,
      publishedUrl: null,
      createdAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:00:00.000Z",
      publicationEvidence: [],
      trackedLinks: [],
      activity: [
        {
          id: "aa000000-0000-4000-8000-000000000001",
          requestId: "ab000000-0000-4000-8000-000000000001",
          actorUserId: "30000000-0000-4000-8000-000000000001",
          fromStatus: null,
          toStatus: "planned",
          evidenceUrl: null,
          note: "Initial content commitment materialized",
          createdAt: "2026-08-05T12:00:00.000Z",
        },
      ],
    },
  ],
  activity: [
    {
      id: "a7000000-0000-4000-8000-000000000001",
      transitionRequestId: "a6000000-0000-4000-8000-000000000001",
      actorUserId: "30000000-0000-4000-8000-000000000001",
      fromStatus: "draft",
      toStatus: "approved",
      reason: "Commercial plan approved",
      createdAt: "2026-08-05T12:00:00.000Z",
    },
  ],
};

const noClickEvidence = {
  eligibleRedirects: 0,
  ineligibleAttempts: 0,
  totalAttempts: 0,
  firstObservedAt: null,
  lastObservedAt: null,
};

const noClickQuality = {
  ruleVersion: null,
  duplicateWindowSeconds: null,
  qualifiedClicks: 0,
  duplicateClicks: 0,
  rejectedClicks: 0,
  totalAssessed: 0,
  pendingAssessment: 0,
  firstAssessedAt: null,
  lastAssessedAt: null,
};

const noAnonymousSessions = {
  sessions: 0,
  boundClicks: 0,
  firstCreatedAt: null,
  lastSeenAt: null,
};

function openFoldout(label: "ISSUE TRACKED LINK" | "MANAGE TRACKED LINK") {
  const summary = screen.getByText(label);
  const details = summary.closest("details");

  if (!details?.hasAttribute("open")) fireEvent.click(summary);
}

describe("campaign workspace", () => {
  it("opens Tracking for an input that is not mounted in Content", () => {
    const { rerender } = render(
      <CampaignWorkspace campaign={campaign} canManage section="content" />,
    );
    expect(
      document.getElementById(`tracking-${campaign.contentAssets[0].id}`),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "RESOLVE FIRST ASSET" }),
    ).toHaveAttribute(
      "href",
      `/projects/helios/campaigns/${campaign.id}?theme=dark&view=tracking#tracking-${campaign.contentAssets[0].id}`,
    );
    rerender(
      <CampaignWorkspace campaign={campaign} canManage section="tracking" />,
    );
    expect(
      document.getElementById(`tracking-${campaign.contentAssets[0].id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tracking links" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "OPEN INPUT" })).toBeNull();
  });

  it("keeps delivery editing in Delivery rather than duplicating it in Tracking", () => {
    const trackedLinkId = "d1000000-0000-4000-8000-000000000001";
    render(
      <CampaignWorkspace
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000001",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 3,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-10T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        canManage
        section="tracking"
        signedLinkUrls={{
          [trackedLinkId]: "https://landed.example.test/t/fixture",
        }}
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );
    expect(
      document.getElementById(`deliverable-${campaign.contentAssets[0].id}`),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Manage link" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "OPEN INPUT" })).toBeNull();
    cleanup();
    render(
      <CampaignWorkspace campaign={campaign} canManage section="content" />,
    );
    expect(
      document.getElementById(`deliverable-${campaign.contentAssets[0].id}`),
    ).toBeInTheDocument();
  });

  it("keeps cross-view navigation read-only and hides it for restricted tracking", () => {
    const { rerender } = render(
      <CampaignWorkspace
        campaign={campaign}
        canManage={false}
        section="content"
      />,
    );
    expect(
      screen.getByRole("link", { name: "RESOLVE FIRST ASSET" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("view=tracking#tracking-"),
    );
    expect(
      screen.queryByRole("button", { name: /start deliverable/i }),
    ).not.toBeInTheDocument();
    rerender(
      <CampaignWorkspace
        campaign={campaign}
        canManage={false}
        section="tracking"
        trackingRestricted
      />,
    );
    expect(
      screen.queryByRole("link", { name: "RESOLVE FIRST ASSET" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "OPEN INPUT" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByText(/Live tracking is not enabled/)
        .some((node) => node.closest("dialog") === null),
    ).toBe(true);
  });

  it("does not advertise an asset input when a split view has no assets", () => {
    render(
      <CampaignWorkspace
        campaign={{ ...campaign, contentAssets: [] }}
        canManage
        section="content"
      />,
    );
    expect(screen.getByText("No content assets are planned.")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "RESOLVE FIRST ASSET" }),
    ).not.toBeInTheDocument();
  });

  it("makes brief approval the next decision before tracking", () => {
    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          briefVersions: [
            {
              ...campaign.briefVersions[0]!,
              id: "a8000000-0000-4000-8000-000000000002",
              requestId: "a9000000-0000-4000-8000-000000000002",
              status: "draft",
              version: 2,
            },
            ...campaign.briefVersions,
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Campaign brief v2 is draft." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "COMPLETE BRIEF" }),
    ).toHaveAttribute("href", "#campaign-brief");
    expect(screen.getByText("View 2 retained brief versions")).toBeVisible();
  });

  it("makes the approved-state decision and tracking boundary explicit", () => {
    render(<CampaignWorkspace campaign={campaign} canManage />);

    expect(screen.getByText("Helios roster")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "1 of 1 content asset still needs verifiable tracking.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Issue the missing links before this campaign can move live.",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("Maya / Chain Mode")).toHaveLength(2);
    expect(screen.getByText("£4,600")).toBeVisible();
    expect(screen.getByText("TERMS LOCKED")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "OPEN SOURCE BASKET" }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/baskets/90000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("6 PHASES")).toBeVisible();
    expect(screen.getByText("Commercial plan approved")).toBeVisible();
    expect(screen.getByText("05 Aug, 12:00 UTC")).toBeInTheDocument();
    expect(screen.getAllByText("NO EVIDENCE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NOT DEFINED").length).toBeGreaterThan(0);
    expect(screen.getByText("NOT SET")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "ISSUE TRACKING" }),
    ).toHaveAttribute("href", "#content-assets");
    expect(screen.getByText("1 ASSET NEEDS INPUT")).toBeVisible();
    expect(screen.getByText("Issue the attribution link")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "RESOLVE FIRST ASSET" }),
    ).toHaveAttribute("href", "#tracking-a5000000-0000-4000-8000-000000000001");
    expect(
      screen.getByText("ISSUE TRACKED LINK").closest("details"),
    ).toHaveAttribute("open");
    expect(screen.getByText("ISSUE TRACKED LINK")).toBeVisible();
  });

  it("changes the primary action and outstanding decision with state", () => {
    const { rerender } = render(
      <CampaignWorkspace
        campaign={{ ...campaign, status: "draft" }}
        canManage
      />,
    );

    expect(
      screen.getByRole("link", { name: "REQUEST APPROVAL" }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/baskets/90000000-0000-4000-8000-000000000001",
    );

    rerender(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          status: "live",
          contentAssets: [
            { ...campaign.contentAssets[0], status: "submitted" },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Review One launch thread." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "REVIEW DELIVERABLE" }),
    ).toHaveAttribute("href", "#content-assets");

    rerender(
      <CampaignWorkspace
        campaign={{ ...campaign, status: "finalizing" }}
        canManage
      />,
    );

    expect(screen.getByRole("link", { name: "REVIEW DATA" })).toHaveAttribute(
      "href",
      "#campaign-activity",
    );

    rerender(
      <CampaignWorkspace
        campaign={{ ...campaign, status: "finalized" }}
        canManage
      />,
    );

    expect(screen.getByRole("link", { name: "OPEN REPORT" })).toHaveAttribute(
      "href",
      "/projects/helios/reports",
    );
  });

  it("keeps unequal approved creator amounts attached to their own roster entries across versions", () => {
    const first = campaign.roster[0]!;
    const second = {
      ...first,
      id: "a3000000-0000-4000-8000-000000000002",
      creatorId: "40000000-0000-4000-8000-000000000002",
      creatorName: "DeFi After Dark",
      sourcePackageId: "81000000-0000-4000-8000-000000000002",
      rosterPosition: 2,
      deliverableSummary: "One founder interview",
      commercialTerms: {
        ...first.commercialTerms,
        id: "81000000-0000-4000-8000-000000000002",
        creatorId: "40000000-0000-4000-8000-000000000002",
        deliverableSummary: "One founder interview",
        compensationLines: [
          {
            id: "a4000000-0000-4000-8000-000000000002",
            assetType: "cash" as const,
            model: "fixed" as const,
            amountMinor: "725050",
            currencyCode: "GBP" as const,
          },
        ],
      },
    };
    const { container, rerender } = render(
      <CampaignWorkspace
        campaign={{ ...campaign, roster: [first, second] }}
        canManage={false}
      />,
    );
    const rows = () => [...container.querySelectorAll(".campaign-roster-row")];
    expect(rows()[0]).toHaveTextContent("£4,600");
    expect(rows()[0]).not.toHaveTextContent("£7,250.5");
    expect(rows()[1]).toHaveTextContent("DeFi After Dark");
    expect(rows()[1]).toHaveTextContent("£7,250.5");
    captureHandoff("campaign-unequal-terms", "campaigns");
    const updated = {
      ...first,
      commercialTerms: {
        ...first.commercialTerms,
        compensationLines: [
          {
            ...first.commercialTerms.compensationLines[0]!,
            amountMinor: "510000",
          },
        ],
      },
    };
    rerender(
      <CampaignWorkspace
        campaign={{
          ...campaign,
          id: "a1000000-0000-4000-8000-000000000002",
          commercialPlanVersion: 2,
          commercialPlanVersionId: "a2000000-0000-4000-8000-000000000002",
          roster: [updated, second],
        }}
        canManage={false}
      />,
    );
    expect(rows()[0]).toHaveTextContent("£5,100");
    expect(rows()[1]).toHaveTextContent("£7,250.5");
    expect(first.commercialTerms.compensationLines[0]).toMatchObject({
      amountMinor: "460000",
    });
  });

  it("keeps empty operational evidence explicit", () => {
    render(
      <CampaignWorkspace
        campaign={{ ...campaign, activity: [], contentAssets: [] }}
        canManage
      />,
    );

    expect(screen.getByText("No content assets are planned.")).toBeVisible();
    expect(
      screen.getByText("No state transition has been recorded yet."),
    ).toBeVisible();
    expect(
      screen.queryByText(/Clicks remain unknown, not zero/),
    ).not.toBeInTheDocument();
  });

  it("numbers deliverables in workspace order when source indices restart per creator", () => {
    const secondRosterEntry = {
      ...campaign.roster[0]!,
      id: "a3000000-0000-4000-8000-000000000002",
      creatorId: "40000000-0000-4000-8000-000000000002",
      creatorName: "Mint Condition",
      creatorHandle: "@mintcondition",
      rosterPosition: 2,
    };
    const secondAsset = {
      ...campaign.contentAssets[0]!,
      id: "a5000000-0000-4000-8000-000000000002",
      campaignCreatorId: secondRosterEntry.id,
      creatorId: secondRosterEntry.creatorId,
      assetIndex: 1,
      label: "One follow-up thread",
    };

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          roster: [...campaign.roster, secondRosterEntry],
          contentAssets: [...campaign.contentAssets, secondAsset],
        }}
      />,
    );

    const deliverables = screen
      .getByRole("heading", {
        name: "Deliverables and distribution evidence",
      })
      .closest("section");

    expect(deliverables).not.toBeNull();
    expect(within(deliverables!).getByText("01")).toBeVisible();
    expect(within(deliverables!).getByText("02")).toBeVisible();
    expect(
      within(deliverables!).getByText("2 ASSETS NEED INPUT"),
    ).toBeVisible();
    expect(deliverables!.querySelectorAll("details[open]")).toHaveLength(1);
  });

  it("renders campaign workflows as explicit read-only evidence for analysts", () => {
    render(
      <CampaignWorkspace
        campaign={{
          ...campaign,
          briefVersions: [
            {
              ...campaign.briefVersions[0]!,
              status: "draft",
            },
          ],
        }}
        canManage={false}
      />,
    );

    expect(
      screen.getByText(
        "Campaign manager access is required to change the brief. Immutable versions remain available below.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Campaign manager access is required to change deliverable state.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Edit brief")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit brief" })).toBeNull();
    expect(screen.queryByText("UPDATE DELIVERABLE")).not.toBeInTheDocument();
    expect(screen.getByText("VIEW AUDIT HISTORY")).toBeVisible();
  });

  it("blocks duplicate brief requests and reuses the request identity after a network failure", async () => {
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      )
      .mockResolvedValueOnce({
        json: async () => ({ message: "Temporary failure" }),
        ok: false,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          briefVersions: [
            {
              ...campaign.briefVersions[0]!,
              audience: "Solana users",
              creatorDirection: "Explain the product journey plainly",
              keyMessage: "Verified saving progress",
              status: "draft",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByText("Edit brief"));
    const saveButton = screen.getByRole("button", {
      name: "Save new version",
    });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    rejectRequest?.(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Campaign brief could not be changed. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { requestId: string };
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { requestId: string };
    expect(retryBody.requestId).toBe(firstBody.requestId);
  });

  it("surfaces a recoverable deliverable network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<CampaignWorkspace campaign={campaign} canManage />);

    fireEvent.click(screen.getByText("UPDATE DELIVERABLE"));
    fireEvent.click(
      screen.getByRole("button", { name: "RECORD STATE CHANGE" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Deliverable state could not be changed. Try again.",
    );
  });

  it("issues tracking with a stable retry identity after a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        json: async () => ({ trackedLink: { id: "created" } }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CampaignWorkspace
        campaign={campaign}
        canManage
        signingReady
        trackingSnapshotAt="2026-08-10T12:00:00.000Z"
      />,
    );

    openFoldout("ISSUE TRACKED LINK");
    fireEvent.change(screen.getByLabelText("HTTPS destination"), {
      target: { value: "https://helios.example.test/start" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ISSUE SIGNED LINK" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tracked link could not be issued. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "ISSUE SIGNED LINK" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { requestId: string };
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { requestId: string };
    expect(retryBody.requestId).toBe(firstBody.requestId);
  });

  it("shows current signed tracking as complete without exposing private identities", () => {
    const trackedLinkId = "d1000000-0000-4000-8000-000000000001";
    const signedUrl = `https://landed.example.test/t/${trackedLinkId}?signature=signed`;

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000001",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 3,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-10T12:00:00.000Z",
                  clickEvidence: {
                    eligibleRedirects: 1,
                    ineligibleAttempts: 1,
                    totalAttempts: 2,
                    firstObservedAt: "2026-08-10T12:30:00.000Z",
                    lastObservedAt: "2026-08-10T12:45:00.000Z",
                  },
                  clickQuality: {
                    ruleVersion: 1,
                    duplicateWindowSeconds: 1800,
                    qualifiedClicks: 1,
                    duplicateClicks: 0,
                    rejectedClicks: 1,
                    totalAssessed: 2,
                    pendingAssessment: 0,
                    firstAssessedAt: "2026-08-10T12:30:01.000Z",
                    lastAssessedAt: "2026-08-10T12:45:01.000Z",
                  },
                  anonymousSessions: {
                    sessions: 1,
                    boundClicks: 1,
                    firstCreatedAt: "2026-08-10T12:30:02.000Z",
                    lastSeenAt: "2026-08-10T12:30:02.000Z",
                  },
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{ [trackedLinkId]: signedUrl }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "All 1 content asset has verifiable signed tracking.",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("COMPLETE").length).toBeGreaterThan(0);
    expect(screen.getByText("SIGNED / CURRENT")).toBeVisible();
    openFoldout("MANAGE TRACKED LINK");
    expect(screen.getByDisplayValue(signedUrl)).toBeVisible();
    expect(screen.getByText("SIGNATURE-VALID REDIRECTS")).toBeVisible();
    expect(screen.getByText("CLICK QUALITY")).toBeVisible();
    expect(screen.getByText("RULE V1")).toBeVisible();
    expect(screen.getByText("30 MIN DEDUPLICATION WINDOW")).toBeVisible();
    expect(
      screen.getByText(
        /1 qualified click \/ 0 duplicates \/ 1 quality rejection/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/No IP address or device fingerprint is retained/),
    ).toBeVisible();
    expect(
      screen.getByText(
        "FIRST 10 Aug 2026, 12:30 UTC / LAST 10 Aug 2026, 12:45 UTC",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "QUALITY FIRST 10 Aug 2026, 12:30 UTC / LAST 10 Aug 2026, 12:45 UTC",
      ),
    ).toBeVisible();
    expect(screen.getByText("1 QUALIFIED CLICK")).toBeVisible();
    expect(
      screen.getByText("2 assessed / 0 pending / 2 raw attempts retained"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "1 ANONYMOUS SESSION / 1 SESSION-LINKED VISIT / LAST 10 Aug 2026, 12:30 UTC",
      ),
    ).toBeVisible();
    expect(signedUrl).not.toContain(campaign.id);
    expect(signedUrl).not.toContain(campaign.contentAssets[0]!.creatorId);
  });

  it("keeps the zero-traffic state distinct from qualified-click evidence", () => {
    const trackedLinkId = "d1000000-0000-4000-8000-000000000006";

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000006",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 1,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-10T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{
          [trackedLinkId]: `https://landed.example.test/t/${trackedLinkId}?signature=signed`,
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    openFoldout("MANAGE TRACKED LINK");
    expect(screen.getByText("NO TRAFFIC")).toBeVisible();
    expect(
      screen.getByText(
        "Redirect active. No observed traffic yet. Qualified clicks remain unknown.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("0 ANONYMOUS SESSIONS / WALLET IDENTITY NOT ATTACHED"),
    ).toBeVisible();
  });

  it("distinguishes assessed zero-qualified evidence from pending traffic", () => {
    const trackedLinkId = "d1000000-0000-4000-8000-000000000009";

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000009",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 1,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-10T12:00:00.000Z",
                  clickEvidence: {
                    eligibleRedirects: 3,
                    ineligibleAttempts: 0,
                    totalAttempts: 3,
                    firstObservedAt: "2026-08-10T12:30:00.000Z",
                    lastObservedAt: "2026-08-10T12:50:00.000Z",
                  },
                  clickQuality: {
                    ruleVersion: 1,
                    duplicateWindowSeconds: 1800,
                    qualifiedClicks: 0,
                    duplicateClicks: 1,
                    rejectedClicks: 1,
                    totalAssessed: 2,
                    pendingAssessment: 1,
                    firstAssessedAt: "2026-08-10T12:30:01.000Z",
                    lastAssessedAt: "2026-08-10T12:40:01.000Z",
                  },
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{
          [trackedLinkId]: `https://landed.example.test/t/${trackedLinkId}?signature=signed`,
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    expect(screen.getByText("0 QUALIFIED CLICKS")).toBeVisible();
    expect(
      screen.getByText("2 assessed / 1 pending / 3 raw attempts retained"),
    ).toBeVisible();
    openFoldout("MANAGE TRACKED LINK");
    expect(screen.getByText("1 PENDING ASSESSMENT")).toBeVisible();
    expect(
      screen.getByText(
        "QUALITY FIRST 10 Aug 2026, 12:30 UTC / LAST 10 Aug 2026, 12:40 UTC",
      ),
    ).toBeVisible();
  });

  it("makes expired-link replacement the explicit next decision", () => {
    const trackedLinkId = "d1000000-0000-4000-8000-000000000002";

    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000002",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 3,
                  expiresAt: "2026-08-09T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-01T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{
          [trackedLinkId]: `https://landed.example.test/t/${trackedLinkId}?signature=signed`,
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Revoke expired links before issuing their replacements.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "REPLACE TRACKING" }),
    ).toHaveAttribute("href", "#content-assets");
    expect(screen.getByText("EXPIRED")).toBeVisible();
    expect(screen.getByText("REPLACE")).toBeVisible();
  });

  it("fails readiness visibly when a retained signing key is unavailable", () => {
    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: "d1000000-0000-4000-8000-000000000003",
                  generationRequestId: "d2000000-0000-4000-8000-000000000003",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 2,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-01T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Restore the retained signing key before activation.",
      }),
    ).toBeVisible();
    expect(screen.getByText("KEY UNAVAILABLE")).toBeVisible();
    expect(screen.getByText("KEY REQUIRED")).toBeVisible();
    expect(screen.getByRole("link", { name: "RESTORE SIGNING" })).toBeVisible();
  });

  it("fails readiness when a workspace admin deactivates the destination host", () => {
    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: "d1000000-0000-4000-8000-000000000007",
                  generationRequestId: "d2000000-0000-4000-8000-000000000007",
                  destinationUrl: "https://disabled.example.test/start",
                  destinationPolicyActive: false,
                  keyVersion: 2,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-01T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{
          "d1000000-0000-4000-8000-000000000007":
            "https://landed.example.test/t/unsafe?signature=unsafe",
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Revoke links whose destination policy is inactive, then issue replacements.",
      }),
    ).toBeVisible();
    expect(screen.getByText("DESTINATION DISABLED")).toBeVisible();
    expect(screen.getByText("HOST INACTIVE")).toBeVisible();
    openFoldout("MANAGE TRACKED LINK");
    expect(
      screen.getByText(/This destination host was deactivated/),
    ).toBeVisible();
    expect(
      screen.queryByDisplayValue(/landed\.example\.test\/t\/unsafe/),
    ).not.toBeInTheDocument();
  });

  it("shows exact revocation time, actor and reason in retained history", () => {
    const actor = "30000000-0000-4000-8000-000000000001";

    render(
      <CampaignWorkspace
        canManage={false}
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: "d1000000-0000-4000-8000-000000000004",
                  generationRequestId: "d2000000-0000-4000-8000-000000000004",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 1,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: actor,
                  issuedAt: "2026-08-01T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: {
                    requestId: "d3000000-0000-4000-8000-000000000004",
                    actorUserId: actor,
                    reason: "Campaign destination has changed",
                    revokedAt: "2026-08-10T14:00:00.000Z",
                  },
                },
              ],
            },
          ],
        }}
        trackingSnapshotAt="2026-08-10T15:00:00.000Z"
      />,
    );

    openFoldout("ISSUE TRACKED LINK");
    expect(screen.getByText("REVOKED 10 Aug 2026, 14:00 UTC")).toBeVisible();
    expect(
      screen.getByText(`ACTOR ${actor} / Campaign destination has changed`),
    ).toBeVisible();
    expect(
      screen.getByText("0 SIGNATURE-VALID REDIRECTS / 0 REJECTED ATTEMPTS"),
    ).toBeVisible();
    expect(
      screen.getAllByText(/Campaign manager access is required/),
    ).toHaveLength(3);
  });

  it("locks duplicate revocations and reuses the request identity on retry", async () => {
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      )
      .mockResolvedValueOnce({ json: async () => ({}), ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const trackedLinkId = "d1000000-0000-4000-8000-000000000005";
    render(
      <CampaignWorkspace
        canManage
        campaign={{
          ...campaign,
          contentAssets: [
            {
              ...campaign.contentAssets[0],
              trackedLinks: [
                {
                  id: trackedLinkId,
                  generationRequestId: "d2000000-0000-4000-8000-000000000005",
                  destinationUrl: "https://helios.example.test/start",
                  destinationPolicyActive: true,
                  keyVersion: 1,
                  expiresAt: "2026-09-10T12:00:00.000Z",
                  issuedBy: "30000000-0000-4000-8000-000000000001",
                  issuedAt: "2026-08-01T12:00:00.000Z",
                  clickEvidence: noClickEvidence,
                  clickQuality: noClickQuality,
                  anonymousSessions: noAnonymousSessions,
                  revocation: null,
                },
              ],
            },
          ],
        }}
        signedLinkUrls={{
          [trackedLinkId]: `https://landed.example.test/t/${trackedLinkId}?signature=signed`,
        }}
        signingReady
        trackingSnapshotAt="2026-08-10T13:00:00.000Z"
      />,
    );

    openFoldout("MANAGE TRACKED LINK");
    const revokeButton = screen.getByRole("button", { name: "REVOKE LINK" });
    fireEvent.click(revokeButton);
    fireEvent.click(revokeButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "REVOKING…" })).toBeDisabled();

    rejectRequest?.(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tracked link could not be revoked. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "REVOKE LINK" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { requestId: string };
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { requestId: string };
    expect(retryBody.requestId).toBe(firstBody.requestId);
  });

  it("keeps denied campaign access explicit", () => {
    render(<CampaignWorkspacePermission />);

    expect(
      screen.getByRole("heading", {
        name: "This campaign is outside your project access.",
      }),
    ).toBeVisible();
    expect(screen.getByText("PERMISSION REQUIRED")).toBeVisible();
  });

  it("formats financial outcome base units and preserves token valuation evidence", () => {
    const financialCampaign: CampaignRecord = {
      ...campaign,
      outcomeProfile: {
        baselineUnits: "12500",
        currencyCode: "GBP",
        metric: "average_order_value",
        targetUnits: "15000",
      },
      roster: [
        {
          ...campaign.roster[0],
          commercialTerms: {
            ...campaign.roster[0].commercialTerms,
            compensationLines: [
              {
                id: "a4000000-0000-4000-8000-000000000002",
                assetType: "token",
                model: "fixed",
                tokenMint: "So11111111111111111111111111111111111111112",
                tokenAmountRaw: "125000000",
                tokenDecimals: 6,
                unitPriceUsd: "1.25",
                priceSource: "Helius quote",
                valuedAt: "2026-08-05T12:00:00.000Z",
              },
            ],
          },
        },
      ],
    };

    render(<CampaignWorkspace campaign={financialCampaign} canManage />);

    expect(screen.getAllByText("£150")).toHaveLength(2);
    expect(
      screen.getByRole("heading", {
        name: "£125 → £150 average order value",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /So11111111111111111111111111111111111111112 \/ USD 1\.25 \/ Helius quote/,
      ),
    ).toBeVisible();
  });
});
