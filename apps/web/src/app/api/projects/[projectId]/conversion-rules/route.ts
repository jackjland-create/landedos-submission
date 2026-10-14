import { configureConversionRuleInputSchema } from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const resultSchema = z
  .array(
    z.object({
      rule_id: z.uuid(),
      rule_version_id: z.uuid(),
      version: z.number().int().positive(),
      inserted: z.boolean(),
      created_at: z.iso.datetime({ offset: true }),
      replay_job_id: z.uuid().nullable(),
      affected_campaign_count: z.number().int().nonnegative(),
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
  const parsedBody = configureConversionRuleInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (projectId !== project.id || !parsedBody.success) {
    return privateJson(
      { message: "Conversion definition was not valid." },
      400,
    );
  }

  try {
    const client = await createClient();
    const input = parsedBody.data;
    const destinationBound = input.configuredEnvironment != null;
    const { data, error } = await client.rpc(
      destinationBound
        ? "configure_conversion_rule_version_v2"
        : "configure_conversion_rule_version",
      destinationBound
        ? {
            target_project_id: project.databaseId,
            target_rule_id: input.ruleId,
            target_rule_version_id: input.ruleVersionId,
            target_change_request_id: input.changeRequestId,
            target_template_code: input.templateCode,
            target_name: input.name,
            target_description: input.description,
            target_effective_from: input.effectiveFrom,
            target_effective_until: input.effectiveUntil,
            target_program_id: input.programId,
            target_event_discriminator: input.eventDiscriminator,
            target_configured_environment: input.configuredEnvironment,
            target_destination_address: input.destinationAddress,
            target_native_amount_lamports: input.nativeAmountLamports,
            target_change_reason: input.changeReason,
          }
        : {
            target_project_id: project.databaseId,
            target_rule_id: input.ruleId,
            target_rule_version_id: input.ruleVersionId,
            target_change_request_id: input.changeRequestId,
            target_template_code: input.templateCode,
            target_name: input.name,
            target_description: input.description,
            target_effective_from: input.effectiveFrom,
            target_effective_until: input.effectiveUntil,
            target_program_id: input.programId,
            target_event_discriminator: input.eventDiscriminator,
            target_change_reason: input.changeReason,
          },
    );

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Conversion changes require campaign manager access." },
          403,
        );
      }
      if (["22023", "23503", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          {
            message: "The conversion version conflicts with retained evidence.",
          },
          409,
        );
      }
      const reference = logError({
        event: "conversion_rule_configuration_failed",
        error,
        projectId,
      });
      return privateJson(
        { message: "Conversion definition could not be saved.", reference },
        500,
      );
    }

    const parsedResult = resultSchema.safeParse(data);
    if (!parsedResult.success) {
      const reference = logError({
        event: "conversion_rule_configuration_missing",
        error: parsedResult.error,
        projectId,
      });
      return privateJson(
        { message: "Conversion definition could not be saved.", reference },
        500,
      );
    }

    const result = parsedResult.data[0];
    return privateJson(
      {
        rule: {
          id: result.rule_id,
          versionId: result.rule_version_id,
          version: result.version,
          created: result.inserted,
          createdAt: new Date(result.created_at).toISOString(),
          replayJobId: result.replay_job_id,
          replayAvailable: result.replay_job_id !== null,
          affectedCampaignCount: result.affected_campaign_count,
        },
      },
      result.inserted ? 201 : 200,
    );
  } catch (error) {
    const reference = logError({
      event: "conversion_rule_configuration_failed",
      error,
      projectId,
    });
    return privateJson(
      { message: "Conversion definition could not be saved.", reference },
      500,
    );
  }
}
