import { z } from "zod";

import {
  heliusEnhancedTransactionSchema,
  solanaAddressSchema,
  transactionSignatureSchema,
  type HeliusEnhancedTransaction,
} from "./provider";

const normalizationContextSchema = z.object({
  ingestedAt: z.iso.datetime({ offset: true }),
  projectId: z.uuid(),
  rawEvidenceId: z.uuid(),
  source: z.enum(["helius_webhook", "helius_backfill"]),
  sourceEventId: z.uuid(),
  workspaceId: z.uuid(),
});

const maximumUnsigned64BitInteger = 18_446_744_073_709_551_615n;
const positiveUnsigned64BitIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d{0,19}$/)
  .refine((value) => BigInt(value) <= maximumUnsigned64BitInteger, {
    error: "Solana transfer amount must fit in an unsigned 64-bit integer.",
  });

const canonicalBaseSchema = z.object({
  chain: z.literal("solana"),
  eventTime: z.iso.datetime({ offset: true }),
  id: z.string().min(1).max(200),
  ingestedAt: z.iso.datetime({ offset: true }),
  projectId: z.uuid(),
  rawEvidenceId: z.uuid(),
  schemaVersion: z.literal(1),
  slot: z.string().regex(/^\d+$/),
  source: z.enum(["helius_webhook", "helius_backfill"]),
  sourceEventId: z.uuid(),
  sourceTransferIndex: z.number().int().min(0).max(511),
  transactionSignature: transactionSignatureSchema,
  workspaceId: z.uuid(),
});

const canonicalNativeTransferSchema = canonicalBaseSchema.extend({
  eventName: z.literal("solana.native_transfer"),
  fromAddress: solanaAddressSchema,
  nativeAmountLamports: positiveUnsigned64BitIntegerStringSchema,
  sourceTransferKind: z.literal("native_transfer"),
  toAddress: solanaAddressSchema,
});

const canonicalTokenTransferSchema = canonicalBaseSchema.extend({
  eventName: z.literal("solana.token_transfer"),
  fromAddress: solanaAddressSchema.nullable(),
  fromTokenAccount: solanaAddressSchema,
  sourceTransferKind: z.literal("token_transfer"),
  toAddress: solanaAddressSchema.nullable(),
  toTokenAccount: solanaAddressSchema,
  tokenAmountRaw: positiveUnsigned64BitIntegerStringSchema,
  tokenDecimals: z.number().int().min(0).max(255),
  tokenMint: solanaAddressSchema,
});

export const canonicalSolanaTransferSchema = z.discriminatedUnion("eventName", [
  canonicalNativeTransferSchema,
  canonicalTokenTransferSchema,
]);

export const solanaNormalizationIssueSchema = z.discriminatedUnion(
  "sourceTransferKind",
  [
    z.object({
      code: z.enum([
        "native_transfer_missing_account",
        "native_transfer_zero_amount",
      ]),
      sourceTransferIndex: z.number().int().min(0).max(511),
      sourceTransferKind: z.literal("native_transfer"),
    }),
    z.object({
      code: z.enum([
        "token_transfer_ambiguous_balance_evidence",
        "token_transfer_mismatched_balance_evidence",
        "token_transfer_missing_balance_evidence",
        "token_transfer_missing_token_account",
      ]),
      sourceTransferIndex: z.number().int().min(0).max(511),
      sourceTransferKind: z.literal("token_transfer"),
    }),
    z.object({
      code: z.literal("transaction_failed"),
      sourceTransferIndex: z.null(),
      sourceTransferKind: z.literal("transaction"),
    }),
  ],
);

export type CanonicalSolanaTransfer = z.infer<
  typeof canonicalSolanaTransferSchema
>;
export type SolanaNormalizationIssue = z.infer<
  typeof solanaNormalizationIssueSchema
>;
export type SolanaNormalizationContext = z.infer<
  typeof normalizationContextSchema
>;

export type SolanaNormalizationResult = {
  events: CanonicalSolanaTransfer[];
  issues: SolanaNormalizationIssue[];
};

export class SolanaNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaNormalizationError";
  }
}

