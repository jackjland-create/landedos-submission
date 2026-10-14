import { confidenceSchema } from "@landed/contracts";
import { z } from "zod";

import {
  attributedTouchResultSchema,
  lastTouchAttributionResultSchema,
  unattributedReasonSchema,
} from "./last-touch";

export const attributionConfidenceClassifierVersion = 1 as const;

const confidenceInstantSchema = z.iso
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message:
      "Confidence evidence timestamps must use canonical UTC milliseconds",
  });

export const directOnchainReferralEvidenceSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  conversionFactId: z.uuid(),
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  contentAssetId: z.uuid(),
  sourceEventId: z.string().min(1).max(200),
  referralIdentifier: z.string().min(1).max(200),
  observedAt: confidenceInstantSchema,
  finality: z.literal("finalized"),
});

export type DirectOnchainReferralEvidence = z.infer<
  typeof directOnchainReferralEvidenceSchema
>;

export const indicativeAttributionEvidenceSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  conversionFactId: z.uuid(),
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  contentAssetId: z.uuid(),
  trackedLinkId: z.uuid(),
  clickEventId: z.uuid(),
  clickQualityAssessmentId: z.uuid(),
  anonymousSessionId: z.uuid(),
  observedActionEvidenceId: z.string().min(1).max(200),
  touchTime: confidenceInstantSchema,
  sessionExpiresAt: confidenceInstantSchema,
  actionTime: confidenceInstantSchema,
  linkEligibility: z.literal("eligible"),
  clickQualityOutcome: z.literal("qualified"),
  walletProofStatus: z.literal("not_present"),
});

export type IndicativeAttributionEvidence = z.infer<
  typeof indicativeAttributionEvidenceSchema
>;

export const attributionConfidenceInputSchema = z
  .strictObject({
    attribution: lastTouchAttributionResultSchema,
    directOnchainReferral: directOnchainReferralEvidenceSchema.nullable(),
    indicativeEvidence: indicativeAttributionEvidenceSchema.nullable(),
  })
  .superRefine((input, context) => {
    const attribution = input.attribution;
    const direct = input.directOnchainReferral;
    const indicative = input.indicativeEvidence;

    if (direct && indicative) {
      context.addIssue({
        code: "custom",
        message: "One classification may use only one confidence evidence path",
        path: ["directOnchainReferral"],
      });
    }

    if (direct) {
      if (attribution.outcome !== "attributed") {
        context.addIssue({
          code: "custom",
          message:
            "Direct referral evidence requires an eligible attributed touch",
          path: ["directOnchainReferral"],
        });
      } else {
        const exactBinding =
          direct.workspaceId === attribution.workspaceId &&
          direct.projectId === attribution.projectId &&
          direct.conversionFactId === attribution.conversionFactId &&
          direct.campaignId === attribution.campaignId &&
          direct.creatorId === attribution.creatorId &&
          direct.contentAssetId === attribution.contentAssetId &&
          direct.observedAt === attribution.conversionTime;

        if (!exactBinding) {
          context.addIssue({
            code: "custom",
            message:
              "Direct referral evidence must exactly bind the selected attribution",
            path: ["directOnchainReferral"],
          });
        }
      }
    }

    if (indicative) {
      if (attribution.outcome !== "unattributed") {
        context.addIssue({
          code: "custom",
          message:
            "Indicative evidence cannot replace a signed-wallet attribution",
          path: ["indicativeEvidence"],
        });
      }

      const actionTime = Date.parse(indicative.actionTime);
      const touchTime = Date.parse(indicative.touchTime);
      const sessionExpiresAt = Date.parse(indicative.sessionExpiresAt);
      const windowStartedAt = Date.parse(
        attribution.attributionWindowStartedAt,
      );
      const exactBinding =
        indicative.workspaceId === attribution.workspaceId &&
        indicative.projectId === attribution.projectId &&
        indicative.conversionFactId === attribution.conversionFactId &&
        indicative.actionTime === attribution.conversionTime;

      if (!exactBinding) {
        context.addIssue({
          code: "custom",
          message:
            "Indicative evidence must exactly bind the conversion and tenant scope",
          path: ["indicativeEvidence"],
        });
      }
      if (touchTime < windowStartedAt || touchTime >= actionTime) {
        context.addIssue({
          code: "custom",
          message:
            "Indicative touch must precede the action inside the retained window",
          path: ["indicativeEvidence", "touchTime"],
        });
      }
      if (
        sessionExpiresAt !== touchTime + 604_800_000 ||
        actionTime >= sessionExpiresAt
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Indicative evidence must retain a live exact seven-day session",
          path: ["indicativeEvidence", "sessionExpiresAt"],
        });
      }
    }
  });

