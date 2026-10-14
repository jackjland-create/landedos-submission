import "server-only";
export { submissionEnabled } from "./submission-access.server";
import {
  authorizeSubmission,
  submissionEnabled,
} from "./submission-access.server";
import { notFound, redirect } from "next/navigation";
import {
  buildSubmissionCampaign,
  submissionPeriod,
} from "./submission-campaign";
import { OverviewCockpit } from "@/components/overview-cockpit";
import { AppShell } from "@/components/app-shell";
import { BasketBuilder } from "@/components/basket-builder";
import { CreatorDirectory } from "@/components/creator-directory";
import {
  CampaignControlWorkspace,
  campaignView,
} from "@/components/campaign-control-workspace";

/** Existing application routes + components, one explicitly synthetic, read-only snapshot.
 * This is not an issued database report and does not stand in for a live pipeline test. */
export async function submissionPage(
  section: string,
  query: Record<string, string | string[] | undefined> = {},
  id?: string,
) {
  if (!submissionEnabled()) return null;
  if (
    !["overview", "reports", "baskets", "campaigns", "kols"].includes(section)
  )
    notFound();
  const accountName = await authorizeSubmission();
  const data = buildSubmissionCampaign();
  const theme = query.theme === "dark" ? "dark" : "light";
  if (section === "overview" || section === "reports") {
    if (id && id !== data.report.id) notFound();
    return (
      <OverviewCockpit
        state="ready"
        fixture={data}
        economics={data.economics}
        evidenceProvenance="synthetic"
        canManage={false}
        accountName={accountName}
        projectSlug="demo"
        initialTheme={theme}
        initialView={typeof query.view === "string" ? query.view : undefined}
        submissionSnapshot
      />
    );
  }
  if (section === "baskets" && !id)
    redirect(`/projects/demo/baskets/${data.basket.id}`);
  if (section === "campaigns" && !id)
    redirect(`/projects/demo/campaigns/${data.campaign.id}`);
  if (
    (section === "baskets" && id !== data.basket.id) ||
    (section === "campaigns" && id !== data.campaign.id)
  )
    notFound();
  return (
    <AppShell
      activeSection={
        section === "kols"
          ? "kols"
          : section === "baskets"
            ? "baskets"
            : "campaigns"
      }
      projectId="demo"
      contentAppearance="application"
      dataLabel="Synthetic data"
      showGuidedDemo={false}
      accountName={accountName}
      theme={theme}
    >
      <div
        className="application-panel"
        style={{ padding: 12, margin: 16 }}
        role="note"
      >
        <strong>Synthetic prototype · Read-only</strong>
        <span>
          {" "}
          · 28 Sep–11 Oct · Illustrative campaign, approvals and results.
        </span>
      </div>
      {section === "kols" ? (
        <CreatorDirectory
          projectSlug="demo"
          creators={data.creators}
          newPlansAvailable={false}
        />
      ) : section === "baskets" ? (
        <BasketBuilder
          basket={data.basket}
          canManage={false}
          theme={theme}
          submissionSnapshot
        />
      ) : (
        <CampaignControlWorkspace
          submissionSnapshot
          campaign={data.campaign}
          context={{
            trackingRestricted: true,
            planAvailable: true,
            flight: submissionPeriod,
            measurement: submissionPeriod,
            report: { id: data.report.id, version: 1 },
            reportUnavailable: false,
            measurementRule: {
              state: "retained",
              name: "First qualifying action after optional wallet proof and consent",
              version: 1,
            },
          }}
          canManage={false}
          view={campaignView(query.view)}
          theme={theme}
          projectSlug="demo"
          trackingSnapshotAt={submissionPeriod.endedAt}
        />
      )}
    </AppShell>
  );
}
