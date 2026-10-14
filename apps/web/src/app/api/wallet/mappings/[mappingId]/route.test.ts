import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_wallet_unlink"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});

import { DELETE } from "./route";

const sessionId = "f2000000-0000-4000-8000-000000000001";
const mappingId = "f5000000-0000-4000-8000-000000000001";
const unlinkRequestId = "f6000000-0000-4000-8000-000000000001";

function request(
  body: unknown = { unlinkRequestId },
  origin = "https://landed.test",
  cookie = `lnd_session=${sessionId}`,
) {
  return new Request(`https://landed.test/api/wallet/mappings/${mappingId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ mappingId }) };

describe("protected wallet mapping unlink route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    rpcMock.mockResolvedValue({
      data: [
        {
          mapping_id: mappingId,
          eligibility: "unlinked",
          unlinked_at: "2026-08-11T12:10:00.000+00:00",
        },
      ],
      error: null,
    });
  });

  it("unlinks only the mapping bound to the protected session", async () => {
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("unlink_protected_wallet_mapping", {
      target_anonymous_session_id: sessionId,
      target_mapping_id: mappingId,
      target_unlink_request_id: unlinkRequestId,
    });
    await expect(response.json()).resolves.toEqual({
      mappingId,
      state: "unlinked",
      unlinkedAt: "2026-08-11T12:10:00.000+00:00",
    });
  });

  it("rejects cross-origin, malformed and cookieless unlink attempts", async () => {
    expect(
      (await DELETE(request(undefined, "https://attacker.test"), context))
        .status,
    ).toBe(403);
    expect(
      (await DELETE(request({ privateKey: "never" }), context)).status,
    ).toBe(400);
    expect(
      (await DELETE(request(undefined, undefined, ""), context)).status,
    ).toBe(404);
  });

  it("returns replay and not-found outcomes without exposing identity", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          mapping_id: mappingId,
          eligibility: "already_unlinked",
          unlinked_at: "2026-08-11T12:10:00.000+00:00",
        },
      ],
      error: null,
    });
    const replay = await DELETE(request(), context);
    expect(replay.status).toBe(200);
    expect((await replay.json()).state).toBe("already_unlinked");

    rpcMock.mockResolvedValueOnce({
      data: [{ mapping_id: null, eligibility: "not_found", unlinked_at: null }],
      error: null,
    });
    expect((await DELETE(request(), context)).status).toBe(404);

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await DELETE(request(), context)).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalled();
  });
});
