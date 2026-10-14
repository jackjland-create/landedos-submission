import {
  commercialPlanSnapshotPackageSchema,
  confidenceSchema,
} from "@landed/contracts";
import { z } from "zod";

export {
  buildCampaignReportReview,
  campaignReportReviewSchema,
  buildTimedCampaignReportReview,
  timedCampaignReportReviewSchema,
} from "./campaign-report-readiness";

export { retainedReportMicros } from "./report-instants";
export { inspectMetricV1RangeCompatibility } from "./metric-time-compatibility";

export {
  buildCampaignReportPreview,
  campaignReportSourcesSchema,
  buildTimedCampaignReportPreview,
  timedCampaignReportSourcesSchema,
  type CampaignReportSources,
} from "./campaign-report-preview";

export const metricCalculationVersion = 1 as const;
export const metricDecimalPrecision = 6 as const;

const canonicalInstantSchema = z.iso
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Metric timestamps must use canonical UTC millisecond ISO",
  });

const minorIntegerSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,77})$/, "Use a bounded non-negative integer string");

const evidenceIdSchema = z.string().min(1).max(200);

export const metricUnavailableSourceReasonSchema = z.enum([
  "source_not_configured",
  "source_incomplete",
]);

const spendLineSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["creator_compensation", "campaign_cost"]),
    amountMinor: minorIntegerSchema,
    inclusion: z.enum(["included", "excluded"]),
    exclusionReason: z.string().min(1).max(200).nullable(),
    sourceEvidenceId: evidenceIdSchema,
  })
  .superRefine((line, context) => {
    if (
      (line.inclusion === "included" && line.exclusionReason !== null) ||
      (line.inclusion === "excluded" && line.exclusionReason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Spend inclusion and exclusion reason disagree",
        path: ["exclusionReason"],
      });
    }
  });

const completeSpendSchema = z.strictObject({
  status: z.literal("complete"),
  lines: z.array(spendLineSchema).max(1_000),
});

const unavailableDimensionSchema = z.strictObject({
  status: z.literal("not_available"),
  reason: metricUnavailableSourceReasonSchema,
});

export const metricSpendInputSchema = z.discriminatedUnion("status", [
  completeSpendSchema,
  unavailableDimensionSchema,
]);

const completeCountSchema = z.strictObject({
  status: z.literal("complete"),
  evidenceIds: z.array(evidenceIdSchema).max(10_000),
});

export const metricCountInputSchema = z.discriminatedUnion("status", [
  completeCountSchema,
  unavailableDimensionSchema,
]);

const revenueLineSchema = z.strictObject({
  id: z.uuid(),
  attributionEvidenceId: evidenceIdSchema,
  sourceRevenueEvidenceId: evidenceIdSchema,
  confidence: confidenceSchema,
  protocolRevenueMinor: minorIntegerSchema,
});

const completeRevenueSchema = z.strictObject({
  status: z.literal("complete"),
  lines: z.array(revenueLineSchema).max(1_000),
});

export const metricRevenueInputSchema = z.discriminatedUnion("status", [
  completeRevenueSchema,
  unavailableDimensionSchema,
]);

