import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertBrowserCampaignHost,
  commercialActionSchema,
  withBrowserCampaignTransaction,
} from "./browser-campaign-runtime.server";
const actor = "30990000-0000-4000-8000-000000000001";
it("selected commercial action rejects empty/duplicate selection and requires acknowledgement, not a note", () => {
  const base = { action: "select", basketId: actor, sourceReviewId: actor };
  expect(
    commercialActionSchema.safeParse({ ...base, packageIds: [] }).success,
  ).toBe(false);
  expect(
    commercialActionSchema.safeParse({ ...base, packageIds: [actor, actor] })
      .success,
  ).toBe(false);
  expect(
    commercialActionSchema.safeParse({ ...base, packageIds: [actor] }).success,
  ).toBe(true);
  const selected = {
    action: "confirmSelected",
    basketId: actor,
    reviewId: actor,
    acknowledged: true,
  };
  expect(commercialActionSchema.safeParse(selected).success).toBe(true);
  expect(
    commercialActionSchema.safeParse({ ...selected, acknowledged: false })
      .success,
  ).toBe(false);
  expect(
    commercialActionSchema.safeParse({ ...selected, note: "a".repeat(241) })
      .success,
  ).toBe(false);
  expect(
    commercialActionSchema.safeParse({ ...selected, action: "confirm" })
      .success,
  ).toBe(false);
});
function fixture(
  role = "landed_browser_campaign_server",
  database = "landed_wf_verify_browser_campaign_01",
) {
  const query = vi.fn(async (sql: string) =>
    sql.includes("current_user")
      ? { rows: [{ role, login: role, database }] }
      : { rows: [] },
  );
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const getUser = vi.fn(async () => ({
    data: { user: { id: actor } },
    error: null,
  }));
  return {
    query,
    release,
    connect,
    getUser,
    client: { auth: { getUser } } as unknown as SupabaseClient,
    pool: { connect } as unknown as Pick<Pool, "connect">,
  };
}
afterEach(() => vi.unstubAllEnvs());
describe("local browser campaign boundary", () => {
  it("uses verified actor and one checkout, then destroys the session", async () => {
    const f = fixture();
    expect(
      await withBrowserCampaignTransaction(
        f.client,
        async (_, id) => id,
        f.pool,
      ),
    ).toBe(actor);
    expect(f.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    expect(f.query).toHaveBeenLastCalledWith("commit");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it.each([
    ["postgres", "landed_wf_verify_browser_campaign_01"],
    ["landed_browser_campaign_server", "other_database"],
  ])("rejects %s/%s before an operation", async (role, database) => {
    const f = fixture(role, database);
    const op = vi.fn();
    await expect(
      withBrowserCampaignTransaction(f.client, op, f.pool),
    ).rejects.toThrow("identity");
    expect(op).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith("rollback");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("does not connect without a real verified login", async () => {
    const f = fixture();
    f.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as never);
    await expect(
      withBrowserCampaignTransaction(f.client, vi.fn(), f.pool),
    ).rejects.toThrow("Sign in");
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("does not repeat a decision after an uncertain commit", async () => {
    const f = fixture();
    const normal = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) => {
      if (sql === "commit") throw Error("lost acknowledgement");
      return normal(sql);
    });
    const op = vi.fn(async () => true);
    await expect(
      withBrowserCampaignTransaction(f.client, op, f.pool),
    ).rejects.toThrow("acknowledgement");
    expect(op).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("denies hosted origins and hosted flags", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("LANDED_BROWSER_CAMPAIGN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
    expect(() => assertBrowserCampaignHost("127.0.0.1:3213")).not.toThrow();
    expect(() => assertBrowserCampaignHost("example.test")).toThrow();
    vi.stubEnv("VERCEL", "1");
    expect(() => assertBrowserCampaignHost("127.0.0.1:3213")).toThrow();
  });
  it("rejects caller actor, snapshot, candidate or expiry overrides", () => {
    const input = {
      action: "confirm",
      basketId: actor,
      reviewId: actor,
      reason: "Reviewed terms",
      acknowledged: true,
    };
    expect(commercialActionSchema.safeParse(input).success).toBe(true);
    for (const field of [
      "actorId",
      "snapshot",
      "candidates",
      "expiresAt",
      "commercialPlanVersionId",
    ])
      expect(
        commercialActionSchema.safeParse({ ...input, [field]: actor }).success,
      ).toBe(false);
    expect(
      commercialActionSchema.safeParse({ ...input, acknowledged: false })
        .success,
    ).toBe(false);
  });
});
