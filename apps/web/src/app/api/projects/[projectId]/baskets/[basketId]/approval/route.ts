import {
  approveBasketScenarioInputSchema,
  calculateCommercialPlanSnapshotSpend,
  commercialPlanApprovalRecordSchema,
  commercialPlanReviewSchema,
} from "@landed/contracts";
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

const approvalRpcResultSchema = z
  .array(
    z.object({
      commercial_plan_version_id: z.uuid(),
      issued_scenario_id: z.uuid(),
      issued_scenario_code: z.enum(["A", "B", "C"]),
      issued_scenario_name: z.string(),
      issued_version: z.number().int().positive(),
      issued_by: z.uuid(),
      issued_at: z.iso.datetime({ offset: true }),
      issued_reason: z.string(),
      issued_snapshot_hash: z.string(),
    }),
  )
  .length(1);

const approvalPreviewRpcResultSchema = z
  .array(
    z.object({
      review_snapshot: z.unknown(),
      review_snapshot_hash: z.string(),
    }),
  )
  .length(1);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId, basketId } = await context.params;
  const scenarioId = new URL(request.url).searchParams.get("scenarioId");

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success ||
    !z.uuid().safeParse(scenarioId).success
  ) {
    return privateJson({ message: "Approval review was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc(
      "preview_basket_scenario_approval",
      {
        target_project_id: project.databaseId,
        target_basket_id: basketId,
        target_scenario_id: scenarioId,
      },
    );

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Commercial approval requires campaign manager access." },
          403,
        );
      }

      if (error.code === "22023") {
        return privateJson(
          { message: "The selected scenario is no longer available." },
          409,
        );
      }

      const reference = logError({
        event: "commercial_plan_review_failed",
        error,
        projectId,
      });

      return privateJson(
        { message: "Commercial plan review could not be prepared.", reference },
        500,
      );
    }

    const rpcResult = approvalPreviewRpcResultSchema.safeParse(data);
    const review = rpcResult.success
      ? commercialPlanReviewSchema.safeParse({
          snapshot: rpcResult.data[0].review_snapshot,
          snapshotHash: rpcResult.data[0].review_snapshot_hash,
        })
      : null;

    if (!rpcResult.success) {
      const reference = logError({
        event: "commercial_plan_review_missing",
        error: rpcResult.error,
        projectId,
      });

      return privateJson(
        { message: "Commercial plan review could not be prepared.", reference },
        500,
      );
    }

    if (!review?.success) {
      return privateJson(
        {
          code: "approval_blocked",
          message:
            "The commercial draft changed or is incomplete. Resolve its approval blockers and review again.",
        },
        409,
      );
    }

    const reviewSpend = calculateCommercialPlanSnapshotSpend(
      review.data.snapshot,
    );

    if (reviewSpend.status !== "single_currency") {
      return privateJson(
        {
          code: "approval_blocked",
          message:
            "The commercial draft changed or is incomplete. Resolve its approval blockers and review again.",
        },
        409,
      );
    }

    return privateJson({ review: review.data });
  } catch (error) {
    const reference = logError({
      event: "commercial_plan_review_failed",
      error,
      projectId,
    });

    return privateJson(
      { message: "Commercial plan review could not be prepared.", reference },
      500,
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, basketId } = await context.params;
  const parsedBody = approveBasketScenarioInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success ||
    !parsedBody.success
  ) {
    return privateJson({ message: "Approval request was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("approve_basket_scenario", {
      target_project_id: project.databaseId,
      target_basket_id: basketId,
      target_scenario_id: parsedBody.data.scenarioId,
      target_approval_request_id: parsedBody.data.approvalRequestId,
      approval_reason: parsedBody.data.reason,
      expected_snapshot_hash: parsedBody.data.expectedSnapshotHash,
    });

    if (error) {
      if (error.code === "42501") {
        return privateJson(
          { message: "Commercial approval requires campaign manager access." },
          403,
        );
      }

      if (error.code === "40001") {
        return privateJson(
          {
            code: "draft_changed",
            message:
              "Commercial plan changed. Review the latest draft before approval.",
          },
          409,
        );
      }

      if (["22023", "23503", "23514"].includes(error.code)) {
        return privateJson(
          { message: "Resolve every approval blocker before continuing." },
          409,
        );
      }

      const reference = logError({
        event: "commercial_plan_approval_failed",
        error,
        projectId,
      });

      return privateJson(
        { message: "Commercial plan could not be approved.", reference },
        500,
      );
    }

    const issuedResult = approvalRpcResultSchema.safeParse(data);

    if (!issuedResult.success) {
      const reference = logError({
        event: "commercial_plan_approval_missing",
        error: issuedResult.error,
        projectId,
      });

      return privateJson(
        { message: "Commercial plan could not be approved.", reference },
        500,
      );
    }

    const issued = issuedResult.data[0];
    const approval = commercialPlanApprovalRecordSchema.parse({
      id: issued.commercial_plan_version_id,
      scenarioId: issued.issued_scenario_id,
      scenarioCode: issued.issued_scenario_code,
      scenarioName: issued.issued_scenario_name,
      version: issued.issued_version,
      approvedBy: issued.issued_by,
      approvedAt: new Date(issued.issued_at).toISOString(),
      reason: issued.issued_reason,
      snapshotHash: issued.issued_snapshot_hash,
    });

    return privateJson({ approval });
  } catch (error) {
    const reference = logError({
      event: "commercial_plan_approval_failed",
      error,
      projectId,
    });

    return privateJson(
      { message: "Commercial plan could not be approved.", reference },
      500,
    );
  }
}
