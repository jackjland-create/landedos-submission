// ATT-01: destination-bound Devnet evaluator V2; V1 remains immutable.
import {
  exactInstant,
  exactMicros,
  exactInstantSchema,
} from "./exact-instants";
import { conversionRuleVersionRecordSchema } from "@landed/contracts";
import {
  canonicalSolanaTransferSchema,
  solanaAddressSchema,
} from "@landed/solana";
import { z } from "zod";

import { conversionValueSchema, type ConversionValue } from "./schemas";

export { conversionValueSchema, type ConversionValue } from "./schemas";

export const conversionEvaluatorVersion = 2 as const;

const evaluationInstantSchema = exactInstantSchema;

export const conversionNonMatchReasonSchema = z.enum([
  "evidence_scope_mismatch",
  "rule_not_yet_effective",
  "rule_no_longer_effective",
  "wallet_binding_not_active",
  "wallet_binding_expired",
  "wallet_binding_unlinked",
  "evidence_type_mismatch",
  "minimum_finality_not_met",
  "wallet_not_transaction_source",
  "configured_environment_mismatch",
  "destination_mismatch",
  "native_amount_mismatch",
  "prior_conversion_exists",
  "programme_decoder_unavailable",
]);

export type ConversionNonMatchReason = z.infer<
  typeof conversionNonMatchReasonSchema
>;

export const conversionWalletContextSchema = z
  .strictObject({
    protectedWalletMappingId: z.uuid(),
    anonymousSessionId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    walletAddress: solanaAddressSchema,
    activeFrom: evaluationInstantSchema,
    monitoringEndsAt: evaluationInstantSchema,
    unlinkedAt: evaluationInstantSchema.nullable(),
  })
  .superRefine((mapping, context) => {
    const activeFrom = exactMicros(mapping.activeFrom);
    const monitoringEndsAt = exactMicros(mapping.monitoringEndsAt);
    if (monitoringEndsAt <= activeFrom) {
      context.addIssue({
        code: "custom",
        message: "Wallet monitoring must end after the binding becomes active",
        path: ["monitoringEndsAt"],
      });
    }

    if (mapping.unlinkedAt && exactMicros(mapping.unlinkedAt) < activeFrom) {
      context.addIssue({
        code: "custom",
        message: "Wallet unlink time cannot precede the active binding",
        path: ["unlinkedAt"],
      });
    }
  });

export type ConversionWalletContext = z.infer<
  typeof conversionWalletContextSchema
>;

const walletBindingEvidenceSchema = z.strictObject({
  kind: z.literal("wallet_binding"),
  protectedWalletMappingId: z.uuid(),
});

const solanaTransferEvidenceSchema = z.strictObject({
  kind: z.literal("solana_transfer"),
  canonicalChainEventId: z.uuid(),
  finality: z.enum(["processed", "confirmed", "finalized"]),
  configuredEnvironment: z.enum(["demo", "devnet", "mainnet"]).optional(),
  event: canonicalSolanaTransferSchema,
});

export const conversionEvidenceSchema = z.discriminatedUnion("kind", [
  walletBindingEvidenceSchema,
  solanaTransferEvidenceSchema,
]);

export type ConversionEvidence = z.infer<typeof conversionEvidenceSchema>;

const priorConversionSchema = z.strictObject({
  conversionFactId: z.uuid(),
  ruleVersionId: z.uuid(),
  protectedWalletMappingId: z.uuid(),
  conversionTime: evaluationInstantSchema,
});

