import "server-only";

import {
  classifyAttributionConfidence,
  evaluateConversion,
  evaluateLastTouchAttribution,
  isAttributedTouch,
  isConversionMatch,
  type AttributionTouchCandidate,
  type ConversionEvaluationInput,
} from "@landed/attribution";
import { z } from "zod";

const persistedFactSchema = z
  .array(
    z.object({
      attribution_fact_id: z.uuid(),
      conversion_fact_id: z.uuid(),
      inserted: z.boolean(),
    }),
  )
  .length(1);

export type StrongAttributionProcessingClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export async function evaluateAndRecordStrongAttribution(
  client: StrongAttributionProcessingClient,
  input: {
    attributionFactId: string;
    calculationRequestId: string;
    conversion: ConversionEvaluationInput;
    conversionFactId: string;
    touches: AttributionTouchCandidate[];
  },
) {
  const conversion = evaluateConversion(input.conversion);
  if (
    !isConversionMatch(conversion) ||
    input.conversion.evidence.kind !== "solana_transfer"
  ) {
    throw new Error("Canonical evidence did not match the conversion rule.");
  }

  const attribution = evaluateLastTouchAttribution({
    ruleVersion: input.conversion.ruleVersion,
    conversion: {
      ...conversion,
      id: z.uuid().parse(input.conversionFactId),
      projectId: input.conversion.wallet.projectId,
      walletAddress: input.conversion.wallet.walletAddress,
      workspaceId: input.conversion.wallet.workspaceId,
    },
    touches: input.touches,
  });
  const confidence = classifyAttributionConfidence({
    attribution,
    directOnchainReferral: null,
    indicativeEvidence: null,
  });

  if (
    !isAttributedTouch(attribution) ||
    confidence.confidence !== "strong" ||
    !confidence.primaryRoasEligible ||
    attribution.protectedWalletMappingId !==
      input.conversion.wallet.protectedWalletMappingId
  ) {
    throw new Error("Retained touch evidence was not strongly attributable.");
  }

  const persisted = await client.rpc("record_strong_attribution_fact", {
    target_attribution_fact_id: z.uuid().parse(input.attributionFactId),
    target_calculation_request_id: z.uuid().parse(input.calculationRequestId),
    target_canonical_chain_event_id:
      input.conversion.evidence.canonicalChainEventId,
    target_conversion_fact_id: z.uuid().parse(input.conversionFactId),
    target_project_id: input.conversion.wallet.projectId,
    target_protected_wallet_mapping_id:
      input.conversion.wallet.protectedWalletMappingId,
    target_rule_version_id: input.conversion.ruleVersion.id,
  });
  if (persisted.error) {
    throw new Error("Strong attribution evidence could not be persisted.");
  }

  const retained = persistedFactSchema.parse(persisted.data)[0];
  if (
    retained.attribution_fact_id !== input.attributionFactId ||
    retained.conversion_fact_id !== input.conversionFactId
  ) {
    throw new Error(
      "Strong attribution persistence changed evidence identity.",
    );
  }

  return { attribution, confidence, conversion, retained };
}
