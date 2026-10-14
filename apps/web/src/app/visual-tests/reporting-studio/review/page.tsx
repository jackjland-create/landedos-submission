import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertTimedRuntimeEnvironment } from "@/lib/reports/timed-report-runtime.server";
import { TimedReportReview } from "@/components/timed-report-review";
import { devnetReviewTiming } from "@/lib/attribution/devnet-review-timing.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Isolated report review",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    assertTimedRuntimeEnvironment((await headers()).get("host"));
  } catch {
    notFound();
  }
  const user = await (await createClient()).auth.getUser();
  const params = await searchParams;
  return (
    <TimedReportReview
      key={JSON.stringify([
        user.data.user?.id,
        params.workspaceId,
        params.projectId,
        params.campaignId,
        params.executionId,
        params.draftId,
      ])}
      signedIn={!user.error && Boolean(user.data.user)}
      reviewTiming={
        !user.error && user.data.user && typeof params.campaignId === "string"
          ? devnetReviewTiming(params.campaignId)
          : undefined
      }
      parameters={Object.fromEntries(
        Object.entries(params).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )}
    />
  );
}