export const conversionEvaluationInputSchema = z
  .strictObject({
    ruleVersion: conversionRuleVersionRecordSchema,
    wallet: conversionWalletContextSchema,
    evidence: conversionEvidenceSchema,
    priorConversion: priorConversionSchema.nullable(),
  })
  .superRefine((input, context) => {
    if (
      input.evidence.kind === "wallet_binding" &&
      input.evidence.protectedWalletMappingId !==
        input.wallet.protectedWalletMappingId
    ) {
      context.addIssue({
        code: "custom",
        message: "Wallet-binding evidence must identify the evaluated mapping",
        path: ["evidence", "protectedWalletMappingId"],
      });
    }

    if (input.priorConversion) {
      if (
        input.priorConversion.ruleVersionId !== input.ruleVersion.id ||
        input.priorConversion.protectedWalletMappingId !==
          input.wallet.protectedWalletMappingId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Prior conversion context must use the evaluated rule and wallet mapping",
          path: ["priorConversion"],
        });
      }

      const candidateTime =
        input.evidence.kind === "wallet_binding"
          ? input.wallet.activeFrom
          : input.evidence.event.eventTime;
      if (
        exactMicros(input.priorConversion.conversionTime) >
        exactMicros(candidateTime)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Prior conversion context cannot be later than the candidate evidence",
          path: ["priorConversion", "conversionTime"],
        });
      }
    }
  });

export type ConversionEvaluationInput = z.infer<
  typeof conversionEvaluationInputSchema
>;

const conversionEvaluationBaseSchema = z.strictObject({
  evaluatorVersion: z.literal(conversionEvaluatorVersion),
  ruleVersionId: z.uuid(),
  protectedWalletMappingId: z.uuid(),
  evidenceId: z.string().min(1).max(200),
  evidenceTime: z.iso.datetime(),
});

export const conversionMatchSchema = conversionEvaluationBaseSchema.extend({
  outcome: z.literal("match"),
  reason: z.literal("matched"),
  conversionTime: z.iso.datetime(),
  value: conversionValueSchema,
  revenue: z.strictObject({ kind: z.literal("none") }),
});

export const conversionNonMatchSchema = conversionEvaluationBaseSchema.extend({
  outcome: z.literal("non_match"),
  reason: conversionNonMatchReasonSchema,
});

export const conversionEvaluationResultSchema = z.discriminatedUnion(
  "outcome",
  [conversionMatchSchema, conversionNonMatchSchema],
);

export type ConversionEvaluationResult = z.infer<
  typeof conversionEvaluationResultSchema
>;

function canonicalInstant(value: string) {
  return exactInstant(value);
}

function candidateTime(input: ConversionEvaluationInput) {
  return input.evidence.kind === "wallet_binding"
    ? input.wallet.activeFrom
    : input.evidence.event.eventTime;
}

function evidenceId(input: ConversionEvaluationInput) {
  return input.evidence.kind === "wallet_binding"
    ? input.evidence.protectedWalletMappingId
    : input.evidence.canonicalChainEventId;
}

function nonMatch(
  input: ConversionEvaluationInput,
  reason: ConversionNonMatchReason,
): ConversionEvaluationResult {
  return {
    outcome: "non_match",
    reason,
    evaluatorVersion: conversionEvaluatorVersion,
    ruleVersionId: input.ruleVersion.id,
    protectedWalletMappingId: input.wallet.protectedWalletMappingId,
    evidenceId: evidenceId(input),
    evidenceTime: canonicalInstant(candidateTime(input)),
  };
}

function walletIsTransactionSource(input: ConversionEvaluationInput) {
  if (input.evidence.kind !== "solana_transfer") return false;
  return input.evidence.event.fromAddress === input.wallet.walletAddress;
}

function destinationBoundRule(input: ConversionEvaluationInput) {
  const rule = input.ruleVersion;
  if (
    rule.configuredEnvironment == null &&
    rule.destinationAddress == null &&
    rule.nativeAmountLamports == null
  ) {
    return null;
  }

  return {
    configuredEnvironment: rule.configuredEnvironment!,
    destinationAddress: rule.destinationAddress!,
    nativeAmountLamports: rule.nativeAmountLamports!,
  };
}

