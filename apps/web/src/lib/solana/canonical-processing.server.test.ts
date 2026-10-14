import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalityMock } = vi.hoisted(() => ({ finalityMock: vi.fn() }));

vi.mock("./finality.server", () => ({
  fetchFinalizedSignatureEvidence: finalityMock,
}));
vi.mock("./historical.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./historical.server")>()),
  fetchHeliusHistoricalPage: vi.fn(),
}));

import fixture from "../../../../../packages/solana/src/fixtures/helius-enhanced-normalization.json";

import {
  CanonicalProcessingError,
  processFinalizedRawChainEvent,
} from "./canonical-processing.server";
import { fetchHeliusHistoricalPage } from "./historical.server";
import { reconcileOnePage } from "../../inngest/reconcile-solana-history";

const rawEventId = "67000000-0000-4000-8000-000000000001";
const rawRow = {
  acquisition_source: "helius_webhook",
  configured_environment: "demo",
  integration_id: "67000000-0000-4000-8000-000000000002",
  project_id: "67000000-0000-4000-8000-000000000003",
  raw_chain_event_id: rawEventId,
  raw_payload: fixture,
  received_at: "2026-08-12T09:00:00.000789Z",
  transaction_signature: fixture.signature,
  transaction_slot: String(fixture.slot),
  workspace_id: "67000000-0000-4000-8000-000000000004",
};
const finalityEvidence = {
  confirmationStatus: "finalized",
  confirmations: null,
  contextSlot: String(fixture.slot + 8),
  method: "getSignatureStatuses",
  rpcResponse: {
    id: "landed-finality",
    jsonrpc: "2.0",
    result: {
      context: { slot: fixture.slot + 8 },
      value: [
        {
          confirmationStatus: "finalized",
          confirmations: null,
          err: null,
          slot: fixture.slot,
          status: { Ok: null },
        },
      ],
    },
  },
  signature: fixture.signature,
  transactionSlot: String(fixture.slot),
} as const;

