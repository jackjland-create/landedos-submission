import "server-only";
import { Pool } from "pg";
import { z } from "zod";
import type { CanonicalProcessingClient } from "./canonical-processing.server";

const role = "landed_same_copy_processing_worker";
const database = "landed_wf_verify_browser_campaign_01";
let pool: Pool | undefined;
export function sameCopyProcessingEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const expiry = Date.parse(env.LANDED_SAME_COPY_PROCESSING_EXPIRES_AT ?? "");
  return (
    env.LANDED_SAME_COPY_PROCESSING === "1" &&
    env.NODE_ENV === "development" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421" &&
    Number.isFinite(expiry) &&
    expiry > now &&
    expiry <=
      Date.parse(
        env.LANDED_SAME_COPY_FRESH_WINDOW === "1"
          ? "2026-10-11T22:10:00Z"
          : "2026-10-11T21:10:00Z",
      )
  );
}

/** Dedicated acquisition login: no commercial, conversion or report authority. */
export function createSameCopyProcessingClient(
  jobId: string,
): CanonicalProcessingClient {
  z.uuid().parse(jobId);
  if (!sameCopyProcessingEnabled())
    throw new Error("Processing connection unavailable");
  const url = new URL(
    process.env.LANDED_SAME_COPY_PROCESSING_SERVER_URL ?? "invalid:",
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
    throw new Error("Processing connection unavailable");
  if (!pool) {
    pool = new Pool({
      connectionString: url.href,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    });
    pool.on("error", () =>
      console.error("Test processing connection interrupted"),
    );
  }
  return {
    rpc: async (operation, args) => {
      if (!sameCopyProcessingEnabled())
        return { data: null, error: { code: "42501" } };
      const session = await pool!.connect();
      try {
        await session.query("begin isolation level read committed");
        await session.query("set local statement_timeout='15s'");
        await session.query(
          "set local idle_in_transaction_session_timeout='15s'",
        );
        const identity = (
          await session.query(
            "select current_user as role,session_user as login,current_database() as db",
          )
        ).rows[0];
        if (
          identity?.role !== role ||
          identity?.login !== role ||
          identity?.db !== database
        )
          throw new Error("Wrong worker identity");
        const result = (
          await session.query(
            "select public.same_copy_process_rpc($1::uuid,$2::text,$3::jsonb) as value",
            [jobId, operation, JSON.stringify(args)],
          )
        ).rows[0]?.value;
        if (!sameCopyProcessingEnabled()) throw new Error("Processing expired");
        await session.query("commit");
        return { data: result, error: null };
      } catch {
        await session.query("rollback").catch(() => undefined);
        return { data: null, error: { code: "42501" } };
      } finally {
        session.release(true);
      }
    },
  };
}
