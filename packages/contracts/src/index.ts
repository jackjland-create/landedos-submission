import { z } from "zod";
import { campaignTimingProposalSchema } from "./campaign-timing";
import {
  basketStrategyDefinitionSchema,
  goalLedBasketDraftSchema,
} from "./basket-strategy";

export * from "./basket-strategy";
export * from "./prepared-baskets";
export * from "./basket-persistence";

export const navigationSectionSchema = z.enum([
  "overview",
  "kols",
  "baskets",
  "campaigns",
  "reports",
]);

export type NavigationSection = z.infer<typeof navigationSectionSchema>;

export const confidenceSchema = z.enum([
  "verified",
  "strong",
  "indicative",
  "unattributed",
]);

export type AttributionConfidence = z.infer<typeof confidenceSchema>;

const conversionBase58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function conversionAddressByteLength(value: string) {
  let decoded = 0n;
  for (const character of value) {
    const digit = conversionBase58Alphabet.indexOf(character);
    if (digit < 0) return -1;
    decoded = decoded * 58n + BigInt(digit);
  }
  let significantBytes = 0;
  while (decoded > 0n) {
    significantBytes += 1;
    decoded >>= 8n;
  }
  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === "1") leadingZeroBytes += 1;
  return leadingZeroBytes + significantBytes;
}

const conversionProgramAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .refine((value) => conversionAddressByteLength(value) === 32, {
    message: "Solana programme addresses must decode to 32 bytes",
  });

export const conversionRuleTemplateSchema = z.enum([
  "wallet_connected",
  "first_qualifying_transaction",
  "programme_action",
]);

export type ConversionRuleTemplate = z.infer<
  typeof conversionRuleTemplateSchema
>;

export const conversionRuleEvidenceCapabilitySchema = z.enum([
  "ready",
  "requires_programme_decoder",
]);

export type ConversionRuleEvidenceCapability = z.infer<
  typeof conversionRuleEvidenceCapabilitySchema
>;

export const conversionRuleVersionRecordSchema = z
  .strictObject({
    id: z.uuid(),
    ruleId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    version: z.number().int().positive(),
    templateCode: conversionRuleTemplateSchema,
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().min(12).max(600),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime().nullable(),
    chain: z.literal("solana"),
    requiresWalletBinding: z.literal(true),
    minimumFinality: z.enum(["finalized", "not_applicable"]),
    valueMapping: z.enum(["none", "transfer_amount"]),
    revenueMapping: z.literal("none"),
    attributionWindowSeconds: z.literal(604_800),
    attributionModel: z.literal("last_eligible_creator_touch"),
    programId: conversionProgramAddressSchema.nullable(),
    eventDiscriminator: z.string().trim().min(1).max(120).nullable(),
    evidenceCapability: conversionRuleEvidenceCapabilitySchema,
    configuredEnvironment: z
      .enum(["demo", "devnet", "mainnet"])
      .nullable()
      .optional(),
    destinationAddress: conversionProgramAddressSchema.nullable().optional(),
    nativeAmountLamports: z.string().regex(/^\d+$/).nullable().optional(),
    changeReason: z.string().trim().min(8).max(240),
    createdBy: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((version, context) => {
    if (
      version.effectiveUntil &&
      new Date(version.effectiveUntil) <= new Date(version.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "The effective end must follow the effective start",
        path: ["effectiveUntil"],
      });
    }

    const isProgrammeAction = version.templateCode === "programme_action";
    if (
      isProgrammeAction !==
      (version.programId !== null && version.eventDiscriminator !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Programme actions require an exact programme and action label",
        path: ["programId"],
      });
    }

    if (
      isProgrammeAction !==
      (version.evidenceCapability === "requires_programme_decoder")
    ) {
      context.addIssue({
        code: "custom",
        message: "Programme evidence readiness is inconsistent",
        path: ["evidenceCapability"],
      });
    }

    const destinationBound =
      version.configuredEnvironment != null ||
      version.destinationAddress != null ||
      version.nativeAmountLamports != null;
    if (
      destinationBound &&
      (version.templateCode !== "first_qualifying_transaction" ||
        version.configuredEnvironment !== "devnet" ||
        version.destinationAddress == null ||
        version.nativeAmountLamports !== "1")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Destination-bound campaign responses require devnet, one recipient and exactly one lamport",
        path: ["configuredEnvironment"],
      });
    }
  });

export type ConversionRuleVersionRecord = z.infer<
  typeof conversionRuleVersionRecordSchema
>;

export const conversionRuleRecordSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  stableKey: z.literal("primary-outcome"),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  versions: z.array(conversionRuleVersionRecordSchema),
});

export type ConversionRuleRecord = z.infer<typeof conversionRuleRecordSchema>;

export const conversionReplayRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const conversionReplayJobRecordSchema = z.strictObject({
  id: z.uuid(),
  ruleId: z.uuid(),
  ruleVersionId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  status: z.literal("pending"),
  affectedCampaignCount: z.number().int().nonnegative(),
  eligibleCampaignCount: z.number().int().nonnegative(),
  requestedBy: z.uuid(),
  requestedAt: z.iso.datetime(),
  execution: z
    .strictObject({
      id: z.uuid(),
      status: conversionReplayRunStatusSchema,
      approvedAt: z.iso.datetime(),
      sourceStartedAt: z.iso.datetime(),
      sourceEndedAt: z.iso.datetime(),
      candidateCount: z.number().int().nonnegative(),
      matchedCount: z.number().int().nonnegative(),
      unmatchedCount: z.number().int().nonnegative(),
      reportCount: z.number().int().nonnegative(),
      failureCode: z.string().nullable(),
      comparisons: z.array(
        z.strictObject({
          campaignId: z.uuid(),
          campaignName: z.string().min(1).max(120),
          status: z.enum(["queued", "running", "completed", "failed"]),
          baselineVersion: z.number().int().positive(),
          reportId: z.uuid(),
          replayVersion: z.number().int().positive().nullable(),
        }),
      ),
    })
    .nullable(),
});

export type ConversionReplayJobRecord = z.infer<
  typeof conversionReplayJobRecordSchema
>;

export const approveConversionReplayInputSchema = z
  .strictObject({
    replayJobId: z.uuid(),
    replayRunId: z.uuid(),
    approvalRequestId: z.uuid(),
    approvalReason: z.string().trim().min(8).max(240),
  })
  .superRefine((input, context) => {
    const identities = [
      input.replayJobId,
      input.replayRunId,
      input.approvalRequestId,
    ];
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: "custom",
        message: "Replay approval identities must be distinct",
        path: ["replayRunId"],
      });
    }
  });

export type ApproveConversionReplayInput = z.infer<
  typeof approveConversionReplayInputSchema
>;

export const approveConversionReplayResponseSchema = z.strictObject({
  replay: z.strictObject({
    id: z.uuid(),
    status: z.literal("queued"),
    approved: z.boolean(),
    campaignCount: z.number().int().positive(),
    sourceStartedAt: z.iso.datetime(),
    sourceEndedAt: z.iso.datetime(),
  }),
});

export const configureConversionRuleInputSchema = z
  .strictObject({
    ruleId: z.uuid(),
    ruleVersionId: z.uuid(),
    changeRequestId: z.uuid(),
    templateCode: conversionRuleTemplateSchema,
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().min(12).max(600),
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveUntil: z.iso.datetime({ offset: true }).nullable(),
    programId: conversionProgramAddressSchema.nullable(),
    eventDiscriminator: z.string().trim().min(1).max(120).nullable(),
    configuredEnvironment: z
      .enum(["demo", "devnet", "mainnet"])
      .nullable()
      .optional(),
    destinationAddress: conversionProgramAddressSchema.nullable().optional(),
    nativeAmountLamports: z.string().regex(/^\d+$/).nullable().optional(),
    changeReason: z.string().trim().min(8).max(240),
  })
  .superRefine((input, context) => {
    if (
      input.effectiveUntil &&
      new Date(input.effectiveUntil) <= new Date(input.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "The effective end must follow the effective start",
        path: ["effectiveUntil"],
      });
    }

    const isProgrammeAction = input.templateCode === "programme_action";
    if (isProgrammeAction && input.programId === null) {
      context.addIssue({
        code: "custom",
        message: "Programme actions require a Solana programme address",
        path: ["programId"],
      });
    }
    if (isProgrammeAction && input.eventDiscriminator === null) {
      context.addIssue({
        code: "custom",
        message: "Programme actions require a plain-language action label",
        path: ["eventDiscriminator"],
      });
    }
    if (!isProgrammeAction && input.programId !== null) {
      context.addIssue({
        code: "custom",
        message: "This template does not accept a programme address",
        path: ["programId"],
      });
    }
    if (!isProgrammeAction && input.eventDiscriminator !== null) {
      context.addIssue({
        code: "custom",
        message: "This template does not accept an action label",
        path: ["eventDiscriminator"],
      });
    }

    const destinationBound =
      input.configuredEnvironment != null ||
      input.destinationAddress != null ||
      input.nativeAmountLamports != null;
    if (
      (input.templateCode === "first_qualifying_transaction" &&
        (input.configuredEnvironment !== "devnet" ||
          input.destinationAddress == null ||
          input.nativeAmountLamports !== "1")) ||
      (input.templateCode !== "first_qualifying_transaction" &&
        destinationBound)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Destination-bound campaign responses require devnet, one recipient and exactly one lamport",
        path: ["configuredEnvironment"],
      });
    }
  });

export type ConfigureConversionRuleInput = z.infer<
  typeof configureConversionRuleInputSchema
>;

export const campaignStatusSchema = z.enum([
  "draft",
  "approved",
  "live",
  "finalizing",
  "finalized",
]);

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const creatorDecisionSchema = z.enum(["renew", "review", "stop"]);

export type CreatorDecision = z.infer<typeof creatorDecisionSchema>;

export const metricSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  detail: z.string().optional(),
  tone: z
    .enum(["default", "verified", "forecast", "action"])
    .default("default"),
});

export type Metric = z.infer<typeof metricSchema>;

