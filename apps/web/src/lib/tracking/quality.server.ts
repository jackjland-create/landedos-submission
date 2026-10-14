import "server-only";

import type { TrackedLinkKeyring } from "./signing.server";
import { TrackedLinkSigningConfigError } from "./signing.server";

export const trackedClickDedupeCookieName = "lnd_click_dedupe";
export const trackedClickDedupeMaxAgeSeconds = 30 * 60;
export const trackedClickAutomatedAgentPolicyVersion = 1;

const dedupeTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const automatedAgentPattern =
  /(?:bot|crawler|spider|slurp|headless|preview|facebookexternalhit|whatsapp|discordbot|telegrambot|curl|wget)/i;

function canonicalCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 1) continue;

    const candidateName = part.slice(0, separator).trim();
    const candidateValue = part.slice(separator + 1).trim();

    if (candidateName === name && dedupeTokenPattern.test(candidateValue)) {
      return candidateValue;
    }
  }

  return null;
}

export function readTrackedClickDedupeToken(request: Request) {
  return canonicalCookieValue(
    request.headers.get("cookie"),
    trackedClickDedupeCookieName,
  );
}

export function createTrackedClickDedupeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function isDeclaredAutomatedAgent(request: Request) {
  const userAgent = request.headers.get("user-agent");
  return userAgent ? automatedAgentPattern.test(userAgent) : false;
}

export async function hashTrackedClickDedupeToken(input: {
  keyVersion: number;
  keyring: TrackedLinkKeyring;
  linkId: string;
  token: string;
}) {
  if (!dedupeTokenPattern.test(input.token)) {
    throw new TypeError("Tracked-click deduplication token is not canonical.");
  }

  const keyBytes = input.keyring.keys.get(input.keyVersion);

  if (!keyBytes) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${input.keyVersion} is unavailable.`,
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `landed_click_quality_v1\nlink_id=${input.linkId}\ntoken=${input.token}`,
    ),
  );

  return Buffer.from(digest).toString("hex");
}
