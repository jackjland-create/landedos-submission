import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_trk_destination"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const input = {
  hostname: "proof-session.trycloudflare.com",
  requestId: "a2000000-0000-4000-8000-000000000001",
  reason: "Supervised external devnet proof",
};

function request(body: unknown) {
  return new Request(
    "https://landed.test/api/projects/helios/tracking-destination-hosts",
    { method: "POST", body: JSON.stringify(body) },
  );
}

const context = { params: Promise.resolve({ projectId: "helios" }) };

describe("tracking destination host approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          destination_host_id: "a4000000-0000-4000-8000-000000000001",
          hostname: input.hostname,
          added_at: "2026-09-29T10:00:00+00:00",
          host_was_added: true,
        },
      ],
      error: null,
    });
  });

  it("retains an authenticated workspace-admin approval through the audited RPC", async () => {
    const response = await POST(request(input), context);
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "allow_project_tracking_destination_host",
      {
        target_project_id: "20000000-0000-4000-8000-000000000001",
        target_request_id: input.requestId,
        target_hostname: input.hostname,
        target_reason: input.reason,
      },
    );
  });

  it("fails closed for malformed input, denied actors and retained conflicts", async () => {
    expect(
      (await POST(request({ ...input, hostname: "https://bad.test" }), context))
        .status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await POST(request(input), context)).status).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await POST(request(input), context)).status).toBe(409);
  });

  it("returns the retained idempotent approval without creating a second row", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          destination_host_id: "a4000000-0000-4000-8000-000000000001",
          hostname: input.hostname,
          added_at: "2026-09-29T10:00:00+00:00",
          host_was_added: false,
        },
      ],
      error: null,
    });
    expect((await POST(request(input), context)).status).toBe(200);
  });
});
