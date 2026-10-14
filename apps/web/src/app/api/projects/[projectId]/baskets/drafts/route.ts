import {
  createGoalLedBasketInputSchema,
  draftCustomBasket,
  draftFromPreparedBasket,
  getPreparedBasket,
} from "@landed/contracts";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { strategyFailure, strategyJson } from "@/lib/baskets/strategy-response";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  if (projectId !== project.id)
    return strategyJson({ message: "Project was not found." }, 404);
  const parsed = createGoalLedBasketInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return strategyJson({ message: "Basket setup was not valid." }, 400);
  const input = parsed.data;
  const template =
    input.kind === "prepared"
      ? getPreparedBasket(input.templateKey, input.templateVersion)
      : null;
  if (input.kind === "prepared" && !template)
    return strategyJson(
      { message: "That prepared basket version is not available." },
      400,
    );
  const draft = template
    ? draftFromPreparedBasket(template, input.creatorIds)
    : draftCustomBasket({
        ...input,
        name: input.name!,
        selectedCreatorIds: input.creatorIds,
      });
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("create_goal_led_basket", {
      target_project_id: project.databaseId,
      basket_name: input.name ?? draft.name,
      initial_strategy: draft.strategy,
      creator_ids: draft.selectedCreatorIds,
      template_key: template?.key ?? null,
      template_version: template?.version ?? null,
    });
    if (error) return strategyFailure(error, projectId);
    return strategyJson({ basketId: z.uuid().parse(data) }, 201);
  } catch (error) {
    return strategyFailure(error, projectId);
  }
}
