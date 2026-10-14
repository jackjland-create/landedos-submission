import {
  contentAssetStatusSchema,
  contentAssetTransitionInputSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    projectId: string;
    campaignId: string;
    assetId: string;
  }>;
};

const transitionResultSchema = z
  .array(
    z.object({
      content_asset_id: z.uuid(),
      content_asset_status: contentAssetStatusSchema,
      activity_id: z.uuid(),
      transition_applied: z.boolean(),
      transitioned_at: z.iso.datetime({ offset: true }),
    }),
  )
  .length(1);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { assetId, campaignId, projectId } = await context.params;
  const parsedBody = contentAssetTransitionInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(campaignId).success ||
    !z.uuid().safeParse(assetId).success ||
    !parsedBody.success
  ) {
    return privateJson({ message: "Deliverable change was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("transition_content_asset", {
      target_project_id: project.databaseId,
      target_campaign_id: campaignId,
      target_content_asset_id: assetId,
      target_status: parsedBody.data.targetStatus,
      target_request_id: parsedBody.data.requestId,
      target_evidence_url: parsedBody.data.evidenceUrl,
      transition_note: parsedBody.data.note,
    });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Deliverable changes require campaign manager access." },
          403,
        );
      }

      if (["22023", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          {
            message:
              "The deliverable cannot move to that state from its current state.",
          },
          409,
        );
      }

      const reference = logError({
        event: "content_asset_transition_failed",
        error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Deliverable state could not be changed.", reference },
        500,
      );
    }

    const parsedResult = transitionResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "content_asset_transition_missing",
        error: parsedResult.error,
        projectId,
        campaignId,
        assetId,
      });

      return privateJson(
        { message: "Deliverable state could not be changed.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];

    return privateJson({
      contentAsset: {
        id: result.content_asset_id,
        status: result.content_asset_status,
      },
      transition: {
        id: result.activity_id,
        applied: result.transition_applied,
        at: result.transitioned_at,
      },
    });
  } catch (error) {
    const reference = logError({
      event: "content_asset_transition_failed",
      error,
      projectId,
      campaignId,
      assetId,
    });

    return privateJson(
      { message: "Deliverable state could not be changed.", reference },
      500,
    );
  }
}
