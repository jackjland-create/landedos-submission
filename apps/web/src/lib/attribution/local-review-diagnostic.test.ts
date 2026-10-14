import { describe, expect, it } from "vitest";
import { localReviewDiagnosticActionAllowed as allowed } from "./local-review-diagnostic";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LANDED_LOCAL_REVIEW_DIAGNOSTIC: "1",
  LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: "synthetic-campaign",
};
describe("synthetic local review narrows existing authorization", () => {
  it("does not affect normal operation", () =>
    expect(allowed(null, true, false, { NODE_ENV: "test" })).toBe(true));
  it.each([
    "confirm",
    "activate",
    "issueLink",
    "enqueueReconciliation",
    "readSignedLink",
  ])("denies %s", (action) => {
    for (const write of [true, false])
      for (const report of [true, false])
        expect(
          allowed(
            { action, campaignId: "synthetic-campaign" },
            write,
            report,
            env,
          ),
        ).toBe(false);
  });
  it("allows only preparation writes and scoped recovery reads", () => {
    expect(
      allowed(
        { action: "prepare", campaignId: "synthetic-campaign" },
        true,
        false,
        env,
      ),
    ).toBe(true);
    expect(
      allowed(
        { action: "recover", campaignId: "synthetic-campaign" },
        false,
        false,
        env,
      ),
    ).toBe(true);
    expect(
      allowed(
        { action: "sources", campaignId: "synthetic-campaign" },
        false,
        true,
        env,
      ),
    ).toBe(true);
    expect(
      allowed(
        { action: "read", campaignId: "synthetic-campaign" },
        false,
        true,
        env,
      ),
    ).toBe(true);
    expect(
      allowed(
        { action: "sources", campaignId: "synthetic-campaign" },
        false,
        false,
        env,
      ),
    ).toBe(false);
  });
  it.each([
    null,
    [],
    {},
    { action: "prepare", campaignId: "other" },
    { action: ["prepare"], campaignId: "synthetic-campaign" },
  ])("rejects malformed or other scope", (input) =>
    expect(allowed(input, true, true, env)).toBe(false),
  );
  it("uses the executed last-value GET semantics", () => {
    const input = Object.fromEntries(
      new URLSearchParams(
        "action=recover&campaignId=synthetic-campaign&campaignId=other",
      ),
    );
    expect(allowed(input, false, false, env)).toBe(false);
  });
});
