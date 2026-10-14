import "server-only";
import { z } from "zod";
import { timedCampaignReportReviewSchema } from "@landed/analytics";
import { validateCompletedTimedReportExecution } from "../attribution/campaign-execution.server";
import type { TimedRuntimeScope } from "./timed-report-runtime.server";

/** BSK-09 / INT-01: safe retained context, never approval or execution authority. */
export function projectTimedCampaignHandoff(
  raw: unknown,
  scope: TimedRuntimeScope,
  executionId: string,
  browserProvenance = false,
  devnetExecutionProvenance = false,
) {
  const bundle = z
    .object({
      evidence: z.object({ executionReview: z.unknown() }),
    })
    .parse(raw);
  if (
    validateCompletedTimedReportExecution(bundle.evidence.executionReview) !==
    executionId
  )
    throw new Error("Campaign execution identity changed.");
  const bridge = z
    .object({
      execution: z.object({
        approvalId: z.uuid(),
        approvedAt: z.string(),
        receipt: z.object({
          reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
          batch: z.object({ processedCount: z.number().int().nonnegative() }),
        }),
      }),
      reportReview: timedCampaignReportReviewSchema,
    })
    .parse(bundle.evidence.executionReview);
  const sources = bridge.reportReview.reportSources;
  if (
    sources.workspaceId !== scope.workspaceId ||
    sources.projectId !== scope.projectId ||
    sources.campaignId !== scope.campaignId
  )
    throw new Error("Campaign handoff scope changed.");
  const plan = sources.commercialPlanSnapshot;
  if (plan.strategyBinding.schemaVersion !== 2)
    throw new Error("Approved campaign timing is unavailable.");
  return {
    scope: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      campaignId: scope.campaignId,
    },
    basketId: plan.basket.id,
    campaignName: plan.basket.name,
    objective: plan.basket.objective,
    scenario: plan.scenario,
    commercialPlanVersionId: sources.commercialPlanVersionId,
    commercialPlanSnapshotHash: sources.commercialPlanSnapshotHash,
    ruleVersionId: sources.ruleVersionId,
    flight: plan.strategyBinding.timing.flight,
    measurementWindow: sources.measurementWindow,
    packages: plan.packages.map((p) => ({
      id: p.id,
      creatorId: p.creatorId,
      packageLabel: p.packageLabel,
      deliverableSummary: p.deliverableSummary,
      compensationLines: p.compensationLines,
    })),
    execution: {
      approvalId: bridge.execution.approvalId,
      approvedAt: bridge.execution.approvedAt,
      reviewHash: bridge.execution.receipt.reviewHash,
      processedCount: bridge.execution.receipt.batch.processedCount,
    },
    upstreamProof: devnetExecutionProvenance
      ? ("retained_devnet_execution" as const)
      : browserProvenance
        ? ("browser_actions_synthetic_sources" as const)
        : ("owner_sql_synthetic_rehearsal" as const),
    // Completed devnet execution is established by the private wrapper, not
    // browser entry or live provider provenance. Do not invent those claims.
    browserCommercialApproval: devnetExecutionProvenance
      ? null
      : browserProvenance,
    browserExecution: devnetExecutionProvenance ? null : browserProvenance,
    liveIngestion: devnetExecutionProvenance ? null : (false as const),
  };
}
