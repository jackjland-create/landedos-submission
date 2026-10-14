import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OverviewJourney } from "@/components/overview-journey";
import {
  isOverviewPersona,
  overviewReference,
} from "@/lib/reports/overview-reference";
import {
  isReportVisualState,
  reportVisualFixturesEnabled,
} from "@/lib/reports/visual-fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Landed Overview journey reference",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ persona: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { persona } = await params;
  if (
    !isOverviewPersona(persona) ||
    !reportVisualFixturesEnabled({
      explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    })
  )
    notFound();
  const query = await searchParams;
  const state =
    typeof query.state === "string" && isReportVisualState(query.state)
      ? query.state
      : "ready";
  return (
    <OverviewJourney
      key={`${persona}-${state}`}
      persona={persona}
      state={state}
      initialTheme={query.theme === "dark" ? "dark" : "light"}
      reference={overviewReference(persona, state)}
    />
  );
}
