import { campaignTimingProposalSchema } from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestedId = z.uuid().transform((value) => value.toLowerCase());
const scopeSchema = z.strictObject({
  workspaceId: requestedId,
  projectId: requestedId,
  basketId: requestedId,
});
const rowSchema = z.strictObject({
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  basket_id: z.uuid(),
  revision: z.number().int().positive().max(2147483647),
  timing: campaignTimingProposalSchema.nullable(),
});

export class BasketTimingError extends Error {
  constructor(public readonly outcome: "not_started" | "unconfirmed") {
    super(
      "Basket timing could not be confirmed. Reload before making another change.",
    );
    this.name = "BasketTimingError";
  }
}

/** Local integration route uses this scoped adapter. RLS authorizes reads. */
export async function loadBasketTiming(client: SupabaseClient, input: unknown) {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) throw new BasketTimingError("not_started");
  const { workspaceId, projectId, basketId } = scope.data;
  try {
    const result = await client
      .from("basket_strategy_drafts")
      .select("workspace_id, project_id, basket_id, revision, timing")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("basket_id", basketId)
      .maybeSingle();
    const envelope = z
      .object({ error: z.null(), data: rowSchema.nullable() })
      .parse(result);
    // RLS-hidden and nonexistent records are indistinguishable, never fabricated drafts.
    if (envelope.data === null) return null;
    const row = envelope.data;
    if (
      row.workspace_id !== workspaceId ||
      row.project_id !== projectId ||
      row.basket_id !== basketId
    )
      throw new Error();
    return { revision: row.revision, timing: row.timing };
  } catch {
    throw new BasketTimingError("unconfirmed");
  }
}

/** The draft-only grant still enforces manager/scope/revision checks in SQL.
 * No retry, service fallback or approval chaining. */
export async function saveBasketTiming(client: SupabaseClient, input: unknown) {
  const parsed = scopeSchema
    .extend({
      expectedRevision: z.number().int().positive().max(2147483646),
      timing: campaignTimingProposalSchema.nullable(),
    })
    .safeParse(input);
  if (!parsed.success) throw new BasketTimingError("not_started");
  const { workspaceId, projectId, basketId, expectedRevision, timing } =
    parsed.data;
  try {
    const result = await client.rpc("save_basket_timing", {
      target_workspace_id: workspaceId,
      target_project_id: projectId,
      target_basket_id: basketId,
      expected_revision: expectedRevision,
      next_timing: timing,
    });
    const envelope = z
      .object({ error: z.null(), data: z.literal(expectedRevision + 1) })
      .parse(result);
    return { revision: envelope.data };
  } catch {
    throw new BasketTimingError("unconfirmed");
  }
}
