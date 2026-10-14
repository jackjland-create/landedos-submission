import "server-only";
import {
  getProjectCampaign,
  getProjectReport,
  ReportQueryError,
  CampaignQueryError,
} from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OverviewCockpitProps } from "@/components/overview-cockpit";
import { project } from "@/lib/demo-data";
import { loadConnectedClarityReport } from "./connected-clarity-report.server";
import { signedInDisplayName } from "./overview-presentation";

/** RPT-06 / RPT-03. Uses the caller's RLS-bound client; never an admin client.
 * Exact versions fail closed instead of silently switching to the latest. */
export async function loadProjectOverview(
  client: SupabaseClient,
  query: { report?: string; version?: number },
): Promise<OverviewCockpitProps> {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return { state: "permission" };
  const accountName = signedInDisplayName(auth.data.user);
  const { data: readable, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();
  if (projectError || !readable)
    return {
      state:
        projectError && projectError.code !== "42501" ? "error" : "permission",
      accountName,
    };
  const permission = await client.rpc("can_manage_project", {
    target_project_id: project.databaseId,
    target_workspace_id: project.workspaceId,
  });
  if (permission.error) return { state: "error", accountName };
  const common = { accountName, canManage: permission.data === true };
  try {
    let id = query.report;
    if (!id) {
      const latest = await client
        .from("report_versions")
        .select("report_id")
        .eq("project_id", project.databaseId)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error)
        return {
          ...common,
          state: latest.error.code === "42501" ? "permission" : "error",
        };
      id = latest.data?.report_id;
    }
    if (!id) return { ...common, state: "empty" };
    const report = await getProjectReport(client, project.databaseId, id);
    if (!report) return { ...common, state: "permission" };
    const selected =
      query.version === undefined
        ? report.versions[0]
        : report.versions.find((v) => v.version === query.version);
    if (!selected) return { ...common, state: "error" };
    const campaign = await getProjectCampaign(
      client,
      project.databaseId,
      report.campaignId,
    );
    if (!campaign || campaign.id !== report.campaignId)
      return { ...common, state: "error" };
    const connected = await loadConnectedClarityReport(
      client,
      report,
      selected,
    );
    return {
      ...common,
      state: "ready",
      fixture: connected.fixture,
      economics: connected.economics,
      evidenceProvenance: connected.evidenceProvenance,
    };
  } catch (error) {
    const denied =
      (error instanceof ReportQueryError ||
        error instanceof CampaignQueryError) &&
      error.code === "42501";
    return { ...common, state: denied ? "permission" : "error" };
  }
}
