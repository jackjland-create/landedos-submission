import {
  draftCustomBasket,
  savedBasketStrategySchema,
  type SavedBasketStrategy,
} from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export class BasketStrategyQueryError extends Error {
  constructor(public readonly code?: string) {
    super("Basket strategy could not be loaded.");
    this.name = "BasketStrategyQueryError";
  }
}

/** One relational read keeps the draft revision and creator selection in one database snapshot. */
export async function getSavedBasketStrategy(
  client: SupabaseClient,
  projectId: string,
  basketId: string,
): Promise<SavedBasketStrategy | null> {
  z.uuid().parse(projectId);
  z.uuid().parse(basketId);
  const basket = await client
    .from("baskets")
    .select(
      "id, name, basket_strategy_drafts(revision, origin, strategy), creator_packages(creator_id)",
    )
    .eq("project_id", projectId)
    .eq("id", basketId)
    .maybeSingle();
  if (basket.error) throw new BasketStrategyQueryError(basket.error.code);
  if (!basket.data) return null;
  const strategyRecord = z.object({
    revision: z.number().int().positive(),
    origin: z.unknown(),
    strategy: z.unknown(),
  });
  // Composite foreign keys can be embedded as a list by PostgREST even when
  // basket_id is unique. Never choose silently between multiple strategies.
  const strategy = z
    .union([
      strategyRecord.nullable(),
      z
        .array(strategyRecord)
        .max(1)
        .transform((rows) => rows[0] ?? null),
    ])
    .parse(basket.data.basket_strategy_drafts);
  const rows = z
    .array(z.object({ creator_id: z.uuid() }))
    .parse(basket.data.creator_packages);
  const selectedCreatorIds = [
    ...new Set(rows.map((row) => row.creator_id)),
  ].sort();
  const basketName = z.string().parse(basket.data.name);
  return savedBasketStrategySchema.parse({
    basketId,
    revision: strategy?.revision ?? 0,
    persistence: strategy ? "saved" : "legacy_unconfigured",
    draft: strategy
      ? {
          schemaVersion: 1,
          name: basketName,
          origin: strategy.origin,
          strategy: strategy.strategy,
          selectedCreatorIds,
        }
      : draftCustomBasket({ name: basketName, selectedCreatorIds }),
  });
}
