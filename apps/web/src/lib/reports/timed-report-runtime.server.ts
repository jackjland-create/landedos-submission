import "server-only";
import { Pool, type PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  sameCopyResultsEnabled,
  withSameCopyResultsTransaction,
} from "@/lib/attribution/same-copy-results.server";
import {
  localDevnetRehearsalEnabled,
  withLocalDevnetRehearsalTransaction,
} from "@/lib/attribution/devnet-campaign-runtime.server";

/** BSK-09 / RPT-01: isolated least-privilege connection, never an owner bridge. */
export const timedRuntimeScopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
});
export type TimedRuntimeScope = z.infer<typeof timedRuntimeScopeSchema>;
const serverRole = "landed_timed_report_server";
let pool: Pool | undefined;
export function localDevnetReportEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.LANDED_SAME_COPY_RESULTS !== undefined)
    return sameCopyResultsEnabled(env);
  return (
    env.LANDED_LOCAL_DEVNET_REPORTS === "1" && localDevnetRehearsalEnabled(env)
  );
}

// RPT-03: fixed private wrapper names only; never accept SQL from a caller.
export function timedReportFunction(
  operation: "bundle" | "save" | "read" | "recover" | "confirm",
) {
  if (
    process.env.LANDED_LOCAL_DEVNET_REPORTS === "1" ||
    process.env.LANDED_SAME_COPY_RESULTS !== undefined
  ) {
    if (!localDevnetReportEnabled())
      throw new Error("Local devnet report unavailable.");
    return {
      bundle: "load_local_devnet_report_evidence_bundle",
      save: "save_local_devnet_report_draft",
      read: "read_local_devnet_report_draft",
      recover: "recover_local_devnet_report_draft",
      confirm: "confirm_local_devnet_report_draft",
    }[operation];
  }
  return {
    bundle: "load_timed_report_evidence_bundle",
    save: "save_timed_report_draft",
    read: "read_timed_report_draft",
    recover: "recover_timed_report_draft",
    confirm: "confirm_timed_report_draft",
  }[operation];
}
function runtimeDatabase() {
  return process.env.LANDED_BROWSER_CAMPAIGN === "1"
    ? "landed_wf_verify_browser_campaign_01"
    : "landed_wf_verify_http_20260921_issuer01";
}

export function assertTimedRuntimeEnvironment(host: string | null) {
  if (process.env.LANDED_SAME_COPY_RESULTS !== undefined) {
    if (
      !sameCopyResultsEnabled() ||
      !/^(localhost|127\.0\.0\.1):3213$/.test(host ?? "")
    )
      throw Error("Test results unavailable");
    return;
  }
  if (process.env.LANDED_LOCAL_DEVNET_REPORTS === "1") {
    if (!localDevnetReportEnabled() || host !== "localhost:3319")
      throw new Error("Local devnet report unavailable.");
    return;
  }
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL_ENV ||
    process.env.LANDED_TIMED_REPORT_ISSUANCE !== "1" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55421" ||
    !/^(localhost|127\.0\.0\.1):\d+$/.test(host ?? "")
  )
    throw new Error("Isolated report rehearsal is unavailable.");
}

function runtimePool() {
  const config = new URL(
    process.env.LANDED_TIMED_REPORT_SERVER_URL ?? "invalid:",
  );
  if (
    config.protocol !== "postgresql:" ||
    config.hostname !== "127.0.0.1" ||
    config.port !== "55532" ||
    config.username !== serverRole ||
    config.pathname !== `/${runtimeDatabase()}` ||
    !config.password ||
    config.search ||
    config.hash
  )
    throw new Error("Isolated report connection is unavailable.");
  if (!pool) {
    pool = new Pool({
      connectionString: config.href,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    });
    // Never log credentials, provider evidence, SQL parameters or driver errors.
    pool.on("error", () => {
      console.error("Isolated report connection interrupted.");
    });
  }
  return pool;
}

export type TimedSqlSession = Pick<PoolClient, "query">;

/** Every call uses one connection, verified session identity and transaction.
 * Destroying the connection on release additionally prevents session leakage.
 */
export async function withTimedReportTransaction<T>(
  authClient: SupabaseClient,
  operation: (session: TimedSqlSession, actorId: string) => Promise<T>,
  connectionPool?: Pick<Pool, "connect">,
): Promise<T> {
  if (process.env.LANDED_SAME_COPY_RESULTS !== undefined)
    return withSameCopyResultsTransaction(
      authClient,
      operation,
      connectionPool,
    );
  if (process.env.LANDED_LOCAL_DEVNET_REPORTS === "1") {
    if (!localDevnetReportEnabled())
      throw new Error("Local devnet report unavailable.");
    return withLocalDevnetRehearsalTransaction(
      authClient,
      operation,
      connectionPool,
      process.env,
      { requireQuiescenceReceipt: true },
    );
  }
  const auth = await authClient.auth.getUser();
  if (auth.error || !auth.data.user)
    throw new Error("Report management access is required.");
  const actor = z.uuid().parse(auth.data.user.id);
  const connection = await (connectionPool ?? runtimePool()).connect();
  try {
    await connection.query("begin isolation level read committed");
    await connection.query("set local statement_timeout = '15000ms'");
    await connection.query(
      "set local idle_in_transaction_session_timeout = '15000ms'",
    );
    const identity = await connection.query(
      "select current_user as role, session_user as login, current_database() as database",
    );
    const row = identity.rows[0];
    if (
      row?.role !== serverRole ||
      row?.login !== serverRole ||
      row?.database !== runtimeDatabase()
    )
      throw new Error("Unexpected report connection identity.");
    await connection.query(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    const value = await operation(connection, actor);
    await connection.query("commit");
    return value;
  } catch (error) {
    try {
      await connection.query("rollback");
    } catch {
      /* Destroyed below. */
    }
    throw error;
  } finally {
    connection.release(true);
  }
}

export async function readRuntimeBundle(
  session: TimedSqlSession,
  scope: TimedRuntimeScope,
  executionId: string,
) {
  const result = await session.query(
    `select public.${timedReportFunction("bundle")}($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value`,
    [
      scope.workspaceId,
      scope.projectId,
      scope.campaignId,
      z.uuid().parse(executionId),
    ],
  );
  return result.rows[0]?.value as unknown;
}

export async function readRuntimeDraft(
  session: TimedSqlSession,
  scope: TimedRuntimeScope,
  draftId: string,
) {
  const result = await session.query(
    `select public.${timedReportFunction("read")}($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value`,
    [
      scope.workspaceId,
      scope.projectId,
      scope.campaignId,
      z.uuid().parse(draftId),
    ],
  );
  return result.rows[0]?.value as unknown;
}
