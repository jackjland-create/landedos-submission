import "server-only";

import { Pool, type PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import {
  sameCopyResultsEnabled,
  isSameCopyResultsAction,
  runSameCopyResultsAction,
} from "./same-copy-results.server";
import {
  assertSameCopyTrackingAction,
  sameCopyCampaignId,
  sameCopyFreshBasketId,
  sameCopyRevisedBasketId,
  sameCopyTrackingEnabled,
  sameCopyTrackingIdentity,
} from "./same-copy-tracking-profile";

const runtimeRole = "landed_devnet_rehearsal_server";
const runtimeDatabase = "landed_wf_devnet_rehearsal_01";
const runtimePort = "56542";
const localSupabaseUrl = "http://127.0.0.1:56421";
const receiptSchema = z.string().regex(/^[0-9a-f]{64}$/);

let pool: Pool | undefined;

export function localDevnetRehearsalEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.LANDED_SAME_COPY_TRACKING !== undefined) return false;
  const isolatedLocalRuntime =
    env.NODE_ENV === "development" ||
    (env.NODE_ENV === "production" &&
      env.LANDED_EXTERNAL_DEVNET_SESSION === "1" &&
      env.EXTERNAL_DEVNET_PUBLIC_GATE === "1");
  return (
    isolatedLocalRuntime &&
    !env.VERCEL_ENV &&
    !env.VERCEL &&
    env.LANDED_LOCAL_DEVNET_REHEARSAL === "1" &&
    env.NEXT_PUBLIC_SUPABASE_URL === localSupabaseUrl
  );
}

export function assertLocalDevnetRehearsalHost(host: string | null) {
  if (
    !(
      sameCopyTrackingEnabled() ||
      localDevnetRehearsalEnabled() ||
      sameCopyResultsEnabled()
    ) ||
    !(process.env.LANDED_SAME_COPY_TRACKING !== undefined ||
    process.env.LANDED_SAME_COPY_RESULTS !== undefined
      ? /^(localhost|127\.0\.0\.1):3213$/.test(host ?? "")
      : /^(localhost|127\.0\.0\.1):\d+$/.test(host ?? ""))
  )
    throw new Error("Local devnet rehearsal unavailable");
}

export function localDevnetTrackingCampaignEnabled(
  campaignId: string,
  basketId?: string,
) {
  return (
    (sameCopyTrackingEnabled() || localDevnetRehearsalEnabled()) &&
    (process.env.LANDED_SAME_COPY_TRACKING === undefined ||
      (process.env.LANDED_SAME_COPY_REVISED_TRACKING === "1"
        ? basketId ===
          (process.env.LANDED_SAME_COPY_FRESH_WINDOW === "1"
            ? sameCopyFreshBasketId
            : sameCopyRevisedBasketId)
        : campaignId === sameCopyCampaignId))
  );
}

function runtimeIdentity(env: NodeJS.ProcessEnv) {
  if (env.LANDED_SAME_COPY_TRACKING !== undefined) {
    if (!sameCopyTrackingEnabled(env))
      throw new Error("This test connection has expired or is unavailable");
    return sameCopyTrackingIdentity;
  }
  return { role: runtimeRole, database: runtimeDatabase, port: runtimePort };
}

function quiescenceReceipt(env: NodeJS.ProcessEnv = process.env) {
  return receiptSchema.parse(env.LANDED_LOCAL_DEVNET_QUIESCENCE_RECEIPT);
}

function runtimePool() {
  if (!(sameCopyTrackingEnabled() || localDevnetRehearsalEnabled()))
    throw new Error("Local devnet rehearsal unavailable");

  const identity = runtimeIdentity(process.env);
  const url = new URL(
    (process.env.LANDED_SAME_COPY_TRACKING !== undefined
      ? process.env.LANDED_SAME_COPY_TRACKING_SERVER_URL
      : process.env.LANDED_LOCAL_DEVNET_REHEARSAL_SERVER_URL) ?? "invalid:",
  );
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== identity.port ||
    url.username !== identity.role ||
    url.pathname !== `/${identity.database}` ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Local devnet connection unavailable");

  if (!pool) {
    pool = new Pool({
      connectionString: url.href,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
    });
    pool.on("error", () =>
      console.error("Local devnet rehearsal connection interrupted."),
    );
  }
  return pool;
}

