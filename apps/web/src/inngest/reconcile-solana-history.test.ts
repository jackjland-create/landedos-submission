import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const { closedReviewRestAllowed } = createRequire(import.meta.url)(
  resolve(
    process.cwd(),
    existsSync(resolve(process.cwd(), "scripts"))
      ? "scripts/lib/external-devnet-review-proxy.cjs"
      : "../../scripts/lib/external-devnet-review-proxy.cjs",
  ),
) as {
  closedReviewRestAllowed: (
    request: { url: string; method: string; headers: Record<string, string> },
    mode: string,
    serviceKey: string,
  ) => boolean;
};

vi.mock("@/lib/solana/canonical-processing.server", () => ({
  processFinalizedRawChainEvent: vi.fn(),
}));
vi.mock("@/lib/solana/historical.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/solana/historical.server")>()),
  fetchHeliusHistoricalPage: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

import { processFinalizedRawChainEvent } from "@/lib/solana/canonical-processing.server";
import {
  fetchHeliusHistoricalPage,
  HeliusHistoricalConfigError,
  HeliusHistoricalFetchError,
} from "@/lib/solana/historical.server";
import { NonRetriableError } from "inngest";

import { reconcileOnePage } from "./reconcile-solana-history";

const job = {
  configured_environment: "devnet" as const,
  integration_id: "64040000-0000-4000-8000-000000000001",
  job_id: "65050000-0000-4000-8000-000000000001",
  next_before_signature: null,
  page_count: 0,
  range_ended_at: "2026-08-12T12:00:00.000Z",
  range_started_at: "2026-05-14T12:00:00.000Z",
  status: "queued" as const,
  wallet_address: "So11111111111111111111111111111111111111112",
};

