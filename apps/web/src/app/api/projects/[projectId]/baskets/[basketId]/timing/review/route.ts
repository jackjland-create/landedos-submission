import { campaignTimingProposalSchema } from "@landed/contracts";
import { BasketTimedReviewError, previewTimedBasketApproval } from "@landed/db";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { strategyJson } from "@/lib/baskets/strategy-response";
import { logError } from "@/lib/observability";
import { isTimingSameOrigin } from "@/lib/baskets/timing-origin.server";

const inputSchema = z.strictObject({
  expectedOwnerId: z.uuid(),
  scenarioId: z.uuid(),
  expectedRevision: z.number().int().positive().max(2147483647),
  expectedTiming: campaignTimingProposalSchema,
});
type Context = { params: Promise<{ projectId: string; basketId: string }> };

/** Read-only saved-plan preview. Never issues approval or uses a service client. */
export async function POST(request: Request, context: Context) {
  const { projectId, basketId } = await context.params;
  if (
    !basketTimingEnabled(process.env) ||
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success
  )
    return strategyJson({ message: "Plan review is unavailable." }, 404);
  if (!isTimingSameOrigin(request))
    return strategyJson({ message: "Same-origin request required." }, 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return strategyJson(
      { message: "Save complete dates and choose a scenario before review." },
      400,
    );
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return strategyJson({ message: "Sign in to review this plan." }, 401);
    if (data.user.id !== parsed.data.expectedOwnerId)
      return strategyJson(
        { message: "Your account changed. Load the saved plan again." },
        403,
      );
    const { expectedOwnerId, ...input } = parsed.data;
    const review = await previewTimedBasketApproval(client, {
      ...input,
      workspaceId: project.workspaceId,
      projectId: project.databaseId,
      basketId: basketId.toLowerCase(),
    });
    return strategyJson({
      ...review,
      ownerId: expectedOwnerId,
      approvalAvailable: false,
    });
  } catch (error) {
    if (error instanceof BasketTimedReviewError) {
      if (error.code === "forbidden")
        return strategyJson(
          {
            message: "Campaign manager access is required to review this plan.",
          },
          403,
        );
      if (error.code === "changed" || error.code === "invalid_request")
        return strategyJson(
          {
            message:
              "This plan is not ready for review. Reload saved dates and check the strategy, selected packages and conversion definition.",
          },
          409,
        );
    }
    const reference = logError({
      event: "basket_timed_review_unavailable",
      error,
      projectId,
    });
    return strategyJson(
      {
        message: "The saved plan could not be confirmed. No approval was made.",
        reference,
      },
      503,
    );
  }
}
