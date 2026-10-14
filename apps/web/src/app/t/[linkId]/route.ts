import {
  trackedClickQueryParameter,
  trackedLinkDestinationSchema,
  trackedLinkPayloadSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  createAdminClient,
  SupabaseServerConfigError,
} from "@/lib/supabase/server";
import {
  createTrackedClickDedupeToken,
  hashTrackedClickDedupeToken,
  isDeclaredAutomatedAgent,
  readTrackedClickDedupeToken,
  trackedClickAutomatedAgentPolicyVersion,
  trackedClickDedupeCookieName,
  trackedClickDedupeMaxAgeSeconds,
} from "@/lib/tracking/quality.server";
import {
  getTrackedLinkKeyring,
  TrackedLinkSigningConfigError,
  verifyTrackedLinkSignature,
} from "@/lib/tracking/signing.server";
import {
  anonymousSessionCookieName,
  getAnonymousSessionCookieMaxAge,
} from "@/lib/tracking/session.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ linkId: string }>;
};

const trackedLinkRowSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  creator_id: z.uuid(),
  content_asset_id: z.uuid(),
  destination_url: z.string().trim().min(12).max(2048),
  expires_at: z.iso.datetime({ offset: true }),
  key_version: z.number().int().positive(),
});

const clickResultSchema = z
  .array(
    z.object({
      click_id: z.uuid(),
      eligibility: z.enum([
        "eligible",
        "invalid_signature",
        "revoked",
        "expired",
        "destination_not_approved",
        "rate_limited",
      ]),
      destination_url: z.string().trim().min(12).max(2048),
      requested_at: z.iso.datetime({ offset: true }),
      quality_outcome: z
        .enum(["qualified", "duplicate", "rejected"])
        .nullable(),
      session_id: z.uuid().nullable(),
      session_expires_at: z.iso.datetime({ offset: true }).nullable(),
      session_was_created: z.boolean(),
    }),
  )
  .length(1)
  .superRefine((rows, context) => {
    const result = rows[0];
    if (!result) return;

    const hasSession =
      result.session_id !== null && result.session_expires_at !== null;

    if (
      (result.eligibility === "eligible" && result.quality_outcome === null) ||
      (hasSession &&
        (result.eligibility !== "eligible" ||
          !["qualified", "duplicate"].includes(
            result.quality_outcome ?? "",
          ))) ||
      (!hasSession &&
        (result.session_id !== null ||
          result.session_expires_at !== null ||
          result.session_was_created ||
          ["qualified", "duplicate"].includes(result.quality_outcome ?? "")))
    ) {
      context.addIssue({
        code: "custom",
        message: "Anonymous session evidence does not match click quality.",
      });
    }
  });

const publicHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function unavailable(status: 404 | 410 | 429 | 503) {
  const message =
    status === 410
      ? "This tracked link is no longer active."
      : status === 429
        ? "Too many tracking requests. Try again shortly."
        : status === 503
          ? "Tracking is temporarily unavailable."
          : "This tracked link could not be verified.";

  return new NextResponse(message, {
    status,
    headers: {
      ...publicHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 204, headers: publicHeaders });
}

export async function GET(request: Request, context: RouteContext) {
  const { linkId } = await context.params;
  const signature = new URL(request.url).searchParams.get("signature") ?? "";

  if (
    !z.uuid().safeParse(linkId).success ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return unavailable(404);
  }

  let projectId = "public-tracking";

  try {
    const client = createAdminClient();
    const { data, error } = await client
      .from("tracked_links")
      .select(
        "id, project_id, campaign_id, creator_id, content_asset_id, destination_url, expires_at, key_version",
      )
      .eq("id", linkId)
      .maybeSingle();

    if (error) {
      const reference = logError({
        event: "tracked_link_lookup_failed",
        error,
        projectId,
      });

      return new NextResponse(
        `Tracking is temporarily unavailable. Reference: ${reference}`,
        {
          status: 503,
          headers: {
            ...publicHeaders,
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    if (!data) return unavailable(404);

    const link = trackedLinkRowSchema.parse(data);
    projectId = link.project_id;
    const payload = trackedLinkPayloadSchema.parse({
      schemaVersion: 1,
      linkId: link.id,
      campaignId: link.campaign_id,
      creatorId: link.creator_id,
      contentAssetId: link.content_asset_id,
      expiresAt: new Date(link.expires_at).toISOString(),
      keyVersion: link.key_version,
    });
    const keyring = getTrackedLinkKeyring();
    const signatureValid = await verifyTrackedLinkSignature(
      payload,
      signature,
      keyring,
    );
    const dedupeToken =
      readTrackedClickDedupeToken(request) ?? createTrackedClickDedupeToken();
    const dedupeKeyHash = signatureValid
      ? await hashTrackedClickDedupeToken({
          keyVersion: link.key_version,
          keyring,
          linkId: link.id,
          token: dedupeToken,
        })
      : null;
    const clickId = crypto.randomUUID();
    const { data: clickData, error: clickError } = await client.rpc(
      "record_tracked_link_click_v3",
      {
        target_automated_agent_detected: isDeclaredAutomatedAgent(request),
        target_automated_agent_policy_version:
          trackedClickAutomatedAgentPolicyVersion,
        target_click_id: clickId,
        target_dedupe_key_hash: dedupeKeyHash,
        target_link_id: link.id,
        target_signature_valid: signatureValid,
      },
    );

    if (clickError) {
      const reference = logError({
        event: "tracked_link_click_record_failed",
        error: clickError,
        projectId,
        campaignId: link.campaign_id,
        assetId: link.content_asset_id,
      });

      return new NextResponse(
        `Tracking is temporarily unavailable. Reference: ${reference}`,
        {
          status: 503,
          headers: {
            ...publicHeaders,
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    const parsedClick = clickResultSchema.safeParse(clickData);

    if (!parsedClick.success || parsedClick.data[0]?.click_id !== clickId) {
      logError({
        event: "tracked_link_click_record_missing",
        error: parsedClick.success
          ? new Error("Recorded click identity did not match the request.")
          : parsedClick.error,
        projectId,
        campaignId: link.campaign_id,
        assetId: link.content_asset_id,
      });
      return unavailable(503);
    }

    const click = parsedClick.data[0];

    if (click.eligibility === "rate_limited") return unavailable(429);
    if (click.eligibility === "invalid_signature") return unavailable(404);
    if (click.eligibility !== "eligible") return unavailable(410);

    const parsedDestination = trackedLinkDestinationSchema.safeParse(
      click.destination_url,
    );

    if (!parsedDestination.success) {
      logError({
        event: "tracked_link_eligible_destination_invalid",
        error: parsedDestination.error,
        projectId,
        campaignId: link.campaign_id,
        assetId: link.content_asset_id,
      });
      return unavailable(503);
    }

    const destination = new URL(parsedDestination.data);
    destination.searchParams.set(trackedClickQueryParameter, click.click_id);

    const response = NextResponse.redirect(destination, {
      status: 307,
      headers: publicHeaders,
    });

    response.cookies.set({
      name: trackedClickDedupeCookieName,
      value: dedupeToken,
      httpOnly: true,
      maxAge: trackedClickDedupeMaxAgeSeconds,
      path: "/t/",
      sameSite: "lax",
      secure: true,
    });

    if (click.session_id && click.session_expires_at) {
      const sessionMaxAge = getAnonymousSessionCookieMaxAge(
        click.session_expires_at,
      );

      if (sessionMaxAge <= 0) {
        logError({
          event: "anonymous_session_expired_before_delivery",
          error: new Error("Anonymous session expired before redirect."),
          projectId,
          campaignId: link.campaign_id,
          assetId: link.content_asset_id,
        });
        return unavailable(503);
      }

      response.cookies.set({
        name: anonymousSessionCookieName,
        value: click.session_id,
        httpOnly: true,
        maxAge: sessionMaxAge,
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    }

    return response;
  } catch (error) {
    if (
      error instanceof TrackedLinkSigningConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return unavailable(503);
    }

    const reference = logError({
      event: "tracked_link_redirect_failed",
      error,
      projectId,
    });

    return new NextResponse(
      `Tracking is temporarily unavailable. Reference: ${reference}`,
      {
        status: 503,
        headers: {
          ...publicHeaders,
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
    );
  }
}
