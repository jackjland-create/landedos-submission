import { describe, expect, it } from "vitest";
import {
  packageCommercialDetailInputSchema,
  timedStrategyCommercialPlanSnapshotSchema,
} from "./index";
import fixture from "./fixtures/bsk09-timed-review.json";

const id = "40000000-0000-4000-8000-000000000001";
const detail = {
  schemaVersion: 1,
  channelIds: [id],
  deliveryDeadline: "2026-10-01T12:30:00.123456Z",
  usageRights: "Organic repost for 30 days only.",
  exclusivity: null,
};
describe("versioned retained commercial detail", () => {
  it("preserves exact sub-millisecond deadlines and rejects duplicate/unknown input shapes", () => {
    expect(packageCommercialDetailInputSchema.parse(detail)).toEqual(detail);
    for (const change of [
      { schemaVersion: 2 },
      { channelIds: [id, id] },
      { autoApprove: true },
      { deliveryDeadline: "2026-10-01T12:30:00+01:00" },
      { usageRights: " " },
    ])
      expect(
        packageCommercialDetailInputSchema.safeParse({ ...detail, ...change })
          .success,
      ).toBe(false);
  });
  it("retains present detail without stripping it and never fills old records", () => {
    const old = timedStrategyCommercialPlanSnapshotSchema.parse(
      fixture.review_snapshot,
    );
    expect(old.packages[0]).not.toHaveProperty("commercialDetail");
    const retained = {
      schemaVersion: 1,
      revision: 3,
      creatorDisplayName: "Synthetic creator",
      channels: [{ id, channelType: "x", handle: "@synthetic" }],
      deliveryDeadline: detail.deliveryDeadline,
      usageRights: detail.usageRights,
      exclusivity: null,
    };
    const source = {
      ...old,
      packages: old.packages.map((p) => ({ ...p, commercialDetail: retained })),
    };
    expect(
      timedStrategyCommercialPlanSnapshotSchema.parse(source).packages[0]
        ?.commercialDetail,
    ).toEqual(retained);
    expect(
      timedStrategyCommercialPlanSnapshotSchema.safeParse({
        ...source,
        packages: [
          {
            ...source.packages[0],
            commercialDetail: { ...retained, schemaVersion: 2 },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires an explicit reason for an unpaid internal test", () => {
    const unpaid = {
      ...detail,
      schemaVersion: 2,
      commercialBasis: "unpaid_internal_test",
      unpaidReason: "Approved internal devnet response proof.",
    } as const;
    expect(packageCommercialDetailInputSchema.parse(unpaid)).toEqual(unpaid);
    expect(
      packageCommercialDetailInputSchema.safeParse({
        ...unpaid,
        unpaidReason: null,
      }).success,
    ).toBe(false);
    expect(
      packageCommercialDetailInputSchema.safeParse({
        ...unpaid,
        commercialBasis: "compensated",
      }).success,
    ).toBe(false);
  });
});
