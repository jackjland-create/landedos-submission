import type { CampaignRecord } from "@landed/contracts";

export type CampaignProgressStep = {
  id: "plan" | "brief" | "links" | "activation" | "delivery" | "results";
  label: string;
  state: "complete" | "pending" | "unavailable";
  detail: string;
};

type ProgressContext = {
  planAvailable: boolean;
  report: { id: string; version: number } | null;
  reportUnavailable: boolean;
};

/** CMP-03: display-only retained facts. Never grants approval or activation. */
export function campaignWorkspaceProgress(
  campaign: CampaignRecord,
  context: ProgressContext,
  snapshotAt: string,
): CampaignProgressStep[] {
  const instant = Date.parse(snapshotAt);
  const brief = campaign.briefVersions[0];
  const assets = campaign.contentAssets;
  const published = assets.filter(
    (asset) => asset.status === "published",
  ).length;
  const linked = assets.filter((asset) =>
    asset.trackedLinks.some(
      (link) =>
        !link.revocation &&
        link.destinationPolicyActive &&
        Date.parse(link.issuedAt) <= instant &&
        Date.parse(link.expiresAt) > instant,
    ),
  ).length;
  const activated = ["live", "finalizing", "finalized"].includes(
    campaign.status,
  );
  return [
    {
      id: "plan",
      label: "Plan",
      state: context.planAvailable ? "complete" : "unavailable",
      detail: context.planAvailable
        ? `Commercial plan v${campaign.commercialPlanVersion} retained`
        : "Approved plan could not be checked",
    },
    {
      id: "brief",
      label: "Brief",
      state: !brief
        ? "unavailable"
        : brief.status === "approved"
          ? "complete"
          : "pending",
      detail: brief
        ? `Brief v${brief.version} · ${brief.status.replaceAll("_", " ")}`
        : "Brief unavailable",
    },
    {
      id: "links",
      label: "Tracking links",
      state:
        !assets.length || !Number.isFinite(instant)
          ? "unavailable"
          : linked === assets.length
            ? "complete"
            : "pending",
      detail: !Number.isFinite(instant)
        ? "Link freshness could not be checked"
        : !assets.length
          ? "No content assets recorded"
          : `${linked} / ${assets.length} assets with a current link · activation is separate`,
    },
    {
      id: "activation",
      label: "Activation",
      state: activated ? "complete" : "pending",
      detail:
        campaign.status === "live"
          ? "Campaign is live"
          : activated
            ? "Campaign has ended its live phase"
            : "Not live",
    },
    {
      id: "delivery",
      label: "Delivery",
      state: !assets.length
        ? "unavailable"
        : published === assets.length
          ? "complete"
          : "pending",
      detail: assets.length
        ? `${published} / ${assets.length} assets published`
        : "No content assets recorded",
    },
    {
      id: "results",
      label: "Results",
      state: context.reportUnavailable
        ? "unavailable"
        : context.report
          ? "complete"
          : "pending",
      detail: context.reportUnavailable
        ? "Issued report could not be checked"
        : context.report
          ? `Report v${context.report.version} issued`
          : "No issued report yet",
    },
  ];
}
