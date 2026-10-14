import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, logErrorMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_approval_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { GET, POST } from "./route";

const basketId = "90000000-0000-4000-8000-000000000001";
const scenarioId = "91000000-0000-4000-8000-000000000001";
const approvalRequestId = "95000000-0000-4000-8000-000000000001";

const snapshotHash =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const reviewSnapshot = {
  schemaVersion: 1,
  basket: {
    id: basketId,
    name: "Helios roster",
    objective: "Increase qualified wallets",
    outcomeProfile: {
      baselineUnits: "50",
      metric: "qualified_wallets",
      targetUnits: "150",
    },
  },
  scenario: { id: scenarioId, code: "A", name: "Focused authority" },
  packages: [
    {
      id: "92000000-0000-4000-8000-000000000001",
      creatorId: "40000000-0000-4000-8000-000000000001",
      packageLabel: "Launch package",
      deliverableSummary: "One X thread",
      compensationLines: [
        {
          id: "93000000-0000-4000-8000-000000000001",
          assetType: "cash",
          model: "fixed",
          amountMinor: "460000",
          currencyCode: "GBP",
        },
      ],
    },
  ],
};

const approval = {
  id: "94000000-0000-4000-8000-000000000001",
  scenarioId,
  scenarioCode: "A" as const,
  scenarioName: "Focused authority",
  version: 1,
  approvedBy: "30000000-0000-4000-8000-000000000001",
  approvedAt: "2026-08-05T00:30:00.000Z",
  reason: "Approved for the pilot launch",
  snapshotHash,
};

const approvalRpcRow = {
  commercial_plan_version_id: approval.id,
  issued_scenario_id: approval.scenarioId,
  issued_scenario_code: approval.scenarioCode,
  issued_scenario_name: approval.scenarioName,
  issued_version: approval.version,
  issued_by: approval.approvedBy,
  issued_at: approval.approvedAt,
  issued_reason: approval.reason,
  issued_snapshot_hash: approval.snapshotHash,
};

function context() {
  return { params: Promise.resolve({ projectId: "helios", basketId }) };
}

function request(body: unknown) {
  return new Request("https://landed.test/approval", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function reviewRequest() {
  return new Request(`https://landed.test/approval?scenarioId=${scenarioId}`);
}

const validBody = {
  scenarioId,
  approvalRequestId,
  reason: "Approved for the pilot launch",
  confirmation: "APPROVE COMMERCIAL PLAN",
  expectedSnapshotHash: snapshotHash,
};

describe("commercial plan approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: [approvalRpcRow], error: null });
  });

  it("prepares the exact database snapshot for human review", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          review_snapshot: reviewSnapshot,
          review_snapshot_hash: snapshotHash,
        },
      ],
      error: null,
    });

    const response = await GET(reviewRequest(), context());

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("preview_basket_scenario_approval", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_basket_id: basketId,
      target_scenario_id: scenarioId,
    });
    expect(await response.json()).toEqual({
      review: { snapshot: reviewSnapshot, snapshotHash },
    });
  });

  it("returns a recoverable blocker when the database draft is incomplete", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          review_snapshot: { ...reviewSnapshot, packages: [] },
          review_snapshot_hash: snapshotHash,
        },
      ],
      error: null,
    });

    const response = await GET(reviewRequest(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "approval_blocked",
      message:
        "The commercial draft changed or is incomplete. Resolve its approval blockers and review again.",
    });
  });

  it("issues a manager-approved immutable commercial version", async () => {
    const response = await POST(request(validBody), context());

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("approve_basket_scenario", {
      target_project_id: "20000000-0000-4000-8000-000000000001",
      target_basket_id: basketId,
      target_scenario_id: scenarioId,
      target_approval_request_id: approvalRequestId,
      approval_reason: validBody.reason,
      expected_snapshot_hash: snapshotHash,
    });
    expect(await response.json()).toEqual({ approval });
  });

  it("returns the version identified by an idempotent approval response", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...approvalRpcRow, issued_version: 1 }],
      error: null,
    });
    const response = await POST(request(validBody), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      approval: expect.objectContaining({ id: approval.id, version: 1 }),
    });
  });

  it("requires the explicit human confirmation phrase", async () => {
    const response = await POST(
      request({ ...validBody, confirmation: "APPROVE" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects approval when the reviewed draft fingerprint is stale", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request(validBody), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "draft_changed",
      message:
        "Commercial plan changed. Review the latest draft before approval.",
    });
  });

  it("keeps approval campaign-manager only", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });

    const response = await POST(request(validBody), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Commercial approval requires campaign manager access.",
    });
  });

  it("logs unexpected failures without exposing database detail", async () => {
    const error = { code: "XX000", message: "private database detail" };
    rpcMock.mockResolvedValue({ data: null, error });

    const response = await POST(request(validBody), context());

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "commercial_plan_approval_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Commercial plan could not be approved.",
      reference: "corr_approval_test",
    });
  });
});
