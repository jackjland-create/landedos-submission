import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// PostgreSQL stores microseconds. Reject finer input instead of silently
// rounding an event across an exclusive boundary. Offset parsing uses only
// whole seconds; the fractional part is handled exactly with integers.
function microInstant(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > 6) return null;
  const milliseconds = Date.parse(match[1]! + match[3]!);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

const inputSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  effectiveAt: z.iso
    .datetime({ offset: true })
    .refine((value) => microInstant(value) !== null),
});

// This is the retained evaluator input, not permission to run a calculation.
// Keep timestamps and match conditions unchanged; do not round via Date.
const ruleSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().min(1),
    change_reason: z.string().min(1),
    created_by: z.uuid(),
    created_at: z.iso.datetime({ offset: true }),
    rule_id: z.uuid(),
    workspace_id: z.uuid(),
    project_id: z.uuid(),
    version: z.number().int().positive(),
    template_code: z.enum(["wallet_connected", "first_qualifying_transaction"]),
    chain: z.literal("solana"),
    requires_wallet_binding: z.literal(true),
    minimum_finality: z.enum(["finalized", "not_applicable"]),
    value_mapping: z.enum(["none", "transfer_amount"]),
    revenue_mapping: z.literal("none"),
    attribution_window_seconds: z.literal(604800),
    attribution_model: z.literal("last_eligible_creator_touch"),
    program_id: z.null(),
    event_discriminator: z.null(),
    evidence_capability: z.literal("ready"),
    configured_environment: z
      .enum(["demo", "devnet", "mainnet"])
      .nullable()
      .optional(),
    destination_address: z.string().nullable().optional(),
    native_amount_lamports: z.coerce.string().nullable().optional(),
    effective_from: z.iso.datetime({ offset: true }),
    effective_until: z.iso.datetime({ offset: true }).nullable(),
    match_conditions: z.record(z.string(), z.unknown()),
  })
  .superRefine((rule, context) => {
    const wallet = rule.template_code === "wallet_connected";
    const destinationBound =
      rule.configured_environment != null ||
      rule.destination_address != null ||
      rule.native_amount_lamports != null;
    const conditions = wallet
      ? z.strictObject({
          kind: z.literal("wallet_connected"),
          requiresWalletBinding: z.literal(true),
        })
      : destinationBound
        ? z.strictObject({
            chain: z.literal("solana"),
            configuredEnvironment: z.literal("devnet"),
            destinationAddress: z.string(),
            eventNames: z.tuple([z.literal("solana.native_transfer")]),
            nativeAmountLamports: z.literal("1"),
            minimumFinality: z.literal("finalized"),
            requiresWalletBinding: z.literal(true),
          })
        : z.strictObject({
            chain: z.literal("solana"),
            eventNames: z.tuple([
              z.literal("solana.native_transfer"),
              z.literal("solana.token_transfer"),
            ]),
            minimumFinality: z.literal("finalized"),
            requiresWalletBinding: z.literal(true),
          });
    if (
      rule.minimum_finality !== (wallet ? "not_applicable" : "finalized") ||
      rule.value_mapping !== (wallet ? "none" : "transfer_amount") ||
      (destinationBound &&
        (rule.configured_environment !== "devnet" ||
          rule.destination_address == null ||
          rule.native_amount_lamports !== "1")) ||
      !conditions.safeParse(rule.match_conditions).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent approved rule",
      });
    }
  });

export class CampaignMeasurementQueryError extends Error {
  constructor(public readonly code?: string) {
    super("Approved campaign measurement could not be prepared.");
    this.name = "CampaignMeasurementQueryError";
  }
}

/** Cookie-authenticated, read-only lookup. Legacy/missing bindings are errors;
 * an empty result means outside the approved window, never zero conversions.
 * Does not select the latest project rule or authorize execution/replay. */
export async function resolveCampaignConversionRuleVersion(
  client: SupabaseClient,
  input: z.infer<typeof inputSchema>,
) {
  const request = inputSchema.parse(input);
  const response = await Promise.resolve(
    client.rpc("resolve_campaign_conversion_rule_version", {
      target_project_id: request.projectId,
      target_campaign_id: request.campaignId,
      target_effective_at: request.effectiveAt,
    }),
  ).catch(() => {
    throw new CampaignMeasurementQueryError("transport_error");
  });
  if (response.error)
    throw new CampaignMeasurementQueryError(response.error.code);
  const parsed = z.array(ruleSchema).max(1).safeParse(response.data);
  if (!parsed.success) throw new CampaignMeasurementQueryError("invalid_rule");
  const rule = parsed.data[0];
  if (!rule) return { status: "outside_approved_window" } as const;
  const instant = microInstant(request.effectiveAt)!;
  const from = microInstant(rule.effective_from);
  const until =
    rule.effective_until === null ? null : microInstant(rule.effective_until);
  if (
    rule.workspace_id !== request.workspaceId ||
    rule.project_id !== request.projectId ||
    from === null ||
    (rule.effective_until !== null && until === null) ||
    (from !== null && instant < from) ||
    (until !== null && instant >= until)
  )
    throw new CampaignMeasurementQueryError("invalid_rule");
  return { status: "resolved", rule } as const;
}