export const metricSnapshotInputSchema = z
  .strictObject({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    campaignId: z.uuid(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    valuationPolicy: z.strictObject({
      id: z.string().min(1).max(100),
      version: z.number().int().positive(),
      description: z.string().min(1).max(300),
      currencyCode: z.string().regex(/^[A-Z]{3}$/),
      valuedAt: canonicalInstantSchema,
    }),
    conversionRuleVersionIds: z.array(z.uuid()).min(1).max(100),
    attributionClassifierVersion: z.literal(1),
    sourceTimeRange: z.strictObject({
      startedAt: canonicalInstantSchema,
      endedAt: canonicalInstantSchema,
    }),
    dataFreshness: z.strictObject({
      dataThrough: canonicalInstantSchema,
      calculatedAt: canonicalInstantSchema,
    }),
    spend: metricSpendInputSchema,
    qualifiedClicks: metricCountInputSchema,
    qualifiedWallets: metricCountInputSchema,
    activatedWallets: metricCountInputSchema,
    activationDefinition: z.strictObject({
      ruleVersionId: z.uuid(),
      label: z.string().min(1).max(160),
    }),
    protocolRevenue: metricRevenueInputSchema,
  })
  .superRefine((input, context) => {
    const startedAt = Date.parse(input.sourceTimeRange.startedAt);
    const endedAt = Date.parse(input.sourceTimeRange.endedAt);
    const dataThrough = Date.parse(input.dataFreshness.dataThrough);
    const calculatedAt = Date.parse(input.dataFreshness.calculatedAt);

    if (startedAt >= endedAt) {
      context.addIssue({
        code: "custom",
        message: "Metric source range must advance",
        path: ["sourceTimeRange"],
      });
    }
    if (
      dataThrough < startedAt ||
      dataThrough > endedAt ||
      endedAt > calculatedAt
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Metric freshness must remain inside the source/calculation range",
        path: ["dataFreshness"],
      });
    }
    if (input.valuationPolicy.currencyCode !== input.currencyCode) {
      context.addIssue({
        code: "custom",
        message: "Valuation policy currency must match the metric currency",
        path: ["valuationPolicy", "currencyCode"],
      });
    }
    if (Date.parse(input.valuationPolicy.valuedAt) > calculatedAt) {
      context.addIssue({
        code: "custom",
        message: "Valuation evidence cannot postdate metric calculation",
        path: ["valuationPolicy", "valuedAt"],
      });
    }

    const ruleIds = new Set(input.conversionRuleVersionIds);
    if (ruleIds.size !== input.conversionRuleVersionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Conversion rule version IDs must be unique",
        path: ["conversionRuleVersionIds"],
      });
    }

    if (input.spend.status === "complete") {
      addDuplicateIssues(
        input.spend.lines.map((line) => line.id),
        context,
        ["spend", "lines"],
        "Spend line IDs must be unique",
      );
      addDuplicateIssues(
        input.spend.lines.map((line) => line.sourceEvidenceId),
        context,
        ["spend", "lines"],
        "Spend source evidence must be unique",
      );
    }

    for (const [key, dimension] of [
      ["qualifiedClicks", input.qualifiedClicks],
      ["qualifiedWallets", input.qualifiedWallets],
      ["activatedWallets", input.activatedWallets],
    ] as const) {
      if (dimension.status === "complete") {
        addDuplicateIssues(
          dimension.evidenceIds,
          context,
          [key, "evidenceIds"],
          `${key} evidence IDs must be unique`,
        );
      }
    }

    if (
      input.qualifiedWallets.status === "complete" &&
      input.activatedWallets.status === "complete"
    ) {
      const qualified = new Set(input.qualifiedWallets.evidenceIds);
      if (
        input.activatedWallets.evidenceIds.some(
          (evidenceId) => !qualified.has(evidenceId),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Activated wallets must be a subset of qualified wallets",
          path: ["activatedWallets", "evidenceIds"],
        });
      }
    }

    if (input.protocolRevenue.status === "complete") {
      addDuplicateIssues(
        input.protocolRevenue.lines.map((line) => line.id),
        context,
        ["protocolRevenue", "lines"],
        "Revenue line IDs must be unique",
      );
      addDuplicateIssues(
        input.protocolRevenue.lines.map((line) => line.sourceRevenueEvidenceId),
        context,
        ["protocolRevenue", "lines"],
        "Revenue source evidence must be unique",
      );
    }
  });

export type MetricSnapshotInput = z.infer<typeof metricSnapshotInputSchema>;

function addDuplicateIssues(
  values: string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message, path });
  }
}

const availableMoneyComponentSchema = z.strictObject({
  status: z.literal("available"),
  kind: z.literal("eligible_campaign_spend_minor"),
  valueMinor: minorIntegerSchema,
  evidenceIds: z.array(evidenceIdSchema),
});

const availableRevenueComponentSchema = z.strictObject({
  status: z.literal("available"),
  kind: z.literal("protocol_revenue_minor"),
  valueMinor: minorIntegerSchema,
  sourceRevenueEvidenceIds: z.array(evidenceIdSchema),
  attributionEvidenceIds: z.array(evidenceIdSchema),
});

