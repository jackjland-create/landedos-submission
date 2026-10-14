import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  CampaignControlWorkspace,
  campaignView,
} from "@/components/campaign-control-workspace";
import { CampaignWorkspacePermission } from "@/components/campaign-workspace";
import {
  workspaceFixture,
  workspaceContextFixture,
} from "@/lib/campaign-workspace.fixture";
import CampaignLoading from "@/app/projects/[projectId]/campaigns/[campaignId]/loading";
import { PerformanceReport } from "@/components/performance-report";
import { buildReportVisualFixture } from "@/lib/reports/visual-fixtures";
import { ActivationFixture } from "./activation-fixture";
import clarity from "@/components/clarity-reporting.module.css";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const query = await searchParams;
  const reportFixture =
    query.surface === "legacy-report"
      ? buildReportVisualFixture("ready")
      : null;
  const activationFixture = query.surface === "activation";
  const campaign = structuredClone(workspaceFixture);
  if (query.state === "empty") campaign.contentAssets = [];
  const context = {
    ...workspaceContextFixture,
    ...(query.state === "unavailable"
      ? { planAvailable: false, reportUnavailable: true }
      : {}),
  };
  return (
    <AppShell
      activeSection={
        query.settings ? null : reportFixture ? "reports" : "campaigns"
      }
      settingsSection={query.settings === "conversions" ? "conversions" : null}
      projectId="helios"
      showGuidedDemo={false}
      theme={query.theme === "dark" ? "dark" : "light"}
    >
      <p>
        Local synthetic layout fixture — no commercial writes or connected data.
      </p>
      {activationFixture ? (
        <section
          className={clarity.app}
          data-theme={query.theme === "dark" ? "dark" : "light"}
          aria-label="Campaign activation fixture"
        >
          <ActivationFixture
            state={query.state ?? "ready"}
            canManage={query.permission !== "readonly"}
          />
        </section>
      ) : reportFixture ? (
        <PerformanceReport
          campaign={reportFixture.campaign}
          comparisonVersion={reportFixture.comparisonVersion}
          projectSlug="helios"
          rankingEvidencePaths={reportFixture.rankingEvidencePaths}
          report={reportFixture.report}
          selectedVersion={reportFixture.selectedVersion}
        />
      ) : query.state === "loading" ? (
        <CampaignLoading />
      ) : query.state === "permission" ? (
        <CampaignWorkspacePermission />
      ) : query.state === "error" ? (
        <section role="alert">
          <h1>The campaign could not be prepared.</h1>
          <p>No commercial or roster record was changed.</p>
          <a href="?view=control">Try again</a>
        </section>
      ) : (
        <CampaignControlWorkspace
          campaign={campaign}
          context={context}
          canManage={false}
          view={campaignView(query.view)}
          theme={query.theme === "dark" ? "dark" : "light"}
          projectSlug="helios"
          trackingSnapshotAt="2026-09-22T12:00:00.000Z"
        />
      )}
    </AppShell>
  );
}
