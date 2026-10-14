import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_asset_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { PATCH } from "./route";

const campaignId = "a1000000-0000-4000-8000-000000000001";
const assetId = "a5000000-0000-4000-8000-000000000001";
const activityId = "aa000000-0000-4000-8000-000000000001";
const requestId = "c1000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new Request(
    `https://landed.test/api/projects/helios/campaigns/${campaignId}/content-assets/${assetId}`,
    {
      method: "PATCH",
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

describe("content asset transition route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          content_asset_id: assetId,
          content_asset_status: "submitted",
          activity_id: activityId,
          transition_applied: true,
          transitioned_at: "2026-08-10T10:00:00.000+00:00",
        },
      ],
      error: null,
    });
  });

  it("records a deliverable transition with its evidence URL and note", async () => {
    const response = await PATCH(
      request({
        targetStatus: "submitted",
        requestId,
        evidenceUrl: "https://example.test/review/launch-thread",
        note: "Creator submitted content for review",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpcMock).toHaveBeenCalledWith("transition_content_asset", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_status: "submitted",
      target_request_id: requestId,
      target_evidence_url: "https://example.test/review/launch-thread",
      transition_note: "Creator submitted content for review",
    });
    expect(await response.json()).toEqual({
      contentAsset: { id: assetId, status: "submitted" },
      transition: {
        id: activityId,
        applied: true,
        at: "2026-08-10T10:00:00.000+00:00",
      },
    });
  });

  it("fails closed for malformed, denied and invalid state changes", async () => {
    expect((await PATCH(request({}), context())).status).toBe(400);
    expect(
      (
        await PATCH(
          request({
            targetStatus: "draft",
            requestId,
            evidenceUrl: null,
            note: "Creator started the content draft",
          }),
          context("another-project"),
        )
      ).status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(
      (
        await PATCH(
          request({
            targetStatus: "draft",
            requestId,
            evidenceUrl: null,
            note: "Creator started the content draft",
          }),
          context(),
        )
      ).status,
    ).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "22023" } });
    expect(
      (
        await PATCH(
          request({
            targetStatus: "published",
            requestId,
            evidenceUrl: null,
            note: "Invalid skipped content states",
          }),
          context(),
        )
      ).status,
    ).toBe(409);
  });

  it("returns a private reference for an incomplete database response", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const response = await PATCH(
      request({
        targetStatus: "draft",
        requestId,
        evidenceUrl: null,
        note: "Creator started the content draft",
      }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Deliverable state could not be changed.",
      reference: "corr_asset_test",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetId, campaignId }),
    );
  });
});
