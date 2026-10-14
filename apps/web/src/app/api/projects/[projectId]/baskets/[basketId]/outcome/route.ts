import { saveBasketOutcomeInputSchema } from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    projectId: string;
    basketId: string;
  }>;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId, basketId } = await context.params;
  const parsedBody = saveBasketOutcomeInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success ||
    !parsedBody.success
  ) {
    return privateJson({ message: "Outcome setup was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client
      .from("baskets")
      .update({
        objective: parsedBody.data.objective,
        outcome_metric: parsedBody.data.outcomeProfile.metric,
        outcome_baseline_units: parsedBody.data.outcomeProfile.baselineUnits,
        outcome_target_units: parsedBody.data.outcomeProfile.targetUnits,
        outcome_currency_code: parsedBody.data.outcomeProfile.currencyCode,
      })
      .eq("project_id", project.databaseId)
      .eq("id", basketId)
      .select(
        "objective, outcome_metric, outcome_baseline_units, outcome_target_units, outcome_currency_code",
      )
      .maybeSingle();

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Outcome changes require campaign manager access." },
          403,
        );
      }

      if (["22023", "23514"].includes(error.code)) {
        return privateJson({ message: "Outcome setup was not valid." }, 400);
      }

      const reference = logError({
        event: "basket_outcome_update_failed",
        error,
        projectId,
      });

      return privateJson(
        { message: "Outcome setup could not be saved.", reference },
        500,
      );
    }

    if (!data) {
      return privateJson({ message: "Basket was not found." }, 404);
    }

    return privateJson({
      objective: data.objective,
      outcomeProfile: {
        metric: data.outcome_metric,
        baselineUnits: String(data.outcome_baseline_units),
        targetUnits: String(data.outcome_target_units),
        currencyCode: data.outcome_currency_code,
      },
    });
  } catch (error) {
    const reference = logError({
      event: "basket_outcome_update_failed",
      error,
      projectId,
    });

    return privateJson(
      { message: "Outcome setup could not be saved.", reference },
      500,
    );
  }
}