export const creatorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().min(1),
  channel: z.string().min(1),
  topicFit: z.number().min(0).max(100),
  packageRateMinor: z.bigint().nonnegative(),
  historicCpqwMinor: z.bigint().nonnegative().nullable(),
  qualifiedWallets: z.number().int().nonnegative(),
  decision: creatorDecisionSchema,
});

export type Creator = z.infer<typeof creatorSchema>;

export const creatorRelationshipStatusSchema = z.enum([
  "prospect",
  "active",
  "paused",
]);

export type CreatorRelationshipStatus = z.infer<
  typeof creatorRelationshipStatusSchema
>;

export const creatorChannelTypeSchema = z.enum([
  "x",
  "youtube",
  "tiktok",
  "instagram",
  "podcast",
  "telegram",
  "discord",
  "other",
]);

export type CreatorChannelType = z.infer<typeof creatorChannelTypeSchema>;

const httpUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: "Profile URL must use HTTP or HTTPS",
});

export const creatorChannelRecordSchema = z.object({
  id: z.uuid(),
  type: creatorChannelTypeSchema,
  handle: z.string().min(1).max(120),
  profileUrl: httpUrlSchema.nullable(),
  languageCode: z.string().min(2).max(5).nullable(),
  audienceSize: z.number().int().nonnegative().nullable(),
  observedAt: z.iso.datetime().nullable(),
  sourceLabel: z.string().min(1).nullable(),
  isPrimary: z.boolean(),
});

export type CreatorChannelRecord = z.infer<typeof creatorChannelRecordSchema>;

export const creatorTagRecordSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(60),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export type CreatorTagRecord = z.infer<typeof creatorTagRecordSchema>;

export const creatorRateQuoteRecordSchema = z.object({
  id: z.uuid(),
  packageLabel: z.string().min(1).max(120),
  deliverableSummary: z.string().min(1).max(240),
  amountMinor: z.string().regex(/^\d+$/),
  currencyCode: z.enum(["GBP", "USD", "EUR"]),
  quotedAt: z.iso.datetime(),
  validUntil: z.iso.datetime().nullable(),
  sourceLabel: z.string().min(1).max(160),
});

export type CreatorRateQuoteRecord = z.infer<
  typeof creatorRateQuoteRecordSchema
>;

export const creatorContactRecordSchema = z.object({
  id: z.uuid(),
  contactName: z.string().min(1).max(120),
  contactRole: z.string().min(1).max(120).nullable(),
  email: z
    .string()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  observedAt: z.iso.datetime(),
  sourceLabel: z.string().min(1).max(160),
});

export type CreatorContactRecord = z.infer<typeof creatorContactRecordSchema>;

export const creatorContactAccessSchema = z.enum([
  "available",
  "missing",
  "restricted",
]);

export type CreatorContactAccess = z.infer<typeof creatorContactAccessSchema>;

export const creatorDirectoryRecordSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  displayName: z.string().min(1).max(120),
  relationshipStatus: creatorRelationshipStatusSchema,
  countryCode: z.string().length(2).nullable(),
  languageCodes: z.array(z.string().min(2).max(5)),
  channels: z.array(creatorChannelRecordSchema),
  tags: z.array(creatorTagRecordSchema),
  currentRate: creatorRateQuoteRecordSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CreatorDirectoryRecord = z.infer<
  typeof creatorDirectoryRecordSchema
>;

export const creatorEvidenceRecordSchema = creatorDirectoryRecordSchema
  .extend({
    profileSummary: z.string().min(1).max(1200).nullable(),
    profileObservedAt: z.iso.datetime().nullable(),
    profileSourceLabel: z.string().min(1).max(160).nullable(),
    contactAccess: creatorContactAccessSchema,
    contact: creatorContactRecordSchema.nullable(),
    rateQuotes: z.array(creatorRateQuoteRecordSchema),
  })
  .superRefine((value, context) => {
    const profileEvidenceFields = [
      value.profileSummary,
      value.profileObservedAt,
      value.profileSourceLabel,
    ];
    const populatedFieldCount = profileEvidenceFields.filter(
      (field) => field !== null,
    ).length;

    if (populatedFieldCount !== 0 && populatedFieldCount !== 3) {
      context.addIssue({
        code: "custom",
        message: "Profile evidence must include summary, date and source",
        path: ["profileSummary"],
      });
    }
  });

export type CreatorEvidenceRecord = z.infer<typeof creatorEvidenceRecordSchema>;

export const basketScenarioCodeSchema = z.enum(["A", "B", "C"]);

export type BasketScenarioCode = z.infer<typeof basketScenarioCodeSchema>;

export const compensationAssetSchema = z.enum(["cash", "usdc", "token"]);

export type CompensationAsset = z.infer<typeof compensationAssetSchema>;

export const compensationModelSchema = z.enum(["fixed", "variable"]);

export type CompensationModel = z.infer<typeof compensationModelSchema>;

export const compensationCurrencySchema = z.enum(["GBP", "USD", "EUR"]);

export type CompensationCurrency = z.infer<typeof compensationCurrencySchema>;

const decimalAmountSchema = z
  .string()
  .max(96)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a positive decimal amount")
  .refine((value) => /[1-9]/.test(value), "Amount must be greater than zero");

const usdUnitPriceSchema = decimalAmountSchema.refine(
  (value) => (value.split(".")[1]?.length ?? 0) <= 18,
  "USD unit price supports up to 18 decimal places",
);

const compensationLineInputBaseSchema = z.object({
  model: compensationModelSchema,
  variableUnit: z.string().trim().min(1).max(80).nullable(),
});

const cashCompensationLineInputSchema = compensationLineInputBaseSchema.extend({
  assetType: z.literal("cash"),
  amount: decimalAmountSchema,
  currencyCode: compensationCurrencySchema,
});

const tokenCompensationLineInputSchema = compensationLineInputBaseSchema.extend(
  {
    assetType: z.enum(["usdc", "token"]),
    amount: decimalAmountSchema,
    tokenMint: z
      .string()
      .regex(
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
        "Enter a valid Solana token mint",
      ),
    tokenDecimals: z.number().int().min(0).max(18),
    unitPriceUsd: usdUnitPriceSchema,
    priceSource: z.string().trim().min(1).max(160),
    valuedAt: z.iso.datetime(),
  },
);

export const compensationLineInputSchema = z
  .discriminatedUnion("assetType", [
    cashCompensationLineInputSchema,
    tokenCompensationLineInputSchema,
  ])
  .superRefine((line, context) => {
    if (line.model === "variable" && line.variableUnit === null) {
      context.addIssue({
        code: "custom",
        message: "Variable compensation requires a unit",
        path: ["variableUnit"],
      });
    }

    if (line.model === "fixed" && line.variableUnit !== null) {
      context.addIssue({
        code: "custom",
        message: "Fixed compensation cannot include a variable unit",
        path: ["variableUnit"],
      });
    }
  });

export type CompensationLineInput = z.infer<typeof compensationLineInputSchema>;

const compensationLineRecordBaseSchema = z.object({
  id: z.uuid(),
  model: compensationModelSchema,
  variableUnit: z.string().min(1).max(80).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const cashCompensationLineRecordSchema =
  compensationLineRecordBaseSchema.extend({
    assetType: z.literal("cash"),
    amountMinor: z.string().regex(/^\d+$/),
    currencyCode: compensationCurrencySchema,
  });

const tokenCompensationLineRecordSchema =
  compensationLineRecordBaseSchema.extend({
    assetType: z.enum(["usdc", "token"]),
    tokenMint: z.string().min(32).max(44),
    tokenAmountRaw: z.string().regex(/^\d+$/),
    tokenDecimals: z.number().int().min(0).max(18),
    unitPriceUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
    priceSource: z.string().min(1).max(160),
    valuedAt: z.iso.datetime(),
  });

export const compensationLineRecordSchema = z.discriminatedUnion("assetType", [
  cashCompensationLineRecordSchema,
  tokenCompensationLineRecordSchema,
]);

export type CompensationLineRecord = z.infer<
  typeof compensationLineRecordSchema
>;

export const packageCommercialBasisSchema = z.enum([
  "compensated",
  "unpaid_internal_test",
]);

export type PackageCommercialBasis = z.infer<
  typeof packageCommercialBasisSchema
>;

const packageChannelIdsSchema = z
  .array(z.uuid())
  .max(20)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Choose each channel once.",
  );
const packageDeliveryDeadlineSchema = z.iso
  .datetime({ precision: undefined })
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value),
    "Use an exact UTC deadline.",
  )
  .nullable();
const packageUsageRightsSchema = z.string().trim().min(1).max(1000).nullable();
const packageExclusivitySchema = z.string().trim().min(1).max(1000).nullable();

const packageCommercialDetailInputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  channelIds: packageChannelIdsSchema,
  deliveryDeadline: packageDeliveryDeadlineSchema,
  usageRights: packageUsageRightsSchema,
  exclusivity: packageExclusivitySchema,
});

const packageCommercialDetailInputV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    channelIds: packageChannelIdsSchema,
    deliveryDeadline: packageDeliveryDeadlineSchema,
    usageRights: packageUsageRightsSchema,
    exclusivity: packageExclusivitySchema,
    commercialBasis: packageCommercialBasisSchema,
    unpaidReason: z.string().trim().min(1).max(240).nullable(),
  })
  .superRefine((detail, context) => {
    if (
      detail.commercialBasis === "compensated" &&
      detail.unpaidReason !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Paid compensation cannot include an unpaid reason.",
        path: ["unpaidReason"],
      });
    }

    if (
      detail.commercialBasis === "unpaid_internal_test" &&
      detail.unpaidReason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Explain why this internal test is unpaid.",
        path: ["unpaidReason"],
      });
    }
  });

export const packageCommercialDetailInputSchema = z.discriminatedUnion(
  "schemaVersion",
  [packageCommercialDetailInputV1Schema, packageCommercialDetailInputV2Schema],
);

