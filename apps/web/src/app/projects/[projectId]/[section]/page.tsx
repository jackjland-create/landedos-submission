import { submissionPage } from "@/lib/submission-page.server";
import { navigationSectionSchema } from "@landed/contracts";
import {
  CampaignQueryError,
  CreatorQueryError,
  listProjectCreators,
  getSavedBasketStrategy,
} from "@landed/db";
import { z } from "zod";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  CampaignLaunchpad,
  CampaignLaunchpadPermission,
} from "@/components/campaign-launchpad";
import {
  CreatorDirectory,
  CreatorDirectoryPermission,
} from "@/components/creator-directory";
import { renderScreen, screenTitles } from "@/components/screens";
import {
  ReportPermission,
  ReportsEmpty,
} from "@/components/performance-report";
import { project } from "@/lib/demo-data";
import { loadCampaignPlanLaunch } from "@/lib/campaign-plan-launch";
import { browserCampaignEnabled } from "@/lib/baskets/browser-campaign-runtime.server";
import {
  loadProjectRecordIndex,
  parseRecordPage,
} from "@/lib/project-record-index";
import { ProjectRecordIndex } from "@/components/project-record-index";
import { createClient } from "@/lib/supabase/server";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { BasketCreatorDirectory } from "@/components/basket-creator-directory";
import { OverviewCockpit } from "@/components/overview-cockpit";
import { loadProjectOverview } from "@/lib/reports/project-overview.server";

type PageProps = {
  params: Promise<{
    projectId: string;
    section: string;
  }>;
  searchParams: Promise<{
    creator?: string | string[];
    plan?: string | string[];
    page?: string | string[];
    basket?: string | string[];
    report?: string | string[];
    version?: string | string[];
    compare?: string | string[];
    view?: string | string[];
    theme?: string | string[];
  }>;
};

async function loadCreatorDirectory() {
  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError) {
    if (projectError.code === "42501") {
      return { kind: "permission" as const };
    }

    throw new CreatorQueryError(
      "Project access could not be prepared.",
      projectError.code,
    );
  }

  if (!readableProject) {
    return { kind: "permission" as const };
  }

  try {
    return {
      kind: "ready" as const,
      creators: await listProjectCreators(client, project.databaseId),
    };
  } catch (error) {
    if (error instanceof CreatorQueryError && error.code === "42501") {
      return { kind: "permission" as const };
    }

    throw error;
  }
}

async function loadRecordSection(
  section: "baskets" | "campaigns",
  page: number,
) {
  const client = await createClient();
  const { data, error } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();
  if (error && error.code !== "42501") {
    throw new Error("Project access could not be prepared.");
  }
  if (error || !data) {
    return (
      <ProjectRecordIndex
        section={section}
        projectId={project.id}
        records={[]}
        page={page}
        hasNext={false}
        denied
      />
    );
  }
  const result = await loadProjectRecordIndex(
    client,
    project.databaseId,
    project.workspaceId,
    section,
    page,
  );
  return (
    <ProjectRecordIndex
      section={section}
      projectId={project.id}
      records={result.kind === "ready" ? result.records : []}
      page={page}
      hasNext={result.kind === "ready" && result.hasNext}
      denied={result.kind === "permission"}
    />
  );
}

async function loadCampaignWorkspace(
  planId: string | string[] | undefined,
  page: number,
  theme: "light" | "dark",
) {
  if (planId === undefined) return loadRecordSection("campaigns", page);
  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError) {
    if (projectError.code === "42501")
      return <CampaignLaunchpadPermission theme={theme} />;

    throw new CampaignQueryError(
      "Campaign access could not be prepared.",
      projectError.code,
    );
  }

  if (!readableProject) return <CampaignLaunchpadPermission theme={theme} />;

  if (planId !== undefined) {
    if (Array.isArray(planId)) notFound();
    const launch = await loadCampaignPlanLaunch(
      client,
      project.databaseId,
      project.workspaceId,
      planId,
      browserCampaignEnabled(),
    );
    if (launch.kind === "missing") notFound();
    if (launch.kind === "permission")
      return <CampaignLaunchpadPermission theme={theme} />;
    if (launch.kind === "campaign") {
      redirect(
        `/projects/${project.id}/campaigns/${launch.id}${theme === "dark" ? "?theme=dark" : ""}`,
      );
    }
    return (
      <CampaignLaunchpad
        key={launch.pendingPlan.id}
        canManage={launch.canManage}
        pendingPlan={launch.pendingPlan}
        creation={launch.creation}
        theme={theme}
      />
    );
  }
}

