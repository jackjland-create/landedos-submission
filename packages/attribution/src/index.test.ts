import { describe, expect, it } from "vitest";

import {
  conversionEvaluationInputSchema,
  evaluateConversion,
  isConversionMatch,
  type ConversionEvidence,
  type ConversionEvaluationInput,
} from "./index";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const ruleId = "30000000-0000-4000-8000-000000000001";
const ruleVersionId = "40000000-0000-4000-8000-000000000001";
const mappingId = "50000000-0000-4000-8000-000000000001";
const sessionId = "60000000-0000-4000-8000-000000000001";
const canonicalEventId = "70000000-0000-4000-8000-000000000001";
const createdBy = "80000000-0000-4000-8000-000000000001";
const walletAddress = "11111111111111111111111111111111";
const counterpartyAddress = "Vote111111111111111111111111111111111111111";
const transactionSignature =
  "1111111111111111111111111111111111111111111111111111111111111111";

function ruleVersion(
  templateCode:
    | "wallet_connected"
    | "first_qualifying_transaction"
    | "programme_action" = "first_qualifying_transaction",
) {
  const programme = templateCode === "programme_action";
  return {
    id: ruleVersionId,
    ruleId,
    workspaceId,
    projectId,
    version: 1,
    templateCode,
    name:
      templateCode === "wallet_connected"
        ? "Wallet connected"
        : programme
          ? "Programme action"
          : "First qualifying transaction",
    description: "A deterministic conversion definition for test evidence.",
    effectiveFrom: "2026-08-12T10:00:00.000Z",
    effectiveUntil: null,
    chain: "solana" as const,
    requiresWalletBinding: true as const,
    minimumFinality:
      templateCode === "wallet_connected"
        ? ("not_applicable" as const)
        : ("finalized" as const),
    valueMapping:
      templateCode === "first_qualifying_transaction"
        ? ("transfer_amount" as const)
        : ("none" as const),
    revenueMapping: "none" as const,
    attributionWindowSeconds: 604_800 as const,
    attributionModel: "last_eligible_creator_touch" as const,
    programId: programme ? counterpartyAddress : null,
    eventDiscriminator: programme ? "deposit_completed" : null,
    evidenceCapability: programme
      ? ("requires_programme_decoder" as const)
      : ("ready" as const),
    changeReason: "Create deterministic test definition",
    createdBy,
    createdAt: "2026-08-12T09:00:00.000Z",
  };
}

function nativeEvent(overrides: Record<string, unknown> = {}) {
  return {
    chain: "solana" as const,
    eventTime: "2026-08-12T12:00:00.000Z",
    id: "90000000-0000-4000-8000-000000000001:native_transfer:0",
    ingestedAt: "2026-08-12T12:00:01.000Z",
    projectId,
    rawEvidenceId: "90000000-0000-4000-8000-000000000001",
    schemaVersion: 1 as const,
    slot: "123456",
    source: "helius_webhook" as const,
    sourceEventId: "90000000-0000-4000-8000-000000000001",
    sourceTransferIndex: 0,
    sourceTransferKind: "native_transfer" as const,
    transactionSignature,
    workspaceId,
    eventName: "solana.native_transfer" as const,
    fromAddress: walletAddress,
    nativeAmountLamports: "9007199254740993123",
    toAddress: counterpartyAddress,
    ...overrides,
  };
}

function tokenEvent(overrides: Record<string, unknown> = {}) {
  return {
    chain: "solana" as const,
    eventTime: "2026-08-12T12:00:00.000Z",
    id: "90000000-0000-4000-8000-000000000001:token_transfer:0",
    ingestedAt: "2026-08-12T12:00:01.000Z",
    projectId,
    rawEvidenceId: "90000000-0000-4000-8000-000000000001",
    schemaVersion: 1 as const,
    slot: "123456",
    source: "helius_webhook" as const,
    sourceEventId: "90000000-0000-4000-8000-000000000001",
    sourceTransferIndex: 0,
    sourceTransferKind: "token_transfer" as const,
    transactionSignature,
    workspaceId,
    eventName: "solana.token_transfer" as const,
    fromAddress: walletAddress,
    fromTokenAccount: counterpartyAddress,
    toAddress: counterpartyAddress,
    toTokenAccount: walletAddress,
    tokenAmountRaw: "18446744073709551615",
    tokenDecimals: 9,
    tokenMint: counterpartyAddress,
    ...overrides,
  };
}

function solanaEvidence(
  event: Extract<
    ConversionEvidence,
    { kind: "solana_transfer" }
  >["event"] = nativeEvent(),
  finality: "processed" | "confirmed" | "finalized" = "finalized",
) {
  return {
    kind: "solana_transfer" as const,
    canonicalChainEventId: canonicalEventId,
    finality,
    event,
  };
}

function destinationBoundRule() {
  return {
    ...ruleVersion(),
    configuredEnvironment: "devnet" as const,
    destinationAddress: counterpartyAddress,
    nativeAmountLamports: "1",
  };
}

