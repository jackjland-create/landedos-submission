import { z } from "zod";

const text = z.string().trim().min(1).max(1000);
const label = z.string().trim().min(1).max(120);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(80);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Strategy channels are planning vocabulary, not a promise of an integration
// or a replacement for the existing creator-channel database enum.
export const basketStrategyChannelSchema = z.enum([
  "x",
  "linkedin",
  "podcast",
  "newsletter_research",
  "short_form_video",
  "community_livestream",
  "event_webinar",
]);

export const basketArchetypeSchema = z.enum([
  "analyst",
  "founder_operator",
  "sector_specialist",
  "long_form_host",
  "institutional_educator",
  "community_operator",
  "culture_creator",
]);

export const basketAllocationSchema = z.strictObject({
  channel: basketStrategyChannelSchema,
  archetype: basketArchetypeSchema,
  format: label,
  plannedSpendBps: z.number().int().min(1).max(10_000),
  rationale: text,
});

const allocationsSchema = z
  .array(basketAllocationSchema)
  .max(20)
  .superRefine((allocations, context) => {
    // Totals can be incomplete during editing. Assess completeness separately
    // so a saved draft can resume midway through configuring its channel mix.
    const seen = new Set<string>();
    allocations.forEach((row, index) => {
      const identity = `${row.channel}/${row.archetype}/${row.format.toLowerCase()}`;
      if (seen.has(identity)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message:
            "Combine duplicate channel, creator role and format allocations.",
        });
      }
      seen.add(identity);
    });
  });

// These references are proposals. The authenticated server must resolve them
// within the basket's project before any commercial or rule approval.
export const basketMeasurementIntentSchema = z.strictObject({
  primaryOutcome: z.enum(["qualified_wallets", "verified_revenue"]),
  qualifyingAction: text,
  conversionRuleVersionId: z.uuid().nullable(),
  attributionModel: z.literal("last_eligible_touch"),
  attributionWindowDays: z.literal(7),
  leadingIndicators: z.array(label).max(10),
  retentionWindowDays: z.union([z.literal(7), z.literal(30)]).nullable(),
  revenueTreatment: z.literal("verified_protocol_revenue_only"),
});

export const basketStrategyDefinitionSchema = z
  .strictObject({
    goal: text.nullable(),
    audience: text.nullable(),
    sector: label.nullable(),
    rationale: text.nullable(),
    // Omitted for ordinary paid planning and all historical strategies. The
    // explicit exception is authorised only by the devnet approval boundary.
    distributionMode: z.literal("unpaid_private_link").optional(),
    allocations: allocationsSchema,
    measurement: basketMeasurementIntentSchema.nullable(),
    assumptions: z.array(text).max(20),
    missingEvidence: z.array(text).max(20),
    exclusions: z.array(text).max(20),
    rebalanceQuestions: z.array(text).max(10),
  })
  .superRefine((strategy, context) => {
    if (
      strategy.distributionMode === "unpaid_private_link" &&
      strategy.allocations.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "A private-link internal test cannot allocate channel spend.",
      });
    }
  });

export const preparedBasketTemplateSchema = z
  .strictObject({
    key,
    version,
    name: label,
    summary: text,
    provenance: z.strictObject({
      kind: z.literal("editorial_starting_hypothesis"),
      sourceLabel: label,
      reviewedOn: z.iso.date(),
    }),
    strategy: basketStrategyDefinitionSchema,
  })
  .superRefine((template, context) => {
    const { strategy } = template;
    if (strategy.distributionMode) {
      context.addIssue({
        code: "custom",
        path: ["strategy", "distributionMode"],
        message: "Prepared baskets require a planned channel mix.",
      });
    }
    for (const field of [
      "goal",
      "audience",
      "rationale",
      "measurement",
    ] as const) {
      if (strategy[field] === null) {
        context.addIssue({
          code: "custom",
          path: ["strategy", field],
          message: "A prepared basket must define its starting strategy.",
        });
      }
    }
    if (
      strategy.allocations.reduce(
        (sum, row) => sum + row.plannedSpendBps,
        0,
      ) !== 10_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["strategy", "allocations"],
        message:
          "A prepared basket's planned spend allocation must total 100%.",
      });
    }
  });

const creatorSelectionSchema = z
  .array(z.uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A creator can only be selected once.",
  });