function canonicalIsoInstant(value: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new SolanaNormalizationError(
      "Source timestamp cannot be represented canonically.",
    );
  }

  return instant.toISOString();
}

function eventTimeFromUnixSeconds(timestamp: number) {
  if (timestamp > 253_402_300_799) {
    throw new SolanaNormalizationError(
      "Helius event timestamp is outside the canonical ISO range.",
    );
  }

  const eventTime = new Date(timestamp * 1_000).toISOString();
  if (!z.iso.datetime({ offset: true }).safeParse(eventTime).success) {
    throw new SolanaNormalizationError(
      "Helius event timestamp cannot be represented canonically.",
    );
  }

  return eventTime;
}

function sourceId(
  sourceEventId: string,
  kind: "native_transfer" | "token_transfer",
  index: number,
) {
  return `${sourceEventId}:${kind}:${index}`;
}

function baseEvent(
  transaction: HeliusEnhancedTransaction,
  context: SolanaNormalizationContext,
  eventTime: string,
  kind: "native_transfer" | "token_transfer",
  index: number,
) {
  return {
    chain: "solana" as const,
    eventTime,
    id: sourceId(context.sourceEventId, kind, index),
    ingestedAt: context.ingestedAt,
    projectId: context.projectId,
    rawEvidenceId: context.rawEvidenceId,
    schemaVersion: 1 as const,
    slot: String(transaction.slot),
    source: context.source,
    sourceEventId: context.sourceEventId,
    sourceTransferIndex: index,
    transactionSignature: transaction.signature,
    workspaceId: context.workspaceId,
  };
}

type TokenBalanceChange =
  HeliusEnhancedTransaction["accountData"][number]["tokenBalanceChanges"][number];

function tokenBalanceChanges(transaction: HeliusEnhancedTransaction) {
  return transaction.accountData.flatMap((account) =>
    account.tokenBalanceChanges.map((change) => ({
      ...change,
      accountAddress: account.account,
      rawAmount: BigInt(change.rawTokenAmount.tokenAmount),
    })),
  );
}

