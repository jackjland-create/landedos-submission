import { z } from "zod";
import {
  buildCampaignReportPreview,
  campaignReportSourcesSchema,
  timedCampaignReportSourcesSchema,
  buildTimedCampaignReportPreview,
} from "./campaign-report-preview";
import {
  retainedReportInstantSchema as instant,
  retainedReportMicros as micros,
} from "./report-instants";

const range = z.strictObject({ startedAt: instant, endedAt: instant });
const environment = z.enum(["demo", "devnet", "mainnet"]);
const historySchema = z.strictObject({
  kind: z.literal("campaign_history_readiness"),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  ruleVersionId: z.uuid(),
  measurementWindow: range,
  mappings: z
    .array(
      z.strictObject({
        mappingId: z.uuid(),
        creatorId: z.uuid(),
        contentAssetId: z.uuid(),
        requiredHistory: range,
        status: z.enum(["history_not_established", "history_recorded"]),
        matchingJob: z
          .strictObject({
            id: z.uuid(),
            environment,
            startedAt: instant,
            endedAt: instant,
            completedAt: instant,
          })
          .nullable(),
        latestJob: z
          .strictObject({
            id: z.uuid(),
            status: z.enum(["queued", "running", "completed", "failed"]),
            environment,
            startedAt: instant,
            endedAt: instant,
            completedAt: instant.nullable(),
            normalizationIssueCount: z.number().int().min(0).max(100000),
          })
          .nullable(),
      }),
    )
    .max(1000),
  completeness: z.literal("not_established"),
  issuance: z.literal("blocked"),
});

// Structural cross-checks, not authentication of caller-supplied JSON. The
// private SQL wrapper is responsible for permission and coherent provenance.
const strategyReportReviewSchema = z
  .strictObject({
    reportSources: z.union([
      campaignReportSourcesSchema,
      timedCampaignReportSourcesSchema,
    ]),
    historyReadiness: historySchema,
  })
  .superRefine(
    ({ reportSources: sources, historyReadiness: history }, context) => {
      const issue = (message: string) =>
        context.addIssue({ code: "custom", message });
      for (const key of [
        "workspaceId",
        "projectId",
        "campaignId",
        "ruleVersionId",
      ] as const)
        if (sources[key] !== history[key])
          issue("History scope does not match report sources");
      const times = [
        sources.measurementWindow.startedAt,
        sources.measurementWindow.endedAt,
        history.measurementWindow.startedAt,
        history.measurementWindow.endedAt,
        sources.commercialPlanSnapshot.strategyBinding.conversionRule
          .effectiveFrom,
        ...history.mappings.flatMap((m) => [
          m.requiredHistory.startedAt,
          m.requiredHistory.endedAt,
          ...(m.matchingJob
            ? [
                m.matchingJob.startedAt,
                m.matchingJob.endedAt,
                m.matchingJob.completedAt,
              ]
            : []),
          ...(m.latestJob
            ? [
                m.latestJob.startedAt,
                m.latestJob.endedAt,
                ...(m.latestJob.completedAt ? [m.latestJob.completedAt] : []),
              ]
            : []),
        ]),
      ];
      if (times.some((t) => !instant.safeParse(t).success)) {
        issue("Invalid history timestamp");
        return;
      }
      const start = micros(sources.measurementWindow.startedAt);
      const end = micros(sources.measurementWindow.endedAt);
      if (
        micros(history.measurementWindow.startedAt) !== start ||
        micros(history.measurementWindow.endedAt) !== end
      )
        issue("History period does not match report sources");
      if (
        new Set(history.mappings.map((m) => m.mappingId.toLowerCase())).size !==
        history.mappings.length
      )
        issue("Duplicate history mapping");
      const creators = new Set(
        sources.commercialPlanSnapshot.packages.map((p) => p.creatorId),
      );
      const jobMappings = new Map<string, string>();
      for (const m of history.mappings) {
        for (const job of [m.matchingJob, m.latestJob]) {
          if (!job) continue;
          const id = job.id.toLowerCase();
          const mappingId = m.mappingId.toLowerCase();
          if (jobMappings.has(id) && jobMappings.get(id) !== mappingId)
            issue("History job belongs to more than one mapping");
          jobMappings.set(id, mappingId);
        }
        if (!creators.has(m.creatorId))
          issue("History creator is not approved");
        const from = micros(m.requiredHistory.startedAt),
          to = micros(m.requiredHistory.endedAt);
        if (
          from >= to ||
          from >= end ||
          to <= start ||
          to > end ||
          from <
            micros(
              sources.commercialPlanSnapshot.strategyBinding.conversionRule
                .effectiveFrom,
            )
        )
          issue("Required history does not match the approved interval");
        if ((m.status === "history_recorded") !== (m.matchingJob !== null))
          issue("History status and job disagree");
        if (m.matchingJob) {
          const j = m.matchingJob;
          if (
            micros(j.startedAt) > from ||
            micros(j.endedAt) < to ||
            micros(j.completedAt) < micros(j.endedAt)
          )
            issue("Recorded job does not cover required history");
          if (!m.latestJob)
            issue("Recorded history requires latest job context");
        }
        if (m.latestJob) {
          const j = m.latestJob;
          if (
            micros(j.startedAt) >= micros(j.endedAt) ||
            (j.status === "completed") !== (j.completedAt !== null)
          )
            issue("Latest job shape is inconsistent");
          if (
            m.matchingJob?.id === j.id &&
            (j.status !== "completed" ||
              j.normalizationIssueCount !== 0 ||
              j.environment !== m.matchingJob.environment ||
              micros(j.startedAt) !== micros(m.matchingJob.startedAt) ||
              micros(j.endedAt) !== micros(m.matchingJob.endedAt) ||
              j.completedAt === null ||
              micros(j.completedAt) !== micros(m.matchingJob.completedAt))
          )
            issue("Matching and latest job disagree");
        }
      }
    },
  );

