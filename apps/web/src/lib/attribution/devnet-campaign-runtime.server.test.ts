import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertLocalDevnetRehearsalHost,
  localDevnetActionSchema,
  localDevnetRehearsalEnabled,
  runLocalDevnetAction,
  withLocalDevnetRehearsalTransaction,
} from "./devnet-campaign-runtime.server";

const actor = "30990000-0000-4000-8000-000000000001";
const receipt = "a".repeat(64);
const runtimeEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LANDED_LOCAL_DEVNET_QUIESCENCE_RECEIPT: receipt,
};

function fixture(
  role = "landed_devnet_rehearsal_server",
  database = "landed_wf_devnet_rehearsal_01",
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

describe("local devnet rehearsal adapter", () => {
  it.each([
    [
      "review",
      {
        action: "activate",
        campaignId: actor,
        transitionRequestId: actor,
        reason: "Exact local activation",
        acknowledged: true,
      },
    ],
    [
      "review",
      {
        action: "prepareCommercial",
        basketId: actor,
        scenarioId: actor,
        revision: 1,
      },
    ],
    [
      "review",
      {
        action: "prepare",
        campaignId: "30990000-0000-4000-8000-000000000002",
        reconciliationJobId: actor,
      },
    ],
    [
      "drain",
      { action: "prepare", campaignId: actor, reconciliationJobId: actor },
    ],
    ["unknown", { action: "recover", campaignId: actor, reviewId: actor }],
  ])(
    "locks %s campaign input before Auth or database acquisition: %j",
    async (mode, input) => {
      const f = fixture();
      vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", mode);
      vi.stubEnv("LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID", actor);
      await expect(runLocalDevnetAction(f.client, input)).rejects.toThrow(
        "Closed review does not permit campaign input changes",
      );
      expect(f.getUser).not.toHaveBeenCalled();
      expect(f.connect).not.toHaveBeenCalled();
    },
  );
  it("binds the verified actor and server quiescence receipt in one transaction", async () => {
    const f = fixture();
    expect(
      await withLocalDevnetRehearsalTransaction(
        f.client,
        async (_, id) => id,
        f.pool,
        runtimeEnv,
        { requireQuiescenceReceipt: true },
      ),
    ).toBe(actor);
    expect(f.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub',$1,true)",
      [actor],
    );
    expect(f.query).toHaveBeenCalledWith(
      "select set_config('landed.local_devnet_quiescence_receipt',$1,true)",
      [receipt],
    );
    expect(f.query).toHaveBeenLastCalledWith("commit");
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it.each([
    ["postgres", "landed_wf_devnet_rehearsal_01"],
    ["landed_devnet_rehearsal_server", "other_database"],
  ])(
    "rejects unexpected %s/%s before the operation",
    async (role, database) => {
      const f = fixture(role, database);
      const operation = vi.fn();
      await expect(
        withLocalDevnetRehearsalTransaction(
          f.client,
          operation,
          f.pool,
          runtimeEnv,
        ),
      ).rejects.toThrow("identity");
      expect(operation).not.toHaveBeenCalled();
      expect(f.query).toHaveBeenLastCalledWith("rollback");
      expect(f.release).toHaveBeenCalledWith(true);
    },
  );

  it("requires a verified current user", async () => {
    const f = fixture();
    f.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as never);
    await expect(
      withLocalDevnetRehearsalTransaction(
        f.client,
        vi.fn(),
        f.pool,
        runtimeEnv,
      ),
    ).rejects.toThrow("Sign in");
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("rejects an absent or caller-shaped quiescence receipt", async () => {
    const f = fixture();
    await expect(
      withLocalDevnetRehearsalTransaction(
        f.client,
        vi.fn(),
        f.pool,
        {
          NODE_ENV: "test",
          LANDED_LOCAL_DEVNET_QUIESCENCE_RECEIPT: "browser-says-stopped",
        },
        { requireQuiescenceReceipt: true },
      ),
    ).rejects.toThrow();
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("does not require execution authority for link or activation work", async () => {
    const f = fixture();
    await expect(
      withLocalDevnetRehearsalTransaction(
        f.client,
        async () => "activation-ready",
        f.pool,
        { NODE_ENV: "test" },
      ),
    ).resolves.toBe("activation-ready");
    expect(f.query).not.toHaveBeenCalledWith(
      "select set_config('landed.local_devnet_quiescence_receipt',$1,true)",
      expect.anything(),
    );
  });

  it("does not retry an operation after an uncertain commit", async () => {
    const f = fixture();
    const normal = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) => {
      if (sql === "commit") throw Error("lost acknowledgement");
      return normal(sql);
    });
    const operation = vi.fn(async () => true);
    await expect(
      withLocalDevnetRehearsalTransaction(
        f.client,
        operation,
        f.pool,
        runtimeEnv,
      ),
    ).rejects.toThrow("acknowledgement");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it("denies hosted origins and hosted runtime flags", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("LANDED_LOCAL_DEVNET_REHEARSAL", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");
    expect(() =>
      assertLocalDevnetRehearsalHost("127.0.0.1:3210"),
    ).not.toThrow();
    expect(() => assertLocalDevnetRehearsalHost("example.test")).toThrow();
    vi.stubEnv("VERCEL", "1");
    expect(() => assertLocalDevnetRehearsalHost("127.0.0.1:3210")).toThrow();
  });

  it("admits only the explicit loopback production session used by the bounded runner", () => {
    const production = {
      NODE_ENV: "production",
      LANDED_LOCAL_DEVNET_REHEARSAL: "1",
      LANDED_EXTERNAL_DEVNET_SESSION: "1",
      EXTERNAL_DEVNET_PUBLIC_GATE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
    } satisfies NodeJS.ProcessEnv;

    expect(localDevnetRehearsalEnabled(production)).toBe(true);
    expect(
      localDevnetRehearsalEnabled({
        ...production,
        LANDED_EXTERNAL_DEVNET_SESSION: "0",
      }),
    ).toBe(false);
    expect(
      localDevnetRehearsalEnabled({
        ...production,
        EXTERNAL_DEVNET_PUBLIC_GATE: "0",
      }),
    ).toBe(false);
    expect(localDevnetRehearsalEnabled({ ...production, VERCEL: "1" })).toBe(
      false,
    );
    expect(
      localDevnetRehearsalEnabled({
        ...production,
        NEXT_PUBLIC_SUPABASE_URL: "https://hosted.example.test",
      }),
    ).toBe(false);
  });

  it("accepts only bounded server-derived actions", () => {
    const base = { campaignId: actor };
    const basket = { basketId: actor };
    expect(
      localDevnetActionSchema.safeParse({
        action: "prepareCommercial",
        ...basket,
        scenarioId: actor,
        revision: 3,
      }).success,
    ).toBe(true);
    expect(
      localDevnetActionSchema.safeParse({
        action: "confirmCommercial",
        ...basket,
        reviewId: actor,
        acknowledged: true,
      }).success,
    ).toBe(true);
    expect(
      localDevnetActionSchema.safeParse({
        action: "readActivation",
        ...base,
      }).success,
    ).toBe(true);
    expect(
      localDevnetActionSchema.safeParse({
        action: "issueLink",
        ...base,
        contentAssetId: actor,
        generationRequestId: actor,
      }).success,
    ).toBe(true);
    expect(
      localDevnetActionSchema.safeParse({
        action: "confirm",
        ...base,
        reviewId: actor,
        reason: "Reviewed exact observed action",
        acknowledged: true,
      }).success,
    ).toBe(true);

    for (const forbidden of [
      "actorId",
      "destinationUrl",
      "keyVersion",
      "expiresAt",
      "candidates",
      "protectedWalletMappingId",
      "canonicalChainEventId",
      "quiescenceReceipt",
      "targetStatus",
    ])
      expect(
        localDevnetActionSchema.safeParse({
          action: "prepare",
          ...base,
          reconciliationJobId: actor,
          [forbidden]: actor,
        }).success,
      ).toBe(false);

    expect(
      localDevnetActionSchema.safeParse({
        action: "activate",
        ...base,
        transitionRequestId: actor,
        reason: "Reviewed exact activation",
        acknowledged: false,
      }).success,
    ).toBe(false);

    expect(
      localDevnetActionSchema.safeParse({
        action: "prepareCommercial",
        ...basket,
        scenarioId: actor,
        revision: 3,
        destinationUrl: "https://caller.example/measure",
      }).success,
    ).toBe(false);
  });
});
