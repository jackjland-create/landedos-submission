import { describe, expect, it } from "vitest";

import {
  attributionConfidenceInputSchema,
  classifyAttributionConfidence,
  type AttributionConfidenceInput,
} from "./confidence";
import type { LastTouchAttributionResult } from "./last-touch";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const conversionFactId = "50000000-0000-4000-8000-000000000001";

function resultBase() {
  return {
    attributionEvaluatorVersion: 1 as const,
    attributionModel: "last_eligible_creator_touch" as const,
    attributionWindowSeconds: 604_800 as const,
    attributionWindowStartedAt: "2026-08-05T12:00:00.000Z",
    attributionWindowEndedAt: "2026-08-12T12:00:00.000Z",
    conversionFactId,
    workspaceId,
    projectId,
    conversionRuleVersionId: "40000000-0000-4000-8000-000000000001",
    conversionEvaluatorVersion: 1 as const,
    conversionTime: "2026-08-12T12:00:00.000Z",
    candidateTouchCount: 1,
    eligibleTouchCount: 1,
  };
}

function attributed(): LastTouchAttributionResult {
  return {
    ...resultBase(),
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
  };
}

function unattributed(
  reason:
    "no_candidate_touches" | "no_eligible_touches" = "no_eligible_touches",
): LastTouchAttributionResult {
  return {
    ...resultBase(),
    outcome: "unattributed",
    reason,
    eligibleTouchCount: 0,
  };
}

function directReferral() {
  const selected = attributed();
  if (selected.outcome !== "attributed") throw new Error("Invalid fixture");
  return {
    id: "21000000-0000-4000-8000-000000000001",
    workspaceId,
    projectId,
    conversionFactId,
    campaignId: selected.campaignId,
    creatorId: selected.creatorId,
    contentAssetId: selected.contentAssetId,
    sourceEventId: "canonical-transfer:referral:1",
    referralIdentifier: "helios:spring:creator-01",
    observedAt: selected.conversionTime,
    finality: "finalized" as const,
  };
}

function indicativeEvidence() {
  return {
    id: "22000000-0000-4000-8000-000000000001",
    workspaceId,
    projectId,
    conversionFactId,
    campaignId: "a0000000-0000-4000-8000-000000000001",
    creatorId: "b0000000-0000-4000-8000-000000000001",
    contentAssetId: "c0000000-0000-4000-8000-000000000001",
    trackedLinkId: "d0000000-0000-4000-8000-000000000001",
    clickEventId: "e0000000-0000-4000-8000-000000000001",
    clickQualityAssessmentId: "f0000000-0000-4000-8000-000000000001",
    anonymousSessionId: "11000000-0000-4000-8000-000000000001",
    observedActionEvidenceId: "observed-action:session:1",
    touchTime: "2026-08-12T10:00:00.000Z",
    sessionExpiresAt: "2026-08-19T10:00:00.000Z",
    actionTime: "2026-08-12T12:00:00.000Z",
    linkEligibility: "eligible" as const,
    clickQualityOutcome: "qualified" as const,
    walletProofStatus: "not_present" as const,
  };
}

function input(
  overrides: Partial<AttributionConfidenceInput> = {},
): AttributionConfidenceInput {
  return {
    attribution: attributed(),
    directOnchainReferral: null,
    indicativeEvidence: null,
    ...overrides,
  };
}

describe("classifyAttributionConfidence", () => {
  it("classifies an exact finalized onchain referral as verified", () => {
    const attribution = attributed();
    const evidence = directReferral();

    expect(
      classifyAttributionConfidence(
        input({ attribution, directOnchainReferral: evidence }),
      ),
    ).toEqual({
      classifierVersion: 1,
      confidence: "verified",
      reason: "direct_onchain_referral_match",
      primaryRoasEligible: true,
      conversionFactId,
      workspaceId,
      projectId,
      conversionTime: "2026-08-12T12:00:00.000Z",
      attributionEvaluatorVersion: 1,
      attributionModel: "last_eligible_creator_touch",
      attributionWindowSeconds: 604_800,
      attribution,
      directOnchainReferral: evidence,
    });
  });

  it("classifies a signed wallet/session attribution as strong", () => {
    expect(classifyAttributionConfidence(input())).toMatchObject({
      confidence: "strong",
      reason: "signed_wallet_session_and_eligible_click",
      primaryRoasEligible: true,
      attribution: { outcome: "attributed" },
    });
  });

  it("classifies eligible click plus observed action without wallet proof as indicative", () => {
    const evidence = indicativeEvidence();
    expect(
      classifyAttributionConfidence(
        input({
          attribution: unattributed(),
          indicativeEvidence: evidence,
        }),
      ),
    ).toMatchObject({
      confidence: "indicative",
      reason: "eligible_click_and_observed_action_without_wallet_proof",
      primaryRoasEligible: false,
      indicativeEvidence: evidence,
    });
  });

  it.each(["no_candidate_touches", "no_eligible_touches"] as const)(
    "classifies %s as unattributed and retains the detail reason",
    (reason) => {
      expect(
        classifyAttributionConfidence(
          input({ attribution: unattributed(reason) }),
        ),
      ).toMatchObject({
        confidence: "unattributed",
        reason: "no_eligible_creator_touch",
        detailReason: reason,
        primaryRoasEligible: false,
      });
    },
  );

  it("rejects direct referral evidence that does not exactly bind the selected touch", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({
          directOnchainReferral: {
            ...directReferral(),
            creatorId: "b0000000-0000-4000-8000-000000000099",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a non-finalized direct referral instead of overstating confidence", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({
          directOnchainReferral: {
            ...directReferral(),
            finality: "confirmed" as never,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects indicative evidence outside the retained seven-day window", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({
          attribution: unattributed(),
          indicativeEvidence: {
            ...indicativeEvidence(),
            touchTime: "2026-08-05T11:59:59.999Z",
            sessionExpiresAt: "2026-08-12T11:59:59.999Z",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an indicative action once its exact seven-day session expires", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({
          attribution: unattributed(),
          indicativeEvidence: {
            ...indicativeEvidence(),
            touchTime: "2026-08-05T12:00:00.000Z",
            sessionExpiresAt: "2026-08-12T12:00:00.000Z",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects indicative evidence when a signed-wallet attribution already exists", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({ indicativeEvidence: indicativeEvidence() }),
      ).success,
    ).toBe(false);
  });

  it("rejects contradictory direct and indicative evidence paths", () => {
    expect(
      attributionConfidenceInputSchema.safeParse(
        input({
          directOnchainReferral: directReferral(),
          indicativeEvidence: indicativeEvidence(),
        }),
      ).success,
    ).toBe(false);
  });

  it("does not include wallet addresses in any classification output", () => {
    const outputs = [
      classifyAttributionConfidence(
        input({ directOnchainReferral: directReferral() }),
      ),
      classifyAttributionConfidence(input()),
      classifyAttributionConfidence(
        input({
          attribution: unattributed(),
          indicativeEvidence: indicativeEvidence(),
        }),
      ),
      classifyAttributionConfidence(
        input({ attribution: unattributed("no_candidate_touches") }),
      ),
    ];

    for (const output of outputs) {
      expect(JSON.stringify(output)).not.toContain("walletAddress");
    }
  });
});
