import "server-only";
import { z } from "zod";
import { localDevnetRehearsalEnabled } from "./devnet-campaign-runtime.server";
import { sameCopyResultsEnabled } from "./same-copy-results.server";

/** Display-only metadata from the owned runner. Never authorizes a decision. */
export function devnetReviewTiming(
  campaignId: string,
  env: NodeJS.ProcessEnv = process.env,
): { decisionsCloseAt: string | null } | undefined {
  if (
    !(localDevnetRehearsalEnabled(env) || sameCopyResultsEnabled(env)) ||
    env.LANDED_LOCAL_DEVNET_INPUT_LOCK !== "review" ||
    !z.uuid().safeParse(campaignId).success ||
    campaignId !== env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID
  )
    return undefined;
  const parsed = z.iso
    .datetime({ offset: true })
    .safeParse(env.LANDED_LOCAL_DEVNET_REVIEW_DECISIONS_CLOSE_AT);
  return { decisionsCloseAt: parsed.success ? parsed.data : null };
}
