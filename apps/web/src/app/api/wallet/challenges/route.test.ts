import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_wallet_test"),
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

import { POST } from "./route";

const sessionId = "f2000000-0000-4000-8000-000000000001";
const walletAddress = "So11111111111111111111111111111111111111112";
const receiverAddress = "Vote111111111111111111111111111111111111111";

const approvedContext = {
  rule_version_id: "61990000-0000-4000-8000-000000000001",
  chain_id: "solana:devnet",
  configured_environment: "devnet",
  destination_address: receiverAddress,
  native_amount_lamports: "1",
};

function request(
  body: unknown,
  options: { origin?: string; session?: string | null } = {},
) {
  const origin = options.origin ?? "https://landed.test";
  const session = options.session === undefined ? sessionId : options.session;

  return new Request("https://landed.test/api/wallet/challenges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(session ? { Cookie: `lnd_session=${session}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("wallet nonce challenge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.WALLET_MEASUREMENT_CHAIN_ID = "solana:devnet";
    process.env.MEASUREMENT_DEVNET_RECEIVER_ADDRESS = receiverAddress;
    rpcMock.mockImplementation(
      async (name: string, args: Record<string, string>) => ({
        ...(name === "read_wallet_measurement_rule_context"
          ? { data: [approvedContext], error: null }
          : {
              data: [
                {
                  challenge_id: args.target_challenge_id,
                  eligibility: "issued",
                  wallet_address: args.target_wallet_address,
                  domain: args.target_domain,
                  uri: args.target_uri,
                  statement:
                    "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
                  chain_id: args.target_chain_id,
                  issued_at: "2026-08-11T12:00:00.000+00:00",
                  expires_at: "2026-08-11T12:05:00.000+00:00",
                },
              ],
              error: null,
            }),
      }),
    );
  });

  afterEach(() => {
    delete process.env.WALLET_MEASUREMENT_CHAIN_ID;
    delete process.env.MEASUREMENT_DEVNET_RECEIVER_ADDRESS;
  });

  it("issues a domain-bound five-minute challenge for the protected session", async () => {
    const response = await POST(request({ walletAddress }));

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(rpcMock).toHaveBeenCalledWith(
      "issue_wallet_nonce_challenge_v2",
      expect.objectContaining({
        target_anonymous_session_id: sessionId,
        target_domain: "landed.test",
        target_uri: "https://landed.test",
        target_wallet_address: walletAddress,
        target_chain_id: "solana:devnet",
        target_nonce_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    const body = await response.json();

    expect(body).toEqual(
      expect.objectContaining({
        challengeId: expect.any(String),
        expiresAt: "2026-08-11T12:05:00.000Z",
        signInInput: expect.objectContaining({
          address: walletAddress,
          domain: "landed.test",
          chainId: "solana:devnet",
          nonce: expect.stringMatching(/^[A-Za-z0-9]{32}$/),
          issuedAt: "2026-08-11T12:00:00.000Z",
          expirationTime: "2026-08-11T12:05:00.000Z",
        }),
      }),
    );

    expect(new Date(body.signInInput.issuedAt).toISOString()).toBe(
      "2026-08-11T12:00:00.000Z",
    );
    expect(new Date(body.signInInput.expirationTime).toISOString()).toBe(
      "2026-08-11T12:05:00.000Z",
    );
    expect(body.expiresAt).toBe(body.signInInput.expirationTime);
    expect(
      Date.parse(body.expiresAt) - Date.parse(body.signInInput.issuedAt),
    ).toBe(300_000);
  });

  it("fails before storage for malformed, sessionless and cross-origin requests", async () => {
    expect((await POST(request({ walletAddress: "bad" }))).status).toBe(400);
    expect(
      (await POST(request({ walletAddress }, { session: null }))).status,
    ).toBe(410);
    expect(
      (
        await POST(
          request({ walletAddress }, { origin: "https://attacker.test" }),
        )
      ).status,
    ).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps ineligible sessions and bounded abuse without creating a challenge", async () => {
    rpcMock.mockImplementation(
      async (name: string, args: Record<string, string>) =>
        name === "read_wallet_measurement_rule_context"
          ? { data: [approvedContext], error: null }
          : {
              data: [
                {
                  challenge_id: args.target_challenge_id,
                  eligibility: "session_not_eligible",
                  wallet_address: null,
                  domain: null,
                  uri: null,
                  statement: null,
                  chain_id: null,
                  issued_at: "2026-08-11T12:00:00.000+00:00",
                  expires_at: null,
                },
              ],
              error: null,
            },
    );
    expect((await POST(request({ walletAddress }))).status).toBe(410);

    rpcMock.mockImplementation(
      async (name: string, args: Record<string, string>) =>
        name === "read_wallet_measurement_rule_context"
          ? { data: [approvedContext], error: null }
          : {
              data: [
                {
                  challenge_id: args.target_challenge_id,
                  eligibility: "rate_limited",
                  wallet_address: null,
                  domain: null,
                  uri: null,
                  statement: null,
                  chain_id: null,
                  issued_at: "2026-08-11T12:00:00.000+00:00",
                  expires_at: null,
                },
              ],
              error: null,
            },
    );
    const rateLimited = await POST(request({ walletAddress }));
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("Retry-After")).toBe("60");
  });

  it("fails closed when stored evidence is incomplete or the database fails", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [approvedContext], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const incomplete = await POST(request({ walletAddress }));
    expect(incomplete.status).toBe(503);
    await expect(incomplete.json()).resolves.toEqual({
      message: "Wallet verification is temporarily unavailable.",
      reference: "corr_wallet_test",
    });

    rpcMock
      .mockResolvedValueOnce({ data: [approvedContext], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "database unavailable" },
      });
    expect((await POST(request({ walletAddress }))).status).toBe(503);
  });

  it("does not issue a challenge without an exact approved session rule", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(request({ walletAddress }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      message: "This campaign session has no approved wallet response.",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
