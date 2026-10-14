import { describe, expect, it } from "vitest";

import {
  assessBasketStrategy,
  draftCustomBasket,
  draftFromPreparedBasket,
  getPreparedBasket,
  goalLedBasketDraftSchema,
  listPreparedBaskets,
  preparedBasketTemplateSchema,
  type GoalLedBasketDraft,
} from "./index";

const creatorA = "91000000-0000-4000-8000-000000000061";
const creatorB = "91000000-0000-4000-8000-000000000062";
const ruleVersionId = "92000000-0000-4000-8000-000000000001";

function prepared(): GoalLedBasketDraft {
  return draftFromPreparedBasket(getPreparedBasket("investor_reach", 1)!);
}

describe("BSK-07 goal-led basket drafts", () => {
  it("supports a custom goal before creator selection without requiring a template", () => {
    const draft = draftCustomBasket({
      name: "Our RWA launch",
      goal: "Generate qualified issuer registrations",
      audience: "Asset issuers",
      sector: "RWA and tokenisation",
    });
    expect(draft.origin).toEqual({ kind: "custom" });
    expect(draft.strategy.goal).not.toBe(draft.strategy.sector);
    expect(draft.strategy.audience).toBe("Asset issuers");
    expect(draft.selectedCreatorIds).toEqual([]);
    expect(assessBasketStrategy(draft).blockers.map((b) => b.field)).toContain(
      "selectedCreatorIds",
    );
  });

  it("preserves creator-first selection while identifying unfinished strategy fields", () => {
    const draft = draftCustomBasket({
      name: "Shortlist to review",
      selectedCreatorIds: [creatorA, creatorB],
    });
    expect(draft.selectedCreatorIds).toEqual([creatorA, creatorB]);
    expect(assessBasketStrategy(draft).blockers.map((b) => b.field)).toEqual([
      "strategy.goal",
      "strategy.audience",
      "strategy.rationale",
      "strategy.allocations",
      "strategy.measurement",
    ]);
  });

  it("models one unpaid private test without inventing planned channel spend", () => {
    const draft = draftCustomBasket({
      name: "Internal devnet proof",
      selectedCreatorIds: [creatorA],
    });
    draft.strategy.distributionMode = "unpaid_private_link";
    draft.strategy.goal = "One consented response";
    draft.strategy.audience = "Internal test participant";
    draft.strategy.rationale =
      "Use one private tracked link to test attribution.";
    draft.strategy.measurement = {
      primaryOutcome: "qualified_wallets",
      qualifyingAction: "First qualifying transaction",
      conversionRuleVersionId: ruleVersionId,
      attributionModel: "last_eligible_touch",
      attributionWindowDays: 7,
      leadingIndicators: [],
      retentionWindowDays: null,
      revenueTreatment: "verified_protocol_revenue_only",
    };
    expect(assessBasketStrategy(draft).blockers).toEqual([]);
    draft.strategy.allocations = [{ ...prepared().strategy.allocations[0]! }];
    expect(goalLedBasketDraftSchema.safeParse(draft).success).toBe(false);
    expect(
      assessBasketStrategy(draftCustomBasket({ name: "Paid" })).blockers.map(
        (blocker) => blocker.field,
      ),
    ).toContain("strategy.allocations");
  });

  it("retains exact prepared origin when the brand customises the strategy", () => {
    const draft = prepared();
    draft.strategy.goal = "Test a narrower segment";
    draft.strategy.sector = "RWA";
    draft.strategy.allocations[0]!.plannedSpendBps = 4000;
    draft.strategy.allocations[1]!.plannedSpendBps = 4000;
    const parsed = goalLedBasketDraftSchema.parse(draft);
    expect(parsed.origin).toMatchObject({
      kind: "prepared",
      templateKey: "investor_reach",
      templateVersion: 1,
      provenance: { kind: "editorial_starting_hypothesis" },
    });
    expect(prepared().strategy.goal).not.toBe(draft.strategy.goal);
    expect(prepared().strategy.allocations[0]!.plannedSpendBps).toBe(4500);
  });

  it("does not mutate the caller's selection when a draft is edited", () => {
    const selection = [creatorA];
    const draft = draftFromPreparedBasket(
      getPreparedBasket("tradfi_bridge", 1)!,
      selection,
    );
    draft.selectedCreatorIds.push(creatorB);
    expect(selection).toEqual([creatorA]);
  });

  it.each([[creatorA, creatorA], ["invalid"], Array(21).fill(creatorA)])(
    "rejects an invalid or duplicate selection %j",
    (...ids) => {
      expect(() =>
        draftCustomBasket({ name: "Custom", selectedCreatorIds: ids }),
      ).toThrow();
    },
  );

  it("rejects whitespace as a completed goal while allowing an explicit unfinished draft", () => {
    expect(() => draftCustomBasket({ name: "Draft", goal: "  " })).toThrow();
    expect(draftCustomBasket({ name: "Draft" }).strategy.goal).toBeNull();
  });

  it.each([10001, 10000.5, -1, 0])(
    "rejects malformed planned allocation totals or values: %s",
    (value) => {
      const draft = prepared();
      draft.strategy.allocations = [draft.strategy.allocations[0]!];
      draft.strategy.allocations[0]!.plannedSpendBps = value;
      expect(goalLedBasketDraftSchema.safeParse(draft).success).toBe(false);
    },
  );

  it.each([5000, 9999, 12000])(
    "preserves unfinished allocation totals %s as editable drafts with a blocker",
    (total) => {
      const draft = prepared();
      const first = {
        ...draft.strategy.allocations[0]!,
        plannedSpendBps: Math.floor(total / 2),
      };
      const second = {
        ...draft.strategy.allocations[1]!,
        plannedSpendBps: total - first.plannedSpendBps,
      };
      draft.strategy.allocations = [first, second];
      const saved = goalLedBasketDraftSchema.parse(
        JSON.parse(JSON.stringify(draft)),
      );
      expect(saved.strategy.allocations).toEqual(draft.strategy.allocations);
      expect(assessBasketStrategy(saved).blockers).toContainEqual({
        field: "strategy.allocations",
        message: "Adjust planned spend allocation to total 100% before review.",
      });
    },
  );

  it("rejects duplicate allocation cells even with valid 100% total", () => {
    const draft = prepared();
    const cell = { ...draft.strategy.allocations[0]!, plannedSpendBps: 5000 };
    draft.strategy.allocations = [
      cell,
      { ...cell, format: " RESEARCH THREAD " },
    ];
    expect(goalLedBasketDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("allows complementary formats within one channel and creator role", () => {
    const draft = prepared();
    const cell = { ...draft.strategy.allocations[0]!, plannedSpendBps: 5000 };
    draft.strategy.allocations = [cell, { ...cell, format: "Interview" }];
    expect(goalLedBasketDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("keeps project/rule/commercial review mandatory for a completely defined strategy", () => {
    const draft = prepared();
    draft.selectedCreatorIds = [creatorA];
    draft.strategy.measurement!.conversionRuleVersionId = ruleVersionId;
    expect(assessBasketStrategy(draft)).toEqual({
      status: "defined",
      blockers: [],
      nextGate: "project_rules_and_commercial_review",
    });
    expect(draft).not.toHaveProperty("approved");
  });

  it("requires a conversion reference independently of leading indicators", () => {
    const draft = prepared();
    draft.selectedCreatorIds = [creatorA];
    expect(assessBasketStrategy(draft).blockers).toEqual([
      {
        field: "strategy.measurement.conversionRuleVersionId",
        message:
          "Choose a project conversion definition before approval review.",
      },
    ]);
  });

  it("rejects revenue/attribution changes unsupported by the product contract", () => {
    const draft = prepared();
    const measurement = draft.strategy.measurement!;
    for (const override of [
      { revenueTreatment: "trading_volume" },
      { primaryOutcome: "deck_requests" },
      { attributionModel: "multi_touch" },
      { attributionWindowDays: 30 },
      { retentionWindowDays: 1 },
    ]) {
      expect(
        goalLedBasketDraftSchema.safeParse({
          ...draft,
          strategy: {
            ...draft.strategy,
            measurement: { ...measurement, ...override },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects invented performance fields and unsupported draft versions", () => {
    const draft = prepared();
    expect(
      goalLedBasketDraftSchema.safeParse({ ...draft, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      goalLedBasketDraftSchema.safeParse({
        ...draft,
        strategy: { ...draft.strategy, predictedRoas: 8 },
      }).success,
    ).toBe(false);
    expect(
      goalLedBasketDraftSchema.safeParse({ ...draft, approved: true }).success,
    ).toBe(false);
  });
});

describe("prepared basket library", () => {
  it("rejects incomplete published templates while drafts can remain unfinished", () => {
    const template = getPreparedBasket("investor_reach", 1)!;
    template.strategy.allocations = [];
    expect(preparedBasketTemplateSchema.safeParse(template).success).toBe(
      false,
    );
    const missingGoal = getPreparedBasket("investor_reach", 1)!;
    missingGoal.strategy.goal = null;
    expect(preparedBasketTemplateSchema.safeParse(missingGoal).success).toBe(
      false,
    );
  });
  it("provides materially different strategy mixes without binding a project rule or asserting results", () => {
    const templates = listPreparedBaskets();
    expect(templates.map((template) => template.key)).toEqual([
      "investor_reach",
      "tradfi_bridge",
      "high_velocity_consumer",
    ]);
    const channelLeads = templates.map(
      (template) =>
        [...template.strategy.allocations].sort(
          (a, b) => b.plannedSpendBps - a.plannedSpendBps,
        )[0]?.channel,
    );
    expect(channelLeads).toEqual(["x", "linkedin", "x"]);
    expect(
      templates[2]!.strategy.allocations.some(
        (a) => a.channel === "community_livestream",
      ),
    ).toBe(true);
    for (const template of templates) {
      expect(template.strategy.measurement?.conversionRuleVersionId).toBeNull();
      expect(template.strategy.missingEvidence.length).toBeGreaterThan(0);
      expect(template.strategy.assumptions.length).toBeGreaterThan(0);
      expect(template.provenance.kind).toBe("editorial_starting_hypothesis");
      expect(
        assessBasketStrategy(draftFromPreparedBasket(template)).status,
      ).toBe("incomplete");
    }
  });

  it("refuses unknown keys and versions instead of substituting a template", () => {
    expect(getPreparedBasket("unknown", 1)).toBeNull();
    expect(getPreparedBasket("investor_reach", 2)).toBeNull();
    expect(getPreparedBasket("investor_reach", 0)).toBeNull();
  });

  it("isolates nested library data across drafts and lookups", () => {
    const first = listPreparedBaskets();
    first[0]!.strategy.missingEvidence.length = 0;
    first[1]!.strategy.measurement!.leadingIndicators.push("Invented signal");
    first[0]!.provenance.sourceLabel = "Changed";
    const next = listPreparedBaskets();
    expect(next[0]!.strategy.missingEvidence.length).toBeGreaterThan(0);
    expect(next[1]!.strategy.measurement!.leadingIndicators).not.toContain(
      "Invented signal",
    );
    expect(next[0]!.provenance.sourceLabel).not.toBe("Changed");
  });
});
