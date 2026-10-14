// ATT-01: exact-microsecond selector V2; never used to reinterpret V1 facts.
import {
  exactInstantSchema,
  exactMicros,
  instantFromMicros,
} from "./exact-instants";
import { conversionRuleVersionRecordSchema } from "@landed/contracts";
import { solanaAddressSchema } from "@landed/solana";
import { z } from "zod";

import { conversionValueSchema } from "./schemas";

export const attributionEvaluatorVersion = 2 as const;

const attributionInstantSchema = exactInstantSchema;

export const touchLinkEligibilitySchema = z.enum([
  "eligible",
  "invalid_signature",
  "revoked",
  "expired",
  "destination_not_approved",
  "rate_limited",
]);

export const touchClickQualityOutcomeSchema = z.enum([
  "qualified",
  "duplicate",
  "rejected",
]);

export const touchClickQualityReasonSchema = z.enum([
  "passed_declared_checks",
  "duplicate_within_window",
  "declared_automated_agent",
  "raw_click_ineligible",
]);

export const attributionConversionFactSchema = z
  .strictObject({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    walletAddress: solanaAddressSchema,
    evaluatorVersion: z.literal(2),
    ruleVersionId: z.uuid(),
    protectedWalletMappingId: z.uuid(),
    evidenceId: z.string().min(1).max(200),
    evidenceTime: z.iso.datetime(),
    outcome: z.literal("match"),
    reason: z.literal("matched"),
    conversionTime: z.iso.datetime(),
    value: conversionValueSchema,
    revenue: z.strictObject({ kind: z.literal("none") }),
  })
  .superRefine((conversion, context) => {
    if (
      !attributionInstantSchema.safeParse(conversion.evidenceTime).success ||
      !attributionInstantSchema.safeParse(conversion.conversionTime).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Conversion timestamps must be canonical UTC microseconds",
        path: ["conversionTime"],
      });
    }

    if (conversion.evidenceTime !== conversion.conversionTime) {
      context.addIssue({
        code: "custom",
        message: "Conversion time must remain bound to its evidence time",
        path: ["conversionTime"],
      });
    }
  });

export type AttributionConversionFact = z.infer<
  typeof attributionConversionFactSchema
>;

export const attributionTouchCandidateSchema = z
  .strictObject({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    campaignId: z.uuid(),
    creatorId: z.uuid(),
    contentAssetId: z.uuid(),
    trackedLinkId: z.uuid(),
    clickEventId: z.uuid(),
    clickQualityAssessmentId: z.uuid(),
    anonymousSessionId: z.uuid(),
    walletProofId: z.uuid(),
    measurementConsentId: z.uuid(),
    protectedWalletMappingId: z.uuid(),
    walletAddress: solanaAddressSchema,
    touchTime: attributionInstantSchema,
    sessionExpiresAt: attributionInstantSchema,
    mappingActiveFrom: attributionInstantSchema,
    mappingMonitoringEndsAt: attributionInstantSchema,
    mappingUnlinkedAt: attributionInstantSchema.nullable(),
    linkEligibility: touchLinkEligibilitySchema,
    clickQualityOutcome: touchClickQualityOutcomeSchema,
    clickQualityReason: touchClickQualityReasonSchema,
    sessionClickKind: z.enum(["originating", "duplicate"]),
  })
  .superRefine((touch, context) => {
    const touchTime = exactMicros(touch.touchTime);
    const sessionExpiresAt = exactMicros(touch.sessionExpiresAt);
    const activeFrom = exactMicros(touch.mappingActiveFrom);
    const monitoringEndsAt = exactMicros(touch.mappingMonitoringEndsAt);

    if (sessionExpiresAt !== touchTime + 604_800_000_000n) {
      context.addIssue({
        code: "custom",
        message: "The retained session must use the exact seven-day lifetime",
        path: ["sessionExpiresAt"],
      });
    }
    if (activeFrom < touchTime || activeFrom >= monitoringEndsAt) {
      context.addIssue({
        code: "custom",
        message: "The protected mapping has an invalid active range",
        path: ["mappingActiveFrom"],
      });
    }
    if (touch.sessionExpiresAt !== touch.mappingMonitoringEndsAt) {
      context.addIssue({
        code: "custom",
        message: "The mapping must retain the exact bound-session expiry",
        path: ["mappingMonitoringEndsAt"],
      });
    }
    if (
      touch.mappingUnlinkedAt &&
      exactMicros(touch.mappingUnlinkedAt) < activeFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "A mapping cannot be unlinked before it becomes active",
        path: ["mappingUnlinkedAt"],
      });
    }

    const validQualityPair =
      (touch.clickQualityOutcome === "qualified" &&
        touch.clickQualityReason === "passed_declared_checks" &&
        touch.sessionClickKind === "originating") ||
      (touch.clickQualityOutcome === "duplicate" &&
        touch.clickQualityReason === "duplicate_within_window" &&
        touch.sessionClickKind === "duplicate") ||
      (touch.clickQualityOutcome === "rejected" &&
        (touch.clickQualityReason === "declared_automated_agent" ||
          touch.clickQualityReason === "raw_click_ineligible"));

    if (!validQualityPair) {
      context.addIssue({
        code: "custom",
        message: "Click quality outcome, reason and session kind disagree",
        path: ["clickQualityOutcome"],
      });
    }
  });

