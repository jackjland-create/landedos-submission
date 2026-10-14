import { campaignTimingProposalSchema } from "@landed/contracts";
import { loadBasketTiming, saveBasketTiming } from "@landed/db";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { strategyJson } from "@/lib/baskets/strategy-response";
import { logError } from "@/lib/observability";
import { isTimingSameOrigin } from "@/lib/baskets/timing-origin.server";

type Context = { params: Promise<{ projectId: string; basketId: string }> };
const inputSchema = z.strictObject({
  expectedOwnerId: z.uuid(),
  expectedRevision: z.number().int().positive().max(2147483646),
  timing: campaignTimingProposalSchema,
});
async function scope(context: Context) {
  const { projectId, basketId } = await context.params;
  if (
    !basketTimingEnabled(process.env) ||
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success
  )
    return null;
  return {
    workspaceId: project.workspaceId,
    projectId: project.databaseId,
    basketId: basketId.toLowerCase(),
  };
}
function failure(error: unknown) {
  const reference = logError({
    event: "basket_timing_unconfirmed",
    error,
    projectId: project.id,
  });
  return strategyJson(
    {
      message:
        "Saved dates could not be confirmed. Reload and review before another change.",
      reference,
    },
    503,
  );
}
export async function GET(_request: Request, context: Context) {
  const resolved = await scope(context);
  if (!resolved)
    return strategyJson({ message: "Basket dates are unavailable." }, 404);
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return strategyJson({ message: "Sign in to load campaign dates." }, 401);
    const ownerId = z.uuid().parse(data.user.id);
    const saved = await loadBasketTiming(client, resolved);
    const permission = await client.rpc("can_manage_project", {
      target_project_id: resolved.projectId,
      target_workspace_id: resolved.workspaceId,
    });
    if (permission.error)
      throw new Error("Date access could not be confirmed.");
    return saved
      ? strategyJson({ ...saved, ownerId, canManage: permission.data === true })
      : strategyJson({ message: "Saved basket strategy is unavailable." }, 404);
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request, context: Context) {
  const resolved = await scope(context);
  if (!resolved)
    return strategyJson({ message: "Basket dates are unavailable." }, 404);
  // Reject browser cross-origin mutations before reading a body or opening a client.
  if (!isTimingSameOrigin(request))
    return strategyJson({ message: "Same-origin request required." }, 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return strategyJson(
      { message: "Check campaign and measurement dates." },
      400,
    );
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.id !== parsed.data.expectedOwnerId)
      return strategyJson(
        {
          message: "Your account changed. Load saved dates before continuing.",
        },
        403,
      );
    const { expectedOwnerId: _owner, ...proposal } = parsed.data;
    void _owner;
    return strategyJson(
      await saveBasketTiming(client, {
        ...resolved,
        ...proposal,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
