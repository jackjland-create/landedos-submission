"use client";

import { useParams } from "next/navigation";
import { ClarityReporting } from "@/components/clarity-reporting";

export default function PerformanceReportLoading() {
  const params = useParams<{ projectId: string }>();
  return (
    <ClarityReporting
      sourceMode={params.projectId === "demo" ? "reference" : "issued"}
      state="loading"
      projectSlug={params.projectId}
    />
  );
}
