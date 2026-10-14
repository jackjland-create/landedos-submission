import { NextResponse } from "next/server";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { logError } from "@/lib/observability";

const input = z.strictObject({ sourcePlanId: z.uuid(), requestId: z.uuid() });
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** BSK-08/09 / TRK-01. Draft setup only; existing local planning gate remains. */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ projectId: string; campaignId: string }>;
  },
) {
  if (!basketTimingEnabled(process.env))
    return json(
      { message: "Measurement planning is not enabled in this environment." },
      503,
    );
  const { projectId, campaignId } = await context.params;
  if (projectId !== project.id || !z.uuid().safeParse(campaignId).success)
    return json({ message: "Campaign was not found." }, 404);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ message: "The setup request was not valid." }, 400);
  try {
    const client = await createClient();
    const { data, error } = await client.rpc(
      "create_campaign_measurement_draft",
      {
        target_project_id: project.databaseId,
        target_campaign_id: campaignId,
        expected_source_plan_id: parsed.data.sourcePlanId,
        target_request_id: parsed.data.requestId,
      },
    );
    if (error) {
      if (error.code === "42501")
        return json({ message: "Campaign manager access is required." }, 403);
      if (["PT409", "P0002"].includes(error.code))
        return json(
          {
            message:
              "The approved source changed. Reload the campaign before continuing.",
          },
          409,
        );
      if (["22023", "23503", "23514", "55000"].includes(error.code))
        return json(
          {
            message:
              "The approved terms could not be copied safely. Review the source plan; it remains unchanged.",
          },
          422,
        );
      throw error;
    }
    return json(
      {
        basketId: z.uuid().parse(data),
        campaignId,
        sourcePlanId: parsed.data.sourcePlanId,
        requestId: parsed.data.requestId,
      },
      201,
    );
  } catch (error) {
    const reference = logError({
      event: "campaign_measurement_draft_failed",
      error,
      projectId,
      campaignId,
    });
    return json(
      {
        message:
          "Draft creation was not confirmed. Retry this same request to recover it safely.",
        reference,
      },
      500,
    );
  }
}
