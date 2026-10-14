import {
  HeliusWebhookAuthenticationError,
  HeliusWebhookPayloadError,
} from "@landed/solana";
import { createHash } from "node:crypto";
import { inngest } from "@/inngest/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  getHeliusIngestionConfig,
  HeliusIngestionConfigError,
} from "@/lib/solana/helius-ingestion.server";
import { readAuthenticatedHeliusWebhookRequest } from "@/lib/solana/helius.server";
import {
  createAdminClient,
  SupabaseServerConfigError,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const persistenceResultSchema = z
  .array(
    z.object({
      delivery_id: z.uuid(),
      event_count: z.number().int().min(1).max(100),
      inserted: z.boolean(),
      received_at: z.iso.datetime({ offset: true }),
    }),
  )
  .length(1);

const rawEventIdSchema = z.array(z.object({ raw_chain_event_id: z.uuid() }));

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function emptyResponse(status: number) {
  return new NextResponse(null, { status, headers: responseHeaders });
}

export async function POST(request: Request) {
  let integrationId = "helius-ingestion";

  try {
    const config = getHeliusIngestionConfig();
    integrationId = config.integrationId;
    const delivery = await readAuthenticatedHeliusWebhookRequest(
      request,
      config.authorization,
    );
    const deliveryId = crypto.randomUUID();
    const credentialFingerprintSha256 = createHash("sha256")
      .update(config.authorization, "utf8")
      .digest("hex");
    const client = createAdminClient();
    const { data, error } = await client.rpc("persist_helius_raw_delivery", {
      target_delivery_id: deliveryId,
      target_credential_fingerprint_sha256: credentialFingerprintSha256,
      target_credential_version: config.credentialVersion,
      target_integration_id: config.integrationId,
      target_raw_body: delivery.rawBody,
    });

    if (error) {
      const reference = logError({
        event:
          error.code === "54000"
            ? "helius_raw_ingestion_capacity_exhausted"
            : error.code === "55000"
              ? "helius_ingestion_operationally_blocked"
              : "helius_raw_delivery_persist_failed",
        error,
        projectId: config.integrationId,
      });
      void reference;
      return emptyResponse(503);
    }

    const parsedResult = persistenceResultSchema.safeParse(data);
    if (
      !parsedResult.success ||
      (parsedResult.data[0].inserted &&
        parsedResult.data[0].delivery_id !== deliveryId) ||
      parsedResult.data[0].event_count !== delivery.transactions.length
    ) {
      const reference = logError({
        event: "helius_raw_delivery_evidence_mismatch",
        error: parsedResult.success
          ? new Error("Raw delivery evidence did not match the request.")
          : parsedResult.error,
        projectId: config.integrationId,
      });
      void reference;
      return emptyResponse(503);
    }

    const retainedDelivery = parsedResult.data[0];
    const rawEvents = await client.rpc("get_raw_chain_event_ids_for_delivery", {
      target_delivery_id: retainedDelivery.delivery_id,
    });
    const parsedRawEvents = rawEventIdSchema.safeParse(rawEvents.data);
    if (
      rawEvents.error ||
      !parsedRawEvents.success ||
      parsedRawEvents.data.length !== retainedDelivery.event_count
    ) {
      const reference = logError({
        event: "helius_raw_delivery_dispatch_evidence_missing",
        error: rawEvents.error ?? parsedRawEvents.error,
        projectId: config.integrationId,
      });
      void reference;
      return emptyResponse(503);
    }

    try {
      await inngest.send(
        parsedRawEvents.data.map(({ raw_chain_event_id: rawChainEventId }) => ({
          id: `raw-chain:${rawChainEventId}`,
          name: "landed/solana.raw-event.received" as const,
          data: { rawChainEventId },
        })),
      );
    } catch (error) {
      const reference = logError({
        event: "helius_raw_delivery_dispatch_failed",
        error,
        projectId: config.integrationId,
      });
      void reference;
      return emptyResponse(503);
    }

    return emptyResponse(200);
  } catch (error) {
    if (error instanceof HeliusWebhookAuthenticationError) {
      return emptyResponse(401);
    }

    if (error instanceof HeliusWebhookPayloadError) {
      return emptyResponse(400);
    }

    if (
      error instanceof HeliusIngestionConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return emptyResponse(503);
    }

    const reference = logError({
      event: "helius_raw_delivery_failed",
      error,
      projectId: integrationId,
    });
    void reference;
    return emptyResponse(503);
  }
}
