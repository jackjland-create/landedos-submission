import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock, sendMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_replay_test"),
  rpcMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({ inngest: { send: sendMock } }));
vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const input = {
  replayJobId: "a4000000-0000-4000-8000-000000000001",
  replayRunId: "a5000000-0000-4000-8000-000000000001",
  approvalRequestId: "a6000000-0000-4000-8000-000000000001",
  approvalReason: "Approve comparison against retained project history",
};

function request(body: unknown) {
  return new Request(
    "https://landed.test/api/projects/helios/conversion-replays",
    { method: "POST", body: JSON.stringify(body) },
  );
}

function context(projectId = "helios") {
  return { params: Promise.resolve({ projectId }) };
}

describe("conversion replay approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ ids: ["event_1"] });
    rpcMock.mockResolvedValue({
      data: [
        {
          replay_run_id: input.replayRunId,
          status: "queued",
          inserted: true,
          campaign_count: 2,
          source_started_at: "2026-08-12T12:00:00+00:00",
          source_ended_at: "2026-08-17T12:00:00+00:00",
        },
      ],
      error: null,
    });
  });

  it("approves retained replay work and dispatches its exact durable run", async () => {
    const response = await POST(request(input), context());
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      replay: {
        id: input.replayRunId,
        status: "queued",
        approved: true,
        campaignCount: 2,
        sourceStartedAt: "2026-08-12T12:00:00.000Z",
        sourceEndedAt: "2026-08-17T12:00:00.000Z",
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("approve_conversion_replay_job", {
      target_approval_reason: input.approvalReason,
      target_approval_request_id: input.approvalRequestId,
      target_replay_job_id: input.replayJobId,
      target_replay_run_id: input.replayRunId,
    });
    expect(sendMock).toHaveBeenCalledWith({
      name: "landed/conversion.replay.approved",
      data: { replayRunId: input.replayRunId },
      id: `conversion-replay-${input.replayRunId}`,
    });
  });

  it("redispatches an exact retained approval without creating a second run", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          replay_run_id: input.replayRunId,
          status: "queued",
          inserted: false,
          campaign_count: 2,
          source_started_at: "2026-08-12T12:00:00Z",
          source_ended_at: "2026-08-17T12:00:00Z",
        },
      ],
      error: null,
    });
    const response = await POST(request(input), context());
    expect(response.status).toBe(200);
    expect((await response.json()).replay.approved).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for malformed, denied and conflicting approvals", async () => {
    expect((await POST(request({}), context())).status).toBe(400);
    expect((await POST(request(input), context("wrong"))).status).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await POST(request(input), context())).status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await POST(request(input), context())).status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns actionable guidance when a baseline is no longer replayable", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "Conversion replay requires an issued campaign baseline",
      },
    });

    const response = await POST(request(input), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message:
        "Issue a baseline report first. This rule has no comparable issued campaign report yet.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("preserves the exact request for retry when dispatch is uncertain", async () => {
    sendMock.mockRejectedValue(new Error("dispatch unavailable"));
    const response = await POST(request(input), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message:
        "Replay approval could not be confirmed. Retry the same request.",
      reference: "corr_replay_test",
    });
  });
});
