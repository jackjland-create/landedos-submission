import type { CampaignRecord } from "@landed/contracts";
import {
  workspaceContextFixture,
  workspaceFixture,
} from "@/lib/campaign-workspace.fixture";
import type { CampaignWorkspaceContext } from "@/lib/campaign-workspace-context.server";
import { campaignWorkspaceProgress } from "@/lib/campaign-workspace-progress";

/** Fixed synthetic snapshot instant; never the browser clock. */
export const framePreviewSnapshotAt = "2026-09-22T12:00:00.000Z";

/*
 * Synthetic layout fixtures for the campaign frame preview only. They are not
 * approvals, live campaigns, reports or connected data, and never leave this
 * development-only route.
 */
export type FramePreviewStage = "brief" | "live";

export function framePreviewCampaign(stage: FramePreviewStage): CampaignRecord {
  const campaign = structuredClone(workspaceFixture);
  if (stage === "brief") return campaign;
  const creator = campaign.roster[0]!;
  campaign.status = "live";
  campaign.briefVersions = [
    {
      ...campaign.briefVersions[0]!,
      id: "a8000000-0000-4000-8000-000000000002",
      version: 2,
      status: "approved",
      audience: "Synthetic audience",
      keyMessage: "Synthetic key message",
      creatorDirection: "Synthetic direction",
      complianceNotes: "Synthetic compliance note",
      reason: "Synthetic approved brief",
    },
  ];
  const base = campaign.contentAssets[0]!;
  campaign.contentAssets = (
    [
      ["published", "Synthetic research thread"],
      ["approved", "Synthetic community discussion"],
      ["submitted", "Synthetic short video"],
      ["planned", "Synthetic follow-up post"],
    ] as const
  ).map(([status, label], index) => ({
    ...base,
    id: `a5000000-0000-4000-8000-00000000000${index + 1}`,
    campaignCreatorId: creator.id,
    assetIndex: index + 1,
    label,
    status,
  }));
  return campaign;
}

export function framePreviewContext(
  campaign: CampaignRecord,
  stage: FramePreviewStage,
  state: string | undefined,
  withProgress = true,
): CampaignWorkspaceContext {
  const base = {
    ...workspaceContextFixture,
    ...(stage === "live" ? { trackingRestricted: false } : {}),
  };
  const context =
    state === "unavailable"
      ? { ...base, planAvailable: false, reportUnavailable: true }
      : state === "report"
        ? {
            ...base,
            report: { id: "d2000000-0000-4000-8000-000000000001", version: 1 },
          }
        : base;
  return withProgress
    ? {
        ...context,
        progress: {
          snapshotAt: framePreviewSnapshotAt,
          steps: campaignWorkspaceProgress(
            campaign,
            context,
            framePreviewSnapshotAt,
          ),
        },
      }
    : context;
}
