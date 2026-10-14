export const reportModes = [
  "funnel",
  "creators",
  "economics",
  "evidence",
  "decision",
] as const;

export type ReportMode = (typeof reportModes)[number];

export function isReportMode(value: string | null): value is ReportMode {
  return reportModes.some((mode) => mode === value);
}
