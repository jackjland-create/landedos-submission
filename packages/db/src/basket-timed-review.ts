import {
  campaignTimingProposalSchema,
  timedStrategyCommercialPlanSnapshotSchema,
} from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const id = z.uuid().transform((value) => value.toLowerCase());
const requestSchema = z.strictObject({
  workspaceId: id,
  projectId: id,
  basketId: id,
  scenarioId: id,
  expectedRevision: z.number().int().positive().max(2147483647),
  expectedTiming: campaignTimingProposalSchema,
});
const responseSchema = z.object({
  error: z.null(),
  data: z
    .array(
      z.strictObject({
        review_snapshot: timedStrategyCommercialPlanSnapshotSchema,
        review_snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .length(1),
});

export class BasketTimedReviewError extends Error {
  constructor(
    public readonly code:
      "invalid_request" | "changed" | "forbidden" | "unavailable",
  ) {
    super("The saved campaign plan could not be confirmed for review.");
    this.name = "BasketTimedReviewError";
  }
}

// Validated UTC values only. Preserve microseconds; never round through Date.
function instant(value: string) {
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}

/** Staged review connection, not a runtime grant or an approval action.
 * Supply the user's authenticated client and the last confirmed saved timing.
 * The database builds the snapshot; the caller cannot supply commercial terms.
 * No retry, legacy fallback, service client or write is performed here. */
export async function previewTimedBasketApproval(
  client: SupabaseClient,
  input: unknown,
) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new BasketTimedReviewError("invalid_request");
  const request = parsed.data;
  let result: unknown;
  try {
    result = await client.rpc("preview_timed_basket_strategy_approval", {
      target_workspace_id: request.workspaceId,
      target_project_id: request.projectId,
      target_basket_id: request.basketId,
      target_scenario_id: request.scenarioId,
      expected_strategy_revision: request.expectedRevision,
    });
  } catch {
    throw new BasketTimedReviewError("unavailable");
  }
  const failure = z
    .object({ error: z.object({ code: z.string() }) })
    .safeParse(result);
  if (failure.success) {
    const code = failure.data.error.code;
    throw new BasketTimedReviewError(
      code === "42501"
        ? "forbidden"
        : ["40001", "22023", "55000"].includes(code)
          ? "changed"
          : "unavailable",
    );
  }
  const response = responseSchema.safeParse(result);
  if (!response.success) throw new BasketTimedReviewError("unavailable");
  const { review_snapshot: snapshot, review_snapshot_hash: snapshotHash } =
    response.data.data[0]!;
  if (
    snapshot.workspaceId !== request.workspaceId ||
    snapshot.projectId !== request.projectId ||
    snapshot.basket.id !== request.basketId ||
    snapshot.scenario.id !== request.scenarioId ||
    snapshot.strategyBinding.revision !== request.expectedRevision
  )
    throw new BasketTimedReviewError("changed");
  for (const period of ["flight", "measurement"] as const) {
    for (const boundary of ["startedAt", "endedAt"] as const) {
      if (
        instant(snapshot.strategyBinding.timing[period][boundary]) !==
        instant(request.expectedTiming[period][boundary])
      )
        throw new BasketTimedReviewError("changed");
    }
  }
  // Retain PostgreSQL's original fingerprint, never hash a JS reserialization.
  // This checks the response contract, not authority to issue or activate.
  return { snapshot, snapshotHash };
}