export type AttributionConfidenceInput = z.infer<
  typeof attributionConfidenceInputSchema
>;

const classificationBaseSchema = z.strictObject({
  classifierVersion: z.literal(attributionConfidenceClassifierVersion),
  confidence: confidenceSchema,
  primaryRoasEligible: z.boolean(),
  conversionFactId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  conversionTime: confidenceInstantSchema,
  attributionEvaluatorVersion: z.literal(1),
  attributionModel: z.literal("last_eligible_creator_touch"),
  attributionWindowSeconds: z.literal(604_800),
});

export const verifiedConfidenceResultSchema = classificationBaseSchema.extend({
  confidence: z.literal("verified"),
  reason: z.literal("direct_onchain_referral_match"),
  primaryRoasEligible: z.literal(true),
  attribution: attributedTouchResultSchema,
  directOnchainReferral: directOnchainReferralEvidenceSchema,
});

export const strongConfidenceResultSchema = classificationBaseSchema.extend({
  confidence: z.literal("strong"),
  reason: z.literal("signed_wallet_session_and_eligible_click"),
  primaryRoasEligible: z.literal(true),
  attribution: attributedTouchResultSchema,
});

export const indicativeConfidenceResultSchema = classificationBaseSchema.extend(
  {
    confidence: z.literal("indicative"),
    reason: z.literal(
      "eligible_click_and_observed_action_without_wallet_proof",
    ),
    primaryRoasEligible: z.literal(false),
    indicativeEvidence: indicativeAttributionEvidenceSchema,
  },
);

export const unattributedConfidenceResultSchema =
  classificationBaseSchema.extend({
    confidence: z.literal("unattributed"),
    reason: z.literal("no_eligible_creator_touch"),
    detailReason: unattributedReasonSchema,
    primaryRoasEligible: z.literal(false),
  });

export const attributionConfidenceResultSchema = z.discriminatedUnion(
  "confidence",
  [
    verifiedConfidenceResultSchema,
    strongConfidenceResultSchema,
    indicativeConfidenceResultSchema,
    unattributedConfidenceResultSchema,
  ],
);

export type AttributionConfidenceResult = z.infer<
  typeof attributionConfidenceResultSchema
>;

export function classifyAttributionConfidence(
  rawInput: AttributionConfidenceInput,
): AttributionConfidenceResult {
  const input = attributionConfidenceInputSchema.parse(rawInput);
  const attribution = input.attribution;
  const base = {
    classifierVersion: attributionConfidenceClassifierVersion,
    conversionFactId: attribution.conversionFactId,
    workspaceId: attribution.workspaceId,
    projectId: attribution.projectId,
    conversionTime: attribution.conversionTime,
    attributionEvaluatorVersion: attribution.attributionEvaluatorVersion,
    attributionModel: attribution.attributionModel,
    attributionWindowSeconds: attribution.attributionWindowSeconds,
  } as const;

  if (input.directOnchainReferral && attribution.outcome === "attributed") {
    return verifiedConfidenceResultSchema.parse({
      ...base,
      confidence: "verified",
      reason: "direct_onchain_referral_match",
      primaryRoasEligible: true,
      attribution,
      directOnchainReferral: input.directOnchainReferral,
    });
  }

  if (attribution.outcome === "attributed") {
    return strongConfidenceResultSchema.parse({
      ...base,
      confidence: "strong",
      reason: "signed_wallet_session_and_eligible_click",
      primaryRoasEligible: true,
      attribution,
    });
  }

  if (input.indicativeEvidence) {
    return indicativeConfidenceResultSchema.parse({
      ...base,
      confidence: "indicative",
      reason: "eligible_click_and_observed_action_without_wallet_proof",
      primaryRoasEligible: false,
      indicativeEvidence: input.indicativeEvidence,
    });
  }

  return unattributedConfidenceResultSchema.parse({
    ...base,
    confidence: "unattributed",
    reason: "no_eligible_creator_touch",
    detailReason: attribution.reason,
    primaryRoasEligible: false,
  });
}
