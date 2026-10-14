import { createSignInMessage } from "@solana/wallet-standard-util";
import {
  walletNonceChallengeResponseSchema,
  type WalletNonceChallengeResponse,
} from "@landed/contracts";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { rpcMock, logErrorMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_joined_wallet_test"),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});

import { POST as issueChallenge } from "@/app/api/wallet/challenges/route";
import { POST as recordProof } from "@/app/api/wallet/proofs/route";

import {
  verifyWalletSignatureProof,
  WalletSignatureVerificationError,
} from "./proof.server";

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(input: Uint8Array) {
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index]! << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (
    let index = 0;
    input[index] === 0 && index < input.length - 1;
    index += 1
  ) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => base58Alphabet[digit])
    .join("");
}

async function signedFixture(
  challengeSource?: (address: string) => Promise<WalletNonceChallengeResponse>,
) {
  const keys = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await webcrypto.subtle.exportKey("raw", keys.publicKey),
  );
  const address = encodeBase58(publicKey);
  const signInInput = challengeSource
    ? (await challengeSource(address)).signInInput
    : {
        domain: "landed.test",
        address,
        statement:
          "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
        uri: "https://landed.test",
        version: "1" as const,
        chainId: "solana:devnet" as const,
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expirationTime: "2026-08-11T12:05:00.000Z",
        requestId: "f1000000-0000-4000-8000-000000000001",
      };
  const signedMessage = createSignInMessage(signInInput);
  const signature = new Uint8Array(
    await webcrypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      Uint8Array.from(signedMessage).buffer,
    ),
  );

  return {
    challengeId: signInInput.requestId,
    signInInput,
    signInOutput: {
      accountAddress: address,
      accountPublicKey: Buffer.from(publicKey).toString("base64"),
      signedMessage: Buffer.from(signedMessage).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      signatureType: "ed25519" as const,
    },
  };
}

