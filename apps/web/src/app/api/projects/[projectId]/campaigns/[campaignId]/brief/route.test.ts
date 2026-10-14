import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_brief_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { PATCH } from "./route";

const campaignId = "a1000000-0000-4000-8000-000000000001";
const briefId = "a8000000-0000-4000-8000-000000000001";
const requestId = "b1000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new Request(
    `https://landed.test/api/projects/helios/campaigns/${campaignId}/brief`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(projectId = "helios", selectedCampaignId = campaignId) {
  return {
    params: Promise.resolve({ projectId, campaignId: selectedCampaignId }),
  };
}

describe("campaign brief route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          brief_id: briefId,
          brief_version: 2,
          brief_status: "draft",
          mutation_applied: true,
          mutated_at: "2026-08-10T10:00:00.000+00:00",
        },
      ],
      error: null,
    });
  });

  it("saves a complete brief through the audited database boundary", async () => {
    const body = {
      action: "save",
      requestId,
      objective: "Increase qualified wallets",
      audience: "Solana mobile users",
      keyMessage: "Verified progress before claims",
      creatorDirection: "Show the product journey clearly",
      complianceNotes: "Disclose the paid partnership",
      reason: "Complete the campaign brief",
    };
    const response = await PATCH(request(body), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpcMock).toHaveBeenCalledWith("save_campaign_brief_revision", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_request_id: requestId,
      target_objective: body.objective,
      target_audience: body.audience,
      target_key_message: body.keyMessage,
      target_creator_direction: body.creatorDirection,
      target_compliance_notes: body.complianceNotes,
      revision_reason: body.reason,
    });
    expect(await response.json()).toEqual({
      brief: { id: briefId, version: 2, status: "draft" },
      mutation: { applied: true, at: "2026-08-10T10:00:00.000+00:00" },
    });
  });

  it("routes human review transitions separately from content revisions", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          brief_id: briefId,
          brief_version: 3,
          brief_status: "submitted",
          mutation_applied: true,
          mutated_at: "2026-08-10T10:05:00.000+00:00",
        },
      ],
      error: null,
    });
    const response = await PATCH(
      request({
        action: "transition",
        requestId,
        targetStatus: "submitted",
        reason: "Brief submitted for human review",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("transition_campaign_brief", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_status: "submitted",
      target_request_id: requestId,
      transition_reason: "Brief submitted for human review",
    });
  });

  it("fails closed for malformed, denied and invalid workflow changes", async () => {
    expect((await PATCH(request({}), context())).status).toBe(400);
    expect(
      (
        await PATCH(
          request({
            action: "transition",
            requestId,
            targetStatus: "submitted",
            reason: "Brief submitted for human review",
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
            action: "transition",
            requestId,
            targetStatus: "submitted",
            reason: "Brief submitted for human review",
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
            action: "transition",
            requestId,
            targetStatus: "approved",
            reason: "Invalid skipped review state",
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
        action: "transition",
        requestId,
        targetStatus: "submitted",
        reason: "Brief submitted for human review",
      }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Campaign brief could not be changed.",
      reference: "corr_brief_test",
    });
  });
});
