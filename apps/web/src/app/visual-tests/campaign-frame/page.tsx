import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  CampaignControlWorkspace,
  campaignView,
} from "@/components/campaign-control-workspace";
import { CampaignWorkspaceFrameState } from "@/components/campaign-workspace-frame";
import {
  framePreviewCampaign,
  framePreviewContext,
  framePreviewSnapshotAt,
  type FramePreviewStage,
} from "./fixtures";

export const dynamic = "force-dynamic";

/**
 * CMP-03 / BRD-06 / UI-03 offline preview of the campaign frame.
 * Query: theme=light|dark · role=manager|viewer · stage=brief|live ·
 * state=ready|empty|unavailable|report|loading|error|permission · view=… ·
 * progress=none (route supplied no progress facts)
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const query = await searchParams;
  const theme = query.theme === "dark" ? "dark" : "light";
  const stage: FramePreviewStage = query.stage === "live" ? "live" : "brief";
  const campaign = framePreviewCampaign(stage);
  if (query.state === "empty") campaign.contentAssets = [];
  const context = framePreviewContext(
    campaign,
    stage,
    query.state,
    query.progress !== "none",
  );
  const view = campaignView(query.view);
  return (
    <AppShell
      activeSection="campaigns"
      contentAppearance="application"
      dataLabel="Synthetic data"
      projectId="helios"
      showGuidedDemo={false}
      theme={theme}
    >
      {query.state === "loading" ? (
        <CampaignWorkspaceFrameState
          theme={theme}
          state="loading"
          title="Loading campaign"
          detail="Reading the retained plan, brief and deliverables."
        />
      ) : query.state === "error" ? (
        <CampaignWorkspaceFrameState
          theme={theme}
          state="error"
          title="The campaign could not be prepared."
          detail="No commercial or roster record was changed."
        >
          <a className="application-button" href="?view=control">
            Try again
          </a>
        </CampaignWorkspaceFrameState>
      ) : query.state === "permission" ? (
        <CampaignWorkspaceFrameState
          theme={theme}
          state="permission"
          title="This campaign is outside your project access."
          detail="Ask a workspace administrator to add you to the project."
        />
      ) : (
        <CampaignControlWorkspace
          campaign={campaign}
          context={context}
          // Only the Status presentation may preview a manager. Embedded
          // production workflows must never offer mutations for fixture IDs.
          canManage={view === "control" && query.role !== "viewer"}
          view={view}
          theme={theme}
          projectSlug="helios"
          trackingSnapshotAt={framePreviewSnapshotAt}
        />
      )}
    </AppShell>
  );
}
