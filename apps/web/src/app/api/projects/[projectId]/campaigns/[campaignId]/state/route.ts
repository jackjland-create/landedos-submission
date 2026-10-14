import {
  campaignStatusSchema,
  campaignTransitionInputSchema,
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
  }>;
};

const campaignTransitionResultSchema = z
  .array(
    z.object({
      campaign_id: z.uuid(),
      campaign_status: campaignStatusSchema,
      transition_id: z.uuid(),
      transition_was_applied: z.boolean(),
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
  const { campaignId, projectId } = await context.params;
  const parsedBody = campaignTransitionInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(campaignId).success ||
    !parsedBody.success
  ) {
    return privateJson({ message: "Campaign transition was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("transition_campaign_state", {
      target_project_id: project.databaseId,
      target_campaign_id: campaignId,
      target_status: parsedBody.data.targetStatus,
      target_transition_request_id: parsedBody.data.transitionRequestId,
      transition_reason: parsedBody.data.reason,
    });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Campaign changes require campaign manager access." },
          403,
        );
      }

      if (["22023", "23505", "23514"].includes(error.code)) {
        return privateJson(
          {
            message:
              "The campaign cannot move to the requested state from its current state.",
          },
          409,
        );
      }

      const reference = logError({
        event: "campaign_transition_failed",
        error,
        projectId,
        campaignId,
      });

      return privateJson(
        { message: "Campaign state could not be changed.", reference },
        500,
      );
    }

    const parsedResult = campaignTransitionResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "campaign_transition_missing",
        error: parsedResult.error,
        projectId,
        campaignId,
      });

      return privateJson(
        { message: "Campaign state could not be changed.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];

    return privateJson({
      campaign: {
        id: result.campaign_id,
        status: result.campaign_status,
      },
      transition: {
        id: result.transition_id,
        applied: result.transition_was_applied,
        at: result.transitioned_at,
      },
    });
  } catch (error) {
    const reference = logError({
      event: "campaign_transition_failed",
      error,
      projectId,
      campaignId,
    });

    return privateJson(
      { message: "Campaign state could not be changed.", reference },
      500,
    );
  }
}
