import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ReportingStudioReference,
  type StudioView,
} from "@/components/reporting-studio-reference";
import { buildReportingStudioViewModel } from "@/lib/reports/studio-view-model";
import {
  buildReportVisualFixture,
  isReportVisualState,
  reportVisualFixturesEnabled,
} from "@/lib/reports/visual-fixtures";

type PageProps = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{
    theme?: string | string[];
    view?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landed Studio reporting reference",
  robots: { follow: false, index: false },
};

export default async function ReportingStudioPage({
  params,
  searchParams,
}: PageProps) {
  const { state } = await params;
  const query = await searchParams;
  const rawTheme = Array.isArray(query.theme) ? query.theme[0] : query.theme;
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const initialTheme =
    rawTheme === "dark" || rawTheme === "system" ? rawTheme : "light";
  const initialView: StudioView =
    rawView === "creators" || rawView === "economics" || rawView === "evidence"
      ? rawView
      : "overview";
  const enabled = reportVisualFixturesEnabled({
    explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });

  if (!enabled || !isReportVisualState(state)) notFound();

  const fixture =
    state === "ready" || state === "partial" || state === "stale"
      ? buildReportVisualFixture(state)
      : null;
  const model = fixture
    ? buildReportingStudioViewModel({
        campaign: fixture.campaign,
        comparisonVersion: fixture.comparisonVersion,
        evidencePaths: fixture.rankingEvidencePaths,
        selectedVersion: fixture.selectedVersion,
      })
    : null;

  return (
    <ReportingStudioReference
      initialTheme={initialTheme}
      initialView={initialView}
      model={model}
      state={state}
    />
  );
}