async function loadReportIndex() {
  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError) {
    if (projectError.code === "42501") return <ReportPermission />;
    throw new Error("Report access could not be prepared.");
  }

  if (!readableProject) return <ReportPermission />;

  const { data, error } = await client
    .from("report_versions")
    .select("report_id")
    .eq("project_id", project.databaseId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42501") return <ReportPermission />;
    throw new Error("Issued reports could not be loaded.");
  }

  if (data?.report_id) {
    redirect(`/projects/${project.id}/reports/${data.report_id}`);
  }

  return <ReportsEmpty />;
}

export function generateStaticParams() {
  return Object.keys(screenTitles).map((section) => ({
    projectId: "helios",
    section,
  }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { section } = await params;
  const parsed = navigationSectionSchema.safeParse(section);

  return {
    title: parsed.success ? screenTitles[parsed.data] : "Project",
  };
}

export default async function ProjectSectionPage({
  params,
  searchParams,
}: PageProps) {
  const { projectId, section } = await params;
  const query = await searchParams;
  if(projectId === "demo") { const preview=await submissionPage(section,query); if(preview) return preview; }
  const parsed = navigationSectionSchema.safeParse(section);

  if (!parsed.success || projectId !== "helios") {
    notFound();
  }

  const recordPage = parseRecordPage(query.page);
  if (recordPage === null) notFound();
  if (parsed.data === "overview") {
    const positiveVersion = (value: string | string[] | undefined) =>
      value === undefined
        ? undefined
        : typeof value === "string" &&
            /^[1-9]\d*$/.test(value) &&
            Number.isSafeInteger(Number(value))
          ? Number(value)
          : null;
    const version = positiveVersion(query.version);
    const compare = positiveVersion(query.compare);
    if (
      version === null ||
      compare === null ||
      (query.report !== undefined &&
        (typeof query.report !== "string" ||
          !z.uuid().safeParse(query.report).success))
    )
      notFound();
    const overview = await loadProjectOverview(await createClient(), {
      report: query.report as string | undefined,
      version,
    });
    const retryQuery = new URLSearchParams();
    for (const key of [
      "report",
      "version",
      "compare",
      "view",
      "theme",
    ] as const) {
      const value = query[key];
      if (typeof value === "string") retryQuery.set(key, value);
    }
    return (
      <OverviewCockpit
        {...overview}
        projectSlug={projectId}
        initialTheme={query.theme === "dark" ? "dark" : "light"}
        initialView={typeof query.view === "string" ? query.view : undefined}
        compareVersion={compare}
        retryHref={`/projects/${projectId}/overview?${retryQuery}`}
      />
    );
  }
  if (parsed.data === "baskets") {
    return (
      <AppShell activeSection="baskets" projectId={projectId}>
        {await loadRecordSection("baskets", recordPage)}
      </AppShell>
    );
  }

  let creatorDirectory = null;
  let campaignWorkspace = null;
  let reportIndex = null;

  if (parsed.data === "kols") {
    // A supplied context must never silently fall back to creating another basket.
    if (
      query.basket !== undefined &&
      (!basketTimingEnabled(process.env) ||
        !z.uuid().safeParse(query.basket).success)
    )
      notFound();
    const directoryState = await loadCreatorDirectory();
    creatorDirectory =
      directoryState.kind === "ready" ? (
        <CreatorDirectory
          creators={directoryState.creators}
          initialCreatorId={
            Array.isArray(query.creator) ? query.creator[0] : query.creator
          }
        />
      ) : (
        <CreatorDirectoryPermission />
      );
    if (typeof query.basket === "string" && directoryState.kind === "ready") {
      const client = await createClient();
      const saved = await getSavedBasketStrategy(
        client,
        project.databaseId,
        query.basket,
      );
      if (!saved || saved.persistence !== "saved") notFound();
      const permission = await client.rpc("can_manage_project", {
        target_project_id: project.databaseId,
        target_workspace_id: project.workspaceId,
      });
      if (permission.error)
        throw new Error("Basket access could not be prepared.");
      creatorDirectory = (
        <BasketCreatorDirectory
          theme={query.theme === "dark" ? "dark" : "light"}
          key={query.basket}
          projectId={projectId}
          basketId={query.basket}
          creators={directoryState.creators}
          canManage={permission.data === true}
        />
      );
    }
  }

  if (parsed.data === "campaigns") {
    campaignWorkspace = await loadCampaignWorkspace(
      query.plan,
      recordPage,
      query.theme === "dark" ? "dark" : "light",
    );
  }

  if (parsed.data === "reports") {
    reportIndex = await loadReportIndex();
  }

  return (
    <AppShell
      activeSection={parsed.data}
      projectId={projectId}
      contentAppearance={
        (parsed.data === "kols" && query.basket) ||
        (parsed.data === "campaigns" && query.plan !== undefined)
          ? "application"
          : undefined
      }
      theme={query.theme === "dark" ? "dark" : "light"}
    >
      {renderScreen(
        parsed.data,
        creatorDirectory,
        campaignWorkspace,
        reportIndex,
      )}
    </AppShell>
  );
}