function input(
  overrides: Partial<ConversionEvaluationInput> = {},
): ConversionEvaluationInput {
  return {
    ruleVersion: ruleVersion(),
    wallet: {
      protectedWalletMappingId: mappingId,
      anonymousSessionId: sessionId,
      workspaceId,
      projectId,
      walletAddress,
      activeFrom: "2026-08-12T11:00:00.000Z",
      monitoringEndsAt: "2026-08-19T11:00:00.000Z",
      unlinkedAt: null,
    },
    evidence: solanaEvidence(),
    priorConversion: null,
    ...overrides,
  };
}

describe("evaluateConversion", () => {
  it("matches wallet-binding evidence exactly once", () => {
    const result = evaluateConversion(
      input({
        ruleVersion: ruleVersion("wallet_connected"),
        evidence: {
          kind: "wallet_binding",
          protectedWalletMappingId: mappingId,
        },
      }),
    );

    expect(result).toEqual({
      outcome: "match",
      reason: "matched",
      evaluatorVersion: 1,
      ruleVersionId,
      protectedWalletMappingId: mappingId,
      evidenceId: mappingId,
      evidenceTime: "2026-08-12T11:00:00.000Z",
      conversionTime: "2026-08-12T11:00:00.000Z",
      value: { kind: "none" },
      revenue: { kind: "none" },
    });
    expect(isConversionMatch(result)).toBe(true);
  });

  it("matches a finalized outgoing native transfer and preserves base units", () => {
    expect(evaluateConversion(input())).toMatchObject({
      outcome: "match",
      value: {
        kind: "native_lamports",
        rawAmount: "9007199254740993123",
        decimals: 9,
      },
      revenue: { kind: "none" },
    });
  });

  it("matches a finalized outgoing token transfer and preserves mint precision", () => {
    const result = evaluateConversion(
      input({
        evidence: solanaEvidence(tokenEvent()),
      }),
    );

    expect(result).toMatchObject({
      outcome: "match",
      value: {
        kind: "token_base_units",
        rawAmount: "18446744073709551615",
        decimals: 9,
        tokenMint: counterpartyAddress,
      },
    });
  });

  it("matches only the exact devnet campaign response", () => {
    expect(
      evaluateConversion(
        input({
          ruleVersion: destinationBoundRule(),
          evidence: {
            ...solanaEvidence(nativeEvent({ nativeAmountLamports: "1" })),
            configuredEnvironment: "devnet",
          },
        }),
      ),
    ).toMatchObject({
      outcome: "match",
      value: { kind: "native_lamports", rawAmount: "1", decimals: 9 },
      revenue: { kind: "none" },
    });
  });

  it.each([
    ["configured_environment_mismatch", "mainnet", counterpartyAddress, "1"],
    ["destination_mismatch", "devnet", walletAddress, "1"],
    ["native_amount_mismatch", "devnet", counterpartyAddress, "2"],
  ] as const)(
    "rejects an exact response with %s",
    (reason, configuredEnvironment, toAddress, nativeAmountLamports) => {
      expect(
        evaluateConversion(
          input({
            ruleVersion: destinationBoundRule(),
            evidence: {
              ...solanaEvidence(
                nativeEvent({ toAddress, nativeAmountLamports }),
              ),
              configuredEnvironment,
            },
          }),
        ),
      ).toMatchObject({ outcome: "non_match", reason });
    },
  );

  it.each([
    [
      "evidence_scope_mismatch",
      () =>
        input({
          wallet: {
            ...input().wallet,
            projectId: "20000000-0000-4000-8000-000000000099",
          },
        }),
    ],
    [
      "rule_not_yet_effective",
      () =>
        input({
          evidence: solanaEvidence(
            nativeEvent({ eventTime: "2026-08-12T09:59:59.999Z" }),
          ),
        }),
    ],
    [
      "rule_no_longer_effective",
      () =>
        input({
          ruleVersion: {
            ...ruleVersion(),
            effectiveUntil: "2026-08-12T12:00:00.000Z",
          },
        }),
    ],
    [
      "wallet_binding_not_active",
      () =>
        input({
          evidence: solanaEvidence(
            nativeEvent({ eventTime: "2026-08-12T10:30:00.000Z" }),
          ),
        }),
    ],
    [
      "wallet_binding_expired",
      () =>
        input({
          wallet: {
            ...input().wallet,
            monitoringEndsAt: "2026-08-12T12:00:00.000Z",
          },
        }),
    ],
    [
      "wallet_binding_unlinked",
      () =>
        input({
          wallet: {
            ...input().wallet,
            unlinkedAt: "2026-08-12T11:30:00.000Z",
          },
        }),
    ],
    [
      "evidence_type_mismatch",
      () =>
        input({
          evidence: {
            kind: "wallet_binding" as const,
            protectedWalletMappingId: mappingId,
          },
        }),
    ],
    [
      "minimum_finality_not_met",
      () =>
        input({
          evidence: solanaEvidence(nativeEvent(), "confirmed"),
        }),
    ],
    [
      "wallet_not_transaction_source",
      () =>
        input({
          evidence: solanaEvidence(
            nativeEvent({
              fromAddress: counterpartyAddress,
              toAddress: walletAddress,
            }),
          ),
        }),
    ],
    [
      "prior_conversion_exists",
      () =>
        input({
          priorConversion: {
            conversionFactId: "a0000000-0000-4000-8000-000000000001",
            ruleVersionId,
            protectedWalletMappingId: mappingId,
            conversionTime: "2026-08-12T11:30:00.000Z",
          },
        }),
    ],
    [
      "programme_decoder_unavailable",
      () => input({ ruleVersion: ruleVersion("programme_action") }),
    ],
  ] as const)("returns the explicit %s reason", (reason, createInput) => {
    expect(evaluateConversion(createInput())).toMatchObject({
      outcome: "non_match",
      reason,
    });
  });

  it("uses half-open rule and monitoring windows", () => {
    expect(
      evaluateConversion(
        input({
          ruleVersion: {
            ...ruleVersion(),
            effectiveUntil: "2026-08-12T12:00:00.000Z",
          },
        }),
      ),
    ).toMatchObject({ reason: "rule_no_longer_effective" });

    expect(
      evaluateConversion(
        input({
          wallet: {
            ...input().wallet,
            monitoringEndsAt: "2026-08-12T12:00:00.000Z",
          },
        }),
      ),
    ).toMatchObject({ reason: "wallet_binding_expired" });
  });

  it("matches exact start boundaries and preserves an outcome before later unlink", () => {
    const exactStart = evaluateConversion(
      input({
        ruleVersion: {
          ...ruleVersion(),
          effectiveFrom: "2026-08-12T11:00:00.000Z",
        },
        evidence: solanaEvidence(
          nativeEvent({ eventTime: "2026-08-12T11:00:00.000Z" }),
        ),
        wallet: {
          ...input().wallet,
          unlinkedAt: "2026-08-12T11:30:00.000Z",
        },
      }),
    );

    expect(exactStart).toMatchObject({
      outcome: "match",
      conversionTime: "2026-08-12T11:00:00.000Z",
    });
  });

  it("reports consent withdrawal before natural expiry when both apply", () => {
    expect(
      evaluateConversion(
        input({
          wallet: {
            ...input().wallet,
            monitoringEndsAt: "2026-08-12T11:45:00.000Z",
            unlinkedAt: "2026-08-12T11:30:00.000Z",
          },
        }),
      ),
    ).toMatchObject({ reason: "wallet_binding_unlinked" });
  });

  it("never exposes the controlled wallet address in an evaluation result", () => {
    expect(JSON.stringify(evaluateConversion(input()))).not.toContain(
      walletAddress,
    );
    expect(
      JSON.stringify(
        evaluateConversion(
          input({
            evidence: solanaEvidence(
              nativeEvent({
                fromAddress: counterpartyAddress,
                toAddress: walletAddress,
              }),
            ),
          }),
        ),
      ),
    ).not.toContain(walletAddress);
  });

  it("canonicalizes equivalent offset instants deterministically", () => {
    const first = evaluateConversion(input());
    const second = evaluateConversion(
      input({
        evidence: solanaEvidence(
          nativeEvent({ eventTime: "2026-08-12T13:00:00.000+01:00" }),
        ),
      }),
    );
    expect(second).toEqual(first);
  });

  it("rejects prior-conversion context from another rule or future instant", () => {
    const wrongRule = input({
      priorConversion: {
        conversionFactId: "a0000000-0000-4000-8000-000000000001",
        ruleVersionId: "40000000-0000-4000-8000-000000000099",
        protectedWalletMappingId: mappingId,
        conversionTime: "2026-08-12T11:30:00.000Z",
      },
    });
    const future = input({
      priorConversion: {
        conversionFactId: "a0000000-0000-4000-8000-000000000001",
        ruleVersionId,
        protectedWalletMappingId: mappingId,
        conversionTime: "2026-08-12T12:00:00.001Z",
      },
    });

    expect(conversionEvaluationInputSchema.safeParse(wrongRule).success).toBe(
      false,
    );
    expect(conversionEvaluationInputSchema.safeParse(future).success).toBe(
      false,
    );
  });

  it("returns an explicit non-match for an equal-time retained conversion", () => {
    expect(
      evaluateConversion(
        input({
          priorConversion: {
            conversionFactId: "a0000000-0000-4000-8000-000000000001",
            ruleVersionId,
            protectedWalletMappingId: mappingId,
            conversionTime: "2026-08-12T12:00:00.000Z",
          },
        }),
      ),
    ).toMatchObject({
      outcome: "non_match",
      reason: "prior_conversion_exists",
    });
  });

  it("rejects wallet-binding evidence for another protected mapping", () => {
    expect(
      conversionEvaluationInputSchema.safeParse(
        input({
          ruleVersion: ruleVersion("wallet_connected"),
          evidence: {
            kind: "wallet_binding",
            protectedWalletMappingId: "50000000-0000-4000-8000-000000000099",
          },
        }),
      ).success,
    ).toBe(false);
  });
});
