import { NextResponse } from "next/server";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/observability";

const inputSchema = z
  .object({ sourcePlanId: z.uuid(), requestId: z.uuid() })
  .strict();
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(
  request: Request,
  context: {
    params: Promise<{ projectId: string; basketId: string }>;
  },
) {
  const { projectId, basketId } = await context.params;
  if (projectId !== project.id || !z.uuid().safeParse(basketId).success)
    return json({ message: "Plan was not found." }, 404);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ message: "The draft request was not valid." }, 400);
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("create_basket_revision_draft", {
      target_project_id: project.databaseId,
      target_basket_id: basketId,
      source_plan_id: parsed.data.sourcePlanId,
      revision_request_id: parsed.data.requestId,
    });
    if (error) {
      if (error.code === "42501")
        return json(
          {
            message:
              "Creating a revised draft requires campaign manager access.",
          },
          403,
        );
      if (error.code === "P0002")
        return json(
          { message: "The approved source was not found. Reload the plan." },
          404,
        );
      if (error.code === "PT409")
        return json(
          {
            message:
              "The source or request changed. Reload the plan before continuing.",
          },
          409,
        );
      if (["22023", "23503", "23514"].includes(error.code))
        return json(
          {
            message:
              "The saved approval cannot be copied safely. Its retained creator, rule or terms details need review. The original is unchanged.",
          },
          422,
        );
      throw error;
    }
    const draftId = z.uuid().parse(data);
    if (draftId === basketId)
      throw new Error("Revision did not create an independent draft");
    return json(
      {
        basketId: draftId,
        sourcePlanId: parsed.data.sourcePlanId,
        requestId: parsed.data.requestId,
      },
      201,
    );
  } catch (error) {
    const reference = logError({
      event: "basket_revision_draft_failed",
      error,
      projectId,
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
