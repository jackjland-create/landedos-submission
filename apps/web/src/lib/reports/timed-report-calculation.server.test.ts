import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  campaignMetricSnapshotSchema,
  type ContractedCostReview,
} from "@landed/analytics";
import retainedFixture from "./fixtures/retained-report-reconciled.json";
import { calculateTimedReportReview } from "./timed-report-calculation.server";

const inputPath = process.env.LANDED_TIMED_REPORT_INPUT;
if (inputPath && !inputPath.startsWith("/private/tmp/"))
  throw new Error("Use an isolated synthetic input artifact.");
const fixture: typeof retainedFixture = inputPath
  ? JSON.parse(readFileSync(inputPath, "utf8"))
  : retainedFixture;
const fresh = () => structuredClone(fixture);
const uuid = (n: number) =>
  `eeeeeeee-eeee-4eee-8eee-${n.toString().padStart(12, "0")}`;
const identity = () => ({
  reportApprovalId: uuid(1),
  executionApprovalId: fixture.evidence.executionReview.execution.approvalId,
  reportId: uuid(2),
  reportVersionId: uuid(3),
  metricSnapshotId: uuid(4),
  issueRequestId: uuid(5),
  requestedBy: fixture.evidence.conversion_rule_versions[0]!.created_by,
});
function costs(b = fresh()): ContractedCostReview {
  const s = b.evidence.executionReview.reportReview.reportSources;
  return {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    campaignId: s.campaignId,
    commercialPlanVersionId: s.commercialPlanVersionId,
    commercialPlanSnapshotHash: s.commercialPlanSnapshotHash,
    ruleVersionId: s.ruleVersionId,
    measurementWindow: { ...s.measurementWindow },
    policy: { basis: "contracted", version: 1 },
    currencyCode: "GBP",
    additionalCosts: "none_declared",
    decisions: s.commercialPlanSnapshot.packages.flatMap((p) =>
      p.compensationLines.map((l) => ({
        compensationLineId: l.id,
        inclusion: "included" as const,
        reason: "Reviewed agreed campaign compensation",
      })),
    ),
  };
}
const calculate = () =>
  calculateTimedReportReview(fresh(), costs(), identity());