export function normalizeHeliusEnhancedTransaction(
  input: HeliusEnhancedTransaction,
  inputContext: SolanaNormalizationContext,
): SolanaNormalizationResult {
  const parsedTransaction = heliusEnhancedTransactionSchema.safeParse(input);
  const parsedContext = normalizationContextSchema.safeParse(inputContext);

  if (!parsedTransaction.success || !parsedContext.success) {
    throw new SolanaNormalizationError(
      "Helius normalization input or source context is invalid.",
    );
  }

  const transaction = parsedTransaction.data;
  const context = {
    ...parsedContext.data,
    ingestedAt: canonicalIsoInstant(parsedContext.data.ingestedAt),
  };
  const eventTime = eventTimeFromUnixSeconds(transaction.timestamp);
  const events: CanonicalSolanaTransfer[] = [];
  const issues: SolanaNormalizationIssue[] = [];

  if (transaction.transactionError != null) {
    return {
      events,
      issues: [
        {
          code: "transaction_failed",
          sourceTransferIndex: null,
          sourceTransferKind: "transaction",
        },
      ],
    };
  }

  transaction.nativeTransfers.forEach((transfer, index) => {
    if (!transfer.fromUserAccount || !transfer.toUserAccount) {
      issues.push({
        code: "native_transfer_missing_account",
        sourceTransferIndex: index,
        sourceTransferKind: "native_transfer",
      });
      return;
    }

    if (transfer.amount === 0) {
      issues.push({
        code: "native_transfer_zero_amount",
        sourceTransferIndex: index,
        sourceTransferKind: "native_transfer",
      });
      return;
    }

    events.push(
      canonicalNativeTransferSchema.parse({
        ...baseEvent(transaction, context, eventTime, "native_transfer", index),
        eventName: "solana.native_transfer",
        fromAddress: transfer.fromUserAccount,
        nativeAmountLamports: String(transfer.amount),
        sourceTransferKind: "native_transfer",
        toAddress: transfer.toUserAccount,
      }),
    );
  });

  const balances = tokenBalanceChanges(transaction);
  const tokenAccountUseCount = new Map<string, number>();
  for (const transfer of transaction.tokenTransfers) {
    for (const tokenAccount of [
      transfer.fromTokenAccount,
      transfer.toTokenAccount,
    ]) {
      if (!tokenAccount) continue;
      const key = `${transfer.mint}:${tokenAccount}`;
      tokenAccountUseCount.set(key, (tokenAccountUseCount.get(key) ?? 0) + 1);
    }
  }

  transaction.tokenTransfers.forEach((transfer, index) => {
    if (!transfer.fromTokenAccount || !transfer.toTokenAccount) {
      issues.push({
        code: "token_transfer_missing_token_account",
        sourceTransferIndex: index,
        sourceTransferKind: "token_transfer",
      });
      return;
    }

    if (
      (tokenAccountUseCount.get(
        `${transfer.mint}:${transfer.fromTokenAccount}`,
      ) ?? 0) !== 1 ||
      (tokenAccountUseCount.get(
        `${transfer.mint}:${transfer.toTokenAccount}`,
      ) ?? 0) !== 1
    ) {
      issues.push({
        code: "token_transfer_ambiguous_balance_evidence",
        sourceTransferIndex: index,
        sourceTransferKind: "token_transfer",
      });
      return;
    }

    const fromBalances = balances.filter(
      (balance) =>
        balance.mint === transfer.mint &&
        balance.tokenAccount === transfer.fromTokenAccount,
    );
    const toBalances = balances.filter(
      (balance) =>
        balance.mint === transfer.mint &&
        balance.tokenAccount === transfer.toTokenAccount,
    );

    if (fromBalances.length === 0 || toBalances.length === 0) {
      issues.push({
        code: "token_transfer_missing_balance_evidence",
        sourceTransferIndex: index,
        sourceTransferKind: "token_transfer",
      });
      return;
    }

    if (fromBalances.length !== 1 || toBalances.length !== 1) {
      issues.push({
        code: "token_transfer_ambiguous_balance_evidence",
        sourceTransferIndex: index,
        sourceTransferKind: "token_transfer",
      });
      return;
    }

    const fromBalance = fromBalances[0] as TokenBalanceChange & {
      accountAddress: string;
      rawAmount: bigint;
    };
    const toBalance = toBalances[0] as TokenBalanceChange & {
      accountAddress: string;
      rawAmount: bigint;
    };
    if (
      fromBalance.rawAmount >= 0n ||
      toBalance.rawAmount <= 0n ||
      -fromBalance.rawAmount !== toBalance.rawAmount ||
      fromBalance.accountAddress !== fromBalance.tokenAccount ||
      toBalance.accountAddress !== toBalance.tokenAccount ||
      fromBalance.rawTokenAmount.decimals !==
        toBalance.rawTokenAmount.decimals ||
      (transfer.fromUserAccount != null &&
        fromBalance.userAccount != null &&
        transfer.fromUserAccount !== fromBalance.userAccount) ||
      (transfer.toUserAccount != null &&
        toBalance.userAccount != null &&
        transfer.toUserAccount !== toBalance.userAccount)
    ) {
      issues.push({
        code: "token_transfer_mismatched_balance_evidence",
        sourceTransferIndex: index,
        sourceTransferKind: "token_transfer",
      });
      return;
    }

    events.push(
      canonicalTokenTransferSchema.parse({
        ...baseEvent(transaction, context, eventTime, "token_transfer", index),
        eventName: "solana.token_transfer",
        fromAddress:
          transfer.fromUserAccount ?? fromBalance.userAccount ?? null,
        fromTokenAccount: transfer.fromTokenAccount,
        sourceTransferKind: "token_transfer",
        toAddress: transfer.toUserAccount ?? toBalance.userAccount ?? null,
        toTokenAccount: transfer.toTokenAccount,
        tokenAmountRaw: toBalance.rawAmount.toString(),
        tokenDecimals: toBalance.rawTokenAmount.decimals,
        tokenMint: transfer.mint,
      }),
    );
  });

  return { events, issues };
}