const availableCountComponentSchema = z.strictObject({
  status: z.literal("available"),
  kind: z.enum([
    "qualified_click_count",
    "qualified_wallet_count",
    "activated_wallet_count",
  ]),
  value: z.number().int().nonnegative(),
  evidenceIds: z.array(evidenceIdSchema),
});

const unavailableComponentSchema = z.strictObject({
  status: z.literal("not_available"),
  kind: z.enum([
    "eligible_campaign_spend_minor",
    "protocol_revenue_minor",
    "qualified_click_count",
    "qualified_wallet_count",
    "activated_wallet_count",
  ]),
  reason: metricUnavailableSourceReasonSchema,
});

const moneyComponentSchema = z.union([
  availableMoneyComponentSchema,
  availableRevenueComponentSchema,
  unavailableComponentSchema,
]);
const countComponentSchema = z.union([
  availableCountComponentSchema,
  unavailableComponentSchema,
]);

const metricContextSchema = z.strictObject({
  calculationVersion: z.literal(metricCalculationVersion),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  valuationPolicy: metricSnapshotInputSchema.shape.valuationPolicy,
  conversionRuleVersionIds: z.array(z.uuid()).min(1),
  attributionClassifierVersion: z.literal(1),
  includedAttributionConfidence: z.array(confidenceSchema),
  sourceTimeRange: metricSnapshotInputSchema.shape.sourceTimeRange,
  dataFreshness: metricSnapshotInputSchema.shape.dataFreshness,
  activationDefinition: metricSnapshotInputSchema.shape.activationDefinition,
  excludedSpend: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("available"),
      valueMinor: minorIntegerSchema,
      evidenceIds: z.array(evidenceIdSchema),
    }),
    z.strictObject({
      status: z.literal("not_available"),
      reason: metricUnavailableSourceReasonSchema,
    }),
  ]),
});

const availableCostMetricSchema = metricContextSchema.extend({
  metric: z.enum(["cpc", "cpqw", "cpa"]),
  definition: z.string().min(1),
  status: z.literal("available"),
  numerator: availableMoneyComponentSchema,
  denominator: availableCountComponentSchema,
  rateMinorDecimal: z.string().regex(/^\d+\.\d{6}$/),
  decimalPrecision: z.literal(metricDecimalPrecision),
  roundingPolicy: z.literal("half_up"),
});

const unavailableCostMetricSchema = metricContextSchema.extend({
  metric: z.enum(["cpc", "cpqw", "cpa"]),
  definition: z.string().min(1),
  status: z.literal("not_available"),
  reason: z.enum([
    "spend_not_available",
    "qualified_clicks_not_available",
    "qualified_wallets_not_available",
    "activated_wallets_not_available",
    "no_qualified_clicks",
    "no_qualified_wallets",
    "no_activated_wallets",
  ]),
  numerator: moneyComponentSchema,
  denominator: countComponentSchema,
});

export const costMetricResultSchema = z.discriminatedUnion("status", [
  availableCostMetricSchema,
  unavailableCostMetricSchema,
]);

const excludedRevenueSchema = z.strictObject({
  indicativeMinor: minorIntegerSchema,
  unattributedMinor: minorIntegerSchema,
  sourceRevenueEvidenceIds: z.array(evidenceIdSchema),
  attributionEvidenceIds: z.array(evidenceIdSchema),
});

const availableRoasMetricSchema = metricContextSchema.extend({
  metric: z.literal("revenue_roas"),
  definition: z.literal(
    "Attributable protocol revenue / eligible campaign spend",
  ),
  status: z.literal("available"),
  numerator: availableRevenueComponentSchema,
  denominator: availableMoneyComponentSchema,
  ratioDecimal: z.string().regex(/^\d+\.\d{6}$/),
  decimalPrecision: z.literal(metricDecimalPrecision),
  roundingPolicy: z.literal("half_up"),
  excludedAttributionRevenue: excludedRevenueSchema,
});

const unavailableRoasMetricSchema = metricContextSchema.extend({
  metric: z.literal("revenue_roas"),
  definition: z.literal(
    "Attributable protocol revenue / eligible campaign spend",
  ),
  status: z.literal("not_available"),
  reason: z.enum([
    "spend_not_available",
    "revenue_not_available",
    "no_eligible_spend",
  ]),
  numerator: moneyComponentSchema,
  denominator: moneyComponentSchema,
  excludedAttributionRevenue: excludedRevenueSchema.nullable(),
});

