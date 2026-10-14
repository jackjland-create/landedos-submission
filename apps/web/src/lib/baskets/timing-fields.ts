import {
  campaignTimingProposalSchema,
  type CampaignTimingProposal,
} from "@landed/contracts";

export const timingFields = [
  "flightStart",
  "flightEnd",
  "measurementStart",
  "measurementEnd",
] as const;
export type TimingField = (typeof timingFields)[number];
export type TimingFields = Record<TimingField, string>;
const paths = {
  flightStart: ["flight", "startedAt"],
  flightEnd: ["flight", "endedAt"],
  measurementStart: ["measurement", "startedAt"],
  measurementEnd: ["measurement", "endedAt"],
} as const;

/** Native controls edit UTC wall-clock seconds, never the browser's timezone.
 * Unchanged boundaries retain the original sub-second precision. */
export function timingToFields(
  timing: CampaignTimingProposal | null,
): TimingFields {
  return Object.fromEntries(
    timingFields.map((key) => {
      const [period, boundary] = paths[key];
      return [key, timing ? timing[period][boundary].slice(0, 19) : ""];
    }),
  ) as TimingFields;
}

export function fieldsToTiming(
  fields: TimingFields,
  saved: CampaignTimingProposal | null,
) {
  const initial = timingToFields(saved);
  const errors: Partial<Record<TimingField, string>> = {};
  const value = {
    schemaVersion: 1 as const,
    flight: { startedAt: "", endedAt: "" },
    measurement: { startedAt: "", endedAt: "" },
  };
  for (const key of timingFields) {
    const [period, boundary] = paths[key];
    const wallTime =
      fields[key].length === 16 ? `${fields[key]}:00` : fields[key];
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(fields[key])) {
      errors[key] = "Enter a complete date and time in UTC.";
    }
    value[period][boundary] =
      saved && wallTime === initial[key]
        ? saved[period][boundary]
        : `${wallTime}Z`;
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const parsed = campaignTimingProposalSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = timingFields.find(
        (field) =>
          paths[field][0] === issue.path[0] &&
          paths[field][1] === issue.path[1],
      );
      if (key)
        errors[key] =
          issue.code === "custom"
            ? issue.message
                .replaceAll("Flight", "Campaign activity")
                .replaceAll("flight", "campaign activity")
            : "Enter a valid calendar date and time.";
    }
    return { ok: false as const, errors };
  }
  return { ok: true as const, timing: parsed.data };
}
