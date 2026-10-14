import { CampaignQueryError } from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const planSchema = z.object({
  id: z.uuid(),
  basket_id: z.uuid(),
  version: z.number().int().positive(),
  approved_at: z.string(),
  approval_request_id: z.uuid().nullish(),
  snapshot: z.object({
    schemaVersion: z.number().int().positive(),
    basket: z.object({ name: z.string() }),
  }),
});

export type CampaignCreation =
  | { kind: "standard" }
  | { kind: "local"; basketId: string; reviewId: string }
  | { kind: "unavailable" };

// Read through the authenticated client/RLS. Never fall back to a different
// project's latest plan when an explicit selection is missing or unavailable.
export async function loadCampaignPlanLaunch(
  client: SupabaseClient,
  projectId: string,
  workspaceId: string,
  planId: string,
  localBrowserCreation = false,
) {
  if (!z.uuid().safeParse(planId).success) return { kind: "missing" as const };

  const plan = await client
    .from("commercial_plan_versions")
    .select(
      "id, basket_id, version, approved_at, approval_request_id, snapshot",
    )
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("id", planId)
    .maybeSingle();
  if (plan.error) {
    if (plan.error.code === "42501") return { kind: "permission" as const };
    throw new CampaignQueryError(
      "The selected commercial plan could not be loaded.",
      plan.error.code,
    );
  }
  if (!plan.data) return { kind: "missing" as const };
  const selected = planSchema.parse(plan.data);

  const existing = await client
    .from("campaigns")
    .select("id")
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("commercial_plan_version_id", selected.id)
    .maybeSingle();
  if (existing.error) {
    if (existing.error.code === "42501") return { kind: "permission" as const };
    throw new CampaignQueryError(
      "The selected plan's campaign could not be loaded.",
      existing.error.code,
    );
  }
  if (existing.data) {
    return { kind: "campaign" as const, id: z.uuid().parse(existing.data.id) };
  }
  const permission = await client.rpc("can_manage_project", {
    target_project_id: projectId,
    target_workspace_id: workspaceId,
  });
  if (permission.error) {
    throw new CampaignQueryError(
      "Campaign workflow permissions could not be prepared.",
      permission.error.code,
    );
  }
  // The legacy RPC only accepts schema 1. A strategy-bound plan must use its
  // retained review through the already restricted, explicitly enabled runtime.
  // Never derive the review from a query parameter or silently fall back.
  const schemaVersion = selected.snapshot.schemaVersion;
  const creation: CampaignCreation =
    schemaVersion === 1
      ? { kind: "standard" }
      : schemaVersion === 2 &&
          localBrowserCreation &&
          selected.approval_request_id
        ? {
            kind: "local",
            basketId: selected.basket_id,
            reviewId: selected.approval_request_id,
          }
        : { kind: "unavailable" };
  return {
    kind: "plan" as const,
    canManage: permission.data === true,
    creation,
    pendingPlan: {
      id: selected.id,
      version: selected.version,
      approvedAt: selected.approved_at,
      basketId: selected.basket_id,
      name: selected.snapshot.basket.name,
    },
  };
}
