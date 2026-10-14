import "server-only";

import {
  inspectMetricV1RangeCompatibility,
  retainedReportMicros,
} from "@landed/analytics";
import type { loadTimedCampaignExecutionReportReview } from "./campaign-execution.server";

type TimedReview = Awaited<
  ReturnType<typeof loadTimedCampaignExecutionReportReview>
>;
type History =
  TimedReview["reportReview"]["historyReadiness"]["mappings"][number];
type Range = { startedAt: string; endedAt: string };

type CandidateDiagnostic =
  | "execution_receipt_not_recorded"
  | "report_result_not_observed"
  | "required_history_not_established"
  | "latest_history_job_failed"
  | "latest_history_job_has_normalization_issues";

function unconfirmed(): never {
  throw new Error("Source evidence relationships could not be confirmed.");
}

function range(value: Range) {
  return { startedAt: value.startedAt, endedAt: value.endedAt };
}

function job(value: History["matchingJob"] | History["latestJob"]) {
  if (value === null) return null;
  // Explicit projection: never copy a caller's extra fields into the manifest.
  return {
    id: value.id,
    environment: value.environment,
    requestedRange: range(value),
    completedAt: value.completedAt,
    status: "status" in value ? value.status : ("completed" as const),
    normalizationIssueCount:
      "normalizationIssueCount" in value ? value.normalizationIssueCount : 0,
  };
}

/** Pure projection of the existing authorized, validated timed reader result.
 * This is not authentication of arbitrary JSON or a new acquisition ledger.
 * Keep on the server: protected mapping IDs are used only for the internal join.
 * No RPC, execution, issuance, financial calculation or completeness inference.
 */
