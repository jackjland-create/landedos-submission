import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function hasBase58DecodedLength(value: string, expectedLength: number) {
  const bytes = [0];

  for (const character of value) {
    let carry = base58Alphabet.indexOf(character);
    if (carry < 0) return false;

    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === "1") leadingZeroBytes += 1;
  const significantBytes =
    bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;

  return leadingZeroBytes + significantBytes === expectedLength;
}

export const solanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .refine((value) => hasBase58DecodedLength(value, 32), {
    error: "Solana address must decode to 32 bytes.",
  });

export const transactionSignatureSchema = z
  .string()
  .min(64)
  .max(88)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .refine((value) => hasBase58DecodedLength(value, 64), {
    error: "Solana transaction signature must decode to 64 bytes.",
  });

const safeIntegerSchema = z.number().int().safe();
const maximumTokenBaseUnits = 18_446_744_073_709_551_615n;

const rawTokenAmountSchema = z
  .object({
    decimals: z.number().int().min(0).max(255),
    tokenAmount: z
      .string()
      .regex(/^-?\d{1,20}$/)
      .refine((value) => {
        if (!/^-?\d{1,20}$/.test(value)) return false;
        const amount = BigInt(value);
        return (
          amount >= -maximumTokenBaseUnits && amount <= maximumTokenBaseUnits
        );
      }),
  })
  .passthrough();

const tokenBalanceChangeSchema = z
  .object({
    mint: solanaAddressSchema,
    rawTokenAmount: rawTokenAmountSchema,
    tokenAccount: solanaAddressSchema,
    userAccount: solanaAddressSchema.nullable().optional(),
  })
  .passthrough();

const accountDataSchema = z
  .object({
    account: solanaAddressSchema,
    nativeBalanceChange: safeIntegerSchema,
    tokenBalanceChanges: z.array(tokenBalanceChangeSchema).max(256),
  })
  .passthrough();

const nativeTransferSchema = z
  .object({
    amount: safeIntegerSchema.nonnegative(),
    fromUserAccount: solanaAddressSchema.nullable(),
    toUserAccount: solanaAddressSchema.nullable(),
  })
  .passthrough();

const tokenTransferSchema = z
  .object({
    fromTokenAccount: solanaAddressSchema.nullable().optional(),
    fromUserAccount: solanaAddressSchema.nullable().optional(),
    mint: solanaAddressSchema,
    toTokenAccount: solanaAddressSchema.nullable().optional(),
    toUserAccount: solanaAddressSchema.nullable().optional(),
    tokenAmount: z.number().finite().nonnegative().optional(),
    tokenStandard: z.string().max(80).nullable().optional(),
  })
  .passthrough();

export const heliusEnhancedTransactionSchema = z
  .object({
    accountData: z.array(accountDataSchema).max(512).default([]),
    description: z.string().max(4_096).default(""),
    events: z.record(z.string(), z.unknown()).default({}),
    fee: safeIntegerSchema.nonnegative(),
    feePayer: solanaAddressSchema,
    nativeTransfers: z.array(nativeTransferSchema).max(512).default([]),
    signature: transactionSignatureSchema,
    slot: safeIntegerSchema.nonnegative(),
    source: z.string().min(1).max(120),
    timestamp: safeIntegerSchema.positive(),
    tokenTransfers: z.array(tokenTransferSchema).max(512).default([]),
    transactionError: z.unknown().nullable().optional(),
    type: z.string().min(1).max(120),
  })
  .passthrough();

export const heliusEnhancedWebhookPayloadSchema = z
  .array(heliusEnhancedTransactionSchema)
  .min(1)
  .max(100);

export type HeliusEnhancedTransaction = z.infer<
  typeof heliusEnhancedTransactionSchema
>;
export type HeliusEnhancedWebhookPayload = z.infer<
  typeof heliusEnhancedWebhookPayloadSchema
>;

export class HeliusWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeliusWebhookConfigError";
  }
}

export class HeliusWebhookAuthenticationError extends Error {
  constructor() {
    super("Helius webhook authentication failed.");
    this.name = "HeliusWebhookAuthenticationError";
  }
}

export class HeliusWebhookPayloadError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "HeliusWebhookPayloadError";
    this.cause = cause;
  }
}

function isCanonicalAuthValue(value: string) {
  return value.length >= 32 && value.length <= 512 && !/[\r\n\0]/.test(value);
}

function digestAuthValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function assertHeliusWebhookAuthorization(
  presentedAuthorization: string | null,
  expectedAuthorization: string,
) {
  if (!isCanonicalAuthValue(expectedAuthorization)) {
    throw new HeliusWebhookConfigError(
      "Helius webhook authorization must be a 32 to 512 character opaque value.",
    );
  }

  const presented = presentedAuthorization ?? "";
  const canonicalPresented = isCanonicalAuthValue(presented)
    ? presented
    : "invalid-helius-authorization-value";
  const expectedDigest = digestAuthValue(expectedAuthorization);
  const presentedDigest = digestAuthValue(canonicalPresented);

  if (!timingSafeEqual(expectedDigest, presentedDigest)) {
    throw new HeliusWebhookAuthenticationError();
  }
}

export function parseHeliusEnhancedWebhookPayload(input: unknown) {
  const parsed = heliusEnhancedWebhookPayloadSchema.safeParse(input);

  if (!parsed.success) {
    throw new HeliusWebhookPayloadError(
      "Helius enhanced webhook payload was not valid.",
      parsed.error,
    );
  }

  return parsed.data;
}
