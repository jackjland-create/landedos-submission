import {
  assertHeliusWebhookAuthorization,
  HeliusWebhookAuthenticationError,
} from "@landed/solana";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  integrationId: z.uuid(),
  operationalVersionId: z.uuid(),
  requestId: z.uuid(),
  observedAt: z.iso.datetime({ offset: true }),
  oldestQueueAgeSeconds: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  terminalFailureCount: z.number().int().nonnegative(),
  callbackFailureCount: z.number().int().nonnegative(),
  evidenceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/),
});

const resultSchema = z
  .array(
    z.object({
      health_observation_id: z.uuid(),
      inserted: z.boolean(),
      within_thresholds: z.boolean(),
      observed_at: z.iso.datetime({ offset: true }),
    }),
  )
  .length(1);

function empty(status: number) {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const authorization = process.env.PILOT_HEALTH_MONITOR_AUTHORIZATION;
  if (!authorization) return empty(503);

  try {
    assertHeliusWebhookAuthorization(
      request.headers.get("authorization"),
      authorization,
    );
  } catch (error) {
    if (error instanceof HeliusWebhookAuthenticationError) return empty(401);
    return empty(503);
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return empty(400);

  try {
    const input = parsed.data;
    const { data, error } = await createAdminClient().rpc(
      "record_helius_integration_health",
      {
        target_integration_id: input.integrationId,
        target_operational_version_id: input.operationalVersionId,
        target_request_id: input.requestId,
        target_observed_at: input.observedAt,
        target_oldest_queue_age_seconds: input.oldestQueueAgeSeconds,
        target_retry_count: input.retryCount,
        target_terminal_failure_count: input.terminalFailureCount,
        target_callback_failure_count: input.callbackFailureCount,
        target_evidence_id: input.evidenceId,
      },
    );
    if (error) {
      const reference = logError({
        event: "helius_operational_health_rejected",
        error,
        projectId: input.integrationId,
      });
      void reference;
      return empty(error.code === "22023" ? 400 : 409);
    }
    if (!resultSchema.safeParse(data).success) {
      const reference = logError({
        event: "helius_operational_health_missing",
        error: new Error("Operational health evidence was incomplete."),
        projectId: input.integrationId,
      });
      void reference;
      return empty(503);
    }
    return empty(200);
  } catch (error) {
    const reference = logError({
      event: "helius_operational_health_failed",
      error,
      projectId: parsed.data.integrationId,
    });
    void reference;
    return empty(503);
  }
}