export function buildTimedSourceEvidenceManifest(input: TimedReview) {
  const execution = input.execution;
  const approved = execution.preview.review;
  const review = input.reportReview;
  if (
    input.reportIssuance !== "blocked" ||
    input.completeness !== "not_established" ||
    input.reportScope !== "campaign_wide" ||
    review.issuance.status !== "blocked" ||
    review.observedEvidence.completeness !== "not_established" ||
    review.historyReadiness.completeness !== "not_established" ||
    review.temporalEvidence.completeness !== "not_established" ||
    review.temporalEvidence.dataFreshness !== "not_established"
  )
    unconfirmed();
  for (const key of [
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "commercialPlanSnapshotHash",
    "ruleVersionId",
  ] as const)
    if (approved[key] !== review[key]) unconfirmed();
  for (const key of ["startedAt", "endedAt"] as const)
    if (
      retainedReportMicros(approved.measurementWindow[key]) !==
        retainedReportMicros(review.measurementWindow[key]) ||
      retainedReportMicros(approved.measurementWindow[key]) !==
        retainedReportMicros(review.approvedTiming.measurement[key])
    )
      unconfirmed();

  const candidates = approved.candidates;
  for (const key of [
    "calculationRequestId",
    "conversionFactId",
    "attributionFactId",
    "protectedWalletMappingId",
    "canonicalChainEventId",
  ] as const)
    if (
      new Set(candidates.map((candidate) => candidate[key])).size !==
      candidates.length
    )
      unconfirmed();
  const histories = review.historyReadiness.mappings;
  const historyByMapping = new Map(
    histories.map((item) => [item.mappingId, item]),
  );
  if (historyByMapping.size !== histories.length) unconfirmed();
  const results = review.temporalEvidence.periods.flatMap(
    (period) => period.resultEvidence,
  );
  if (
    results.length !== review.observedEvidence.resultCount ||
    new Set(results.map((item) => item.conversionFactId)).size !==
      results.length ||
    new Set(results.map((item) => item.attributionFactId)).size !==
      results.length
  )
    unconfirmed();
  const resultByConversion = new Map(
    results.map((item) => [item.conversionFactId, item]),
  );
  const receipt = execution.receipt;
  const receiptByRequest = new Map(
    receipt?.batch.results.map((item) => [item.calculationRequestId, item]) ??
      [],
  );
  if (
    receipt !== null &&
    (receipt.approvalId !== execution.approvalId ||
      receipt.reviewHash !== execution.preview.reviewHash ||
      receipt.batch.campaignId !== approved.campaignId ||
      receipt.batch.ruleVersionId !== approved.ruleVersionId ||
      receiptByRequest.size !== candidates.length ||
      receipt.batch.results.length !== candidates.length ||
      receipt.batch.processedCount !== candidates.length)
  )
    unconfirmed();

  const candidateEvidence = [...candidates]
    .sort((a, b) =>
      a.calculationRequestId.localeCompare(b.calculationRequestId),
    )
    .map((candidate) => {
      const history = historyByMapping.get(candidate.protectedWalletMappingId);
      const retained = receiptByRequest.get(candidate.calculationRequestId);
      const result = resultByConversion.get(candidate.conversionFactId);
      if (
        (receipt !== null &&
          (!retained ||
            retained.conversionFactId !== candidate.conversionFactId ||
            retained.attributionFactId !== candidate.attributionFactId ||
            !result)) ||
        (result &&
          (result.attributionFactId !== candidate.attributionFactId ||
            result.canonicalChainEventId !== candidate.canonicalChainEventId ||
            (history &&
              (result.creatorId !== history.creatorId ||
                result.contentAssetId !== history.contentAssetId)))) ||
        (history &&
          (history.status === "history_recorded") !==
            (history.matchingJob !== null))
      )
        unconfirmed();
      // Diagnostics describe only this exact candidate's retained observations.
      // A clean candidate does not certify campaign-wide acquisition/evaluation.
      const diagnostics: CandidateDiagnostic[] = [];
      if (!retained) diagnostics.push("execution_receipt_not_recorded");
      if (!result) diagnostics.push("report_result_not_observed");
      if (history?.status !== "history_recorded")
        diagnostics.push("required_history_not_established");
      if (history?.latestJob?.status === "failed")
        diagnostics.push("latest_history_job_failed");
      if ((history?.latestJob?.normalizationIssueCount ?? 0) > 0)
        diagnostics.push("latest_history_job_has_normalization_issues");
      return {
        calculationRequestId: candidate.calculationRequestId,
        canonicalChainEventId: candidate.canonicalChainEventId,
        receiptEvidence: retained
          ? ("recorded" as const)
          : ("not_recorded" as const),
        reportEvidence: result
          ? ("retained" as const)
          : ("not_observed" as const),
        resultEvidence: result
          ? {
              conversionFactId: result.conversionFactId,
              attributionFactId: result.attributionFactId,
              creatorId: result.creatorId,
              contentAssetId: result.contentAssetId,
              conversionTime: result.conversionTime,
              confidence: result.confidence,
            }
          : null,
        historyObservation:
          history?.status ?? ("history_not_established" as const),
        requiredHistory: history ? range(history.requiredHistory) : null,
        matchingJob: job(history?.matchingJob ?? null),
        latestJob: job(history?.latestJob ?? null),
        diagnostics,
      };
    });

  return {
    kind: "timed_source_evidence_manifest" as const,
    workspaceId: approved.workspaceId,
    projectId: approved.projectId,
    campaignId: approved.campaignId,
    commercialPlanVersionId: approved.commercialPlanVersionId,
    commercialPlanSnapshotHash: approved.commercialPlanSnapshotHash,
    ruleVersionId: approved.ruleVersionId,
    approvedTiming: {
      flight: range(review.approvedTiming.flight),
      measurement: range(review.approvedTiming.measurement),
    },
    databaseReadAt: execution.readAt,
    readTimeMeaning: "database_snapshot_only" as const,
    execution: {
      approvalId: execution.approvalId,
      reviewHash: execution.preview.reviewHash,
      receiptObservation:
        receipt === null ? ("not_recorded" as const) : ("recorded" as const),
      candidateCount: candidates.length,
      receiptResultCount: receiptByRequest.size,
      candidateEnvironments: [...approved.environments],
    },
    observedSources: {
      scope: "campaign_wide" as const,
      retainedResultCount: review.observedEvidence.resultCount,
      walletEvidenceCount: review.observedEvidence.walletCount,
      qualifiedClickEvidenceCount: review.observedEvidence.qualifiedClickCount,
      periods: review.temporalEvidence.periods.map((period) => ({
        period: period.period,
        window: range(period.window),
        plannedDurationMicroseconds: period.plannedDurationMicroseconds,
        retainedResultCount: period.retainedResultCount,
        observedCoverage: "not_established" as const,
      })),
    },
    historyRelationshipScope: "approved_candidate_subset_only" as const,
    candidateEvidence,
    unresolvedSourceRequirements: [
      "campaign_coverage_not_established",
      "data_freshness_not_established",
    ] as const,
    diagnosticMeaning: "retained_observations_not_issuance_authority" as const,
    metricV1PeriodCompatibility: inspectMetricV1RangeCompatibility(
      review.approvedTiming.measurement,
    ),
    completeness: "not_established" as const,
    dataFreshness: "not_established" as const,
    reportIssuance: "blocked" as const,
  };
}
