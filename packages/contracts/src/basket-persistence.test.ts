import { describe, expect, it } from "vitest";
import {
  addBasketCreatorsInputSchema,
  createGoalLedBasketInputSchema,
  saveBasketStrategyInputSchema,
} from "./basket-persistence";
import { draftCustomBasket } from "./basket-strategy";

describe("BSK-08 persistence inputs", () => {
  it("permits an empty custom or prepared start", () => {
    expect(
      createGoalLedBasketInputSchema.parse({
        kind: "custom",
        name: "Investor plan",
      }).creatorIds,
    ).toEqual([]);
    expect(
      createGoalLedBasketInputSchema.parse({
        kind: "prepared",
        templateKey: "investor_reach",
        templateVersion: 1,
      }).creatorIds,
    ).toEqual([]);
  });
  it.each([
    { kind: "custom", name: " " },
    { kind: "prepared", templateKey: "investor_reach", templateVersion: 0 },
    { kind: "custom", name: "Draft", provenance: { kind: "verified" } },
    { kind: "custom", name: "Draft", creatorIds: ["foreign"] },
    {
      kind: "custom",
      name: "Draft",
      creatorIds: Array(2).fill("40000000-0000-4000-8000-000000000001"),
    },
  ])("rejects invalid setup %j", (input) =>
    expect(createGoalLedBasketInputSchema.safeParse(input).success).toBe(false),
  );
  it("permits legacy adoption at revision zero, with incomplete strategy", () => {
    const draft = draftCustomBasket({ name: "Existing roster" });
    expect(
      saveBasketStrategyInputSchema.parse({
        name: draft.name,
        strategy: draft.strategy,
        expectedRevision: 0,
      }).expectedRevision,
    ).toBe(0);
  });
  it.each([-1, 0.5, 2147483647, null])(
    "rejects invalid revision %s",
    (expectedRevision) => {
      expect(
        saveBasketStrategyInputSchema.safeParse({
          name: "Plan",
          strategy: draftCustomBasket({ name: "Plan" }).strategy,
          expectedRevision,
        }).success,
      ).toBe(false);
    },
  );
  it("does not permit save to silently replace origin or creator selection", () => {
    const draft = draftCustomBasket({ name: "Plan" });
    for (const extra of [{ origin: { kind: "custom" } }, { creatorIds: [] }]) {
      expect(
        saveBasketStrategyInputSchema.safeParse({
          name: "Plan",
          strategy: draft.strategy,
          expectedRevision: 1,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
  it("requires an existing strategy revision and a nonempty append selection", () => {
    expect(
      addBasketCreatorsInputSchema.safeParse({
        expectedRevision: 0,
        creatorIds: [],
      }).success,
    ).toBe(false);
  });
});
