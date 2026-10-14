import "server-only";

import {
  canonicalSolanaTransferSchema,
  heliusEnhancedTransactionSchema,
  normalizeHeliusEnhancedTransaction,
} from "@landed/solana";
import { z } from "zod";

import { fetchFinalizedSignatureEvidence } from "./finality.server";

const rawNormalizationRowSchema = z.object({
  acquisition_source: z.enum(["helius_webhook", "helius_backfill"]),
  configured_environment: z.enum(["demo", "devnet", "mainnet"]),
  integration_id: z.uuid(),
  project_id: z.uuid(),
  raw_chain_event_id: z.uuid(),
  raw_payload: heliusEnhancedTransactionSchema,
  received_at: z.iso.datetime({ offset: true }),
  transaction_signature: z.string(),
  transaction_slot: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().safe(),
  ]),
  workspace_id: z.uuid(),
});

const rawNormalizationResultSchema = z
  .array(rawNormalizationRowSchema)
  .length(1);

const persistenceResultSchema = z
  .array(
    z.object({
      canonical_event_id: z.uuid(),
      finality: z.literal("finalized"),
      inserted: z.boolean(),
      raw_chain_event_id: z.uuid(),
    }),
  )
  .length(1);

export type CanonicalProcessingClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export class CanonicalProcessingError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CanonicalProcessingError";
    this.code = code;
  }
}

export type CanonicalProcessingResult = {
  canonicalEventIds: string[];
  insertedCount: number;
  issueCount: number;
  rawChainEventId: string;
};

export async function processFinalizedRawChainEvent(
  client: CanonicalProcessingClient,
  rawChainEventId: string,
): Promise<CanonicalProcessingResult> {
  const parsedId = z.uuid().safeParse(rawChainEventId);
  if (!parsedId.success) {
    throw new CanonicalProcessingError("Raw chain event identity is invalid.");
  }

  const rawResult = await client.rpc("get_raw_chain_event_for_normalization", {
    target_raw_chain_event_id: parsedId.data,
  });
  if (rawResult.error) {
    throw new CanonicalProcessingError(
      "Raw chain evidence could not be prepared.",
      rawResult.error.code,
    );
  }

  const parsedRawResult = rawNormalizationResultSchema.safeParse(
    rawResult.data,
  );
  if (!parsedRawResult.success) {
    const issuePaths = parsedRawResult.error.issues
      .flatMap((issue) =>
        issue.code === "invalid_union"
          ? issue.errors.flatMap((branch) =>
              branch.map(
                (nestedIssue) =>
                  `${nestedIssue.path.join(".") || "result"}:${nestedIssue.code}`,
              ),
            )
          : [`${issue.path.join(".") || "result"}:${issue.code}`],
      )
      .join(",");
    const resultShape =
      rawResult.data === null
        ? "null"
        : Array.isArray(rawResult.data)
          ? `array:${rawResult.data.length}`
          : typeof rawResult.data;
    throw new CanonicalProcessingError(
      `Raw chain normalization evidence is incomplete (${resultShape};${issuePaths}).`,
    );
  }

  const raw = parsedRawResult.data[0];
  if (raw.raw_chain_event_id !== parsedId.data) {
    throw new CanonicalProcessingError(
      "Raw chain normalization evidence did not match the request.",
    );
  }
  const transactionSlot = String(raw.transaction_slot);
  const normalization = normalizeHeliusEnhancedTransaction(raw.raw_payload, {
    ingestedAt: new Date(raw.received_at).toISOString(),
    projectId: raw.project_id,
    rawEvidenceId: raw.raw_chain_event_id,
    source: raw.acquisition_source,
    sourceEventId: raw.raw_chain_event_id,
    workspaceId: raw.workspace_id,
  });

  if (normalization.events.length === 0) {
    return {
      canonicalEventIds: [],
      insertedCount: 0,
      issueCount: normalization.issues.length,
      rawChainEventId: raw.raw_chain_event_id,
    };
  }

  const finalityEvidence = await fetchFinalizedSignatureEvidence(
    raw.transaction_signature,
    transactionSlot,
  );
  const canonicalEventIds: string[] = [];
  let insertedCount = 0;

  for (const event of normalization.events) {
    const parsedEvent = canonicalSolanaTransferSchema.parse(event);
    const canonicalEventId = crypto.randomUUID();
    const persistence = await client.rpc(
      "persist_finalized_canonical_chain_event",
      {
        target_canonical_event_id: canonicalEventId,
        target_canonical_payload: parsedEvent,
        target_finality_evidence: finalityEvidence,
        target_finality_observation_id: crypto.randomUUID(),
        target_raw_chain_event_id: raw.raw_chain_event_id,
      },
    );

    if (persistence.error) {
      throw new CanonicalProcessingError(
        "Finalized canonical chain evidence could not be persisted.",
        persistence.error.code,
      );
    }

    const parsedPersistence = persistenceResultSchema.safeParse(
      persistence.data,
    );
    if (
      !parsedPersistence.success ||
      (parsedPersistence.data[0].inserted &&
        (parsedPersistence.data[0].raw_chain_event_id !==
          raw.raw_chain_event_id ||
          parsedPersistence.data[0].canonical_event_id !== canonicalEventId))
    ) {
      throw new CanonicalProcessingError(
        "Canonical persistence evidence did not match the request.",
      );
    }

    // SOL-04's atomic kernel validates/links this raw source before returning.
    // A deduplicated receipt names the retained fact's original raw source,
    // which can differ when webhook and history observe the same transfer.
    // Only a newly inserted fact must carry this request's proposed identities.
    canonicalEventIds.push(parsedPersistence.data[0].canonical_event_id);
    insertedCount += Number(parsedPersistence.data[0].inserted);
  }

  return {
    canonicalEventIds,
    insertedCount,
    issueCount: normalization.issues.length,
    rawChainEventId: raw.raw_chain_event_id,
  };
}
