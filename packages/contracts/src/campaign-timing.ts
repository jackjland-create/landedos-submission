import { z } from "zod";

// BSK-09 candidate contract only. No runtime approval accepts this record yet.
// The input boundary must resolve local dates/timezones explicitly to UTC.
const instant = z.iso
  .datetime()
  .regex(
    /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/,
    "Use an explicit UTC instant with at most microsecond precision.",
  );
const period = z.strictObject({ startedAt: instant, endedAt: instant });

function micros(value: string): bigint {
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return (
    BigInt(Date.parse(`${seconds}Z`)) * 1000n + BigInt(fraction.padEnd(6, "0"))
  );
}

/** Complete proposed timing for review, not authorization or stored evidence.
 * Both periods are half-open [start, end). Measurement must cover the flight;
 * it may start earlier and end later. No dates or attribution policy are inferred.
 */
export const campaignTimingProposalSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    flight: period,
    measurement: period,
  })
  .superRefine((value, context) => {
    // Refinements may run beside field errors: never parse an invalid instant.
    if (
      ![
        value.flight.startedAt,
        value.flight.endedAt,
        value.measurement.startedAt,
        value.measurement.endedAt,
      ].every((date) => instant.safeParse(date).success)
    )
      return;
    const fs = micros(value.flight.startedAt);
    const fe = micros(value.flight.endedAt);
    const ms = micros(value.measurement.startedAt);
    const me = micros(value.measurement.endedAt);
    const issue = (path: string[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (fe <= fs)
      issue(["flight", "endedAt"], "Flight must end after it starts.");
    if (me <= ms)
      issue(
        ["measurement", "endedAt"],
        "Measurement must end after it starts.",
      );
    if (ms > fs)
      issue(
        ["measurement", "startedAt"],
        "Measurement must cover the flight start.",
      );
    if (me < fe)
      issue(
        ["measurement", "endedAt"],
        "Measurement must cover the flight end.",
      );
  });

export type CampaignTimingProposal = z.infer<
  typeof campaignTimingProposalSchema
>;
