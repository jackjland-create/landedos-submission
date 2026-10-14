import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  CampaignCockpitProposal,
  cockpitViews,
  cockpitStates,
  type CockpitView,
  type CockpitState,
} from "@/components/campaign-cockpit-proposal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Campaign cockpit proposal · not live data",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { view } = await params;
  const { state = "partial" } = await searchParams;
  if (
    process.env.NODE_ENV !== "development" ||
    !cockpitViews.includes(view as CockpitView) ||
    !cockpitStates.includes(state as CockpitState)
  )
    notFound();
  return (
    <AppShell
      activeSection={
        view === "home"
          ? "overview"
          : view === "review"
            ? "reports"
            : "campaigns"
      }
      projectId="helios"
      showGuidedDemo={false}
      proposalOnly
    >
      <CampaignCockpitProposal
        view={view as CockpitView}
        state={state as CockpitState}
      />
    </AppShell>
  );
}
