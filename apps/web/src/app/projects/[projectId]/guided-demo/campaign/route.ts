import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { guidedDemoManifest } from "@/lib/guided-demo-manifest";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const viewSchema = z.enum(["workspace", "content-assets", "tracking"]);
const campaignViews = {
  workspace: "control",
  "content-assets": "content",
  tracking: "tracking",
} as const;

function privateResponse(message: string, status: number) {
  return NextResponse.json(
    { message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const sourceUrl = new URL(request.url);
  const view = viewSchema.safeParse(sourceUrl.searchParams.get("view"));

  if (projectId !== project.id || !view.success) {
    return privateResponse("The guided demo destination was not valid.", 400);
  }

  const client = await createClient();
  const { data, error } = await client
    .from("reports")
    .select("campaign_id")
    .eq("id", guidedDemoManifest.reportId)
    .eq("project_id", guidedDemoManifest.projectDatabaseId)
    .maybeSingle();

  const errorCode = (error as { code?: string } | null)?.code;
  if (errorCode === "42501") {
    return privateResponse("Guided demo access is restricted.", 403);
  }
  if (error) {
    return privateResponse(
      "The guided demo destination could not be prepared.",
      500,
    );
  }
  if (!data?.campaign_id) {
    return privateResponse(
      "The canonical guided demo has not been seeded in this environment.",
      404,
    );
  }

  const destination = new URL(
    `/projects/${projectId}/campaigns/${data.campaign_id}`,
    sourceUrl,
  );
  // A fragment cannot reveal content inside an unmounted workspace view.
  destination.searchParams.set("view", campaignViews[view.data]);
  for (const key of ["demo", "demoStep", "demoComplete", "demoOpen"]) {
    const value = sourceUrl.searchParams.get(key);
    if (value !== null) destination.searchParams.set(key, value);
  }
  if (view.data !== "workspace") destination.hash = "content-assets";

  return NextResponse.redirect(destination, 307);
}
