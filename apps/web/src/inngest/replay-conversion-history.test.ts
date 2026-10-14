import { computeCampaignMetrics } from "@landed/analytics";
import { describe, expect, it } from "vitest";

import { buildReplayMetricInput } from "./replay-conversion-history";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  campaign: "30000000-0000-4000-8000-000000000001",
  priorSnapshot: "40000000-0000-4000-8000-000000000001",
  replaySnapshot: "40000000-0000-4000-8000-000000000002",
  rule: "50000000-0000-4000-8000-000000000001",
  includedSpend: "60000000-0000-4000-8000-000000000001",
  excludedSpend: "60000000-0000-4000-8000-000000000002",
  attribution: "70000000-0000-4000-8000-000000000001",
};

const priorMetricSnapshot = computeCampaignMetrics({
  id: ids.priorSnapshot,
  workspaceId: ids.workspace,
  projectId: ids.project,
  campaignId: ids.campaign,
  currencyCode: "GBP",
  valuationPolicy: {
    id: "approved-campaign-ledger",
    version: 1,
    description: "Approved campaign spend valued in GBP",
    currencyCode: "GBP",
    valuedAt: "2026-08-12T12:00:00.000Z",
  },
  conversionRuleVersionIds: [ids.rule],
  attributionClassifierVersion: 1,
  sourceTimeRange: {
    startedAt: "2026-08-01T00:00:00.000Z",
    endedAt: "2026-08-12T12:00:00.000Z",
  },
  dataFreshness: {
    dataThrough: "2026-08-12T12:00:00.000Z",
    calculatedAt: "2026-08-12T12:00:00.000Z",
  },
  spend: {
    status: "complete",
    lines: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        kind: "campaign_cost",
        amountMinor: "10000",
        inclusion: "included",
        exclusionReason: null,
        sourceEvidenceId: "commercial:included:1",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        kind: "campaign_cost",
        amountMinor: "2000",
        inclusion: "excluded",
        exclusionReason: "Outside approved campaign scope",
        sourceEvidenceId: "commercial:excluded:1",
      },
    ],
  },
  qualifiedClicks: {
    status: "complete",
    evidenceIds: ["click:2", "click:1"],
  },
  qualifiedWallets: { status: "complete", evidenceIds: ["wallet:1"] },
  activatedWallets: { status: "complete", evidenceIds: ["wallet:1"] },
  activationDefinition: {
    ruleVersionId: ids.rule,
    label: "First qualifying transaction",
  },
  protocolRevenue: {
    status: "not_available",
    reason: "source_not_configured",
  },
});

const work = {
  replay_campaign_id: "90000000-0000-4000-8000-000000000001",
  replay_run_id: "90000000-0000-4000-8000-000000000002",
  workspace_id: ids.workspace,
  project_id: ids.project,
  campaign_id: ids.campaign,
  rule_version_id: ids.rule,
  approved_by: "a0000000-0000-4000-8000-000000000001",
  status: "running" as const,
  source_started_at: "2026-08-12T12:00:00.000Z",
  source_ended_at: "2026-08-17T12:00:00.000Z",
  prior_report_id: "b0000000-0000-4000-8000-000000000001",
  prior_metric_snapshot_id: ids.priorSnapshot,
  prior_metric_snapshot: priorMetricSnapshot,
  issue_request_id: "b0000000-0000-4000-8000-000000000002",
  planned_metric_snapshot_id: ids.replaySnapshot,
  planned_report_version_id: "b0000000-0000-4000-8000-000000000003",
  included_spend_line_id: ids.includedSpend,
  excluded_spend_line_id: ids.excludedSpend,
  approved_at: "2026-08-17T12:00:00.000Z",
};

describe("RPL-01 conversion replay metric assembly", () => {
  it("creates a comparable snapshot without treating transfer value as revenue", () => {
    const input = buildReplayMetricInput({
      calculatedAt: "2026-08-17T12:00:00.000Z",
      metricSnapshotId: ids.replaySnapshot,
      matchedAttributionFactIds: [ids.attribution],
      qualifiedClickIds: [
        "71000000-0000-4000-8000-000000000002",
        "71000000-0000-4000-8000-000000000001",
      ],
      priorMetricSnapshotId: ids.priorSnapshot,
      rawPriorMetricSnapshot: priorMetricSnapshot,
      work,
    });

    expect(input.spend).toEqual({
      status: "complete",
      lines: [
        expect.objectContaining({
          id: ids.includedSpend,
          amountMinor: "10000",
          inclusion: "included",
        }),
        expect.objectContaining({
          id: ids.excludedSpend,
          amountMinor: "2000",
          inclusion: "excluded",
        }),
      ],
    });
    expect(input.qualifiedClicks).toEqual({
      status: "complete",
      evidenceIds: [
        "71000000-0000-4000-8000-000000000001",
        "71000000-0000-4000-8000-000000000002",
      ],
    });
    expect(input.qualifiedWallets).toEqual({
      status: "complete",
      evidenceIds: [ids.attribution],
    });
    expect(input.activatedWallets).toEqual(input.qualifiedWallets);
    expect(input.protocolRevenue).toEqual({
      status: "not_available",
      reason: "source_not_configured",
    });
    expect(computeCampaignMetrics(input).metrics.revenueRoas).toMatchObject({
      status: "not_available",
      reason: "revenue_not_available",
    });
  });

  it("is byte-stable for retries and never manufactures zero candidates", () => {
    const first = buildReplayMetricInput({
      calculatedAt: work.approved_at,
      metricSnapshotId: ids.replaySnapshot,
      matchedAttributionFactIds: [],
      qualifiedClickIds: [],
      priorMetricSnapshotId: ids.priorSnapshot,
      rawPriorMetricSnapshot: priorMetricSnapshot,
      work,
    });
    const second = buildReplayMetricInput({
      calculatedAt: work.approved_at,
      metricSnapshotId: ids.replaySnapshot,
      matchedAttributionFactIds: [],
      qualifiedClickIds: [],
      priorMetricSnapshotId: ids.priorSnapshot,
      rawPriorMetricSnapshot: priorMetricSnapshot,
      work,
    });

    expect(second).toEqual(first);
    expect(computeCampaignMetrics(first).metrics.cpa).toMatchObject({
      status: "not_available",
      reason: "no_activated_wallets",
      denominator: { status: "available", value: 0 },
    });
  });

  it("keeps incomplete excluded spend unknown instead of converting it to zero", () => {
    const incompletePrior = {
      ...priorMetricSnapshot,
      metrics: {
        ...priorMetricSnapshot.metrics,
        cpc: {
          ...priorMetricSnapshot.metrics.cpc,
          excludedSpend: {
            status: "not_available" as const,
            reason: "source_incomplete" as const,
          },
        },
      },
    };

    const input = buildReplayMetricInput({
      calculatedAt: work.approved_at,
      metricSnapshotId: ids.replaySnapshot,
      matchedAttributionFactIds: [ids.attribution],
      qualifiedClickIds: [],
      priorMetricSnapshotId: ids.priorSnapshot,
      rawPriorMetricSnapshot: incompletePrior,
      work,
    });

    expect(input.spend).toEqual({
      status: "not_available",
      reason: "source_incomplete",
    });
    expect(computeCampaignMetrics(input).metrics.cpa).toMatchObject({
      status: "not_available",
      reason: "spend_not_available",
      excludedSpend: {
        status: "not_available",
        reason: "source_incomplete",
      },
    });
  });
});
