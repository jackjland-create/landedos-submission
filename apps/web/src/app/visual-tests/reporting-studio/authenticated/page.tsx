import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ClarityReporting } from "@/components/clarity-reporting";
import { parseClarityQuery } from "@/lib/reports/clarity";
import { loadTimedReportClarityDetails } from "@/lib/reports/timed-report-presentation.server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Isolated signed-in report verification",
  robots: { index: false, follow: false },
};

/** BSK-09 / RPT-01–03: local authenticated read rehearsal, never an issuer. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host");
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL_ENV ||
    process.env.LANDED_TIMED_BROWSER_INTEGRATION !== "1" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55421" ||
    !/^(localhost|127\.0\.0\.1):\d+$/.test(host ?? "")
  )
    notFound();

  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (typeof value === "string") query.set(key, value);
  const client = await createClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user)
    return (
      <ClarityReporting
        initialQuery={parseClarityQuery(query)}
        state="permission"
        fixture={null}
        economics={{}}
        sourceMode="isolated-issued"
      />
    );

  let report: Awaited<ReturnType<typeof loadTimedReportClarityDetails>> | null =
    null;
  try {
    report = await loadTimedReportClarityDetails(
      client,
      async (scope) => {
        // Actor is derived exclusively from the authenticated session by Postgres.
        // The callback's independently verified actor is NEVER a caller RPC input.
        const { data, error } = await client.rpc(
          "read_issued_timed_report_details",
          {
            target_workspace_id: scope.workspaceId,
            target_project_id: scope.projectId,
            target_report_id: scope.reportId,
            target_version_id: scope.reportVersionId,
          },
        );
        if (error) throw new Error("Report unavailable.");
        return data;
      },
      {
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        reportId: params.reportId,
        reportVersionId: params.reportVersionId,
      },
    );
  } catch {
    // Indistinguishable missing/denied/invalid scope; no source data or fallback.
  }
  if (!report)
    return (
      <ClarityReporting
        initialQuery={parseClarityQuery(query)}
        state="error"
        fixture={null}
        economics={{}}
        sourceMode="isolated-issued"
      />
    );
  query.set("version", String(report.fixture.selectedVersion.version));
  return (
    <ClarityReporting
      {...report}
      initialQuery={parseClarityQuery(query)}
      state="ready"
    />
  );
}
