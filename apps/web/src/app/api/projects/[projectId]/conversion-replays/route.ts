import {
  approveConversionReplayInputSchema,
  approveConversionReplayResponseSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const resultSchema = z
  .array(
    z.object({
      replay_run_id: z.uuid(),
      status: z.literal("queued"),
      inserted: z.boolean(),
      campaign_count: z.number().int().nonnegative(),
      source_started_at: z.iso.datetime({ offset: true }),
      source_ended_at: z.iso.datetime({ offset: true }),
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
  const parsedBody = approveConversionReplayInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (projectId !== project.id || !parsedBody.success) {
    return privateJson({ message: "Replay approval was not valid." }, 400);
  }

  const input = parsedBody.data;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("approve_conversion_replay_job", {
      target_approval_reason: input.approvalReason,
      target_approval_request_id: input.approvalRequestId,
      target_replay_job_id: input.replayJobId,
      target_replay_run_id: input.replayRunId,
    });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Replay approval requires campaign manager access." },
          403,
        );
      }
      if (
        error.code === "22023" &&
        (error.message?.includes("issued campaign baseline") ||
          error.message?.includes("no comparable report range"))
      ) {
        return privateJson(
          {
            message:
              "Issue a baseline report first. This rule has no comparable issued campaign report yet.",
          },
          409,
        );
      }
      if (["22023", "23503", "23505", "23514", "55000"].includes(error.code)) {
        return privateJson(
          { message: "Replay approval conflicts with retained evidence." },
          409,
        );
      }
      throw error;
    }

    const parsedResult = resultSchema.safeParse(data);
    if (!parsedResult.success) throw parsedResult.error;
    const result = parsedResult.data[0];

    await inngest.send({
      name: "landed/conversion.replay.approved",
      data: { replayRunId: result.replay_run_id },
      id: `conversion-replay-${result.replay_run_id}`,
    });

    return privateJson(
      approveConversionReplayResponseSchema.parse({
        replay: {
          id: result.replay_run_id,
          status: result.status,
          approved: result.inserted,
          campaignCount: result.campaign_count,
          sourceStartedAt: new Date(result.source_started_at).toISOString(),
          sourceEndedAt: new Date(result.source_ended_at).toISOString(),
        },
      }),
      result.inserted ? 202 : 200,
    );
  } catch (error) {
    const reference = logError({
      event: "conversion_replay_approval_failed",
      error,
      projectId,
    });
    return privateJson(
      {
        message:
          "Replay approval could not be confirmed. Retry the same request.",
        reference,
      },
      500,
    );
  }
}
