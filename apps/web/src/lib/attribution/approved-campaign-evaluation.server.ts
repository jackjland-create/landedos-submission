import "server-only";

import {
  conversionEvaluationInputSchema,
  evaluateConversion,
  type ConversionEvaluationInput,
} from "@landed/attribution";
import { conversionRuleVersionRecordSchema } from "@landed/contracts";
import { resolveCampaignConversionRuleVersion } from "@landed/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  wallet: conversionEvaluationInputSchema.shape.wallet,
  evidence: conversionEvaluationInputSchema.shape.evidence,
  priorConversion: conversionEvaluationInputSchema.shape.priorConversion,
});

// Evaluator V1 uses millisecond instants. Do not silently round a boundary.
function supportsPrecision(value: string) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return fraction.length <= 6 && /^0*$/.test(fraction.slice(3));
}

function utc(value: string) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return new Date(value)
    .toISOString()
    .replace(/\.\d{3}Z$/, `.${fraction.padEnd(3, "0")}Z`);
}

export class CampaignCandidateEvaluationError extends Error {
  constructor() {
    super("Campaign candidate context is invalid.");
    this.name = "CampaignCandidateEvaluationError";
  }
}

/** Read-only candidate evaluation, NOT verified conversion or attribution.
 * Supplied wallet/evidence/history are not loaded or authenticated here.
 * In particular, null history does not prove this is the first-ever action.
 * No persistence, replay authorisation, activation or runtime job integration.
 */
export async function evaluateApprovedCampaignCandidate(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    projectId: string;
    campaignId: string;
    wallet: ConversionEvaluationInput["wallet"];
    evidence: ConversionEvaluationInput["evidence"];
    priorConversion: ConversionEvaluationInput["priorConversion"];
  },
) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new CampaignCandidateEvaluationError();
  const request = parsed.data;
  const { wallet, evidence, priorConversion } = request;
  if (
    wallet.workspaceId !== request.workspaceId ||
    wallet.projectId !== request.projectId ||
    (evidence.kind === "solana_transfer" &&
      (evidence.event.workspaceId !== request.workspaceId ||
        evidence.event.projectId !== request.projectId)) ||
    (evidence.kind === "wallet_binding" &&
      evidence.protectedWalletMappingId !== wallet.protectedWalletMappingId) ||
    (priorConversion !== null &&
      priorConversion.protectedWalletMappingId !==
        wallet.protectedWalletMappingId)
  )
    throw new CampaignCandidateEvaluationError();

  const context = {
    kind: "candidate" as const,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    campaignId: request.campaignId,
  };
  const effectiveAt =
    evidence.kind === "wallet_binding"
      ? wallet.activeFrom
      : evidence.event.eventTime;
  const times = [
    effectiveAt,
    wallet.activeFrom,
    wallet.monitoringEndsAt,
    wallet.unlinkedAt,
    priorConversion?.conversionTime,
  ].filter((value): value is string => value != null);
  if (!times.every(supportsPrecision))
    return { ...context, status: "precision_unsupported" } as const;

  const resolved = await resolveCampaignConversionRuleVersion(client, {
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    campaignId: request.campaignId,
    effectiveAt,
  });
  if (resolved.status === "outside_approved_window")
    return { ...context, status: resolved.status } as const;
  const rule = resolved.rule;
  if (
    !supportsPrecision(rule.effective_from) ||
    (rule.effective_until !== null && !supportsPrecision(rule.effective_until))
  )
    return { ...context, status: "precision_unsupported" } as const;

  const ruleVersion = conversionRuleVersionRecordSchema.safeParse({
    id: rule.id,
    ruleId: rule.rule_id,
    workspaceId: rule.workspace_id,
    projectId: rule.project_id,
    version: rule.version,
    templateCode: rule.template_code,
    name: rule.name,
    description: rule.description,
    effectiveFrom: utc(rule.effective_from),
    effectiveUntil:
      rule.effective_until === null ? null : utc(rule.effective_until),
    chain: rule.chain,
    requiresWalletBinding: rule.requires_wallet_binding,
    minimumFinality: rule.minimum_finality,
    valueMapping: rule.value_mapping,
    revenueMapping: rule.revenue_mapping,
    attributionWindowSeconds: rule.attribution_window_seconds,
    attributionModel: rule.attribution_model,
    programId: rule.program_id,
    eventDiscriminator: rule.event_discriminator,
    evidenceCapability: rule.evidence_capability,
    configuredEnvironment: rule.configured_environment ?? null,
    destinationAddress: rule.destination_address ?? null,
    nativeAmountLamports: rule.native_amount_lamports ?? null,
    changeReason: rule.change_reason,
    createdBy: rule.created_by,
    createdAt: utc(rule.created_at),
  });
  if (!ruleVersion.success) throw new CampaignCandidateEvaluationError();
  const evaluationInput = conversionEvaluationInputSchema.safeParse({
    ruleVersion: ruleVersion.data,
    wallet,
    evidence,
    priorConversion,
  });
  if (!evaluationInput.success) throw new CampaignCandidateEvaluationError();
  return {
    ...context,
    status: "evaluated",
    ruleVersionId: rule.id,
    evaluation: evaluateConversion(evaluationInput.data),
  } as const;
}
