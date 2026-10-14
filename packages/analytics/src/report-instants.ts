import { z } from "zod";

export const retainedReportInstantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => {
    const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
    return fraction.length <= 6 && Number.isFinite(Date.parse(value));
  }, "Use a finite instant with at most microsecond precision");

// Only call after instant validation; retain PostgreSQL's microsecond boundary.
export function retainedReportMicros(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
  );
}