describe("finalized raw chain processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finalityMock.mockResolvedValue(finalityEvidence);
  });

  it("normalizes once, verifies finality once and persists every transfer", async () => {
    let persistCount = 0;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_raw_chain_event_for_normalization") {
        return { data: [rawRow], error: null };
      }
      persistCount += 1;
      return {
        data: [
          {
            canonical_event_id: args.target_canonical_event_id,
            finality: "finalized",
            inserted: true,
            raw_chain_event_id: rawEventId,
          },
        ],
        error: null,
      };
    });

    const result = await processFinalizedRawChainEvent({ rpc }, rawEventId);

    expect(result.insertedCount).toBe(2);
    expect(result.canonicalEventIds).toHaveLength(2);
    expect(persistCount).toBe(2);
    expect(finalityMock).toHaveBeenCalledOnce();
    expect(finalityMock).toHaveBeenCalledWith(
      fixture.signature,
      String(fixture.slot),
    );
    expect(rpc).toHaveBeenCalledWith(
      "persist_finalized_canonical_chain_event",
      expect.objectContaining({
        target_canonical_payload: expect.objectContaining({
          ingestedAt: "2026-08-12T09:00:00.000Z",
        }),
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "get_raw_chain_event_for_normalization",
      { target_raw_chain_event_id: rawEventId },
    );
  });

  it("does not request finality when normalization emits no facts", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ...rawRow, raw_payload: { ...fixture, transactionError: {} } }],
      error: null,
    }));

    await expect(
      processFinalizedRawChainEvent({ rpc }, rawEventId),
    ).resolves.toEqual({
      canonicalEventIds: [],
      insertedCount: 0,
      issueCount: 1,
      rawChainEventId: rawEventId,
    });
    expect(finalityMock).not.toHaveBeenCalled();
  });

  it.each(["helius_webhook", "helius_backfill"] as const)(
    "reuses retained facts for duplicate %s sources without requiring their original raw source to change",
    async (acquisitionSource) => {
      const originalRawId = "67000000-0000-4000-8000-000000000005";
      const retainedIds = [
        "67000000-0000-4000-8000-000000000006",
        "67000000-0000-4000-8000-000000000007",
      ];
      let persisted = 0;
      const rpc = vi.fn(async (name: string) =>
        name === "get_raw_chain_event_for_normalization"
          ? {
              data: [{ ...rawRow, acquisition_source: acquisitionSource }],
              error: null,
            }
          : {
              data: [
                {
                  canonical_event_id: retainedIds[persisted++],
                  finality: "finalized",
                  inserted: false,
                  raw_chain_event_id: originalRawId,
                },
              ],
              error: null,
            },
      );

      await expect(
        processFinalizedRawChainEvent({ rpc }, rawEventId),
      ).resolves.toEqual({
        canonicalEventIds: retainedIds,
        insertedCount: 0,
        issueCount: 0,
        rawChainEventId: rawEventId,
      });
      expect(finalityMock).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith(
        "persist_finalized_canonical_chain_event",
        expect.objectContaining({ target_raw_chain_event_id: rawEventId }),
      );
    },
  );

  it("rejects another raw identity before finality or persistence", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          ...rawRow,
          raw_chain_event_id: "67000000-0000-4000-8000-000000000005",
        },
      ],
      error: null,
    }));
    await expect(
      processFinalizedRawChainEvent({ rpc }, rawEventId),
    ).rejects.toThrow(
      "Raw chain normalization evidence did not match the request.",
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(finalityMock).not.toHaveBeenCalled();
  });

  it("checkpoints a historical page through the real normalizer when webhook facts already exist", async () => {
    // Sanitized transport fixture: real worker + normalizer + receipt validation,
    // mocked provider/finality/SQL. No live session or completeness claim.
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      transactions: [fixture],
      rawBody: JSON.stringify([fixture]),
      hasMore: false,
      nextBeforeSignature: null,
    });
    const jobId = "67000000-0000-4000-8000-000000000008";
    let canonicalCount = 0;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case "persist_helius_backfill_delivery":
          return {
            data: [
              {
                delivery_id: args.target_delivery_id,
                event_count: 1,
                inserted: true,
                raw_chain_event_ids: [rawEventId],
                received_at: rawRow.received_at,
              },
            ],
            error: null,
          };
        case "get_raw_chain_event_for_normalization":
          return {
            data: [
              {
                ...rawRow,
                acquisition_source: "helius_backfill",
                configured_environment: "devnet",
              },
            ],
            error: null,
          };
        case "persist_finalized_canonical_chain_event":
          canonicalCount += 1;
          return {
            data: [
              {
                canonical_event_id: `67000000-0000-4000-8000-00000000000${canonicalCount + 5}`,
                inserted: false,
                finality: "finalized",
                raw_chain_event_id: "67000000-0000-4000-8000-000000000005",
              },
            ],
            error: null,
          };
        case "complete_solana_reconciliation_page":
          return {
            data: [{ job_id: jobId, page_count: 1, status: "completed" }],
            error: null,
          };
        default:
          throw new Error("Unexpected synthetic RPC");
      }
    });
    await expect(
      reconcileOnePage({ rpc } as never, {
        configured_environment: "devnet",
        integration_id: rawRow.integration_id,
        job_id: jobId,
        next_before_signature: null,
        page_count: 0,
        range_started_at: "2026-08-12T08:00:00Z",
        range_ended_at: "2026-08-12T10:00:00Z",
        status: "queued",
        wallet_address: "So11111111111111111111111111111111111111112",
      }),
    ).resolves.toEqual({
      hasMore: false,
      insertedCount: 0,
      duplicateCount: 2,
      issueCount: 0,
      pageCount: 1,
      rawEventCount: 1,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_solana_reconciliation_page",
      {
        target_canonical_event_count: 0,
        target_duplicate_event_count: 2,
        target_expected_page_count: 0,
        target_has_more: false,
        target_job_id: jobId,
        target_next_before_signature: null,
        target_normalization_issue_count: 0,
        target_raw_event_count: 1,
      },
    );
  });

  it.each([
    {
      inserted: true,
      raw_chain_event_id: "67000000-0000-4000-8000-000000000005",
    },
    { inserted: false, raw_chain_event_id: "invalid" },
    { inserted: false, finality: "confirmed" },
    { inserted: false, canonical_event_id: "invalid" },
    { inserted: "false" },
  ])("rejects invalid persistence receipt %j", async (overrides) => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === "get_raw_chain_event_for_normalization"
        ? { data: [rawRow], error: null }
        : {
            data: [
              {
                canonical_event_id: args.target_canonical_event_id,
                finality: "finalized",
                raw_chain_event_id: rawEventId,
                ...overrides,
              },
            ],
            error: null,
          },
    );
    await expect(
      processFinalizedRawChainEvent({ rpc }, rawEventId),
    ).rejects.toThrow(
      "Canonical persistence evidence did not match the request.",
    );
  });

  it("preserves historical acquisition provenance through the same normalizer", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === "get_raw_chain_event_for_normalization"
        ? {
            data: [{ ...rawRow, acquisition_source: "helius_backfill" }],
            error: null,
          }
        : {
            data: [
              {
                canonical_event_id: args.target_canonical_event_id,
                finality: "finalized",
                inserted: true,
                raw_chain_event_id: rawEventId,
              },
            ],
            error: null,
          },
    );

    await processFinalizedRawChainEvent({ rpc }, rawEventId);

    expect(rpc).toHaveBeenCalledWith(
      "persist_finalized_canonical_chain_event",
      expect.objectContaining({
        target_canonical_payload: expect.objectContaining({
          source: "helius_backfill",
        }),
      }),
    );
  });

  it("fails closed for missing raw evidence or persistence mismatch", async () => {
    const missingRpc = vi.fn(async () => ({ data: [], error: null }));
    await expect(
      processFinalizedRawChainEvent({ rpc: missingRpc }, rawEventId),
    ).rejects.toThrow("Raw chain normalization evidence is incomplete");

    const mismatchRpc = vi.fn(async (name: string) =>
      name === "get_raw_chain_event_for_normalization"
        ? { data: [rawRow], error: null }
        : {
            data: [
              {
                canonical_event_id: crypto.randomUUID(),
                finality: "finalized",
                inserted: true,
                raw_chain_event_id: rawEventId,
              },
            ],
            error: null,
          },
    );
    await expect(
      processFinalizedRawChainEvent({ rpc: mismatchRpc }, rawEventId),
    ).rejects.toBeInstanceOf(CanonicalProcessingError);
  });
});