export type AttributionTouchCandidate = z.infer<
  typeof attributionTouchCandidateSchema
>;

export const lastTouchAttributionInputSchema = z
  .strictObject({
    ruleVersion: conversionRuleVersionRecordSchema,
    conversion: attributionConversionFactSchema,
    touches: z.array(attributionTouchCandidateSchema).max(500),
  })
  .superRefine((input, context) => {
    const conversion = input.conversion;
    const rule = input.ruleVersion;
    if (
      conversion.ruleVersionId !== rule.id ||
      conversion.workspaceId !== rule.workspaceId ||
      conversion.projectId !== rule.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Conversion and rule version must share exact retained scope",
        path: ["conversion"],
      });
    }

    const conversionTime = exactMicros(conversion.conversionTime);
    if (
      conversionTime < exactMicros(rule.effectiveFrom) ||
      (rule.effectiveUntil !== null &&
        conversionTime >= exactMicros(rule.effectiveUntil))
    ) {
      context.addIssue({
        code: "custom",
        message: "Conversion must fall inside the retained rule range",
        path: ["conversion", "conversionTime"],
      });
    }

    const touchIds = new Set<string>();
    const clickIds = new Set<string>();
    for (const [index, touch] of input.touches.entries()) {
      if (
        touch.workspaceId !== conversion.workspaceId ||
        touch.projectId !== conversion.projectId
      ) {
        context.addIssue({
          code: "custom",
          message: "Touch candidates must remain inside conversion scope",
          path: ["touches", index],
        });
      }
      if (touchIds.has(touch.id)) {
        context.addIssue({
          code: "custom",
          message: "Touch candidate IDs must be unique",
          path: ["touches", index, "id"],
        });
      }
      if (clickIds.has(touch.clickEventId)) {
        context.addIssue({
          code: "custom",
          message: "Click evidence can appear only once per evaluation",
          path: ["touches", index, "clickEventId"],
        });
      }
      touchIds.add(touch.id);
      clickIds.add(touch.clickEventId);
    }
  });

export type LastTouchAttributionInput = z.infer<
  typeof lastTouchAttributionInputSchema
>;

export const unattributedReasonSchema = z.enum([
  "no_candidate_touches",
  "no_eligible_touches",
]);

const attributionResultBaseSchema = z.strictObject({
  attributionEvaluatorVersion: z.literal(attributionEvaluatorVersion),
  attributionModel: z.literal("last_eligible_creator_touch"),
  attributionWindowSeconds: z.literal(604_800),
  attributionWindowStartedAt: attributionInstantSchema,
  attributionWindowEndedAt: attributionInstantSchema,
  conversionFactId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  conversionRuleVersionId: z.uuid(),
  conversionEvaluatorVersion: z.literal(2),
  conversionTime: attributionInstantSchema,
  candidateTouchCount: z.number().int().nonnegative(),
  eligibleTouchCount: z.number().int().nonnegative(),
});

export const attributedTouchResultSchema = attributionResultBaseSchema.extend({
  outcome: z.literal("attributed"),
  reason: z.literal("most_recent_eligible_touch"),
  touchId: z.uuid(),
  touchTime: attributionInstantSchema,
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  contentAssetId: z.uuid(),
  trackedLinkId: z.uuid(),
  clickEventId: z.uuid(),
  clickQualityAssessmentId: z.uuid(),
  anonymousSessionId: z.uuid(),
  walletProofId: z.uuid(),
  measurementConsentId: z.uuid(),
  protectedWalletMappingId: z.uuid(),
  value: conversionValueSchema,
  revenue: z.strictObject({ kind: z.literal("none") }),
});

export const unattributedTouchResultSchema = attributionResultBaseSchema.extend(
  {
    outcome: z.literal("unattributed"),
    reason: unattributedReasonSchema,
  },
);

export const lastTouchAttributionResultSchema = z.discriminatedUnion(
  "outcome",
  [attributedTouchResultSchema, unattributedTouchResultSchema],
);

export type LastTouchAttributionResult = z.infer<
  typeof lastTouchAttributionResultSchema
