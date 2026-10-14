import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCustomBasket } from "@landed/contracts";
import { recoverStrategyDraft, retainStrategyDraft } from "./strategy-recovery";
const value = {
  revision: 1,
  edits: {
    name: "Plan",
    strategy: draftCustomBasket({ name: "Plan" }).strategy,
  },
  uncertain: false,
};
afterEach(() => {
  retainStrategyDraft("owner", "project", "basket", null);
  vi.useRealTimers();
});
describe("strategy tab recovery", () => {
  it("isolates owner, project and basket and clones both boundaries", () => {
    retainStrategyDraft("owner", "project", "basket", value);
    for (const [a, b, c] of [
      ["other", "project", "basket"],
      ["owner", "other", "basket"],
      ["owner", "project", "other"],
    ])
      expect(recoverStrategyDraft(a!, b!, c!)).toBeNull();
    const copy = recoverStrategyDraft("owner", "project", "basket")!;
    copy.edits.name = "Changed";
    expect(recoverStrategyDraft("owner", "project", "basket")!.edits.name).toBe(
      "Plan",
    );
  });
  it("expires retained edits after 30 minutes", () => {
    vi.useFakeTimers();
    retainStrategyDraft("owner", "project", "basket", value);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(recoverStrategyDraft("owner", "project", "basket")).toBeNull();
  });
});
