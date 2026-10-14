import { describe, expect, it } from "vitest";

import {
  attributionTouchCandidateSchema,
  evaluateLastTouchAttribution,
  isAttributedTouch,
  lastTouchAttributionInputSchema,
  type AttributionTouchCandidate,
  type LastTouchAttributionInput,
} from "./last-touch";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const ruleId = "30000000-0000-4000-8000-000000000001";
const ruleVersionId = "40000000-0000-4000-8000-000000000001";
const conversionFactId = "50000000-0000-4000-8000-000000000001";
const walletAddress = "11111111111111111111111111111111";
const otherWallet = "Vote111111111111111111111111111111111111111";

function ruleVersion() {
  return {
    id: ruleVersionId,
    ruleId,
    workspaceId,
    projectId,
    version: 1,
    templateCode: "first_qualifying_transaction" as const,
    name: "First qualifying transaction",
    description: "A finalized outgoing transfer from the controlled wallet.",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: null,
    chain: "solana" as const,
    requiresWalletBinding: true as const,
    minimumFinality: "finalized" as const,
    valueMapping: "transfer_amount" as const,
    revenueMapping: "none" as const,
    attributionWindowSeconds: 604_800 as const,
    attributionModel: "last_eligible_creator_touch" as const,
    programId: null,
    eventDiscriminator: null,
    evidenceCapability: "ready" as const,
    changeReason: "Create attribution fixture rule",
    createdBy: "60000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function conversion() {
  return {
    id: conversionFactId,
    workspaceId,
    projectId,
    walletAddress,
    evaluatorVersion: 1 as const,
    ruleVersionId,
    protectedWalletMappingId: "70000000-0000-4000-8000-000000000001",
    evidenceId: "80000000-0000-4000-8000-000000000001",
    evidenceTime: "2026-08-12T12:00:00.000Z",
    outcome: "match" as const,
    reason: "matched" as const,
    conversionTime: "2026-08-12T12:00:00.000Z",
    value: {
      kind: "native_lamports" as const,
      rawAmount: "9007199254740993123",
      decimals: 9 as const,
    },
    revenue: { kind: "none" as const },
  };
}

function touch(
  overrides: Partial<AttributionTouchCandidate> = {},
): AttributionTouchCandidate {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    workspaceId,
    projectId,
    campaignId: "a0000000-0000-4000-8000-000000000001",
    creatorId: "b0000000-0000-4000-8000-000000000001",
    contentAssetId: "c0000000-0000-4000-8000-000000000001",
    trackedLinkId: "d0000000-0000-4000-8000-000000000001",
    clickEventId: "e0000000-0000-4000-8000-000000000001",
    clickQualityAssessmentId: "f0000000-0000-4000-8000-000000000001",
    anonymousSessionId: "11000000-0000-4000-8000-000000000001",
    walletProofId: "12000000-0000-4000-8000-000000000001",
    measurementConsentId: "13000000-0000-4000-8000-000000000001",
    protectedWalletMappingId: "14000000-0000-4000-8000-000000000001",
    walletAddress,
    touchTime: "2026-08-12T10:00:00.000Z",
    sessionExpiresAt: "2026-08-19T10:00:00.000Z",
    mappingActiveFrom: "2026-08-12T10:05:00.000Z",
    mappingMonitoringEndsAt: "2026-08-19T10:00:00.000Z",
    mappingUnlinkedAt: null,
    linkEligibility: "eligible",
    clickQualityOutcome: "qualified",
    clickQualityReason: "passed_declared_checks",
    sessionClickKind: "originating",
    ...overrides,
  };
}

function input(
  overrides: Partial<LastTouchAttributionInput> = {},
): LastTouchAttributionInput {
  return {
    ruleVersion: ruleVersion(),
    conversion: conversion(),
    touches: [touch()],
    ...overrides,
  };
}

