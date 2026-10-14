import { addBasketCreatorsInputSchema } from "@landed/contracts";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { strategyFailure, strategyJson } from "@/lib/baskets/strategy-response";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; basketId: string }> },
) {
  const { projectId, basketId } = await context.params;
  if (projectId !== project.id || !z.uuid().safeParse(basketId).success)
    return strategyJson({ message: "Basket was not found." }, 404);
  const parsed = addBasketCreatorsInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return strategyJson(
      { message: "Select between 1 and 20 creators for this basket." },
      400,
    );
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("add_basket_strategy_creators", {
      target_project_id: project.databaseId,
      target_basket_id: basketId,
      expected_revision: parsed.data.expectedRevision,
      creator_ids: parsed.data.creatorIds,
    });
    if (error) return strategyFailure(error, projectId);
    return strategyJson({ revision: z.number().int().positive().parse(data) });
  } catch (error) {
    return strategyFailure(error, projectId);
  }
}
