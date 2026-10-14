import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readActivationMock, signMock } = vi.hoisted(() => ({
  readActivationMock: vi.fn(),
  signMock: vi.fn(async () => ({
    url: "https://landed.example/t/30000000-0000-4000-8000-000000000001?signature=signed",
  })),
}));
vi.mock("./devnet-campaign-runtime.server", () => ({
  runLocalDevnetAction: readActivationMock,
}));
vi.mock("@/lib/tracking/signing.server", () => ({
  buildSignedTrackedLink: signMock,
  getTrackedLinkApplicationOrigin: () => "https://landed.example",
  getTrackedLinkKeyring: () => ({ activeKeyVersion: 1, keys: new Map() }),
}));

import { readLocalDevnetSignedLink } from "./devnet-signed-link.server";

const campaignId = "10000000-0000-4000-8000-000000000001";
const contentAssetId = "20000000-0000-4000-8000-000000000001";
const linkId = "30000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
const destinationHostId = "50000000-0000-4000-8000-000000000001";
const destinationUrl = "https://private-link.example/measure";
const expiresAt = "2099-10-03T12:00:00.000Z";
const handoff = () => ({
  campaignId,
  status: "ready",
  brief: { status: "approved" },
  blockers: [],
  destination: { url: destinationUrl, capabilityExpiresAt: expiresAt },
  assets: [{ contentAssetId, creatorId, trackedLinkId: linkId }],
});
const link = () => ({
  id: linkId,
  workspace_id: "10000000-0000-4000-8000-000000000001",
  project_id: "20000000-0000-4000-8000-000000000001",
  campaign_id: campaignId,
  content_asset_id: contentAssetId,
  creator_id: creatorId,
  destination_host_id: destinationHostId,
  destination_url: destinationUrl,
  expires_at: expiresAt,
  key_version: 1,
  revoked_at: null,
});

function client(
  linkData: unknown = link(),
  hostData: unknown = {
    id: destinationHostId,
    hostname: "private-link.example",
    revoked_at: null,
  },
  beforeLinkRead?: () => Promise<void>,
) {
  const calls: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const chain = {
      select: (columns: string) => {
        calls.push([table, "select", columns]);
        return chain;
      },
      eq: (key: string, value: unknown) => {
        calls.push([table, "eq", key, value]);
        return chain;
      },
      maybeSingle: async () => {
        if (table === "tracked_links") await beforeLinkRead?.();
        return {
          data: table === "tracked_links" ? linkData : hostData,
          error: null,
        };
      },
    };
    return chain;
  });
  return { value: { from } as unknown as SupabaseClient, calls, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  readActivationMock.mockResolvedValue(handoff());
});

afterEach(() => vi.restoreAllMocks());

it("signs only the manager-authorized, scoped, current participant link", async () => {
  const db = client();
  const signed = await readLocalDevnetSignedLink(db.value, {
    campaignId,
    contentAssetId,
  });
  expect(signed).toEqual({
    url: expect.stringContaining(`/t/${linkId}`),
    expiresAt,
  });
  expect(readActivationMock).toHaveBeenCalledWith(db.value, {
    action: "readActivation",
    campaignId,
  });
  expect(readActivationMock).toHaveBeenCalledTimes(2);
  for (const [table, key, value] of [
    ["tracked_links", "workspace_id", "10000000-0000-4000-8000-000000000001"],
    ["tracked_links", "project_id", "20000000-0000-4000-8000-000000000001"],
    ["tracked_links", "campaign_id", campaignId],
    ["tracked_links", "content_asset_id", contentAssetId],
    ["project_tracking_destination_hosts", "id", destinationHostId],
  ])
    expect(db.calls).toContainEqual([table, "eq", key, value]);
  expect(signMock).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        linkId,
        campaignId,
        creatorId,
        contentAssetId,
        keyVersion: 1,
      }),
    }),
  );
});

it("does not release a signed URL after manager authority changes during a link read", async () => {
  let release!: () => void;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const db = client(link(), undefined, async () => {
    entered();
    await waiting;
  });
  const pending = readLocalDevnetSignedLink(db.value, {
    campaignId,
    contentAssetId,
  });
  await reading;
  readActivationMock.mockRejectedValueOnce(new Error("Current manager denied"));
  release();
  await expect(pending).rejects.toThrow("Current manager denied");
  expect(readActivationMock).toHaveBeenCalledTimes(2);
});

it("rejects temporary authority expiring while the link read is pending", async () => {
  let now = Date.parse("2026-10-04T12:00:00.000Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const current = {
    ...handoff(),
    destination: {
      url: destinationUrl,
      capabilityExpiresAt: new Date(now + 1_000).toISOString(),
    },
  };
  readActivationMock.mockResolvedValue(current);
  const db = client(link(), undefined, async () => {
    now += 1_001;
  });
  await expect(
    readLocalDevnetSignedLink(db.value, { campaignId, contentAssetId }),
  ).rejects.toThrow("not ready");
});

it("rejects a different retained link returned by the final authority check", async () => {
  readActivationMock.mockResolvedValueOnce(handoff()).mockResolvedValueOnce({
    ...handoff(),
    assets: [{ contentAssetId, creatorId, trackedLinkId: destinationHostId }],
  });
  await expect(
    readLocalDevnetSignedLink(client().value, { campaignId, contentAssetId }),
  ).rejects.toThrow("no longer current");
});

it("does not read or sign a link when current authority is denied", async () => {
  readActivationMock.mockRejectedValueOnce(new Error("Current manager denied"));
  const db = client();
  await expect(
    readLocalDevnetSignedLink(db.value, { campaignId, contentAssetId }),
  ).rejects.toThrow("denied");
  expect(db.from).not.toHaveBeenCalled();
  expect(signMock).not.toHaveBeenCalled();
});

it.each([
  ["blocked activation", { handoff: { ...handoff(), status: "blocked" } }],
  [
    "unapproved brief",
    { handoff: { ...handoff(), brief: { status: "draft" } } },
  ],
  ["unissued asset", { handoff: { ...handoff(), assets: [] } }],
  [
    "revoked link",
    { link: { ...link(), revoked_at: "2026-10-02T12:00:00.000Z" } },
  ],
  ["wrong campaign", { link: { ...link(), campaign_id: creatorId } }],
  [
    "wrong destination",
    { link: { ...link(), destination_url: "https://other.example/measure" } },
  ],
  [
    "expired link",
    { link: { ...link(), expires_at: "2020-10-02T12:00:00.000Z" } },
  ],
  [
    "revoked destination",
    {
      host: {
        id: destinationHostId,
        hostname: "private-link.example",
        revoked_at: "2026-10-02T12:00:00.000Z",
      },
    },
  ],
] as const)("fails closed for %s", async (_, altered) => {
  if ("handoff" in altered)
    readActivationMock.mockResolvedValueOnce(altered.handoff);
  const db = client(
    "link" in altered ? altered.link : link(),
    "host" in altered
      ? altered.host
      : {
          id: destinationHostId,
          hostname: "private-link.example",
          revoked_at: null,
        },
  );
  await expect(
    readLocalDevnetSignedLink(db.value, { campaignId, contentAssetId }),
  ).rejects.toThrow();
  expect(signMock).not.toHaveBeenCalled();
});
