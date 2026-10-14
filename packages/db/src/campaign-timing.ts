import { timedStrategyCommercialPlanSnapshotSchema } from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestedId = z.uuid().transform((value) => value.toLowerCase());
const scopeSchema = z.strictObject({
  workspaceId: requestedId,
  projectId: requestedId,
  campaignId: requestedId,
});
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1].length ?? 0) <= 6,
  );
function micros(value: string) {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
  return (
    BigInt(Date.parse(match[1] + match[3])) * 1000n +
    BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}
const rowSchema = z.strictObject({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  basket_id: z.uuid(),
  commercial_plan_version_id: z.uuid(),
  approved_conversion_rule_version_id: z.uuid(),
  approved_flight_started_at: instant,
  approved_flight_ended_at: instant,
  measurement_started_at: instant,
  measurement_ended_at: instant,
  commercial_plan_versions: z.strictObject({
    id: z.uuid(),
    workspace_id: z.uuid(),
    project_id: z.uuid(),
    basket_id: z.uuid(),
    snapshot: timedStrategyCommercialPlanSnapshotSchema,
  }),
});
export class CampaignTimingError extends Error {
  constructor() {
    super("Approved campaign timing could not be loaded.");
    this.name = "CampaignTimingError";
  }
}

/** Staged read, not a route or rollout switch. One scoped relational statement
 * under RLS; compare retained values without querying the mutable draft. Older
 * untimed campaigns are deliberately unsupported by this dedicated reader.
 */
export async function loadApprovedCampaignTiming(
  client: SupabaseClient,
  input: unknown,
) {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) throw new CampaignTimingError();
  const { workspaceId, projectId, campaignId } = scope.data;
  try {
    const response = await client
      .from("campaigns")
      .select(
        "id, workspace_id, project_id, basket_id, commercial_plan_version_id, approved_conversion_rule_version_id, approved_flight_started_at, approved_flight_ended_at, measurement_started_at, measurement_ended_at, commercial_plan_versions(id, workspace_id, project_id, basket_id, snapshot)",
      )
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", campaignId)
      .maybeSingle();
    const { data: row } = z
      .object({ error: z.null(), data: rowSchema.nullable() })
      .parse(response);
    if (row === null) return null;
    const plan = row.commercial_plan_versions;
    const snapshot = plan.snapshot;
    const binding = snapshot.strategyBinding;
    if (
      row.id !== campaignId ||
      row.workspace_id !== workspaceId ||
      row.project_id !== projectId ||
      plan.id !== row.commercial_plan_version_id ||
      plan.workspace_id !== workspaceId ||
      plan.project_id !== projectId ||
      plan.basket_id !== row.basket_id ||
      snapshot.basket.id !== row.basket_id ||
      snapshot.workspaceId !== workspaceId ||
      snapshot.projectId !== projectId ||
      binding.conversionRule.id !== row.approved_conversion_rule_version_id
    )
      throw new Error();
    for (const [actual, expected] of [
      [row.approved_flight_started_at, binding.timing.flight.startedAt],
      [row.approved_flight_ended_at, binding.timing.flight.endedAt],
      [row.measurement_started_at, binding.timing.measurement.startedAt],
      [row.measurement_ended_at, binding.timing.measurement.endedAt],
    ])
      if (micros(actual!) !== micros(expected!)) throw new Error();
    return { campaignId, approvalId: plan.id, timing: binding.timing };
  } catch {
    throw new CampaignTimingError();
  }
}
