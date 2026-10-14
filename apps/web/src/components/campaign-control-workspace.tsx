import type { ReactNode } from "react";
import type { CampaignRecord } from "@landed/contracts";
import Link from "next/link";
import type { CampaignWorkspaceContext } from "@/lib/campaign-workspace-context.server";
import { CampaignWorkspace } from "./campaign-workspace";
import { CampaignEditGuard } from "./campaign-edit-guard";
import { PlanRevisionAction } from "./plan-revision-action";
import {
  CampaignNextStep,
  CampaignWorkspaceFrame,
  FrameDot,
  FrameSegments,
} from "./campaign-workspace-frame";
import clarity from "./clarity-reporting.module.css";
import styles from "./campaign-control-workspace.module.css";
import { briefHasRequiredDetails } from "@/lib/campaign-brief-presentation";
import { campaignWorkspaceProgress } from "@/lib/campaign-workspace-progress";

export const campaignViews = [
  "control",
  "roster",
  "content",
  "delivery",
  "tracking",
  "results",
] as const;
export type CampaignView = (typeof campaignViews)[number];
export function campaignView(value: unknown): CampaignView {
  return campaignViews.includes(value as CampaignView)
    ? (value as CampaignView)
    : "control";
}
const labels: Record<CampaignView, string> = {
  control: "Status",
  roster: "Creators & terms",
  content: "Brief",
  delivery: "Delivery",
  tracking: "Tracking",
  results: "Results",
};
type Dot = "confirmed" | "pending" | "unavailable";
type Tone = "attention" | "progress" | "blocked" | "neutral";
/** Plain words for the stored campaign status; no new lifecycle is derived. */
const campaignStatusLabel: Record<
  CampaignRecord["status"],
  { label: string; state: Dot; tone: Tone }
> = {
  draft: { label: "Campaign draft", state: "pending", tone: "neutral" },
  approved: { label: "Plan approved", state: "confirmed", tone: "neutral" },
  live: { label: "Live", state: "confirmed", tone: "progress" },
  finalizing: { label: "Finalizing", state: "pending", tone: "neutral" },
  finalized: { label: "Finalized", state: "confirmed", tone: "neutral" },
};
const briefStatusLabel: Record<
  CampaignRecord["briefVersions"][number]["status"],
  { label: string; state: Dot; tone: Tone }
> = {
  draft: { label: "draft", state: "pending", tone: "neutral" },
  submitted: {
    label: "submitted for review",
    state: "pending",
    tone: "attention",
  },
  revision_requested: {
    label: "revision requested",
    state: "pending",
    tone: "attention",
  },
  approved: { label: "approved", state: "confirmed", tone: "progress" },
};
const assetStatusLabel: Record<
  CampaignRecord["contentAssets"][number]["status"],
  string
> = {
  planned: "Planned",
  draft: "Draft",
  submitted: "Submitted",
  revision_requested: "Revision requested",
  approved: "Approved",
  published: "Published",
};
const utcDayMonth = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(date));
const utcDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
function Schedule({
  value,
}: {
  value: { startedAt: string; endedAt: string } | null;
}) {
  if (!value) return <>Not available in the retained plan</>;
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(date));
  return (
    <>
      <span>
        {format(value.startedAt)} → {format(value.endedAt)}
      </span>
      <details>
        <summary>Exact retained timestamps</summary>
        <code>
          {value.startedAt} → {value.endedAt}
        </code>
      </details>
    </>
  );
}

export function fixedCampaignCommitments(campaign: CampaignRecord) {
  const totals = new Map<string, bigint>();
  let additional = false;
  for (const entry of campaign.roster)
    for (const line of entry.commercialTerms.compensationLines) {
      if (line.model === "fixed" && line.assetType === "cash")
        totals.set(
          line.currencyCode,
          (totals.get(line.currencyCode) ?? 0n) + BigInt(line.amountMinor),
        );
      else additional = true;
    }
  return {
    totals: [...totals].map(
      ([currency, amount]) =>
        `${currency} ${new Intl.NumberFormat("en-GB").format(amount / 100n)}.${(amount % 100n).toString().padStart(2, "0")}`,
    ),
    additional,
  };
}

