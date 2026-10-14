import { z } from "zod";
import {
  retainedReportInstantSchema,
  retainedReportMicros,
} from "./report-instants";

const retainedRangeSchema = z
  .strictObject({
    startedAt: retainedReportInstantSchema,
    endedAt: retainedReportInstantSchema,
  })
  .refine(
    (value) =>
      retainedReportMicros(value.startedAt) <
      retainedReportMicros(value.endedAt),
    "Retained source range must advance",
  );

/** Precision check only: does not select an issuance period or establish freshness.
 * Metric V1 remains unchanged. Never round a microsecond boundary to make it fit.
 */
export function inspectMetricV1RangeCompatibility(rawRange: unknown) {
  const retainedRange = retainedRangeSchema.parse(rawRange);
  const start = retainedReportMicros(retainedRange.startedAt);
  const end = retainedReportMicros(retainedRange.endedAt);
  // Offset input can cross UTC year 0000/9999; V1 rejects expanded ISO years.
  const canonicalRange = {
    startedAt: new Date(retainedRange.startedAt).toISOString(),
    endedAt: new Date(retainedRange.endedAt).toISOString(),
  };
  if (
    !z.iso.datetime().safeParse(canonicalRange.startedAt).success ||
    !z.iso.datetime().safeParse(canonicalRange.endedAt).success
  ) {
    return {
      status: "outside_metric_v1_calendar_range" as const,
      retainedRange,
      metricV1Range: null,
    };
  }
  if (start % 1000n !== 0n || end % 1000n !== 0n) {
    return {
      status: "requires_microsecond_metric_version" as const,
      retainedRange,
      metricV1Range: null,
    };
  }
  return {
    status: "exactly_representable" as const,
    retainedRange,
    metricV1Range: canonicalRange,
  };
}
