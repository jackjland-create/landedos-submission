import { submissionPage } from "@/lib/submission-page.server";
import {
  CampaignQueryError,
  getProjectCampaign,
  getProjectReport,
  ReportQueryError,
} from "@landed/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClarityReporting } from "@/components/clarity-reporting";
import { project } from "@/lib/demo-data";
import { parseClarityQuery } from "@/lib/reports/clarity";
import { loadConnectedClarityReport } from "@/lib/reports/connected-clarity-report.server";
import { createClient } from "@/lib/supabase/server";
import { guidedDemoManifest } from "@/lib/guided-demo-manifest";
import { hasSyntheticDemoReplayContext } from "@/lib/reports/guided-demo-context.server";

type QueryValue = string | string[] | undefined;

type PageProps = {
  params: Promise<{ projectId: string; reportId: string }>;
  searchParams: Promise<Record<string, QueryValue>>;
};

export const metadata: Metadata = { title: "Campaign performance" };

function first(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

function clarityParams(
  query: Record<string, QueryValue>,
  defaultVersion?: number,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const resolved = first(value);
    if (resolved !== undefined) params.set(key, resolved);
  }

  if (!params.has("version") && defaultVersion !== undefined) {
    params.set("version", String(defaultVersion));
  }

  if (!params.has("view")) {
    const legacyMode = params.get("mode");
    if (
      legacyMode === "funnel" ||
      legacyMode === "creators" ||
      legacyMode === "economics" ||
      legacyMode === "evidence"
    ) {
      params.set("view", legacyMode);
    } else if (legacyMode === "decision") {
      params.set("view", "performance");
    }
  }

  if (params.has("evidence")) params.set("view", "evidence");
  return params;
}

function permission(projectId: string) {
  return (
    <ClarityReporting
      projectSlug={projectId}
      sourceMode="issued"
      state="permission"
    />
  );
}

export default async function PerformanceReportPage({
  params,
  searchParams,
}: PageProps) {
  const { projectId, reportId } = await params;
  const query = await searchParams;
  if(projectId === "demo") {const preview=await submissionPage("reports",query,reportId);if(preview)return preview;}
  if (projectId !== project.id) notFound();

  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError && projectError.code !== "42501") {
    throw new Error("Report access could not be prepared.");
  }
  if (!readableProject || projectError) return permission(projectId);

  let report;
  try {
    report = await getProjectReport(client, project.databaseId, reportId);
  } catch (error) {
    if (error instanceof ReportQueryError && error.code === "42501") {
      return permission(projectId);
    }
    throw error;
  }
  if (!report) return permission(projectId);

  // Confirm the report's campaign still belongs to the authorized project,
  // without using mutable campaign fields to complete immutable report history.
  try {
    const campaign = await getProjectCampaign(
      client,
      project.databaseId,
      report.campaignId,
    );
    if (!campaign || campaign.id !== report.campaignId) {
      throw new ReportQueryError(
        "The issued report's retained campaign evidence is missing.",
      );
    }
  } catch (error) {
    if (error instanceof CampaignQueryError && error.code === "42501") {
      return permission(projectId);
    }
    throw error;
  }

  const rawVersion = first(query.version);
  const requestedVersion =
    rawVersion === undefined
      ? report.versions[0]?.version
      : /^[1-9]\d*$/.test(rawVersion)
        ? Number(rawVersion)
        : null;
  const selectedVersion = report.versions.find(
    (version) => version.version === requestedVersion,
  );
  const initialQuery = parseClarityQuery(
    clarityParams(query, report.versions[0]?.version),
  );

  if (!selectedVersion) {
    const retainedQuery = new URLSearchParams();
    for (const key of [
      "version",
      "compare",
      "evidence",
      "theme",
      "view",
      "demo",
      "demoStep",
      "demoComplete",
      "demoOpen",
    ]) {
      const value = first(query[key]);
      if (value !== undefined) retainedQuery.set(key, value);
    }
    return (
      <ClarityReporting
        initialQuery={initialQuery}
        projectSlug={projectId}
        sourceMode="issued"
        state="error"
        unavailableVersionHref={`/projects/${projectId}/reports/${report.id}?${retainedQuery}`}
        unavailableVersionLabel="Retry requested report version"
      />
    );
  }

  let connected;
  let syntheticDemoContext = false;
  try {
    connected = await loadConnectedClarityReport(
      client,
      report,
      selectedVersion,
    );
    syntheticDemoContext = await hasSyntheticDemoReplayContext(
      client,
      report,
      selectedVersion,
      connected.evidenceProvenance,
      connected.fixture.rankingEvidencePaths,
    );
  } catch (error) {
    if (error instanceof ReportQueryError && error.code === "42501") {
      return permission(projectId);
    }
    throw error;
  }
  return (
    <ClarityReporting
      {...connected}
      initialQuery={initialQuery}
      projectSlug={projectId}
      syntheticDemoContext={syntheticDemoContext}
      showGuidedDemo={
        first(query.demo) === "1" &&
        report.id === guidedDemoManifest.reportId &&
        (connected.evidenceProvenance === "synthetic" || syntheticDemoContext)
      }
      state="ready"
    />
  );
}
