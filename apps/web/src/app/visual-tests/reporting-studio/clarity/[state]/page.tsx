import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClarityReporting } from "@/components/clarity-reporting";
import { buildCreatorEconomics } from "@/components/performance-report";
import { parseClarityQuery } from "@/lib/reports/clarity";
import {
  buildReportVisualFixture,
  isReportVisualState,
  reportVisualFixturesEnabled,
} from "@/lib/reports/visual-fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Clarity reporting reference",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ state: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { state } = await params;
  if (
    !reportVisualFixturesEnabled({
      explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    }) ||
    !isReportVisualState(state)
  )
    notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const fixture =
    state === "ready" || state === "partial" || state === "stale"
      ? buildReportVisualFixture(state)
      : null;
  // Sanitized fixture-only first-issuance regression, never a runtime filter.
  if (fixture && query.get("firstIssue") === "1") {
    const first = fixture.report.versions.find(
      (version) => version.version === 1,
    )!;
    fixture.report.versions = [first];
    query.set("version", "1");
  }
  const economics = fixture
    ? Object.fromEntries(
        fixture.report.versions.map((version) => [
          version.version,
          buildCreatorEconomics(
            fixture.campaign,
            fixture.rankingEvidencePaths.filter(
              (path) => path.reportVersionId === version.id,
            ),
            version,
          ),
        ]),
      )
    : {};
  return (
    <ClarityReporting
      initialQuery={parseClarityQuery(query)}
      state={state}
      fixture={fixture}
      economics={economics}
    />
  );
}