export async function withLocalDevnetRehearsalTransaction<T>(
  client: SupabaseClient,
  operation: (session: Pick<PoolClient, "query">, actor: string) => Promise<T>,
  connectionPool: Pick<Pool, "connect"> = runtimePool(),
  env: NodeJS.ProcessEnv = process.env,
  options: { requireQuiescenceReceipt?: boolean } = {},
) {
  const expectedIdentity = runtimeIdentity(env);
  const receipt = options.requireQuiescenceReceipt
    ? quiescenceReceipt(env)
    : undefined;
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
      identity?.role !== expectedIdentity.role ||
      identity?.login !== expectedIdentity.role ||
      identity?.database !== expectedIdentity.database
    )
      throw new Error("Unexpected connection identity");

    await session.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    if (receipt)
      await session.query(
        "select set_config('landed.local_devnet_quiescence_receipt',$1,true)",
        [receipt],
      );

    const result = await operation(session, actor);
    // Recheck the bounded process profile after I/O, before committing.
    runtimeIdentity(env);
    await session.query("commit");
    return result;
  } catch (error) {
    try {
      await session.query("rollback");
    } catch {
      /* The checked-out connection is destroyed below. */
    }
    throw error;
  } finally {
    session.release(true);
  }
}

const uuid = z.uuid();
const campaign = { campaignId: uuid };
const basket = { basketId: uuid };

export const localDevnetActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("prepareCommercial"),
    ...basket,
    scenarioId: uuid,
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("selectCommercial"),
    ...basket,
    sourceReviewId: uuid,
    packageIds: z
      .array(uuid)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.strictObject({
    action: z.literal("confirmCommercial"),
    ...basket,
    reviewId: uuid,
    note: z.string().trim().max(240).optional(),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("recoverCommercial"),
    ...basket,
    reviewId: uuid,
  }),
  z.strictObject({
    action: z.literal("createCampaign"),
    ...basket,
    reviewId: uuid,
    acknowledged: z.literal(true),
  }),
  z.strictObject({ action: z.literal("readActivation"), ...campaign }),
  z.strictObject({
    action: z.literal("enqueueReconciliation"),
    ...campaign,
    mappingId: uuid,
    integrationId: uuid,
    reconciliationJobId: uuid,
    reconciliationRequestId: uuid,
  }),
  z.strictObject({
    action: z.literal("readReconciliation"),
    ...campaign,
    reconciliationJobId: uuid,
  }),
  z.strictObject({
    action: z.literal("issueLink"),
    ...campaign,
    contentAssetId: uuid,
    generationRequestId: uuid,
  }),
  z.strictObject({
    action: z.literal("activate"),
    ...campaign,
    transitionRequestId: uuid,
    reason: z.string().trim().min(8).max(240),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("prepare"),
    ...campaign,
    reconciliationJobId: uuid,
  }),
  z.strictObject({
    action: z.literal("recover"),
    ...campaign,
    reviewId: uuid,
  }),
  z.strictObject({
    action: z.literal("confirm"),
    ...campaign,
    reviewId: uuid,
    reason: z.string().trim().min(8).max(240),
    acknowledged: z.literal(true),
  }),
]);

