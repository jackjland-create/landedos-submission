import {
  ConversionRuleQueryError,
  getProjectConversionReplayJobs,
  getProjectConversionRule,
  getProjectBasket,
  getSavedBasketStrategy,
} from "@landed/db";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

import {
  ConversionRuleSettings,
  ConversionRuleSettingsPermission,
} from "@/components/conversion-rule-settings";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{
    theme?: string | string[];
    plan?: string | string[];
  }>;
};

export const metadata = { title: "Success rules" };

export default async function ConversionSettingsPage({
  params,
  searchParams,
}: PageProps) {
  const { projectId } = await params;
  if (projectId !== project.id) notFound();
  const query = await searchParams;
  const theme = query?.theme === "dark" ? "dark" : "light";
  const shell = (children: ReactNode) => (
    <AppShell
      activeSection={null}
      projectId={projectId}
      settingsSection="conversions"
      contentAppearance="application"
      theme={theme}
    >
      {children}
    </AppShell>
  );

  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError) {
    if (projectError.code !== "42501") {
      throw new ConversionRuleQueryError(
        "Conversion settings access could not be prepared.",
        projectError.code,
      );
    }
    return shell(<ConversionRuleSettingsPermission theme={theme} />);
  }
  if (!readableProject) {
    return shell(<ConversionRuleSettingsPermission theme={theme} />);
  }

  const [rule, replayJobs, permission] = await Promise.all([
    getProjectConversionRule(client, project.databaseId),
    getProjectConversionReplayJobs(client, project.databaseId),
    client.rpc("can_manage_project", {
      target_project_id: project.databaseId,
      target_workspace_id: project.workspaceId,
    }),
  ]);

  if (permission.error) {
    throw new ConversionRuleQueryError(
      "Conversion settings permission could not be prepared.",
      permission.error.code,
    );
  }

  const { count: affectedCampaignCount, error: campaignCountError } =
    await client
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.databaseId);

  if (campaignCountError || affectedCampaignCount === null) {
    throw new ConversionRuleQueryError(
      "Conversion impact preview could not be prepared.",
      campaignCountError?.code ?? "COUNT_UNAVAILABLE",
    );
  }

  let planContext:
    { name: string; href: string; versionId?: string | null } | undefined;
  if (
    typeof query?.plan === "string" &&
    z.uuid().safeParse(query.plan).success
  ) {
    // Use the authenticated, project-scoped readers. Never trust a supplied return URL.
    const plan = await getProjectBasket(client, project.databaseId, query.plan);
    if (
      plan &&
      plan.projectId === project.databaseId &&
      plan.workspaceId === project.workspaceId
    ) {
      const saved = await getSavedBasketStrategy(
        client,
        project.databaseId,
        query.plan,
      );
      planContext = {
        name: plan.name,
        href: `/projects/${projectId}/baskets/${plan.id}?step=measurement&theme=${theme}`,
        versionId: saved?.draft.strategy.measurement?.conversionRuleVersionId,
      };
    }
  }

  return shell(
    <ConversionRuleSettings
      theme={theme}
      planContext={planContext}
      affectedCampaignCount={affectedCampaignCount}
      canManage={permission.data === true}
      projectId={projectId}
      replayJobs={replayJobs}
      rule={rule}
    />,
  );
}
