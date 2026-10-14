import { describe, expect, it } from "vitest";

import {
  canonicalSolanaTransferSchema,
  normalizeHeliusEnhancedTransaction,
  parseHeliusEnhancedWebhookPayload,
  SolanaNormalizationError,
} from "./index";
import fixture from "./fixtures/helius-enhanced-normalization.json";

const context = {
  ingestedAt: "2026-08-11T21:00:00.000Z",
  projectId: "65000000-0000-4000-8000-000000000003",
  rawEvidenceId: "65000000-0000-4000-8000-000000000006",
  source: "helius_webhook" as const,
  sourceEventId: "65000000-0000-4000-8000-000000000007",
  workspaceId: "65000000-0000-4000-8000-000000000001",
};

function transactionFromFixture() {
  return parseHeliusEnhancedWebhookPayload([structuredClone(fixture)])[0]!;
}

describe("canonical Solana transfer normalization", () => {
  it("normalizes native and token transfers with exact source evidence", () => {
    const result = normalizeHeliusEnhancedTransaction(
      transactionFromFixture(),
      context,
    );

    expect(result.issues).toEqual([]);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({
      chain: "solana",
      eventName: "solana.native_transfer",
      eventTime: "2026-08-11T18:40:00.000Z",
      fromAddress: "11111111111111111111111111111111",
      id: `${context.sourceEventId}:native_transfer:0`,
      ingestedAt: context.ingestedAt,
      nativeAmountLamports: "1000000",
      projectId: context.projectId,
      rawEvidenceId: context.rawEvidenceId,
      schemaVersion: 1,
      slot: "358000001",
      source: "helius_webhook",
      sourceEventId: context.sourceEventId,
      sourceTransferIndex: 0,
      sourceTransferKind: "native_transfer",
      toAddress: "So11111111111111111111111111111111111111112",
      transactionSignature: fixture.signature,
      workspaceId: context.workspaceId,
    });
    expect(result.events[1]).toMatchObject({
      eventName: "solana.token_transfer",
      fromTokenAccount: fixture.tokenTransfers[0].fromTokenAccount,
      rawEvidenceId: context.rawEvidenceId,
      sourceEventId: context.sourceEventId,
      sourceTransferIndex: 0,
      toTokenAccount: fixture.tokenTransfers[0].toTokenAccount,
      tokenAmountRaw: "4200000000",
      tokenDecimals: 9,
      tokenMint: fixture.tokenTransfers[0].mint,
    });
    expect(result.events[1]).not.toHaveProperty("finality");
    expect(result.events[1]).not.toHaveProperty("instructionIndex");
    expect(result.events[1]).not.toHaveProperty("usdValueAtEvent");
    expect(result.events[1]).not.toHaveProperty("protocolRevenueUsd");
    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...result.events[0],
        fromAddress: "2".repeat(32),
      }).success,
    ).toBe(false);
    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...result.events[0],
        transactionSignature: "2".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("derives token base units from paired balance evidence, not display floats", () => {
    const transaction = transactionFromFixture();
    transaction.tokenTransfers[0]!.tokenAmount = 999_999_999.123456;
    transaction.accountData[0]!.tokenBalanceChanges[0]!.rawTokenAmount.tokenAmount =
      "-9007199254740993123";
    transaction.accountData[1]!.tokenBalanceChanges[0]!.rawTokenAmount.tokenAmount =
      "9007199254740993123";
    transaction.accountData[0]!.tokenBalanceChanges[0]!.rawTokenAmount.decimals = 255;
    transaction.accountData[1]!.tokenBalanceChanges[0]!.rawTokenAmount.decimals = 255;

    const result = normalizeHeliusEnhancedTransaction(transaction, context);

    expect(result.issues).toEqual([]);
    expect(result.events[1]).toMatchObject({
      tokenAmountRaw: "9007199254740993123",
      tokenDecimals: 255,
    });

    const nativeEvent = result.events[0]!;
    const tokenEvent = result.events[1]!;
    const maximumUnsigned64BitInteger = "18446744073709551615";
    const aboveUnsigned64BitInteger = "18446744073709551616";

    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...nativeEvent,
        nativeAmountLamports: maximumUnsigned64BitInteger,
      }).success,
    ).toBe(true);
    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...nativeEvent,
        nativeAmountLamports: aboveUnsigned64BitInteger,
      }).success,
    ).toBe(false);
    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...tokenEvent,
        tokenAmountRaw: maximumUnsigned64BitInteger,
      }).success,
    ).toBe(true);
    expect(
      canonicalSolanaTransferSchema.safeParse({
        ...tokenEvent,
        tokenAmountRaw: aboveUnsigned64BitInteger,
      }).success,
    ).toBe(false);
  });

  it("retains valid facts and reports incomplete token evidence explicitly", () => {
    const transaction = transactionFromFixture();
    transaction.accountData.splice(1, 1);

    const result = normalizeHeliusEnhancedTransaction(transaction, context);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventName).toBe("solana.native_transfer");
    expect(result.issues).toEqual([
      {
        code: "token_transfer_missing_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
    ]);
  });

  it("rejects ambiguous or mismatched raw balance evidence", () => {
    const ambiguous = transactionFromFixture();
    ambiguous.accountData.push(structuredClone(ambiguous.accountData[1]!));
    expect(
      normalizeHeliusEnhancedTransaction(ambiguous, context).issues,
    ).toEqual([
      {
        code: "token_transfer_ambiguous_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
    ]);

    const reusedBalances = transactionFromFixture();
    reusedBalances.tokenTransfers.push(
      structuredClone(reusedBalances.tokenTransfers[0]!),
    );
    expect(
      normalizeHeliusEnhancedTransaction(reusedBalances, context).issues,
    ).toEqual([
      {
        code: "token_transfer_ambiguous_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
      {
        code: "token_transfer_ambiguous_balance_evidence",
        sourceTransferIndex: 1,
        sourceTransferKind: "token_transfer",
      },
    ]);

    const mismatched = transactionFromFixture();
    mismatched.accountData[1]!.tokenBalanceChanges[0]!.rawTokenAmount.tokenAmount =
      "4199999999";
    expect(
      normalizeHeliusEnhancedTransaction(mismatched, context).issues,
    ).toEqual([
      {
        code: "token_transfer_mismatched_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
    ]);

    const mismatchedOwner = transactionFromFixture();
    mismatchedOwner.accountData[1]!.tokenBalanceChanges[0]!.userAccount =
      "11111111111111111111111111111111";
    expect(
      normalizeHeliusEnhancedTransaction(mismatchedOwner, context).issues,
    ).toEqual([
      {
        code: "token_transfer_mismatched_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
    ]);

    const mismatchedParentAccount = transactionFromFixture();
    mismatchedParentAccount.accountData[1]!.account =
      "11111111111111111111111111111111";
    expect(
      normalizeHeliusEnhancedTransaction(mismatchedParentAccount, context)
        .issues,
    ).toEqual([
      {
        code: "token_transfer_mismatched_balance_evidence",
        sourceTransferIndex: 0,
        sourceTransferKind: "token_transfer",
      },
    ]);
  });

  it("does not create canonical facts for a failed transaction", () => {
    const transaction = transactionFromFixture();
    transaction.transactionError = { InstructionError: [0, "Custom"] };

    expect(normalizeHeliusEnhancedTransaction(transaction, context)).toEqual({
      events: [],
      issues: [
        {
          code: "transaction_failed",
          sourceTransferIndex: null,
          sourceTransferKind: "transaction",
        },
      ],
    });
  });

  it("fails closed for invalid context or an unrepresentable event time", () => {
    expect(() =>
      normalizeHeliusEnhancedTransaction(transactionFromFixture(), {
        ...context,
        sourceEventId: "not-a-uuid",
      }),
    ).toThrow(SolanaNormalizationError);

    const outsideCanonicalTime = transactionFromFixture();
    outsideCanonicalTime.timestamp = 253_402_300_800;
    expect(() =>
      normalizeHeliusEnhancedTransaction(outsideCanonicalTime, context),
    ).toThrow(SolanaNormalizationError);
  });

  it("uses the same deterministic output contract for historical input", () => {
    const result = normalizeHeliusEnhancedTransaction(
      transactionFromFixture(),
      { ...context, source: "helius_backfill" },
    );

    expect(result.events).toHaveLength(2);
    expect(
      result.events.every((event) => event.source === "helius_backfill"),
    ).toBe(true);
  });

  it("canonicalizes equivalent ingestion instants for deterministic replay", () => {
    const utc = normalizeHeliusEnhancedTransaction(transactionFromFixture(), {
      ...context,
      ingestedAt: "2026-08-11T21:00:00.000Z",
    });
    const offset = normalizeHeliusEnhancedTransaction(
      transactionFromFixture(),
      {
        ...context,
        ingestedAt: "2026-08-11T22:00:00.000+01:00",
      },
    );

    expect(offset).toEqual(utc);
    expect(offset.events[0]?.ingestedAt).toBe("2026-08-11T21:00:00.000Z");
  });
});
