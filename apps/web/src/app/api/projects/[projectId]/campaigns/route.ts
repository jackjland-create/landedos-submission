import { createCampaignFromCommercialPlanInputSchema } from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

const campaignCreationResultSchema = z
  .array(
    z.object({
      campaign_id: z.uuid(),
      campaign_was_created: z.boolean(),
    }),
  )
  .length(1);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsedBody = createCampaignFromCommercialPlanInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (projectId !== project.id || !parsedBody.success) {
    return privateJson({ message: "Campaign request was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc(
      "create_campaign_from_commercial_plan",
      {
        target_project_id: project.databaseId,
        target_commercial_plan_version_id:
          parsedBody.data.commercialPlanVersionId,
        target_activation_request_id: parsedBody.data.activationRequestId,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Campaign creation requires campaign manager access." },
          403,
        );
      }

      if (["22023", "23503", "23505", "23514"].includes(error.code)) {
        return privateJson(
          {
            message:
              "The approved commercial plan could not be turned into a campaign.",
          },
          409,
        );
      }

      const reference = logError({
        event: "campaign_creation_failed",
        error,
        projectId,
      });

      return privateJson(
        { message: "Campaign could not be created.", reference },
        500,
      );
    }

    const parsedResult = campaignCreationResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "campaign_creation_missing",
        error: parsedResult.error,
        projectId,
      });

      return privateJson(
        { message: "Campaign could not be created.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];

    return privateJson(
      {
        campaign: {
          id: result.campaign_id,
          created: result.campaign_was_created,
        },
      },
      result.campaign_was_created ? 201 : 200,
    );
  } catch (error) {
    const reference = logError({
      event: "campaign_creation_failed",
      error,
      projectId,
    });

    return privateJson(
      { message: "Campaign could not be created.", reference },
      500,
    );
  }
}