describe("SOL-05 reconciliation page runner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("settles deterministic provider configuration rejection without retaining or checkpointing evidence", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockRejectedValue(
      new HeliusHistoricalConfigError(),
    );
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await expect(
      reconcileOnePage({ rpc } as never, job),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "fail_solana_reconciliation_job",
      {
        target_failure_code: "historical_provider_configuration_invalid",
        target_job_id: job.job_id,
      },
    );
    expect(processFinalizedRawChainEvent).not.toHaveBeenCalled();
  });

  it("keeps settlement failure retryable instead of claiming the job was settled", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockRejectedValue(
      new HeliusHistoricalConfigError(),
    );
    const failure = new Error("settlement unavailable");
    const rpc = vi.fn().mockResolvedValue({ error: failure });
    await expect(reconcileOnePage({ rpc } as never, job)).rejects.toBe(failure);
  });

  it("leaves transient provider failures on the ordinary retry path", async () => {
    const failure = new HeliusHistoricalFetchError("provider status 503");
    vi.mocked(fetchHeliusHistoricalPage).mockRejectedValue(failure);
    const rpc = vi.fn();
    await expect(reconcileOnePage({ rpc } as never, job)).rejects.toBe(failure);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("real page kernel crosses the actual drain policy only with the exact synthetic service credential", async () => {
    // Provider, SQL and finality remain mocked: this closes the source-level
    // transport connection, not genuine ingestion or database completion proof.
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: false,
      nextBeforeSignature: null,
      rawBody: "[]",
      transactions: [],
    });
    const service = "synthetic-owned-service-token";
    for (const token of [service, "synthetic-anon", "synthetic-actor"]) {
      const rpc = vi.fn(async (name: string) =>
        closedReviewRestAllowed(
          {
            url: `/rest/v1/rpc/${name}`,
            method: "POST",
            headers: { apikey: token, authorization: `Bearer ${token}` },
          },
          "drain",
          service,
        )
          ? {
              data: [
                { job_id: job.job_id, page_count: 1, status: "completed" },
              ],
              error: null,
            }
          : { data: null, error: new Error("Synthetic proxy403") },
      );
      if (token === service)
        await expect(
          reconcileOnePage({ rpc } as never, job),
        ).resolves.toMatchObject({ hasMore: false, pageCount: 1 });
      else
        await expect(reconcileOnePage({ rpc } as never, job)).rejects.toThrow(
          "Synthetic proxy403",
        );
      expect(rpc).toHaveBeenCalledWith(
        "complete_solana_reconciliation_page",
        expect.objectContaining({ target_job_id: job.job_id }),
      );
    }
  });

  it("retains, normalizes and atomically checkpoints a historical page", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: true,
      nextBeforeSignature:
        "4nNtjezQMYBHvgSQmoRmJPiXGsPAWmJPoGSa64xanqrauogiVzFyGQhKeFataHGXq51jR2hjbzNTkPUpP787HAmL",
      rawBody: '[{"fixture":true}]',
      transactions: [{}, {}] as never,
    });
    vi.mocked(processFinalizedRawChainEvent)
      .mockResolvedValueOnce({
        canonicalEventIds: ["one"],
        insertedCount: 1,
        issueCount: 0,
        rawChainEventId: "67070000-0000-4000-8000-000000000001",
      })
      .mockResolvedValueOnce({
        canonicalEventIds: ["two"],
        insertedCount: 0,
        issueCount: 1,
        rawChainEventId: "67070000-0000-4000-8000-000000000002",
      });

    const rpc = vi
      .fn()
      .mockImplementationOnce(async (_name, input) => ({
        data: [
          {
            delivery_id: input.target_delivery_id,
            event_count: 2,
            inserted: true,
            raw_chain_event_ids: [
              "67070000-0000-4000-8000-000000000001",
              "67070000-0000-4000-8000-000000000002",
            ],
            received_at: "2026-08-12T12:00:01.000Z",
          },
        ],
        error: null,
      }))
      .mockResolvedValueOnce({
        data: [{ job_id: job.job_id, page_count: 1, status: "running" }],
        error: null,
      });

    await expect(reconcileOnePage({ rpc } as never, job)).resolves.toEqual({
      duplicateCount: 1,
      hasMore: true,
      insertedCount: 1,
      issueCount: 1,
      pageCount: 1,
      rawEventCount: 2,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "complete_solana_reconciliation_page",
      expect.objectContaining({
        target_canonical_event_count: 1,
        target_duplicate_event_count: 1,
        target_normalization_issue_count: 1,
        target_raw_event_count: 2,
      }),
    );
  });

  it("completes an empty terminal page without manufacturing raw evidence", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: false,
      nextBeforeSignature: null,
      rawBody: "[]",
      transactions: [],
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ job_id: job.job_id, page_count: 1, status: "completed" }],
      error: null,
    });

    await expect(
      reconcileOnePage({ rpc } as never, job),
    ).resolves.toMatchObject({
      hasMore: false,
      pageCount: 1,
      rawEventCount: 0,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(processFinalizedRawChainEvent).not.toHaveBeenCalled();
  });

  it("does not checkpoint when raw persistence fails", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: false,
      nextBeforeSignature: null,
      rawBody: '[{"fixture":true}]',
      transactions: [{}] as never,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("retention boundary rejected the page"),
    });

    await expect(reconcileOnePage({ rpc } as never, job)).rejects.toThrow(
      "retention boundary",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(processFinalizedRawChainEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["missing retained ID", ["67070000-0000-4000-8000-000000000001"]],
    [
      "case-equivalent duplicate retained ID",
      [
        "67070000-0000-4000-8000-00000000000a",
        "67070000-0000-4000-8000-00000000000A",
      ],
    ],
    [
      "duplicate retained ID",
      [
        "67070000-0000-4000-8000-000000000001",
        "67070000-0000-4000-8000-000000000001",
      ],
    ],
    [
      "extra retained ID",
      [
        "67070000-0000-4000-8000-000000000001",
        "67070000-0000-4000-8000-000000000002",
        "67070000-0000-4000-8000-000000000003",
      ],
    ],
  ])(
    "rejects %s before normalization or checkpoint",
    async (_label, rawIds) => {
      vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
        hasMore: false,
        nextBeforeSignature: null,
        rawBody: '[{"fixture":1},{"fixture":2}]',
        transactions: [{}, {}] as never,
      });
      const rpc = vi.fn().mockImplementation(async (_name, input) => ({
        data: [
          {
            delivery_id: input.target_delivery_id,
            event_count: 2,
            inserted: true,
            raw_chain_event_ids: rawIds,
            received_at: "2026-08-12T12:00:01.000Z",
          },
        ],
        error: null,
      }));
      await expect(reconcileOnePage({ rpc } as never, job)).rejects.toThrow(
        "Historical raw evidence did not match the provider page",
      );
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(processFinalizedRawChainEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, "completed"],
    [false, "running"],
  ] as const)(
    "rejects checkpoint status %s/%s that contradicts provider pagination",
    async (hasMore, status) => {
      vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
        hasMore,
        nextBeforeSignature: hasMore ? "cursor" : null,
        rawBody: '[{"fixture":true}]',
        transactions: [{}] as never,
      });
      vi.mocked(processFinalizedRawChainEvent).mockResolvedValue({
        canonicalEventIds: ["canonical"],
        insertedCount: 1,
        issueCount: 0,
        rawChainEventId: "67070000-0000-4000-8000-000000000001",
      });
      const rpc = vi
        .fn()
        .mockImplementationOnce(async (_name, input) => ({
          data: [
            {
              delivery_id: input.target_delivery_id,
              event_count: 1,
              inserted: true,
              raw_chain_event_ids: ["67070000-0000-4000-8000-000000000001"],
              received_at: "2026-08-12T12:00:01.000Z",
            },
          ],
          error: null,
        }))
        .mockResolvedValueOnce({
          data: [{ job_id: job.job_id, page_count: 1, status }],
          error: null,
        });
      await expect(reconcileOnePage({ rpc } as never, job)).rejects.toThrow(
        "Reconciliation checkpoint did not match the page",
      );
      expect(rpc).toHaveBeenCalledTimes(2);
    },
  );

  it("refuses a running acknowledgement for an empty terminal page", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: false,
      nextBeforeSignature: null,
      rawBody: "[]",
      transactions: [],
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ job_id: job.job_id, page_count: 1, status: "running" }],
      error: null,
    });
    await expect(reconcileOnePage({ rpc } as never, job)).rejects.toThrow(
      "Reconciliation checkpoint did not match the page",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(processFinalizedRawChainEvent).not.toHaveBeenCalled();
  });

  it("accepts a retained duplicate delivery only when the full unique event list is present", async () => {
    vi.mocked(fetchHeliusHistoricalPage).mockResolvedValue({
      hasMore: false,
      nextBeforeSignature: null,
      rawBody: '[{"fixture":true}]',
      transactions: [{}] as never,
    });
    vi.mocked(processFinalizedRawChainEvent).mockResolvedValue({
      canonicalEventIds: ["canonical"],
      insertedCount: 0,
      issueCount: 0,
      rawChainEventId: "67070000-0000-4000-8000-000000000001",
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            delivery_id: "67070000-0000-4000-8000-000000000099",
            event_count: 1,
            inserted: false,
            raw_chain_event_ids: ["67070000-0000-4000-8000-000000000001"],
            received_at: "2026-08-12T12:00:01.000Z",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ job_id: job.job_id, page_count: 1, status: "completed" }],
        error: null,
      });
    await expect(
      reconcileOnePage({ rpc } as never, job),
    ).resolves.toMatchObject({
      hasMore: false,
      insertedCount: 0,
      duplicateCount: 1,
      rawEventCount: 1,
    });
  });
});
