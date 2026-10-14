import { describe, expect, it } from "vitest";
import {
  overviewReference,
  isOverviewPersona,
  validBudget,
  validBriefText,
} from "./overview-reference";

describe("Overview journey boundaries", () => {
  it("does not attach any campaign data to boundary examples", () => {
    for (const state of ["loading", "empty", "error", "permission"] as const) {
      for (const persona of ["returning", "new", "analyst", "creator"] as const)
        expect(overviewReference(persona, state)).toBeNull();
    }
  });
  it("minimises the creator fixture to its own invitation", () => {
    const data = overviewReference("creator", "ready");
    expect(data?.kind).toBe("creator");
    expect(JSON.stringify(data)).not.toMatch(
      /Maya|Mint Condition|metricSnapshot|wallet|6200/,
    );
    expect(overviewReference("new", "ready")).toEqual({ kind: "new" });
  });
  it("keeps analyst read only and preserves issued results without an account sum", () => {
    const data = overviewReference("analyst", "ready");
    expect(data?.kind === "operator" && data.readOnly).toBe(true);
    expect(data?.kind === "operator" && data.metrics.qualified).toBe(7);
    const partial = overviewReference("returning", "partial");
    expect(
      partial?.kind === "operator" && partial.metrics.qualified,
    ).toBeNull();
  });
  it("validates draft inputs without floating-point money", () => {
    for (const valid of ["1", "5000.00", "0.01", "9007199254740993.99"])
      expect(validBudget(valid)).toBe(true);
    for (const invalid of [
      "",
      "0",
      "0.00",
      "-1",
      "1.999",
      "1e3",
      "Infinity",
      "abc",
    ])
      expect(validBudget(invalid)).toBe(false);
    expect(validBriefText("   ")).toBe(false);
    expect(isOverviewPersona("admin")).toBe(false);
  });
});
