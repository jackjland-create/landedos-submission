import { computeCampaignMetrics } from "@landed/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  getProjectReport,
  getProjectReportEvidence,
  projectReportEvidencePathSchema,
  ReportQueryError,
} from "./index";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  campaign: "30000000-0000-4000-8000-000000000001",
  report: "40000000-0000-4000-8000-000000000001",
  version: "50000000-0000-4000-8000-000000000001",
  snapshot: "60000000-0000-4000-8000-000000000001",
  rule: "70000000-0000-4000-8000-000000000001",
  actor: "80000000-0000-4000-8000-000000000001",
  attribution: "90000000-0000-4000-8000-000000000001",
  conversion: "a0000000-0000-4000-8000-000000000001",
  creator: "b0000000-0000-4000-8000-000000000001",
  asset: "c0000000-0000-4000-8000-000000000001",
  click: "d0000000-0000-4000-8000-000000000001",
  chainEvent: "e0000000-0000-4000-8000-000000000001",
  context: "f0000000-0000-4000-8000-000000000001",
  observationQualified: "f1000000-0000-4000-8000-000000000001",
  observationActivated: "f1000000-0000-4000-8000-000000000002",
  benchmark: "f2000000-0000-4000-8000-000000000001",
};

const issuedAt = "2026-08-13T12:00:00.000Z";
const metricSnapshot = computeCampaignMetrics({
  id: ids.snapshot,
  workspaceId: ids.workspace,
  projectId: ids.project,
  campaignId: ids.campaign,
  currencyCode: "GBP",
  valuationPolicy: {
    id: "approved-campaign-ledger",
    version: 1,
    description: "Approved campaign ledger in GBP",
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
    dataThrough: "2026-08-12T11:55:00.000Z",
    calculatedAt: "2026-08-12T12:05:00.000Z",
  },
  spend: { status: "not_available", reason: "source_not_configured" },
  qualifiedClicks: {
    status: "not_available",
    reason: "source_not_configured",
  },
  qualifiedWallets: {
    status: "not_available",
    reason: "source_not_configured",
  },
  activatedWallets: {
    status: "not_available",
    reason: "source_not_configured",
  },
  activationDefinition: { ruleVersionId: ids.rule, label: "Funded account" },
  protocolRevenue: {
    status: "not_available",
    reason: "source_not_configured",
  },
});

const reportRow = {
  id: ids.report,
  workspace_id: ids.workspace,
  project_id: ids.project,
  campaign_id: ids.campaign,
  created_at: issuedAt,
};

function versionRow(overrides: Record<string, unknown> = {}) {
  const payload = {
    schemaVersion: 1,
    status: "issued",
    reportId: ids.report,
    reportVersionId: ids.version,
    version: 1,
    workspaceId: ids.workspace,
    projectId: ids.project,
    campaignId: ids.campaign,
    campaignName: "Summer activation",
    metricSnapshotId: ids.snapshot,
    metricSnapshotSha256: "b".repeat(64),
    metricSnapshot,
    attributionModel: "last_eligible_creator_touch",
    attributionWindowSeconds: 604800,
    issuedBy: ids.actor,
    issuedAt,
  };

  return {
    id: ids.version,
    report_id: ids.report,
    metric_snapshot_id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    campaign_id: ids.campaign,
    version: 1,
    status: "issued",
    issued_by: ids.actor,
    issued_at: issuedAt,
    payload,
    payload_sha256: "a".repeat(64),
    ...overrides,
  };
}

function clientWith(
  version: ReturnType<typeof versionRow>,
  snapshotOverrides: Record<string, unknown> = {},
  retainedContext: {
    contexts: unknown[];
    observations: unknown[];
    benchmarks: unknown[];
  } = { contexts: [], observations: [], benchmarks: [] },
) {
  const reportQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: reportRow, error: null }),
  };
  const versionQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [version], error: null }),
  };
  const snapshotQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [
        {
          id: ids.snapshot,
          workspace_id: ids.workspace,
          project_id: ids.project,
          campaign_id: ids.campaign,
          calculation_version: 1,
          currency_code: "GBP",
          source_started_at: "2026-08-01T00:00:00.000Z",
          source_ended_at: "2026-08-12T12:00:00.000Z",
          data_through: "2026-08-12T11:55:00.000Z",
          calculated_at: "2026-08-12T12:05:00.000Z",
          snapshot: metricSnapshot,
          snapshot_sha256: "b".repeat(64),
          ...snapshotOverrides,
        },
      ],
      error: null,
    }),
  };
  const contextQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: retainedContext.contexts,
      error: null,
    }),
  };
  const observationQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: retainedContext.observations,
      error: null,
    }),
  };
  const benchmarkQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: retainedContext.benchmarks,
      error: null,
    }),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "reports") return reportQuery;
      if (table === "report_versions") return versionQuery;
      if (table === "report_measurement_contexts") return contextQuery;
      if (table === "report_daily_observations") return observationQuery;
      if (table === "report_benchmark_claims") return benchmarkQuery;
      return snapshotQuery;
    }),
  } as unknown as SupabaseClient;
}