function conversionValue(input: ConversionEvaluationInput): ConversionValue {
  if (input.evidence.kind !== "solana_transfer") return { kind: "none" };
  if (input.evidence.event.eventName === "solana.native_transfer") {
    return {
      kind: "native_lamports",
      rawAmount: input.evidence.event.nativeAmountLamports,
      decimals: 9,
    };
  }
  return {
    kind: "token_base_units",
    rawAmount: input.evidence.event.tokenAmountRaw,
    decimals: input.evidence.event.tokenDecimals,
    tokenMint: input.evidence.event.tokenMint,
  };
}

export function evaluateConversion(
  rawInput: ConversionEvaluationInput,
): ConversionEvaluationResult {
  const input = conversionEvaluationInputSchema.parse(rawInput);
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
  const time = exactMicros(candidateTime(input));
  const rule = input.ruleVersion;
  const wallet = input.wallet;

  if (
    rule.workspaceId !== wallet.workspaceId ||
    rule.projectId !== wallet.projectId ||
    (input.evidence.kind === "solana_transfer" &&
      (input.evidence.event.workspaceId !== wallet.workspaceId ||
        input.evidence.event.projectId !== wallet.projectId))
  ) {
    return nonMatch(input, "evidence_scope_mismatch");
  }

  if (time < exactMicros(rule.effectiveFrom)) {
    return nonMatch(input, "rule_not_yet_effective");
  }
  if (rule.effectiveUntil && time >= exactMicros(rule.effectiveUntil)) {
    return nonMatch(input, "rule_no_longer_effective");
  }
  if (time < exactMicros(wallet.activeFrom)) {
    return nonMatch(input, "wallet_binding_not_active");
  }
  if (wallet.unlinkedAt && time >= exactMicros(wallet.unlinkedAt)) {
    return nonMatch(input, "wallet_binding_unlinked");
  }
  if (time >= exactMicros(wallet.monitoringEndsAt)) {
    return nonMatch(input, "wallet_binding_expired");
  }

  if (rule.templateCode === "programme_action") {
    return nonMatch(input, "programme_decoder_unavailable");
  }

  if (rule.templateCode === "wallet_connected") {
    if (input.evidence.kind !== "wallet_binding") {
      return nonMatch(input, "evidence_type_mismatch");
    }
  } else {
    if (input.evidence.kind !== "solana_transfer") {
      return nonMatch(input, "evidence_type_mismatch");
    }
    if (input.evidence.finality !== "finalized") {
      return nonMatch(input, "minimum_finality_not_met");
    }
    if (!walletIsTransactionSource(input)) {
      return nonMatch(input, "wallet_not_transaction_source");
    }
    const destination = destinationBoundRule(input);
    if (destination) {
      if (
        input.evidence.configuredEnvironment !==
        destination.configuredEnvironment
      ) {
        return nonMatch(input, "configured_environment_mismatch");
      }
      if (
        input.evidence.event.eventName !== "solana.native_transfer" ||
        input.evidence.event.toAddress !== destination.destinationAddress
      ) {
        return nonMatch(input, "destination_mismatch");
      }
      if (
        input.evidence.event.nativeAmountLamports !==
        destination.nativeAmountLamports
      ) {
        return nonMatch(input, "native_amount_mismatch");
      }
    }
  }

  if (input.priorConversion) {
    return nonMatch(input, "prior_conversion_exists");
  }

  return conversionMatchSchema.parse({
    outcome: "match",
    reason: "matched",
    evaluatorVersion: conversionEvaluatorVersion,
    ruleVersionId: rule.id,
    protectedWalletMappingId: wallet.protectedWalletMappingId,
    evidenceId: evidenceId(input),
    evidenceTime: canonicalInstant(candidateTime(input)),
    conversionTime: canonicalInstant(candidateTime(input)),
    value: conversionValue(input),
    revenue: { kind: "none" },
  });
}

export function isConversionMatch(
  result: ConversionEvaluationResult,
): result is z.infer<typeof conversionMatchSchema> {
  return result.outcome === "match";
}
