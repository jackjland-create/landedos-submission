import { expect, it } from "vitest";
import { commercialPlanApprovalRecordSchema } from "./index";
const record = {
  id: "10000000-0000-4000-8000-000000000001",
  scenarioId: "20000000-0000-4000-8000-000000000001",
  scenarioCode: "A",
  scenarioName: "Selected terms",
  version: 1,
  approvedBy: "30000000-0000-4000-8000-000000000001",
  approvedAt: "2026-09-22T10:00:00Z",
  snapshotHash: "a".repeat(64),
};
it("retains historic required reason while accepting an explicit v2 omitted note", () => {
  expect(
    commercialPlanApprovalRecordSchema.safeParse({
      ...record,
      reason: "Reviewed",
    }).success,
  ).toBe(true);
  expect(
    commercialPlanApprovalRecordSchema.safeParse({ ...record, reason: null })
      .success,
  ).toBe(false);
  expect(
    commercialPlanApprovalRecordSchema.safeParse({
      ...record,
      approvalRecordVersion: 1,
      reason: null,
    }).success,
  ).toBe(false);
  expect(
    commercialPlanApprovalRecordSchema.parse({
      ...record,
      approvalRecordVersion: 2,
      reason: null,
    }).reason,
  ).toBeNull();
});
