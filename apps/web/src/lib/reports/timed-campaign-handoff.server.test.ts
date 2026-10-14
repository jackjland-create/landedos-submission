import { describe, expect, it } from "vitest";
import fixture from "./fixtures/retained-report-reconciled.json";
import { projectTimedCampaignHandoff } from "./timed-campaign-handoff.server";
const s = fixture.evidence.executionReview.reportReview.reportSources;
const scope = {
  workspaceId: s.workspaceId,
  projectId: s.projectId,
  campaignId: s.campaignId,
};
const executionId = fixture.evidence.executionReview.execution.approvalId;
describe("retained campaign handoff", () => {
  it("labels retained devnet execution without inventing browser or live-source proof", () => {
    const result = projectTimedCampaignHandoff(
      fixture,
      scope,
      executionId,
      false,
      true,
    );
    expect(result.upstreamProof).toBe("retained_devnet_execution");
    expect(result.browserCommercialApproval).toBeNull();
    expect(result.browserExecution).toBeNull();
    expect(result.liveIngestion).toBeNull();
    expect(result.execution.approvalId).toBe(executionId);
  });
  it("preserves exact plan, dates, terms and receipt without protected evidence", () => {
    const result = projectTimedCampaignHandoff(fixture, scope, executionId);
    expect(result.commercialPlanVersionId).toBe(s.commercialPlanVersionId);
    expect(result.commercialPlanSnapshotHash).toBe(
      s.commercialPlanSnapshotHash,
    );
    expect(result.flight).toEqual(
      s.commercialPlanSnapshot.strategyBinding.timing.flight,
    );
    expect(result.measurementWindow).toEqual(s.measurementWindow);
    expect(result.packages.map((p) => p.compensationLines)).toEqual(
      s.commercialPlanSnapshot.packages.map((p) => p.compensationLines),
    );
    expect(result.execution.approvalId).toBe(executionId);
    expect(result.execution.processedCount).toBe(2);
    expect(result.browserCommercialApproval).toBe(false);
    expect(result.browserExecution).toBe(false);
    expect(result.liveIngestion).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /protectedWallet|canonicalChainEvent|raw_payload/,
    );
  });
  it.each(["workspaceId", "projectId", "campaignId"] as const)(
    "rejects changed %s",
    (key) => {
      expect(() =>
        projectTimedCampaignHandoff(
          fixture,
          { ...scope, [key]: executionId },
          executionId,
        ),
      ).toThrow();
    },
  );
  it("rejects another execution identity", () => {
    expect(() =>
      projectTimedCampaignHandoff(fixture, scope, scope.campaignId),
    ).toThrow();
  });
  it("rejects a receipt whose campaign does not match the retained plan", () => {
    const changed = structuredClone(fixture);
    changed.evidence.executionReview.execution.receipt.batch.campaignId =
      executionId;
    expect(() =>
      projectTimedCampaignHandoff(changed, scope, executionId),
    ).toThrow();
  });
});
