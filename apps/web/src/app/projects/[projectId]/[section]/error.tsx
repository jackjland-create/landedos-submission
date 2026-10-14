"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { logError } from "@/lib/observability";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { projectId } = useParams<{ projectId: string }>();

  useEffect(() => {
    logError({
      event: "project_view_failed",
      error,
      projectId,
      correlationId: error.digest,
    });
  }, [error, projectId]);

  return (
    <main className="system-state">
      <span className="eyebrow">DATA INTERRUPTED</span>
      <h1>The project view could not be prepared.</h1>
      <p>No campaign evidence has been changed. Retry the view safely.</p>
      <button className="action-button" onClick={reset} type="button">
        RETRY VIEW
      </button>
    </main>
  );
}