const retainedPackageCommercialDetailV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  creatorDisplayName: z.string().min(1).max(120),
  channels: z
    .array(
      z.strictObject({
        id: z.uuid(),
        channelType: creatorChannelTypeSchema,
        handle: z.string().min(1).max(120),
      }),
    )
    .max(20)
    .refine(
      (channels) => new Set(channels.map((c) => c.id)).size === channels.length,
    ),
  deliveryDeadline: packageDeliveryDeadlineSchema,
  usageRights: packageUsageRightsSchema,
  exclusivity: packageExclusivitySchema,
});

const retainedPackageCommercialDetailV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    revision: z.number().int().positive(),
    creatorDisplayName: z.string().min(1).max(120),
    channels: retainedPackageCommercialDetailV1Schema.shape.channels,
    deliveryDeadline: packageDeliveryDeadlineSchema,
    usageRights: packageUsageRightsSchema,
    exclusivity: packageExclusivitySchema,
    commercialBasis: packageCommercialBasisSchema,
    unpaidReason: z.string().trim().min(1).max(240).nullable(),
  })
  .superRefine((detail, context) => {
    if (
      detail.commercialBasis === "compensated" &&
      detail.unpaidReason !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Paid compensation cannot include an unpaid reason.",
        path: ["unpaidReason"],
      });
    }

    if (
      detail.commercialBasis === "unpaid_internal_test" &&
      detail.unpaidReason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Explain why this internal test is unpaid.",
        path: ["unpaidReason"],
      });
    }
  });

export const retainedPackageCommercialDetailSchema = z.discriminatedUnion(
  "schemaVersion",
  [
    retainedPackageCommercialDetailV1Schema,
    retainedPackageCommercialDetailV2Schema,
  ],
);

export const basketPackageRecordSchema = z.object({
  id: z.uuid(),
  creatorId: z.uuid(),
  creatorName: z.string().min(1).max(120),
  creatorHandle: z.string().min(1).max(120).nullable(),
  audience: z
    .object({
      channelType: creatorChannelTypeSchema,
      size: z.number().int().nonnegative(),
      observedAt: z.iso.datetime(),
      sourceLabel: z.string().min(1).max(160),
    })
    .nullable(),
  packageLabel: z.string().min(1).max(120),
  deliverableSummary: z.string().min(1).max(240).nullable(),
  sourceRateQuoteId: z.uuid().nullable(),
  commercialDetailRevision: z.number().int().positive().optional(),
  commercialDetail: packageCommercialDetailInputSchema.optional(),
  availableChannels: z
    .array(
      z.object({
        id: z.uuid(),
        channelType: creatorChannelTypeSchema,
        handle: z.string(),
      }),
    )
    .optional(),
  compensationLines: z.array(compensationLineRecordSchema).max(5),
});

export type BasketPackageRecord = z.infer<typeof basketPackageRecordSchema>;

export const basketScenarioRecordSchema = z.object({
  id: z.uuid(),
  code: basketScenarioCodeSchema,
  name: z.string().min(1).max(120),
  packageIds: z.array(z.uuid()),
});

export type BasketScenarioRecord = z.infer<typeof basketScenarioRecordSchema>;

export const basketOutcomeMetricSchema = z.enum([
  "qualified_wallets",
  "average_order_value",
  "verified_revenue",
]);

export type BasketOutcomeMetric = z.infer<typeof basketOutcomeMetricSchema>;

export const basketOutcomeProfileSchema = z
  .object({
    metric: basketOutcomeMetricSchema,
    baselineUnits: z.string().regex(/^\d+$/),
    targetUnits: z
      .string()
      .regex(/^\d+$/)
      .refine((value) => BigInt(value) > 0n, {
        message: "Outcome target must be greater than zero",
      }),
    currencyCode: compensationCurrencySchema.nullable(),
  })
  .superRefine((value, context) => {
    const isMoneyMetric = value.metric !== "qualified_wallets";

    if (isMoneyMetric !== (value.currencyCode !== null)) {
      context.addIssue({
        code: "custom",
        message: "Money outcomes require a currency and wallet outcomes do not",
        path: ["currencyCode"],
      });
    }
  });

export type BasketOutcomeProfile = z.infer<typeof basketOutcomeProfileSchema>;

export const commercialPlanApprovalRecordSchema = z
  .object({
    id: z.uuid(),
    scenarioId: z.uuid(),
    scenarioCode: basketScenarioCodeSchema,
    scenarioName: z.string().min(1).max(120),
    version: z.number().int().positive(),
    approvedBy: z.uuid(),
    approvedAt: z.iso.datetime(),
    approvalRecordVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    reason: z.string().min(1).max(240).nullable(),
    snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((record, context) => {
    if (record.reason === null && record.approvalRecordVersion !== 2)
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Historic approvals require their recorded reason.",
      });
  });

export type CommercialPlanApprovalRecord = z.infer<
  typeof commercialPlanApprovalRecordSchema
>;

const commercialPlanSnapshotCompensationLineBaseSchema = z.object({
  id: z.uuid(),
  model: compensationModelSchema,
  variableUnit: z.string().min(1).max(80).optional(),
});

const commercialPlanSnapshotCashLineSchema =
  commercialPlanSnapshotCompensationLineBaseSchema.extend({
    assetType: z.literal("cash"),
    amountMinor: z.string().regex(/^\d+$/),
    currencyCode: compensationCurrencySchema,
  });

const commercialPlanSnapshotTokenLineSchema =
  commercialPlanSnapshotCompensationLineBaseSchema.extend({
    assetType: z.enum(["usdc", "token"]),
    tokenMint: z.string().min(32).max(44),
    tokenAmountRaw: z.string().regex(/^\d+$/),
    tokenDecimals: z.number().int().min(0).max(18),
    unitPriceUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
    priceSource: z.string().min(1).max(160),
    valuedAt: z.iso.datetime({ offset: true }),
  });

export const commercialPlanSnapshotCompensationLineSchema =
  z.discriminatedUnion("assetType", [
    commercialPlanSnapshotCashLineSchema,
    commercialPlanSnapshotTokenLineSchema,
  ]);

export const commercialPlanSnapshotPackageSchema = z
  .object({
    id: z.uuid(),
    creatorId: z.uuid(),
    packageLabel: z.string().min(1).max(120),
    deliverableSummary: z.string().min(1).max(240),
    sourceRateQuoteId: z.uuid().nullable().optional(),
    commercialDetail: retainedPackageCommercialDetailSchema.optional(),
    compensationLines: z
      .array(commercialPlanSnapshotCompensationLineSchema)
      .max(5),
  })
  .superRefine((creatorPackage, context) => {
    const unpaid =
      creatorPackage.commercialDetail?.schemaVersion === 2 &&
      creatorPackage.commercialDetail.commercialBasis ===
        "unpaid_internal_test";

    if (unpaid && creatorPackage.compensationLines.length > 0) {
      context.addIssue({
        code: "custom",
        message: "An unpaid internal test cannot include compensation lines.",
        path: ["compensationLines"],
      });
    }

    if (!unpaid && creatorPackage.compensationLines.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Compensated packages require compensation evidence.",
        path: ["compensationLines"],
      });
    }
  });

export type CommercialPlanSnapshotPackage = z.infer<
  typeof commercialPlanSnapshotPackageSchema
>;

export const commercialPlanSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  basket: z.object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    objective: z.string().min(1).max(240),
    outcomeProfile: z.object({
      metric: basketOutcomeMetricSchema,
      baselineUnits: z.string().regex(/^\d+$/),
      targetUnits: z.string().regex(/^\d+$/),
      currencyCode: compensationCurrencySchema.optional(),
    }),
  }),
  scenario: z.object({
    id: z.uuid(),
    code: basketScenarioCodeSchema,
    name: z.string().min(1).max(120),
  }),
  packages: z.array(commercialPlanSnapshotPackageSchema).min(1),
});

export type CommercialPlanSnapshot = z.infer<
  typeof commercialPlanSnapshotSchema
>;

/** BSK-09 candidate retained record. Not yet accepted by the live approval
 * route: database issuance, human review and campaign readers must migrate
 * together. Parsing checks internal consistency, never permission or database
 * provenance. Packages below are the chosen scenario, not the full shortlist. */
