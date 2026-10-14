import { describe, expect, it } from "vitest";

import {
  buildWalletNonceChallengeResponse,
  createWalletChallengeNonce,
  getWalletChallengeApplicationOrigin,
  getWalletMeasurementChainId,
  hashWalletChallengeNonce,
  requestMatchesWalletChallengeOrigin,
  walletNonceChallengeStatement,
} from "./challenge.server";

describe("wallet nonce challenge", () => {
  it("creates a canonical unpredictable nonce and stable digest", async () => {
    const first = createWalletChallengeNonce();
    const second = createWalletChallengeNonce();

    expect(first).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(second).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(second).not.toBe(first);
    await expect(hashWalletChallengeNonce(first)).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
    await expect(hashWalletChallengeNonce("not canonical")).rejects.toThrow(
      "Wallet challenge nonce is not canonical.",
    );
  });

  it("binds the standard sign-in input to the configured application origin", () => {
    expect(
      buildWalletNonceChallengeResponse({
        challengeId: "f1000000-0000-4000-8000-000000000001",
        walletAddress: "So11111111111111111111111111111111111111112",
        applicationOrigin: "https://landed.example.test",
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-08-11T12:05:00.000Z",
        statement: walletNonceChallengeStatement,
        chainId: "solana:devnet",
      }),
    ).toEqual(
      expect.objectContaining({
        challengeId: "f1000000-0000-4000-8000-000000000001",
        signInInput: expect.objectContaining({
          domain: "landed.example.test",
          uri: "https://landed.example.test",
          chainId: "solana:devnet",
          version: "1",
        }),
      }),
    );
  });

  it("selects only an explicitly supported measurement chain", () => {
    const previous = process.env.WALLET_MEASUREMENT_CHAIN_ID;

    try {
      delete process.env.WALLET_MEASUREMENT_CHAIN_ID;
      expect(getWalletMeasurementChainId()).toBe("solana:mainnet");
      process.env.WALLET_MEASUREMENT_CHAIN_ID = "solana:devnet";
      expect(getWalletMeasurementChainId()).toBe("solana:devnet");
      process.env.WALLET_MEASUREMENT_CHAIN_ID = "solana:testnet";
      expect(() => getWalletMeasurementChainId()).toThrow(
        "Wallet measurement chain is not configured correctly.",
      );
    } finally {
      if (previous === undefined)
        delete process.env.WALLET_MEASUREMENT_CHAIN_ID;
      else process.env.WALLET_MEASUREMENT_CHAIN_ID = previous;
    }
  });

  it.each([
    ["canonical UTC", "2026-08-11T12:00:00.138Z", "2026-08-11T12:05:00.138Z"],
    [
      "PostgreSQL UTC offset",
      "2026-08-11T12:00:00.138+00:00",
      "2026-08-11T12:05:00.138+00:00",
    ],
    [
      "nonzero offset",
      "2026-08-11T13:00:00.138+01:00",
      "2026-08-11T13:05:00.138+01:00",
    ],
  ])(
    "serializes one identical expiry for %s without extending validity",
    (_label, issuedAt, expiresAt) => {
      const response = buildWalletNonceChallengeResponse({
        challengeId: "f1000000-0000-4000-8000-000000000001",
        walletAddress: "So11111111111111111111111111111111111111112",
        applicationOrigin: "https://landed.example.test",
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt,
        expiresAt,
        statement: walletNonceChallengeStatement,
        chainId: "solana:devnet",
      });

      expect(response.expiresAt).toBe("2026-08-11T12:05:00.138Z");
      expect(response.signInInput.expirationTime).toBe(response.expiresAt);
      expect(Date.parse(response.expiresAt)).toBe(Date.parse(expiresAt));
      expect(
        Date.parse(response.expiresAt) -
          Date.parse(response.signInInput.issuedAt),
      ).toBe(300_000);
    },
  );

  it("does not serialize an invalid database expiry", () => {
    expect(() =>
      buildWalletNonceChallengeResponse({
        challengeId: "f1000000-0000-4000-8000-000000000001",
        walletAddress: "So11111111111111111111111111111111111111112",
        applicationOrigin: "https://landed.example.test",
        nonce: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-08-11T12:00:00.138+00:00",
        expiresAt: "invalid",
        statement: walletNonceChallengeStatement,
        chainId: "solana:devnet",
      }),
    ).toThrow();
  });

  it("rejects cross-origin challenge creation", () => {
    const request = new Request("https://landed.example.test/api/wallet", {
      method: "POST",
      headers: { Origin: "https://attacker.example.test" },
    });

    expect(
      requestMatchesWalletChallengeOrigin(
        request,
        "https://landed.example.test",
      ),
    ).toBe(false);
    expect(
      requestMatchesWalletChallengeOrigin(
        new Request("https://landed.example.test/api/wallet", {
          method: "POST",
          headers: { Origin: "https://landed.example.test" },
        }),
        "https://landed.example.test",
      ),
    ).toBe(true);
  });

  it("normalizes the configured origin without trusting request paths", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://landed.example.test/path";

    try {
      expect(getWalletChallengeApplicationOrigin()).toBe(
        "https://landed.example.test",
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });
});
