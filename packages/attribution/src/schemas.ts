import { solanaAddressSchema } from "@landed/solana";
import { z } from "zod";

export const conversionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("native_lamports"),
    rawAmount: z.string().regex(/^[1-9]\d*$/),
    decimals: z.literal(9),
  }),
  z.strictObject({
    kind: z.literal("token_base_units"),
    rawAmount: z.string().regex(/^[1-9]\d*$/),
    decimals: z.number().int().min(0).max(255),
    tokenMint: solanaAddressSchema,
  }),
]);

export type ConversionValue = z.infer<typeof conversionValueSchema>;
