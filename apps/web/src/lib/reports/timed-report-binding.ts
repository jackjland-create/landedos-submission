import { inspectMetricV1RangeCompatibility } from "@landed/analytics";
import type { ClarityReportVersion } from "./clarity";
import type { TimedReportPresentation } from "./timed-report-presentation";

/** Internal consistency only; authorization and source authentication are separate. */
export function assertTimedReportBinding(
  report: {
    id: string;
    workspaceId: string;
    projectId: string;
    campaignId: string;
  },
  version: ClarityReportVersion,
  context: TimedReportPresentation,
) {
  const snapshot = version.metricSnapshot;
  const exact = inspectMetricV1RangeCompatibility(context.measurementWindow);
  if (
    context.workspaceId !== report.workspaceId ||
    context.projectId !== report.projectId ||
    context.campaignId !== report.campaignId ||
    context.reportId !== report.id ||
    context.reportVersionId !== version.id ||
    context.version !== version.version ||
    context.metricSnapshotId !== snapshot.id ||
    snapshot.workspaceId !== report.workspaceId ||
    snapshot.projectId !== report.projectId ||
    snapshot.campaignId !== report.campaignId ||
    exact.status !== "exactly_representable" ||
    Object.values(snapshot.metrics).some(
      (metric) =>
        metric.currencyCode !== context.costPolicy.currencyCode ||
        metric.sourceTimeRange.startedAt !== exact.metricV1Range.startedAt ||
        metric.sourceTimeRange.endedAt !== exact.metricV1Range.endedAt ||
        metric.dataFreshness.dataThrough !== exact.metricV1Range.endedAt,
    ) ||
    snapshot.metrics.cpa.denominator.status !== "not_available" ||
    snapshot.metrics.revenueRoas.numerator.status !== "not_available"
  )
    throw new Error("Issued report context is inconsistent.");
}
