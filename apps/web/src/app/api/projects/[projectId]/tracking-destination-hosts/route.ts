import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

const approvalSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),
  requestId: z.uuid(),
  reason: z.string().trim().min(8).max(240),
});

const resultSchema = z
  .array(
    z.object({
      destination_host_id: z.uuid(),
      hostname: z.string().min(1),
      added_at: z.iso.datetime({ offset: true }),
      host_was_added: z.boolean(),
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
  const parsed = approvalSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (projectId !== project.id || !parsed.success) {
    return privateJson(
      {
        message:
          "Enter one valid hostname, request ID and approval reason. Do not include https:// or a path.",
      },
      400,
    );
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc(
      "allow_project_tracking_destination_host",
      {
        target_project_id: project.databaseId,
        target_request_id: parsed.data.requestId,
        target_hostname: parsed.data.hostname.toLowerCase(),
        target_reason: parsed.data.reason,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          {
            message:
              "Destination approval requires signed-in workspace admin access.",
          },
          403,
        );
      }
      if (["22023", "23503", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          {
            message:
              "This approval conflicts with retained destination evidence. Check the exact hostname and request ID before retrying.",
          },
          409,
        );
      }
      const reference = logError({
        event: "tracking_destination_host_approval_failed",
        error,
        projectId,
      });
      return privateJson(
        { message: "Destination approval could not be retained.", reference },
        500,
      );
    }

    const result = resultSchema.safeParse(data);
    if (!result.success) {
      const reference = logError({
        event: "tracking_destination_host_approval_missing",
        error: result.error,
        projectId,
      });
      return privateJson(
        { message: "Destination approval could not be verified.", reference },
        500,
      );
    }

    const retained = result.data[0];
    return privateJson(
      {
        destinationHost: {
          id: retained.destination_host_id,
          hostname: retained.hostname,
          addedAt: new Date(retained.added_at).toISOString(),
          inserted: retained.host_was_added,
        },
      },
      retained.host_was_added ? 201 : 200,
    );
  } catch (error) {
    const reference = logError({
      event: "tracking_destination_host_approval_failed",
      error,
      projectId,
    });
    return privateJson(
      { message: "Destination approval could not be retained.", reference },
      500,
    );
  }
}
