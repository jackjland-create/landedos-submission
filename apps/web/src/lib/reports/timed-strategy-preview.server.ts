import "server-only";
import { buildTimedCampaignReportReview } from "@landed/analytics";
import { z } from "zod";
import {
  StrategyReportPreviewError,
  type StrategyReportSourceClient,
} from "./strategy-preview.server";

const scopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
});

/** Private timing-aware preparation, never issuance. SQL retains authority for
 * exact campaign flight, snapshot provenance and current manager access. */
export async function loadTimedStrategyReportPreview(
  client: StrategyReportSourceClient,
  rawScope: unknown,
) {
  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw new StrategyReportPreviewError();
  const scope = parsed.data;
  try {
    const response = await client.rpc("load_timed_campaign_report_review", {
      target_project_id: scope.projectId,
      target_campaign_id: scope.campaignId,
    });
    if (
      !response ||
      typeof response !== "object" ||
      !("data" in response) ||
      !("error" in response) ||
      response.error
    )
      throw new StrategyReportPreviewError();
    const preview = buildTimedCampaignReportReview(response.data);
    if (
      preview.workspaceId !== scope.workspaceId ||
      preview.projectId !== scope.projectId ||
      preview.campaignId !== scope.campaignId
    )
      throw new StrategyReportPreviewError();
    return preview;
  } catch {
    throw new StrategyReportPreviewError();
  }
}
