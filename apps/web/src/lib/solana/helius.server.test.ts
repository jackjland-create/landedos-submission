import { describe, expect, it } from "vitest";

import {
  HeliusWebhookAuthenticationError,
  HeliusWebhookPayloadError,
} from "@landed/solana";

import {
  heliusWebhookMaxBodyBytes,
  parseAuthenticatedHeliusWebhookRequest,
  readAuthenticatedHeliusWebhookRequest,
} from "./helius.server";
import fixture from "../../../../../packages/solana/src/fixtures/helius-enhanced-transfer.json";

const token = "helius-test-auth-token-0123456789abcdef";
const body = JSON.stringify([fixture]);

function request(
  payload = body,
  authorization: string | null = token,
  contentType = "application/json",
) {
  const headers = new Headers({ "Content-Type": contentType });
  if (authorization) headers.set("Authorization", authorization);

  return new Request("https://landed.test/api/integrations/helius/webhook", {
    method: "POST",
    headers,
    body: payload,
  });
}

describe("Helius server request boundary", () => {
  it("authenticates before returning validated provider events", async () => {
    const events = await parseAuthenticatedHeliusWebhookRequest(
      request(),
      token,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TRANSFER");
  });

  it("retains the exact authenticated body beside validated transactions", async () => {
    const delivery = await readAuthenticatedHeliusWebhookRequest(
      request(body),
      token,
    );

    expect(delivery.rawBody).toBe(body);
    expect(delivery.rawPayload).toEqual([fixture]);
    expect(delivery.transactions[0]).toEqual(fixture);
  });

  it("rejects missing and forged authorization before payload parsing", async () => {
    await expect(
      parseAuthenticatedHeliusWebhookRequest(request("not-json", null), token),
    ).rejects.toBeInstanceOf(HeliusWebhookAuthenticationError);
    await expect(
      parseAuthenticatedHeliusWebhookRequest(
        request("not-json", `${token}-forged`),
        token,
      ),
    ).rejects.toBeInstanceOf(HeliusWebhookAuthenticationError);
  });

  it("rejects invalid content type and malformed JSON", async () => {
    await expect(
      parseAuthenticatedHeliusWebhookRequest(
        request(body, token, "text/plain"),
        token,
      ),
    ).rejects.toBeInstanceOf(HeliusWebhookPayloadError);
    await expect(
      parseAuthenticatedHeliusWebhookRequest(request("not-json"), token),
    ).rejects.toBeInstanceOf(HeliusWebhookPayloadError);

    const invalidUtf8 = new Request(
      "https://landed.test/api/integrations/helius/webhook",
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: new Uint8Array([0xc3, 0x28]).buffer,
      },
    );
    await expect(
      parseAuthenticatedHeliusWebhookRequest(invalidUtf8, token),
    ).rejects.toBeInstanceOf(HeliusWebhookPayloadError);

    const encodedBody = new TextEncoder().encode(body);
    const bomBody = new Uint8Array(encodedBody.byteLength + 3);
    bomBody.set([0xef, 0xbb, 0xbf]);
    bomBody.set(encodedBody, 3);
    const bomRequest = new Request(
      "https://landed.test/api/integrations/helius/webhook",
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: bomBody.buffer,
      },
    );
    await expect(
      readAuthenticatedHeliusWebhookRequest(bomRequest, token),
    ).rejects.toBeInstanceOf(HeliusWebhookPayloadError);
  });

  it("rejects a declared body beyond the byte limit before reading it", async () => {
    const oversized = request();
    oversized.headers.set(
      "Content-Length",
      String(heliusWebhookMaxBodyBytes + 1),
    );

    await expect(
      parseAuthenticatedHeliusWebhookRequest(oversized, token),
    ).rejects.toThrow("Helius webhook content length was not accepted.");
  });

  it("cancels chunked bodies at the byte limit", async () => {
    const chunk = new Uint8Array(600_000).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const oversized = new Request(
      "https://landed.test/api/integrations/helius/webhook",
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    await expect(
      parseAuthenticatedHeliusWebhookRequest(oversized, token),
    ).rejects.toThrow(`Helius webhook body exceeded the configured limit.`);
    expect(heliusWebhookMaxBodyBytes).toBe(1_000_000);
  });
});
