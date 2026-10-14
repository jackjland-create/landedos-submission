"use client";

import { useParams } from "next/navigation";
import { ClarityReporting } from "@/components/clarity-reporting";

export default function PerformanceReportError({
  reset,
}: {
  reset: () => void;
}) {
  const params = useParams<{ projectId: string }>();
  return (
    <ClarityReporting
      projectSlug={params.projectId}
      retryControl={
        <button className="action-button" onClick={reset} type="button">
          Try Again
        </button>
      }
      sourceMode={params.projectId === "demo" ? "reference" : "issued"}
      state="error"
    />
  );
}