export async function runLocalDevnetAction(
  client: SupabaseClient,
  value: unknown,
) {
  const input = localDevnetActionSchema.parse(value);
  if (
    process.env.LANDED_SAME_COPY_RESULTS !== undefined &&
    isSameCopyResultsAction(input.action)
  )
    return runSameCopyResultsAction(client, input);
  assertSameCopyTrackingAction(input);
  const requiresExecutionAuthority = ["prepare", "recover", "confirm"].includes(
    input.action,
  );
  if (
    process.env.LANDED_LOCAL_DEVNET_INPUT_LOCK &&
    (process.env.LANDED_LOCAL_DEVNET_INPUT_LOCK !== "review" ||
      !requiresExecutionAuthority ||
      !("campaignId" in input) ||
      input.campaignId !== process.env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID)
  )
    throw new Error("Closed review does not permit campaign input changes");
  return withLocalDevnetRehearsalTransaction(
    client,
    async (session) => {
      const projectScope = [project.workspaceId, project.databaseId];

      switch (input.action) {
        case "prepareCommercial":
          return (
            await session.query(
              "select public.prepare_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer) as value",
              [
                ...projectScope,
                input.basketId,
                input.scenarioId,
                input.revision,
              ],
            )
          ).rows[0]?.value as unknown;
        case "selectCommercial":
          return (
            await session.query(
              "select public.prepare_selected_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid[]) as value",
              [
                ...projectScope,
                input.basketId,
                input.sourceReviewId,
                input.packageIds,
              ],
            )
          ).rows[0]?.value as unknown;
        case "confirmCommercial": {
          await session.query(
            "select public.confirm_selected_local_browser_commercial_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)",
            [
              ...projectScope,
              input.basketId,
              input.reviewId,
              input.note?.trim() || null,
            ],
          );
          return (
            await session.query(
              "select public.read_local_browser_commercial_result($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.basketId, input.reviewId],
            )
          ).rows[0]?.value as unknown;
        }
        case "recoverCommercial":
          return (
            await session.query(
              "select public.read_local_browser_commercial_result($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.basketId, input.reviewId],
            )
          ).rows[0]?.value as unknown;
        case "createCampaign":
          return (
            await session.query(
              "select public.create_local_browser_campaign($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.basketId, input.reviewId],
            )
          ).rows[0]?.value as unknown;
        case "readActivation":
          return (
            await session.query(
              "select public.read_local_devnet_activation_handoff($1::uuid,$2::uuid,$3::uuid) as value",
              [...projectScope, input.campaignId],
            )
          ).rows[0]?.value as unknown;
        case "enqueueReconciliation":
          return (
            await session.query(
              "select public.enqueue_local_devnet_closed_reconciliation($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid) as value",
              [
                ...projectScope,
                input.campaignId,
                input.mappingId,
                input.integrationId,
                input.reconciliationJobId,
                input.reconciliationRequestId,
              ],
            )
          ).rows[0]?.value as unknown;
        case "readReconciliation":
          return (
            await session.query(
              "select public.read_local_devnet_closed_reconciliation($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.campaignId, input.reconciliationJobId],
            )
          ).rows[0]?.value as unknown;
        case "issueLink":
          return (
            await session.query(
              "select * from public.issue_local_devnet_strategy_tracked_link($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)",
              [
                ...projectScope,
                input.campaignId,
                input.contentAssetId,
                input.generationRequestId,
              ],
            )
          ).rows;
        case "activate":
          return (
            await session.query(
              "select * from public.transition_local_devnet_strategy_campaign_live($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)",
              [
                ...projectScope,
                input.campaignId,
                input.transitionRequestId,
                input.reason,
              ],
            )
          ).rows;
        case "prepare":
          return (
            await session.query(
              "select public.prepare_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.campaignId, input.reconciliationJobId],
            )
          ).rows[0]?.value as unknown;
        case "recover":
          return (
            await session.query(
              "select public.read_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...projectScope, input.campaignId, input.reviewId],
            )
          ).rows[0]?.value as unknown;
        case "confirm":
          return (
            await session.query(
              "select public.confirm_local_devnet_campaign_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::boolean) as value",
              [
                ...projectScope,
                input.campaignId,
                input.reviewId,
                input.reason,
                input.acknowledged,
              ],
            )
          ).rows[0]?.value as unknown;
      }
    },
    runtimePool(),
    process.env,
    { requireQuiescenceReceipt: requiresExecutionAuthority },
  );
}
