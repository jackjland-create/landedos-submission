import { createBasketInputSchema, draftCustomBasket } from "@landed/contracts";
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

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  if (projectId !== project.id) {
    return privateJson({ message: "Project was not found." }, 404);
  }

  const parsedBody = createBasketInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsedBody.success) {
    return privateJson(
      { message: "Select between 1 and 20 creators for basket setup." },
      400,
    );
  }

  if (
    new Set(parsedBody.data.creatorIds).size !==
    parsedBody.data.creatorIds.length
  ) {
    return privateJson(
      { message: "The selected creators could not be added to a basket." },
      400,
    );
  }

  try {
    const client = await createClient();
    const basketName = `${project.name} roster`;
    const draft = draftCustomBasket({
      name: basketName,
      selectedCreatorIds: parsedBody.data.creatorIds,
    });
    const { data, error } = await client.rpc("create_goal_led_basket", {
      target_project_id: project.databaseId,
      basket_name: basketName,
      initial_strategy: draft.strategy,
      creator_ids: parsedBody.data.creatorIds,
      template_key: null,
      template_version: null,
    });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Basket setup requires campaign manager access." },
          403,
        );
      }

      if (error.code === "22023") {
        return privateJson(
          {
            message: "The selected creators could not be added to a basket.",
          },
          400,
        );
      }

      const reference = logError({
        event: "basket_creation_failed",
        error,
        projectId,
      });

      return privateJson(
        {
          message: "Basket setup could not be created.",
          reference,
        },
        500,
      );
    }

    const parsedBasketId = z.uuid().safeParse(data);

    if (!parsedBasketId.success) {
      throw new Error("Basket creation returned an invalid identifier.");
    }

    return privateJson({ basketId: parsedBasketId.data }, 201);
  } catch (error) {
    const reference = logError({
      event: "basket_creation_failed",
      error,
      projectId,
    });

    return privateJson(
      {
        message: "Basket setup could not be created.",
        reference,
      },
      500,
    );
  }
}
