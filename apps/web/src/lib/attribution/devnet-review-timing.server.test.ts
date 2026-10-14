import { expect, it } from "vitest";
import { devnetReviewTiming } from "./devnet-review-timing.server";
const campaign = "90000000-0000-4000-8000-000000000001";
const env = {
  NODE_ENV: "production",
  LANDED_EXTERNAL_DEVNET_SESSION: "1",
  EXTERNAL_DEVNET_PUBLIC_GATE: "1",
  LANDED_LOCAL_DEVNET_REHEARSAL: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
  LANDED_LOCAL_DEVNET_INPUT_LOCK: "review",
  LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: campaign,
  LANDED_LOCAL_DEVNET_REVIEW_DECISIONS_CLOSE_AT: "2026-10-08T01:58:43.719Z",
} as NodeJS.ProcessEnv;
it("projects only the exact runner-owned closed-review campaign", () => {
  expect(devnetReviewTiming(campaign, env)).toEqual({
    decisionsCloseAt: env.LANDED_LOCAL_DEVNET_REVIEW_DECISIONS_CLOSE_AT,
  });
  expect(
    devnetReviewTiming("90000000-0000-4000-8000-000000000002", env),
  ).toBeUndefined();
  expect(
    devnetReviewTiming("bad", {
      ...env,
      LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: "bad",
    }),
  ).toBeUndefined();
  for (const override of [
    { VERCEL: "1" },
    { LANDED_LOCAL_DEVNET_INPUT_LOCK: "drain" },
    { LANDED_LOCAL_DEVNET_REHEARSAL: "0" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.com" },
    { LANDED_EXTERNAL_DEVNET_SESSION: "0" },
  ])
    expect(
      devnetReviewTiming(campaign, { ...env, ...override }),
    ).toBeUndefined();
});
it("marks missing/malformed server metadata unknown, never substitutes draft TTL", () => {
  for (const cutoff of [undefined, "", "bad", "2026-10-08T01:58:43"])
    expect(
      devnetReviewTiming(campaign, {
        ...env,
        LANDED_LOCAL_DEVNET_REVIEW_DECISIONS_CLOSE_AT: cutoff,
      }),
    ).toEqual({ decisionsCloseAt: null });
});
