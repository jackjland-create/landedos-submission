"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { earliestReviewDeadline, reviewTime } from "@/lib/review-time";

export type ReviewTiming = { decisionsCloseAt: string | null };

/** The server still enforces every decision. Recovery remains a separate read. */
export function ReviewDeadline({
  expiresAt,
  timing,
  report = false,
}: {
  expiresAt?: string;
  timing?: ReviewTiming;
  report?: boolean;
}) {
  const hydrated = useHydrated();
  const cutoff = expiresAt
    ? earliestReviewDeadline(expiresAt, timing?.decisionsCloseAt)
    : timing?.decisionsCloseAt;
  if (!cutoff)
    return timing ? (
      <p role="status">
        Session decision deadline unavailable. Check with the operator before
        approving; the review expiry alone is not the session cutoff.
      </p>
    ) : null;
  return (
    <p>
      <strong>
        {report
          ? "Complete report approval before "
          : timing
            ? "Complete both human approvals before "
            : "Complete this approval before "}
        <time dateTime={cutoff}>
          {reviewTime(cutoff, hydrated ? undefined : "UTC")}
        </time>
        .
      </strong>{" "}
      {timing &&
        (report
          ? "Review the exact result and costs now; do not wait for cleanup. Issuing the report is separate from evidence calculation."
          : "Measurement and public input are closed. Review now; do not wait for cleanup. Evidence calculation and report issuance need separate approvals.")}
    </p>
  );
}
