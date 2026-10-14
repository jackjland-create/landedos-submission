import {
  walletMeasurementConsentRequestSchema,
  walletMeasurementConsentResponseSchema,
  walletMeasurementConsentStatement,
  walletMeasurementConsentVersion,
  walletMeasurementHistoricalLookbackDays,
} from "@landed/contracts";
import { inngest } from "@/inngest/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  createAdminClient,
  SupabaseServerConfigError,
} from "@/lib/supabase/server";
import { readAnonymousSessionId } from "@/lib/tracking/session.server";
import {
  getWalletChallengeApplicationOrigin,
  requestMatchesWalletChallengeOrigin,
  WalletChallengeConfigError,
} from "@/lib/wallet/challenge.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const consentResultSchema = z
  .array(
    z.object({
      consent_id: z.uuid().nullable(),
      mapping_id: z.uuid().nullable(),
      wallet_address: z.string().nullable(),
      eligibility: z.enum(["accepted", "already_accepted", "not_accepted"]),
      accepted_at: z.iso.datetime({ offset: true }).nullable(),
      monitoring_ends_at: z.iso.datetime({ offset: true }).nullable(),
    }),
  )
  .length(1);

const reconciliationEnqueueSchema = z
  .array(
    z.object({
      job_id: z.uuid(),
      status: z.enum(["queued", "running", "completed", "failed"]),
      inserted: z.boolean(),
    }),
  )
  .length(1);

const activeConsentResultSchema = z
  .array(
    z.object({
      consent_id: z.uuid(),
      mapping_id: z.uuid(),
      accepted_at: z.iso.datetime({ offset: true }),
      monitoring_ends_at: z.iso.datetime({ offset: true }),
      reconciliation_state: z.enum([
        "queued",
        "completed",
        "attention_required",
      ]),
    }),
  )
  .max(1);

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

function unavailable(reference?: string) {
  return privateJson(
    {
      message: "Wallet consent is temporarily unavailable.",
      ...(reference ? { reference } : {}),
    },
    503,
  );
}

