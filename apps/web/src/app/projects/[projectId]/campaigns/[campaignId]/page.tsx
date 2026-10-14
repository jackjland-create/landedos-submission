import { submissionPage } from "@/lib/submission-page.server";
import { CampaignQueryError, getProjectCampaign } from "@landed/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { CampaignWorkspacePermission } from "@/components/campaign-workspace";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { browserCampaignEnabled } from "@/lib/baskets/browser-campaign-runtime.server";
import { BrowserCampaignExecution } from "@/components/browser-campaign-execution";
import { devnetReviewTiming } from "@/lib/attribution/devnet-review-timing.server";
import { LocalDevnetActivationHandoff } from "@/components/local-devnet-activation-handoff";
import { localDevnetTrackingCampaignEnabled } from "@/lib/attribution/devnet-campaign-runtime.server";
import { localDevnetReportEnabled } from "@/lib/reports/timed-report-runtime.server";
import {
  CampaignControlWorkspace,
  campaignView,
} from "@/components/campaign-control-workspace";
import { getCampaignWorkspaceContext } from "@/lib/campaign-workspace-context.server";
import { campaignWorkspaceProgress } from "@/lib/campaign-workspace-progress";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import {
  buildSignedTrackedLink,
  getTrackedLinkApplicationOrigin,
  getTrackedLinkKeyring,
} from "@/lib/tracking/signing.server";

type PageProps = {
  params: Promise<{
    projectId: string;
    campaignId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Campaign workspace" };

export default async function CampaignPage({
  params,
  searchParams,
}: PageProps) {
  const { campaignId, projectId } = await params;
  const query = (await searchParams) ?? {};
  if (projectId === "demo") { const preview=await submissionPage("campaigns",query,campaignId); if(preview) return preview; }


  if (projectId !== project.id || !z.uuid().safeParse(campaignId).success) {
    notFound();
  }

  const client = await createClient();
  const { data: readableProject, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();

  if (projectError && projectError.code !== "42501") {
    throw new CampaignQueryError(
      "Campaign access could not be prepared.",
      projectError.code,
    );
  }

  if (projectError?.code === "42501" || !readableProject) {
    return (
      <AppShell activeSection="campaigns" projectId={projectId}>
        <CampaignWorkspacePermission />
      </AppShell>
    );
  }

  let campaign = null;
  let permissionDenied = false;

  try {
    campaign = await getProjectCampaign(client, project.databaseId, campaignId);
  } catch (error) {
    if (error instanceof CampaignQueryError && error.code === "42501") {
      permissionDenied = true;
    } else {
      throw error;
    }
  }

  if (permissionDenied) {
    return (
      <AppShell activeSection="campaigns" projectId={projectId}>
        <CampaignWorkspacePermission />
      </AppShell>
    );
  }

  if (!campaign) notFound();

  const { data: canManage, error: permissionError } = await client.rpc(
    "can_manage_project",
    {
      target_project_id: project.databaseId,
      target_workspace_id: campaign.workspaceId,
    },
  );

  if (permissionError) {
    throw new CampaignQueryError(
      "Campaign workflow permissions could not be prepared.",
      permissionError.code,
    );
  }

  const trackingSnapshotAt = new Date().toISOString();
  const context = await getCampaignWorkspaceContext(client, campaign);
  context.progress = {
    snapshotAt: trackingSnapshotAt,
    steps: campaignWorkspaceProgress(campaign, context, trackingSnapshotAt),
  };
  const signedLinkUrls: Record<string, string> = {};
  let signingReady = false;

  try {
    if (context.trackingRestricted)
      throw new Error("Tracking is gated for this retained plan");
    const keyring = getTrackedLinkKeyring();
    const origin = getTrackedLinkApplicationOrigin();
    signingReady = true;

    await Promise.all(
      campaign.contentAssets.flatMap((asset) =>
        asset.trackedLinks
          .filter(
            ({ destinationPolicyActive, revocation }) =>
              destinationPolicyActive && revocation === null,
          )
          .map(async (link) => {
            try {
              const signed = await buildSignedTrackedLink({
                origin,
                keyring,
                payload: {
                  schemaVersion: 1,
                  linkId: link.id,
                  campaignId: campaign.id,
                  creatorId: asset.creatorId,
                  contentAssetId: asset.id,
                  expiresAt: link.expiresAt,
                  keyVersion: link.keyVersion,
                },
              });
              signedLinkUrls[link.id] = signed.url;
            } catch {
              // Older key evidence stays visible even if its signing key retired.
            }
          }),
      ),
    );
  } catch {
    // Issuance remains visibly unavailable until signing configuration is valid.
  }

  const executionReviewId = z.uuid().safeParse(query.executionReview);
  const devnetJob = z.uuid().safeParse(query.executionJob);
  const devnetReview = localDevnetReportEnabled() && devnetJob.success;
  return (
    <AppShell
      activeSection="campaigns"
      contentAppearance="application"
      projectId={projectId}
      theme={query.theme === "dark" ? "dark" : "light"}
    >
      <CampaignControlWorkspace
        measurementSetupEnabled={basketTimingEnabled(process.env)}
        context={context}
        projectSlug={projectId}
        view={campaignView(
          query.view ??
            (query.executionReview || devnetReview ? "results" : "control"),
        )}
        theme={query.theme === "dark" ? "dark" : "light"}
        executionReviewId={
          executionReviewId.success ? executionReviewId.data : undefined
        }
        executionReview={
          devnetReview ? (
            <BrowserCampaignExecution
              key={`devnet:${campaignId}:${devnetJob.data}`}
              campaignId={campaignId}
              canManage={canManage === true}
              devnetBoundary={{
                reconciliationJobId: devnetJob.data,
                timing: devnetReviewTiming(campaignId),
              }}
            />
          ) : browserCampaignEnabled() ? (
            <BrowserCampaignExecution
              campaignId={campaignId}
              canManage={canManage === true}
            />
          ) : undefined
        }
        activationReview={
          localDevnetTrackingCampaignEnabled(campaignId, campaign.basketId) ? (
            <LocalDevnetActivationHandoff
              campaignId={campaignId}
              canManage={canManage === true}
            />
          ) : undefined
        }
        campaign={campaign}
        canManage={canManage === true}
        signedLinkUrls={signedLinkUrls}
        signingReady={signingReady}
        trackingSnapshotAt={trackingSnapshotAt}
      />
    </AppShell>
  );
}