describe("private timed report metric calculation", () => {
  it("never promotes a finalized transfer summary or cleanup acknowledgement into retained report sources", () => {
    // INT-01 / RPT-03: sanitized diagnostic shape only, not live evidence.
    // Finality and successful cleanup cannot replace the private joined loader.
    const summary = {
      schemaVersion: 1,
      status: "live_response_finalized_cleanup_verified_downstream_unproven",
      observedResponse: {
        nativeAmountLamports: "1",
        finality: "finalized",
        transactionError: null,
      },
      cleanup: { finalCleanupVerified: true },
    };
    const before = structuredClone(summary);
    for (const input of [summary, { ...summary, trusted: true }])
      expect(() =>
        calculateTimedReportReview(input, costs(), identity()),
      ).toThrow();
    expect(summary).toEqual(before);
  });
  it("calculates the actual joined-loader shape without treating its boundary marker as authorization", () => {
    const b = fresh();
    const s = b.evidence.executionReview.reportReview.reportSources;
    const boundary = {
      protocol: "landed:local-devnet-report-boundary:1",
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      campaignId: s.campaignId,
      executionId: identity().executionApprovalId,
    };
    const result = calculateTimedReportReview(
      { ...b, localDevnetBoundary: boundary },
      costs(b),
      identity(),
    );
    expect(result).toEqual(calculateTimedReportReview(b, costs(b), identity()));
    expect(result.approval).toBe("required");
    expect(result.disclosures.providerExhaustion).toBe(
      "not_independently_verified",
    );
    for (const key of [
      "workspaceId",
      "projectId",
      "campaignId",
      "executionId",
    ]) {
      expect(() =>
        calculateTimedReportReview(
          { ...b, localDevnetBoundary: { ...boundary, [key]: uuid(99) } },
          costs(b),
          identity(),
        ),
      ).toThrow("boundary");
    }
    for (const malformed of [
      { ...boundary, protocol: "unknown" },
      { ...boundary, executionId: "invalid" },
      { ...boundary, trusted: true },
    ])
      expect(() =>
        calculateTimedReportReview(
          { ...b, localDevnetBoundary: malformed },
          costs(b),
          identity(),
        ),
      ).toThrow();
    expect(() =>
      calculateTimedReportReview({ ...b, trusted: true }, costs(b), identity()),
    ).toThrow();
  });
  it("produces schema-valid exact contracted metrics bound to retained evidence, never authorization", () => {
    const b = fresh(),
      input = costs(b),
      ids = identity();
    const before = structuredClone({ b, input, ids });
    const result = calculateTimedReportReview(b, input, ids);
    expect(
      campaignMetricSnapshotSchema.safeParse(result.metricSnapshot).success,
    ).toBe(true);
    expect(result.sourceHash).toBe(b.sourceHash);
    expect(result.coverage.sourceHash).toBe(b.sourceHash);
    expect(result.commercialPlanSnapshotHash).toBe(
      input.commercialPlanSnapshotHash,
    );
    expect(result.measurementWindow).toEqual(input.measurementWindow);
    expect(result.identity).toEqual(ids);
    expect(result.metricSnapshot.id).toBe(ids.metricSnapshotId);
    expect(result.costReview.label).toBe("Reviewed contracted costs");
    expect(result.disclosures.costBasis).toBe("contracted_not_paid");
    expect(result.approval).toBe("required");
    expect(result.coverage.issuance).toBe("requires_separate_human_approval");
    const total =
      b.evidence.executionReview.reportReview.reportSources.commercialPlanSnapshot.packages
        .flatMap((p) => p.compensationLines)
        .reduce((sum, l) => sum + BigInt(l.amountMinor), 0n)
        .toString();
    expect(result.metricSnapshot.metrics.cpqw.numerator).toMatchObject({
      status: "available",
      valueMinor: total,
    });
    expect({ b, input, ids }).toEqual(before);
    // Explicit local opt-in exports to stdout only. The orchestration layer may
    // retain this synthetic calculation using apply_patch, never runtime writes.
    if (process.env.LANDED_EXPORT_TIMED_CALCULATION === "1")
      console.log(`TIMED_CALCULATION_JSON:${JSON.stringify(result)}`);
  });
  it("counts retained unique wallets and in-window clicks, not raw transactions", () => {
    const result = calculate();
    const s = fixture.evidence.executionReview.reportReview.reportSources;
    expect(result.metricSnapshot.metrics.cpqw.denominator).toMatchObject({
      status: "available",
      value: s.walletAttributionEvidenceIds.length,
    });
    expect(result.metricSnapshot.metrics.cpc.denominator).toMatchObject({
      status: "available",
      value: s.qualifiedClickEvidence.length,
    });
    expect(result.coverage.rawTransactionCount).toBe(
      fixture.evidence.raw_chain_events.length,
    );
    expect(result.metricSnapshot.metrics.cpqw.denominator).toMatchObject({
      value: 2,
    });
  });
  it("accepts microsecond rule-creation metadata without changing evaluator boundaries or mutating retained evidence", () => {
    const b = fresh();
    const rule =
      b.evidence.executionReview.reportReview.reportSources
        .commercialPlanSnapshot.strategyBinding.conversionRule;
    rule.createdAt = "2026-09-14T00:00:00.123456Z";
    b.evidence.conversion_rule_versions[0]!.created_at = rule.createdAt;
    const before = structuredClone(b);
    const result = calculateTimedReportReview(b, costs(b), identity());
    expect(result.metricSnapshot).toEqual(calculate().metricSnapshot);
    expect(result.approval).toBe("required");
    expect(b).toEqual(before);
  });
  it("still rejects unsupported audit precision and submillisecond evaluator boundaries", () => {
    for (const key of [
      "createdAt",
      "effectiveFrom",
      "effectiveUntil",
    ] as const) {
      const b = fresh();
      const rule = b.evidence.executionReview.reportReview.reportSources
        .commercialPlanSnapshot.strategyBinding.conversionRule as {
        createdAt: string;
        effectiveFrom: string;
        effectiveUntil: string | null;
      };
      rule[key] =
        key === "createdAt"
          ? "2026-09-14T00:00:00.1234567Z"
          : key === "effectiveFrom"
            ? "2026-09-01T00:00:00.000001Z"
            : "2026-12-01T00:00:00.000001Z";
      // Keep the synthetic immutable row and its snapshot coherent, so this
      // specifically exercises precision rather than the newer binding guard.
      const retained = b.evidence.conversion_rule_versions[0]! as Record<
        string,
        unknown
      >;
      retained[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] =
        rule[key];
      expect(() => calculateTimedReportReview(b, costs(b), identity())).toThrow(
        key === "createdAt"
          ? "microsecond precision"
          : "precision is unsupported",
      );
    }
  });
  it("keeps activation, protocol revenue and impressions unavailable", () => {
    const result = calculate();
    expect(result.disclosures).toMatchObject({
      activation: "not_available",
      protocolRevenue: "not_available",
      impressions: "not_available",
      providerExhaustion: "not_independently_verified",
    });
    expect(result.metricSnapshot.metrics.cpa).toMatchObject({
      status: "not_available",
      reason: "activated_wallets_not_available",
    });
    expect(result.metricSnapshot.metrics.revenueRoas).toMatchObject({
      status: "not_available",
      reason: "revenue_not_available",
    });
    expect(result.metricSnapshot.metrics).not.toHaveProperty("impressions");
  });
  it("retains precise observation time while metric V1 uses exact millisecond source boundaries", () => {
    const result = calculate();
    expect(result.coverage.checkedAt).toBe(fixture.checkedAt);
    const metric = result.metricSnapshot.metrics.cpqw;
    expect(metric.dataFreshness.dataThrough).toBe(
      new Date(result.measurementWindow.endedAt).toISOString(),
    );
    expect(metric.dataFreshness.calculatedAt).toBe(
      new Date(fixture.checkedAt).toISOString(),
    );
  });
  it.each([
    "workspaceId",
    "projectId",
    "campaignId",
    "ruleVersionId",
    "commercialPlanVersionId",
  ] as const)("rejects cost %s drift", (key) => {
    const input = costs();
    input[key] = uuid(99);
    expect(() =>
      calculateTimedReportReview(fresh(), input, identity()),
    ).toThrow();
  });
  it("rejects execution approval mismatch", () => {
    expect(() =>
      calculateTimedReportReview(fresh(), costs(), {
        ...identity(),
        executionApprovalId: uuid(99),
      }),
    ).toThrow("execution identity");
  });
  it("rejects a pending execution approval even when campaign-wide results exist", () => {
    const b = fresh();
    (b.evidence.executionReview.execution as { receipt: unknown }).receipt =
      null;
    expect(() => calculateTimedReportReview(b, costs(b), identity())).toThrow();
  });
  it.each(["approvalId", "reviewHash", "candidateTuple", "missingTuple"])(
    "rejects altered execution receipt %s",
    (kind) => {
      const b = fresh();
      const receipt = b.evidence.executionReview.execution.receipt;
      if (kind === "approvalId") receipt.approvalId = uuid(99);
      if (kind === "reviewHash") receipt.reviewHash = "f".repeat(64);
      if (kind === "candidateTuple")
        receipt.batch.results[0]!.conversionFactId = uuid(99);
      if (kind === "missingTuple") receipt.batch.results.pop();
      expect(() =>
        calculateTimedReportReview(b, costs(b), identity()),
      ).toThrow();
    },
  );
  it.each([
    "reportApprovalId",
    "reportId",
    "reportVersionId",
    "metricSnapshotId",
    "issueRequestId",
    "requestedBy",
  ] as const)("rejects malformed %s", (key) => {
    expect(() =>
      calculateTimedReportReview(fresh(), costs(), {
        ...identity(),
        [key]: "bad-id",
      }),
    ).toThrow();
  });
  it("rejects cost snapshot or measurement drift", () => {
    const input = costs();
    input.commercialPlanSnapshotHash = "f".repeat(64);
    expect(() =>
      calculateTimedReportReview(fresh(), input, identity()),
    ).toThrow("snapshot drift");
    const shifted = costs();
    shifted.measurementWindow.endedAt = "2026-09-22T00:00:00Z";
    expect(() =>
      calculateTimedReportReview(fresh(), shifted, identity()),
    ).toThrow("measurement drift");
  });
  it("rejects open measurement and missing retained evidence", () => {
    const b = fresh();
    b.checkedAt = "2026-09-20T00:00:00Z";
    expect(() => calculateTimedReportReview(b, costs(b), identity())).toThrow(
      "closed measurement",
    );
    const missing = fresh();
    missing.evidence.solana_finality_observations = [];
    expect(() =>
      calculateTimedReportReview(missing, costs(missing), identity()),
    ).toThrow();
  });
  it("rejects omitted cost decisions and supplied amounts", () => {
    const input = costs();
    input.decisions.pop();
    expect(() =>
      calculateTimedReportReview(fresh(), input, identity()),
    ).toThrow();
    expect(() =>
      calculateTimedReportReview(
        fresh(),
        { ...costs(), amountMinor: "1" },
        identity(),
      ),
    ).toThrow();
  });
  it("unknown extra costs suppress spend-derived metrics without suppressing evidenced counts", () => {
    const input = costs();
    input.additionalCosts = "unknown";
    const result = calculateTimedReportReview(fresh(), input, identity());
    expect(result.costReview.total).toMatchObject({
      status: "not_available",
      amountMinor: null,
    });
    expect(result.metricSnapshot.metrics.cpqw).toMatchObject({
      status: "not_available",
      reason: "spend_not_available",
      denominator: { status: "available", value: 2 },
    });
  });
  it("explicit cost exclusions produce source-backed zero, not a payment claim", () => {
    const input = costs();
    input.decisions.forEach((d) => {
      d.inclusion = "excluded";
      d.reason = "Explicit human cost exclusion";
    });
    const result = calculateTimedReportReview(fresh(), input, identity());
    expect(result.costReview.total).toMatchObject({
      status: "available",
      amountMinor: "0",
    });
    expect(result.metricSnapshot.metrics.cpqw.numerator).toMatchObject({
      status: "available",
      valueMinor: "0",
    });
    expect(result.disclosures.costBasis).toBe("contracted_not_paid");
  });
});
