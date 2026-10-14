import "server-only";

import {
  heliusEnhancedTransactionSchema,
  solanaAddressSchema,
  transactionSignatureSchema,
  type HeliusEnhancedWebhookPayload,
} from "@landed/solana";
import { z } from "zod";

const historicalPageSize = 100;
const historicalMaxResponseBytes = 1_000_000;

const historicalPageRequestSchema = z.object({
  address: solanaAddressSchema,
  beforeSignature: transactionSignatureSchema.nullable(),
  environment: z.enum(["demo", "devnet", "mainnet"]),
  rangeEndedAt: z.iso.datetime({ offset: true }),
  rangeStartedAt: z.iso.datetime({ offset: true }),
});

export class HeliusHistoricalConfigError extends Error {
  constructor(message = "Helius historical reconciliation is not configured.") {
    super(message);
    this.name = "HeliusHistoricalConfigError";
  }
}

export class HeliusHistoricalFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeliusHistoricalFetchError";
  }
}

async function readBoundedBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > historicalMaxResponseBytes ||
    !response.body
  ) {
    throw new HeliusHistoricalFetchError(
      "Helius historical response length was not accepted.",
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > historicalMaxResponseBytes) {
        await reader.cancel();
        throw new HeliusHistoricalFetchError(
          "Helius historical response exceeded the configured limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

function localSyntheticProviderEndpoint() {
  if (process.env.LANDED_LOCAL_DEVNET_REHEARSAL !== "1") return null;

  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV
  )
    throw new HeliusHistoricalConfigError(
      "Local synthetic history is unavailable in a hosted or production environment.",
    );

  const parsed = z
    .string()
    .url()
    .safeParse(process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL);
  if (!parsed.success)
    throw new HeliusHistoricalConfigError(
      "A valid loopback synthetic history endpoint is required for the local rehearsal.",
    );
  const url = new URL(parsed.data);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HeliusHistoricalConfigError(
      "The local rehearsal history endpoint must be credential-free loopback HTTP without query or fragment data.",
    );
  return url.origin;
}

function endpointForEnvironment(environment: "demo" | "devnet" | "mainnet") {
  if (environment === "mainnet") {
    throw new HeliusHistoricalConfigError(
      "Mainnet historical reconciliation is not enabled for the MVP pilot.",
    );
  }
  // INT-01 / SOL-05 / SEC-02: the isolated DB gate is also used by the
  // supervised production-built app. It is not a synthetic-provider selector.
  if (process.env.LANDED_EXTERNAL_DEVNET_SESSION === "1") {
    if (
      environment !== "devnet" ||
      process.env.LANDED_LOCAL_DEVNET_REHEARSAL !== "1" ||
      process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL !== undefined ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV
    ) {
      throw new HeliusHistoricalConfigError(
        "Supervised history requires isolated devnet without a synthetic endpoint or hosted deployment.",
      );
    }
    return "https://api-devnet.helius-rpc.com";
  }
  const localEndpoint = localSyntheticProviderEndpoint();
  if (localEndpoint) return localEndpoint;
  return "https://api-devnet.helius-rpc.com";
}

function unixSeconds(instant: string) {
  return Math.floor(new Date(instant).getTime() / 1_000);
}

function inclusiveLowerUnixSeconds(instant: string) {
  return Math.ceil(new Date(instant).getTime() / 1_000);
}

export type HeliusHistoricalPage = {
  hasMore: boolean;
  nextBeforeSignature: string | null;
  rawBody: string;
  transactions: HeliusEnhancedWebhookPayload;
};

export async function fetchHeliusHistoricalPage(
  input: z.input<typeof historicalPageRequestSchema>,
): Promise<HeliusHistoricalPage> {
  const request = historicalPageRequestSchema.parse(input);
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey || apiKey.length < 20 || /[\r\n\0]/.test(apiKey)) {
    throw new HeliusHistoricalConfigError();
  }

  const rangeStarted = new Date(request.rangeStartedAt);
  const rangeEnded = new Date(request.rangeEndedAt);
  if (
    rangeStarted >= rangeEnded ||
    rangeEnded.getTime() - rangeStarted.getTime() > 90 * 24 * 60 * 60 * 1_000
  ) {
    throw new HeliusHistoricalFetchError(
      "Historical reconciliation window was not accepted.",
    );
  }

  const url = new URL(
    `/v0/addresses/${encodeURIComponent(request.address)}/transactions`,
    endpointForEnvironment(request.environment),
  );
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("commitment", "finalized");
  url.searchParams.set("token-accounts", "balanceChanged");
  url.searchParams.set("sort-order", "desc");
  url.searchParams.set(
    "gte-time",
    String(inclusiveLowerUnixSeconds(request.rangeStartedAt)),
  );
  url.searchParams.set("lte-time", String(unixSeconds(request.rangeEndedAt)));
  url.searchParams.set("limit", String(historicalPageSize));
  if (request.beforeSignature) {
    url.searchParams.set("before-signature", request.beforeSignature);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new HeliusHistoricalFetchError(
      `Helius historical request failed with status ${response.status}.`,
    );
  }

  let rawBody: string;
  let rawPayload: unknown;
  try {
    rawBody = await readBoundedBody(response);
    rawPayload = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof HeliusHistoricalFetchError) throw error;
    throw new HeliusHistoricalFetchError(
      "Helius historical response was not valid JSON.",
    );
  }

  const transactions = z
    .array(heliusEnhancedTransactionSchema)
    .max(historicalPageSize)
    .safeParse(rawPayload);
  if (!transactions.success) {
    throw new HeliusHistoricalFetchError(
      "Helius historical response did not match the provider contract.",
    );
  }

  const lastTransaction = transactions.data.at(-1);
  if (
    transactions.data.length === historicalPageSize &&
    request.beforeSignature === lastTransaction?.signature
  ) {
    throw new HeliusHistoricalFetchError(
      "Helius historical cursor did not advance.",
    );
  }
  return {
    hasMore: transactions.data.length === historicalPageSize,
    nextBeforeSignature:
      transactions.data.length === historicalPageSize && lastTransaction
        ? lastTransaction.signature
        : null,
    rawBody,
    transactions: transactions.data,
  };
}
