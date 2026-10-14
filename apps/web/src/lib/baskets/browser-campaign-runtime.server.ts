import "server-only";
import { Pool, type PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import {
  sameCopyFreshBasketId,
  sameCopyRevisedBasketId,
} from "@/lib/attribution/same-copy-tracking-profile";

const role = "landed_browser_campaign_server";
const database = "landed_wf_verify_browser_campaign_01";
let pool: Pool | undefined;
export function sameCopyPlanEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  return (
    env.LANDED_SAME_COPY_PLAN === "1" &&
    env.NODE_ENV === "development" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421" &&
    env.LANDED_SAME_COPY_PLAN_EXPIRES_AT ===
      (env.LANDED_SAME_COPY_FRESH_WINDOW === "1"
        ? "2026-10-11T22:10:00Z"
        : "2026-10-11T21:10:00Z") &&
    now < Date.parse(env.LANDED_SAME_COPY_PLAN_EXPIRES_AT)
  );
}
function expectedRole() {
  if (process.env.LANDED_SAME_COPY_PLAN !== undefined) {
    if (!sameCopyPlanEnabled())
      throw new Error("Revised test connection unavailable");
    return "landed_same_copy_plan_server";
  }
  return role;
}
const sameCopyFunctions: Record<string, string> = {
  prepare_local_browser_commercial_review: "same_copy_prepare_review",
  prepare_selected_local_browser_commercial_review: "same_copy_select_review",
  confirm_local_browser_commercial_review: "same_copy_confirm_review",
  confirm_selected_local_browser_commercial_review:
    "same_copy_confirm_selected_review",
  read_local_browser_commercial_result: "same_copy_read_result",
  create_local_browser_campaign: "same_copy_create_campaign",
};
export function commercialQuery(sql: string) {
  if (process.env.LANDED_SAME_COPY_PLAN === undefined) return sql;
  expectedRole();
  const name = Object.keys(sameCopyFunctions).find((key) =>
    sql.includes(`public.${key}(`),
  );
  if (!name) throw new Error("Unexpected revised test operation");
  return sql.replace(`public.${name}(`, `public.${sameCopyFunctions[name]}(`);
}
export function browserCampaignEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.LANDED_SAME_COPY_PLAN !== undefined) return sameCopyPlanEnabled(env);
  return (
    env.NODE_ENV === "development" &&
    !env.VERCEL_ENV &&
    !env.VERCEL &&
    env.LANDED_BROWSER_CAMPAIGN === "1" &&
    env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421"
  );
}
export function assertBrowserCampaignHost(host: string | null) {
  if (
    !browserCampaignEnabled() ||
    !(process.env.LANDED_SAME_COPY_PLAN !== undefined
      ? /^(localhost|127\.0\.0\.1):3213$/.test(host ?? "")
      : /^(localhost|127\.0\.0\.1):\d+$/.test(host ?? ""))
  )
    throw new Error("Local campaign unavailable");
}
function runtimePool() {
  if (!browserCampaignEnabled()) throw new Error("Local campaign unavailable");
  const url = new URL(
    process.env.LANDED_BROWSER_CAMPAIGN_SERVER_URL ?? "invalid:",
  );
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55532" ||
    url.username !== expectedRole() ||
    url.pathname !== `/${database}` ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Local connection unavailable");
  if (!pool) {
    pool = new Pool({
      connectionString: url.href,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    });
    pool.on("error", () =>
      console.error("Local campaign connection interrupted."),
    );
  }
  return pool;
}
export async function withBrowserCampaignTransaction<T>(
  client: SupabaseClient,
  operation: (session: Pick<PoolClient, "query">, actor: string) => Promise<T>,
  connectionPool: Pick<Pool, "connect"> = runtimePool(),
) {
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) throw new Error("Sign in required");
  const actor = z.uuid().parse(user.data.user.id);
  const session = await connectionPool.connect();
  try {
    await session.query("begin isolation level read committed");
    await session.query("set local statement_timeout='15000ms'");
    await session.query(
      "set local idle_in_transaction_session_timeout='15000ms'",
    );
    const identity = (
      await session.query(
        "select current_user as role, session_user as login, current_database() as database",
      )
    ).rows[0];
    if (
      identity?.role !== expectedRole() ||
      identity?.login !== expectedRole() ||
      identity?.database !== database
    )
      throw new Error("Unexpected connection identity");
    await session.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    const result = await operation(session, actor);
    expectedRole();
    await session.query("commit");
    return result;
  } catch (error) {
    try {
      await session.query("rollback");
    } catch {
      /* Destroy below. */
    }
    throw error;
  } finally {
    session.release(true);
  }
}
const common = { basketId: z.uuid() };
export const commercialActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("prepare"),
    ...common,
    scenarioId: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("select"),
    ...common,
    sourceReviewId: z.uuid(),
    packageIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.strictObject({
    action: z.literal("confirmSelected"),
    ...common,
    reviewId: z.uuid(),
    note: z.string().trim().max(240).optional(),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    ...common,
    reviewId: z.uuid(),
    reason: z.string().trim().min(1).max(240),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("recover"),
    ...common,
    reviewId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("create"),
    ...common,
    reviewId: z.uuid(),
    acknowledged: z.literal(true),
  }),
]);
export async function runBrowserCommercialAction(
  client: SupabaseClient,
  value: unknown,
) {
  const input = commercialActionSchema.parse(value);
  if (
    process.env.LANDED_SAME_COPY_PLAN !== undefined &&
    input.basketId !==
      (process.env.LANDED_SAME_COPY_FRESH_WINDOW === "1"
        ? sameCopyFreshBasketId
        : sameCopyRevisedBasketId)
  )
    throw new Error("Use the revised test plan");
  return withBrowserCampaignTransaction(client, async (session) => {
    const prefix = [project.workspaceId, project.databaseId, input.basketId];
    switch (input.action) {
      case "select":
        return (
          await session.query(
            commercialQuery(
              "select public.prepare_selected_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid[]) as value",
            ),
            [...prefix, input.sourceReviewId, input.packageIds],
          )
        ).rows[0]?.value as unknown;
      case "confirmSelected": {
        await session.query(
          commercialQuery(
            "select public.confirm_selected_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)",
          ),
          [...prefix, input.reviewId, input.note?.trim() || null],
        );
        return (
          await session.query(
            commercialQuery(
              "select public.read_local_browser_commercial_result($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
            ),
            [...prefix, input.reviewId],
          )
        ).rows[0]?.value as unknown;
      }
      case "prepare":
        return (
          await session.query(
            commercialQuery(
              "select public.prepare_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer) as value",
            ),
            [...prefix, input.scenarioId, input.revision],
          )
        ).rows[0]?.value as unknown;
      case "confirm": {
        await session.query(
          commercialQuery(
            "select public.confirm_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)",
          ),
          [...prefix, input.reviewId, input.reason],
        );
        return (
          await session.query(
            commercialQuery(
              "select public.read_local_browser_commercial_result($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
            ),
            [...prefix, input.reviewId],
          )
        ).rows[0]?.value as unknown;
      }
      case "recover":
        return (
          await session.query(
            commercialQuery(
              "select public.read_local_browser_commercial_result($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
            ),
            [...prefix, input.reviewId],
          )
        ).rows[0]?.value as unknown;
      case "create":
        return (
          await session.query(
            commercialQuery(
              "select public.create_local_browser_campaign($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
            ),
            [...prefix, input.reviewId],
          )
        ).rows[0]?.value as unknown;
    }
  });
}
