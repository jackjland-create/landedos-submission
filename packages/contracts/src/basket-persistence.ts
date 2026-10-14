import { z } from "zod";

import {
  basketStrategyDefinitionSchema,
  goalLedBasketDraftSchema,
} from "./basket-strategy";

const name = z.string().trim().min(1).max(120);
const creatorIds = goalLedBasketDraftSchema.shape.selectedCreatorIds;
const expectedRevision = z.number().int().min(0).max(2_147_483_646);

/** Creation uses a library reference, never client-authored template provenance. */
export const createGoalLedBasketInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("prepared"),
    templateKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(80),
    templateVersion: z.number().int().positive().max(2_147_483_647),
    name: name.optional(),
    creatorIds: creatorIds.default([]),
  }),
  z.strictObject({
    kind: z.literal("custom"),
    name,
    goal: z.string().trim().min(1).max(1000).optional(),
    audience: z.string().trim().min(1).max(1000).optional(),
    sector: z.string().trim().min(1).max(120).optional(),
    creatorIds: creatorIds.default([]),
  }),
]);

export const saveBasketStrategyInputSchema = z.strictObject({
  expectedRevision,
  name,
  strategy: basketStrategyDefinitionSchema,
});

export const addBasketCreatorsInputSchema = z.strictObject({
  expectedRevision: expectedRevision.min(1),
  creatorIds: creatorIds.min(1),
});

export const savedBasketStrategySchema = z.strictObject({
  basketId: z.uuid(),
  revision: expectedRevision,
  draft: goalLedBasketDraftSchema,
  // Legacy read is an unsaved projection, not a fabricated strategy record.
  persistence: z.enum(["saved", "legacy_unconfigured"]),
});
export type SavedBasketStrategy = z.infer<typeof savedBasketStrategySchema>;
