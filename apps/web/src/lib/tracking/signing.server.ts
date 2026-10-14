import "server-only";

import {
  trackedLinkPayloadSchema,
  type TrackedLinkPayload,
} from "@landed/contracts";
import { z } from "zod";

const keyringSchema = z.record(z.string().regex(/^\d+$/), z.string().min(1));

export class TrackedLinkSigningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackedLinkSigningConfigError";
  }
}

export type TrackedLinkKeyring = {
  activeKeyVersion: number;
  keys: ReadonlyMap<number, ArrayBuffer>;
};

function decodeSigningKey(encodedKey: string, keyVersion: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey) || encodedKey.length % 4 === 1) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${keyVersion} is not canonical base64url.`,
    );
  }

  let key: Buffer;

  try {
    key = Buffer.from(encodedKey, "base64url");
  } catch {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${keyVersion} is not base64url encoded.`,
    );
  }

  if (key.toString("base64url") !== encodedKey) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${keyVersion} is not canonical base64url.`,
    );
  }

  if (key.byteLength < 32) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${keyVersion} must contain at least 32 bytes.`,
    );
  }

  return Uint8Array.from(key).buffer;
}

export function parseTrackedLinkKeyring(input: {
  activeKeyVersion: string | undefined;
  keysJson: string | undefined;
}): TrackedLinkKeyring {
  const activeKeyVersion = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(input.activeKeyVersion);

  if (!activeKeyVersion.success || !input.keysJson) {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link signing is not configured.",
    );
  }

  let unparsedKeys: unknown;

  try {
    unparsedKeys = JSON.parse(input.keysJson);
  } catch {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link signing keys are not valid JSON.",
    );
  }

  const parsedKeys = keyringSchema.safeParse(unparsedKeys);

  if (!parsedKeys.success) {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link signing keys are not valid.",
    );
  }

  const keys = new Map<number, ArrayBuffer>();
  const fingerprints = new Set<string>();

  for (const [rawVersion, encodedKey] of Object.entries(parsedKeys.data)) {
    const keyVersion = Number(rawVersion);
    const key = decodeSigningKey(encodedKey, keyVersion);
    const fingerprint = Buffer.from(new Uint8Array(key)).toString("base64url");

    if (fingerprints.has(fingerprint)) {
      throw new TrackedLinkSigningConfigError(
        "Tracked-link signing key versions must use distinct key material.",
      );
    }

    fingerprints.add(fingerprint);
    keys.set(keyVersion, key);
  }

  if (!keys.has(activeKeyVersion.data)) {
    throw new TrackedLinkSigningConfigError(
      "The active tracked-link signing key version is missing.",
    );
  }

  return { activeKeyVersion: activeKeyVersion.data, keys };
}

export function getTrackedLinkKeyring() {
  return parseTrackedLinkKeyring({
    activeKeyVersion: process.env.TRACKING_SIGNING_ACTIVE_KEY_VERSION,
    keysJson: process.env.TRACKING_SIGNING_KEYS_JSON,
  });
}

export function getTrackedLinkApplicationOrigin(fallbackUrl?: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;

  if (!configuredOrigin && process.env.NODE_ENV === "production") {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link application origin is not configured.",
    );
  }

  const candidate = configuredOrigin ?? fallbackUrl;

  if (!candidate) {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link application origin is not configured.",
    );
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link application origin is not valid.",
    );
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TrackedLinkSigningConfigError(
      "Tracked-link application origin must use HTTPS.",
    );
  }

  return url.origin;
}

export function serializeTrackedLinkPayload(input: TrackedLinkPayload) {
  const payload = trackedLinkPayloadSchema.parse(input);

  return [
    `schema_version=${payload.schemaVersion}`,
    `link_id=${payload.linkId}`,
    `campaign_id=${payload.campaignId}`,
    `creator_id=${payload.creatorId}`,
    `content_asset_id=${payload.contentAssetId}`,
    `expires_at=${new Date(payload.expiresAt).toISOString()}`,
    `key_version=${payload.keyVersion}`,
  ].join("\n");
}

export async function signTrackedLinkPayload(
  input: TrackedLinkPayload,
  keyring: TrackedLinkKeyring,
) {
  const payload = trackedLinkPayloadSchema.parse(input);
  const keyBytes = keyring.keys.get(payload.keyVersion);

  if (!keyBytes) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${payload.keyVersion} is unavailable.`,
    );
  }

  const signingKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(serializeTrackedLinkPayload(payload)),
  );

  return Buffer.from(signature).toString("base64url");
}

export async function verifyTrackedLinkSignature(
  input: TrackedLinkPayload,
  signature: string,
  keyring: TrackedLinkKeyring,
) {
  const payload = trackedLinkPayloadSchema.parse(input);
  const keyBytes = keyring.keys.get(payload.keyVersion);

  if (!keyBytes) {
    throw new TrackedLinkSigningConfigError(
      `Tracked-link signing key ${payload.keyVersion} is unavailable.`,
    );
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;

  const signatureBytes = Buffer.from(signature, "base64url");

  if (signatureBytes.toString("base64url") !== signature) return false;

  const signingKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    signingKey,
    signatureBytes,
    new TextEncoder().encode(serializeTrackedLinkPayload(payload)),
  );
}

export async function buildSignedTrackedLink(input: {
  origin: string;
  payload: TrackedLinkPayload;
  keyring: TrackedLinkKeyring;
}) {
  const payload = trackedLinkPayloadSchema.parse(input.payload);
  const signature = await signTrackedLinkPayload(payload, input.keyring);
  const url = new URL(`/t/${payload.linkId}`, input.origin);
  url.searchParams.set("signature", signature);

  return { signature, url: url.toString() };
}