export const revenueRoasMetricResultSchema = z.discriminatedUnion("status", [
  availableRoasMetricSchema,
  unavailableRoasMetricSchema,
]);

export const campaignMetricSnapshotSchema = z
  .strictObject({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    campaignId: z.uuid(),
    calculationVersion: z.literal(metricCalculationVersion),
    metrics: z.strictObject({
      cpc: costMetricResultSchema,
      cpqw: costMetricResultSchema,
      cpa: costMetricResultSchema,
      revenueRoas: revenueRoasMetricResultSchema,
    }),
  })
  .superRefine((snapshot, context) => {
    for (const [slot, expected] of [
      ["cpc", "cpc"],
      ["cpqw", "cpqw"],
      ["cpa", "cpa"],
    ] as const) {
      if (snapshot.metrics[slot].metric !== expected) {
        context.addIssue({
          code: "custom",
          message: `${slot} metric slot must contain ${expected}`,
          path: ["metrics", slot, "metric"],
        });
      }
    }
  });

export type CampaignMetricSnapshot = z.infer<
  typeof campaignMetricSnapshotSchema
>;

const metricDefinitions = {
  cpc: "Eligible campaign spend / qualified clicks",
  cpqw: "Eligible campaign spend / qualified wallets",
  cpa: "Eligible campaign spend / customer-defined activated wallets",
} as const;

