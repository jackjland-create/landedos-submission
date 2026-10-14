import "server-only";
import {
  retainedCommercialPlanSnapshotSchema,
  timedStrategyCommercialPlanSnapshotSchema,
  type CampaignRecord,
} from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CampaignProgressStep } from "./campaign-workspace-progress";

export type CampaignWorkspaceContext = {
  trackingRestricted: boolean;
  planAvailable: boolean;
  flight: { startedAt: string; endedAt: string } | null;
  measurement: { startedAt: string; endedAt: string } | null;
  report: { id: string; version: number } | null;
  reportUnavailable: boolean;
  measurementRule?:
    | { state: "unavailable" | "unbound" }
    | { state: "retained"; name: string; version: number };
  /** Optional for older fixtures; display-only, never an action capability. */
  progress?: { snapshotAt: string; steps: CampaignProgressStep[] };
};

/** Read-only, exact campaign scope; a failed read is never an empty/success state. */
export async function getCampaignWorkspaceContext(
  client: SupabaseClient,
  campaign: CampaignRecord,
): Promise<CampaignWorkspaceContext> {
  const [planResult, reportResult] = await Promise.all([
    client
      .from("commercial_plan_versions")
      .select("snapshot")
      .eq("workspace_id", campaign.workspaceId)
      .eq("project_id", campaign.projectId)
      .eq("basket_id", campaign.basketId)
      .eq("id", campaign.commercialPlanVersionId)
      .maybeSingle(),
    client
      .from("report_versions")
      .select("report_id, version")
      .eq("workspace_id", campaign.workspaceId)
      .eq("project_id", campaign.projectId)
      .eq("campaign_id", campaign.id)
      .eq("status", "issued")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const plan = z
    .union([
      timedStrategyCommercialPlanSnapshotSchema,
      retainedCommercialPlanSnapshotSchema,
    ])
    .safeParse(planResult.error ? null : planResult.data?.snapshot);
  const report = z
    .object({ report_id: z.uuid(), version: z.number().int().positive() })
    .safeParse(reportResult.data);
  const binding =
    plan.success && "strategyBinding" in plan.data
      ? plan.data.strategyBinding
      : null;
  const timed = timedStrategyCommercialPlanSnapshotSchema.safeParse(
    planResult.error ? null : planResult.data?.snapshot,
  );
  return {
    measurementRule:
      !plan.success ||
      plan.data.basket.id !== campaign.basketId ||
      ("workspaceId" in plan.data &&
        (plan.data.workspaceId !== campaign.workspaceId ||
          plan.data.projectId !== campaign.projectId))
        ? { state: "unavailable" }
        : binding
          ? {
              state: "retained",
              name: binding.conversionRule.name,
              version: binding.conversionRule.version,
            }
          : { state: "unbound" },
    planAvailable: plan.success,
    trackingRestricted: !plan.success || !!binding,
    flight: timed.success ? timed.data.strategyBinding.timing.flight : null,
    measurement: binding?.measurementWindow ?? null,
    report:
      !reportResult.error && report.success
        ? { id: report.data.report_id, version: report.data.version }
        : null,
    reportUnavailable:
      !!reportResult.error || (!!reportResult.data && !report.success),
  };
}
