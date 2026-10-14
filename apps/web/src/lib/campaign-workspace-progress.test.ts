import { describe, expect, it } from "vitest";
import type { CampaignRecord } from "@landed/contracts";
import {
  workspaceFixture,
  workspaceContextFixture,
} from "./campaign-workspace.fixture";
import { campaignWorkspaceProgress } from "./campaign-workspace-progress";

const at = "2026-10-08T12:00:00Z";
const step = (
  id: string,
  campaign = workspaceFixture,
  context = workspaceContextFixture,
  time = at,
) =>
  campaignWorkspaceProgress(campaign, context, time).find(
    (value) => value.id === id,
  )!;
function linked() {
  const campaign = structuredClone(workspaceFixture);
  campaign.contentAssets[0].trackedLinks = [
    {
      id: "d1000000-0000-4000-8000-000000000001",
      generationRequestId: "d2000000-0000-4000-8000-000000000001",
      destinationUrl: "https://example.test/start",
      destinationPolicyActive: true,
      keyVersion: 1,
      expiresAt: "2026-10-09T12:00:00Z",
      issuedAt: "2026-10-07T12:00:00Z",
      issuedBy: campaign.createdBy,
      revocation: null,
      anonymousSessions: {
        sessions: 0,
        boundClicks: 0,
        firstCreatedAt: null,
        lastSeenAt: null,
      },
      clickEvidence: {
        totalAttempts: 0,
        eligibleRedirects: 0,
        ineligibleAttempts: 0,
        firstObservedAt: null,
        lastObservedAt: null,
      },
      clickQuality: {
        ruleVersion: 1,
        duplicateWindowSeconds: 1800,
        qualifiedClicks: 0,
        duplicateClicks: 0,
        rejectedClicks: 0,
        totalAssessed: 0,
        pendingAssessment: 0,
        firstAssessedAt: null,
        lastAssessedAt: null,
      },
    },
  ];
  return campaign;
}

describe("campaign workspace progress facts", () => {
  it("keeps retained commercial approval separate from brief and launch", () => {
    expect(step("plan").state).toBe("complete");
    expect(step("brief").state).toBe("pending");
    expect(step("activation").detail).toBe("Not live");
    expect(step("results").state).toBe("pending");
  });
  it("does not infer a report or published delivery from final campaign state", () => {
    const campaign = structuredClone(workspaceFixture);
    campaign.status = "finalized";
    campaign.contentAssets[0].status = "approved";
    expect(step("activation", campaign).state).toBe("complete");
    expect(step("delivery", campaign).detail).toBe("0 / 1 assets published");
    expect(step("results", campaign).state).toBe("pending");
  });
  it("shows unavailable plan/report reads rather than success or an empty result", () => {
    const context = {
      ...workspaceContextFixture,
      planAvailable: false,
      reportUnavailable: true,
    };
    expect(step("plan", workspaceFixture, context).state).toBe("unavailable");
    expect(step("results", workspaceFixture, context).state).toBe(
      "unavailable",
    );
  });
  it("retains exact issued version, but an error takes priority over stale report data", () => {
    const context = {
      ...workspaceContextFixture,
      report: { id: "d2000000-0000-4000-8000-000000000001", version: 6 },
    };
    expect(step("results", workspaceFixture, context).detail).toBe(
      "Report v6 issued",
    );
    expect(
      step("results", workspaceFixture, { ...context, reportUnavailable: true })
        .state,
    ).toBe("unavailable");
  });
  it("never calls an empty content list complete", () => {
    const campaign = { ...workspaceFixture, contentAssets: [] };
    expect(step("links", campaign).state).toBe("unavailable");
    expect(step("delivery", campaign).state).toBe("unavailable");
  });
  it("counts assets with current links, not link generations or campaign launch", () => {
    const campaign = linked();
    campaign.contentAssets[0].trackedLinks.push(
      campaign.contentAssets[0].trackedLinks[0]!,
    );
    expect(step("links", campaign).detail).toBe(
      "1 / 1 assets with a current link · activation is separate",
    );
    expect(step("activation", campaign).state).toBe("pending");
  });
  it.each(["expired", "revoked", "destination-disabled", "not-issued-yet"])(
    "does not count a %s link as current",
    (kind) => {
      const campaign = linked();
      const link = campaign.contentAssets[0].trackedLinks[0]!;
      if (kind === "expired") link.expiresAt = at;
      if (kind === "not-issued-yet") link.issuedAt = "2026-10-09T12:00:00Z";
      if (kind === "destination-disabled") link.destinationPolicyActive = false;
      if (kind === "revoked")
        link.revocation = {
          requestId: link.generationRequestId,
          actorUserId: link.issuedBy,
          reason: "Synthetic revoked link",
          revokedAt: at,
        };
      expect(step("links", campaign).state).toBe("pending");
    },
  );
  it("requires an explicit valid snapshot time for link freshness", () => {
    expect(
      step("links", linked(), workspaceContextFixture, "invalid").state,
    ).toBe("unavailable");
  });
  it("does not modify retained inputs or expose tracking destinations", () => {
    const campaign: CampaignRecord = linked();
    const before = JSON.stringify(campaign);
    const facts = campaignWorkspaceProgress(
      campaign,
      workspaceContextFixture,
      at,
    );
    expect(JSON.stringify(campaign)).toBe(before);
    expect(JSON.stringify(facts)).not.toContain("example.test");
    expect(facts.map(({ id }) => id)).toEqual([
      "plan",
      "brief",
      "links",
      "activation",
      "delivery",
      "results",
    ]);
  });
});
