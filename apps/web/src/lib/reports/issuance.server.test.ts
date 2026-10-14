import { describe, expect, it, vi } from "vitest";

import type { MetricSnapshotInput } from "@landed/analytics";

import {
  issueVersionedCampaignReport,
  ReportIssuanceError,
} from "./issuance.server";

const identity = {
  campaignId: "30000000-0000-4000-8000-000000000001",
  issueRequestId: "90000000-0000-4000-8000-000000000001",
  metricSnapshotId: "40000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  reportId: "a0000000-0000-4000-8000-000000000001",
  reportVersionId: "b0000000-0000-4000-8000-000000000001",
  requestedBy: "c0000000-0000-4000-8000-000000000001",
};

const metricInput: MetricSnapshotInput = {
  id: identity.metricSnapshotId,
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: identity.projectId,
  campaignId: identity.campaignId,
  currencyCode: "GBP",
  valuationPolicy: {
    id: "approved-campaign-ledger",
    version: 1,
    description: "Approved creator compensation and campaign costs",
    currencyCode: "GBP",
    valuedAt: "2026-08-13T11:50:00.000Z",
  },
  conversionRuleVersionIds: ["50000000-0000-4000-8000-000000000001"],
  attributionClassifierVersion: 1,
  sourceTimeRange: {
    startedAt: "2026-08-01T00:00:00.000Z",
    endedAt: "2026-08-13T12:00:00.000Z",
  },
  dataFreshness: {
    dataThrough: "2026-08-13T11:55:00.000Z",
    calculatedAt: "2026-08-13T12:00:00.000Z",
  },
  spend: { status: "complete", lines: [] },
  qualifiedClicks: { status: "complete", evidenceIds: ["click:1"] },
  qualifiedWallets: { status: "complete", evidenceIds: ["wallet:1"] },
  activatedWallets: { status: "complete", evidenceIds: ["wallet:1"] },
  activationDefinition: {
    ruleVersionId: "50000000-0000-4000-8000-000000000001",
    label: "First qualifying transaction",
  },
  protocolRevenue: { status: "complete", lines: [] },
};

const retainedResult = {
  inserted: true,
  issued_at: "2026-08-13T12:01:00.000+00:00",
  metric_snapshot_id: identity.metricSnapshotId,
  metric_snapshot_sha256: "a".repeat(64),
  report_id: identity.reportId,
  report_payload_sha256: "b".repeat(64),
  report_version_id: identity.reportVersionId,
  version: 1,
};

const retainedContextResult = {
  context_id: "6b000000-0000-4000-8000-000000000001",
  inserted: true,
  issued_at: "2026-08-13T12:01:01.000Z",
  payload_sha256: "c".repeat(64),
};

describe("versioned report issuance", () => {
  const auth = {
    getUser: vi.fn(async () => ({
      data: { user: { id: identity.requestedBy } },
      error: null,
    })),
  };

  it("computes one trusted metric snapshot before issuing it", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [retainedResult], error: null })
      .mockResolvedValueOnce({ data: [retainedContextResult], error: null });

    await expect(
      issueVersionedCampaignReport({ rpc }, auth, identity, metricInput),
    ).resolves.toEqual({
      inserted: true,
      issuedAt: "2026-08-13T12:01:00.000Z",
      metricSnapshotId: identity.metricSnapshotId,
      metricSnapshotSha256: "a".repeat(64),
      reportId: identity.reportId,
      reportPayloadSha256: "b".repeat(64),
      reportVersionId: identity.reportVersionId,
      version: 1,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      "issue_campaign_report",
      expect.objectContaining({
        target_issue_request_id: identity.issueRequestId,
        target_metric_snapshot: expect.objectContaining({
          calculationVersion: 1,
          metrics: expect.objectContaining({
            revenueRoas: expect.objectContaining({
              includedAttributionConfidence: ["verified", "strong"],
              reason: "no_eligible_spend",
              status: "not_available",
            }),
          }),
        }),
      }),
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "issue_report_measurement_context_from_retained_evidence",
      {
        target_project_id: identity.projectId,
        target_report_version_id: identity.reportVersionId,
        target_requested_by: identity.requestedBy,
      },
    );
  });

  it("rejects cross-scope metric evidence before calling the database", async () => {
    const rpc = vi.fn();

    await expect(
      issueVersionedCampaignReport({ rpc }, auth, identity, {
        ...metricInput,
        campaignId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ReportIssuanceError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed for database errors and mismatched retained evidence", async () => {
    await expect(
      issueVersionedCampaignReport(
        { rpc: vi.fn(async () => ({ data: null, error: { code: "42501" } })) },
        auth,
        identity,
        metricInput,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      issueVersionedCampaignReport(
        {
          rpc: vi.fn(async () => ({
            data: [
              { ...retainedResult, report_version_id: crypto.randomUUID() },
            ],
            error: null,
          })),
        },
        auth,
        identity,
        metricInput,
      ),
    ).rejects.toBeInstanceOf(ReportIssuanceError);
  });

  it("rejects a spoofed issuer before the service-role RPC", async () => {
    const rpc = vi.fn();
    const spoofedAuth = {
      getUser: vi.fn(async () => ({
        data: { user: { id: crypto.randomUUID() } },
        error: null,
      })),
    };

    await expect(
      issueVersionedCampaignReport({ rpc }, spoofedAuth, identity, metricInput),
    ).rejects.toThrow("Report issuance requires a verified matching user.");
    expect(rpc).not.toHaveBeenCalled();
  });
});
