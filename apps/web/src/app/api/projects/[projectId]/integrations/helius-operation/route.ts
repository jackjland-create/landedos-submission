import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

const decisionSchema = z.object({
  integrationId: z.uuid(),
  requestId: z.uuid(),
  decision: z.enum(["enabled", "disabled"]),
  reason: z.string().trim().min(8).max(500),
  controls: z.record(z.string(), z.unknown()),
});

const resultSchema = z
  .array(
    z.object({
      operational_version_id: z.uuid(),
      version: z.number().int().positive(),
      decision: z.enum(["enabled", "disabled"]),
      inserted: z.boolean(),
      approved_at: z.iso.datetime({ offset: true }),
      controls_sha256: z.string().regex(/^[0-9a-f]{64}$/),
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
  const parsed = decisionSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (projectId !== project.id || !parsed.success) {
    return privateJson({ message: "Operational decision was not valid." }, 400);
  }

  const input = parsed.data;
  if (
    (input.decision === "disabled" && Object.keys(input.controls).length > 0) ||
    (input.decision === "enabled" && Object.keys(input.controls).length === 0)
  ) {
    return privateJson({ message: "Operational decision was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc(
      "decide_helius_integration_operation",
      {
        target_project_id: project.databaseId,
        target_integration_id: input.integrationId,
        target_request_id: input.requestId,
        target_decision: input.decision,
        target_reason: input.reason,
        target_controls: input.controls,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Operational decisions require manager access." },
          403,
        );
      }
      if (["22023", "23503", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          { message: "The readiness pack conflicts with retained evidence." },
          409,
        );
      }
      const reference = logError({
        event: "helius_operational_decision_failed",
        error,
        projectId,
      });
      return privateJson(
        { message: "Operational decision could not be retained.", reference },
        500,
      );
    }

    const result = resultSchema.safeParse(data);
    if (!result.success) {
      const reference = logError({
        event: "helius_operational_decision_missing",
        error: result.error,
        projectId,
      });
      return privateJson(
        { message: "Operational decision could not be verified.", reference },
        500,
      );
    }

    const retained = result.data[0];
    return privateJson(
      {
        decision: {
          id: retained.operational_version_id,
          version: retained.version,
          state: retained.decision,
          inserted: retained.inserted,
          approvedAt: new Date(retained.approved_at).toISOString(),
          controlsSha256: retained.controls_sha256,
        },
      },
      retained.inserted ? 201 : 200,
    );
  } catch (error) {
    const reference = logError({
      event: "helius_operational_decision_failed",
      error,
      projectId,
    });
    return privateJson(
      { message: "Operational decision could not be retained.", reference },
      500,
    );
  }
}
