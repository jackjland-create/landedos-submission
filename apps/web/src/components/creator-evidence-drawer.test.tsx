import type {
  CreatorDirectoryRecord,
  CreatorEvidenceRecord,
} from "@landed/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreatorEvidenceDrawer } from "./creator-evidence-drawer";

const rateQuote = {
  id: "80000000-0000-4000-8000-000000000001",
  packageLabel: "Launch package",
  deliverableSummary: "One X thread and one short-form video",
  amountMinor: "460000",
  currencyCode: "GBP" as const,
  quotedAt: "2026-07-15T12:00:00.000Z",
  validUntil: "2026-08-15T12:00:00.000Z",
  sourceLabel: "Seeded commercial evidence",
};

const creator: CreatorDirectoryRecord = {
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
  ],
  tags: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Consumer",
      slug: "consumer",
    },
  ],
  currentRate: rateQuote,
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
};

const evidence: CreatorEvidenceRecord = {
  ...creator,
  profileSummary: "Consumer-focused Solana educator.",
  profileObservedAt: "2026-07-15T12:00:00.000Z",
  profileSourceLabel: "Seeded workspace profile",
  contactAccess: "available",
  contact: {
    id: "70000000-0000-4000-8000-000000000001",
    contactName: "Maya campaign desk",
    contactRole: "Commercial contact",
    email: "maya-chainmode@example.test",
    observedAt: "2026-07-15T12:00:00.000Z",
    sourceLabel: "Seeded demo contact",
  },
  rateQuotes: [rateQuote],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreatorEvidenceDrawer", () => {
  it("renders sourced profile, commercial and contact evidence", async () => {
    const onClose = vi.fn();
    const onToggleSelection = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ creator: evidence }),
        ok: true,
        status: 200,
      })),
    );

    render(
      <CreatorEvidenceDrawer
        creator={creator}
        isSelected={false}
        onClose={onClose}
        onToggleSelection={onToggleSelection}
        projectId="helios"
      />,
    );

    expect(
      screen.getByText("Preparing project-scoped evidence…"),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Rate and quote history" }),
    ).toBeVisible();
    expect(screen.getByText("£4,600 GBP")).toBeVisible();
    expect(
      screen.getByText("Seeded workspace profile / 15 Jul 2026"),
    ).toBeVisible();
    expect(screen.getByText("maya-chainmode@example.test")).toBeVisible();
    expect(screen.getByText("NO ISSUED EVIDENCE")).toBeVisible();
    expect(screen.getByText("NOT SCORED")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "SELECT FOR BASKET" }));
    expect(onToggleSelection).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps protected contact data hidden for restricted members", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          creator: {
            ...evidence,
            contactAccess: "restricted",
            contact: null,
          },
        }),
        ok: true,
        status: 200,
      })),
    );

    render(
      <CreatorEvidenceDrawer
        creator={creator}
        isSelected={false}
        onClose={() => undefined}
        onToggleSelection={() => undefined}
        projectId="helios"
      />,
    );

    expect(await screen.findByText("MANAGER ACCESS ONLY")).toBeVisible();
    expect(
      screen.queryByText("maya-chainmode@example.test"),
    ).not.toBeInTheDocument();
  });

  it("offers a recoverable retry after an interrupted request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ reference: "corr_test" }),
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        json: async () => ({ creator: evidence }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreatorEvidenceDrawer
        creator={creator}
        isSelected={false}
        onClose={() => undefined}
        onToggleSelection={() => undefined}
        projectId="helios"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Creator evidence could not be prepared.",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Reference corr_test/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "RETRY" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Rate and quote history" }),
    ).toBeVisible();
  });
});