function sumMinor(values: string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

function sorted(values: string[]) {
  return [...values].sort();
}

function divideDecimal(
  numerator: string,
  denominator: string,
  precision = metricDecimalPrecision,
) {
  const numeratorValue = BigInt(numerator);
  const denominatorValue = BigInt(denominator);
  if (denominatorValue <= 0n) throw new Error("Denominator must be positive");
  const scale = 10n ** BigInt(precision);
  const scaled = numeratorValue * scale;
  let quotient = scaled / denominatorValue;
  const remainder = scaled % denominatorValue;
  if (remainder * 2n >= denominatorValue) quotient += 1n;
  const digits = quotient.toString().padStart(precision + 1, "0");
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

function spendComponent(input: MetricSnapshotInput) {
  if (input.spend.status === "not_available") {
    return {
      status: "not_available" as const,
      kind: "eligible_campaign_spend_minor" as const,
      reason: input.spend.reason,
    };
  }
  const included = input.spend.lines.filter(
    (line) => line.inclusion === "included",
  );
  return {
    status: "available" as const,
    kind: "eligible_campaign_spend_minor" as const,
    valueMinor: sumMinor(included.map((line) => line.amountMinor)),
    evidenceIds: sorted(included.map((line) => line.sourceEvidenceId)),
  };
}

function excludedSpend(input: MetricSnapshotInput) {
  if (input.spend.status === "not_available") {
    return { status: "not_available" as const, reason: input.spend.reason };
  }
  const excluded = input.spend.lines.filter(
    (line) => line.inclusion === "excluded",
  );
  return {
    status: "available" as const,
    valueMinor: sumMinor(excluded.map((line) => line.amountMinor)),
    evidenceIds: sorted(excluded.map((line) => line.sourceEvidenceId)),
  };
}

function countComponent(
  input: z.infer<typeof metricCountInputSchema>,
  kind:
    | "qualified_click_count"
    | "qualified_wallet_count"
    | "activated_wallet_count",
) {
  if (input.status === "not_available") {
    return { status: "not_available" as const, kind, reason: input.reason };
  }
  return {
    status: "available" as const,
    kind,
    value: input.evidenceIds.length,
    evidenceIds: sorted(input.evidenceIds),
  };
}

function metricContext(
  input: MetricSnapshotInput,
  includedAttributionConfidence: Array<z.infer<typeof confidenceSchema>>,
) {
  return {
    calculationVersion: metricCalculationVersion,
    currencyCode: input.currencyCode,
    valuationPolicy: input.valuationPolicy,
    conversionRuleVersionIds: sorted(input.conversionRuleVersionIds),
    attributionClassifierVersion: input.attributionClassifierVersion,
    includedAttributionConfidence,
    sourceTimeRange: input.sourceTimeRange,
    dataFreshness: input.dataFreshness,
    activationDefinition: input.activationDefinition,
    excludedSpend: excludedSpend(input),
  } as const;
}

function costMetric(
  input: MetricSnapshotInput,
  metric: "cpc" | "cpqw" | "cpa",
  denominator: ReturnType<typeof countComponent>,
) {
  const numerator = spendComponent(input);
  const context = metricContext(input, []);
  const definition = metricDefinitions[metric];
  if (numerator.status === "not_available") {
    return costMetricResultSchema.parse({
      ...context,
      metric,
      definition,
      status: "not_available",
      reason: "spend_not_available",
      numerator,
      denominator,
    });
  }
  if (denominator.status === "not_available") {
    return costMetricResultSchema.parse({
      ...context,
      metric,
      definition,
      status: "not_available",
      reason:
        metric === "cpc"
          ? "qualified_clicks_not_available"
          : metric === "cpqw"
            ? "qualified_wallets_not_available"
            : "activated_wallets_not_available",
      numerator,
      denominator,
    });
  }
  if (denominator.value === 0) {
    return costMetricResultSchema.parse({
      ...context,
      metric,
      definition,
      status: "not_available",
      reason:
        metric === "cpc"
          ? "no_qualified_clicks"
          : metric === "cpqw"
            ? "no_qualified_wallets"
            : "no_activated_wallets",
      numerator,
      denominator,
    });
  }
  return costMetricResultSchema.parse({
    ...context,
    metric,
    definition,
    status: "available",
    numerator,
    denominator,
    rateMinorDecimal: divideDecimal(
      numerator.valueMinor,
      denominator.value.toString(),
    ),
    decimalPrecision: metricDecimalPrecision,
    roundingPolicy: "half_up",
  });
}

function revenueComponents(input: MetricSnapshotInput) {
  if (input.protocolRevenue.status === "not_available") {
    return {
      numerator: {
        status: "not_available" as const,
        kind: "protocol_revenue_minor" as const,
        reason: input.protocolRevenue.reason,
      },
      excluded: null,
    };
  }
  const included = input.protocolRevenue.lines.filter(
    (line) => line.confidence === "verified" || line.confidence === "strong",
  );
  const indicative = input.protocolRevenue.lines.filter(
    (line) => line.confidence === "indicative",
  );
  const unattributed = input.protocolRevenue.lines.filter(
    (line) => line.confidence === "unattributed",
  );
  return {
    numerator: {
      status: "available" as const,
      kind: "protocol_revenue_minor" as const,
      valueMinor: sumMinor(included.map((line) => line.protocolRevenueMinor)),
      sourceRevenueEvidenceIds: sorted(
        included.map((line) => line.sourceRevenueEvidenceId),
      ),
      attributionEvidenceIds: sorted(
        included.map((line) => line.attributionEvidenceId),
      ),
    },
    excluded: {
      indicativeMinor: sumMinor(
        indicative.map((line) => line.protocolRevenueMinor),
      ),
      unattributedMinor: sumMinor(
        unattributed.map((line) => line.protocolRevenueMinor),
      ),
      sourceRevenueEvidenceIds: sorted(
        [...indicative, ...unattributed].map(
          (line) => line.sourceRevenueEvidenceId,
        ),
      ),
      attributionEvidenceIds: sorted(
        [...indicative, ...unattributed].map(
          (line) => line.attributionEvidenceId,
        ),
      ),
    },
  };
}

function revenueRoas(input: MetricSnapshotInput) {
  const denominator = spendComponent(input);
  const { numerator, excluded } = revenueComponents(input);
  const context = metricContext(input, ["verified", "strong"]);
  const base = {
    ...context,
    metric: "revenue_roas" as const,
    definition:
      "Attributable protocol revenue / eligible campaign spend" as const,
    numerator,
    denominator,
    excludedAttributionRevenue: excluded,
  };
  if (denominator.status === "not_available") {
    return revenueRoasMetricResultSchema.parse({
      ...base,
      status: "not_available",
      reason: "spend_not_available",
    });
  }
  if (numerator.status === "not_available") {
    return revenueRoasMetricResultSchema.parse({
      ...base,
      status: "not_available",
      reason: "revenue_not_available",
    });
  }
  if (denominator.valueMinor === "0") {
    return revenueRoasMetricResultSchema.parse({
      ...base,
      status: "not_available",
      reason: "no_eligible_spend",
    });
  }
  return revenueRoasMetricResultSchema.parse({
    ...base,
    status: "available",
    ratioDecimal: divideDecimal(numerator.valueMinor, denominator.valueMinor),
    decimalPrecision: metricDecimalPrecision,
    roundingPolicy: "half_up",
  });
}

export function computeCampaignMetrics(
  rawInput: MetricSnapshotInput,
): CampaignMetricSnapshot {
  const input = metricSnapshotInputSchema.parse(rawInput);
  return campaignMetricSnapshotSchema.parse({
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    campaignId: input.campaignId,
    calculationVersion: metricCalculationVersion,
    metrics: {
      cpc: costMetric(
        input,
        "cpc",
        countComponent(input.qualifiedClicks, "qualified_click_count"),
      ),
      cpqw: costMetric(
        input,
        "cpqw",
        countComponent(input.qualifiedWallets, "qualified_wallet_count"),
      ),
      cpa: costMetric(
        input,
        "cpa",
        countComponent(input.activatedWallets, "activated_wallet_count"),
      ),
      revenueRoas: revenueRoas(input),
    },
  });
}

const creatorEconomicsSpendSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    valueMinor: minorIntegerSchema,
    evidenceIds: z.array(evidenceIdSchema).max(1_000),
    evidenceLines: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: z.literal("creator_compensation"),
          valueMinor: minorIntegerSchema,
          currencyCode: z.string().regex(/^[A-Z]{3}$/),
        }),
      )
      .max(1_000),
  }),
  z.strictObject({
    status: z.literal("not_available"),
    reason: metricUnavailableSourceReasonSchema,
  }),
]);

const creatorEconomicsAttributionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    evidenceIds: z.array(z.uuid()).max(10_000),
  }),
  z.strictObject({
    status: z.literal("not_available"),
    reason: metricUnavailableSourceReasonSchema,
  }),
]);

const creatorEconomicsPublicationEvidenceSchema = z
  .strictObject({
    platform: z.enum(["x", "instagram", "tiktok", "youtube", "other"]),
    publishedUrl: z.url(),
    publishedAt: z.iso.datetime(),
    thumbnailStatus: z.enum(["available", "not_available"]),
    thumbnailUrl: z.url().nullable(),
    thumbnailUnavailableReason: z.string().min(1).max(120).nullable(),
    sourceLabel: z.string().min(1).max(160),
    observedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .refine(
    (evidence) =>
      (evidence.thumbnailStatus === "available" &&
        evidence.thumbnailUrl !== null &&
        evidence.thumbnailUnavailableReason === null) ||
      (evidence.thumbnailStatus === "not_available" &&
        evidence.thumbnailUrl === null &&
        evidence.thumbnailUnavailableReason !== null),
    { message: "Publication thumbnail status must match retained evidence" },
  );

const creatorEconomicsContentAssetSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().min(1).max(240),
  status: z.enum([
    "planned",
    "draft",
    "submitted",
    "revision_requested",
    "approved",
    "published",
  ]),
  publishedUrl: z.url().nullable(),
  publicationEvidence: creatorEconomicsPublicationEvidenceSchema.nullable(),
});

const creatorEconomicsCreatorSchema = z.strictObject({
  creatorId: z.uuid(),
  creatorName: z.string().min(1).max(120),
  creatorHandle: z.string().min(1).max(120).nullable(),
  package: commercialPlanSnapshotPackageSchema,
  qualifiedAttributionIds: z.array(z.uuid()).max(10_000),
  activatedAttributionIds: z.array(z.uuid()).max(10_000),
  confidence: confidenceSchema.nullable(),
  contentAssets: z.array(creatorEconomicsContentAssetSchema).max(100),
});

