import "server-only";

import {
  assertHeliusWebhookAuthorization,
  type HeliusEnhancedWebhookPayload,
  HeliusWebhookPayloadError,
  parseHeliusEnhancedWebhookPayload,
} from "@landed/solana";

export const heliusWebhookMaxBodyBytes = 1_000_000;

async function readBoundedRequestBody(request: Request, maxBytes: number) {
  if (!request.body) {
    throw new HeliusWebhookPayloadError("Helius webhook body was missing.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HeliusWebhookPayloadError(
          "Helius webhook body exceeded the configured limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    body,
  );
}

export type AuthenticatedHeliusWebhookDelivery = {
  rawBody: string;
  rawPayload: unknown;
  transactions: HeliusEnhancedWebhookPayload;
};

export async function readAuthenticatedHeliusWebhookRequest(
  request: Request,
  expectedAuthorization: string,
): Promise<AuthenticatedHeliusWebhookDelivery> {
  assertHeliusWebhookAuthorization(
    request.headers.get("authorization"),
    expectedAuthorization,
  );

  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim() !==
    "application/json"
  ) {
    throw new HeliusWebhookPayloadError(
      "Helius webhook content type was not accepted.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > heliusWebhookMaxBodyBytes
  ) {
    throw new HeliusWebhookPayloadError(
      "Helius webhook content length was not accepted.",
    );
  }

  let rawBody: string;
  let rawPayload: unknown;
  try {
    rawBody = await readBoundedRequestBody(request, heliusWebhookMaxBodyBytes);
    rawPayload = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof HeliusWebhookPayloadError) throw error;
    throw new HeliusWebhookPayloadError(
      "Helius webhook JSON was not valid.",
      error,
    );
  }

  return {
    rawBody,
    rawPayload,
    transactions: parseHeliusEnhancedWebhookPayload(rawPayload),
  };
}

export async function parseAuthenticatedHeliusWebhookRequest(
  request: Request,
  expectedAuthorization: string,
) {
  return (
    await readAuthenticatedHeliusWebhookRequest(request, expectedAuthorization)
  ).transactions;
}
