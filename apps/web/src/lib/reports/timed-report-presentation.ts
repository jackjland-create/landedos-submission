import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
const range = z.strictObject({ startedAt: instant, endedAt: instant });

/** Public, deliberately small projection. Never add the protected calculation,
 * approval actor, source hashes, wallet mappings or raw provider data here. */
export const timedReportPresentationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  campaignId: z.uuid(),
  reportId: z.uuid(),
  reportVersionId: z.uuid(),
  version: z.number().int().positive(),
  metricSnapshotId: z.uuid(),
  commercialPlanVersionId: z.uuid(),
  approvedFlight: range,
  measurementWindow: range,
  costPolicy: z.strictObject({
    basis: z.literal("contracted"),
    version: z.literal(1),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    paid: z.literal(false),
  }),
  coverage: z.strictObject({
    scope: z.literal("retained_consented_history_only"),
    conversionEvaluation: z.literal("retained_universe_reconciled"),
    checkedAt: instant,
  }),
  providerExhaustion: z.literal("not_independently_verified"),
  unavailableMetrics: z.tuple([
    z.literal("activation"),
    z.literal("protocolRevenue"),
    z.literal("impressions"),
  ]),
});

export type TimedReportPresentation = z.infer<
  typeof timedReportPresentationSchema
>;
