import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_transition_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { PATCH } from "./route";

const projectId = "helios";
const campaignId = "a1000000-0000-4000-8000-000000000001";
const transitionId = "a7000000-0000-4000-8000-000000000001";
const transitionRequestId = "a6000000-0000-4000-8000-000000000002";
const reason = "Tracking activation approved";

function request(body: unknown) {
  return new Request(
    `https://landed.test/api/projects/helios/campaigns/${campaignId}/state`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(value = projectId, selectedCampaignId = campaignId) {
  return {
    params: Promise.resolve({
      projectId: value,
      campaignId: selectedCampaignId,
    }),
  };
}

describe("campaign transition route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          campaign_id: campaignId,
          campaign_status: "live",
          transition_id: transitionId,
          transition_was_applied: true,
          transitioned_at: "2026-08-09T12:00:00.000+00:00",
        },
      ],
      error: null,
    });
  });

  it("moves a campaign through the manager-only database boundary", async () => {
    const response = await PATCH(
      request({
        targetStatus: "live",
        transitionRequestId,
        reason,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      campaign: { id: campaignId, status: "live" },
      transition: {
        id: transitionId,
        applied: true,
        at: "2026-08-09T12:00:00.000+00:00",
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("transition_campaign_state", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_campaign_id: campaignId,
      target_status: "live",
      target_transition_request_id: transitionRequestId,
      transition_reason: reason,
    });
  });

  it("returns an idempotent retry without inventing a second transition", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          campaign_id: campaignId,
          campaign_status: "live",
          transition_id: transitionId,
          transition_was_applied: false,
          transitioned_at: "2026-08-09T12:00:00.000+00:00",
        },
      ],
      error: null,
    });

    const response = await PATCH(
      request({ targetStatus: "live", transitionRequestId, reason }),
      context(),
    );

    expect((await response.json()).transition.applied).toBe(false);
  });

  it("fails closed for malformed, denied and invalid transitions", async () => {
    expect((await PATCH(request({}), context())).status).toBe(400);
    expect(
      (
        await PATCH(
          request({ targetStatus: "live", transitionRequestId, reason }),
          context("another-project"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          request({ targetStatus: "live", transitionRequestId, reason }),
          context(projectId, "not-a-campaign"),
        )
      ).status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(
      (
        await PATCH(
          request({ targetStatus: "live", transitionRequestId, reason }),
          context(),
        )
      ).status,
    ).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "22023" } });
    const conflict = await PATCH(
      request({ targetStatus: "finalized", transitionRequestId, reason }),
      context(),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      message:
        "The campaign cannot move to the requested state from its current state.",
    });
  });

  it("returns a private reference for an incomplete database response", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const response = await PATCH(
      request({ targetStatus: "live", transitionRequestId, reason }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Campaign state could not be changed.",
      reference: "corr_transition_test",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "campaign_transition_missing" }),
    );
  });
});
