import { describe, expect, it, vi } from "vitest";

import {
  issueReportMeasurementContext,
  type ReportMeasurementContextPayload,
} from "./measurement-context.server";

const actor = "10000000-0000-4000-8000-000000000001";
const identity = {
  contextId: "20000000-0000-4000-8000-000000000001",
  issueRequestId: "30000000-0000-4000-8000-000000000001",
  projectId: "40000000-0000-4000-8000-000000000001",
  reportVersionId: "50000000-0000-4000-8000-000000000001",
  requestedBy: actor,
};

const payload: ReportMeasurementContextPayload = {
  schemaVersion: 1,
  contextId: identity.contextId,
  reportId: "60000000-0000-4000-8000-000000000001",
  reportVersionId: identity.reportVersionId,
  metricSnapshotId: "70000000-0000-4000-8000-000000000001",
  workspaceId: "80000000-0000-4000-8000-000000000001",
  projectId: identity.projectId,
  campaignId: "90000000-0000-4000-8000-000000000001",
  observations: [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      metric: "qualified_wallets",
      periodStartedAt: "2026-08-17T00:00:00.000Z",
      periodEndedAt: "2026-08-18T00:00:00.000Z",
      observedThrough: "2026-08-18T00:00:00.000Z",
      periodState: "complete",
      status: "available",
      valueDecimal: "4",
      unavailableReason: null,
      sourceEvidenceIds: [
        "aa000000-0000-4000-8000-000000000001",
        "aa000000-0000-4000-8000-000000000002",
        "aa000000-0000-4000-8000-000000000003",
        "aa000000-0000-4000-8000-000000000004",
      ],
    },
    {
      id: "a0000000-0000-4000-8000-000000000002",
      metric: "activated_wallets",
      periodStartedAt: "2026-08-17T00:00:00.000Z",
      periodEndedAt: "2026-08-18T00:00:00.000Z",
      observedThrough: "2026-08-18T00:00:00.000Z",
      periodState: "complete",
      status: "available",
      valueDecimal: "2",
      unavailableReason: null,
      sourceEvidenceIds: [
        "aa000000-0000-4000-8000-000000000001",
        "aa000000-0000-4000-8000-000000000002",
      ],
    },
  ],
  benchmarks: [
    {
      id: "b0000000-0000-4000-8000-000000000001",
      kind: "approved_target",
      metric: "qualified_wallets",
      label: "Approved campaign target",
      sourceLabel: "Human approval",
      status: "available",
      valueDecimal: "8",
      unavailableReason: null,
      sourceStartedAt: null,
      sourceEndedAt: null,
      approvedBy: actor,
      approvedAt: "2026-08-18T00:00:00.000Z",
      cohortSampleSize: null,
    },
  ],
};

const auth = {
  getUser: vi.fn(async () => ({
    data: { user: { id: actor } },
    error: null,
  })),
};

describe("report measurement context issuance", () => {
  it("binds the verified actor and exact payload to the service writer", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          context_id: identity.contextId,
          inserted: true,
          issued_at: "2026-08-18T12:00:00.000+00:00",
          payload_sha256: "c".repeat(64),
        },
      ],
      error: null,
    }));

    await expect(
      issueReportMeasurementContext({ rpc }, auth, identity, payload),
    ).resolves.toEqual({
      contextId: identity.contextId,
      inserted: true,
      issuedAt: "2026-08-18T12:00:00.000Z",
      payloadSha256: "c".repeat(64),
    });
    expect(rpc).toHaveBeenCalledWith(
      "issue_report_measurement_context",
      expect.objectContaining({
        target_context_id: identity.contextId,
        target_payload: payload,
        target_requested_by: actor,
      }),
    );
  });

  it("rejects a spoofed issuer before the RPC", async () => {
    const rpc = vi.fn();
    await expect(
      issueReportMeasurementContext(
        { rpc },
        {
          getUser: vi.fn(async () => ({
            data: { user: { id: crypto.randomUUID() } },
            error: null,
          })),
        },
        identity,
        payload,
      ),
    ).rejects.toThrow("verified matching user");

    expect(rpc).not.toHaveBeenCalled();
  });
});
