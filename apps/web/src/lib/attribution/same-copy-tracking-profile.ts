// TRK-01 / SEC-02: one explicitly approved, isolated test copy. This profile
// never grants commercial, reconciliation or reporting authority.
export const sameCopyCampaignId = "3328608e-2429-4df7-9ad4-48e8f1886201";
export const sameCopyRevisedBasketId = "0b7f5e79-ecc7-4b5f-bb26-6ba6293d7003";
export const sameCopyFreshBasketId = "82ec7f69-0e81-45eb-a5ab-f55b24a3b163";
export const sameCopyTrackingIdentity = {
  role: "landed_same_copy_tracking_server",
  database: "landed_wf_verify_browser_campaign_01",
  port: "55532",
} as const;

export function sameCopyTrackingEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const started = Date.parse(env.LANDED_SAME_COPY_TRACKING_STARTED_AT ?? "");
  const expires = Date.parse(env.LANDED_SAME_COPY_TRACKING_EXPIRES_AT ?? "");
  return (
    env.LANDED_SAME_COPY_TRACKING === "1" &&
    env.NODE_ENV === "development" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421" &&
    Number.isFinite(started) &&
    Number.isFinite(expires) &&
    started <= now &&
    expires > now &&
    expires - started <= 60 * 60 * 1000 &&
    // Saved measurement end. Changing a process setting cannot extend it.
    expires <=
      Date.parse(
        env.LANDED_SAME_COPY_FRESH_WINDOW === "1" &&
          env.LANDED_SAME_COPY_REVISED_TRACKING === "1"
          ? "2026-10-11T21:50:00Z"
          : env.LANDED_SAME_COPY_REVISED_TRACKING === "1"
            ? "2026-10-11T20:45:00Z"
            : "2026-10-11T19:55:00Z",
      )
  );
}

export function assertSameCopyTrackingAction(
  input: { action: string; campaignId?: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.LANDED_SAME_COPY_TRACKING === undefined) return;
  if (
    !sameCopyTrackingEnabled(env) ||
    (env.LANDED_SAME_COPY_REVISED_TRACKING === "1"
      ? !/^[0-9a-f-]{36}$/.test(input.campaignId ?? "")
      : input.campaignId !== sameCopyCampaignId) ||
    !["readActivation", "issueLink", "activate"].includes(input.action)
  )
    throw new Error("This test connection does not permit that action");
}
