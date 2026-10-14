import type { CreatorDirectoryRecord } from "@landed/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CreatorDirectory,
  CreatorDirectoryPermission,
} from "./creator-directory";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const creators: CreatorDirectoryRecord[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000001",
    projectId: "20000000-0000-4000-8000-000000000001",
    displayName: "Chain Mode",
    relationshipStatus: "active",
    countryCode: "GB",
    languageCodes: ["en"],
    channels: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        type: "x",
        handle: "@chainmode",
        profileUrl: "https://x.com/chainmode",
        languageCode: "en",
        audienceSize: 124000,
        observedAt: "2026-07-24T12:00:00.000Z",
        sourceLabel: "Seeded demo",
        isPrimary: true,
      },
      {
        id: "40000000-0000-4000-8000-000000000003",
        type: "instagram",
        handle: "@chainmodevideo",
        profileUrl: "https://instagram.com/chainmodevideo",
        languageCode: "en",
        audienceSize: 98000,
        observedAt: "2026-07-29T12:00:00.000Z",
        sourceLabel: "Secondary channel snapshot",
        isPrimary: false,
      },
    ],
    tags: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        name: "Consumer",
        slug: "consumer",
      },
    ],
    currentRate: {
      id: "80000000-0000-4000-8000-000000000001",
      packageLabel: "Launch package",
      deliverableSummary: "One X thread and one short-form video",
      amountMinor: "460000",
      currencyCode: "GBP",
      quotedAt: "2026-07-15T12:00:00.000Z",
      validUntil: "2026-08-15T12:00:00.000Z",
      sourceLabel: "Seeded commercial evidence",
    },
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    workspaceId: "10000000-0000-4000-8000-000000000001",
    projectId: "20000000-0000-4000-8000-000000000001",
    displayName: "Solana Sensei",
    relationshipStatus: "prospect",
    countryCode: "US",
    languageCodes: ["en"],
    channels: [
      {
        id: "40000000-0000-4000-8000-000000000002",
        type: "youtube",
        handle: "@solsensei",
        profileUrl: "https://youtube.com/@solsensei",
        languageCode: "en",
        audienceSize: null,
        observedAt: null,
        sourceLabel: null,
        isPrimary: true,
      },
    ],
    tags: [
      {
        id: "50000000-0000-4000-8000-000000000002",
        name: "DeFi",
        slug: "defi",
      },
    ],
    currentRate: null,
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
  },
];

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("CreatorDirectory", () => {
  it("retains selection when filters hide a creator", () => {
    render(<CreatorDirectory creators={creators} />);

    fireEvent.click(screen.getByLabelText("Select Chain Mode"));
    fireEvent.change(screen.getByLabelText("Search creators"), {
      target: { value: "Sensei" },
    });

    expect(
      screen.getByRole("button", { name: "SELECT 1 FOR BASKET SETUP" }),
    ).toBeEnabled();
    expect(
      screen.getByText("1 SELECTED / 1 HIDDEN BY FILTERS"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "CLEAR FILTERS" }));

    expect(screen.getByLabelText("Select Chain Mode")).toBeChecked();
  });

  it("filters by channel and explains a no-match result", () => {
    render(<CreatorDirectory creators={creators} />);

    fireEvent.change(screen.getByLabelText("Filter by channel"), {
      target: { value: "youtube" },
    });

    expect(screen.getByText("Solana Sensei")).toBeInTheDocument();
    expect(screen.queryByText("Chain Mode")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search creators"), {
      target: { value: "does-not-exist" },
    });

    expect(
      screen.getByRole("heading", {
        name: "No creators match these filters.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your existing selection is retained while you adjust the view.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps audience freshness and source on the same primary channel", () => {
    render(<CreatorDirectory creators={[creators[0]!]} />);

    expect(screen.getByText("24 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("Seeded demo")).toBeInTheDocument();
    expect(screen.getByText("£4,600 GBP")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open evidence for Chain Mode" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Secondary channel snapshot"),
    ).not.toBeInTheDocument();
  });

  it("opens creator evidence without losing directory context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          creator: {
            ...creators[0],
            profileSummary: "Consumer-focused Solana educator.",
            profileObservedAt: "2026-07-15T12:00:00.000Z",
            profileSourceLabel: "Seeded workspace profile",
            contactAccess: "restricted",
            contact: null,
            rateQuotes: creators[0]!.currentRate
              ? [creators[0]!.currentRate]
              : [],
          },
        }),
        ok: true,
        status: 200,
      })),
    );
    render(<CreatorDirectory creators={creators} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open evidence for Chain Mode",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "About" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Creator evidence at a glance" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Close creator evidence" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the retained creator from a report renewal review link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          creator: {
            ...creators[0],
            profileSummary: "Consumer-focused Solana educator.",
            profileObservedAt: "2026-07-15T12:00:00.000Z",
            profileSourceLabel: "Seeded workspace profile",
            contactAccess: "restricted",
            contact: null,
            rateQuotes: creators[0]!.currentRate
              ? [creators[0]!.currentRate]
              : [],
          },
        }),
        ok: true,
        status: 200,
      })),
    );

    render(
      <CreatorDirectory
        creators={creators}
        initialCreatorId={creators[0]!.id}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Creator evidence at a glance",
      }),
    ).toBeInTheDocument();
  });

  it("shows a safe first-use state", () => {
    render(<CreatorDirectory creators={[]} />);

    expect(
      screen.getByRole("heading", { name: "No creators have been added yet." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import unavailable in this demo" }),
    ).toBeDisabled();
  });

  it("does not expose records in the permission state", () => {
    render(<CreatorDirectoryPermission />);

    expect(
      screen.getByRole("heading", {
        name: "This creator roster is not available.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No creator evidence has been exposed.", {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it("submits the exact roster including creators hidden by filters and opens the returned basket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          basketId: "90000000-0000-4000-8000-000000000001",
        }),
        ok: true,
        status: 201,
      })),
    );
    render(<CreatorDirectory creators={creators} />);

    fireEvent.click(screen.getByLabelText("Select Chain Mode"));
    fireEvent.click(screen.getByLabelText("Select Solana Sensei"));
    fireEvent.change(screen.getByLabelText("Search creators"), {
      target: { value: "Sensei" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "SELECT 2 FOR BASKET SETUP" }),
    );

    expect(fetch).toHaveBeenCalledWith("/api/projects/helios/baskets", {
      body: JSON.stringify({
        creatorIds: creators.map((creator) => creator.id),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/projects/helios/baskets/90000000-0000-4000-8000-000000000001",
      ),
    );
  });

  it("excludes deselected creators and disables repeat submission while pending", async () => {
    let resolveResponse!: (response: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CreatorDirectory creators={creators} />);
    fireEvent.click(screen.getByLabelText("Select Chain Mode"));
    fireEvent.click(screen.getByLabelText("Select Solana Sensei"));
    fireEvent.click(screen.getByLabelText("Select Chain Mode"));
    const submit = screen.getByRole("button", {
      name: "SELECT 1 FOR BASKET SETUP",
    });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/projects/helios/baskets",
      {
        body: JSON.stringify({ creatorIds: [creators[1]!.id] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    ]);
    resolveResponse({
      ok: true,
      json: async () => ({ basketId: "not-a-valid-id" }),
    });
    expect(
      await screen.findByText("Basket setup could not be created. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select Solana Sensei")).toBeChecked();
    expect(submit).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the selected roster when basket creation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ message: "Campaign manager access is required." }),
        ok: false,
        status: 403,
      })),
    );
    render(<CreatorDirectory creators={creators} />);

    fireEvent.click(screen.getByLabelText("Select Chain Mode"));
    fireEvent.click(
      screen.getByRole("button", { name: "SELECT 1 FOR BASKET SETUP" }),
    );

    expect(
      await screen.findByText("Campaign manager access is required."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select Chain Mode")).toBeChecked();
    expect(push).not.toHaveBeenCalled();
  });
});
