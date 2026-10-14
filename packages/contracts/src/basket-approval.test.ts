import { describe, expect, it } from "vitest";
import type { z } from "zod";
import timedDatabaseReview from "./fixtures/bsk09-timed-review.json";
import {
  commercialPlanReviewSchema,
  commercialPlanSnapshotSchema,
  draftFromPreparedBasket,
  getPreparedBasket,
  retainedCommercialPlanSnapshotSchema,
  strategyBoundCommercialPlanSnapshotSchema,
  timedStrategyCommercialPlanSnapshotSchema,
  type StrategyBoundCommercialPlanSnapshot,
} from "./index";

const id = (n: number) =>
  `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function candidate(): StrategyBoundCommercialPlanSnapshot {
  const draft = draftFromPreparedBasket(
    getPreparedBasket("investor_reach", 1)!,
    [id(4), id(5)],
  );
  draft.strategy.measurement!.conversionRuleVersionId = id(6);
  return {
    schemaVersion: 2,
    workspaceId: id(1),
    projectId: id(2),
    basket: {
      id: id(3),
      name: draft.name,
      objective: "Increase qualified wallets",
      outcomeProfile: {
        metric: "qualified_wallets",
        baselineUnits: "0",
        targetUnits: "100",
      },
    },
    scenario: { id: id(7), code: "A", name: "Focused authority" },
    packages: [
      {
        id: id(8),
        creatorId: id(4),
        packageLabel: "Research",
        deliverableSummary: "One research thread",
        sourceRateQuoteId: null,
        compensationLines: [
          {
            id: id(9),
            model: "fixed",
            assetType: "cash",
            amountMinor: "127500",
            currencyCode: "GBP",
          },
        ],
      },
    ],
    strategyBinding: {
      schemaVersion: 1,
      revision: 3,
      origin: draft.origin,
      strategy: draft.strategy,
      selectedCreatorIds: draft.selectedCreatorIds,
      measurementWindow: {
        startedAt: "2026-09-14T00:00:00.000Z",
        endedAt: "2026-10-12T00:00:00.000Z",
      },
      conversionRule: {
        id: id(6),
        ruleId: id(10),
        workspaceId: id(1),
        projectId: id(2),
        version: 1,
        templateCode: "first_qualifying_transaction",
        name: "Qualified product action",
        description: "A wallet completes its first qualifying transaction.",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        effectiveUntil: null,
        chain: "solana",
        requiresWalletBinding: true,
        minimumFinality: "finalized",
        valueMapping: "transfer_amount",
        revenueMapping: "none",
        attributionWindowSeconds: 604800,
        attributionModel: "last_eligible_creator_touch",
        programId: null,
        eventDiscriminator: null,
        evidenceCapability: "ready",
        changeReason: "Initial customer measurement",
        createdBy: id(11),
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    },
  };
}

function legacy() {
  const { basket, scenario, packages } = candidate();
  return { schemaVersion: 1 as const, basket, scenario, packages };
}

function timedCandidate() {
  const source = candidate();
  return {
    ...source,
    strategyBinding: {
      ...source.strategyBinding,
      schemaVersion: 2,
      timing: {
        schemaVersion: 1,
        flight: { ...source.strategyBinding.measurementWindow },
        measurement: { ...source.strategyBinding.measurementWindow },
      },
    },
  };
}

describe("BSK-09 timing-bound review candidate", () => {
  it("retains a valid one-microsecond window without rounding it closed", () => {
    const input = timedCandidate();
    const period = {
      startedAt: "2026-09-14T00:00:00.000001Z",
      endedAt: "2026-09-14T00:00:00.000002Z",
    };
    input.strategyBinding.measurementWindow = { ...period };
    input.strategyBinding.timing.flight = { ...period };
    input.strategyBinding.timing.measurement = { ...period };
    expect(timedStrategyCommercialPlanSnapshotSchema.parse(input)).toEqual(
      input,
    );
    input.strategyBinding.measurementWindow.endedAt = period.startedAt;
    input.strategyBinding.timing.flight.endedAt = period.startedAt;
    input.strategyBinding.timing.measurement.endedAt = period.startedAt;
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("decodes the actual isolated SQL timed review without dropping fields", () => {
    expect(
      timedStrategyCommercialPlanSnapshotSchema.parse(
        timedDatabaseReview.review_snapshot,
      ),
    ).toEqual(timedDatabaseReview.review_snapshot);
    expect(timedDatabaseReview.review_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("retains dates, strategy and exact package terms without input mutation", () => {
    const input = timedCandidate();
    expect(timedStrategyCommercialPlanSnapshotSchema.parse(input)).toEqual(
      input,
    );
  });
  it("accepts explicit postflight measurement", () => {
    const input = timedCandidate();
    input.strategyBinding.timing.flight.endedAt =
      input.strategyBinding.timing.flight.startedAt.replace(
        "T00:00:00",
        "T01:00:00",
      );
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(true);
  });
  it("old retained and live readers reject the new binding rather than dropping timing", () => {
    const input = timedCandidate();
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
    expect(retainedCommercialPlanSnapshotSchema.safeParse(input).success).toBe(
      false,
    );
    expect(
      commercialPlanReviewSchema.safeParse({
        snapshot: input,
        snapshotHash: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
  it("does not upgrade old snapshots or invent flight dates", () => {
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(candidate()).success,
    ).toBe(false);
    expect(
      retainedCommercialPlanSnapshotSchema.safeParse(candidate()).success,
    ).toBe(true);
  });
  it("rejects measurement mismatch at microsecond precision", () => {
    const input = timedCandidate();
    input.strategyBinding.measurementWindow.endedAt =
      input.strategyBinding.measurementWindow.endedAt.replace(
        ".000Z",
        ".000001Z",
      );
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("preserves existing commercial and strategy validation", () => {
    const input = timedCandidate();
    input.strategyBinding.strategy.goal = null;
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("preserves rule coverage validation", () => {
    const input = timedCandidate();
    input.strategyBinding.conversionRule.effectiveUntil =
      input.strategyBinding.measurementWindow.startedAt;
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects a rule starting one microsecond after measurement", () => {
    const input = timedCandidate();
    input.strategyBinding.conversionRule.effectiveFrom =
      "2026-09-14T00:00:00.000001Z";
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects measurement one microsecond beyond rule coverage", () => {
    const input = timedCandidate();
    input.strategyBinding.conversionRule.effectiveUntil =
      "2026-10-12T00:00:00.000Z";
    input.strategyBinding.measurementWindow.endedAt =
      "2026-10-12T00:00:00.000001Z";
    input.strategyBinding.timing.measurement.endedAt =
      "2026-10-12T00:00:00.000001Z";
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
});

describe("BSK-09 candidate strategy-bound approval record", () => {
  it("retains prepared provenance, strategy revision, full shortlist and exact scenario terms", () => {
    const input = candidate();
    expect(strategyBoundCommercialPlanSnapshotSchema.parse(input)).toEqual(
      input,
    );
    expect(input.strategyBinding.selectedCreatorIds).toHaveLength(2);
    expect(input.packages).toHaveLength(1);
    expect(input.packages[0]!.compensationLines[0]).toMatchObject({
      amountMinor: "127500",
      currencyCode: "GBP",
    });
  });
  it("supports custom strategies without fabricated template origin", () => {
    const input = candidate();
    input.strategyBinding.origin = { kind: "custom" };
    expect(
      strategyBoundCommercialPlanSnapshotSchema.parse(input).strategyBinding
        .origin,
    ).toEqual({ kind: "custom" });
  });
  it("reads a historical V1 unchanged without adding strategy or dates", () => {
    const old = legacy();
    expect(retainedCommercialPlanSnapshotSchema.parse(old)).toEqual(old);
    expect(commercialPlanSnapshotSchema.parse(old)).toEqual(old);
  });
  it("does not enable V2 in the live approval review reader", () => {
    expect(
      commercialPlanReviewSchema.safeParse({
        snapshot: candidate(),
        snapshotHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      retainedCommercialPlanSnapshotSchema.parse(candidate()).schemaVersion,
    ).toBe(2);
  });
  it.each([0, 3, "2", null])(
    "rejects unknown snapshot version %s",
    (schemaVersion) => {
      expect(
        retainedCommercialPlanSnapshotSchema.safeParse({
          ...candidate(),
          schemaVersion,
        }).success,
      ).toBe(false);
    },
  );
  it("does not silently strip a strategy from a mislabeled V1 record", () => {
    expect(
      retainedCommercialPlanSnapshotSchema.safeParse({
        ...candidate(),
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });
  it.each(["goal", "audience", "rationale", "measurement"] as const)(
    "requires %s at approval rather than draft stage",
    (field) => {
      const input = candidate();
      input.strategyBinding.strategy[field] = null;
      expect(
        strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
      ).toBe(false);
    },
  );
  it("requires 100% allocation without turning planned share into commercial spend", () => {
    const input = candidate();
    input.strategyBinding.strategy.allocations[0]!.plannedSpendBps--;
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
    expect(input.packages[0]!.compensationLines[0]).toMatchObject({
      amountMinor: "127500",
    });
  });
  it("retains the private-link exception only for an explicitly unpaid timed plan", () => {
    const privateReview = JSON.parse(
      JSON.stringify(timedDatabaseReview.review_snapshot),
    ) as z.infer<typeof timedStrategyCommercialPlanSnapshotSchema>;
    privateReview.strategyBinding.origin = { kind: "custom" };
    privateReview.strategyBinding.selectedCreatorIds = [
      privateReview.packages[0]!.creatorId,
    ];
    privateReview.strategyBinding.strategy.allocations = [];
    privateReview.strategyBinding.strategy.distributionMode =
      "unpaid_private_link";
    privateReview.packages = [privateReview.packages[0]!];
    privateReview.packages[0]!.compensationLines = [];
    privateReview.packages[0]!.commercialDetail = {
      schemaVersion: 2,
      revision: 1,
      creatorDisplayName: "Internal participant",
      deliveryDeadline: null,
      usageRights: null,
      exclusivity: null,
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet proof",
      channels: [],
    };
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(privateReview)
        .success,
    ).toBe(true);
    const { timing: ignoredTiming, ...baseBinding } =
      privateReview.strategyBinding;
    void ignoredTiming;
    const baseReview = {
      ...privateReview,
      strategyBinding: { ...baseBinding, schemaVersion: 1 },
    };
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(baseReview).success,
    ).toBe(true);
    privateReview.packages[0]!.commercialDetail.commercialBasis = "compensated";
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse(privateReview)
        .success,
    ).toBe(false);
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse({
        ...baseReview,
        packages: privateReview.packages,
      }).success,
    ).toBe(false);
    privateReview.packages[0]!.commercialDetail.commercialBasis =
      "unpaid_internal_test";
    privateReview.packages[0]!.compensationLines = [
      {
        id: id(99),
        model: "fixed",
        assetType: "cash",
        amountMinor: "1",
        currencyCode: "GBP",
      },
    ];
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse({
        ...baseReview,
        packages: privateReview.packages,
      }).success,
    ).toBe(false);
  });
  it("rejects a paid snapshot relabelled private without commercial evidence", () => {
    const input = candidate();
    input.strategyBinding.strategy.distributionMode = "unpaid_private_link";
    input.strategyBinding.strategy.allocations = [];
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
    expect(retainedCommercialPlanSnapshotSchema.safeParse(input).success).toBe(
      false,
    );
  });
  it.each(["projectId", "workspaceId", "id"] as const)(
    "rejects a mismatched rule %s",
    (field) => {
      const input = candidate();
      input.strategyBinding.conversionRule[field] = id(99);
      expect(
        strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
      ).toBe(false);
    },
  );
  it("requires the scenario and strategy outcome to agree", () => {
    const input = candidate();
    input.basket.outcomeProfile.metric = "average_order_value";
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects verified revenue even when transfer value and currency are present", () => {
    const input = candidate();
    input.basket.outcomeProfile.metric = "verified_revenue";
    input.basket.outcomeProfile.currencyCode = "GBP";
    input.strategyBinding.strategy.measurement!.primaryOutcome =
      "verified_revenue";
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it.each([
    ["2026-09-14T00:00:00.000Z", "2026-09-14T00:00:00.000Z"],
    ["2026-10-12T00:00:00.000Z", "2026-09-14T00:00:00.000Z"],
    ["2026-08-31T23:59:59.000Z", "2026-10-12T00:00:00.000Z"],
  ])(
    "rejects an invalid or uncovered measurement window",
    (startedAt, endedAt) => {
      const input = candidate();
      input.strategyBinding.measurementWindow = { startedAt, endedAt };
      expect(
        strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
      ).toBe(false);
    },
  );
  it("uses an end-exclusive window and rejects partial rule coverage", () => {
    const input = candidate();
    input.strategyBinding.conversionRule.effectiveUntil =
      input.strategyBinding.measurementWindow.endedAt;
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(true);
    input.strategyBinding.conversionRule.effectiveUntil =
      "2026-10-11T23:59:59.000Z";
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects unsupported programme evidence rather than treating configuration as execution", () => {
    const input = candidate();
    Object.assign(input.strategyBinding.conversionRule, {
      templateCode: "programme_action",
      evidenceCapability: "requires_programme_decoder",
      programId: "11111111111111111111111111111111",
      eventDiscriminator: "register",
    });
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects transaction evidence without finalized requirements", () => {
    const input = candidate();
    input.strategyBinding.conversionRule.minimumFinality = "not_applicable";
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects duplicate package identity and creators outside the shortlist", () => {
    const input = candidate();
    input.packages.push(input.packages[0]!);
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
    input.packages.pop();
    input.packages[0]!.creatorId = id(99);
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("keeps distinct compensation for multiple selected creators", () => {
    const input = candidate();
    input.packages.push({
      ...input.packages[0]!,
      id: id(12),
      creatorId: id(5),
      compensationLines: [
        {
          id: id(13),
          model: "fixed",
          assetType: "cash",
          currencyCode: "GBP",
          amountMinor: "392000",
        },
      ],
    });
    expect(
      strategyBoundCommercialPlanSnapshotSchema
        .parse(input)
        .packages.map((p) => p.compensationLines[0]),
    ).toEqual(input.packages.map((p) => p.compensationLines[0]));
  });
  it("rejects multiple packages for one creator to match campaign roster uniqueness", () => {
    const input = candidate();
    input.packages.push({ ...input.packages[0]!, id: id(12) });
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it("rejects transaction settings inconsistent with the stored rule contract", () => {
    const input = candidate();
    input.strategyBinding.conversionRule.valueMapping = "none";
    expect(
      strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
    ).toBe(false);
  });
  it.each(["programId", "eventDiscriminator"] as const)(
    "rejects a stray %s on a non-programme rule",
    (field) => {
      const input = candidate();
      input.strategyBinding.conversionRule[field] =
        field === "programId" ? "11111111111111111111111111111111" : "register";
      expect(
        strategyBoundCommercialPlanSnapshotSchema.safeParse(input).success,
      ).toBe(false);
    },
  );
});
