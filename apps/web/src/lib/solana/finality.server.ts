import "server-only";

import {
  transactionSignatureSchema,
  verifyFinalizedSignatureStatus,
  type FinalizedSignatureEvidence,
} from "@landed/solana";
import { z } from "zod";

const rpcEndpointSchema = z.string().url();

function localSyntheticProviderEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV &&
    process.env.LANDED_LOCAL_DEVNET_REHEARSAL === "1"
  );
}

function acceptedRpcEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol === "https:") return true;
  return (
    localSyntheticProviderEnabled() &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}

export class SolanaFinalityConfigError extends Error {
  constructor() {
    super("Solana finality verification is not configured.");
    this.name = "SolanaFinalityConfigError";
  }
}

export class SolanaFinalityRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaFinalityRequestError";
  }
}

const maximumFinalityResponseBytes = 32_768;

async function readBoundedResponseBody(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength != null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > maximumFinalityResponseBytes)
  ) {
    throw new SolanaFinalityRequestError(
      "Solana finality response exceeded the configured limit.",
    );
  }

  if (!response.body) {
    throw new SolanaFinalityRequestError(
      "Solana finality provider returned an empty response.",
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumFinalityResponseBytes) {
        await reader.cancel();
        throw new SolanaFinalityRequestError(
          "Solana finality response exceeded the configured limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new SolanaFinalityRequestError(
      "Solana finality provider returned invalid UTF-8.",
    );
  }
}

export function getSolanaFinalityRpcEndpoint() {
  const parsedEndpoint = rpcEndpointSchema.safeParse(
    process.env.SOLANA_FINALITY_RPC_URL,
  );
  if (!parsedEndpoint.success || !acceptedRpcEndpoint(parsedEndpoint.data))
    throw new SolanaFinalityConfigError();
  return parsedEndpoint.data;
}

export async function fetchFinalizedSignatureEvidence(
  signature: string,
  transactionSlot: string,
  fetcher: typeof fetch = fetch,
): Promise<FinalizedSignatureEvidence> {
  const parsedSignature = transactionSignatureSchema.safeParse(signature);
  if (!parsedSignature.success) {
    throw new SolanaFinalityRequestError("Transaction signature is invalid.");
  }

  const response = await fetcher(getSolanaFinalityRpcEndpoint(), {
    body: JSON.stringify({
      id: "landed-finality",
      jsonrpc: "2.0",
      method: "getSignatureStatuses",
      params: [[parsedSignature.data], { searchTransactionHistory: true }],
    }),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });

  if (!response.ok) {
    throw new SolanaFinalityRequestError(
      "Solana finality provider did not return a successful response.",
    );
  }

  const rawResponse = await readBoundedResponseBody(response);

  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(rawResponse);
  } catch {
    throw new SolanaFinalityRequestError(
      "Solana finality provider returned malformed JSON.",
    );
  }

  return verifyFinalizedSignatureStatus(
    parsedResponse,
    parsedSignature.data,
    transactionSlot,
  );
}