export const strategyBoundCommercialPlanSnapshotSchema =
  commercialPlanSnapshotSchema
    .extend({
      schemaVersion: z.literal(2),
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      strategyBinding: z.strictObject({
        schemaVersion: z.literal(1),
        revision: z.number().int().positive().max(2_147_483_647),
        origin: goalLedBasketDraftSchema.shape.origin,
        strategy: basketStrategyDefinitionSchema,
        // Full shortlist may include creators excluded from the chosen scenario.
        selectedCreatorIds: goalLedBasketDraftSchema.shape.selectedCreatorIds,
        // Explicit half-open measurement window [start, end). Do not infer it
        // from approval time, seeded dates or the conversion rule's start.
        measurementWindow: z.strictObject({
          startedAt: z.iso.datetime(),
          endedAt: z.iso.datetime(),
        }),
        conversionRule: conversionRuleVersionRecordSchema,
      }),
    })
    .strict()
    .superRefine((snapshot, context) => {
      const {
        strategy,
        conversionRule: rule,
        measurementWindow: window,
      } = snapshot.strategyBinding;
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });
      for (const field of ["goal", "audience", "rationale"] as const) {
        if (!strategy[field])
          issue(
            ["strategyBinding", "strategy", field],
            "Complete this strategy detail before approval review.",
          );
      }
      if (
        strategy.distributionMode !== "unpaid_private_link" &&
        strategy.allocations.reduce(
          (sum, row) => sum + row.plannedSpendBps,
          0,
        ) !== 10_000
      )
        issue(
          ["strategyBinding", "strategy", "allocations"],
          "Planned spend allocation must total 100%.",
        );
      if (strategy.distributionMode === "unpaid_private_link") {
        const selected = snapshot.packages[0];
        if (
          snapshot.strategyBinding.origin.kind !== "custom" ||
          snapshot.strategyBinding.selectedCreatorIds.length !== 1 ||
          snapshot.packages.length !== 1 ||
          !selected ||
          selected.commercialDetail?.schemaVersion !== 2 ||
          selected.commercialDetail.commercialBasis !==
            "unpaid_internal_test" ||
          selected.commercialDetail.channels.length !== 0 ||
          selected.compensationLines.length !== 0
        )
          issue(
            ["strategyBinding", "strategy", "distributionMode"],
            "A private-link test requires one explicitly unpaid creator and no public channel.",
          );
      }
      const measurement = strategy.measurement;
      if (!measurement) {
        issue(
          ["strategyBinding", "strategy", "measurement"],
          "Define measurement before approval review.",
        );
      } else {
        if (measurement.conversionRuleVersionId !== rule.id)
          issue(
            [
              "strategyBinding",
              "strategy",
              "measurement",
              "conversionRuleVersionId",
            ],
            "Retain the exact selected conversion definition.",
          );
        if (
          measurement.primaryOutcome !== snapshot.basket.outcomeProfile.metric
        )
          issue(
            ["basket", "outcomeProfile", "metric"],
            "The priced scenario and strategy must use the same primary outcome.",
          );
        // Current project rules explicitly have no revenue mapping. A transfer
        // amount or a strategy intention cannot turn that into verified revenue.
        if (measurement.primaryOutcome === "verified_revenue")
          issue(
            ["strategyBinding", "strategy", "measurement", "primaryOutcome"],
            "The current conversion definition cannot measure verified revenue.",
          );
      }
      if (
        rule.projectId !== snapshot.projectId ||
        rule.workspaceId !== snapshot.workspaceId
      )
        issue(
          ["strategyBinding", "conversionRule"],
          "The measurement definition must match this project and workspace.",
        );
      if (rule.evidenceCapability !== "ready")
        issue(
          ["strategyBinding", "conversionRule", "evidenceCapability"],
          "This measurement definition is not executable yet.",
        );
      if (
        (rule.templateCode === "first_qualifying_transaction" &&
          (rule.minimumFinality !== "finalized" ||
            rule.valueMapping !== "transfer_amount")) ||
        (rule.templateCode === "wallet_connected" &&
          (rule.minimumFinality !== "not_applicable" ||
            rule.valueMapping !== "none"))
      )
        issue(
          ["strategyBinding", "conversionRule", "minimumFinality"],
          "The measurement requirements do not match the selected definition.",
        );
      if (
        rule.templateCode !== "programme_action" &&
        (rule.programId !== null || rule.eventDiscriminator !== null)
      )
        issue(
          ["strategyBinding", "conversionRule", "programId"],
          "This definition must not contain programme-specific match fields.",
        );
      // Validated UTC timestamps can retain fractions finer than milliseconds.
      // Compare seconds and padded fractions without rounding approval bounds.
      const compareInstants = (left: string, right: string) => {
        const [leftSeconds, leftFraction = ""] = left.slice(0, -1).split(".");
        const [rightSeconds, rightFraction = ""] = right
          .slice(0, -1)
          .split(".");
        const secondsDifference =
          Date.parse(`${leftSeconds}Z`) - Date.parse(`${rightSeconds}Z`);
        if (secondsDifference !== 0) return secondsDifference;
        const precision = Math.max(leftFraction.length, rightFraction.length);
        const a = leftFraction.padEnd(precision, "0");
        const b = rightFraction.padEnd(precision, "0");
        return a === b ? 0 : a < b ? -1 : 1;
      };
      if (compareInstants(window.endedAt, window.startedAt) <= 0)
        issue(
          ["strategyBinding", "measurementWindow", "endedAt"],
          "The measurement end must follow its start.",
        );
      if (
        compareInstants(window.startedAt, rule.effectiveFrom) < 0 ||
        (rule.effectiveUntil !== null &&
          compareInstants(window.endedAt, rule.effectiveUntil) > 0)
      )
        issue(
          ["strategyBinding", "measurementWindow"],
          "The selected definition must cover the whole measurement window.",
        );
      const packages = new Set<string>();
      const creators = new Set<string>();
      for (const [index, entry] of snapshot.packages.entries()) {
        if (packages.has(entry.id))
          issue(
            ["packages", index, "id"],
            "A scenario cannot include the same package twice.",
          );
        packages.add(entry.id);
        if (creators.has(entry.creatorId))
          issue(
            ["packages", index, "creatorId"],
            "Combine this creator's terms into one scenario package before campaign creation.",
          );
        creators.add(entry.creatorId);
        if (
          !snapshot.strategyBinding.selectedCreatorIds.includes(entry.creatorId)
        )
          issue(
            ["packages", index, "creatorId"],
            "The scenario creator must belong to the retained shortlist.",
          );
      }
    });

export type StrategyBoundCommercialPlanSnapshot = z.infer<
  typeof strategyBoundCommercialPlanSnapshotSchema
>;

/** BSK-09 timed review candidate. Binding version 2 is intentionally rejected
 * by older retained/live readers until issuance and campaign consumers migrate.
 * Outer V2 preserves existing strategy rollout protections. */
export const timedStrategyCommercialPlanSnapshotSchema = z
  .strictObject(strategyBoundCommercialPlanSnapshotSchema.shape)
  .extend({
    strategyBinding:
      strategyBoundCommercialPlanSnapshotSchema.shape.strategyBinding.extend({
        schemaVersion: z.literal(2),
        timing: campaignTimingProposalSchema,
      }),
  })
  .superRefine((snapshot, context) => {
    const { timing: omittedTiming, ...binding } = snapshot.strategyBinding;
    void omittedTiming;
    const original = strategyBoundCommercialPlanSnapshotSchema.safeParse({
      ...snapshot,
      strategyBinding: { ...binding, schemaVersion: 1 },
    });
    if (!original.success) {
      for (const issue of original.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      return;
    }
    const { timing, measurementWindow } = snapshot.strategyBinding;
    // UTC input is validated; pad fractional digits without millisecond rounding.
    const canonical = (value: string) => {
      const [seconds, fraction = ""] = value.slice(0, -1).split(".");
      return `${seconds}.${fraction.padEnd(6, "0")}Z`;
    };
    const rule = snapshot.strategyBinding.conversionRule;
    const instants = [
      rule.effectiveFrom,
      rule.effectiveUntil,
      measurementWindow.startedAt,
      measurementWindow.endedAt,
    ].filter((value): value is string => value !== null);
    if (
      instants.some(
        (value) =>
          !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(
            value,
          ),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["strategyBinding"],
        message:
          "Timing review requires UTC instants with at most microsecond precision.",
      });
      return;
    }
    if (
      canonical(rule.effectiveFrom) > canonical(measurementWindow.startedAt) ||
      (rule.effectiveUntil !== null &&
        canonical(rule.effectiveUntil) < canonical(measurementWindow.endedAt))
    )
      context.addIssue({
        code: "custom",
        path: ["strategyBinding", "measurementWindow"],
        message: "The selected rule must cover the entire measurement period.",
      });
    for (const key of ["startedAt", "endedAt"] as const) {
      if (
        canonical(timing.measurement[key]) !== canonical(measurementWindow[key])
      )
        context.addIssue({
          code: "custom",
          path: ["strategyBinding", "measurementWindow", key],
          message: "Measurement must match the saved timing exactly.",
        });
    }
  });

export const previewBasketStrategyApprovalInputSchema = z
  .strictObject({
    scenarioId: z.uuid(),
    expectedStrategyRevision: z.number().int().positive().max(2_147_483_647),
    measurementStartedAt: z.iso.datetime(),
    measurementEndedAt: z.iso.datetime(),
  })
  .superRefine((input, context) => {
    if (
      Date.parse(input.measurementEndedAt) <=
      Date.parse(input.measurementStartedAt)
    )
      context.addIssue({
        code: "custom",
        path: ["measurementEndedAt"],
        message: "The measurement end must follow its start.",
      });
  });

export type PreviewBasketStrategyApprovalInput = z.infer<
  typeof previewBasketStrategyApprovalInputSchema
>;

/** Explicit archival decoder. Never relabel a historical v1 as strategy-bound.
 * Live approval/review readers intentionally stay v1-only until rollout. */
export const retainedCommercialPlanSnapshotSchema = z.discriminatedUnion(
  "schemaVersion",
  [
    commercialPlanSnapshotSchema.strict(),
    strategyBoundCommercialPlanSnapshotSchema,
  ],
);

export const commercialPlanReviewSchema = z.object({
  snapshot: commercialPlanSnapshotSchema,
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CommercialPlanReview = z.infer<typeof commercialPlanReviewSchema>;

export const contentAssetStatusSchema = z.enum([
  "planned",
  "draft",
  "submitted",
  "revision_requested",
  "approved",
  "published",
]);

export type ContentAssetStatus = z.infer<typeof contentAssetStatusSchema>;

export const trackedLinkDestinationSchema = z
  .url()
  .superRefine((value, context) => {
    if (!/^https:\/\//i.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Tracked-link destinations must use HTTPS",
      });
    }

    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1] ?? "";

    if (authority.includes("@")) {
      context.addIssue({
        code: "custom",
        message: "Tracked-link destinations cannot contain credentials",
      });
    }
  });

export const trackedLinkPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  linkId: z.uuid(),
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  contentAssetId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  keyVersion: z.number().int().positive(),
});

export type TrackedLinkPayload = z.infer<typeof trackedLinkPayloadSchema>;

export const trackedClickQueryParameter = "lnd_click";

export const trackedLinkClickEvidenceSchema = z
  .object({
    eligibleRedirects: z.number().int().nonnegative(),
    ineligibleAttempts: z.number().int().nonnegative(),
    totalAttempts: z.number().int().nonnegative(),
    firstObservedAt: z.iso.datetime().nullable(),
    lastObservedAt: z.iso.datetime().nullable(),
  })
  .superRefine((evidence, context) => {
    if (
      evidence.totalAttempts !==
      evidence.eligibleRedirects + evidence.ineligibleAttempts
    ) {
      context.addIssue({
        code: "custom",
        message: "Tracked-link attempt totals must reconcile",
        path: ["totalAttempts"],
      });
    }

    if (
      (evidence.totalAttempts === 0 &&
        (evidence.firstObservedAt !== null ||
          evidence.lastObservedAt !== null)) ||
      (evidence.totalAttempts > 0 &&
        (evidence.firstObservedAt === null || evidence.lastObservedAt === null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Tracked-link observation times must match the attempt count",
        path: ["firstObservedAt"],
      });
    }

    if (
      evidence.firstObservedAt &&
      evidence.lastObservedAt &&
      new Date(evidence.firstObservedAt) > new Date(evidence.lastObservedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tracked-link observation times are out of order",
        path: ["lastObservedAt"],
      });
    }
  });