export const creatorEconomicsInputSchema = z
  .strictObject({
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    eligibleSpend: creatorEconomicsSpendSchema,
    qualifiedAttribution: creatorEconomicsAttributionSchema,
    activatedAttribution: creatorEconomicsAttributionSchema,
    creators: z.array(creatorEconomicsCreatorSchema).max(1_000),
  })
  .superRefine((input, context) => {
    const creatorIds = input.creators.map((creator) => creator.creatorId);
    if (new Set(creatorIds).size !== creatorIds.length) {
      context.addIssue({
        code: "custom",
        message: "Creator economics identities must be unique",
        path: ["creators"],
      });
    }

    if (input.eligibleSpend.status === "available") {
      const evidenceIds = input.eligibleSpend.evidenceIds;
      const evidenceLineIds = input.eligibleSpend.evidenceLines.map(
        (line) => line.id,
      );
      if (new Set(evidenceIds).size !== evidenceIds.length) {
        context.addIssue({
          code: "custom",
          message: "Spend evidence identities must be unique",
          path: ["eligibleSpend", "evidenceIds"],
        });
      }
      if (
        new Set(evidenceLineIds).size !== evidenceLineIds.length ||
        evidenceLineIds.some((id) => !evidenceIds.includes(id)) ||
        input.eligibleSpend.evidenceLines.some(
          (line) => line.currencyCode !== input.currencyCode,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Creator spend must bind exact approved compensation lines retained in issued spend",
          path: ["eligibleSpend", "evidenceLines"],
        });
      }
      const approvedLines = input.creators.flatMap(
        (creator) => creator.package.compensationLines,
      );
      if (
        input.eligibleSpend.evidenceLines.some((evidenceLine) => {
          const matches = approvedLines.filter(
            (line) => line.id === evidenceLine.id,
          );
          return (
            matches.length !== 1 ||
            matches[0]?.assetType !== "cash" ||
            matches[0].amountMinor !== evidenceLine.valueMinor ||
            matches[0].currencyCode !== evidenceLine.currencyCode
          );
        })
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Creator spend evidence must match one frozen approved compensation line",
          path: ["eligibleSpend", "evidenceLines"],
        });
      }
    }

    for (const [field, retained] of [
      ["qualifiedAttribution", input.qualifiedAttribution],
      ["activatedAttribution", input.activatedAttribution],
    ] as const) {
      const creatorEvidence = input.creators.flatMap((creator) =>
        field === "qualifiedAttribution"
          ? creator.qualifiedAttributionIds
          : creator.activatedAttributionIds,
      );
      if (
        retained.status === "available" &&
        (new Set(creatorEvidence).size !== creatorEvidence.length ||
          [...creatorEvidence].sort().join("\0") !==
            [...retained.evidenceIds].sort().join("\0") ||
          new Set(retained.evidenceIds).size !== retained.evidenceIds.length)
      ) {
        context.addIssue({
          code: "custom",
          message: "Creator attribution must match the issued evidence set",
          path: [field, "evidenceIds"],
        });
      }
      if (retained.status === "not_available" && creatorEvidence.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Unavailable attribution cannot carry creator evidence",
          path: [field],
        });
      }
    }

    input.creators.forEach((creator, index) => {
      const qualifiedIds = new Set(creator.qualifiedAttributionIds);
      if (
        input.qualifiedAttribution.status === "available" &&
        input.activatedAttribution.status === "available" &&
        creator.activatedAttributionIds.some((id) => !qualifiedIds.has(id))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Activated creator attribution must be a subset of qualified attribution",
          path: ["creators", index, "activatedAttributionIds"],
        });
      }
    });
  });

export type CreatorEconomicsInput = z.infer<typeof creatorEconomicsInputSchema>;

export type CreatorEconomicsAllocation =
  | { status: "available"; valueMinor: string }
  | {
      status: "not_available";
      reason:
        | "spend_not_available"
        | "not_included_in_issued_spend"
        | "non_cash_valuation_not_allocated";
    };

export type CreatorEconomicsResult = {
  allocatedSpendMinor: string | null;
  unallocatedSpendMinor: string | null;
  creators: Array<{
    creatorId: string;
    creatorName: string;
    creatorHandle: string | null;
    package: z.infer<typeof commercialPlanSnapshotPackageSchema>;
    contentAssets: z.infer<typeof creatorEconomicsContentAssetSchema>[];
    confidence: z.infer<typeof confidenceSchema> | null;
    qualifiedWallets: number | null;
    activatedWallets: number | null;
    allocation: CreatorEconomicsAllocation;
    cpqwMinorDecimal: string | null;
    cpaMinorDecimal: string | null;
    action:
      | "review_for_renewal"
      | "investigate_conversion"
      | "investigate_delivery"
      | "evidence_unavailable";
  }>;
};

