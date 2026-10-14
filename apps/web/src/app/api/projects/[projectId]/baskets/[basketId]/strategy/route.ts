import { saveBasketStrategyInputSchema } from "@landed/contracts";
import { getSavedBasketStrategy } from "@landed/db";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { strategyFailure, strategyJson } from "@/lib/baskets/strategy-response";

type Context = { params: Promise<{ projectId: string; basketId: string }> };
function valid(projectId: string, basketId: string) {
  return projectId === project.id && z.uuid().safeParse(basketId).success;
}

export async function GET(request: Request, context: Context) {
  const { projectId, basketId } = await context.params;
  if (!valid(projectId, basketId))
    return strategyJson({ message: "Basket was not found." }, 404);
  try {
    const client = await createClient();
    const expectedOwner = request.headers.get("X-Landed-Expected-Owner");
    if (expectedOwner !== null) {
      if (!z.uuid().safeParse(expectedOwner).success)
        return strategyJson({ message: "Invalid session context." }, 400);
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.id !== expectedOwner)
        return strategyJson(
          { message: "Sign in again before loading this basket." },
          403,
        );
    }
    const result = await getSavedBasketStrategy(
      client,
      project.databaseId,
      basketId,
    );
    return result
      ? strategyJson(result)
      : strategyJson({ message: "Basket was not found." }, 404);
  } catch (error) {
    return strategyFailure(error, projectId);
  }
}

export async function PUT(request: Request, context: Context) {
  const { projectId, basketId } = await context.params;
  if (!valid(projectId, basketId))
    return strategyJson({ message: "Basket was not found." }, 404);
  const parsed = saveBasketStrategyInputSchema
    .extend({ expectedOwnerId: z.uuid().optional() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return strategyJson({ message: "Basket strategy was not valid." }, 400);
  try {
    const client = await createClient();
    if (parsed.data.expectedOwnerId) {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.id !== parsed.data.expectedOwnerId)
        return strategyJson(
          { message: "Sign in again before changing this basket." },
          403,
        );
    }
    const { data, error } = await client.rpc("save_basket_strategy", {
      target_project_id: project.databaseId,
      target_basket_id: basketId,
      expected_revision: parsed.data.expectedRevision,
      basket_name: parsed.data.name,
      next_strategy: parsed.data.strategy,
    });
    if (error) return strategyFailure(error, projectId);
    return strategyJson({ revision: z.number().int().positive().parse(data) });
  } catch (error) {
    return strategyFailure(error, projectId);
  }
}
