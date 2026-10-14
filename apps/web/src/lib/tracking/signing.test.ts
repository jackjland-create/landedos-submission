import { describe, expect, it } from "vitest";

import {
  buildSignedTrackedLink,
  getTrackedLinkApplicationOrigin,
  parseTrackedLinkKeyring,
  serializeTrackedLinkPayload,
  signTrackedLinkPayload,
  TrackedLinkSigningConfigError,
  verifyTrackedLinkSignature,
} from "./signing.server";

const firstKey = Buffer.alloc(32, 1).toString("base64url");
const secondKey = Buffer.alloc(32, 2).toString("base64url");
const payload = {
  schemaVersion: 1 as const,
  linkId: "d1000000-0000-4000-8000-000000000001",
  campaignId: "a1000000-0000-4000-8000-000000000001",
  creatorId: "40000000-0000-4000-8000-000000000001",
  contentAssetId: "a5000000-0000-4000-8000-000000000001",
  expiresAt: "2026-09-10T12:00:00.000Z",
  keyVersion: 1,
};

describe("tracked-link signing", () => {
  it("parses a versioned keyring without exposing key material", () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "2",
      keysJson: JSON.stringify({ 1: firstKey, 2: secondKey }),
    });

    expect(keyring.activeKeyVersion).toBe(2);
    expect([...keyring.keys.keys()]).toEqual([1, 2]);
  });

  it("rejects missing, short and duplicated signing material", () => {
    expect(() =>
      parseTrackedLinkKeyring({
        activeKeyVersion: undefined,
        keysJson: undefined,
      }),
    ).toThrow(TrackedLinkSigningConfigError);
    expect(() =>
      parseTrackedLinkKeyring({
        activeKeyVersion: "1",
        keysJson: JSON.stringify({
          1: Buffer.alloc(8, 1).toString("base64url"),
        }),
      }),
    ).toThrow("at least 32 bytes");
    expect(() =>
      parseTrackedLinkKeyring({
        activeKeyVersion: "2",
        keysJson: JSON.stringify({ 1: firstKey, 2: firstKey }),
      }),
    ).toThrow("distinct key material");
    expect(() =>
      parseTrackedLinkKeyring({
        activeKeyVersion: "1",
        keysJson: JSON.stringify({ 1: `${firstKey}!` }),
      }),
    ).toThrow("canonical base64url");
  });

  it("serializes every attribution identity in a fixed order", () => {
    expect(serializeTrackedLinkPayload(payload)).toBe(
      [
        "schema_version=1",
        `link_id=${payload.linkId}`,
        `campaign_id=${payload.campaignId}`,
        `creator_id=${payload.creatorId}`,
        `content_asset_id=${payload.contentAssetId}`,
        `expires_at=${payload.expiresAt}`,
        "key_version=1",
      ].join("\n"),
    );
  });

  it("produces deterministic signatures that bind identity and expiry", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "1",
      keysJson: JSON.stringify({ 1: firstKey }),
    });
    const signature = await signTrackedLinkPayload(payload, keyring);

    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(signTrackedLinkPayload(payload, keyring)).resolves.toBe(
      signature,
    );
    await expect(
      signTrackedLinkPayload(
        { ...payload, expiresAt: "2026-09-11T12:00:00.000Z" },
        keyring,
      ),
    ).resolves.not.toBe(signature);
  });

  it("verifies canonical signatures and rejects forged or malformed values", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "1",
      keysJson: JSON.stringify({ 1: firstKey }),
    });
    const signature = await signTrackedLinkPayload(payload, keyring);

    await expect(
      verifyTrackedLinkSignature(payload, signature, keyring),
    ).resolves.toBe(true);
    await expect(
      verifyTrackedLinkSignature(
        { ...payload, contentAssetId: crypto.randomUUID() },
        signature,
        keyring,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyTrackedLinkSignature(payload, "not-a-signature", keyring),
    ).resolves.toBe(false);
  });

  it("fails closed when a retained link key is unavailable", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "2",
      keysJson: JSON.stringify({ 2: secondKey }),
    });

    await expect(
      verifyTrackedLinkSignature(payload, "a".repeat(43), keyring),
    ).rejects.toThrow("signing key 1 is unavailable");
  });

  it("keeps private campaign, creator and asset identities out of the URL", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "1",
      keysJson: JSON.stringify({ 1: firstKey }),
    });
    const result = await buildSignedTrackedLink({
      origin: "https://landed.example.test",
      payload,
      keyring,
    });

    expect(result.url).toContain(`/t/${payload.linkId}?signature=`);
    expect(result.url).not.toContain(payload.campaignId);
    expect(result.url).not.toContain(payload.creatorId);
    expect(result.url).not.toContain(payload.contentAssetId);
  });

  it("normalizes a configured application origin", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://landed.example.test/path";

    try {
      expect(getTrackedLinkApplicationOrigin()).toBe(
        "https://landed.example.test",
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });
});
