import {
  campaignMetricSnapshotSchema,
  computeCampaignMetrics,
  metricSnapshotInputSchema,
  type CampaignMetricSnapshot,
  type MetricSnapshotInput,
} from "@landed/analytics";
import { z } from "zod";

import { logError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

import { inngest } from "./client";

const replayEventSchema = z.object({ replayRunId: z.uuid() });

const startResultSchema = z
  .array(
    z.object({
      replay_run_id: z.uuid(),
      status: z.enum(["running", "completed", "failed"]),
      candidate_count: z.number().int().nonnegative(),
      campaign_count: z.number().int().positive(),
    }),
  )
  .length(1);

const campaignWorkSchema = z.array(
  z.object({
    replay_campaign_id: z.uuid(),
    replay_run_id: z.uuid(),
    workspace_id: z.uuid(),
    project_id: z.uuid(),
    campaign_id: z.uuid(),
    rule_version_id: z.uuid(),
    approved_by: z.uuid(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    source_started_at: z.iso.datetime({ offset: true }),
    source_ended_at: z.iso.datetime({ offset: true }),
    prior_report_id: z.uuid(),
    prior_metric_snapshot_id: z.uuid(),
    prior_metric_snapshot: z.unknown(),
    issue_request_id: z.uuid(),
    planned_metric_snapshot_id: z.uuid(),
    planned_report_version_id: z.uuid(),
    included_spend_line_id: z.uuid(),
    excluded_spend_line_id: z.uuid(),
    approved_at: z.iso.datetime({ offset: true }),
  }),
);

const candidateSchema = z.object({
  candidate_id: z.uuid(),
  calculation_request_id: z.uuid(),
  conversion_fact_id: z.uuid(),
  attribution_fact_id: z.uuid(),
  project_id: z.uuid(),
  rule_version_id: z.uuid(),
  protected_wallet_mapping_id: z.uuid(),
  canonical_chain_event_id: z.uuid(),
  status: z.enum(["queued", "matched", "unmatched", "failed"]),
});

const candidateListSchema = z.array(candidateSchema);

const metricEvidenceSchema = z
  .array(
    z.object({
      qualified_click_ids: z.array(z.uuid()),
      wallet_attribution_ids: z.array(z.uuid()),
    }),
  )
  .length(1);

const factResultSchema = z
  .array(
    z.object({
      conversion_fact_id: z.uuid(),
      attribution_fact_id: z.uuid(),
      inserted: z.boolean(),
    }),
  )
  .length(1);

const reportResultSchema = z
  .array(
    z.object({
      report_id: z.uuid(),
      report_version_id: z.uuid(),
      metric_snapshot_id: z.uuid(),
      version: z.number().int().positive(),
      inserted: z.boolean(),
      issued_at: z.iso.datetime({ offset: true }),
      metric_snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      report_payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .length(1);

type ReplayClient = ReturnType<typeof createAdminClient>;
type CampaignWork = z.infer<typeof campaignWorkSchema>[number];
type Candidate = z.infer<typeof candidateSchema>;

async function rpc(
  client: ReplayClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

function unavailableReason(value: { reason?: unknown }) {
  return value.reason === "source_incomplete"
    ? ("source_incomplete" as const)
    : ("source_not_configured" as const);
}

export function buildReplayMetricInput({
  calculatedAt,
  metricSnapshotId,
  matchedAttributionFactIds,
  qualifiedClickIds,
  priorMetricSnapshotId,
  rawPriorMetricSnapshot,
  work,
}: {
  calculatedAt: string;
  metricSnapshotId: string;
  matchedAttributionFactIds: string[];
  qualifiedClickIds: string[];
  priorMetricSnapshotId: string;
  rawPriorMetricSnapshot: unknown;
  work: CampaignWork;
}): MetricSnapshotInput {
  const prior = campaignMetricSnapshotSchema.parse(rawPriorMetricSnapshot);
  const priorCpc = prior.metrics.cpc;
  const spendUnavailableReason =
    priorCpc.numerator.status === "not_available"
      ? unavailableReason(priorCpc.numerator)
      : priorCpc.excludedSpend.status === "not_available"
        ? unavailableReason(priorCpc.excludedSpend)
        : null;
  const spend: MetricSnapshotInput["spend"] =
    spendUnavailableReason === null &&
    priorCpc.numerator.status === "available" &&
    priorCpc.excludedSpend.status === "available"
      ? {
          status: "complete",
          lines: [
            {
              id: work.included_spend_line_id,
              kind: "campaign_cost",
              amountMinor: priorCpc.numerator.valueMinor,
              inclusion: "included",
              exclusionReason: null,
              sourceEvidenceId: `replay:prior-metric-snapshot:${priorMetricSnapshotId}:included-spend`,
            },
            ...(priorCpc.excludedSpend.valueMinor !== "0"
              ? [
                  {
                    id: work.excluded_spend_line_id,
                    kind: "campaign_cost" as const,
                    amountMinor: priorCpc.excludedSpend.valueMinor,
                    inclusion: "excluded" as const,
                    exclusionReason:
                      "Retained excluded spend from the prior metric snapshot",
                    sourceEvidenceId: `replay:prior-metric-snapshot:${priorMetricSnapshotId}:excluded-spend`,
                  },
                ]
              : []),
          ],
        }
      : {
          status: "not_available",
          reason: spendUnavailableReason ?? "source_incomplete",
        };

  const qualifiedClicks: MetricSnapshotInput["qualifiedClicks"] = {
    status: "complete",
    evidenceIds: [...new Set(qualifiedClickIds)].sort(),
  };
  const factIds = [...new Set(matchedAttributionFactIds)].sort();

  return metricSnapshotInputSchema.parse({
    id: metricSnapshotId,
    workspaceId: work.workspace_id,
    projectId: work.project_id,
    campaignId: work.campaign_id,
    currencyCode: priorCpc.currencyCode,
    valuationPolicy: priorCpc.valuationPolicy,
    conversionRuleVersionIds: [work.rule_version_id],
    attributionClassifierVersion: 1,
    sourceTimeRange: {
      startedAt: new Date(work.source_started_at).toISOString(),
      endedAt: new Date(work.source_ended_at).toISOString(),
    },
    dataFreshness: {
      dataThrough: new Date(work.source_ended_at).toISOString(),
      calculatedAt,
    },
    spend,
    qualifiedClicks,
    qualifiedWallets: { status: "complete", evidenceIds: factIds },
    activatedWallets: { status: "complete", evidenceIds: factIds },
    activationDefinition: {
      ruleVersionId: work.rule_version_id,
      label: "First qualifying transaction / retained replay",
    },
    protocolRevenue: {
      status: "not_available",
      reason: "source_not_configured",
    },
  });
}

async function evaluateCandidate(client: ReplayClient, candidate: Candidate) {
  if (candidate.status !== "queued") return candidate.status;

  const result = await client.rpc("record_strong_attribution_fact", {
    target_attribution_fact_id: candidate.attribution_fact_id,
    target_calculation_request_id: candidate.calculation_request_id,
    target_canonical_chain_event_id: candidate.canonical_chain_event_id,
    target_conversion_fact_id: candidate.conversion_fact_id,
    target_project_id: candidate.project_id,
    target_protected_wallet_mapping_id: candidate.protected_wallet_mapping_id,
    target_rule_version_id: candidate.rule_version_id,
  });

  if (result.error) {
    if (result.error.code !== "22023") throw result.error;
    await rpc(client, "record_conversion_replay_candidate_result", {
      target_outcome: "unmatched",
      target_reason_code: "ineligible_evidence",
      target_replay_candidate_id: candidate.candidate_id,
    });
    return "unmatched" as const;
  }

  const retained = factResultSchema.parse(result.data)[0];
  if (
    retained.attribution_fact_id !== candidate.attribution_fact_id ||
    retained.conversion_fact_id !== candidate.conversion_fact_id
  ) {
    throw new Error("Replay attribution result changed retained identity.");
  }
  await rpc(client, "record_conversion_replay_candidate_result", {
    target_outcome: "matched",
    target_reason_code: "matched",
    target_replay_candidate_id: candidate.candidate_id,
  });
  return "matched" as const;
}

export const replayConversionHistory = inngest.createFunction(
  {
    id: "conversion-history-replay",
    name: "Replay conversion history",
    concurrency: { limit: 1, key: "event.data.replayRunId" },
    idempotency: "event.data.replayRunId",
    retries: 3,
    onFailure: async ({ event }) => {
      const original = replayEventSchema.safeParse(event.data.event.data);
      if (!original.success) return;
      const client = createAdminClient();
      const failed = await client.rpc("fail_conversion_replay_run", {
        target_failure_code: "job_retries_exhausted",
        target_replay_run_id: original.data.replayRunId,
      });
      if (failed.error) {
        logError({
          event: "conversion_replay_failure_record_failed",
          error: failed.error,
          projectId: original.data.replayRunId,
        });
      }
    },
  },
  { event: "landed/conversion.replay.approved" },
  async ({ event, step }) => {
    const { replayRunId } = replayEventSchema.parse(event.data);
    const client = createAdminClient();

    try {
      const started = await step.run("start-replay", async () =>
        startResultSchema.parse(
          await rpc(client, "start_conversion_replay_run", {
            target_replay_run_id: replayRunId,
          }),
        ),
      );
      if (started[0].status === "completed") {
        return { replayRunId, status: "completed" as const };
      }
      if (started[0].status === "failed") {
        throw new Error("Conversion replay is already failed.");
      }

      const campaigns = await step.run("load-replay-campaigns", async () =>
        campaignWorkSchema.parse(
          await rpc(client, "get_conversion_replay_campaign_work", {
            target_replay_run_id: replayRunId,
          }),
        ),
      );

      for (const work of campaigns) {
        if (work.status === "completed") continue;
        const candidates = await step.run(
          `load-candidates-${work.replay_campaign_id}`,
          async () =>
            candidateListSchema.parse(
              await rpc(client, "get_conversion_replay_candidates", {
                target_replay_campaign_id: work.replay_campaign_id,
              }),
            ),
        );

        for (const candidate of candidates) {
          await step.run(`evaluate-${candidate.candidate_id}`, () =>
            evaluateCandidate(client, candidate),
          );
        }

        const evidence = await step.run(
          `load-metric-evidence-${work.replay_campaign_id}`,
          async () =>
            metricEvidenceSchema.parse(
              await rpc(client, "get_conversion_replay_metric_evidence", {
                target_replay_campaign_id: work.replay_campaign_id,
              }),
            )[0],
        );

        await step.run(`issue-report-${work.replay_campaign_id}`, async () => {
          const metricSnapshotId = work.planned_metric_snapshot_id;
          const reportVersionId = work.planned_report_version_id;
          const issueRequestId = work.issue_request_id;
          const calculatedAt = new Date(work.approved_at).toISOString();
          const metricInput = buildReplayMetricInput({
            calculatedAt,
            matchedAttributionFactIds: evidence.wallet_attribution_ids,
            qualifiedClickIds: evidence.qualified_click_ids,
            metricSnapshotId,
            priorMetricSnapshotId: work.prior_metric_snapshot_id,
            rawPriorMetricSnapshot: work.prior_metric_snapshot,
            work,
          });
          const metricSnapshot: CampaignMetricSnapshot =
            campaignMetricSnapshotSchema.parse(
              computeCampaignMetrics(metricInput),
            );

          const issued = reportResultSchema.parse(
            await rpc(client, "issue_campaign_report", {
              target_campaign_id: work.campaign_id,
              target_issue_request_id: issueRequestId,
              target_metric_snapshot: metricSnapshot,
              target_metric_snapshot_id: metricSnapshotId,
              target_project_id: work.project_id,
              target_report_id: work.prior_report_id,
              target_report_version_id: reportVersionId,
              target_requested_by: work.approved_by,
            }),
          )[0];

          await rpc(
            client,
            "issue_report_measurement_context_from_retained_evidence",
            {
              target_project_id: work.project_id,
              target_report_version_id: issued.report_version_id,
              target_requested_by: work.approved_by,
            },
          );

          await rpc(client, "complete_conversion_replay_campaign", {
            target_metric_snapshot_id: issued.metric_snapshot_id,
            target_replay_campaign_id: work.replay_campaign_id,
            target_report_id: issued.report_id,
            target_report_version_id: issued.report_version_id,
          });
          return {
            metricSnapshotId: issued.metric_snapshot_id,
            reportVersionId: issued.report_version_id,
          };
        });
      }

      const completed = await step.run("complete-replay", () =>
        rpc(client, "complete_conversion_replay_run", {
          target_replay_run_id: replayRunId,
        }),
      );
      return { replayRunId, status: "completed" as const, completed };
    } catch (error) {
      logError({
        event: "conversion_replay_run_failed",
        error,
        projectId: replayRunId,
      });
      throw error;
    }
  },
);
