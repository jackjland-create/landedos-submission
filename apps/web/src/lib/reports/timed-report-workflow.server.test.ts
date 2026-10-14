import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import fixture from "./fixtures/retained-report-reconciled.json";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  bundle: vi.fn(),
  draft: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("./timed-report-runtime.server", async (original) => ({
  ...(await original<object>()),
  withTimedReportTransaction: mocks.transaction,
  readRuntimeBundle: mocks.bundle,
  readRuntimeDraft: mocks.draft,
}));
import {
  runTimedReportWorkflow,
  timedWorkflowRequestSchema,
} from "./timed-report-workflow.server";
const sources = fixture.evidence.executionReview.reportReview.reportSources;
const scope = {
  workspaceId: sources.workspaceId,
  projectId: sources.projectId,
  campaignId: sources.campaignId,
};
const actor = fixture.evidence.conversion_rule_versions[0]!.created_by;
const input = {
  action: "prepare",
  ...scope,
  executionId: fixture.evidence.executionReview.execution.approvalId,
  sourceHash: fixture.sourceHash,
  currencyCode: "GBP",
  additionalCosts: "none_declared",
  decisions: sources.commercialPlanSnapshot.packages.flatMap((p) =>
    p.compensationLines.map((l) => ({
      compensationLineId: l.id,
      inclusion: "included",
      reason: "Reviewed contracted campaign commitment",
    })),
  ),
};
const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
const client = {
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
} as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bundle.mockResolvedValue(structuredClone(fixture));
  mocks.transaction.mockImplementation((_client, operation) =>
    operation({ query: mocks.query }, actor),
  );
  mocks.query.mockResolvedValue({ rows: [{ value: null }] });
});
afterEach(() => vi.unstubAllEnvs());
describe("trusted timed report workflow", () => {
  function devnetEnvironment() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REPORTS", "1");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REHEARSAL", "1");
    vi.stubEnv("LANDED_EXTERNAL_DEVNET_SESSION", "1");
    vi.stubEnv("EXTERNAL_DEVNET_PUBLIC_GATE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
  }
  it("rejects missing or cross-execution devnet provenance before calculation", async () => {
    devnetEnvironment();
    await expect(runTimedReportWorkflow(client, input)).rejects.toThrow(
      "provenance",
    );
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.bundle.mockResolvedValue({
      ...structuredClone(fixture),
      localDevnetBoundary: {
        protocol: "landed:local-devnet-report-boundary:1",
        ...scope,
        executionId: scope.campaignId,
      },
    });
    await expect(runTimedReportWorkflow(client, input)).rejects.toThrow(
      "provenance",
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("projects checked devnet boundary without asserting live ingestion or browser approvals", async () => {
    devnetEnvironment();
    // Mocked provenance for projection testing only, not genuine devnet proof.
    mocks.bundle.mockResolvedValue({
      ...structuredClone(fixture),
      localDevnetBoundary: {
        protocol: "landed:local-devnet-report-boundary:1",
        ...scope,
        executionId: input.executionId,
      },
    });
    const result = await runTimedReportWorkflow(client, {
      action: "sources",
      ...scope,
      executionId: input.executionId,
    });
    expect(result.kind).toBe("sources");
    if (result.kind !== "sources") throw new Error("Sources expected");
    expect(result.handoff.upstreamProof).toBe("retained_devnet_execution");
    expect(result.handoff.liveIngestion).toBeNull();
    expect(result.handoff.browserCommercialApproval).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(["actor", "calculation", "metrics", "ttl", "reportVersionId"])(
    "rejects caller %s before transaction",
    async (key) => {
      await expect(
        runTimedReportWorkflow(client, { ...input, [key]: "injected" }),
      ).rejects.toThrow();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("rejects missing human confirmation", () => {
    expect(
      timedWorkflowRequestSchema.safeParse({
        action: "confirm",
        ...scope,
        draftId: scope.campaignId,
        reason: "Human reviewed",
        confirmed: false,
      }).success,
    ).toBe(false);
  });
  it("rejects source drift before retaining a calculation", async () => {
    await expect(
      runTimedReportWorkflow(client, { ...input, sourceHash: "0".repeat(64) }),
    ).rejects.toThrow("sources changed");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("retains actual trusted calculation once and projects safe reviewed values", async () => {
    mocks.draft.mockImplementation(async (_sql, requestedScope, draftId) => {
      expect(requestedScope).toEqual(scope);
      const calculation = JSON.parse(mocks.query.mock.calls[0]![1][1]);
      expect(calculation.identity.requestedBy).toBe(actor);
      expect(calculation.sourceHash).toBe(fixture.sourceHash);
      return {
        draftId,
        ...scope,
        calculation,
        expiresAt: "2026-09-21T22:00:00Z",
        expired: false,
        receipt: null,
      };
    });
    const result = await runTimedReportWorkflow(client, input);
    expect(result.kind).toBe("draft");
    if (result.kind !== "draft") throw Error("Expected draft");
    expect(result.costs.total.status).toBe("available");
    expect(typeof result.qualifiedWallets).toBe("number");
    expect(result).not.toHaveProperty("calculation");
    expect(result).not.toHaveProperty("sourceHash");
    expect(JSON.stringify(result)).not.toContain("protected_wallet");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("confirmation passes only retained draft identity and explicit reason", async () => {
    const receipt = {
      reportVersionId: scope.campaignId,
      reportId: scope.projectId,
      version: 1,
      inserted: true,
      issuedAt: "2026-09-21T22:00:00Z",
    };
    mocks.query.mockResolvedValue({ rows: [{ value: receipt }] });
    expect(
      await runTimedReportWorkflow(client, {
        action: "confirm",
        ...scope,
        draftId: scope.campaignId,
        reason: "Exact human review",
        confirmed: true,
      }),
    ).toEqual({ kind: "receipt", receipt });
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("confirm_timed_report_draft"),
      [
        scope.workspaceId,
        scope.projectId,
        scope.campaignId,
        scope.campaignId,
        "Exact human review",
      ],
    );
  });
  it("read-only recovery never calculates or approves", async () => {
    expect(
      await runTimedReportWorkflow(client, {
        action: "recover",
        ...scope,
        draftId: scope.campaignId,
      }),
    ).toEqual({ kind: "receipt", receipt: null });
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]![0]).toContain(
      "recover_timed_report_draft",
    );
  });
});