export type TrackedLinkClickEvidence = z.infer<
  typeof trackedLinkClickEvidenceSchema
>;

export const trackedLinkClickQualityEvidenceSchema = z
  .object({
    ruleVersion: z.number().int().positive().nullable(),
    duplicateWindowSeconds: z.number().int().min(60).max(86400).nullable(),
    qualifiedClicks: z.number().int().nonnegative(),
    duplicateClicks: z.number().int().nonnegative(),
    rejectedClicks: z.number().int().nonnegative(),
    totalAssessed: z.number().int().nonnegative(),
    pendingAssessment: z.number().int().nonnegative(),
    firstAssessedAt: z.iso.datetime().nullable(),
    lastAssessedAt: z.iso.datetime().nullable(),
  })
  .superRefine((evidence, context) => {
    if (
      evidence.totalAssessed !==
      evidence.qualifiedClicks +
        evidence.duplicateClicks +
        evidence.rejectedClicks
    ) {
      context.addIssue({
        code: "custom",
        message: "Click-quality totals must reconcile",
        path: ["totalAssessed"],
      });
    }

    const hasAssessment = evidence.totalAssessed > 0;
    const hasRule =
      evidence.ruleVersion !== null && evidence.duplicateWindowSeconds !== null;
    const hasTimes =
      evidence.firstAssessedAt !== null && evidence.lastAssessedAt !== null;

    if (
      (hasAssessment && (!hasRule || !hasTimes)) ||
      (!hasAssessment && (hasRule || hasTimes))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Click-quality rule and observation evidence must match the assessed count",
        path: ["ruleVersion"],
      });
    }

    if (
      evidence.firstAssessedAt &&
      evidence.lastAssessedAt &&
      new Date(evidence.firstAssessedAt) > new Date(evidence.lastAssessedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Click-quality assessment times are out of order",
        path: ["lastAssessedAt"],
      });
    }
  });

export type TrackedLinkClickQualityEvidence = z.infer<
  typeof trackedLinkClickQualityEvidenceSchema
>;

