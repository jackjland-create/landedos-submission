import "server-only";

import {
  walletChainIdSchema,
  walletNonceChallengeResponseSchema,
  type WalletChainId,
  type WalletNonceChallengeResponse,
} from "@landed/contracts";

export const walletNonceChallengeMaxAgeSeconds = 5 * 60;
export const walletNonceChallengeStatement =
  "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.";

const noncePattern = /^[A-Za-z0-9]{32}$/;

export class WalletChallengeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletChallengeConfigError";
  }
}

export function getWalletMeasurementChainId(): WalletChainId {
  const configured = process.env.WALLET_MEASUREMENT_CHAIN_ID;
  if (!configured) return "solana:mainnet";

  const parsed = walletChainIdSchema.safeParse(configured);
  if (!parsed.success) {
    throw new WalletChallengeConfigError(
      "Wallet measurement chain is not configured correctly.",
    );
  }
  return parsed.data;
}

export function getWalletChallengeApplicationOrigin(fallbackUrl?: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;

  if (!configuredOrigin && process.env.NODE_ENV === "production") {
    throw new WalletChallengeConfigError(
      "Wallet challenge application origin is not configured.",
    );
  }

  const candidate = configuredOrigin ?? fallbackUrl;

  if (!candidate) {
    throw new WalletChallengeConfigError(
      "Wallet challenge application origin is not configured.",
    );
  }

  let origin: URL;

  try {
    origin = new URL(candidate);
  } catch {
    throw new WalletChallengeConfigError(
      "Wallet challenge application origin is not valid.",
    );
  }

  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new WalletChallengeConfigError(
      "Wallet challenge application origin must use HTTPS.",
    );
  }

  return origin.origin;
}

export function requestMatchesWalletChallengeOrigin(
  request: Request,
  applicationOrigin: string,
) {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin) return false;

  try {
    return new URL(requestOrigin).origin === applicationOrigin;
  } catch {
    return false;
  }
}

export function createWalletChallengeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

export async function hashWalletChallengeNonce(nonce: string) {
  if (!noncePattern.test(nonce)) {
    throw new TypeError("Wallet challenge nonce is not canonical.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(nonce),
  );

  return Buffer.from(digest).toString("hex");
}

export function buildWalletNonceChallengeResponse(input: {
  challengeId: string;
  walletAddress: string;
  applicationOrigin: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  statement: string;
  chainId: WalletChainId;
}): WalletNonceChallengeResponse {
  const origin = new URL(input.applicationOrigin);
  const expiresAt = new Date(input.expiresAt).toISOString();

  return walletNonceChallengeResponseSchema.parse({
    challengeId: input.challengeId,
    expiresAt,
    signInInput: {
      domain: origin.host,
      address: input.walletAddress,
      statement: input.statement,
      uri: origin.origin,
      version: "1",
      chainId: input.chainId,
      nonce: input.nonce,
      issuedAt: new Date(input.issuedAt).toISOString(),
      expirationTime: expiresAt,
      requestId: input.challengeId,
    },
  });
}
