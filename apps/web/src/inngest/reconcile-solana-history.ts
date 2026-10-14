import { NonRetriableError } from "inngest";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  processFinalizedRawChainEvent,
  type CanonicalProcessingClient,
} from "@/lib/solana/canonical-processing.server";
import {
  fetchHeliusHistoricalPage,
  HeliusHistoricalConfigError,
} from "@/lib/solana/historical.server";
import { createAdminClient } from "@/lib/supabase/server";
import { createSameCopyProcessingClient } from "@/lib/solana/same-copy-processing.server";

import { inngest } from "./client";

const jobEventSchema = z.object({ jobId: z.uuid() });

const jobRowSchema = z
  .array(
    z.object({
      configured_environment: z.enum(["demo", "devnet", "mainnet"]),
      integration_id: z.uuid(),
      job_id: z.uuid(),
      next_before_signature: z.string().nullable(),
      page_count: z.number().int().min(0).max(1000),
      range_ended_at: z.iso.datetime({ offset: true }),
      range_started_at: z.iso.datetime({ offset: true }),
      status: z.enum(["queued", "running", "completed", "failed"]),
      wallet_address: z.string(),
    }),
  )
  .length(1);

const rawPersistenceSchema = z
  .array(
    z.object({
      delivery_id: z.uuid(),
      event_count: z.number().int().min(1).max(100),
      inserted: z.boolean(),
      raw_chain_event_ids: z.array(z.uuid()).min(1).max(100),
      received_at: z.iso.datetime({ offset: true }),
    }),
  )
  .length(1);

const pageCompletionSchema = z
  .array(
    z.object({
      job_id: z.uuid(),
      page_count: z.number().int().min(1).max(1000),
      status: z.enum(["running", "completed"]),
    }),
  )
  .length(1);

type ReconciliationClient = CanonicalProcessingClient;
function reconciliationClient(jobId: string): ReconciliationClient {
  return process.env.LANDED_SAME_COPY_PROCESSING !== undefined
    ? createSameCopyProcessingClient(jobId)
    : createAdminClient();
}

async function readJob(client: ReconciliationClient, jobId: string) {
  const { data, error } = await client.rpc("get_solana_reconciliation_job", {
    target_job_id: jobId,
  });
  if (error) throw error;
  const parsed = jobRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Reconciliation job evidence was incomplete.");
  }
  return parsed.data[0];
}