export const trackedLinkAnonymousSessionEvidenceSchema = z
  .object({
    sessions: z.number().int().nonnegative(),
    boundClicks: z.number().int().nonnegative(),
    firstCreatedAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .superRefine((evidence, context) => {
    if (evidence.boundClicks < evidence.sessions) {
      context.addIssue({
        code: "custom",
        message: "Anonymous session click evidence cannot trail sessions",
        path: ["boundClicks"],
      });
    }

    if (evidence.sessions === 0 && evidence.boundClicks !== 0) {
      context.addIssue({
        code: "custom",
        message: "Session-linked clicks require an anonymous session",
        path: ["boundClicks"],
      });
    }

    const hasSessions = evidence.sessions > 0;
    const hasTimes =
      evidence.firstCreatedAt !== null && evidence.lastSeenAt !== null;

    if (hasSessions !== hasTimes) {
      context.addIssue({
        code: "custom",
        message: "Anonymous session times must match the session count",
        path: ["firstCreatedAt"],
      });
    }

    if (
      evidence.firstCreatedAt &&
      evidence.lastSeenAt &&
      new Date(evidence.firstCreatedAt) > new Date(evidence.lastSeenAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Anonymous session evidence times are out of order",
        path: ["lastSeenAt"],
      });
    }
  });

export type TrackedLinkAnonymousSessionEvidence = z.infer<
  typeof trackedLinkAnonymousSessionEvidenceSchema
>;

const solanaBase58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodedBase58ByteLength(value: string) {
  let decoded = 0n;

  for (const character of value) {
    const digit = solanaBase58Alphabet.indexOf(character);

    if (digit < 0) return -1;
    decoded = decoded * 58n + BigInt(digit);
  }

  let significantBytes = 0;
  let remainder = decoded;

  while (remainder > 0n) {
    significantBytes += 1;
    remainder >>= 8n;
  }

  let leadingZeroBytes = 0;

  while (value[leadingZeroBytes] === "1") {
    leadingZeroBytes += 1;
  }

  return leadingZeroBytes + significantBytes;
}

export const solanaWalletAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Enter a valid Solana wallet address")
  .refine((value) => decodedBase58ByteLength(value) === 32, {
    message: "Solana wallet addresses must decode to 32 bytes",
  });

export const walletChainIdSchema = z.enum(["solana:mainnet", "solana:devnet"]);

export type WalletChainId = z.infer<typeof walletChainIdSchema>;

export const walletNonceChallengeRequestSchema = z.strictObject({
  walletAddress: solanaWalletAddressSchema,
});

export const walletSignInInputSchema = z.strictObject({
  domain: z.string().min(1).max(253),
  address: solanaWalletAddressSchema,
  statement: z
    .string()
    .min(1)
    .max(240)
    .refine((value) => !/[\r\n]/.test(value), {
      message: "Wallet statements must stay on one line",
    }),
  uri: z.url(),
  version: z.literal("1"),
  chainId: walletChainIdSchema,
  nonce: z.string().regex(/^[A-Za-z0-9]{16,64}$/),
  issuedAt: z.iso
    .datetime({ offset: true })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  expirationTime: z.iso
    .datetime({ offset: true })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  requestId: z.uuid(),
});

export const walletNonceChallengeResponseSchema = z.strictObject({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  signInInput: walletSignInInputSchema,
});

function decodedBase64ByteLength(value: string) {
  if (value.length % 4 !== 0) return -1;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

const canonicalBase64Schema = z
  .string()
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "Use canonical base64 encoding",
  );

export const walletSignatureProofRequestSchema = z
  .strictObject({
    challengeId: z.uuid(),
    signInInput: walletSignInInputSchema,
    signInOutput: z.strictObject({
      accountAddress: solanaWalletAddressSchema,
      accountPublicKey: canonicalBase64Schema
        .length(44)
        .refine((value) => decodedBase64ByteLength(value) === 32, {
          message: "Wallet public keys must be 32 bytes",
        }),
      signedMessage: canonicalBase64Schema
        .min(4)
        .max(4096)
        .refine(
          (value) => {
            const byteLength = decodedBase64ByteLength(value);
            return byteLength >= 1 && byteLength <= 2048;
          },
          { message: "Signed wallet messages must be 1 to 2048 bytes" },
        ),
      signature: canonicalBase64Schema
        .length(88)
        .refine((value) => decodedBase64ByteLength(value) === 64, {
          message: "Ed25519 signatures must be 64 bytes",
        }),
      signatureType: z.literal("ed25519").optional(),
    }),
  })
  .superRefine((value, context) => {
    if (value.challengeId !== value.signInInput.requestId) {
      context.addIssue({
        code: "custom",
        message: "Wallet proof request IDs must match",
        path: ["challengeId"],
      });
    }

    if (value.signInOutput.accountAddress !== value.signInInput.address) {
      context.addIssue({
        code: "custom",
        message: "The signing account must match the requested wallet",
        path: ["signInOutput", "accountAddress"],
      });
    }
  });

export const walletSignatureProofResponseSchema = z.strictObject({
  proofId: z.uuid(),
  challengeId: z.uuid(),
  state: z.literal("verified"),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const walletMeasurementConsentVersion = 1 as const;
export const walletMeasurementHistoricalLookbackDays = 90 as const;
export const walletMeasurementConsentStatement =
  "I consent to Landed linking this wallet to this campaign session to measure configured campaign outcomes. Analysis may include up to 90 days of relevant pre-touch activity and relevant activity until this qualified campaign session expires. I can unlink at any time to stop future association." as const;

export const walletMeasurementConsentRequestSchema = z.strictObject({
  proofId: z.uuid(),
  accepted: z.literal(true),
  consentVersion: z.literal(walletMeasurementConsentVersion),
});

export const walletMeasurementConsentResponseSchema = z.strictObject({
  consentId: z.uuid(),
  mappingId: z.uuid(),
  state: z.enum(["accepted", "already_accepted"]),
  reconciliationState: z
    .enum(["queued", "completed", "attention_required"])
    .optional(),
  consentVersion: z.literal(walletMeasurementConsentVersion),
  consentStatement: z.literal(walletMeasurementConsentStatement),
  historicalLookbackDays: z.literal(walletMeasurementHistoricalLookbackDays),
  acceptedAt: z.iso.datetime({ offset: true }),
  monitoringEndsAt: z.iso.datetime({ offset: true }),
});

export const walletMappingUnlinkRequestSchema = z.strictObject({
  unlinkRequestId: z.uuid(),
});

export const walletMappingUnlinkResponseSchema = z.strictObject({
  mappingId: z.uuid(),
  state: z.enum(["unlinked", "already_unlinked"]),
  unlinkedAt: z.iso.datetime({ offset: true }),
});

export type WalletNonceChallengeRequest = z.infer<
  typeof walletNonceChallengeRequestSchema
>;
export type WalletSignInInput = z.infer<typeof walletSignInInputSchema>;
export type WalletNonceChallengeResponse = z.infer<
  typeof walletNonceChallengeResponseSchema
>;
export type WalletSignatureProofRequest = z.infer<
  typeof walletSignatureProofRequestSchema
>;
export type WalletSignatureProofResponse = z.infer<
  typeof walletSignatureProofResponseSchema
>;
export type WalletMeasurementConsentRequest = z.infer<
  typeof walletMeasurementConsentRequestSchema
>;
export type WalletMeasurementConsentResponse = z.infer<
  typeof walletMeasurementConsentResponseSchema
>;
export type WalletMappingUnlinkRequest = z.infer<
  typeof walletMappingUnlinkRequestSchema
>;
export type WalletMappingUnlinkResponse = z.infer<
  typeof walletMappingUnlinkResponseSchema
>;

export const trackedLinkRecordSchema = z.object({
  id: z.uuid(),
  generationRequestId: z.uuid(),
  destinationUrl: trackedLinkDestinationSchema,
  destinationPolicyActive: z.boolean(),
  keyVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  issuedBy: z.uuid(),
  issuedAt: z.iso.datetime(),
  clickEvidence: trackedLinkClickEvidenceSchema,
  clickQuality: trackedLinkClickQualityEvidenceSchema,
  anonymousSessions: trackedLinkAnonymousSessionEvidenceSchema,
  revocation: z
    .object({
      requestId: z.uuid(),
      actorUserId: z.uuid(),
      reason: z.string().trim().min(8).max(240),
      revokedAt: z.iso.datetime(),
    })
    .nullable(),
});

export type TrackedLinkRecord = z.infer<typeof trackedLinkRecordSchema>;

export const campaignBriefStatusSchema = z.enum([
  "draft",
  "submitted",
  "revision_requested",
  "approved",
]);

export type CampaignBriefStatus = z.infer<typeof campaignBriefStatusSchema>;

export const campaignRosterRecordSchema = z.object({
  id: z.uuid(),
  creatorId: z.uuid(),
  creatorName: z.string().min(1).max(120),
  creatorHandle: z.string().min(1).max(120).nullable(),
  sourcePackageId: z.uuid(),
  rosterPosition: z.number().int().positive(),
  packageLabel: z.string().min(1).max(120),
  deliverableSummary: z.string().min(1).max(240),
  commercialTerms: commercialPlanSnapshotPackageSchema,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
});

export type CampaignRosterRecord = z.infer<typeof campaignRosterRecordSchema>;

export const contentPublicationEvidenceRecordSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    version: z.number().int().positive(),
    platform: z.enum(["x", "instagram", "tiktok", "youtube", "other"]),
    publishedUrl: httpUrlSchema,
    publishedAt: z.iso.datetime(),
    thumbnailStatus: z.enum(["available", "not_available"]),
    thumbnailUrl: httpUrlSchema.nullable(),
    thumbnailUnavailableReason: z.string().trim().min(1).max(120).nullable(),
    sourceLabel: z.string().trim().min(1).max(160),
    observedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((evidence, context) => {
    const available =
      evidence.thumbnailStatus === "available" &&
      evidence.thumbnailUrl !== null &&
      evidence.thumbnailUnavailableReason === null;
    const unavailable =
      evidence.thumbnailStatus === "not_available" &&
      evidence.thumbnailUrl === null &&
      evidence.thumbnailUnavailableReason !== null;
    if (!available && !unavailable) {
      context.addIssue({
        code: "custom",
        message: "Publication thumbnail status must match retained evidence",
        path: ["thumbnailStatus"],
      });
    }
  });

export type ContentPublicationEvidenceRecord = z.infer<
  typeof contentPublicationEvidenceRecordSchema
>;

export const contentAssetRecordSchema = z.object({
  id: z.uuid(),
  campaignCreatorId: z.uuid(),
  creatorId: z.uuid(),
  assetIndex: z.number().int().positive(),
  label: z.string().min(1).max(240),
  status: contentAssetStatusSchema,
  submissionUrl: httpUrlSchema.nullable(),
  publishedUrl: httpUrlSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publicationEvidence: z.array(contentPublicationEvidenceRecordSchema),
  trackedLinks: z.array(trackedLinkRecordSchema),
  activity: z.array(
    z.object({
      id: z.uuid(),
      requestId: z.uuid(),
      actorUserId: z.uuid(),
      fromStatus: contentAssetStatusSchema.nullable(),
      toStatus: contentAssetStatusSchema,
      evidenceUrl: httpUrlSchema.nullable(),
      note: z.string().trim().min(8).max(240),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export type ContentAssetRecord = z.infer<typeof contentAssetRecordSchema>;

export const campaignBriefVersionRecordSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  requestId: z.uuid(),
  status: campaignBriefStatusSchema,
  objective: z.string().trim().min(1).max(240),
  audience: z.string().trim().min(1).max(500).nullable(),
  keyMessage: z.string().trim().min(1).max(500).nullable(),
  creatorDirection: z.string().trim().min(1).max(1000).nullable(),
  complianceNotes: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().min(8).max(240),
  actorUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export type CampaignBriefVersionRecord = z.infer<
  typeof campaignBriefVersionRecordSchema
>;

export const campaignActivityRecordSchema = z.object({
  id: z.uuid(),
  transitionRequestId: z.uuid(),
  actorUserId: z.uuid(),
  fromStatus: campaignStatusSchema,
  toStatus: campaignStatusSchema,
  reason: z.string().trim().min(8).max(240),
  createdAt: z.iso.datetime(),
});

export type CampaignActivityRecord = z.infer<
  typeof campaignActivityRecordSchema
>;

export const campaignRecordSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  basketId: z.uuid(),
  commercialPlanVersionId: z.uuid(),
  commercialPlanVersion: z.number().int().positive(),
  name: z.string().min(1).max(120),
  objective: z.string().min(1).max(240),
  outcomeProfile: basketOutcomeProfileSchema,
  status: campaignStatusSchema,
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  roster: z.array(campaignRosterRecordSchema).min(1),
  briefVersions: z.array(campaignBriefVersionRecordSchema).min(1),
  contentAssets: z.array(contentAssetRecordSchema),
  activity: z.array(campaignActivityRecordSchema),
});

export type CampaignRecord = z.infer<typeof campaignRecordSchema>;

export const createCampaignFromCommercialPlanInputSchema = z.object({
  commercialPlanVersionId: z.uuid(),
  activationRequestId: z.uuid(),
});

export type CreateCampaignFromCommercialPlanInput = z.infer<
  typeof createCampaignFromCommercialPlanInputSchema
>;

export const campaignTransitionInputSchema = z.object({
  targetStatus: campaignStatusSchema,
  transitionRequestId: z.uuid(),
  reason: z.string().trim().min(8).max(240),
});

export type CampaignTransitionInput = z.infer<
  typeof campaignTransitionInputSchema
>;

export const saveCampaignBriefInputSchema = z.object({
  action: z.literal("save"),
  requestId: z.uuid(),
  objective: z.string().trim().min(1).max(240),
  audience: z.string().trim().min(1).max(500),
  keyMessage: z.string().trim().min(1).max(500),
  creatorDirection: z.string().trim().min(1).max(1000),
  complianceNotes: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().min(8).max(240),
});

export const transitionCampaignBriefInputSchema = z.object({
  action: z.literal("transition"),
  requestId: z.uuid(),
  targetStatus: campaignBriefStatusSchema,
  reason: z.string().trim().min(8).max(240),
});

export const campaignBriefMutationInputSchema = z.discriminatedUnion("action", [
  saveCampaignBriefInputSchema,
  transitionCampaignBriefInputSchema,
]);

export type CampaignBriefMutationInput = z.infer<
  typeof campaignBriefMutationInputSchema
>;

export const contentAssetTransitionInputSchema = z.object({
  targetStatus: contentAssetStatusSchema,
  requestId: z.uuid(),
  evidenceUrl: httpUrlSchema.nullable(),
  note: z.string().trim().min(8).max(240),
});

export type ContentAssetTransitionInput = z.infer<
  typeof contentAssetTransitionInputSchema
>;

export const issueTrackedLinkInputSchema = z.object({
  action: z.literal("issue"),
  requestId: z.uuid(),
  destinationUrl: trackedLinkDestinationSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});

export const revokeTrackedLinkInputSchema = z.object({
  action: z.literal("revoke"),
  requestId: z.uuid(),
  trackedLinkId: z.uuid(),
  reason: z.string().trim().min(8).max(240),
});

export const trackedLinkMutationInputSchema = z.discriminatedUnion("action", [
  issueTrackedLinkInputSchema,
  revokeTrackedLinkInputSchema,
]);

export type TrackedLinkMutationInput = z.infer<
  typeof trackedLinkMutationInputSchema
>;

export const basketRecordSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1).max(120),
  objective: z.string().min(1).max(240).nullable(),
  outcomeProfile: basketOutcomeProfileSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  scenarios: z.array(basketScenarioRecordSchema).length(3),
  packages: z.array(basketPackageRecordSchema),
  latestApproval: commercialPlanApprovalRecordSchema.nullable(),
  latestApprovalIsCurrent: z.boolean().nullable(),
});

export type BasketRecord = z.infer<typeof basketRecordSchema>;

export const createBasketInputSchema = z.object({
  creatorIds: z.array(z.uuid()).min(1).max(20),
});

export type CreateBasketInput = z.infer<typeof createBasketInputSchema>;

export const setScenarioPackageInputSchema = z.object({
  scenarioId: z.uuid(),
  packageId: z.uuid(),
  included: z.boolean(),
});

export type SetScenarioPackageInput = z.infer<
  typeof setScenarioPackageInputSchema
>;

export const savePackageCommercialTermsInputSchema = z
  .object({
    packageLabel: z.string().trim().min(1).max(120),
    deliverableSummary: z.string().trim().min(1).max(240).nullable(),
    compensationLines: z.array(compensationLineInputSchema).max(5),
    commercialDetail: packageCommercialDetailInputSchema.optional(),
    expectedDetailRevision: z.number().int().positive().optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.commercialDetail === undefined) !==
      (input.expectedDetailRevision === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Reload the package before saving its commercial detail.",
      });

    if (
      input.commercialDetail?.schemaVersion === 2 &&
      input.commercialDetail.commercialBasis === "unpaid_internal_test" &&
      input.compensationLines.length > 0
    )
      context.addIssue({
        code: "custom",
        message: "An unpaid internal test cannot include compensation lines.",
        path: ["compensationLines"],
      });
  });

export type SavePackageCommercialTermsInput = z.infer<
  typeof savePackageCommercialTermsInputSchema
>;

export const saveBasketOutcomeInputSchema = z.object({
  objective: z.string().trim().min(1).max(240),
  outcomeProfile: basketOutcomeProfileSchema,
});

export type SaveBasketOutcomeInput = z.infer<
  typeof saveBasketOutcomeInputSchema
>;

export const approveBasketScenarioInputSchema = z.object({
  scenarioId: z.uuid(),
  approvalRequestId: z.uuid(),
  reason: z.string().trim().min(1).max(240),
  confirmation: z.literal("APPROVE COMMERCIAL PLAN"),
  expectedSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ApproveBasketScenarioInput = z.infer<
  typeof approveBasketScenarioInputSchema
>;

export function decimalToBaseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("Decimals must be an integer between 0 and 18");
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Value must be a non-negative decimal string");
  }

  const [whole, fraction = ""] = value.split(".");

  if (fraction.length > decimals) {
    throw new RangeError(`Value has more than ${decimals} decimal places`);
  }

  const scale = 10n ** BigInt(decimals);
  const fractionUnits = fraction.padEnd(decimals, "0") || "0";

  return (BigInt(whole) * scale + BigInt(fractionUnits)).toString();
}

export function baseUnitsToDecimal(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) {
    throw new TypeError("Value must be an integer base-unit string");
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("Decimals must be an integer between 0 and 18");
  }

  if (decimals === 0) {
    return BigInt(value).toString();
  }

  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");

  return fraction
    ? `${BigInt(whole).toString()}.${fraction}`
    : BigInt(whole).toString();
}

