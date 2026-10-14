import "server-only";
import { randomUUID } from "node:crypto";
import { commercialPlanSnapshotCompensationLineSchema } from "@landed/contracts";
import { z } from "zod";
import {
  contractedCostReviewSchema,
  campaignMetricSnapshotSchema,
  timedCampaignReportReviewSchema,
} from "@landed/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateTimedReportReview } from "./timed-report-calculation.server";
import { projectTimedCampaignHandoff } from "./timed-campaign-handoff.server";
import {
  readRuntimeBundle,
  readRuntimeDraft,
  timedRuntimeScopeSchema,
  withTimedReportTransaction,
  timedReportFunction,
  localDevnetReportEnabled,
} from "./timed-report-runtime.server";

const sourceRequest = timedRuntimeScopeSchema.extend({ executionId: z.uuid() });
const draftRequest = timedRuntimeScopeSchema.extend({ draftId: z.uuid() });
export const timedWorkflowRequestSchema = z.discriminatedUnion("action", [
  sourceRequest.extend({ action: z.literal("sources") }),
  sourceRequest.extend({
    action: z.literal("prepare"),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    currencyCode: contractedCostReviewSchema.shape.currencyCode,
    additionalCosts: contractedCostReviewSchema.shape.additionalCosts,
    decisions: contractedCostReviewSchema.shape.decisions,
  }),
  draftRequest.extend({ action: z.literal("read") }),
  draftRequest.extend({ action: z.literal("recover") }),
  draftRequest.extend({
    action: z.literal("confirm"),
    reason: z.string().trim().min(8).max(500),
    confirmed: z.literal(true),
  }),
]);
const receiptSchema = z.strictObject({
  reportVersionId: z.uuid(),
  reportId: z.uuid(),
  version: z.number().int().positive(),
  inserted: z.boolean(),
  issuedAt: z.string(),
});
const draftSchema = z.strictObject({
  draftId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  calculation: z.unknown(),
  expiresAt: z.string(),
  expired: z.boolean(),
  receipt: receiptSchema.nullable(),
});
const bundleSchema = z.object({
  localDevnetBoundary: z
    .strictObject({
      protocol: z.literal("landed:local-devnet-report-boundary:1"),
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      campaignId: z.uuid(),
      executionId: z.uuid(),
    })
    .optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.string(),
  evidence: z.object({
    executionReview: z.object({
      reportReview: timedCampaignReportReviewSchema,
    }),
  }),
});
const amountSchema = z.object({
  status: z.enum(["available", "not_available"]),
  amountMinor: z.string().regex(/^\d+$/).nullable(),
});

/** Only selected scalar review fields leave the trusted calculation boundary. */
export function projectTimedDraft(raw: unknown) {
  const draft = draftSchema.parse(raw);
  const calculation = z
    .object({
      protocol: z.literal("landed:timed-report-calculation:1"),
      measurementWindow: z.object({
        startedAt: z.string(),
        endedAt: z.string(),
      }),
      coverage: z.object({ checkedAt: z.string() }),
      costReview: z.object({
        currencyCode: z.string(),
        total: amountSchema,
        additionalCosts: z.enum(["none_declared", "unknown"]),
        lines: z.array(
          z.object({
            compensationLineId: z.uuid(),
            packageId: z.uuid(),
            creatorId: z.uuid(),
            terms: commercialPlanSnapshotCompensationLineSchema,
            inclusion: z.enum(["included", "excluded"]),
            reason: z.string(),
          }),
        ),
      }),
      metricSnapshot: campaignMetricSnapshotSchema,
    })
    .parse(draft.calculation);
  return {
    draftId: draft.draftId,
    expiresAt: draft.expiresAt,
    expired: draft.expired,
    receipt: draft.receipt,
    scope: {
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      campaignId: draft.campaignId,
    },
    measurementWindow: calculation.measurementWindow,
    checkedAt: calculation.coverage.checkedAt,
    costs: calculation.costReview,
    costPerQualifiedWallet:
      calculation.metricSnapshot.metrics.cpqw.status === "available"
        ? calculation.metricSnapshot.metrics.cpqw.rateMinorDecimal
        : null,
    qualifiedWallets:
      calculation.metricSnapshot.metrics.cpqw.denominator.status === "available"
        ? calculation.metricSnapshot.metrics.cpqw.denominator.value
        : null,
    costBasis: "contracted_not_paid" as const,
    coverage: "retained_consented_history_only" as const,
    unavailable: ["activation", "protocolRevenue", "impressions"] as const,
  };
}

