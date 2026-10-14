import { z } from "zod";

import { transactionSignatureSchema } from "./provider";

const safeUnsignedIntegerSchema = z.number().int().nonnegative().safe();

const signatureStatusResponseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  jsonrpc: z.literal("2.0"),
  result: z.object({
    context: z.object({
      slot: safeUnsignedIntegerSchema,
    }),
    value: z
      .array(
        z
          .object({
            confirmationStatus: z.enum(["processed", "confirmed", "finalized"]),
            confirmations: safeUnsignedIntegerSchema.nullable(),
            err: z.unknown().nullable(),
            slot: safeUnsignedIntegerSchema,
            status: z.unknown(),
          })
          .nullable(),
      )
      .length(1),
  }),
});

export const finalizedSignatureEvidenceSchema = z.object({
  confirmationStatus: z.literal("finalized"),
  confirmations: z.null(),
  contextSlot: z.string().regex(/^\d+$/),
  method: z.literal("getSignatureStatuses"),
  rpcResponse: signatureStatusResponseSchema,
  signature: transactionSignatureSchema,
  transactionSlot: z.string().regex(/^\d+$/),
});

export type FinalizedSignatureEvidence = z.infer<
  typeof finalizedSignatureEvidenceSchema
>;

export class SolanaFinalityEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaFinalityEvidenceError";
  }
}

export function verifyFinalizedSignatureStatus(
  input: unknown,
  signature: string,
  expectedTransactionSlot: string,
): FinalizedSignatureEvidence {
  const parsedSignature = transactionSignatureSchema.safeParse(signature);
  const parsedExpectedSlot = z
    .string()
    .regex(/^\d+$/)
    .safeParse(expectedTransactionSlot);
  const parsedResponse = signatureStatusResponseSchema.safeParse(input);

  if (
    !parsedSignature.success ||
    !parsedExpectedSlot.success ||
    !parsedResponse.success
  ) {
    throw new SolanaFinalityEvidenceError(
      "Solana finality evidence is malformed.",
    );
  }

  const status = parsedResponse.data.result.value[0];
  if (
    status == null ||
    status.err !== null ||
    status.confirmationStatus !== "finalized" ||
    status.confirmations !== null ||
    String(status.slot) !== parsedExpectedSlot.data ||
    parsedResponse.data.result.context.slot < status.slot
  ) {
    throw new SolanaFinalityEvidenceError(
      "The Solana transaction is not finalized at the retained source slot.",
    );
  }

  return finalizedSignatureEvidenceSchema.parse({
    confirmationStatus: "finalized",
    confirmations: null,
    contextSlot: String(parsedResponse.data.result.context.slot),
    method: "getSignatureStatuses",
    rpcResponse: parsedResponse.data,
    signature: parsedSignature.data,
    transactionSlot: String(status.slot),
  });
}
