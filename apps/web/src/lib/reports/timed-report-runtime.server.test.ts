import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTimedRuntimeEnvironment,
  withTimedReportTransaction,
  localDevnetReportEnabled,
  timedReportFunction,
} from "./timed-report-runtime.server";
const actor = "30990000-0000-4000-8000-000000000001";
function fixture() {
  const query = vi.fn(async (sql: string) =>
    sql.includes("current_user")
      ? {
          rows: [
            {
              role: "landed_timed_report_server",
              login: "landed_timed_report_server",
              database: "landed_wf_verify_http_20260921_issuer01",
            },
          ],
        }
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
describe("isolated report transaction boundary", () => {
  function devnetEnvironment() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDED_EXTERNAL_DEVNET_SESSION", "1");
    vi.stubEnv("EXTERNAL_DEVNET_PUBLIC_GATE", "1");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REHEARSAL", "1");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REPORTS", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("LANDED_LOCAL_DEVNET_QUIESCENCE_RECEIPT", "a".repeat(64));
  }
  it("requires the explicit exact devnet report scope and rejects other hosts", () => {
    devnetEnvironment();
    expect(localDevnetReportEnabled()).toBe(true);
    expect(() => assertTimedRuntimeEnvironment("localhost:3319")).not.toThrow();
    for (const host of [
      "localhost:3210",
      "127.0.0.1:3319",
      "example.com",
      null,
    ])
      expect(() => assertTimedRuntimeEnvironment(host)).toThrow();
    vi.stubEnv("VERCEL", "1");
    expect(() => timedReportFunction("bundle")).toThrow();
  });
  it("uses only guarded devnet wrapper names, never grants the generic kernels", () => {
    devnetEnvironment();
    expect(
      ["bundle", "save", "read", "recover", "confirm"].map((op) =>
        timedReportFunction(op as Parameters<typeof timedReportFunction>[0]),
      ),
    ).toEqual([
      "load_local_devnet_report_evidence_bundle",
      "save_local_devnet_report_draft",
      "read_local_devnet_report_draft",
      "recover_local_devnet_report_draft",
      "confirm_local_devnet_report_draft",
    ]);
    vi.stubEnv("LANDED_LOCAL_DEVNET_REHEARSAL", "0");
    expect(() => timedReportFunction("save")).toThrow();
  });
  it("uses the same devnet identity, actor and receipt transaction for reports", async () => {
    devnetEnvironment();
    const f = fixture();
    f.query.mockImplementation(async (sql) =>
      sql.includes("current_user")
        ? {
            rows: [
              {
                role: "landed_devnet_rehearsal_server",
                login: "landed_devnet_rehearsal_server",
                database: "landed_wf_devnet_rehearsal_01",
              },
            ],
          }
        : { rows: [] },
    );
    expect(
      await withTimedReportTransaction(
        f.client,
        async (_sql, id) => id,
        f.pool,
      ),
    ).toBe(actor);
    expect(f.query).toHaveBeenCalledWith(
      "select set_config('landed.local_devnet_quiescence_receipt',$1,true)",
      ["a".repeat(64)],
    );
    expect(f.query).toHaveBeenLastCalledWith("commit");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rejects a legacy report identity or absent receipt in devnet mode", async () => {
    devnetEnvironment();
    const f = fixture();
    const action = vi.fn();
    await expect(
      withTimedReportTransaction(f.client, action, f.pool),
    ).rejects.toThrow("identity");
    expect(action).not.toHaveBeenCalled();
    vi.stubEnv("LANDED_LOCAL_DEVNET_QUIESCENCE_RECEIPT", "");
    f.connect.mockClear();
    await expect(
      withTimedReportTransaction(f.client, action, f.pool),
    ).rejects.toThrow();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("sets only verified transaction-local actor, commits and destroys connection", async () => {
    const f = fixture();
    const value = await withTimedReportTransaction(
      f.client,
      async (_sql, currentActor) => currentActor,
      f.pool,
    );
    expect(value).toBe(actor);
    expect(f.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    expect(f.query).toHaveBeenLastCalledWith("commit");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rejects absent auth before connecting", async () => {
    const f = fixture();
    f.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as never);
    await expect(
      withTimedReportTransaction(f.client, vi.fn(), f.pool),
    ).rejects.toThrow("management access");
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("binds successive checkouts to each freshly verified actor", async () => {
    const first = fixture();
    const second = fixture();
    const otherActor = "30990000-0000-4000-8000-000000000002";
    second.getUser.mockResolvedValue({
      data: { user: { id: otherActor } },
      error: null,
    });
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ query: first.query, release: first.release })
      .mockResolvedValueOnce({ query: second.query, release: second.release });
    const sharedPool = { connect } as unknown as Pick<Pool, "connect">;
    await withTimedReportTransaction(
      first.client,
      async (_, id) => {
        expect(id).toBe(actor);
      },
      sharedPool,
    );
    await withTimedReportTransaction(
      second.client,
      async (_, id) => {
        expect(id).toBe(otherActor);
      },
      sharedPool,
    );
    expect(first.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    expect(second.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [otherActor],
    );
    expect(second.query).not.toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    expect(first.release).toHaveBeenCalledWith(true);
    expect(second.release).toHaveBeenCalledWith(true);
  });
  it("does not repeat an action after an uncertain commit acknowledgement", async () => {
    const f = fixture();
    const normal = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) => {
      if (sql === "commit") throw new Error("commit acknowledgement lost");
      return normal(sql);
    });
    const operation = vi.fn(async () => "issued");
    await expect(
      withTimedReportTransaction(f.client, operation, f.pool),
    ).rejects.toThrow("commit acknowledgement lost");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenLastCalledWith("rollback");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rejects owner connection before any source action", async () => {
    const f = fixture();
    const normal = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) =>
      sql.includes("current_user")
        ? {
            rows: [
              {
                role: "postgres",
                login: "postgres",
                database: "landed_wf_verify_http_20260921_issuer01",
              },
            ],
          }
        : normal(sql),
    );
    const operation = vi.fn();
    await expect(
      withTimedReportTransaction(f.client, operation, f.pool),
    ).rejects.toThrow("identity");
    expect(operation).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith("rollback");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rolls back on action failure and never commits", async () => {
    const f = fixture();
    await expect(
      withTimedReportTransaction(
        f.client,
        async () => {
          throw new Error("source drift");
        },
        f.pool,
      ),
    ).rejects.toThrow("source drift");
    expect(f.query).not.toHaveBeenCalledWith("commit");
    expect(f.query).toHaveBeenLastCalledWith("rollback");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("destroys connection even when rollback also fails", async () => {
    const f = fixture();
    const normal = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) => {
      if (sql === "rollback") throw new Error("lost connection");
      return normal(sql);
    });
    await expect(
      withTimedReportTransaction(
        f.client,
        async () => {
          throw new Error("original error");
        },
        f.pool,
      ),
    ).rejects.toThrow("original error");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rejects production, hosted or unflagged environment", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("LANDED_TIMED_REPORT_ISSUANCE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
    expect(() => assertTimedRuntimeEnvironment("127.0.0.1:3212")).not.toThrow();
    expect(() => assertTimedRuntimeEnvironment("example.com")).toThrow();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertTimedRuntimeEnvironment("127.0.0.1:3212")).toThrow();
  });
});