export function CampaignControlWorkspace({
  campaign,
  canManage,
  context,
  view = "control",
  theme = "light",
  projectSlug,
  executionReview,
  activationReview,
  executionReviewId,
  signedLinkUrls = {},
  signingReady = false,
  trackingSnapshotAt,
  measurementSetupEnabled = false,
  submissionSnapshot = false,
}: {
  campaign: CampaignRecord;
  canManage: boolean;
  context: CampaignWorkspaceContext;
  view?: CampaignView;
  theme?: "light" | "dark";
  projectSlug: string;
  executionReview?: ReactNode;
  activationReview?: ReactNode;
  executionReviewId?: string;
  signedLinkUrls?: Record<string, string>;
  signingReady?: boolean;
  trackingSnapshotAt: string;
  measurementSetupEnabled?: boolean;
  submissionSnapshot?: boolean;
}) {
  const base = `/projects/${projectSlug}/campaigns/${campaign.id}`;
  function destination(next: CampaignView, nextTheme = theme) {
    const query = new URLSearchParams({ view: next, theme: nextTheme });
    if (executionReviewId) query.set("executionReview", executionReviewId);
    return `${base}?${query}`;
  }
  const commitments = fixedCampaignCommitments(campaign);
  const brief = campaign.briefVersions[0];
  // Navigation only: readiness never grants link issuance or activation.
  const briefTrackingHandoff =
    context.planAvailable &&
    !context.report &&
    campaign.status === "approved" &&
    brief.status === "approved";
  const trackingConnectionUnavailable =
    briefTrackingHandoff && context.trackingRestricted && !activationReview;
  const linksReady = campaignWorkspaceProgress(
    campaign,
    context,
    trackingSnapshotAt,
  ).some((step) => step.id === "links" && step.state === "complete");
  const completed = campaign.contentAssets.filter((a) =>
    ["approved", "published"].includes(a.status),
  ).length;
  const next: {
    title: string;
    detail: string;
    view: CampaignView;
    label: string;
  } = !context.planAvailable
    ? {
        title: "Approved plan details are unavailable",
        detail:
          "Reload this workspace before making operational decisions. No commercial or campaign state was changed.",
        view: "control",
        label: "Reload workspace",
      }
    : context.report
      ? {
          title: submissionSnapshot
            ? "Review campaign results"
            : "Review the issued result",
          detail: submissionSnapshot
            ? "Compare synthetic creator costs and qualified wallets, then decide where to put the next budget."
            : "A fixed report is available for this campaign. Review its version and evidence before planning the next campaign.",
          view: "results",
          label: "Open results",
        }
      : campaign.status === "finalized" || campaign.status === "finalizing"
        ? {
            title: "Review campaign evidence",
            detail:
              "Campaign state alone does not confirm that a report has been issued. Check the exact campaign results and retained history.",
            view: "results",
            label: "Open results",
          }
        : brief.status !== "approved"
          ? {
              title:
                brief.status === "submitted"
                  ? "Review the campaign brief"
                  : brief.status === "draft" && briefHasRequiredDetails(brief)
                    ? "Submit the brief for review"
                    : "Add the creator’s instructions",
              detail:
                brief.status === "submitted"
                  ? "Check the audience, key message and creator instructions. Approving the brief does not put the campaign live."
                  : brief.status === "draft" && briefHasRequiredDetails(brief)
                    ? "Your instructions are saved. Open the brief to submit it for review. Your approved plan stays unchanged."
                    : "Complete the audience, key message and creator instructions before moving on to tracking. Your approved plan stays unchanged.",
              view: "content",
              label: !canManage
                ? "View brief"
                : brief.status === "submitted"
                  ? "Review brief"
                  : brief.status === "draft" && briefHasRequiredDetails(brief)
                    ? "Review saved brief"
                    : "Complete brief",
            }
          : briefTrackingHandoff
            ? {
                title: linksReady
                  ? "Brief approved — next, review tracking"
                  : "Brief approved — next, set up tracking",
                detail: linksReady
                  ? "Check your creator links and the remaining setup steps. Opening Tracking won’t launch the campaign."
                  : "Choose where visitors should land and set up the creator’s tracking link. Opening Tracking won’t launch the campaign.",
                view: "tracking",
                label: !canManage
                  ? "View tracking"
                  : linksReady
                    ? "Review tracking"
                    : "Set up tracking",
              }
            : context.trackingRestricted
              ? activationReview
                ? {
                    title: "Complete the activation handoff",
                    detail:
                      "Review the exact rule, approved brief, participant links and timing before making the separate live activation decision.",
                    view: "tracking",
                    label: "Open activation handoff",
                  }
                : {
                    title: "Review delivery and the available evidence",
                    detail:
                      "Live tracking and activation remain gated for this retained plan. Reviewing simulated evidence does not launch a campaign or approve a report.",
                    view: "results",
                    label: "Open evidence review",
                  }
              : {
                  title:
                    completed < campaign.contentAssets.length
                      ? "Review delivery progress"
                      : "Review campaign evidence",
                  detail:
                    "Check content and tracking readiness before any separate activation or report decision.",
                  view:
                    completed < campaign.contentAssets.length
                      ? "delivery"
                      : "results",
                  label:
                    completed < campaign.contentAssets.length
                      ? "Open delivery"
                      : "Open results",
                };
  const detailProps = {
    projectSlug,
    submissionSnapshot,
    theme,
    campaign,
    canManage,
    signedLinkUrls,
    signingReady,
    trackingSnapshotAt,
    trackingRestricted: context.trackingRestricted,
  };
  // Presentation of the decision above; it does not change its precedence.
  const nextTone: Tone = !context.planAvailable
    ? "blocked"
    : context.report
      ? "progress"
      : "attention";
  const nextIsManagerDecision =
    context.planAvailable &&
    !context.report &&
    campaign.status !== "finalized" &&
    campaign.status !== "finalizing" &&
    (briefTrackingHandoff ||
      brief.status !== "approved" ||
      (context.trackingRestricted && Boolean(activationReview)));
  const status = campaignStatusLabel[campaign.status];
  const briefStatus = briefStatusLabel[brief.status];
  const briefFields: [string, string | null][] = [
    ["Objective", brief.objective],
    ["Audience", brief.audience],
    ["Key message", brief.keyMessage],
    ["Creator direction", brief.creatorDirection],
    ["Compliance notes", brief.complianceNotes],
  ];
  const assetCounts = campaign.contentAssets.reduce<Record<string, number>>(
    (counts, asset) => ({
      ...counts,
      [asset.status]: (counts[asset.status] ?? 0) + 1,
    }),
    {},
  );
  const assetSummary = (
    Object.keys(assetStatusLabel) as (keyof typeof assetStatusLabel)[]
  )
    .filter((key) => assetCounts[key])
    .map((key) => `${assetCounts[key]} ${assetStatusLabel[key].toLowerCase()}`)
    .join(" · ");
  const flightSameYear =
    !!context.flight &&
    context.flight.startedAt.slice(0, 4) === context.flight.endedAt.slice(0, 4);
  const flightRange = context.flight
    ? flightSameYear
      ? `${utcDayMonth(context.flight.startedAt)} → ${utcDayMonth(context.flight.endedAt)}`
      : `${utcDate(context.flight.startedAt)} → ${utcDate(context.flight.endedAt)}`
    : null;
  const flightYear =
    context.flight && flightSameYear
      ? `${new Date(context.flight.startedAt).getUTCFullYear()} · `
      : "";
  const tiles = [
    {
      label: "Fixed cash commitment",
      value: commitments.totals.join(" · ") || "No fixed cash commitment",
      detail: commitments.additional
        ? "Plus variable or non-cash terms. Not an all-in total."
        : "Approved terms · not payment or measured spend",
    },
    {
      label: "Selected roster",
      value: `${campaign.roster.length} ${campaign.roster.length === 1 ? "creator" : "creators"}`,
      detail: submissionSnapshot
        ? "Synthetic creator fees · not payments"
        : `Commercial plan v${campaign.commercialPlanVersion} · retained`,
    },
    {
      label: "Deliverables",
      value: campaign.contentAssets.length ? (
        <>
          {completed} / {campaign.contentAssets.length}{" "}
          <small>approved or published</small>
        </>
      ) : (
        "None recorded"
      ),
      visual: campaign.contentAssets.length ? (
        <FrameSegments items={campaign.contentAssets} />
      ) : undefined,
      detail: campaign.contentAssets.length
        ? assetSummary
        : "No deliverables are recorded in this workspace",
    },
    {
      label: "Flight (UTC)",
      value: flightRange ?? "Not available",
      detail: context.measurement
        ? `${flightYear}Measurement to ${utcDate(context.measurement.endedAt)}`
        : context.flight
          ? `${flightYear}No measurement window in the retained plan`
          : "Not in the retained plan",
    },
  ];
  const detailScroll =
    view === "content" || view === "delivery" || view === "tracking"
      ? "page"
      : "panel";
  return (
    <CampaignEditGuard>
      <section
        className={`${clarity.app} ${styles.workspace}`}
        data-theme={theme}
        data-detail-scroll={detailScroll}
        aria-label="Campaign workspace"
      >
        <CampaignWorkspaceFrame
          detailScroll={detailScroll}
          theme={theme}
          canManage={canManage}
          breadcrumb={{
            href: `/projects/${projectSlug}/campaigns`,
            label: "Campaigns",
          }}
          meta={
            submissionSnapshot
              ? "Synthetic campaign · 28 Sep–11 Oct"
              : `Plan v${campaign.commercialPlanVersion} · updated ${new Date(
                  campaign.updatedAt,
                ).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
          }
          title={campaign.name}
          objective={campaign.objective}
          status={status}
          brief={{
            ...briefStatus,
            label: submissionSnapshot
              ? "Synthetic approved brief"
              : `Brief v${brief.version} · ${briefStatus.label}`,
          }}
          approvalRecordHref={`/projects/${projectSlug}/baskets/${campaign.basketId}?view=approval`}
          themeHref={destination(view, theme === "light" ? "dark" : "light")}
          themeLabel={theme === "light" ? "Dark mode" : "Light mode"}
          tiles={tiles}
          progress={context.progress}
          navigation={campaignViews.map((item) => ({
            key: item,
            label: labels[item],
            href: destination(item),
            current: view === item,
          }))}
          nextAction={
            trackingConnectionUnavailable &&
            (view === "control" ||
              view === "content" ||
              view === "tracking") ? (
              <section
                className={styles.panel}
                aria-label="Tracking setup blocked"
              >
                <h2>Tracking setup isn’t connected yet</h2>
                <p>
                  Your approved plan and brief are saved. The tracking
                  connection needs to be prepared before you can create a link.
                </p>
                <p>There’s nothing else you need to submit on this page yet.</p>
              </section>
            ) : view === "control" ||
              (view === "content" && briefTrackingHandoff) ? (
              <CampaignNextStep
                canManage={canManage}
                ownerAction={nextIsManagerDecision}
                tone={nextTone}
                title={next.title}
                detail={next.detail}
                href={destination(next.view)}
                label={next.label}
                primary={
                  (next.view === "content" || briefTrackingHandoff) && canManage
                }
              />
            ) : undefined
          }
        >
          {view === "control" && (
            <>
              <div className={styles.controlGrid}>
                <div className={styles.column}>
                  <section className={styles.panel}>
                    <h2>Selected commitments</h2>
                    <div className={styles.roster}>
                      {campaign.roster.map((entry) => (
                        <article key={entry.id}>
                          <span className={styles.avatar} aria-hidden="true">
                            {initials(
                              entry.commercialTerms.commercialDetail
                                ?.creatorDisplayName ?? entry.creatorName,
                            )}
                          </span>
                          <div>
                            <strong>
                              {entry.commercialTerms.commercialDetail
                                ?.creatorDisplayName ?? entry.creatorName}
                            </strong>
                            <p>{entry.deliverableSummary}</p>
                          </div>
                          <Link href={destination("roster")}>
                            View retained terms
                            <span className="sr-only">
                              {" "}
                              for {entry.creatorName}
                            </span>
                          </Link>
                        </article>
                      ))}
                    </div>
                    <details>
                      <summary>Retained plan reference</summary>
                      <p>
                        Commercial version {campaign.commercialPlanVersion} is
                        retained. It does not record creator acceptance, payment
                        or content approval.
                      </p>
                      <code>{campaign.commercialPlanVersionId}</code>
                    </details>
                  </section>
                  <section className={styles.panel}>
                    <h2>Schedule</h2>
                    <dl className={styles.facts}>
                      <dt>Flight (UTC)</dt>
                      <dd>
                        <Schedule value={context.flight} />
                      </dd>
                      <dt>Measurement (UTC)</dt>
                      <dd>
                        <Schedule value={context.measurement} />
                      </dd>
                    </dl>
                  </section>
                </div>
                <div className={styles.column}>
                  <section className={styles.panel}>
                    <div className={styles.panelHead}>
                      <h2>
                        {submissionSnapshot
                          ? "Campaign brief"
                          : `Brief v${brief.version}`}
                      </h2>
                      <FrameDot
                        state={briefStatus.state}
                        tone={briefStatus.tone}
                      >
                        {briefStatus.label[0].toUpperCase() +
                          briefStatus.label.slice(1)}
                      </FrameDot>
                    </div>
                    <dl className={styles.checklist}>
                      {briefFields.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>
                            {value?.trim() ? (
                              <FrameDot state="confirmed" tone="progress">
                                Set
                              </FrameDot>
                            ) : (
                              <FrameDot state="pending" tone="attention">
                                Empty
                              </FrameDot>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section className={`${styles.panel} ${styles.unrecorded}`}>
                    <h2>Not recorded in Landed</h2>
                    <dl className={styles.checklist}>
                      <div>
                        <dt>Creator acceptance</dt>
                        <dd>
                          <FrameDot state="unavailable">
                            No acceptance evidence in this workspace
                          </FrameDot>
                        </dd>
                      </div>
                      <div>
                        <dt>Payments</dt>
                        <dd>
                          <FrameDot state="unavailable">
                            Payment status not tracked here
                          </FrameDot>
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </div>
            </>
          )}
          {view === "roster" && (
            <CampaignWorkspace {...detailProps} section="roster" />
          )}
          {view === "content" && (
            <CampaignWorkspace {...detailProps} section="brief" />
          )}
          {view === "delivery" && (
            <CampaignWorkspace {...detailProps} section="content" />
          )}
          {view === "tracking" && (
            <>
              <section
                className={styles.panel}
                aria-label="Campaign measurement setup"
              >
                <h2>
                  {context.measurementRule?.state === "unbound"
                    ? "Next: choose what counts as a result"
                    : "What counts as a result"}
                </h2>
                {context.measurementRule?.state === "retained" ? (
                  <>
                    <p>
                      <strong>{context.measurementRule.name}</strong> · approved
                      version {context.measurementRule.version}
                    </p>
                    <p>
                      This rule is retained in this campaign’s approved plan. It
                      does not confirm that measurement is connected or tested.
                    </p>
                  </>
                ) : context.measurementRule?.state === "unbound" ? (
                  <>
                    {canManage && measurementSetupEnabled ? (
                      <PlanRevisionAction
                        projectId={projectSlug}
                        basketId={campaign.basketId}
                        sourcePlanId={campaign.commercialPlanVersionId}
                        measurementCampaignId={campaign.id}
                        theme={theme}
                      />
                    ) : (
                      <p>
                        {canManage
                          ? "Measurement draft setup is not enabled in this environment."
                          : "Ask a campaign manager to prepare a measurement plan."}
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    The approved rule could not be verified. Reload this page to
                    retry; no rule has been inferred from project settings.
                  </p>
                )}
              </section>
              {activationReview}
              <CampaignWorkspace
                {...detailProps}
                section="tracking"
                setupFirst={context.measurementRule?.state === "unbound"}
              />
            </>
          )}
          {view === "results" && (
            <>
              <section className={styles.panel}>
                <h2>
                  {submissionSnapshot ? "Campaign results" : "Issued report"}
                </h2>
                {context.report ? (
                  <>
                    <p>
                      {submissionSnapshot
                        ? "Illustrative results for this synthetic campaign. No live measurement or issued database report is claimed."
                        : "An issued report is a fixed historical result, not live campaign status."}
                    </p>
                    <Link
                      className="application-button application-button--progress"
                      href={`/projects/${projectSlug}/reports/${context.report.id}?version=${context.report.version}`}
                    >
                      {submissionSnapshot
                        ? "View campaign results"
                        : `Open report v${context.report.version}`}
                    </Link>
                  </>
                ) : (
                  <p>
                    {context.reportUnavailable
                      ? "Report availability could not be checked. Reload this workspace to retry."
                      : "No issued report is available for this campaign. Evidence, cost review and report approval are separate steps."}
                  </p>
                )}
              </section>
              {submissionSnapshot
                ? null
                : (executionReview ?? (
                    <section className={styles.panel}>
                      <h2>Evidence review</h2>
                      <p>
                        No connected evidence-review action is available in this
                        environment. Commercial approval alone does not make
                        results available.
                      </p>
                    </section>
                  ))}
              <details className={styles.panel}>
                <summary>Campaign state history</summary>
                <CampaignWorkspace {...detailProps} section="history" />
              </details>
            </>
          )}
        </CampaignWorkspaceFrame>
      </section>
    </CampaignEditGuard>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
