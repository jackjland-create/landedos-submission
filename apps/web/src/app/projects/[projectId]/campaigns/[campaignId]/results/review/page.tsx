import { notFound } from "next/navigation";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import ReportReviewPage from "@/app/visual-tests/reporting-studio/review/page";

// RPT-03 / BRD-04: reuse the guarded, authenticated review boundary in the app.
// All reads/writes still authorize the exact campaign scope on the server.
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review campaign results",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const route = await params;
  if (
    route.projectId !== project.id ||
    !z.uuid().safeParse(route.campaignId).success
  )
    notFound();
  const query = await searchParams;
  return ReportReviewPage({
    searchParams: Promise.resolve({
      executionId: query.executionId,
      draftId: query.draftId,
      theme: query.theme,
      campaignId: route.campaignId,
      projectId: project.databaseId,
      workspaceId: project.workspaceId,
    }),
  });
}