describe("wallet signature proof verifier", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("verifies exact SIWS bytes and emits only irreversible evidence hashes", async () => {
    const fixture = await signedFixture();
    const result = await verifyWalletSignatureProof(fixture);

    expect(result).toEqual({
      nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      signedMessageHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      signatureHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      verifier: "wallet_standard_siws",
      verifierVersion: "1.1.3",
    });
    expect(result).not.toHaveProperty("signature");
    expect(result).not.toHaveProperty("signedMessage");
  });

  it("rejects a wrong public key and any tampered signed message", async () => {
    const fixture = await signedFixture();
    await expect(
      verifyWalletSignatureProof({
        ...fixture,
        signInOutput: {
          ...fixture.signInOutput,
          accountPublicKey: Buffer.alloc(32, 7).toString("base64"),
        },
      }),
    ).rejects.toBeInstanceOf(WalletSignatureVerificationError);

    const tampered = Buffer.from(fixture.signInOutput.signedMessage, "base64");
    tampered[0] = tampered[0]! ^ 1;
    await expect(
      verifyWalletSignatureProof({
        ...fixture,
        signInOutput: {
          ...fixture.signInOutput,
          signedMessage: tampered.toString("base64"),
        },
      }),
    ).rejects.toBeInstanceOf(WalletSignatureVerificationError);
  });

  it.each([
    ["UTC", "2026-08-11T12:00:00.000Z", "2026-08-11T12:05:00.000Z"],
    [
      "PostgreSQL offset",
      "2026-08-11T12:00:00.138+00:00",
      "2026-08-11T12:05:00.138+00:00",
    ],
    [
      "nonzero offset",
      "2026-08-11T13:00:00.999+01:00",
      "2026-08-11T13:05:00.999+01:00",
    ],
  ])(
    "joins the challenge route, simulated signature and real proof route for %s without accepting altered expiry",
    async (_label, issuedAt, expiresAt) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://landed.test");
      vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:devnet");
      vi.stubEnv(
        "MEASUREMENT_DEVNET_RECEIVER_ADDRESS",
        "Vote111111111111111111111111111111111111111",
      );
      const sessionId = "f2000000-0000-4000-8000-000000000001";
      let retainedNonceHash: string | undefined;
      rpcMock.mockImplementation(
        async (name: string, args: Record<string, string>) => {
          if (name === "read_wallet_measurement_rule_context") {
            return {
              data: [
                {
                  rule_version_id: "61990000-0000-4000-8000-000000000001",
                  chain_id: "solana:devnet",
                  configured_environment: "devnet",
                  destination_address:
                    "Vote111111111111111111111111111111111111111",
                  native_amount_lamports: "1",
                },
              ],
              error: null,
            };
          }
          if (name === "issue_wallet_nonce_challenge_v2") {
            retainedNonceHash = args.target_nonce_hash;
            return {
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
                  issued_at: issuedAt,
                  expires_at: expiresAt,
                },
              ],
              error: null,
            };
          }
          if (name === "admit_wallet_signature_proof_attempt") {
            return { data: [{ eligibility: "admitted" }], error: null };
          }
          if (name === "record_verified_wallet_session_proof") {
            return {
              data: [
                {
                  proof_id: args.target_proof_id,
                  eligibility: "recorded",
                  verified_at: "2026-08-11T12:01:00.999+00:00",
                },
              ],
              error: null,
            };
          }
          throw new Error(`Unexpected database call: ${name}`);
        },
      );

      function request(path: string, body: unknown) {
        return new Request(`https://landed.test/api/wallet/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://landed.test",
            Cookie: `lnd_session=${sessionId}`,
          },
          body: JSON.stringify(body),
        });
      }

      const fixture = await signedFixture(async (walletAddress) => {
        const response = await issueChallenge(
          request("challenges", { walletAddress }),
        );
        expect(response.status).toBe(201);
        const challenge = walletNonceChallengeResponseSchema.parse(
          await response.json(),
        );
        expect(challenge.expiresAt).toBe(challenge.signInInput.expirationTime);
        expect(challenge.expiresAt).toBe(new Date(expiresAt).toISOString());
        expect(
          Date.parse(challenge.expiresAt) -
            Date.parse(challenge.signInInput.issuedAt),
        ).toBe(300_000);
        return challenge;
      });

      const altered = await recordProof(
        request("proofs", {
          ...fixture,
          signInInput: {
            ...fixture.signInInput,
            expirationTime: new Date(
              Date.parse(fixture.signInInput.expirationTime) + 1,
            ).toISOString(),
          },
        }),
      );
      expect(altered.status).toBe(401);
      expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
        "read_wallet_measurement_rule_context",
        "issue_wallet_nonce_challenge_v2",
        "admit_wallet_signature_proof_attempt",
      ]);

      const response = await recordProof(request("proofs", fixture));
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          challengeId: fixture.challengeId,
          proofId: expect.any(String),
          state: "verified",
        }),
      );
      const evidence = await verifyWalletSignatureProof(fixture);
      expect(evidence.nonceHash).toBe(retainedNonceHash);
      expect(rpcMock).toHaveBeenCalledWith(
        "record_verified_wallet_session_proof",
        expect.objectContaining({
          target_anonymous_session_id: sessionId,
          target_challenge_id: fixture.challengeId,
          target_wallet_address: fixture.signInInput.address,
          target_chain_id: "solana:devnet",
          target_domain: "landed.test",
          target_uri: "https://landed.test",
          target_issued_at: new Date(issuedAt).toISOString(),
          target_expires_at: new Date(expiresAt).toISOString(),
          target_nonce_hash: evidence.nonceHash,
          target_signature_hash: evidence.signatureHash,
          target_signed_message_hash: evidence.signedMessageHash,
        }),
      );
      expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
        "read_wallet_measurement_rule_context",
        "issue_wallet_nonce_challenge_v2",
        "admit_wallet_signature_proof_attempt",
        "admit_wallet_signature_proof_attempt",
        "record_verified_wallet_session_proof",
      ]);
      expect(logErrorMock).not.toHaveBeenCalled();
    },
  );
});
