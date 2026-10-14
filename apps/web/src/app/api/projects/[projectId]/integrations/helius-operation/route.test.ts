import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_pil02"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const input = {
  integrationId: "a1000000-0000-4000-8000-000000000001",
  requestId: "a2000000-0000-4000-8000-000000000001",
  decision: "enabled",
  reason: "Approve exact private pilot readiness pack",
  controls: { pilotDecisionId: "a3000000-0000-4000-8000-000000000001" },
};

function request(body: unknown) {
  return new Request(
    "https://landed.test/api/projects/helios/integrations/helius-operation",
    { method: "POST", body: JSON.stringify(body) },
  );
}

const context = { params: Promise.resolve({ projectId: "helios" }) };

describe("Helius operational decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          operational_version_id: "a4000000-0000-4000-8000-000000000001",
          version: 1,
          decision: "enabled",
          inserted: true,
          approved_at: "2026-08-21T09:00:00+00:00",
          controls_sha256: "a".repeat(64),
        },
      ],
      error: null,
    });
  });

  it("retains an authenticated human decision through the production RPC", async () => {
    const response = await POST(request(input), context);
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "decide_helius_integration_operation",
      expect.objectContaining({
        target_integration_id: input.integrationId,
        target_request_id: input.requestId,
        target_controls: input.controls,
      }),
    );
  });

  it("fails closed for malformed packs, denied actors and retained conflicts", async () => {
    expect((await POST(request({}), context)).status).toBe(400);
    expect(
      (await POST(request({ ...input, decision: "disabled" }), context)).status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await POST(request(input), context)).status).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await POST(request(input), context)).status).toBe(409);
  });
});