export type ExactCurrencyTotal = {
  currencyCode: CompensationCurrency;
  amount: string;
  units: string;
  scale: number;
};

export type VariableRateTotal = ExactCurrencyTotal & {
  variableUnit: string;
  lineCount: number;
};

export type ScenarioSpendStatus =
  | "empty"
  | "unpaid"
  | "incomplete"
  | "single_currency"
  | "mixed_currency"
  | "variable_only";

export type ScenarioSpendSummary = {
  status: ScenarioSpendStatus;
  fixedTotals: ExactCurrencyTotal[];
  variableRates: VariableRateTotal[];
  incompletePackageIds: string[];
  missingPackageIds: string[];
  largestPackageId: string | null;
  largestPackageShareBps: number | null;
};

export type BasketApprovalBlockerCode =
  | "scenario_missing"
  | "outcome_missing"
  | "roster_empty"
  | "package_missing"
  | "deliverable_missing"
  | "commercial_terms_incomplete"
  | "currency_unresolved"
  | "fixed_commitment_missing";

export type BasketApprovalBlocker = {
  code: BasketApprovalBlockerCode;
  message: string;
  packageIds: string[];
};

export type BasketApprovalEvaluation = {
  eligible: boolean;
  blockers: BasketApprovalBlocker[];
  spend: ScenarioSpendSummary;
};

export type ForecastRange = {
  p25: number;
  base: number;
  p75: number;
};

export type ScenarioForecastPoint = {
  packageId: string;
  creatorName: string;
  packageCount: number;
  potentialAudience: number;
  estimatedUniqueAudience: number;
  forecastReach: ForecastRange;
  qualifiedWallets: ForecastRange;
};

export type ScenarioForecastSummary = {
  status: "empty" | "unavailable" | "partial" | "ready";
  confidence: "very_low" | "low";
  modelVersion: "planning-v1";
  includedPackageCount: number;
  sampleSize: number;
  missingPackageIds: string[];
  potentialAudience: number;
  estimatedUniqueAudience: number;
  forecastReach: ForecastRange;
  qualifiedWallets: ForecastRange;
  points: ScenarioForecastPoint[];
  sourceLabels: string[];
  freshestObservedAt: string | null;
};

const planningForecastModel = {
  overlapAfterFirstBps: 1500n,
  reachRateBps: { p25: 1200n, base: 2000n, p75: 3000n },
  qualifiedWalletRateBps: { p25: 5n, base: 10n, p75: 20n },
} as const;

function applyBasisPoints(value: number, basisPoints: bigint): number {
  return Number((BigInt(value) * basisPoints) / 10_000n);
}

function forecastRange(value: number, rates: ForecastRange): ForecastRange {
  return {
    p25: applyBasisPoints(value, BigInt(rates.p25)),
    base: applyBasisPoints(value, BigInt(rates.base)),
    p75: applyBasisPoints(value, BigInt(rates.p75)),
  };
}

function qualifiedWalletRange(reach: ForecastRange): ForecastRange {
  return {
    p25: applyBasisPoints(
      reach.p25,
      planningForecastModel.qualifiedWalletRateBps.p25,
    ),
    base: applyBasisPoints(
      reach.base,
      planningForecastModel.qualifiedWalletRateBps.base,
    ),
    p75: applyBasisPoints(
      reach.p75,
      planningForecastModel.qualifiedWalletRateBps.p75,
    ),
  };
}

export function calculateScenarioForecast(
  packages: BasketPackageRecord[],
  packageIds: string[],
): ScenarioForecastSummary {
  const selectedIds = Array.from(new Set(packageIds));
  const packageById = new Map(packages.map((item) => [item.id, item]));
  const selectedPackages = selectedIds
    .map((packageId) => packageById.get(packageId))
    .filter((item): item is BasketPackageRecord => Boolean(item));
  const missingPackageIds = selectedIds.filter(
    (packageId) => !packageById.get(packageId)?.audience,
  );
  const evidencedPackages = selectedPackages
    .filter(
      (
        item,
      ): item is BasketPackageRecord & {
        audience: NonNullable<BasketPackageRecord["audience"]>;
      } => item.audience !== null,
    )
    .sort(
      (left, right) =>
        right.audience.size - left.audience.size ||
        left.creatorName.localeCompare(right.creatorName),
    );
  const reachRates: ForecastRange = {
    p25: Number(planningForecastModel.reachRateBps.p25),
    base: Number(planningForecastModel.reachRateBps.base),
    p75: Number(planningForecastModel.reachRateBps.p75),
  };
  let potentialAudience = 0;
  let estimatedUniqueAudience = 0;

  const points = evidencedPackages.map((item, index) => {
    potentialAudience += item.audience.size;
    estimatedUniqueAudience +=
      index === 0
        ? item.audience.size
        : item.audience.size -
          applyBasisPoints(
            item.audience.size,
            planningForecastModel.overlapAfterFirstBps,
          );
    const forecastReach = forecastRange(estimatedUniqueAudience, reachRates);

    return {
      packageId: item.id,
      creatorName: item.creatorName,
      packageCount: index + 1,
      potentialAudience,
      estimatedUniqueAudience,
      forecastReach,
      qualifiedWallets: qualifiedWalletRange(forecastReach),
    };
  });
  const latestPoint = points.at(-1);
  const forecastReach = latestPoint?.forecastReach ?? {
    p25: 0,
    base: 0,
    p75: 0,
  };
  const qualifiedWallets = latestPoint?.qualifiedWallets ?? {
    p25: 0,
    base: 0,
    p75: 0,
  };
  const sourceLabels = Array.from(
    new Set(evidencedPackages.map((item) => item.audience.sourceLabel)),
  );
  const observedTimes = evidencedPackages
    .map((item) => item.audience.observedAt)
    .sort();

  return {
    status:
      selectedIds.length === 0
        ? "empty"
        : evidencedPackages.length === 0
          ? "unavailable"
          : missingPackageIds.length > 0
            ? "partial"
            : "ready",
    confidence:
      missingPackageIds.length > 0 || evidencedPackages.length < 3
        ? "very_low"
        : "low",
    modelVersion: "planning-v1",
    includedPackageCount: selectedIds.length,
    sampleSize: evidencedPackages.length,
    missingPackageIds,
    potentialAudience: latestPoint?.potentialAudience ?? 0,
    estimatedUniqueAudience: latestPoint?.estimatedUniqueAudience ?? 0,
    forecastReach,
    qualifiedWallets,
    points,
    sourceLabels,
    freshestObservedAt: observedTimes.at(-1) ?? null,
  };
}

type ExactValue = {
  units: bigint;
  scale: number;
};

function normalizeExactValue(value: ExactValue): ExactValue {
  let { units, scale } = value;

  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }

  return { units, scale };
}

function exactValueFromDecimal(value: string): ExactValue {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Value must be a non-negative decimal string");
  }

  const [whole, fraction = ""] = value.split(".");

  return normalizeExactValue({
    units: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  });
}

function addExactValues(left: ExactValue, right: ExactValue): ExactValue {
  const scale = Math.max(left.scale, right.scale);

  return normalizeExactValue({
    units:
      left.units * 10n ** BigInt(scale - left.scale) +
      right.units * 10n ** BigInt(scale - right.scale),
    scale,
  });
}

function exactValueToDecimal(value: ExactValue): string {
  if (value.scale === 0) {
    return value.units.toString();
  }

  const padded = value.units.toString().padStart(value.scale + 1, "0");
  const whole = padded.slice(0, -value.scale);
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");

  return fraction ? `${BigInt(whole).toString()}.${fraction}` : whole;
}

function compensationLineValue(line: CompensationLineRecord): {
  currencyCode: CompensationCurrency;
  value: ExactValue;
} {
  if (line.assetType === "cash") {
    return {
      currencyCode: line.currencyCode,
      value: normalizeExactValue({
        units: BigInt(line.amountMinor),
        scale: 2,
      }),
    };
  }

  const unitPrice = exactValueFromDecimal(line.unitPriceUsd);

  return {
    currencyCode: "USD",
    value: normalizeExactValue({
      units: BigInt(line.tokenAmountRaw) * unitPrice.units,
      scale: line.tokenDecimals + unitPrice.scale,
    }),
  };
}

function currencyTotal(
  currencyCode: CompensationCurrency,
  value: ExactValue,
): ExactCurrencyTotal {
  const normalized = normalizeExactValue(value);

  return {
    amount: exactValueToDecimal(normalized),
    currencyCode,
    scale: normalized.scale,
    units: normalized.units.toString(),
  };
}

