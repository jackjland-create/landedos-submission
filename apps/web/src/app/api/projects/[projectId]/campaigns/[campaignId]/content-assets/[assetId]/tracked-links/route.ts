import {
  issueTrackedLinkInputSchema,
  revokeTrackedLinkInputSchema,
  trackedLinkDestinationSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";
import {
  buildSignedTrackedLink,
  getTrackedLinkApplicationOrigin,
  getTrackedLinkKeyring,
} from "@/lib/tracking/signing.server";

type RouteContext = {
  params: Promise<{
    projectId: string;
    campaignId: string;
    assetId: string;
  }>;
};

const issueResultSchema = z
  .array(
    z.object({
      tracked_link_id: z.uuid(),
      content_asset_id: z.uuid(),
      creator_id: z.uuid(),
      destination_url: trackedLinkDestinationSchema,
      expires_at: z.iso.datetime({ offset: true }),
      key_version: z.number().int().positive(),
      issued_at: z.iso.datetime({ offset: true }),
      link_was_created: z.boolean(),
    }),
  )
  .length(1);

const revokeResultSchema = z
  .array(
    z.object({
      tracked_link_id: z.uuid(),
      revoked_at: z.iso.datetime({ offset: true }),
      revocation_was_applied: z.boolean(),
    }),
  )
  .length(1);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function validContext(projectId: string, campaignId: string, assetId: string) {
  return (
    projectId === project.id &&
    z.uuid().safeParse(campaignId).success &&
    z.uuid().safeParse(assetId).success
  );
}

function mutationError(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return privateJson(
      { message: "Tracked-link changes require campaign manager access." },
      403,
    );
  }

  if (
    error.code === "22023" &&
    error.message?.includes("destination host is not approved")
  ) {
    return privateJson(
      {
        message:
          "This destination domain is outside the project's approved tracking policy.",
      },
      409,
    );
  }

  if (["22023", "23505", "23514", "55000"].includes(error.code ?? "")) {
    return privateJson(
      {
        message:
          "Tracking could not be changed in the campaign's current state.",
      },
      409,
    );
  }

  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const { assetId, campaignId, projectId } = await context.params;
  const parsedBody = issueTrackedLinkInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!validContext(projectId, campaignId, assetId) || !parsedBody.success) {
    return privateJson(
      { message: "Tracked-link issue request was not valid." },
      400,
    );
  }

  try {
    const keyring = getTrackedLinkKeyring();
    const origin = getTrackedLinkApplicationOrigin(request.url);
    const client = await createClient();
    const { data, error } = await client.rpc("issue_tracked_link", {
      target_project_id: project.databaseId,
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_generation_request_id: parsedBody.data.requestId,
      target_destination_url: parsedBody.data.destinationUrl,
      target_expires_at: parsedBody.data.expiresAt,
      target_key_version: keyring.activeKeyVersion,
    });

    if (error) {
      const response = mutationError(error);
      if (response) return response;

      const reference = logError({
        event: "tracked_link_issue_failed",
        error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Tracked link could not be issued.", reference },
        500,
      );
    }

    const parsedResult = issueResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "tracked_link_issue_missing",
        error: parsedResult.error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Tracked link could not be issued.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];
    const signedLink = await buildSignedTrackedLink({
      origin,
      keyring,
      payload: {
        schemaVersion: 1,
        linkId: result.tracked_link_id,
        campaignId,
        creatorId: result.creator_id,
        contentAssetId: result.content_asset_id,
        expiresAt: result.expires_at,
        keyVersion: result.key_version,
      },
    });

    return privateJson({
      trackedLink: {
        id: result.tracked_link_id,
        contentAssetId: result.content_asset_id,
        destinationUrl: result.destination_url,
        expiresAt: result.expires_at,
        keyVersion: result.key_version,
        issuedAt: result.issued_at,
        created: result.link_was_created,
        url: signedLink.url,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TrackedLinkSigningConfigError"
    ) {
      return privateJson(
        { message: "Tracked-link signing is not configured." },
        503,
      );
    }

    const reference = logError({
      event: "tracked_link_issue_failed",
      error,
      projectId,
      campaignId,
      assetId,
    });

    return privateJson(
      { message: "Tracked link could not be issued.", reference },
      500,
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { assetId, campaignId, projectId } = await context.params;
  const parsedBody = revokeTrackedLinkInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!validContext(projectId, campaignId, assetId) || !parsedBody.success) {
    return privateJson(
      { message: "Tracked-link revocation request was not valid." },
      400,
    );
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("revoke_tracked_link", {
      target_project_id: project.databaseId,
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_link_id: parsedBody.data.trackedLinkId,
      target_revocation_request_id: parsedBody.data.requestId,
      revocation_reason: parsedBody.data.reason,
    });

    if (error) {
      const response = mutationError(error);
      if (response) return response;

      const reference = logError({
        event: "tracked_link_revoke_failed",
        error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Tracked link could not be revoked.", reference },
        500,
      );
    }

    const parsedResult = revokeResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "tracked_link_revoke_missing",
        error: parsedResult.error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Tracked link could not be revoked.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];

    return privateJson({
      trackedLink: {
        id: result.tracked_link_id,
        revokedAt: result.revoked_at,
        revoked: result.revocation_was_applied,
      },
    });
  } catch (error) {
    const reference = logError({
      event: "tracked_link_revoke_failed",
      error,
      projectId,
      campaignId,
      assetId,
    });

    return privateJson(
      { message: "Tracked link could not be revoked.", reference },
      500,
    );
  }
}
