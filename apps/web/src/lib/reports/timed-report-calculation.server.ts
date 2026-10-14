import "server-only";

import {
  buildContractedCostReview,
  computeCampaignMetrics,
  inspectMetricV1RangeCompatibility,
  metricSnapshotInputSchema,
  timedCampaignReportReviewSchema,
} from "@landed/analytics";
import { z } from "zod";
import { inspectRetainedReportCoverage } from "./retained-coverage.server";
import { validateCompletedTimedReportExecution } from "../attribution/campaign-execution.server";

const identitySchema = z.strictObject({
  reportApprovalId: z.uuid(),
  executionApprovalId: z.uuid(),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
  metricSnapshotId: z.uuid(),
  issueRequestId: z.uuid(),
  requestedBy: z.uuid(),
});

/** BSK-09 / RPT-01: trusted server calculator only; never bind this function to
 * caller-supplied source JSON. The private loader and human approval/atomic
 * persistence boundaries are separate. No activation or revenue is invented.
 */
export function calculateTimedReportReview(
  rawBundle: unknown,
  rawCostReview: unknown,
  rawIdentity: unknown,
) {
  const identity = identitySchema.parse(rawIdentity);
  const coverage = inspectRetainedReportCoverage(rawBundle);
  const bundle = z
    .object({
      evidence: z.object({
        executionReview: z.object({
          execution: z.object({ approvalId: z.uuid() }),
          reportReview: timedCampaignReportReviewSchema,
        }),
      }),
    })
    .parse(rawBundle);
  validateCompletedTimedReportExecution(
    z
      .object({ evidence: z.object({ executionReview: z.unknown() }) })
      .parse(rawBundle).evidence.executionReview,
  );
  if (
    bundle.evidence.executionReview.execution.approvalId !==
    identity.executionApprovalId
  )
    throw new Error("Report review execution identity disagrees.");
  const sources = bundle.evidence.executionReview.reportReview.reportSources;
  const costReview = buildContractedCostReview(sources, rawCostReview);
  const range = inspectMetricV1RangeCompatibility(sources.measurementWindow);
  if (range.status !== "exactly_representable")
    throw new Error(
      "Measurement requires a different metric calculation version.",
    );
  const calculatedAt = new Date(coverage.checkedAt).toISOString();
  const input = metricSnapshotInputSchema.parse({
    id: identity.metricSnapshotId,
    workspaceId: sources.workspaceId,
    projectId: sources.projectId,
    campaignId: sources.campaignId,
    currencyCode: costReview.currencyCode,
    valuationPolicy: {
      id: "landed-reviewed-contracted-costs",
      version: 1,
      description:
        "Human-reviewed contracted campaign costs; not payments made. No FX or non-cash valuation.",
      currencyCode: costReview.currencyCode,
      valuedAt: calculatedAt,
    },
    conversionRuleVersionIds: [sources.ruleVersionId],
    attributionClassifierVersion: 1,
    sourceTimeRange: range.metricV1Range,
    dataFreshness: { dataThrough: range.metricV1Range.endedAt, calculatedAt },
    spend:
      costReview.total.status === "available"
        ? {
            status: "complete",
            lines: costReview.lines
              .filter((l) => l.inclusion === "included")
              .map((l) => {
                if (l.terms.assetType !== "cash" || l.terms.model !== "fixed")
                  throw new Error("Unsupported included cost.");
                return {
                  id: l.compensationLineId,
                  kind: "creator_compensation",
                  amountMinor: l.terms.amountMinor,
                  inclusion: "included",
                  exclusionReason: null,
                  sourceEvidenceId: `${sources.commercialPlanVersionId}:${l.compensationLineId}`,
                };
              }),
          }
        : { status: "not_available", reason: "source_incomplete" },
    qualifiedClicks: {
      status: "complete",
      evidenceIds: sources.qualifiedClickEvidence.map((c) => c.assessmentId),
    },
    qualifiedWallets: {
      status: "complete",
      evidenceIds: sources.walletAttributionEvidenceIds,
    },
    activatedWallets: {
      status: "not_available",
      reason: "source_not_configured",
    },
    activationDefinition: {
      ruleVersionId: sources.ruleVersionId,
      label: "Separate activation measurement is not configured",
    },
    protocolRevenue: {
      status: "not_available",
      reason: "source_not_configured",
    },
  });
  return {
    protocol: "landed:timed-report-calculation:1" as const,
    identity,
    workspaceId: sources.workspaceId,
    projectId: sources.projectId,
    campaignId: sources.campaignId,
    ruleVersionId: sources.ruleVersionId,
    commercialPlanVersionId: sources.commercialPlanVersionId,
    commercialPlanSnapshotHash: sources.commercialPlanSnapshotHash,
    measurementWindow: sources.measurementWindow,
    sourceHash: coverage.sourceHash,
    sourceHashProtocol: coverage.sourceHashProtocol,
    coverage,
    costReview,
    metricSnapshot: computeCampaignMetrics(input),
    disclosures: {
      costBasis: "contracted_not_paid",
      coverage: "retained_consented_history_only",
      providerExhaustion: "not_independently_verified",
      activation: "not_available",
      protocolRevenue: "not_available",
      impressions: "not_available",
    },
    approval: "required" as const,
  };
}
