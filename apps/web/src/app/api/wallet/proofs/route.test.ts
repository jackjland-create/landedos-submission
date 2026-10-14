import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock, verifyMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_wallet_proof"),
  rpcMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});
vi.mock("@/lib/wallet/proof.server", () => {
  class WalletSignatureVerificationError extends Error {}
  return {
    verifyWalletSignatureProof: verifyMock,
    WalletSignatureVerificationError,
  };
});

import { POST } from "./route";

const sessionId = "f2000000-0000-4000-8000-000000000001";
const challengeId = "f1000000-0000-4000-8000-000000000001";
const walletAddress = "So11111111111111111111111111111111111111112";
const body = {
  challengeId,
  signInInput: {
    domain: "landed.test",
    address: walletAddress,
    statement:
      "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
    uri: "https://landed.test",
    version: "1",
    chainId: "solana:devnet",
    nonce: "0123456789abcdef0123456789abcdef",
    issuedAt: "2026-08-11T12:00:00.000Z",
    expirationTime: "2026-08-11T12:05:00.000Z",
    requestId: challengeId,
  },
  signInOutput: {
    accountAddress: walletAddress,
    accountPublicKey: Buffer.alloc(32, 1).toString("base64"),
    signedMessage: Buffer.from("signed message").toString("base64"),
    signature: Buffer.alloc(64, 2).toString("base64"),
    signatureType: "ed25519",
  },
};

function request(value: unknown = body, origin = "https://landed.test") {
  return new Request("https://landed.test/api/wallet/proofs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: `lnd_session=${sessionId}`,
    },
    body: JSON.stringify(value),
  });
}

describe("wallet signature proof route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    verifyMock.mockResolvedValue({
      nonceHash: "a".repeat(64),
      signedMessageHash: "b".repeat(64),
      signatureHash: "c".repeat(64),
      verifier: "wallet_standard_siws",
      verifierVersion: "1.1.3",
    });
    rpcMock.mockImplementation(
      async (name: string, args: Record<string, string>) =>
        name === "admit_wallet_signature_proof_attempt"
          ? { data: [{ eligibility: "admitted" }], error: null }
          : {
              data: [
                {
                  proof_id: args.target_proof_id,
                  eligibility: "recorded",
                  verified_at: "2026-08-11T12:00:01.000+00:00",
                },
              ],
              error: null,
            },
    );
  });

  it("records verified proof through the atomic service boundary", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "admit_wallet_signature_proof_attempt",
      {
        target_anonymous_session_id: sessionId,
        target_challenge_id: challengeId,
        target_wallet_address: walletAddress,
      },
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "record_verified_wallet_session_proof",
      expect.objectContaining({
        target_anonymous_session_id: sessionId,
        target_challenge_id: challengeId,
        target_nonce_hash: "a".repeat(64),
        target_signed_message_hash: "b".repeat(64),
        target_signature_hash: "c".repeat(64),
        target_wallet_address: walletAddress,
      }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        challengeId,
        proofId: expect.any(String),
        state: "verified",
      }),
    );
  });

  it("rejects cross-origin, malformed, invalid and replayed proofs", async () => {
    expect((await POST(request(body, "https://attacker.test"))).status).toBe(
      403,
    );
    expect((await POST(request({ ...body, privateKey: "never" }))).status).toBe(
      400,
    );

    const { WalletSignatureVerificationError } =
      await import("@/lib/wallet/proof.server");
    verifyMock.mockRejectedValueOnce(new WalletSignatureVerificationError());
    expect((await POST(request())).status).toBe(401);

    rpcMock.mockResolvedValueOnce({
      data: [{ eligibility: "admitted" }],
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: [{ proof_id: null, eligibility: "replayed", verified_at: null }],
      error: null,
    });
    expect((await POST(request())).status).toBe(409);

    verifyMock.mockClear();
    rpcMock.mockResolvedValueOnce({
      data: [{ eligibility: "replayed" }],
      error: null,
    });
    expect((await POST(request())).status).toBe(409);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("fails closed for unmatched evidence and database failure", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { proof_id: null, eligibility: "not_accepted", verified_at: null },
      ],
      error: null,
    });
    expect((await POST(request())).status).toBe(410);

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "database unavailable" },
    });
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("rejects an expired challenge before signature verification", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ eligibility: "not_accepted" }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      message: "Wallet proof expired or was not accepted.",
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared request before storage or verification", async () => {
    const oversized = request();
    oversized.headers.set("Content-Length", "12289");

    const response = await POST(oversized);

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rate limits before performing expensive signature verification", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ eligibility: "rate_limited" }],
      error: null,
    });

    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