export const campaignReportReviewSchema = strategyReportReviewSchema.refine(
  (review) =>
    review.reportSources.commercialPlanSnapshot.strategyBinding
      .schemaVersion === 1,
  "Legacy report review requires binding version 1",
);
export const timedCampaignReportReviewSchema =
  strategyReportReviewSchema.refine(
    (review) =>
      review.reportSources.commercialPlanSnapshot.strategyBinding
        .schemaVersion === 2,
    "Timed report review requires binding version 2",
  );

export function buildCampaignReportReview(raw: unknown) {
  const review = campaignReportReviewSchema.parse(raw);
  return {
    ...buildCampaignReportPreview(review.reportSources),
    historyReadiness: buildHistoryReview(review.historyReadiness),
  };
}
export function buildTimedCampaignReportReview(raw: unknown) {
  const review = timedCampaignReportReviewSchema.parse(raw);
  return {
    ...buildTimedCampaignReportPreview(review.reportSources),
    historyReadiness: buildHistoryReview(review.historyReadiness),
  };
}
function buildHistoryReview(historyReadiness: z.infer<typeof historySchema>) {
  const mappings = historyReadiness.mappings;
  return {
    completeness: "not_established" as const,
    mappingCount: mappings.length,
    recordedHistoryCount: mappings.filter(
      (m) => m.status === "history_recorded",
    ).length,
    missingHistoryCount: mappings.filter(
      (m) => m.status === "history_not_established",
    ).length,
    latestFailedCount: mappings.filter((m) => m.latestJob?.status === "failed")
      .length,
    latestNormalizationIssueCount: mappings.filter(
      (m) => (m.latestJob?.normalizationIssueCount ?? 0) > 0,
    ).length,
    environments: [
      ...new Set(
        mappings.flatMap((m) =>
          [m.matchingJob?.environment, m.latestJob?.environment].filter(
            (e) => e !== undefined,
          ),
        ),
      ),
    ].sort(),
    mappings,
  };
}
