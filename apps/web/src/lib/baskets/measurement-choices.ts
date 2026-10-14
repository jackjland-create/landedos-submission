import type { ConversionRuleRecord } from "@landed/contracts";

export type BasketMeasurementChoice = {
  id: string;
  name: string;
  description: string;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  supported: boolean;
  /** Plain-language display only; the saved name and description stay intact. */
  label?: string;
  summary?: string;
  /** Sanitized requirements derived from the immutable rule, not its description. */
  qualifyingFacts?: string[];
  advancedFacts?: string[];
};
export type BasketMeasurementChoices =
  | { kind: "ready"; options: BasketMeasurementChoice[] }
  | { kind: "unavailable" };

/** Project-scoped, minimal display data; availability is not approval. */
export function basketMeasurementChoices(
  rule: ConversionRuleRecord | null,
  projectId: string,
  workspaceId: string,
): BasketMeasurementChoices {
  if (!rule) return { kind: "ready", options: [] };
  if (
    rule.projectId !== projectId ||
    rule.workspaceId !== workspaceId ||
    rule.versions.some(
      (v) =>
        v.projectId !== projectId ||
        v.workspaceId !== workspaceId ||
        v.ruleId !== rule.id,
    )
  )
    return { kind: "unavailable" };
  return {
    kind: "ready",
    options: rule.versions.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      version: v.version,
      effectiveFrom: v.effectiveFrom,
      effectiveUntil: v.effectiveUntil,
      qualifyingFacts:
        v.templateCode === "wallet_connected"
          ? [
              "A verified wallet connection with explicit measurement consent is the qualifying action. No transaction is required.",
            ]
          : v.templateCode === "first_qualifying_transaction"
            ? [
                "The first qualifying transaction from the verified, consenting wallet counts.",
                v.minimumFinality === "finalized"
                  ? "The transaction must be finalized before it counts."
                  : "This version does not retain the required finalized-transaction condition.",
                ...(v.destinationAddress &&
                v.nativeAmountLamports != null &&
                v.configuredEnvironment
                  ? [
                      "It must match the configured recipient, exact amount and network.",
                    ]
                  : []),
              ]
            : [
                "The configured programme action must match. A programme decoder is required.",
              ],
      ...(v.destinationAddress &&
      v.nativeAmountLamports != null &&
      v.configuredEnvironment
        ? {
            advancedFacts: [
              `Exact amount: ${v.nativeAmountLamports} ${v.nativeAmountLamports === "1" ? "lamport" : "lamports"}. Network: ${v.configuredEnvironment}.`,
            ],
          }
        : {}),
      supported:
        v.evidenceCapability === "ready" &&
        v.requiresWalletBinding &&
        v.attributionWindowSeconds === 604800 &&
        v.attributionModel === "last_eligible_creator_touch" &&
        v.revenueMapping === "none",
      label:
        v.templateCode === "wallet_connected"
          ? "Wallet connection"
          : v.templateCode === "first_qualifying_transaction"
            ? v.configuredEnvironment === "devnet"
              ? "First qualifying test transaction"
              : "First qualifying transaction"
            : "Customer action",
      summary:
        v.templateCode === "wallet_connected"
          ? "Counts a verified wallet connection when the visitor agrees to measurement."
          : v.templateCode === "first_qualifying_transaction"
            ? v.configuredEnvironment === "devnet"
              ? "Counts the visitor’s first completed test transaction that meets this rule, after wallet verification and consent."
              : "Counts the visitor’s first completed transaction that meets this rule, after wallet verification and consent."
            : "Counts the specific action defined for your product.",
    })),
  };
}