>;

function candidateIsEligible(
  touch: AttributionTouchCandidate,
  input: LastTouchAttributionInput,
) {
  const conversion = input.conversion;
  const conversionTime = exactMicros(conversion.conversionTime);
  const touchTime = exactMicros(touch.touchTime);
  const windowStartedAt =
    conversionTime -
    BigInt(input.ruleVersion.attributionWindowSeconds) * 1_000_000n;

  return (
    touch.walletAddress === conversion.walletAddress &&
    touch.linkEligibility === "eligible" &&
    touch.clickQualityOutcome === "qualified" &&
    touch.clickQualityReason === "passed_declared_checks" &&
    touch.sessionClickKind === "originating" &&
    touchTime >= windowStartedAt &&
    touchTime < conversionTime &&
    exactMicros(touch.mappingActiveFrom) <= conversionTime &&
    conversionTime < exactMicros(touch.mappingMonitoringEndsAt) &&
    (touch.mappingUnlinkedAt === null ||
      conversionTime < exactMicros(touch.mappingUnlinkedAt))
  );
}

function latestFirst(
  first: AttributionTouchCandidate,
  second: AttributionTouchCandidate,
) {
  const timeDifference =
    exactMicros(second.touchTime) - exactMicros(first.touchTime);
  if (timeDifference !== 0n) return timeDifference < 0n ? -1 : 1;
  if (first.clickEventId !== second.clickEventId) {
    return first.clickEventId > second.clickEventId ? -1 : 1;
  }
  if (first.id === second.id) return 0;
  return first.id > second.id ? -1 : 1;
}

export function evaluateLastTouchAttribution(
  rawInput: LastTouchAttributionInput,
): LastTouchAttributionResult {
  const input = lastTouchAttributionInputSchema.parse(rawInput);
  if (
    input.ruleVersion.templateCode !== "first_qualifying_transaction" ||
    input.ruleVersion.configuredEnvironment !== "devnet" ||
    input.ruleVersion.destinationAddress == null ||
    input.ruleVersion.nativeAmountLamports !== "1"
  ) {
    throw new Error(
      "Evaluator V2 requires the exact destination-bound Devnet rule.",
    );
  }
  const conversion = input.conversion;
  const conversionTime = exactMicros(conversion.conversionTime);
  const base = {
    attributionEvaluatorVersion,
    attributionModel: input.ruleVersion.attributionModel,
    attributionWindowSeconds: input.ruleVersion.attributionWindowSeconds,
    attributionWindowStartedAt: instantFromMicros(
      conversionTime -
        BigInt(input.ruleVersion.attributionWindowSeconds) * 1_000_000n,
    ),
    attributionWindowEndedAt: conversion.conversionTime,
    conversionFactId: conversion.id,
    workspaceId: conversion.workspaceId,
    projectId: conversion.projectId,
    conversionRuleVersionId: conversion.ruleVersionId,
    conversionEvaluatorVersion: conversion.evaluatorVersion,
    conversionTime: conversion.conversionTime,
    candidateTouchCount: input.touches.length,
  } as const;

  if (input.touches.length === 0) {
    return unattributedTouchResultSchema.parse({
      ...base,
      outcome: "unattributed",
      reason: "no_candidate_touches",
      eligibleTouchCount: 0,
    });
  }

  const eligibleTouches = input.touches
    .filter((touch) => candidateIsEligible(touch, input))
    .sort(latestFirst);
  const selected = eligibleTouches[0];

  if (!selected) {
    return unattributedTouchResultSchema.parse({
      ...base,
      outcome: "unattributed",
      reason: "no_eligible_touches",
      eligibleTouchCount: 0,
    });
  }

  return attributedTouchResultSchema.parse({
    ...base,
    outcome: "attributed",
    reason: "most_recent_eligible_touch",
    eligibleTouchCount: eligibleTouches.length,
    touchId: selected.id,
    touchTime: selected.touchTime,
    campaignId: selected.campaignId,
    creatorId: selected.creatorId,
    contentAssetId: selected.contentAssetId,
    trackedLinkId: selected.trackedLinkId,
    clickEventId: selected.clickEventId,
    clickQualityAssessmentId: selected.clickQualityAssessmentId,
    anonymousSessionId: selected.anonymousSessionId,
    walletProofId: selected.walletProofId,
    measurementConsentId: selected.measurementConsentId,
    protectedWalletMappingId: selected.protectedWalletMappingId,
    value: conversion.value,
    revenue: conversion.revenue,
  });
}

export function isAttributedTouch(
  result: LastTouchAttributionResult,
): result is z.infer<typeof attributedTouchResultSchema> {
  return result.outcome === "attributed";
}