describe("issued report reader", () => {
  it("maps an exact immutable report version and metric snapshot", async () => {
    const report = await getProjectReport(
      clientWith(versionRow()),
      ids.project,
      ids.report,
    );

    expect(report?.versions[0]).toEqual(
      expect.objectContaining({
        id: ids.version,
        version: 1,
        campaignName: "Summer activation",
        metricSnapshot,
      }),
    );
  });

  it("fails closed when payload scope disagrees with retained columns", async () => {
    const mismatched = versionRow();
    mismatched.payload = {
      ...mismatched.payload,
      campaignId: "90000000-0000-4000-8000-000000000001",
    };

    await expect(
      getProjectReport(clientWith(mismatched), ids.project, ids.report),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({
        name: "ReportQueryError",
      }),
    );
  });

  it("fails closed when the embedded snapshot hash differs from retained evidence", async () => {
    await expect(
      getProjectReport(
        clientWith(versionRow(), { snapshot_sha256: "c".repeat(64) }),
        ids.project,
        ids.report,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({
        name: "ReportQueryError",
      }),
    );
  });

  it("maps source-bound daily observations and unavailable cohort context", async () => {
    const retainedContext = {
      contexts: [
        {
          id: ids.context,
          report_id: ids.report,
          report_version_id: ids.version,
          metric_snapshot_id: ids.snapshot,
          workspace_id: ids.workspace,
          project_id: ids.project,
          campaign_id: ids.campaign,
          schema_version: 1,
          evidence_bound: true,
          issued_by: ids.actor,
          issued_at: issuedAt,
          payload_sha256: "c".repeat(64),
        },
      ],
      observations: [
        {
          id: ids.observationQualified,
          context_id: ids.context,
          workspace_id: ids.workspace,
          project_id: ids.project,
          campaign_id: ids.campaign,
          metric: "qualified_wallets",
          period_started_at: "2026-08-12T00:00:00.000Z",
          period_ended_at: "2026-08-12T12:00:00.000Z",
          observed_through: "2026-08-12T11:55:00.000Z",
          period_state: "partial",
          status: "available",
          value_decimal: "12",
          unavailable_reason: null,
          source_evidence_ids: [ids.attribution],
        },
        {
          id: ids.observationActivated,
          context_id: ids.context,
          workspace_id: ids.workspace,
          project_id: ids.project,
          campaign_id: ids.campaign,
          metric: "activated_wallets",
          period_started_at: "2026-08-12T00:00:00.000Z",
          period_ended_at: "2026-08-12T12:00:00.000Z",
          observed_through: "2026-08-12T11:55:00.000Z",
          period_state: "partial",
          status: "available",
          value_decimal: "4",
          unavailable_reason: null,
          source_evidence_ids: [ids.conversion],
        },
      ],
      benchmarks: [
        {
          id: ids.benchmark,
          context_id: ids.context,
          workspace_id: ids.workspace,
          project_id: ids.project,
          campaign_id: ids.campaign,
          kind: "portfolio_cohort",
          metric: "qualified_wallets",
          label: "Comparable launch cohort",
          source_label: "Retained cohort result not configured",
          status: "not_available",
          value_decimal: null,
          unavailable_reason: "source_not_configured",
          source_started_at: null,
          source_ended_at: null,
          approved_at: null,
          cohort_sample_size: null,
        },
      ],
    };

    const report = await getProjectReport(
      clientWith(versionRow(), {}, retainedContext),
      ids.project,
      ids.report,
    );

    expect(report?.versions[0]?.measurementContext).toEqual(
      expect.objectContaining({
        id: ids.context,
        observations: expect.arrayContaining([
          expect.objectContaining({
            metric: "qualified_wallets",
            periodState: "partial",
            valueDecimal: "12",
          }),
        ]),
        benchmarks: [
          expect.objectContaining({
            kind: "portfolio_cohort",
            cohortSampleSize: null,
            status: "not_available",
          }),
        ],
      }),
    );
    expect(report?.versions[0]?.measurementContext).not.toHaveProperty(
      "cohortMemberIds",
    );
  });

  it("fails closed when context references a different retained metric snapshot", async () => {
    await expect(
      getProjectReport(
        clientWith(
          versionRow(),
          {},
          {
            contexts: [
              {
                id: ids.context,
                report_id: ids.report,
                report_version_id: ids.version,
                metric_snapshot_id: "60000000-0000-4000-8000-000000000099",
                workspace_id: ids.workspace,
                project_id: ids.project,
                campaign_id: ids.campaign,
                schema_version: 1,
                evidence_bound: true,
                issued_by: ids.actor,
                issued_at: issuedAt,
                payload_sha256: "c".repeat(64),
              },
            ],
            observations: [],
            benchmarks: [],
          },
        ),
        ids.project,
        ids.report,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({
        name: "ReportQueryError",
      }),
    );
  });

  it("does not present legacy unbound context as verified report evidence", async () => {
    const report = await getProjectReport(
      clientWith(
        versionRow(),
        {},
        {
          contexts: [
            {
              id: ids.context,
              report_id: ids.report,
              report_version_id: ids.version,
              metric_snapshot_id: ids.snapshot,
              workspace_id: ids.workspace,
              project_id: ids.project,
              campaign_id: ids.campaign,
              schema_version: 1,
              evidence_bound: false,
              issued_by: ids.actor,
              issued_at: issuedAt,
              payload_sha256: "c".repeat(64),
            },
          ],
          observations: [],
          benchmarks: [],
        },
      ),
      ids.project,
      ids.report,
    );

    expect(report?.versions[0]?.measurementContext).toBeNull();
  });
});

describe("issued report evidence reader", () => {
  const evidenceRow = {
    report_version_id: ids.version,
    metric_snapshot_id: ids.snapshot,
    metric: "qualified_wallets",
    attribution_fact_id: ids.attribution,
    confidence: "strong",
    primary_roas_eligible: true,
    attribution_model: "last_eligible_creator_touch",
    attribution_window_seconds: 604800,
    touch_time: "2026-08-10T12:00:00.000Z",
    creator_id: ids.creator,
    creator_name: "Ava Sol",
    content_asset_id: ids.asset,
    content_asset_label: "Launch thread",
    click_event_id: ids.click,
    click_quality: "qualified",
    wallet_proof_state: "signed_nonce_and_consent",
    conversion_fact_id: ids.conversion,
    conversion_time: "2026-08-11T12:00:00.000Z",
    conversion_rule_version_id: ids.rule,
    conversion_rule_version: 2,
    conversion_rule_name: "First qualifying transaction",
    conversion_rule_template: "first_qualifying_transaction",
    conversion_evaluator_version: 1,
    value_kind: "native_lamports",
    raw_amount: "250000000",
    decimals: 9,
    token_mint: null,
    canonical_chain_event_id: ids.chainEvent,
    transaction_signature: "5".repeat(88),
    instruction_index: null,
    event_name: "solana.native_transfer",
    finality: "finalized",
    event_time: "2026-08-11T12:00:00.000Z",
    transaction_slot: "345678901",
    environment: "demo",
  } as const;

  it("maps the sanitized metric to transaction evidence path", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [evidenceRow],
      error: null,
    });

    const paths = await getProjectReportEvidence(
      { rpc } as unknown as SupabaseClient,
      ids.project,
      ids.version,
      "qualified_wallets",
    );

    expect(rpc).toHaveBeenCalledWith("get_report_metric_evidence", {
      target_project_id: ids.project,
      target_report_version_id: ids.version,
      target_metric: "qualified_wallets",
    });
    expect(paths[0]).toEqual(
      expect.objectContaining({
        attributionFactId: ids.attribution,
        creatorName: "Ava Sol",
        conversionFactId: ids.conversion,
        canonicalChainEventId: ids.chainEvent,
        transactionSignature: "5".repeat(88),
      }),
    );
    expect(paths[0]).not.toHaveProperty("walletAddress");
  });

  it("retains exact V2 Devnet timestamps without rounding evidence", async () => {
    const row = {
      ...evidenceRow,
      conversion_evaluator_version: 2,
      environment: "devnet",
      raw_amount: "1",
      touch_time: "2026-08-10T12:00:00.123456+00:00",
      conversion_time: "2026-08-11T12:00:00.654321+00:00",
      event_time: "2026-08-11T12:00:00.654321+00:00",
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const paths = await getProjectReportEvidence(
      { rpc } as unknown as SupabaseClient,
      ids.project,
      ids.version,
      "qualified_wallets",
    );
    expect(paths[0]?.conversionEvaluatorVersion).toBe(2);
    expect(paths[0]?.touchTime).toBe("2026-08-10T12:00:00.123456Z");
    expect(paths[0]?.eventTime).toBe("2026-08-11T12:00:00.654321Z");
    expect(() =>
      projectReportEvidencePathSchema.parse({
        ...paths[0],
        environment: "mainnet",
      }),
    ).toThrow();
    expect(() =>
      projectReportEvidencePathSchema.parse({
        ...paths[0],
        conversionRuleTemplate: "programme_action",
      }),
    ).toThrow();
  });

  it.each([2, 3])("rejects unsupported evaluator/scope %s", async (version) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...evidenceRow, conversion_evaluator_version: version }],
      error: null,
    });
    await expect(
      getProjectReportEvidence(
        { rpc } as unknown as SupabaseClient,
        ids.project,
        ids.version,
        "qualified_wallets",
      ),
    ).rejects.toThrow();
  });

  it("fails closed when the transaction time disagrees with the conversion", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...evidenceRow,
          event_time: "2026-08-11T12:00:01.000Z",
        },
      ],
      error: null,
    });

    await expect(
      getProjectReportEvidence(
        { rpc } as unknown as SupabaseClient,
        ids.project,
        ids.version,
        "qualified_wallets",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({
        name: "ReportQueryError",
      }),
    );
  });

  it("preserves database permission errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501" },
    });

    await expect(
      getProjectReportEvidence(
        { rpc } as unknown as SupabaseClient,
        ids.project,
        ids.version,
        "activated_wallets",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportQueryError>>({ code: "42501" }),
    );
  });
});
