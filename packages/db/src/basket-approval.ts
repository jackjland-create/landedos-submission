import {
  previewBasketStrategyApprovalInputSchema,
  strategyBoundCommercialPlanSnapshotSchema,
  type PreviewBasketStrategyApprovalInput,
} from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export class BasketApprovalPreviewError extends Error {
  constructor(public readonly code?: string) {
    super("Basket approval review could not be prepared.");
    this.name = "BasketApprovalPreviewError";
  }
}

const resultSchema = z
  .array(
    z.strictObject({
      review_snapshot: strategyBoundCommercialPlanSnapshotSchema,
      review_snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .length(1);

/** Canonicalize fractional padding only; do not lose sub-millisecond precision. */
function instant(value: string) {
  return value.replace(/\.0+Z$/, "Z").replace(/(\.\d*?[1-9])0+Z$/, "$1Z");
}

/** Caller supplies a cookie-authenticated client and resolved project context.
 * This previews only: no approval request, retry, service role or write occurs. */
export async function previewBasketStrategyApproval(
  client: SupabaseClient,
  scope: { workspaceId: string; projectId: string; basketId: string },
  input: PreviewBasketStrategyApprovalInput,
) {
  const context = z
    .strictObject({
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      basketId: z.uuid(),
    })
    .parse(scope);
  const request = previewBasketStrategyApprovalInputSchema.parse(input);
  const { data, error } = await client.rpc("preview_basket_strategy_approval", {
    target_project_id: context.projectId,
    target_basket_id: context.basketId,
    target_scenario_id: request.scenarioId,
    expected_strategy_revision: request.expectedStrategyRevision,
    measurement_started_at: request.measurementStartedAt,
    measurement_ended_at: request.measurementEndedAt,
  });
  if (error) throw new BasketApprovalPreviewError(error.code);
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new BasketApprovalPreviewError("invalid_snapshot");
  const { review_snapshot: snapshot, review_snapshot_hash: snapshotHash } =
    parsed.data[0]!;
  const window = snapshot.strategyBinding.measurementWindow;
  if (
    snapshot.workspaceId !== context.workspaceId ||
    snapshot.projectId !== context.projectId ||
    snapshot.basket.id !== context.basketId ||
    snapshot.scenario.id !== request.scenarioId ||
    snapshot.strategyBinding.revision !== request.expectedStrategyRevision ||
    instant(window.startedAt) !== instant(request.measurementStartedAt) ||
    instant(window.endedAt) !== instant(request.measurementEndedAt)
  )
    throw new BasketApprovalPreviewError("invalid_snapshot");
  // Hash is PostgreSQL's fingerprint of its original JSONB, not a hash of a
  // client reserialization. Keep it unchanged for future issuance validation.
  return { snapshot, snapshotHash };
}
