import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_campaign_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const projectId = "helios";
const commercialPlanVersionId = "a2000000-0000-4000-8000-000000000001";
const activationRequestId = "a6000000-0000-4000-8000-000000000001";
const campaignId = "a1000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new Request("https://landed.test/api/projects/helios/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(value = projectId) {
  return { params: Promise.resolve({ projectId: value }) };
}

describe("campaign creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [{ campaign_id: campaignId, campaign_was_created: true }],
      error: null,
    });
  });

  it("creates an immutable roster from an approved commercial plan", async () => {
    const response = await POST(
      request({ commercialPlanVersionId, activationRequestId }),
      context(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      campaign: { id: campaignId, created: true },
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "create_campaign_from_commercial_plan",
      {
        target_project_id: "20000000-0000-4000-8000-000000000001",
        target_commercial_plan_version_id: commercialPlanVersionId,
        target_activation_request_id: activationRequestId,
      },
    );
  });

  it("returns the existing campaign for a retried plan", async () => {
    rpcMock.mockResolvedValue({
      data: [{ campaign_id: campaignId, campaign_was_created: false }],
      error: null,
    });

    const response = await POST(
      request({ commercialPlanVersionId, activationRequestId }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: campaignId, created: false },
    });
  });

  it("fails closed for malformed, denied and stale requests", async () => {
    expect((await POST(request({}), context())).status).toBe(400);
    expect(
      (
        await POST(
          request({ commercialPlanVersionId, activationRequestId }),
          context("another-project"),
        )
      ).status,
    ).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(
      (
        await POST(
          request({ commercialPlanVersionId, activationRequestId }),
          context(),
        )
      ).status,
    ).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(
      (
        await POST(
          request({ commercialPlanVersionId, activationRequestId }),
          context(),
        )
      ).status,
    ).toBe(409);
  });

  it.each(["22023", "23503", "23505", "23514"])(
    "preserves approved-plan rejection %s without retrying or substituting a plan",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { code } });
      const response = await POST(
        request({ commercialPlanVersionId, activationRequestId }),
        context(),
      );
      expect(response.status).toBe(409);
      expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
        "create_campaign_from_commercial_plan",
        {
          target_project_id: "20000000-0000-4000-8000-000000000001",
          target_commercial_plan_version_id: commercialPlanVersionId,
          target_activation_request_id: activationRequestId,
        },
      );
    },
  );

  it("returns a reference when the database response is incomplete", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const response = await POST(
      request({ commercialPlanVersionId, activationRequestId }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Campaign could not be created.",
      reference: "corr_campaign_test",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "campaign_creation_missing" }),
    );
  });
});
