import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/observability", () => ({
  logError: vi.fn(() => "corr_health"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const authorization = "health-monitor-test-token-0123456789";
const input = {
  integrationId: "b1000000-0000-4000-8000-000000000001",
  operationalVersionId: "b2000000-0000-4000-8000-000000000001",
  requestId: "b3000000-0000-4000-8000-000000000001",
  observedAt: "2026-08-21T09:00:00.000Z",
  oldestQueueAgeSeconds: 10,
  retryCount: 0,
  terminalFailureCount: 0,
  callbackFailureCount: 0,
  evidenceId: "monitor:PIL02:run:1",
};

function request(body: unknown, token = authorization) {
  return new Request(
    "https://landed.test/api/internal/integrations/helius/health",
    {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("Helius operational health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PILOT_HEALTH_MONITOR_AUTHORIZATION = authorization;
    rpcMock.mockResolvedValue({
      data: [
        {
          health_observation_id: "b4000000-0000-4000-8000-000000000001",
          inserted: true,
          within_thresholds: true,
          observed_at: input.observedAt,
        },
      ],
      error: null,
    });
  });

  it("accepts only the configured monitor and records exact health evidence", async () => {
    expect((await POST(request(input))).status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "record_helius_integration_health",
      expect.objectContaining({
        target_operational_version_id: input.operationalVersionId,
        target_evidence_id: input.evidenceId,
      }),
    );
  });

  it("rejects forged authorization and malformed observations before the RPC", async () => {
    expect((await POST(request(input, `${authorization}-forged`))).status).toBe(
      401,
    );
    expect((await POST(request({}))).status).toBe(400);
    expect(rpcMock).toHaveBeenCalledTimes(0);
  });
});
