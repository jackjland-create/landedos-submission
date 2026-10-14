/** Explicit UTC plus browser-local zone. No locale-dependent reinterpretation of inputs. */
export function reviewTime(value: string, localZone?: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "Time unavailable";
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
      timeZoneName: "short",
    }).format(instant);
  const zone = localZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone === "UTC" ? format("UTC") : `${format(zone)} (${format("UTC")})`;
}

export function earliestReviewDeadline(
  reviewExpiry: string,
  sessionCutoff?: string | null,
) {
  const expiry = Date.parse(reviewExpiry);
  if (!Number.isFinite(expiry)) return null;
  if (sessionCutoff === null) return null;
  if (sessionCutoff === undefined) return reviewExpiry;
  const cutoff = Date.parse(sessionCutoff);
  if (!Number.isFinite(cutoff)) return null;
  return cutoff < expiry ? sessionCutoff : reviewExpiry;
}

export function utcFieldInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const seconds = value.length === 16 ? `${value}:00` : value;
  const instant = new Date(`${seconds}Z`);
  return Number.isFinite(instant.getTime()) &&
    instant.toISOString().startsWith(seconds)
    ? `${seconds}Z`
    : null;
}
