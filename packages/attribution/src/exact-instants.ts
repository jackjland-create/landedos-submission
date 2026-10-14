import { z } from "zod";

// ATT-01 V2. Validate before Date is used for timezone conversion; never lose
// the fractional remainder in eligibility or ordering comparisons.
const inputInstant = z.iso.datetime({ offset: true }).refine((value) => {
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? "";
  return fraction.length <= 6 && Number.isFinite(Date.parse(value));
}, "At most six fractional timestamp digits are supported");

export function exactMicros(value: string): bigint {
  const valid = inputInstant.parse(value);
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(valid)?.[1] ?? "";
  return (
    BigInt(Date.parse(valid)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
  );
}

export function instantFromMicros(value: bigint): string {
  const remainder = ((value % 1000n) + 1000n) % 1000n;
  const milliseconds = (value - remainder) / 1000n;
  return new Date(Number(milliseconds))
    .toISOString()
    .replace("Z", `${remainder.toString().padStart(3, "0")}Z`);
}

export function exactInstant(value: string): string {
  return instantFromMicros(exactMicros(value));
}

export const exactInstantSchema = inputInstant.transform(exactInstant);