export async function GET(request: Request) {
  const anonymousSessionId = readAnonymousSessionId(request);
  if (!anonymousSessionId) {
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  }

  const projectId = "wallet-consent-recovery";

  try {
    const client = createAdminClient();
    const { data, error } = await client.rpc(
      "read_active_wallet_measurement_consent",
      { target_anonymous_session_id: anonymousSessionId },
    );
    const parsed = activeConsentResultSchema.safeParse(data);
    if (error || !parsed.success) {
      const reference = logError({
        event: "wallet_measurement_consent_recovery_failed",
        error: error ?? parsed.error,
        projectId,
      });
      return unavailable(reference);
    }
    const recovered = parsed.data[0];
    if (!recovered) {
      return new NextResponse(null, { status: 204, headers: privateHeaders });
    }

    return privateJson(
      walletMeasurementConsentResponseSchema.parse({
        consentId: recovered.consent_id,
        mappingId: recovered.mapping_id,
        state: "already_accepted",
        reconciliationState: recovered.reconciliation_state,
        consentVersion: walletMeasurementConsentVersion,
        consentStatement: walletMeasurementConsentStatement,
        historicalLookbackDays: walletMeasurementHistoricalLookbackDays,
        acceptedAt: recovered.accepted_at,
        monitoringEndsAt: recovered.monitoring_ends_at,
      }),
    );
  } catch (error) {
    if (error instanceof SupabaseServerConfigError) return unavailable();
    const reference = logError({
      event: "wallet_measurement_consent_recovery_failed",
      error,
      projectId,
    });
    return unavailable(reference);
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 2_048)
  ) {
    return privateJson(
      { message: "Wallet consent request was not valid." },
      400,
    );
  }

  const parsedBody = walletMeasurementConsentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  const anonymousSessionId = readAnonymousSessionId(request);

  if (!parsedBody.success) {
    return privateJson(
      { message: "Wallet consent must be explicitly accepted." },
      400,
    );
  }
  if (!anonymousSessionId) {
    return privateJson(
      { message: "Open the campaign link again before accepting consent." },
      410,
    );
  }

  const projectId = "wallet-consent";

  try {
    const applicationOrigin = getWalletChallengeApplicationOrigin(request.url);

    if (!requestMatchesWalletChallengeOrigin(request, applicationOrigin)) {
      return privateJson(
        { message: "Wallet consent origin was not accepted." },
        403,
      );
    }

    const consentId = crypto.randomUUID();
    const mappingId = crypto.randomUUID();
    const consentRequestId = crypto.randomUUID();
    const client = createAdminClient();
    const { data, error } = await client.rpc(
      "accept_wallet_measurement_consent",
      {
        target_accepted: parsedBody.data.accepted,
        target_anonymous_session_id: anonymousSessionId,
        target_consent_id: consentId,
        target_consent_request_id: consentRequestId,
        target_consent_version: parsedBody.data.consentVersion,
        target_mapping_id: mappingId,
        target_proof_id: parsedBody.data.proofId,
      },
    );

    if (error) {
      if (error.code === "22023") {
        return privateJson(
          { message: "Wallet consent was not accepted." },
          400,
        );
      }
      const reference = logError({
        event: "wallet_measurement_consent_failed",
        error,
        projectId,
      });
      return unavailable(reference);
    }

    const parsedResult = consentResultSchema.safeParse(data);
    if (!parsedResult.success) {
      const reference = logError({
        event: "wallet_measurement_consent_result_invalid",
        error: parsedResult.error,
        projectId,
      });
      return unavailable(reference);
    }

    const result = parsedResult.data[0];
    if (
      result.eligibility === "not_accepted" ||
      !result.consent_id ||
      !result.mapping_id ||
      !result.accepted_at ||
      !result.monitoring_ends_at
    ) {
      return privateJson(
        { message: "Wallet proof or campaign session was not eligible." },
        410,
      );
    }

    let reconciliationState: "queued" | "completed" | "attention_required" =
      "attention_required";

    if (
      result.eligibility === "accepted" ||
      result.eligibility === "already_accepted"
    ) {
      const integrationId = z
        .uuid()
        .safeParse(process.env.HELIUS_WEBHOOK_INTEGRATION_ID);
      if (!integrationId.success) {
        logError({
          event: "wallet_reconciliation_integration_missing",
          error: new Error("Helius integration is not configured."),
          projectId: result.mapping_id,
        });
      } else {
        const jobId = crypto.randomUUID();
        const requestId = crypto.randomUUID();
        const queued = await client.rpc("enqueue_solana_reconciliation_job", {
          target_integration_id: integrationId.data,
          target_job_id: jobId,
          target_mapping_id: result.mapping_id,
          target_request_id: requestId,
        });
        const parsedQueue = reconciliationEnqueueSchema.safeParse(queued.data);
        if (queued.error || !parsedQueue.success) {
          logError({
            event: "wallet_reconciliation_enqueue_failed",
            error: queued.error ?? parsedQueue.error,
            projectId: result.mapping_id,
          });
        } else {
          const retainedJob = parsedQueue.data[0];
          if (retainedJob.status === "completed") {
            reconciliationState = "completed";
          } else {
            try {
              await inngest.send({
                id: retainedJob.job_id,
                name: "landed/solana.reconciliation.requested",
                data: { jobId: retainedJob.job_id },
              });
              reconciliationState = "queued";
            } catch (error) {
              logError({
                event: "wallet_reconciliation_dispatch_failed",
                error,
                projectId: result.mapping_id,
              });
            }
          }
        }
      }
    }

    return privateJson(
      walletMeasurementConsentResponseSchema.parse({
        consentId: result.consent_id,
        mappingId: result.mapping_id,
        state: result.eligibility,
        reconciliationState,
        consentVersion: walletMeasurementConsentVersion,
        consentStatement: walletMeasurementConsentStatement,
        historicalLookbackDays: walletMeasurementHistoricalLookbackDays,
        acceptedAt: result.accepted_at,
        monitoringEndsAt: result.monitoring_ends_at,
      }),
      result.eligibility === "accepted" ? 201 : 200,
    );
  } catch (error) {
    if (
      error instanceof WalletChallengeConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return unavailable();
    }
    const reference = logError({
      event: "wallet_measurement_consent_failed",
      error,
      projectId,
    });
    return unavailable(reference);
  }
}
