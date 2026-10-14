import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  PerformanceReport,
  ReportLoadingState,
  ReportPermission,
  ReportRecoverableError,
  ReportsEmpty,
} from "@/components/performance-report";
import { isReportMode } from "@/lib/reports/modes";
import {
  buildReportVisualFixture,
  isReportVisualState,
  reportVisualFixturesEnabled,
} from "@/lib/reports/visual-fixtures";

type PageProps = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reporting visual QA",
  robots: { follow: false, index: false },
};

export default async function ReportingVisualStatePage({
  params,
  searchParams,
}: PageProps) {
  const { state } = await params;
  const query = await searchParams;
  const rawMode = Array.isArray(query.mode) ? query.mode[0] : query.mode;
  const requestedMode = rawMode ?? null;
  const initialMode = isReportMode(requestedMode) ? requestedMode : "funnel";
  const enabled = reportVisualFixturesEnabled({
    explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });

  if (!enabled || !isReportVisualState(state)) notFound();

  let content;
  if (state === "loading") {
    content = <ReportLoadingState />;
  } else if (state === "empty") {
    content = <ReportsEmpty />;
  } else if (state === "error") {
    content = (
      <ReportRecoverableError
        retryControl={
          <Link className="action-button" href="/visual-tests/reporting/ready">
            TRY AGAIN
          </Link>
        }
      />
    );
  } else if (state === "permission") {
    content = <ReportPermission />;
  } else {
    const fixture = buildReportVisualFixture(state);
    content = (
      <PerformanceReport
        campaign={fixture.campaign}
        comparisonVersion={fixture.comparisonVersion}
        initialMode={initialMode}
        projectSlug="helios"
        rankingEvidencePaths={fixture.rankingEvidencePaths}
        report={fixture.report}
        selectedVersion={fixture.selectedVersion}
      />
    );
  }

  return (
    <AppShell activeSection="reports" projectId="helios">
      {content}
    </AppShell>
  );
}
