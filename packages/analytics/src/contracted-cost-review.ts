import { compensationCurrencySchema } from "@landed/contracts";
import { z } from "zod";

import { timedCampaignReportSourcesSchema } from "./campaign-report-preview";
import {
  retainedReportInstantSchema,
  retainedReportMicros,
} from "./report-instants";

export const contractedCostReviewSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  commercialPlanVersionId: z.uuid(),
  commercialPlanSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  ruleVersionId: z.uuid(),
  measurementWindow: z.strictObject({
    startedAt: retainedReportInstantSchema,
    endedAt: retainedReportInstantSchema,
  }),
  policy: z.strictObject({
    basis: z.literal("contracted"),
    version: z.literal(1),
  }),
  currencyCode: compensationCurrencySchema,
  additionalCosts: z.enum(["none_declared", "unknown"]),
  decisions: z
    .array(
      z.strictObject({
        compensationLineId: z.uuid(),
        inclusion: z.enum(["included", "excluded"]),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .max(5_000),
});

export type ContractedCostReview = z.infer<typeof contractedCostReviewSchema>;
type UnavailableReason =
  | "additional_costs_unknown"
  | "variable_compensation"
  | "non_cash_valuation_required"
  | "currency_mismatch";

/** RPT-01 / BSK-09 pure projection, not approval or proof of source authenticity.
 * The private caller must authenticate the human, load authoritative sources,
 * retain the exact review and recheck source drift atomically before issuance.
 * Contracted costs are not settlement/payment evidence. */
export function buildContractedCostReview(
  rawSources: unknown,
  rawReview: unknown,
) {
  const sources = timedCampaignReportSourcesSchema.parse(rawSources);
  const review = contractedCostReviewSchema.parse(rawReview);
  for (const key of [
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "ruleVersionId",
  ] as const) {
    if (sources[key].toLowerCase() !== review[key].toLowerCase())
      throw new Error(`Contracted cost review scope drift: ${key}`);
  }
  if (sources.commercialPlanSnapshotHash !== review.commercialPlanSnapshotHash)
    throw new Error("Contracted cost review snapshot drift");
  for (const key of ["startedAt", "endedAt"] as const) {
    if (
      retainedReportMicros(sources.measurementWindow[key]) !==
      retainedReportMicros(review.measurementWindow[key])
    )
      throw new Error("Contracted cost review measurement drift");
  }
  const decisions = new Map(
    review.decisions.map((decision) => [
      decision.compensationLineId.toLowerCase(),
      decision,
    ]),
  );
  if (decisions.size !== review.decisions.length)
    throw new Error("Duplicate compensation decision");
  const sourceLines = sources.commercialPlanSnapshot.packages.flatMap((pkg) =>
    pkg.compensationLines.map((terms) => ({
      packageId: pkg.id,
      creatorId: pkg.creatorId,
      terms,
    })),
  );
  if (
    sourceLines.length !== decisions.size ||
    sourceLines.some(({ terms }) => !decisions.has(terms.id.toLowerCase()))
  )
    throw new Error(
      "Every approved compensation line requires exactly one decision; foreign lines are forbidden",
    );

  const reasons = new Set<UnavailableReason>();
  if (review.additionalCosts === "unknown")
    reasons.add("additional_costs_unknown");
  let total = 0n;
  // Source order, not user decision order, makes reordered identical reviews stable.
  const lines = sourceLines.map(({ packageId, creatorId, terms }) => {
    const decision = decisions.get(terms.id.toLowerCase())!;
    if (decision.inclusion === "included") {
      if (terms.model !== "fixed") reasons.add("variable_compensation");
      if (terms.assetType !== "cash")
        reasons.add("non_cash_valuation_required");
      else {
        if (terms.currencyCode !== review.currencyCode)
          reasons.add("currency_mismatch");
        if (
          terms.model === "fixed" &&
          terms.currencyCode === review.currencyCode
        )
          total += BigInt(terms.amountMinor);
      }
    }
    return {
      packageId,
      creatorId,
      compensationLineId: terms.id,
      terms,
      inclusion: decision.inclusion,
      reason: decision.reason,
    };
  });
  return {
    kind: "contracted_cost_review" as const,
    policy: review.policy,
    label: "Reviewed contracted costs" as const,
    workspaceId: sources.workspaceId,
    projectId: sources.projectId,
    campaignId: sources.campaignId,
    commercialPlanVersionId: sources.commercialPlanVersionId,
    commercialPlanSnapshotHash: sources.commercialPlanSnapshotHash,
    ruleVersionId: sources.ruleVersionId,
    measurementWindow: sources.measurementWindow,
    currencyCode: review.currencyCode,
    additionalCosts: review.additionalCosts,
    lines,
    total:
      reasons.size === 0
        ? {
            status: "available" as const,
            amountMinor: total.toString(),
            currencyCode: review.currencyCode,
          }
        : {
            status: "not_available" as const,
            amountMinor: null,
            currencyCode: review.currencyCode,
            reasons: [...reasons].sort(),
          },
    authorization: "not_established" as const,
    issuance: "not_authorized" as const,
  };
}