describe("evaluateLastTouchAttribution", () => {
  it("selects the most recent eligible creator touch independent of input order", () => {
    const older = touch({
      id: "90000000-0000-4000-8000-000000000010",
      clickEventId: "e0000000-0000-4000-8000-000000000010",
      creatorId: "b0000000-0000-4000-8000-000000000010",
      touchTime: "2026-08-10T10:00:00.000Z",
      sessionExpiresAt: "2026-08-17T10:00:00.000Z",
      mappingActiveFrom: "2026-08-10T10:05:00.000Z",
      mappingMonitoringEndsAt: "2026-08-17T10:00:00.000Z",
    });
    const latest = touch({
      id: "90000000-0000-4000-8000-000000000020",
      clickEventId: "e0000000-0000-4000-8000-000000000020",
      creatorId: "b0000000-0000-4000-8000-000000000020",
      touchTime: "2026-08-12T11:00:00.000Z",
      sessionExpiresAt: "2026-08-19T11:00:00.000Z",
      mappingActiveFrom: "2026-08-12T11:05:00.000Z",
      mappingMonitoringEndsAt: "2026-08-19T11:00:00.000Z",
    });

    const result = evaluateLastTouchAttribution(
      input({ touches: [latest, older] }),
    );
    const reversed = evaluateLastTouchAttribution(
      input({ touches: [older, latest] }),
    );

    expect(result).toEqual(reversed);
    expect(result).toMatchObject({
      outcome: "attributed",
      reason: "most_recent_eligible_touch",
      creatorId: latest.creatorId,
      touchId: latest.id,
      candidateTouchCount: 2,
      eligibleTouchCount: 2,
    });
    expect(isAttributedTouch(result)).toBe(true);
  });

  it("retains the exact selected evidence and conversion value without inventing revenue", () => {
    expect(evaluateLastTouchAttribution(input())).toEqual({
      attributionEvaluatorVersion: 1,
      attributionModel: "last_eligible_creator_touch",
      attributionWindowSeconds: 604_800,
      attributionWindowStartedAt: "2026-08-05T12:00:00.000Z",
      attributionWindowEndedAt: "2026-08-12T12:00:00.000Z",
      conversionFactId,
      workspaceId,
      projectId,
      conversionRuleVersionId: ruleVersionId,
      conversionEvaluatorVersion: 1,
      conversionTime: "2026-08-12T12:00:00.000Z",
      candidateTouchCount: 1,
      eligibleTouchCount: 1,
      outcome: "attributed",
      reason: "most_recent_eligible_touch",
      touchId: "90000000-0000-4000-8000-000000000001",
      touchTime: "2026-08-12T10:00:00.000Z",
      campaignId: "a0000000-0000-4000-8000-000000000001",
      creatorId: "b0000000-0000-4000-8000-000000000001",
      contentAssetId: "c0000000-0000-4000-8000-000000000001",
      trackedLinkId: "d0000000-0000-4000-8000-000000000001",
      clickEventId: "e0000000-0000-4000-8000-000000000001",
      clickQualityAssessmentId: "f0000000-0000-4000-8000-000000000001",
      anonymousSessionId: "11000000-0000-4000-8000-000000000001",
      walletProofId: "12000000-0000-4000-8000-000000000001",
      measurementConsentId: "13000000-0000-4000-8000-000000000001",
      protectedWalletMappingId: "14000000-0000-4000-8000-000000000001",
      value: {
        kind: "native_lamports",
        rawAmount: "9007199254740993123",
        decimals: 9,
      },
      revenue: { kind: "none" },
    });
  });

  it("returns an explicit outcome when no candidate touch exists", () => {
    expect(evaluateLastTouchAttribution(input({ touches: [] }))).toMatchObject({
      outcome: "unattributed",
      reason: "no_candidate_touches",
      candidateTouchCount: 0,
      eligibleTouchCount: 0,
    });
  });

  it("excludes touches at or after conversion and at the expired seven-day boundary", () => {
    const exactWindowStart = touch({
      id: "90000000-0000-4000-8000-000000000010",
      clickEventId: "e0000000-0000-4000-8000-000000000010",
      touchTime: "2026-08-05T12:00:00.000Z",
      sessionExpiresAt: "2026-08-12T12:00:00.000Z",
      mappingActiveFrom: "2026-08-05T12:05:00.000Z",
      mappingMonitoringEndsAt: "2026-08-12T12:00:00.000Z",
    });
    const sameTime = touch({
      id: "90000000-0000-4000-8000-000000000020",
      clickEventId: "e0000000-0000-4000-8000-000000000020",
      touchTime: "2026-08-12T12:00:00.000Z",
      sessionExpiresAt: "2026-08-19T12:00:00.000Z",
      mappingActiveFrom: "2026-08-12T12:00:00.000Z",
      mappingMonitoringEndsAt: "2026-08-19T12:00:00.000Z",
    });
    const after = touch({
      id: "90000000-0000-4000-8000-000000000030",
      clickEventId: "e0000000-0000-4000-8000-000000000030",
      touchTime: "2026-08-12T12:00:00.001Z",
      sessionExpiresAt: "2026-08-19T12:00:00.001Z",
      mappingActiveFrom: "2026-08-12T12:00:00.001Z",
      mappingMonitoringEndsAt: "2026-08-19T12:00:00.001Z",
    });

    expect(
      evaluateLastTouchAttribution(
        input({ touches: [exactWindowStart, sameTime, after] }),
      ),
    ).toMatchObject({
      outcome: "unattributed",
      reason: "no_eligible_touches",
      candidateTouchCount: 3,
    });
  });

  it("accepts a touch just inside the live seven-day session window", () => {
    const justInside = touch({
      touchTime: "2026-08-05T12:00:00.001Z",
      sessionExpiresAt: "2026-08-12T12:00:00.001Z",
      mappingActiveFrom: "2026-08-05T12:05:00.001Z",
      mappingMonitoringEndsAt: "2026-08-12T12:00:00.001Z",
    });
    expect(
      evaluateLastTouchAttribution(input({ touches: [justInside] })),
    ).toMatchObject({ outcome: "attributed", touchId: justInside.id });
  });

  it.each([
    "invalid_signature",
    "revoked",
    "expired",
    "destination_not_approved",
    "rate_limited",
  ] as const)("excludes a %s link assessment", (linkEligibility) => {
    expect(
      evaluateLastTouchAttribution(
        input({ touches: [touch({ linkEligibility })] }),
      ),
    ).toMatchObject({
      outcome: "unattributed",
      reason: "no_eligible_touches",
    });
  });

  it("excludes duplicate and rejected click-quality evidence", () => {
    const duplicate = touch({
      id: "90000000-0000-4000-8000-000000000010",
      clickEventId: "e0000000-0000-4000-8000-000000000010",
      clickQualityOutcome: "duplicate",
      clickQualityReason: "duplicate_within_window",
      sessionClickKind: "duplicate",
    });
    const rejected = touch({
      id: "90000000-0000-4000-8000-000000000020",
      clickEventId: "e0000000-0000-4000-8000-000000000020",
      clickQualityOutcome: "rejected",
      clickQualityReason: "declared_automated_agent",
    });

    expect(
      evaluateLastTouchAttribution(input({ touches: [duplicate, rejected] })),
    ).toMatchObject({ outcome: "unattributed", eligibleTouchCount: 0 });
  });

  it("rejects cross-scope candidates at the trusted attribution boundary", () => {
    const crossProject = touch({
      projectId: "20000000-0000-4000-8000-000000000099",
    });

    expect(
      lastTouchAttributionInputSchema.safeParse(
        input({ touches: [crossProject] }),
      ).success,
    ).toBe(false);
  });

  it("excludes a protected mapping for a different wallet", () => {
    const otherWalletTouch = touch({
      walletAddress: otherWallet,
    });

    expect(
      evaluateLastTouchAttribution(input({ touches: [otherWalletTouch] })),
    ).toMatchObject({ outcome: "unattributed", eligibleTouchCount: 0 });
  });

  it("excludes a mapping that is not active, expired or unlinked at conversion", () => {
    const notActive = touch({
      id: "90000000-0000-4000-8000-000000000010",
      clickEventId: "e0000000-0000-4000-8000-000000000010",
      mappingActiveFrom: "2026-08-12T12:00:00.001Z",
    });
    const expired = touch({
      id: "90000000-0000-4000-8000-000000000020",
      clickEventId: "e0000000-0000-4000-8000-000000000020",
      touchTime: "2026-08-05T11:59:59.999Z",
      sessionExpiresAt: "2026-08-12T11:59:59.999Z",
      mappingActiveFrom: "2026-08-05T12:05:00.000Z",
      mappingMonitoringEndsAt: "2026-08-12T11:59:59.999Z",
    });
    const unlinked = touch({
      id: "90000000-0000-4000-8000-000000000030",
      clickEventId: "e0000000-0000-4000-8000-000000000030",
      mappingUnlinkedAt: "2026-08-12T11:59:59.999Z",
    });

    expect(
      evaluateLastTouchAttribution(
        input({ touches: [notActive, expired, unlinked] }),
      ),
    ).toMatchObject({ outcome: "unattributed", eligibleTouchCount: 0 });
  });

  it("uses stable click identity to break equal-time ties", () => {
    const lower = touch({
      id: "90000000-0000-4000-8000-000000000010",
      clickEventId: "e0000000-0000-4000-8000-000000000010",
      creatorId: "b0000000-0000-4000-8000-000000000010",
    });
    const higher = touch({
      id: "90000000-0000-4000-8000-000000000020",
      clickEventId: "e0000000-0000-4000-8000-000000000020",
      creatorId: "b0000000-0000-4000-8000-000000000020",
    });

    expect(
      evaluateLastTouchAttribution(input({ touches: [lower, higher] })),
    ).toMatchObject({ touchId: higher.id, creatorId: higher.creatorId });
  });

  it("does not expose the protected wallet address in attributed or unattributed results", () => {
    expect(JSON.stringify(evaluateLastTouchAttribution(input()))).not.toContain(
      walletAddress,
    );
    expect(
      JSON.stringify(evaluateLastTouchAttribution(input({ touches: [] }))),
    ).not.toContain(walletAddress);
  });

  it("rejects duplicate touch or click identities instead of silently double counting", () => {
    const retained = touch();
    const duplicate = touch();
    expect(
      lastTouchAttributionInputSchema.safeParse(
        input({ touches: [retained, duplicate] }),
      ).success,
    ).toBe(false);
  });

  it("rejects conversion facts that are not exactly bound to the rule", () => {
    expect(
      lastTouchAttributionInputSchema.safeParse(
        input({
          conversion: {
            ...conversion(),
            ruleVersionId: "40000000-0000-4000-8000-000000000099",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects non-canonical timestamp precision at the attribution boundary", () => {
    expect(
      attributionTouchCandidateSchema.safeParse(
        touch({ touchTime: "2026-08-12T11:00:00+01:00" }),
      ).success,
    ).toBe(false);
  });
});