/** Authenticated server entry; raw caller source/calculation/actor keys rejected. */
export async function runTimedReportWorkflow(
  client: SupabaseClient,
  raw: unknown,
) {
  const request = timedWorkflowRequestSchema.parse(raw);
  const scope = {
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    campaignId: request.campaignId,
  };
  return withTimedReportTransaction(client, async (sql, actor) => {
    if (request.action === "sources" || request.action === "prepare") {
      const rawBundle = await readRuntimeBundle(
        sql,
        scope,
        request.executionId,
      );
      const bundle = bundleSchema.parse(rawBundle);
      const devnetProvenance = localDevnetReportEnabled();
      if (
        devnetProvenance &&
        (bundle.localDevnetBoundary?.workspaceId !== scope.workspaceId ||
          bundle.localDevnetBoundary?.projectId !== scope.projectId ||
          bundle.localDevnetBoundary?.campaignId !== scope.campaignId ||
          bundle.localDevnetBoundary?.executionId !== request.executionId)
      )
        throw new Error("Exact local devnet report provenance is unavailable.");
      const sources =
        bundle.evidence.executionReview.reportReview.reportSources;
      if (
        sources.workspaceId !== scope.workspaceId ||
        sources.projectId !== scope.projectId ||
        sources.campaignId !== scope.campaignId
      )
        throw new Error("Report review scope changed.");
      let browserProvenance = false;
      if (
        request.action === "sources" &&
        process.env.LANDED_BROWSER_CAMPAIGN === "1"
      ) {
        browserProvenance =
          (
            await sql.query(
              "select public.read_local_browser_campaign_provenance($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [
                scope.workspaceId,
                scope.projectId,
                scope.campaignId,
                request.executionId,
              ],
            )
          ).rows[0]?.value === true;
        if (!browserProvenance)
          throw new Error("Browser campaign provenance unavailable.");
      }
      if (request.action === "sources")
        return {
          kind: "sources" as const,
          sourceHash: bundle.sourceHash,
          checkedAt: bundle.checkedAt,
          handoff: projectTimedCampaignHandoff(
            rawBundle,
            scope,
            request.executionId,
            browserProvenance,
            devnetProvenance,
          ),
          measurementWindow: sources.measurementWindow,
          lines: sources.commercialPlanSnapshot.packages.flatMap((p) =>
            p.compensationLines.map((line) => ({
              id: line.id,
              packageLabel: p.packageLabel,
              terms: line,
            })),
          ),
        };
      if (request.sourceHash !== bundle.sourceHash)
        throw new Error("Report sources changed; review again.");
      const costs = {
        workspaceId: sources.workspaceId,
        projectId: sources.projectId,
        campaignId: sources.campaignId,
        commercialPlanVersionId: sources.commercialPlanVersionId,
        commercialPlanSnapshotHash: sources.commercialPlanSnapshotHash,
        ruleVersionId: sources.ruleVersionId,
        measurementWindow: sources.measurementWindow,
        policy: { basis: "contracted", version: 1 },
        currencyCode: request.currencyCode,
        additionalCosts: request.additionalCosts,
        decisions: request.decisions,
      };
      const existing = await client
        .from("reports")
        .select("id")
        .eq("project_id", scope.projectId)
        .eq("campaign_id", scope.campaignId)
        .maybeSingle();
      if (existing.error)
        throw new Error("Existing report identity is unavailable.");
      const identity = {
        reportApprovalId: randomUUID(),
        executionApprovalId: request.executionId,
        reportId: existing.data
          ? z.uuid().parse(existing.data.id)
          : randomUUID(),
        reportVersionId: randomUUID(),
        metricSnapshotId: randomUUID(),
        issueRequestId: randomUUID(),
        requestedBy: actor,
      };
      const calculation = calculateTimedReportReview(
        rawBundle,
        costs,
        identity,
      );
      const ttl = z.coerce
        .number()
        .int()
        .min(60)
        .max(3600)
        .parse(process.env.LANDED_TIMED_DRAFT_TTL_SECONDS ?? "900");
      const draftId = randomUUID();
      await sql.query(
        `select public.${timedReportFunction("save")}($1::uuid,$2::jsonb,$3::integer) as value`,
        [draftId, JSON.stringify(calculation), ttl],
      );
      return {
        kind: "draft" as const,
        ...projectTimedDraft(await readRuntimeDraft(sql, scope, draftId)),
      };
    }
    if (request.action === "read")
      return {
        kind: "draft" as const,
        ...projectTimedDraft(
          await readRuntimeDraft(sql, scope, request.draftId),
        ),
      };
    const args = [
      scope.workspaceId,
      scope.projectId,
      scope.campaignId,
      request.draftId,
    ];
    if (request.action === "recover") {
      const result = await sql.query(
        `select public.${timedReportFunction("recover")}($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value`,
        args,
      );
      return {
        kind: "receipt" as const,
        receipt: receiptSchema.nullable().parse(result.rows[0]?.value),
      };
    }
    const result = await sql.query(
      `select public.${timedReportFunction("confirm")}($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) as value`,
      [...args, request.reason],
    );
    return {
      kind: "receipt" as const,
      receipt: receiptSchema.parse(result.rows[0]?.value),
    };
  });
}
export type TimedWorkflowResult = Awaited<
  ReturnType<typeof runTimedReportWorkflow>
>;
