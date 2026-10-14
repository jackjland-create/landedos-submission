import "server-only";

import { buildCampaignReportReview } from "@landed/analytics";
import { z } from "zod";

const scopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
});

export type StrategyReportSourceClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>;
};

export class StrategyReportPreviewError extends Error {
  constructor(readonly code?: string) {
    super("Campaign report preview is unavailable.");
    this.name = "StrategyReportPreviewError";
  }
}

/** Private integration rehearsal only: SQL still denies all runtime roles.
 * No service fallback, writes, job activation or report issuance. */
export async function loadStrategyReportPreview(
  client: StrategyReportSourceClient,
  rawScope: { workspaceId: string; projectId: string; campaignId: string },
) {
  const parsed = scopeSchema.safeParse(rawScope);
  if (!parsed.success) throw new StrategyReportPreviewError();
  const scope = parsed.data;
  let response;
  try {
    response = await client.rpc("load_campaign_report_review", {
      target_project_id: scope.projectId,
      target_campaign_id: scope.campaignId,
    });
  } catch {
    throw new StrategyReportPreviewError();
  }
  if (
    !response ||
    typeof response !== "object" ||
    !("data" in response) ||
    !("error" in response)
  )
    throw new StrategyReportPreviewError();
  if (response.error) throw new StrategyReportPreviewError(response.error.code);
  try {
    const preview = buildCampaignReportReview(response.data);
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
