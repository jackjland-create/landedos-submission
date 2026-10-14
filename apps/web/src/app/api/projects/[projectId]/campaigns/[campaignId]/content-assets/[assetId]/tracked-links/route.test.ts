import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildSignedMock,
  getKeyringMock,
  getOriginMock,
  logErrorMock,
  rpcMock,
} = vi.hoisted(() => ({
  buildSignedMock: vi.fn(async () => ({
    signature: "signed",
    url: "https://landed.test/t/d1000000-0000-4000-8000-000000000001?signature=signed",
  })),
  getKeyringMock: vi.fn(() => ({ activeKeyVersion: 3, keys: new Map() })),
  getOriginMock: vi.fn(() => "https://landed.test"),
  logErrorMock: vi.fn(() => "corr_tracking_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));
vi.mock("@/lib/tracking/signing.server", () => ({
  buildSignedTrackedLink: buildSignedMock,
  getTrackedLinkApplicationOrigin: getOriginMock,
  getTrackedLinkKeyring: getKeyringMock,
}));

import { PATCH, POST } from "./route";

const campaignId = "a1000000-0000-4000-8000-000000000001";
const assetId = "a5000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
const linkId = "d1000000-0000-4000-8000-000000000001";
const requestId = "d2000000-0000-4000-8000-000000000001";

function request(method: "PATCH" | "POST", body: unknown) {
  return new Request(
    `https://landed.test/api/projects/helios/campaigns/${campaignId}/content-assets/${assetId}/tracked-links`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(
  projectId = "helios",
  selectedCampaignId = campaignId,
  selectedAssetId = assetId,
) {
  return {
    params: Promise.resolve({
      projectId,
      campaignId: selectedCampaignId,
      assetId: selectedAssetId,
    }),
  };
}

describe("tracked-link mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKeyringMock.mockReturnValue({ activeKeyVersion: 3, keys: new Map() });
  });

  it("issues a tenant-bound link and signs every attribution identity", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          tracked_link_id: linkId,
          content_asset_id: assetId,
          creator_id: creatorId,
          destination_url: "https://helios.example.test/start",
          expires_at: "2026-09-10T12:00:00.000+00:00",
          key_version: 3,
          issued_at: "2026-08-10T12:00:00.000+00:00",
          link_was_created: true,
        },
      ],
      error: null,
    });
    const response = await POST(
      request("POST", {
        action: "issue",
        requestId,
        destinationUrl: "https://helios.example.test/start",
        expiresAt: "2026-09-10T12:00:00.000Z",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpcMock).toHaveBeenCalledWith("issue_tracked_link", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_generation_request_id: requestId,
      target_destination_url: "https://helios.example.test/start",
      target_expires_at: "2026-09-10T12:00:00.000Z",
      target_key_version: 3,
    });
    expect(buildSignedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://landed.test",
        payload: expect.objectContaining({
          linkId,
          campaignId,
          creatorId,
          contentAssetId: assetId,
          keyVersion: 3,
        }),
      }),
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        trackedLink: expect.objectContaining({
          id: linkId,
          created: true,
          url: expect.stringContaining(`/t/${linkId}`),
        }),
      }),
    );
  });

  it("revokes through the audited boundary without loading signing secrets", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          tracked_link_id: linkId,
          revoked_at: "2026-08-10T13:00:00.000+00:00",
          revocation_was_applied: true,
        },
      ],
      error: null,
    });
    const response = await PATCH(
      request("PATCH", {
        action: "revoke",
        requestId,
        trackedLinkId: linkId,
        reason: "Campaign destination has changed",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(getKeyringMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("revoke_tracked_link", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_link_id: linkId,
      target_revocation_request_id: requestId,
      revocation_reason: "Campaign destination has changed",
    });
  });

  it("fails closed for malformed, denied, conflicting and unconfigured requests", async () => {
    expect((await POST(request("POST", {}), context())).status).toBe(400);
    expect(
      (
        await POST(
          request("POST", {
            action: "issue",
            requestId,
            destinationUrl: "https://helios.example.test/start",
            expiresAt: "2026-09-10T12:00:00.000Z",
          }),
          context("another-project"),
        )
      ).status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(
      (
        await PATCH(
          request("PATCH", {
            action: "revoke",
            requestId,
            trackedLinkId: linkId,
            reason: "Campaign destination has changed",
          }),
          context(),
        )
      ).status,
    ).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(
      (
        await POST(
          request("POST", {
            action: "issue",
            requestId,
            destinationUrl: "https://helios.example.test/start",
            expiresAt: "2026-09-10T12:00:00.000Z",
          }),
          context(),
        )
      ).status,
    ).toBe(409);

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message:
          "Tracked-link destination host is not approved for this project",
      },
    });
    const hostPolicyResponse = await POST(
      request("POST", {
        action: "issue",
        requestId,
        destinationUrl: "https://unapproved.example.test/start",
        expiresAt: "2026-09-10T12:00:00.000Z",
      }),
      context(),
    );
    expect(hostPolicyResponse.status).toBe(409);
    await expect(hostPolicyResponse.json()).resolves.toEqual({
      message:
        "This destination domain is outside the project's approved tracking policy.",
    });

    getKeyringMock.mockImplementation(() => {
      const error = new Error("missing");
      error.name = "TrackedLinkSigningConfigError";
      throw error;
    });
    expect(
      (
        await POST(
          request("POST", {
            action: "issue",
            requestId,
            destinationUrl: "https://helios.example.test/start",
            expiresAt: "2026-09-10T12:00:00.000Z",
          }),
          context(),
        )
      ).status,
    ).toBe(503);
  });

  it("returns a private correlation reference for incomplete results", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const response = await PATCH(
      request("PATCH", {
        action: "revoke",
        requestId,
        trackedLinkId: linkId,
        reason: "Campaign destination has changed",
      }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Tracked link could not be revoked.",
      reference: "corr_tracking_test",
    });
  });

  it("validates signing origin before writing issue evidence", async () => {
    getOriginMock.mockImplementationOnce(() => {
      const error = new Error("missing origin");
      error.name = "TrackedLinkSigningConfigError";
      throw error;
    });

    const response = await POST(
      request("POST", {
        action: "issue",
        requestId,
        destinationUrl: "https://helios.example.test/start",
        expiresAt: "2026-09-10T12:00:00.000Z",
      }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