function uniqueCount(values: string[]) {
  return new Set(values).size;
}

function allocatedCashMinor(
  creator: z.infer<typeof creatorEconomicsCreatorSchema>,
  currencyCode: string,
  includedEvidenceIds: Set<string>,
): CreatorEconomicsAllocation {
  const included = creator.package.compensationLines.filter((line) =>
    includedEvidenceIds.has(line.id),
  );
  if (included.length === 0) {
    return {
      status: "not_available",
      reason: "not_included_in_issued_spend",
    };
  }
  if (
    included.some(
      (line) => line.assetType !== "cash" || line.currencyCode !== currencyCode,
    )
  ) {
    return {
      status: "not_available",
      reason: "non_cash_valuation_not_allocated",
    };
  }

  return {
    status: "available",
    valueMinor: included
      .reduce((total, line) => {
        if (line.assetType !== "cash") return total;
        return total + BigInt(line.amountMinor);
      }, 0n)
      .toString(),
  };
}

function exactRateMinor(valueMinor: string, denominator: number) {
  if (denominator === 0) return null;
  return divideDecimal(valueMinor, denominator.toString());
}

export function computeCreatorEconomics(
  rawInput: CreatorEconomicsInput,
): CreatorEconomicsResult {
  const input = creatorEconomicsInputSchema.parse(rawInput);
  const includedEvidenceIds = new Set(
    input.eligibleSpend.status === "available"
      ? input.eligibleSpend.evidenceLines.map((line) => line.id)
      : [],
  );
  let allocatedSpend = 0n;

  const creators = input.creators.map((creator) => {
    const qualifiedWallets =
      input.qualifiedAttribution.status === "available"
        ? uniqueCount(creator.qualifiedAttributionIds)
        : null;
    const activatedWallets =
      input.activatedAttribution.status === "available"
        ? uniqueCount(creator.activatedAttributionIds)
        : null;
    const allocation =
      input.eligibleSpend.status === "available"
        ? allocatedCashMinor(creator, input.currencyCode, includedEvidenceIds)
        : ({
            status: "not_available",
            reason: "spend_not_available",
          } satisfies CreatorEconomicsAllocation);

    if (allocation.status === "available") {
      allocatedSpend += BigInt(allocation.valueMinor);
    }

    return {
      creatorId: creator.creatorId,
      creatorName: creator.creatorName,
      creatorHandle: creator.creatorHandle,
      package: creator.package,
      contentAssets: creator.contentAssets,
      confidence: creator.confidence,
      qualifiedWallets,
      activatedWallets,
      allocation,
      cpqwMinorDecimal:
        allocation.status === "available" && qualifiedWallets !== null
          ? exactRateMinor(allocation.valueMinor, qualifiedWallets)
          : null,
      cpaMinorDecimal:
        allocation.status === "available" && activatedWallets !== null
          ? exactRateMinor(allocation.valueMinor, activatedWallets)
          : null,
      action:
        qualifiedWallets === null || activatedWallets === null
          ? ("evidence_unavailable" as const)
          : activatedWallets > 0
            ? ("review_for_renewal" as const)
            : qualifiedWallets > 0
              ? ("investigate_conversion" as const)
              : ("investigate_delivery" as const),
    };
  });

  if (input.eligibleSpend.status === "available") {
    const totalSpend = BigInt(input.eligibleSpend.valueMinor);
    if (allocatedSpend > totalSpend) {
      throw new RangeError(
        "Creator allocations exceed the issued eligible campaign spend",
      );
    }
    return {
      allocatedSpendMinor: allocatedSpend.toString(),
      unallocatedSpendMinor: (totalSpend - allocatedSpend).toString(),
      creators,
    };
  }

  return {
    allocatedSpendMinor: null,
    unallocatedSpendMinor: null,
    creators,
  };
}
export { retainedReportInstantSchema } from "./report-instants";
export {
  buildContractedCostReview,
  contractedCostReviewSchema,
  type ContractedCostReview,
} from "./contracted-cost-review";
