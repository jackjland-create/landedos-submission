import type { CampaignBriefVersionRecord } from "@landed/contracts";

/** Presentation readiness only; server-side transition validation stays authoritative. */
export function briefHasRequiredDetails(brief: CampaignBriefVersionRecord) {
  return [
    brief.objective,
    brief.audience,
    brief.keyMessage,
    brief.creatorDirection,
  ].every((value) => Boolean(value?.trim()));
}