export async function reconcileOnePage(
  client: ReconciliationClient,
  job: z.infer<typeof jobRowSchema>[number],
) {
  const page = await fetchHeliusHistoricalPage({
    address: job.wallet_address,
    beforeSignature: job.next_before_signature,
    environment: job.configured_environment,
    rangeEndedAt: job.range_ended_at,
    rangeStartedAt: job.range_started_at,
  }).catch(async (error: unknown) => {
    if (!(error instanceof HeliusHistoricalConfigError)) throw error;
    // SOL-05: deterministic configuration rejection must settle as failed,
    // not spend the bounded session retrying an impossible provider request.
    // If settlement itself fails, leave the ordinary retry path intact.
    const failed = await client.rpc("fail_solana_reconciliation_job", {
      target_failure_code: "historical_provider_configuration_invalid",
      target_job_id: job.job_id,
    });
    if (failed.error) throw failed.error;
    throw new NonRetriableError(
      "Historical provider configuration was rejected.",
    );
  });

  let insertedCount = 0;
  let duplicateCount = 0;
  let issueCount = 0;

  if (page.transactions.length > 0) {
    const deliveryId = crypto.randomUUID();
    const persistence = await client.rpc("persist_helius_backfill_delivery", {
      target_delivery_id: deliveryId,
      target_job_id: job.job_id,
      target_raw_body: page.rawBody,
    });
    if (persistence.error) throw persistence.error;
    const retained = rawPersistenceSchema.safeParse(persistence.data);
    if (
      !retained.success ||
      retained.data[0].event_count !== page.transactions.length ||
      retained.data[0].raw_chain_event_ids.length !==
        page.transactions.length ||
      new Set(
        retained.data[0].raw_chain_event_ids.map((id) => id.toLowerCase()),
      ).size !== retained.data[0].raw_chain_event_ids.length ||
      (retained.data[0].inserted && retained.data[0].delivery_id !== deliveryId)
    ) {
      throw new Error(
        "Historical raw evidence did not match the provider page.",
      );
    }

    for (const rawEventId of retained.data[0].raw_chain_event_ids) {
      const result = await processFinalizedRawChainEvent(
        client as CanonicalProcessingClient,
        rawEventId,
      );
      insertedCount += result.insertedCount;
      duplicateCount += result.canonicalEventIds.length - result.insertedCount;
      issueCount += result.issueCount;
    }
  }

  const completion = await client.rpc("complete_solana_reconciliation_page", {
    target_canonical_event_count: insertedCount,
    target_duplicate_event_count: duplicateCount,
    target_expected_page_count: job.page_count,
    target_has_more: page.hasMore,
    target_job_id: job.job_id,
    target_next_before_signature: page.nextBeforeSignature,
    target_normalization_issue_count: issueCount,
    target_raw_event_count: page.transactions.length,
  });
  if (completion.error) throw completion.error;
  const completed = pageCompletionSchema.safeParse(completion.data);
  if (
    !completed.success ||
    completed.data[0].job_id !== job.job_id ||
    completed.data[0].page_count !== job.page_count + 1 ||
    completed.data[0].status !== (page.hasMore ? "running" : "completed")
  ) {
    throw new Error("Reconciliation checkpoint did not match the page.");
  }

  return {
    hasMore: completed.data[0].status === "running",
    insertedCount,
    duplicateCount,
    issueCount,
    pageCount: completed.data[0].page_count,
    rawEventCount: page.transactions.length,
  };
}

export const reconcileSolanaHistory = inngest.createFunction(
  {
    id: "solana-historical-reconciliation",
    name: "Reconcile Solana wallet history",
    concurrency: { limit: 1, key: "event.data.jobId" },
    idempotency: "event.data.jobId",
    retries: 4,
    onFailure: async ({ event }) => {
      const original = jobEventSchema.safeParse(event.data.event.data);
      if (!original.success) return;
      const client = reconciliationClient(original.data.jobId);
      const failure = await client.rpc("fail_solana_reconciliation_job", {
        target_failure_code: "job_retries_exhausted",
        target_job_id: original.data.jobId,
      });
      if (failure.error) {
        logError({
          event: "solana_reconciliation_failure_record_failed",
          error: failure.error,
          projectId: original.data.jobId,
        });
      }
    },
  },
  { event: "landed/solana.reconciliation.requested" },
  async ({ event, step }) => {
    const { jobId } = jobEventSchema.parse(event.data);
    const client = reconciliationClient(jobId);
    let hasMore = true;
    let pageNumber = 0;

    try {
      while (hasMore) {
        const result = await step.run(
          `reconcile-page-${pageNumber + 1}`,
          async () => {
            const job = await readJob(client, jobId);
            if (job.status === "completed") {
              return {
                hasMore: false,
                insertedCount: 0,
                duplicateCount: 0,
                issueCount: 0,
                pageCount: job.page_count,
                rawEventCount: 0,
              };
            }
            if (job.status === "failed") {
              throw new Error("Reconciliation job is already failed.");
            }
            return reconcileOnePage(client, job);
          },
        );
        hasMore = result.hasMore;
        pageNumber = result.pageCount;
        if (pageNumber >= 1000 && hasMore) {
          throw new Error("Reconciliation page limit was exhausted.");
        }
      }
    } catch (error) {
      logError({
        event: "solana_reconciliation_run_failed",
        error,
        projectId: jobId,
      });
      throw error;
    }

    return { jobId, pageCount: pageNumber, status: "completed" as const };
  },
);