export function calculateScenarioSpend(
  packages: BasketPackageRecord[],
  packageIds: string[],
): ScenarioSpendSummary {
  const selectedIds = Array.from(new Set(packageIds));
  const packageById = new Map(packages.map((item) => [item.id, item]));
  const fixedByCurrency = new Map<CompensationCurrency, ExactValue>();
  const fixedByPackage = new Map<
    string,
    Map<CompensationCurrency, ExactValue>
  >();
  const variableByKey = new Map<
    string,
    {
      currencyCode: CompensationCurrency;
      lineCount: number;
      value: ExactValue;
      variableUnit: string;
    }
  >();
  const incompletePackageIds: string[] = [];
  const missingPackageIds: string[] = [];

  for (const packageId of selectedIds) {
    const selectedPackage = packageById.get(packageId);

    if (!selectedPackage) {
      incompletePackageIds.push(packageId);
      missingPackageIds.push(packageId);
      continue;
    }

    const explicitUnpaid =
      selectedPackage.commercialDetail?.schemaVersion === 2 &&
      selectedPackage.commercialDetail.commercialBasis ===
        "unpaid_internal_test";

    if (selectedPackage.compensationLines.length === 0 && !explicitUnpaid) {
      incompletePackageIds.push(packageId);
      continue;
    }

    for (const line of selectedPackage.compensationLines) {
      const { currencyCode, value } = compensationLineValue(line);

      if (line.model === "variable") {
        const variableUnit = line.variableUnit;

        if (!variableUnit) {
          incompletePackageIds.push(packageId);
          continue;
        }

        const key = `${currencyCode}\u0000${variableUnit}`;
        const current = variableByKey.get(key);

        variableByKey.set(key, {
          currencyCode,
          lineCount: (current?.lineCount ?? 0) + 1,
          value: current ? addExactValues(current.value, value) : value,
          variableUnit,
        });
        continue;
      }

      const currencyValue = fixedByCurrency.get(currencyCode);
      fixedByCurrency.set(
        currencyCode,
        currencyValue ? addExactValues(currencyValue, value) : value,
      );

      const packageTotals =
        fixedByPackage.get(packageId) ??
        new Map<CompensationCurrency, ExactValue>();
      const packageValue = packageTotals.get(currencyCode);
      packageTotals.set(
        currencyCode,
        packageValue ? addExactValues(packageValue, value) : value,
      );
      fixedByPackage.set(packageId, packageTotals);
    }
  }

  const fixedTotals = Array.from(fixedByCurrency.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, value]) => currencyTotal(currencyCode, value));
  const variableRates = Array.from(variableByKey.values())
    .sort((left, right) =>
      `${left.currencyCode}:${left.variableUnit}`.localeCompare(
        `${right.currencyCode}:${right.variableUnit}`,
      ),
    )
    .map(({ currencyCode, lineCount, value, variableUnit }) => ({
      ...currencyTotal(currencyCode, value),
      lineCount,
      variableUnit,
    }));
  const commercialCurrencies = new Set<CompensationCurrency>([
    ...fixedTotals.map(({ currencyCode }) => currencyCode),
    ...variableRates.map(({ currencyCode }) => currencyCode),
  ]);

  let status: ScenarioSpendStatus;

  if (selectedIds.length === 0) {
    status = "empty";
  } else if (incompletePackageIds.length > 0) {
    status = "incomplete";
  } else if (commercialCurrencies.size === 0) {
    status = "unpaid";
  } else if (commercialCurrencies.size > 1) {
    status = "mixed_currency";
  } else if (fixedTotals.length === 1) {
    status = "single_currency";
  } else if (variableRates.length > 0) {
    status = "variable_only";
  } else {
    status = "incomplete";
  }

  let largestPackageId: string | null = null;
  let largestPackageShareBps: number | null = null;

  if (status === "single_currency") {
    const total = fixedTotals[0];

    if (total && BigInt(total.units) > 0n) {
      let largestShareBps = -1n;

      for (const packageId of selectedIds) {
        const packageValue = fixedByPackage
          .get(packageId)
          ?.get(total.currencyCode);

        if (!packageValue) {
          continue;
        }

        const shareBps =
          (packageValue.units * 10_000n * 10n ** BigInt(total.scale)) /
          (BigInt(total.units) * 10n ** BigInt(packageValue.scale));

        if (shareBps > largestShareBps) {
          largestShareBps = shareBps;
          largestPackageId = packageId;
        }
      }

      largestPackageShareBps = Number(largestShareBps);
    }
  }

  return {
    fixedTotals,
    incompletePackageIds: Array.from(new Set(incompletePackageIds)),
    largestPackageId,
    largestPackageShareBps,
    missingPackageIds,
    status,
    variableRates,
  };
}

export function calculateCommercialPlanSnapshotSpend(
  snapshot: Pick<CommercialPlanSnapshot, "packages">,
): ScenarioSpendSummary {
  const evidenceTime = "1970-01-01T00:00:00.000Z";
  const packages: BasketPackageRecord[] = snapshot.packages.map(
    (creatorPackage) => ({
      id: creatorPackage.id,
      creatorId: creatorPackage.creatorId,
      creatorName: creatorPackage.packageLabel,
      creatorHandle: null,
      audience: null,
      packageLabel: creatorPackage.packageLabel,
      deliverableSummary: creatorPackage.deliverableSummary,
      sourceRateQuoteId: creatorPackage.sourceRateQuoteId ?? null,
      ...(creatorPackage.commercialDetail
        ? {
            commercialDetailRevision: creatorPackage.commercialDetail.revision,
            commercialDetail:
              creatorPackage.commercialDetail.schemaVersion === 2
                ? {
                    schemaVersion: 2 as const,
                    channelIds: creatorPackage.commercialDetail.channels.map(
                      ({ id }) => id,
                    ),
                    deliveryDeadline:
                      creatorPackage.commercialDetail.deliveryDeadline,
                    usageRights: creatorPackage.commercialDetail.usageRights,
                    exclusivity: creatorPackage.commercialDetail.exclusivity,
                    commercialBasis:
                      creatorPackage.commercialDetail.commercialBasis,
                    unpaidReason: creatorPackage.commercialDetail.unpaidReason,
                  }
                : {
                    schemaVersion: 1 as const,
                    channelIds: creatorPackage.commercialDetail.channels.map(
                      ({ id }) => id,
                    ),
                    deliveryDeadline:
                      creatorPackage.commercialDetail.deliveryDeadline,
                    usageRights: creatorPackage.commercialDetail.usageRights,
                    exclusivity: creatorPackage.commercialDetail.exclusivity,
                  },
          }
        : {}),
      compensationLines: creatorPackage.compensationLines.map((line) => ({
        ...line,
        variableUnit: line.variableUnit ?? null,
        createdAt: evidenceTime,
        updatedAt: evidenceTime,
      })),
    }),
  );

  return calculateScenarioSpend(
    packages,
    packages.map(({ id }) => id),
  );
}

export function evaluateBasketScenarioApproval(
  basket: BasketRecord,
  scenarioId: string,
): BasketApprovalEvaluation {
  const scenario = basket.scenarios.find(({ id }) => id === scenarioId);
  const emptySpend = calculateScenarioSpend([], []);

  if (!scenario) {
    return {
      eligible: false,
      blockers: [
        {
          code: "scenario_missing",
          message: "Select a scenario from this basket.",
          packageIds: [],
        },
      ],
      spend: emptySpend,
    };
  }

  const blockers: BasketApprovalBlocker[] = [];
  const packageById = new Map(basket.packages.map((item) => [item.id, item]));
  const selectedPackages = scenario.packageIds
    .map((packageId) => packageById.get(packageId))
    .filter((item): item is BasketPackageRecord => item !== undefined);
  const missingPackageIds = scenario.packageIds.filter(
    (packageId) => !packageById.has(packageId),
  );
  const missingDeliverableIds = selectedPackages
    .filter(({ deliverableSummary }) => !deliverableSummary?.trim())
    .map(({ id }) => id);
  const spend = calculateScenarioSpend(basket.packages, scenario.packageIds);

  if (!basket.objective || !basket.outcomeProfile) {
    blockers.push({
      code: "outcome_missing",
      message: "Define the campaign outcome before approval.",
      packageIds: [],
    });
  }

  if (scenario.packageIds.length === 0) {
    blockers.push({
      code: "roster_empty",
      message: "Include at least one creator package before approval.",
      packageIds: [],
    });
  }

  if (missingPackageIds.length > 0) {
    blockers.push({
      code: "package_missing",
      message: "One or more selected packages are unavailable.",
      packageIds: missingPackageIds,
    });
  }

  if (missingDeliverableIds.length > 0) {
    blockers.push({
      code: "deliverable_missing",
      message: "Every included package needs a deliverable summary.",
      packageIds: missingDeliverableIds,
    });
  }

  if (spend.incompletePackageIds.length > 0) {
    blockers.push({
      code: "commercial_terms_incomplete",
      message: "Every included package needs complete commercial terms.",
      packageIds: spend.incompletePackageIds,
    });
  }

  if (spend.status === "mixed_currency") {
    blockers.push({
      code: "currency_unresolved",
      message: "Resolve the scenario to one commercial currency.",
      packageIds: scenario.packageIds,
    });
  }

  if (spend.status === "variable_only") {
    blockers.push({
      code: "fixed_commitment_missing",
      message: "Add a fixed commercial commitment before approval.",
      packageIds: scenario.packageIds,
    });
  }

  return {
    blockers,
    eligible: blockers.length === 0,
    spend,
  };
}

export function formatMinor(
  valueMinor: bigint,
  currency: "GBP" | "USD" | "EUR" = "GBP",
): string {
  const amount = valueMinor / 100n;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export {
  campaignTimingProposalSchema,
  type CampaignTimingProposal,
} from "./campaign-timing";

export function safeRate(
  numeratorMinor: bigint,
  denominator: number,
): bigint | null {
  if (!Number.isInteger(denominator) || denominator <= 0) {
    return null;
  }

  return numeratorMinor / BigInt(denominator);
}
