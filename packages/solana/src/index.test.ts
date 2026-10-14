import { describe, expect, it } from "vitest";

import {
  assertHeliusWebhookAuthorization,
  HeliusWebhookAuthenticationError,
  HeliusWebhookConfigError,
  HeliusWebhookPayloadError,
  parseHeliusEnhancedWebhookPayload,
} from "./index";
import fixture from "./fixtures/helius-enhanced-transfer.json";

const signature = fixture.signature;

describe("Helius provider boundary", () => {
  it("constant-time authenticates the configured opaque header", () => {
    const token = "helius-test-auth-token-0123456789abcdef";
    expect(() => assertHeliusWebhookAuthorization(token, token)).not.toThrow();
    expect(() =>
      assertHeliusWebhookAuthorization(
        "helius-test-auth-token-0123456789abcdeg",
        token,
      ),
    ).toThrow(HeliusWebhookAuthenticationError);
    expect(() => assertHeliusWebhookAuthorization(null, token)).toThrow(
      HeliusWebhookAuthenticationError,
    );
  });

  it("fails closed for unsafe or missing server configuration", () => {
    expect(() => assertHeliusWebhookAuthorization("short", "short")).toThrow(
      HeliusWebhookConfigError,
    );
    expect(() =>
      assertHeliusWebhookAuthorization("a".repeat(32), "a".repeat(31)),
    ).toThrow(HeliusWebhookConfigError);
    expect(() =>
      assertHeliusWebhookAuthorization("a".repeat(32), `${"a".repeat(32)}\n`),
    ).toThrow(HeliusWebhookConfigError);
  });

  it("validates stable enhanced-event evidence and retains unknown fields", () => {
    const parsed = parseHeliusEnhancedWebhookPayload([fixture]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(fixture);
    expect(parsed[0].signature).toBe(signature);
    expect(
      parsed[0].accountData[0].tokenBalanceChanges[0].rawTokenAmount,
    ).toEqual({ decimals: 9, tokenAmount: "4200000000" });
    expect(parsed[0].nativeTransfers[0].amount).toBe(1_000_000);
    expect(parsed[0].tokenTransfers[0].tokenAmount).toBe(4.2);

    const providerDomainDecimals = structuredClone(fixture);
    providerDomainDecimals.accountData[0].tokenBalanceChanges[0].rawTokenAmount.decimals = 255;
    expect(() =>
      parseHeliusEnhancedWebhookPayload([providerDomainDecimals]),
    ).not.toThrow();
  });

  it("rejects malformed, empty and unbounded deliveries", () => {
    for (const payload of [
      null,
      {},
      [],
      [{ ...fixture, signature: "not-base58" }],
      [{ ...fixture, signature: "2".repeat(64) }],
      [{ ...fixture, feePayer: "2".repeat(32) }],
      [{ ...fixture, timestamp: 1.5 }],
      [
        {
          ...fixture,
          accountData: [
            {
              ...fixture.accountData[0],
              tokenBalanceChanges: [
                {
                  ...fixture.accountData[0].tokenBalanceChanges[0],
                  rawTokenAmount: { decimals: 256, tokenAmount: "1" },
                },
              ],
            },
          ],
        },
      ],
      [
        {
          ...fixture,
          nativeTransfers: [{ ...fixture.nativeTransfers[0], amount: -1 }],
        },
      ],
      [
        {
          ...fixture,
          accountData: [
            {
              ...fixture.accountData[0],
              tokenBalanceChanges: [
                {
                  ...fixture.accountData[0].tokenBalanceChanges[0],
                  rawTokenAmount: { decimals: 9, tokenAmount: "4.2" },
                },
              ],
            },
          ],
        },
      ],
      [
        {
          ...fixture,
          accountData: [
            {
              ...fixture.accountData[0],
              tokenBalanceChanges: [
                {
                  ...fixture.accountData[0].tokenBalanceChanges[0],
                  rawTokenAmount: {
                    decimals: 9,
                    tokenAmount: "18446744073709551616",
                  },
                },
              ],
            },
          ],
        },
      ],
      [
        {
          ...fixture,
          accountData: [
            {
              ...fixture.accountData[0],
              tokenBalanceChanges: [
                {
                  ...fixture.accountData[0].tokenBalanceChanges[0],
                  rawTokenAmount: {
                    decimals: 9,
                    tokenAmount: "-18446744073709551616",
                  },
                },
              ],
            },
          ],
        },
      ],
      Array.from({ length: 101 }, () => fixture),
    ]) {
      expect(() => parseHeliusEnhancedWebhookPayload(payload)).toThrow(
        HeliusWebhookPayloadError,
      );
    }
  });
});
