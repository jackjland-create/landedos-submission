import {
  getProjectReportEvidence,
  reportEvidenceMetricSchema,
  ReportQueryError,
} from "@landed/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string; reportVersionId: string }>;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId, reportVersionId } = await context.params;
  const metric = reportEvidenceMetricSchema.safeParse(
    new URL(request.url).searchParams.get("metric"),
  );
  const version = z.uuid().safeParse(reportVersionId);

  if (projectId !== project.id || !metric.success || !version.success) {
    return privateJson({ message: "Evidence request was not valid." }, 400);
  }

  try {
    const client = await createClient();
    const { data: readableProject, error: projectError } = await client
      .from("projects")
      .select("id")
      .eq("id", project.databaseId)
      .maybeSingle();

    const projectErrorCode = (projectError as { code?: string } | null)?.code;
    if (!readableProject || projectErrorCode === "42501") {
      return privateJson({ message: "Evidence access is restricted." }, 403);
    }
    if (projectError) throw projectError;

    const paths = await getProjectReportEvidence(
      client,
      project.databaseId,
      version.data,
      metric.data,
    );
    return privateJson({ paths });
  } catch (error) {
    if (error instanceof ReportQueryError && error.code === "42501") {
      return privateJson({ message: "Evidence access is restricted." }, 403);
    }
    const reference = logError({
      event: "report_evidence_read_failed",
      error,
      projectId,
    });
    return privateJson(
      { message: "Evidence could not be prepared.", reference },
      500,
    );
  }
}
