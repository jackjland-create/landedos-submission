import { describe, expect, it } from "vitest";
import fixture from "./fixtures/timed-campaign-report-review.json";
import {
  buildContractedCostReview,
  type ContractedCostReview,
} from "./contracted-cost-review";

const sources = () => structuredClone(fixture.reportSources);
function review(raw = sources()): ContractedCostReview {
  return {
    workspaceId: raw.workspaceId,
    projectId: raw.projectId,
    campaignId: raw.campaignId,
    commercialPlanVersionId: raw.commercialPlanVersionId,
    commercialPlanSnapshotHash: raw.commercialPlanSnapshotHash,
    ruleVersionId: raw.ruleVersionId,
    measurementWindow: { ...raw.measurementWindow },
    policy: { basis: "contracted", version: 1 },
    currencyCode: "GBP",
    additionalCosts: "none_declared",
    decisions: raw.commercialPlanSnapshot.packages.flatMap((pkg) =>
      pkg.compensationLines.map((line) => ({
        compensationLineId: line.id,
        inclusion: "included" as const,
        reason: "Agreed campaign fee",
      })),
    ),
  };
}

describe("RPT-01 / BSK-09 source-backed contracted cost review", () => {
  it("retains all independent unavailability reasons without publishing a partial sum", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.model =
      "variable";
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.currencyCode =
      "USD";
    const input = review(raw);
    input.additionalCosts = "unknown";
    expect(buildContractedCostReview(raw, input).total).toEqual({
      status: "not_available",
      amountMinor: null,
      currencyCode: "GBP",
      reasons: [
        "additional_costs_unknown",
        "currency_mismatch",
        "variable_compensation",
      ],
    });
    input.decisions[0]!.inclusion = "excluded";
    expect(buildContractedCostReview(raw, input).total).toMatchObject({
      status: "not_available",
      reasons: ["additional_costs_unknown"],
    });
    input.additionalCosts = "none_declared";
    expect(buildContractedCostReview(raw, input).total.status).toBe(
      "available",
    );
  });
  it.each(["-1", "0.01", "9".repeat(79)])(
    "rejects unsupported source amounts: %s",
    (amount) => {
      const raw = sources();
      raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.amountMinor =
        amount;
      expect(() => buildContractedCostReview(raw, review(raw))).toThrow();
    },
  );
  it("unknown extras remain unavailable even when all approved costs are excluded", () => {
    const input = review();
    input.additionalCosts = "unknown";
    input.decisions.forEach((d) => (d.inclusion = "excluded"));
    expect(buildContractedCostReview(sources(), input).total).toMatchObject({
      status: "not_available",
      amountMinor: null,
    });
  });
  it("sums approved fixed fees, retaining source identity without asserting authorization or payment", () => {
    const raw = sources();
    const input = review(raw);
    const before = structuredClone({ raw, input });
    const result = buildContractedCostReview(raw, input);
    const expected = raw.commercialPlanSnapshot.packages
      .flatMap((p) => p.compensationLines)
      .reduce((n, l) => n + BigInt(l.amountMinor), 0n);
    expect(result.total).toEqual({
      status: "available",
      amountMinor: expected.toString(),
      currencyCode: "GBP",
    });
    expect(result.authorization).toBe("not_established");
    expect(result.issuance).toBe("not_authorized");
    expect(result.label).toBe("Reviewed contracted costs");
    expect(result.lines[0]!.terms).toEqual(
      raw.commercialPlanSnapshot.packages[0]!.compensationLines[0],
    );
    expect({ raw, input }).toEqual(before);
  });
  it("uses integer arithmetic above safe numeric precision", () => {
    const raw = sources();
    for (const pkg of raw.commercialPlanSnapshot.packages)
      pkg.compensationLines[0]!.amountMinor = "999999999999999999999999999999";
    expect(buildContractedCostReview(raw, review(raw)).total.amountMinor).toBe(
      (
        999999999999999999999999999999n *
        BigInt(raw.commercialPlanSnapshot.packages.length)
      ).toString(),
    );
  });
  it("retains real zero rather than treating it as missing", () => {
    const raw = sources();
    for (const pkg of raw.commercialPlanSnapshot.packages)
      pkg.compensationLines[0]!.amountMinor = "0";
    expect(buildContractedCostReview(raw, review(raw)).total).toMatchObject({
      status: "available",
      amountMinor: "0",
    });
  });
  it("retains excluded fees and explanations without adding them", () => {
    const input = review();
    input.decisions.forEach((d) => {
      d.inclusion = "excluded";
      d.reason = "Outside selected eligible spend";
    });
    const result = buildContractedCostReview(sources(), input);
    expect(result.total).toMatchObject({
      status: "available",
      amountMinor: "0",
    });
    expect(
      result.lines.every(
        (l) => l.inclusion === "excluded" && l.terms.assetType === "cash",
      ),
    ).toBe(true);
  });
  it.each(["", "  "])(
    "requires nonblank reasons on exclusions and inclusions: %j",
    (reason) => {
      for (const inclusion of ["included", "excluded"] as const) {
        const input = review();
        input.decisions[0] = { ...input.decisions[0]!, inclusion, reason };
        expect(() => buildContractedCostReview(sources(), input)).toThrow();
      }
    },
  );
  it("rejects case-insensitive duplicate decisions", () => {
    const input = review();
    input.decisions[1] = {
      ...input.decisions[0]!,
      compensationLineId: input.decisions[0]!.compensationLineId.toUpperCase(),
    };
    expect(() => buildContractedCostReview(sources(), input)).toThrow(
      "Duplicate",
    );
  });
  it("accepts case-equivalent UUID decisions and canonicalizes from source", () => {
    const input = review();
    input.decisions.forEach(
      (d) => (d.compensationLineId = d.compensationLineId.toUpperCase()),
    );
    expect(buildContractedCostReview(sources(), input)).toEqual(
      buildContractedCostReview(sources(), review()),
    );
  });
  it("is deterministic when review decisions are reordered", () => {
    const input = review();
    input.decisions.reverse();
    expect(buildContractedCostReview(sources(), input)).toEqual(
      buildContractedCostReview(sources(), review()),
    );
  });
  it.each(["omission", "foreign", "extra"])(
    "rejects %s line decisions",
    (mode) => {
      const input = review();
      if (mode === "omission") input.decisions.pop();
      else {
        const foreign = {
          ...input.decisions[0]!,
          compensationLineId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        };
        if (mode === "extra") input.decisions.push(foreign);
        else input.decisions[0] = foreign;
      }
      expect(() => buildContractedCostReview(sources(), input)).toThrow(
        "Every approved",
      );
    },
  );
  it("unknown additional costs suppress the whole total, not just an annotation", () => {
    const input = review();
    input.additionalCosts = "unknown";
    expect(buildContractedCostReview(sources(), input).total).toEqual({
      status: "not_available",
      amountMinor: null,
      currencyCode: "GBP",
      reasons: ["additional_costs_unknown"],
    });
  });
  it.each(["USD", "EUR"])(
    "never converts a mixed included %s fee",
    (currency) => {
      const raw = sources();
      raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.currencyCode =
        currency;
      expect(buildContractedCostReview(raw, review(raw)).total).toMatchObject({
        status: "not_available",
        amountMinor: null,
        reasons: ["currency_mismatch"],
      });
    },
  );
  it("does not allow a caller-selected currency to relabel fees", () => {
    const input = review();
    input.currencyCode = "USD";
    expect(buildContractedCostReview(sources(), input).total).toMatchObject({
      status: "not_available",
      reasons: ["currency_mismatch"],
    });
  });
  it("requires resolved variable compensation instead of treating a quoted unit price as a fixed fee", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.model =
      "variable";
    expect(buildContractedCostReview(raw, review(raw)).total).toMatchObject({
      status: "not_available",
      amountMinor: null,
      reasons: ["variable_compensation"],
    });
  });
  it.each(["token", "usdc"])(
    "does not silently value %s and retains explicitly excluded terms",
    (assetType) => {
      const raw = sources();
      const input = review(raw);
      const pkg = raw.commercialPlanSnapshot.packages[0]!;
      const terms = {
        id: pkg.compensationLines[0]!.id,
        model: "fixed",
        assetType,
        tokenMint: "11111111111111111111111111111111",
        tokenAmountRaw: "1000000",
        tokenDecimals: 6,
        unitPriceUsd: "1",
        priceSource: "Synthetic test price",
        valuedAt: "2026-09-01T00:00:00Z",
      };
      const changed = {
        ...raw,
        commercialPlanSnapshot: {
          ...raw.commercialPlanSnapshot,
          packages: raw.commercialPlanSnapshot.packages.map((p, i) =>
            i === 0 ? { ...p, compensationLines: [terms] } : p,
          ),
        },
      };
      expect(buildContractedCostReview(changed, input).total).toMatchObject({
        status: "not_available",
        amountMinor: null,
        reasons: ["non_cash_valuation_required"],
      });
      input.decisions[0]!.inclusion = "excluded";
      input.decisions[0]!.reason = "Explicitly excluded non-cash compensation";
      const result = buildContractedCostReview(changed, input);
      expect(result.total.status).toBe("available");
      expect(result.lines[0]!.terms).toEqual(terms);
    },
  );
  it.each([
    "workspaceId",
    "projectId",
    "campaignId",
    "commercialPlanVersionId",
    "ruleVersionId",
  ] as const)("rejects %s drift", (key) => {
    const input = review();
    input[key] = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    expect(() => buildContractedCostReview(sources(), input)).toThrow(
      "scope drift",
    );
  });
  it("rejects snapshot hash drift", () => {
    const input = review();
    input.commercialPlanSnapshotHash = "f".repeat(64);
    expect(() => buildContractedCostReview(sources(), input)).toThrow(
      "snapshot drift",
    );
  });
  it.each(["startedAt", "endedAt"] as const)(
    "rejects microsecond %s drift",
    (key) => {
      const input = review();
      input.measurementWindow[key] = input.measurementWindow[key].replace(
        "00+00:00",
        "00.000001+00:00",
      );
      expect(() => buildContractedCostReview(sources(), input)).toThrow(
        "measurement drift",
      );
    },
  );
  it("retains source timestamp spelling after an equivalent instant review", () => {
    const input = review();
    input.measurementWindow.startedAt =
      input.measurementWindow.startedAt.replace("+00:00", ".000000Z");
    expect(
      buildContractedCostReview(sources(), input).measurementWindow,
    ).toEqual(sources().measurementWindow);
  });
  it("rejects supplied amounts, unrecognized policy and missing declarations", () => {
    const input = review();
    expect(() =>
      buildContractedCostReview(sources(), {
        ...input,
        decisions: input.decisions.map((d) => ({ ...d, amountMinor: "1" })),
      }),
    ).toThrow();
    expect(() =>
      buildContractedCostReview(sources(), {
        ...input,
        policy: { basis: "paid", version: 1 },
      }),
    ).toThrow();
    expect(() =>
      buildContractedCostReview(sources(), {
        ...input,
        policy: { basis: "contracted", version: 2 },
      }),
    ).toThrow();
    expect(() =>
      buildContractedCostReview(sources(), {
        ...input,
        additionalCosts: undefined,
      }),
    ).toThrow();
  });
  it("rejects invalid, duplicate or legacy sources rather than accepting a cost-only fragment", () => {
    const raw = sources();
    raw.commercialPlanSnapshot.packages[1]!.compensationLines[0]!.id =
      raw.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.id.toUpperCase();
    expect(() => buildContractedCostReview(raw, review(raw))).toThrow();
    expect(() => buildContractedCostReview({}, review())).toThrow();
    const legacy = sources();
    legacy.commercialPlanSnapshot.strategyBinding.schemaVersion = 1;
    expect(() => buildContractedCostReview(legacy, review())).toThrow();
  });
});
