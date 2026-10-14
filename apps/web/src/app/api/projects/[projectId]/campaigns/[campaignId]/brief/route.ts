import {
  campaignBriefMutationInputSchema,
  campaignBriefStatusSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string; campaignId: string }>;
};

const briefMutationResultSchema = z
  .array(
    z.object({
      brief_id: z.uuid(),
      brief_version: z.number().int().positive(),
      brief_status: campaignBriefStatusSchema,
      mutation_applied: z.boolean(),
      mutated_at: z.iso.datetime({ offset: true }),
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
  const parsedBody = campaignBriefMutationInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(campaignId).success ||
    !parsedBody.success
  ) {
    return privateJson(
      { message: "Campaign brief change was not valid." },
      400,
    );
  }

  try {
    const client = await createClient();
    const mutation = parsedBody.data;
    const { data, error } =
      mutation.action === "save"
        ? await client.rpc("save_campaign_brief_revision", {
            target_project_id: project.databaseId,
            target_campaign_id: campaignId,
            target_request_id: mutation.requestId,
            target_objective: mutation.objective,
            target_audience: mutation.audience,
            target_key_message: mutation.keyMessage,
            target_creator_direction: mutation.creatorDirection,
            target_compliance_notes: mutation.complianceNotes,
            revision_reason: mutation.reason,
          })
        : await client.rpc("transition_campaign_brief", {
            target_project_id: project.databaseId,
            target_campaign_id: campaignId,
            target_status: mutation.targetStatus,
            target_request_id: mutation.requestId,
            transition_reason: mutation.reason,
          });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Brief changes require campaign manager access." },
          403,
        );
      }

      if (["22023", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          {
            message:
              "The brief cannot make that change from its current state.",
          },
          409,
        );
      }

      const reference = logError({
        event: "campaign_brief_mutation_failed",
        error,
        projectId,
        campaignId,
      });

      return privateJson(
        { message: "Campaign brief could not be changed.", reference },
        500,
      );
    }

    const parsedResult = briefMutationResultSchema.safeParse(data);

    if (!parsedResult.success) {
      const reference = logError({
        event: "campaign_brief_mutation_missing",
        error: parsedResult.error,
        projectId,
        campaignId,
      });

      return privateJson(
        { message: "Campaign brief could not be changed.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];

    return privateJson({
      brief: {
        id: result.brief_id,
        version: result.brief_version,
        status: result.brief_status,
      },
      mutation: {
        applied: result.mutation_applied,
        at: result.mutated_at,
      },
    });
  } catch (error) {
    const reference = logError({
      event: "campaign_brief_mutation_failed",
      error,
      projectId,
      campaignId,
    });

    return privateJson(
      { message: "Campaign brief could not be changed.", reference },
      500,
    );
  }
}
