import { setScenarioPackageInputSchema } from "@landed/contracts";
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
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, basketId } = await context.params;
  const parsedBody = setScenarioPackageInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success ||
    !parsedBody.success
  ) {
    return privateJson({ message: "Scenario update was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const [scenarioResult, packageResult] = await Promise.all([
      client
        .from("basket_scenarios")
        .select("id, workspace_id, project_id, basket_id")
        .eq("id", parsedBody.data.scenarioId)
        .eq("project_id", project.databaseId)
        .eq("basket_id", basketId)
        .maybeSingle(),
      client
        .from("creator_packages")
        .select("id, workspace_id, project_id, basket_id, creator_id")
        .eq("id", parsedBody.data.packageId)
        .eq("project_id", project.databaseId)
        .eq("basket_id", basketId)
        .maybeSingle(),
    ]);
    const scenario = scenarioResult.data;
    const creatorPackage = packageResult.data;
    const readError = scenarioResult.error ?? packageResult.error;

    if (readError) {
      if (readError.code !== "42501") {
        const reference = logError({
          event: "basket_assignment_failed",
          error: readError,
          projectId,
        });

        return privateJson(
          {
            message: "The scenario package could not be prepared.",
            reference,
          },
          500,
        );
      }

      return privateJson(
        {
          message: "Scenario changes require campaign manager access.",
        },
        403,
      );
    }

    if (!scenario || !creatorPackage) {
      return privateJson({ message: "Scenario package was not found." }, 404);
    }

    const mutation = parsedBody.data.included
      ? await client.from("basket_scenario_packages").insert({
          workspace_id: scenario.workspace_id,
          project_id: scenario.project_id,
          basket_id: scenario.basket_id,
          scenario_id: scenario.id,
          package_id: creatorPackage.id,
          creator_id: creatorPackage.creator_id,
        })
      : await client
          .from("basket_scenario_packages")
          .delete()
          .eq("scenario_id", scenario.id)
          .eq("package_id", creatorPackage.id);

    if (mutation.error) {
      if (mutation.error.code === "42501") {
        return privateJson(
          {
            message: "Scenario changes require campaign manager access.",
          },
          403,
        );
      }

      if (mutation.error.code === "23505") {
        return privateJson(
          { message: "This package is already included in the scenario." },
          409,
        );
      }

      if (["22023", "23503", "23514"].includes(mutation.error.code)) {
        return privateJson(
          { message: "The scenario package could not be updated." },
          400,
        );
      }

      const reference = logError({
        event: "basket_assignment_failed",
        error: mutation.error,
        projectId,
      });

      return privateJson(
        {
          message: "The scenario package could not be updated.",
          reference,
        },
        500,
      );
    }

    return privateJson({ included: parsedBody.data.included });
  } catch (error) {
    const reference = logError({
      event: "basket_assignment_failed",
      error,
      projectId,
    });

    return privateJson(
      {
        message: "The scenario package could not be updated.",
        reference,
      },
      500,
    );
  }
}
