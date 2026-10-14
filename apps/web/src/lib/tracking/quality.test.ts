import { describe, expect, it } from "vitest";

import { parseTrackedLinkKeyring } from "./signing.server";
import {
  createTrackedClickDedupeToken,
  hashTrackedClickDedupeToken,
  isDeclaredAutomatedAgent,
  readTrackedClickDedupeToken,
  trackedClickAutomatedAgentPolicyVersion,
  trackedClickDedupeCookieName,
} from "./quality.server";

const firstKey = Buffer.alloc(32, 7).toString("base64url");
const secondKey = Buffer.alloc(32, 8).toString("base64url");
const token = Buffer.alloc(32, 9).toString("base64url");
const linkId = "d1000000-0000-4000-8000-000000000001";

describe("tracked-click quality signals", () => {
  it("declares the immutable MVP automated-agent policy version", () => {
    expect(trackedClickAutomatedAgentPolicyVersion).toBe(1);
  });

  it("creates opaque random tokens without browser or wallet identity", () => {
    const first = createTrackedClickDedupeToken();
    const second = createTrackedClickDedupeToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("reads only the exact canonical deduplication cookie", () => {
    const request = new Request("https://landed.example.test/t/link", {
      headers: {
        cookie: `other=value; ${trackedClickDedupeCookieName}=${token}; suffix=value`,
      },
    });

    expect(readTrackedClickDedupeToken(request)).toBe(token);
    expect(
      readTrackedClickDedupeToken(
        new Request("https://landed.example.test/t/link", {
          headers: {
            cookie: `${trackedClickDedupeCookieName}=not-canonical`,
          },
        }),
      ),
    ).toBeNull();
  });

  it("reduces declared automated agents to a boolean signal", () => {
    expect(
      isDeclaredAutomatedAgent(
        new Request("https://landed.example.test/t/link", {
          headers: { "user-agent": "Mozilla/5.0 Chrome/126 Safari/537.36" },
        }),
      ),
    ).toBe(false);
    expect(
      isDeclaredAutomatedAgent(
        new Request("https://landed.example.test/t/link", {
          headers: { "user-agent": "Discordbot/2.0" },
        }),
      ),
    ).toBe(true);
    expect(
      isDeclaredAutomatedAgent(
        new Request("https://landed.example.test/t/link"),
      ),
    ).toBe(false);
  });

  it("produces a deterministic, link-scoped and versioned keyed hash", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "2",
      keysJson: JSON.stringify({ 1: firstKey, 2: secondKey }),
    });
    const baseline = await hashTrackedClickDedupeToken({
      keyVersion: 1,
      keyring,
      linkId,
      token,
    });

    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      hashTrackedClickDedupeToken({
        keyVersion: 1,
        keyring,
        linkId,
        token,
      }),
    ).resolves.toBe(baseline);
    await expect(
      hashTrackedClickDedupeToken({
        keyVersion: 1,
        keyring,
        linkId: crypto.randomUUID(),
        token,
      }),
    ).resolves.not.toBe(baseline);
    await expect(
      hashTrackedClickDedupeToken({
        keyVersion: 2,
        keyring,
        linkId,
        token,
      }),
    ).resolves.not.toBe(baseline);
  });

  it("fails closed for malformed tokens or unavailable retained keys", async () => {
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: "2",
      keysJson: JSON.stringify({ 2: secondKey }),
    });

    await expect(
      hashTrackedClickDedupeToken({
        keyVersion: 2,
        keyring,
        linkId,
        token: "malformed",
      }),
    ).rejects.toThrow("not canonical");
    await expect(
      hashTrackedClickDedupeToken({
        keyVersion: 1,
        keyring,
        linkId,
        token,
      }),
    ).rejects.toThrow("key 1 is unavailable");
  });
});
