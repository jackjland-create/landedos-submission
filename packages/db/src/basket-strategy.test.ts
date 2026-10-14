import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftFromPreparedBasket, getPreparedBasket } from "@landed/contracts";
import { getSavedBasketStrategy } from "./basket-strategy";

const projectId = "20000000-0000-4000-8000-000000000001";
const basketId = "90000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
function clientFor(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as SupabaseClient, chain, from };
}
describe("saved basket strategy read", () => {
  it("accepts the single-row composite-FK embed returned by PostgREST", async () => {
    const draft = draftFromPreparedBasket(
      getPreparedBasket("tradfi_bridge", 1)!,
    );
    const { client } = clientFor({
      id: basketId,
      name: "Saved list",
      basket_strategy_drafts: [
        { revision: 4, origin: draft.origin, strategy: draft.strategy },
      ],
      creator_packages: [],
    });
    expect(
      await getSavedBasketStrategy(client, projectId, basketId),
    ).toMatchObject({
      revision: 4,
      persistence: "saved",
      draft: { strategy: draft.strategy },
    });
  });
  it("accepts an empty embed for an unconfigured legacy basket", async () => {
    const { client } = clientFor({
      id: basketId,
      name: "Legacy",
      basket_strategy_drafts: [],
      creator_packages: [],
    });
    expect(
      await getSavedBasketStrategy(client, projectId, basketId),
    ).toMatchObject({ revision: 0, persistence: "legacy_unconfigured" });
  });
  it("rejects ambiguous multiple strategy rows", async () => {
    const draft = draftFromPreparedBasket(
      getPreparedBasket("tradfi_bridge", 1)!,
    );
    const row = { revision: 1, origin: draft.origin, strategy: draft.strategy };
    const { client } = clientFor({
      id: basketId,
      name: "Ambiguous",
      basket_strategy_drafts: [row, row],
      creator_packages: [],
    });
    await expect(
      getSavedBasketStrategy(client, projectId, basketId),
    ).rejects.toThrow();
  });
  it("resumes exact source, revision and package selection in one scoped statement", async () => {
    const draft = draftFromPreparedBasket(
      getPreparedBasket("tradfi_bridge", 1)!,
    );
    const { client, chain, from } = clientFor({
      id: basketId,
      name: "Our edit",
      basket_strategy_drafts: {
        revision: 3,
        origin: draft.origin,
        strategy: draft.strategy,
      },
      creator_packages: [{ creator_id: creatorId }],
    });
    const result = await getSavedBasketStrategy(client, projectId, basketId);
    expect(result).toMatchObject({
      revision: 3,
      persistence: "saved",
      draft: {
        name: "Our edit",
        origin: draft.origin,
        selectedCreatorIds: [creatorId],
      },
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(chain.eq.mock.calls).toEqual([
      ["project_id", projectId],
      ["id", basketId],
    ]);
  });
  it("does not invent a saved strategy for a legacy basket", async () => {
    const { client } = clientFor({
      id: basketId,
      name: "Existing",
      basket_strategy_drafts: null,
      creator_packages: [{ creator_id: creatorId }],
    });
    expect(
      await getSavedBasketStrategy(client, projectId, basketId),
    ).toMatchObject({
      revision: 0,
      persistence: "legacy_unconfigured",
      draft: { strategy: { goal: null }, selectedCreatorIds: [creatorId] },
    });
  });
  it("returns no basket for an RLS-hidden record", async () => {
    expect(
      await getSavedBasketStrategy(clientFor(null).client, projectId, basketId),
    ).toBeNull();
  });
  it("does not silently treat a missing migration or malformed stored record as a legacy draft", async () => {
    await expect(
      getSavedBasketStrategy(
        clientFor(null, { code: "42P01" }).client,
        projectId,
        basketId,
      ),
    ).rejects.toMatchObject({ code: "42P01" });
    await expect(
      getSavedBasketStrategy(
        clientFor({
          id: basketId,
          name: "Bad",
          basket_strategy_drafts: {
            revision: 1,
            origin: { kind: "made_up" },
            strategy: {},
          },
          creator_packages: [],
        }).client,
        projectId,
        basketId,
      ),
    ).rejects.toThrow();
  });
});