export const goalLedBasketDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: label,
  origin: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("prepared"),
      templateKey: key,
      templateVersion: version,
      provenance: preparedBasketTemplateSchema.shape.provenance,
    }),
    z.strictObject({ kind: z.literal("custom") }),
  ]),
  strategy: basketStrategyDefinitionSchema,
  selectedCreatorIds: creatorSelectionSchema,
});

export type GoalLedBasketDraft = z.infer<typeof goalLedBasketDraftSchema>;
export type BasketStrategyDefinition = z.infer<
  typeof basketStrategyDefinitionSchema
>;
export type PreparedBasketTemplate = z.infer<
  typeof preparedBasketTemplateSchema
>;

/** Produces an independent editable copy. Does not create a database record. */
export function draftFromPreparedBasket(
  templateInput: PreparedBasketTemplate,
  selectedCreatorIds: string[] = [],
): GoalLedBasketDraft {
  const template = preparedBasketTemplateSchema.parse(templateInput);
  return goalLedBasketDraftSchema.parse({
    schemaVersion: 1,
    name: template.name,
    origin: {
      kind: "prepared",
      templateKey: template.key,
      templateVersion: template.version,
      provenance: template.provenance,
    },
    strategy: template.strategy,
    selectedCreatorIds,
  });
}

/** Supports both goal-first and creator-first custom drafts without a template. */
export function draftCustomBasket(input: {
  name: string;
  goal?: string;
  audience?: string;
  sector?: string;
  selectedCreatorIds?: string[];
}): GoalLedBasketDraft {
  return goalLedBasketDraftSchema.parse({
    schemaVersion: 1,
    name: input.name,
    origin: { kind: "custom" },
    strategy: {
      goal: input.goal ?? null,
      audience: input.audience ?? null,
      sector: input.sector ?? null,
      rationale: null,
      allocations: [],
      measurement: null,
      assumptions: [],
      missingEvidence: [],
      exclusions: [],
      rebalanceQuestions: [],
    },
    selectedCreatorIds: input.selectedCreatorIds ?? [],
  });
}

export type BasketStrategyBlocker = {
  field:
    | "strategy.goal"
    | "strategy.audience"
    | "strategy.rationale"
    | "strategy.allocations"
    | "strategy.measurement"
    | "strategy.measurement.conversionRuleVersionId"
    | "selectedCreatorIds";
  message: string;
};

/** Completeness only. Never replaces project permissions, rule validation,
 * package pricing, delivery checks or the immutable commercial approval. */
export function assessBasketStrategy(draftInput: GoalLedBasketDraft) {
  const draft = goalLedBasketDraftSchema.parse(draftInput);
  const blockers: BasketStrategyBlocker[] = [];
  const { strategy } = draft;
  if (!strategy.goal)
    blockers.push({
      field: "strategy.goal",
      message: "Define the business goal this basket should support.",
    });
  if (!strategy.audience)
    blockers.push({
      field: "strategy.audience",
      message: "Describe the audience you need to reach.",
    });
  if (!strategy.rationale)
    blockers.push({
      field: "strategy.rationale",
      message: "Explain why this channel and creator mix fits the goal.",
    });
  if (
    strategy.distributionMode !== "unpaid_private_link" &&
    strategy.allocations.length === 0
  )
    blockers.push({
      field: "strategy.allocations",
      message: "Allocate planned spend across channels and creator roles.",
    });
  else if (
    strategy.distributionMode !== "unpaid_private_link" &&
    strategy.allocations.reduce((sum, row) => sum + row.plannedSpendBps, 0) !==
      10_000
  )
    blockers.push({
      field: "strategy.allocations",
      message: "Adjust planned spend allocation to total 100% before review.",
    });
  if (!strategy.measurement)
    blockers.push({
      field: "strategy.measurement",
      message: "Define the qualifying action and how it will be measured.",
    });
  else if (!strategy.measurement.conversionRuleVersionId)
    blockers.push({
      field: "strategy.measurement.conversionRuleVersionId",
      message: "Choose a project conversion definition before approval review.",
    });
  if (draft.selectedCreatorIds.length === 0)
    blockers.push({
      field: "selectedCreatorIds",
      message: "Choose the creators who will deliver this basket.",
    });
  return {
    status: blockers.length ? ("incomplete" as const) : ("defined" as const),
    blockers,
    // Stays mandatory even when every field is populated.
    nextGate: "project_rules_and_commercial_review" as const,
  };
}
