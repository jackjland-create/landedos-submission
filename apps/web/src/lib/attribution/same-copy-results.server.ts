import "server-only";
import { Pool, type PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
const role = "landed_same_copy_results_server",
  database = "landed_wf_verify_browser_campaign_01";
let pool: Pool | undefined;
export function sameCopyResultsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const expiry = Date.parse(env.LANDED_SAME_COPY_RESULTS_EXPIRES_AT ?? "");
  return (
    env.LANDED_SAME_COPY_RESULTS === "1" &&
    env.NODE_ENV === "development" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421" &&
    Number.isFinite(expiry) &&
    expiry > now &&
    (env.LANDED_SAME_COPY_CLOSED_REVIEW !== "1" ||
      now < Date.parse("2026-10-11T22:58:00Z")) &&
    expiry <=
      Date.parse(
        env.LANDED_SAME_COPY_CLOSED_REVIEW === "1" &&
          env.LANDED_LOCAL_DEVNET_INPUT_LOCK === "review" &&
          env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID ===
            "f415bcd6-0709-459c-a05a-7da27d2f7558"
          ? "2026-10-11T23:00:00Z"
          : "2026-10-11T22:10:00Z",
      )
  );
}
function connection() {
  if (!sameCopyResultsEnabled()) throw Error("Results connection unavailable");
  const url = new URL(
    process.env.LANDED_SAME_COPY_RESULTS_SERVER_URL ?? "invalid:",
  );
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55532" ||
    url.username !== role ||
    url.pathname !== `/${database}` ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw Error("Results connection unavailable");
  if (!pool) {
    pool = new Pool({
      connectionString: url.href,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    });
    pool.on("error", () =>
      console.error("Test results connection interrupted"),
    );
  }
  return pool;
}
export async function withSameCopyResultsTransaction<T>(
  auth: SupabaseClient,
  operation: (s: Pick<PoolClient, "query">, actor: string) => Promise<T>,
  connectionPool: Pick<Pool, "connect"> = connection(),
) {
  if (!sameCopyResultsEnabled()) throw Error("Results connection unavailable");
  const user = await auth.auth.getUser();
  if (user.error || !user.data.user) throw Error("Sign in required");
  const actor = z.uuid().parse(user.data.user.id);
  const session = await connectionPool.connect();
  try {
    await session.query("begin isolation level read committed");
    await session.query("set local statement_timeout='15s'");
    await session.query("set local idle_in_transaction_session_timeout='15s'");
    const id = (
      await session.query(
        "select current_user role,session_user login,current_database() db",
      )
    ).rows[0];
    if (id?.role !== role || id?.login !== role || id?.db !== database)
      throw Error("Wrong results identity");
    await session.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    const receipt = process.env.LANDED_SAME_COPY_RESULTS_QUIESCENCE_RECEIPT;
    if (receipt !== undefined)
      await session.query(
        "select set_config('landed.local_devnet_quiescence_receipt',$1,true)",
        [
          z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .parse(receipt),
        ],
      );
    const result = await operation(session, actor);
    if (!sameCopyResultsEnabled()) throw Error("Results connection expired");
    await session.query("commit");
    return result;
  } catch (e) {
    await session.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    session.release(true);
  }
}
export function isSameCopyResultsAction(action: string) {
  return ["prepare", "recover", "confirm", "readReconciliation"].includes(
    action,
  );
}
export async function runSameCopyResultsAction(
  auth: SupabaseClient,
  input: {
    action: string;
    campaignId?: string;
    reconciliationJobId?: string;
    reviewId?: string;
    reason?: string;
    acknowledged?: boolean;
  },
) {
  if (!isSameCopyResultsAction(input.action))
    throw Error("Results action unavailable");
  const c = z.uuid().parse(input.campaignId);
  const scope = [
    "10000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000001",
    c,
  ];
  return withSameCopyResultsTransaction(auth, async (s) => {
    if (input.action === "readReconciliation")
      return (
        await s.query(
          "select public.read_same_copy_results_readiness($1::uuid,$2::uuid,$3::uuid,$4::uuid) value",
          [...scope, z.uuid().parse(input.reconciliationJobId)],
        )
      ).rows[0]?.value;
    if (input.action === "prepare")
      return (
        await s.query(
          "select public.prepare_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid) value",
          [...scope, z.uuid().parse(input.reconciliationJobId)],
        )
      ).rows[0]?.value;
    if (input.action === "recover")
      return (
        await s.query(
          "select public.read_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid) value",
          [...scope, z.uuid().parse(input.reviewId)],
        )
      ).rows[0]?.value;
    if (input.acknowledged !== true)
      throw Error("Human acknowledgement required");
    return (
      await s.query(
        "select public.confirm_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::boolean) value",
        [
          ...scope,
          z.uuid().parse(input.reviewId),
          z.string().trim().min(8).max(240).parse(input.reason),
          true,
        ],
      )
    ).rows[0]?.value;
  });
}
