import {
  baseUnitsToDecimal,
  type CampaignRecord,
  type CampaignStatus,
  type CommercialPlanSnapshotPackage,
  type ContentAssetRecord,
} from "@landed/contracts";
import { ActionButton, Eyebrow, Status } from "@landed/ui";
import Link from "next/link";

import { CampaignBriefWorkflow } from "@/components/campaign-brief-workflow";
import { CampaignAssetInputLink } from "@/components/campaign-asset-input-link";
import { DeliverableWorkflow } from "@/components/deliverable-workflow";
import { TrackedLinkWorkflow } from "@/components/tracked-link-workflow";
import { project } from "@/lib/demo-data";
import deliveryStyles from "./campaign-delivery.module.css";

type PhaseState = "active" | "complete" | "missing" | "waiting";

type WorkspacePhase = {
  detail: string;
  label: string;
  state: PhaseState;
  status: string;
  tone?: "action" | "default" | "verified";
};

type WorkspaceAction = {
  disabled?: boolean;
  href?: string;
  label: string;
  note: string;
};

type WorkspaceDecision = {
  action: WorkspaceAction;
  impact: string;
  owner: string;
  statement: string;
  title: string;
};

const readyAssetStates = new Set<ContentAssetRecord["status"]>([
  "approved",
  "published",
]);

const reviewAssetStates = new Set<ContentAssetRecord["status"]>([
  "revision_requested",
  "submitted",
]);

function formatMinorExact(units: string, currencyCode: "EUR" | "GBP" | "USD") {
  const [whole = "0", fraction] = baseUnitsToDecimal(units, 2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = { EUR: "€", GBP: "£", USD: "$" }[currencyCode];

  return `${symbol}${grouped}${fraction ? `.${fraction}` : ""}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEvidenceDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function outcomeLabel(campaign: CampaignRecord) {
  const { outcomeProfile } = campaign;
  const metric =
    outcomeProfile.metric === "qualified_wallets"
      ? "qualified wallets"
      : outcomeProfile.metric === "average_order_value"
        ? "average order value"
        : "verified revenue";

  if (outcomeProfile.currencyCode) {
    return `${formatMinorExact(outcomeProfile.baselineUnits, outcomeProfile.currencyCode)} → ${formatMinorExact(outcomeProfile.targetUnits, outcomeProfile.currencyCode)} ${metric}`;
  }

  return `${outcomeProfile.baselineUnits} → ${outcomeProfile.targetUnits} ${metric}`;
}

function outcomeTargetLabel(campaign: CampaignRecord) {
  const { currencyCode, targetUnits } = campaign.outcomeProfile;

  return currencyCode
    ? formatMinorExact(targetUnits, currencyCode)
    : targetUnits;
}

function outcomeMetricLabel(campaign: CampaignRecord) {
  if (campaign.outcomeProfile.metric === "qualified_wallets") {
    return "QUALIFIED WALLETS";
  }

  if (campaign.outcomeProfile.metric === "average_order_value") {
    return "AVERAGE ORDER VALUE";
  }

  return "VERIFIED REVENUE";
}

function compensationLabel(
  line: CommercialPlanSnapshotPackage["compensationLines"][number],
) {
  const suffix = line.model === "variable" ? ` / ${line.variableUnit}` : "";

  if (line.assetType === "cash") {
    return `${formatMinorExact(line.amountMinor, line.currencyCode)}${suffix}`;
  }

  return `${baseUnitsToDecimal(line.tokenAmountRaw, line.tokenDecimals)} ${line.assetType === "usdc" ? "USDC" : "tokens"}${suffix}`;
}

function compensationEvidence(
  line: CommercialPlanSnapshotPackage["compensationLines"][number],
) {
  if (line.assetType === "cash") return `${line.currencyCode} CASH`;

  return `${line.tokenMint} / USD ${line.unitPriceUsd} / ${line.priceSource} / ${formatDate(line.valuedAt)}`;
}

function statusTone(status: CampaignStatus) {
  if (status === "finalized") return "verified" as const;
  if (status === "approved" || status === "live") return "action" as const;
  return "default" as const;
}

function plural(
  value: number,
  singular: string,
  pluralValue = `${singular}${singular === singular.toUpperCase() ? "S" : "s"}`,
) {
  return value === 1 ? singular : pluralValue;
}

function observedAttemptCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + link.clickEvidence.totalAttempts,
    0,
  );
}

function qualifiedClickCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + link.clickQuality.qualifiedClicks,
    0,
  );
}

function assessedClickCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + link.clickQuality.totalAssessed,
    0,
  );
}

function pendingClickAssessmentCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + link.clickQuality.pendingAssessment,
    0,
  );
}

function anonymousSessionCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + (link.anonymousSessions?.sessions ?? 0),
    0,
  );
}

function sessionBoundClickCount(asset: ContentAssetRecord) {
  return asset.trackedLinks.reduce(
    (total, link) => total + (link.anonymousSessions?.boundClicks ?? 0),
    0,
  );
}

function lastAnonymousSessionSeenAt(asset: ContentAssetRecord) {
  return asset.trackedLinks
    .flatMap((link) =>
      link.anonymousSessions?.lastSeenAt
        ? [link.anonymousSessions.lastSeenAt]
        : [],
    )
    .sort((left, right) => right.localeCompare(left))[0];
}

function firstObservedRedirectAt(asset: ContentAssetRecord) {
  return asset.trackedLinks
    .flatMap((link) =>
      link.clickEvidence.firstObservedAt
        ? [link.clickEvidence.firstObservedAt]
        : [],
    )
    .sort()[0];
}

function getTrackingReadiness(
  campaign: CampaignRecord,
  snapshotAt: string,
  signedLinkUrls: Record<string, string>,
) {
  const snapshot = new Date(snapshotAt).getTime();
  const readiness = {
    destinationDisabled: 0,
    expired: 0,
    missing: 0,
    ready: 0,
    unavailable: 0,
  };

  for (const asset of campaign.contentAssets) {
    const currentLink = asset.trackedLinks.find(
      ({ revocation }) => revocation === null,
    );

    if (!currentLink) readiness.missing += 1;
    else if (new Date(currentLink.expiresAt).getTime() <= snapshot) {
      readiness.expired += 1;
    } else if (!currentLink.destinationPolicyActive) {
      readiness.destinationDisabled += 1;
    } else if (!signedLinkUrls[currentLink.id]) readiness.unavailable += 1;
    else readiness.ready += 1;
  }

  return readiness;
}

function getAssetInputState(
  asset: ContentAssetRecord,
  snapshotAt: string,
  signedLinkUrls: Record<string, string>,
) {
  const currentLink = asset.trackedLinks.find(
    ({ revocation }) => revocation === null,
  );
  const trackingReady = Boolean(
    currentLink &&
    new Date(currentLink.expiresAt).getTime() >
      new Date(snapshotAt).getTime() &&
    currentLink.destinationPolicyActive &&
    signedLinkUrls[currentLink.id],
  );
  const deliverableReady = readyAssetStates.has(asset.status);

  if (!trackingReady) {
    const input = !currentLink
      ? {
          detail:
            "Add the signed distribution URL required for qualified attribution.",
          label: "Issue the attribution link",
        }
      : new Date(currentLink.expiresAt).getTime() <=
          new Date(snapshotAt).getTime()
        ? {
            detail:
              "Revoke the expired record, then issue its signed replacement.",
            label: "Replace the expired link",
          }
        : !currentLink.destinationPolicyActive
          ? {
              detail:
                "The retained destination is inactive and cannot receive qualified traffic.",
              label: "Resolve the destination",
            }
          : {
              detail:
                "The retained signing key is unavailable, so the public URL cannot be rendered.",
              label: "Restore signing access",
            };

    return {
      controlId: `tracking-${asset.id}`,
      deliverableReady,
      input,
      kind: "tracking" as const,
      needsInput: true,
      trackingReady,
    };
  }

  if (!deliverableReady) {
    const label =
      asset.status === "planned"
        ? "Start the deliverable"
        : asset.status === "draft"
          ? "Submit the deliverable"
          : asset.status === "submitted"
            ? "Review the submission"
            : "Record the requested revision";

    return {
      controlId: `deliverable-${asset.id}`,
      deliverableReady,
      input: {
        detail:
          "Advance the retained delivery state and add the content URL when it becomes available.",
        label,
      },
      kind: "deliverable" as const,
      needsInput: true,
      trackingReady,
    };
  }

  return {
    controlId: `deliverable-${asset.id}`,
    deliverableReady,
    input: {
      detail:
        "Tracking and deliverable evidence are ready for the next campaign decision.",
      label: "No input required",
    },
    kind: "ready" as const,
    needsInput: false,
    trackingReady,
  };
}

function getWorkspaceDecision(
  campaign: CampaignRecord,
  snapshotAt: string,
  signedLinkUrls: Record<string, string>,
): WorkspaceDecision {
  const currentBrief = campaign.briefVersions[0];
  const reviewAssets = campaign.contentAssets.filter(({ status }) =>
    reviewAssetStates.has(status),
  );
  const incompleteAssets = campaign.contentAssets.filter(
    ({ status }) => !readyAssetStates.has(status),
  );

  if (campaign.status === "draft") {
    return {
      statement: "Commercial approval is the next decision.",
      title: "Return to the basket and request human approval.",
      owner: "Campaign manager",
      impact: "Blocks campaign activation",
      action: {
        label: "REQUEST APPROVAL",
        href: `/projects/${project.id}/baskets/${campaign.basketId}`,
        note: "Commercial approval remains in the basket workflow.",
      },
    };
  }

  if (campaign.status === "approved") {
    if (currentBrief.status !== "approved") {
      return {
        statement: `Campaign brief v${currentBrief.version} is ${currentBrief.status.replaceAll("_", " ")}.`,
        title:
          currentBrief.status === "submitted"
            ? "Review the submitted brief before activation."
            : currentBrief.status === "revision_requested"
              ? "Complete the requested brief revision."
              : "Complete and submit the campaign brief.",
        owner: "Campaign manager",
        impact: "Blocks campaign activation",
        action: {
          label:
            currentBrief.status === "submitted"
              ? "REVIEW BRIEF"
              : "COMPLETE BRIEF",
          href: "#campaign-brief",
          note: "Activation requires a human-approved brief version.",
        },
      };
    }

    if (campaign.contentAssets.length === 0) {
      return {
        statement: "No content assets are planned for this campaign.",
        title: "Return to the approved plan before issuing tracking.",
        owner: "Campaign manager",
        impact: "Blocks campaign activation",
        action: {
          label: "REVIEW CAMPAIGN PLAN",
          href: `/projects/${project.id}/baskets/${campaign.basketId}`,
          note: "Activation requires at least one planned content asset.",
        },
      };
    }

    const tracking = getTrackingReadiness(campaign, snapshotAt, signedLinkUrls);
    const incompleteLinks = campaign.contentAssets.length - tracking.ready;
    const decisionCopy =
      tracking.expired > 0
        ? {
            title: "Revoke expired links before issuing their replacements.",
            label: "REPLACE TRACKING",
            note: `${tracking.expired} expired ${plural(tracking.expired, "link")} ${tracking.expired === 1 ? "requires" : "require"} explicit revocation.`,
          }
        : tracking.destinationDisabled > 0
          ? {
              title:
                "Revoke links whose destination policy is inactive, then issue replacements.",
              label: "REVIEW DESTINATION",
              note: `${tracking.destinationDisabled} current ${plural(tracking.destinationDisabled, "link")} ${tracking.destinationDisabled === 1 ? "has" : "have"} a deactivated destination host.`,
            }
          : tracking.unavailable > 0
            ? {
                title: "Restore the retained signing key before activation.",
                label: "RESTORE SIGNING",
                note: `${tracking.unavailable} current ${plural(tracking.unavailable, "link")} cannot render a verifiable public URL.`,
              }
            : {
                title:
                  "Issue the missing links before this campaign can move live.",
                label: "ISSUE TRACKING",
                note: "Every planned asset needs one current signed link.",
              };

    return {
      statement:
        incompleteLinks > 0
          ? `${incompleteLinks} of ${campaign.contentAssets.length} ${plural(campaign.contentAssets.length, "content asset")} still ${incompleteLinks === 1 ? "needs" : "need"} verifiable tracking.`
          : `All ${tracking.ready} ${plural(tracking.ready, "content asset")} ${tracking.ready === 1 ? "has" : "have"} verifiable signed tracking.`,
      title:
        incompleteLinks > 0
          ? decisionCopy.title
          : "Tracking is ready for campaign activation.",
      owner: "Campaign manager",
      impact:
        incompleteLinks > 0
          ? "Blocks qualified attribution"
          : "Protects qualified attribution",
      action: {
        label: incompleteLinks > 0 ? decisionCopy.label : "TRACKING READY",
        href: "#content-assets",
        note:
          incompleteLinks > 0
            ? decisionCopy.note
            : "Campaign activation remains a separate human decision.",
      },
    };
  }

  if (campaign.status === "live") {
    const firstReview = reviewAssets[0];
    const statement = firstReview
      ? `${reviewAssets.length} ${plural(reviewAssets.length, "deliverable")} need a decision.`
      : incompleteAssets.length > 0
        ? `${incompleteAssets.length} ${plural(incompleteAssets.length, "deliverable")} still need completion.`
        : "All planned deliverables are ready for finalization.";

    return {
      statement,
      title: firstReview
        ? `Review ${firstReview.label}.`
        : incompleteAssets.length > 0
          ? "Review creator delivery progress."
          : "Confirm the campaign window can close.",
      owner: "Campaign manager",
      impact: firstReview ? "Unblocks publication" : "Protects campaign timing",
      action: {
        label: "REVIEW DELIVERABLE",
        href: "#content-assets",
        note: "The asset list preserves status and missing evidence.",
      },
    };
  }

  if (campaign.status === "finalizing") {
    return {
      statement: "Campaign delivery is closed. Data completeness needs review.",
      title: "Confirm attribution inputs before issuing the report.",
      owner: "Analyst",
      impact: "Protects report integrity",
      action: {
        label: "REVIEW DATA",
        href: "#campaign-activity",
        note: "Reporting evidence arrives in Sprint 5; transition history is available now.",
      },
    };
  }

  return {
    statement: "Campaign evidence is locked. The issued report is next.",
    title: "Open the performance report and decide the next roster.",
    owner: "Campaign manager",
    impact: "Turns evidence into the next allocation",
    action: {
      label: "OPEN REPORT",
      href: `/projects/${project.id}/reports`,
      note: "The report route will become evidence-backed in Sprint 5.",
    },
  };
}

function getWorkspacePhases(
  campaign: CampaignRecord,
  snapshotAt: string,
  signedLinkUrls: Record<string, string>,
): WorkspacePhase[] {
  const currentBrief = campaign.briefVersions[0];
  const readyAssets = campaign.contentAssets.filter(({ status }) =>
    readyAssetStates.has(status),
  ).length;
  const startedAssets = campaign.contentAssets.filter(
    ({ status }) => status !== "planned",
  ).length;
  const tracking = getTrackingReadiness(campaign, snapshotAt, signedLinkUrls);
  const trackingComplete =
    campaign.contentAssets.length > 0 &&
    tracking.ready === campaign.contentAssets.length;
  const trackingDetail =
    tracking.expired > 0
      ? `${tracking.expired} expired; revoke before replacement`
      : tracking.destinationDisabled > 0
        ? `${tracking.destinationDisabled} current; destination policy inactive`
        : tracking.unavailable > 0
          ? `${tracking.unavailable} current; signing key unavailable`
          : `${tracking.ready} / ${campaign.contentAssets.length} verifiable signed links`;
  const deliverablePhase: WorkspacePhase =
    campaign.contentAssets.length === 0
      ? {
          label: "Deliverables",
          detail: "No content assets are planned",
          state: "missing",
          status: "MISSING",
        }
      : readyAssets === campaign.contentAssets.length
        ? {
            label: "Deliverables",
            detail: `${readyAssets} / ${campaign.contentAssets.length} approved or published`,
            state: "complete",
            status: "COMPLETE",
            tone: "verified",
          }
        : startedAssets > 0
          ? {
              label: "Deliverables",
              detail: `${readyAssets} / ${campaign.contentAssets.length} approved or published`,
              state: "active",
              status: "ACTIVE",
              tone: "action",
            }
          : {
              label: "Deliverables",
              detail: `${campaign.contentAssets.length} planned; no submissions yet`,
              state: "waiting",
              status: "WAITING",
            };

  const finalizationPhase: WorkspacePhase =
    campaign.status === "finalized"
      ? {
          label: "Finalization",
          detail: `Finalized ${formatDate(campaign.updatedAt)}`,
          state: "complete",
          status: "COMPLETE",
          tone: "verified",
        }
      : campaign.status === "finalizing"
        ? {
            label: "Finalization",
            detail: "Data review is the outstanding decision",
            state: "active",
            status: "ACTIVE",
            tone: "action",
          }
        : {
            label: "Finalization",
            detail: "Begins after campaign delivery closes",
            state: "waiting",
            status: "WAITING",
          };

  return [
    {
      label: "Brief",
      detail: `Version ${currentBrief.version} / ${currentBrief.status.replaceAll("_", " ")}`,
      state: currentBrief.status === "approved" ? "complete" : "active",
      status:
        currentBrief.status === "approved"
          ? "COMPLETE"
          : currentBrief.status.replaceAll("_", " ").toUpperCase(),
      tone: currentBrief.status === "approved" ? "verified" : "action",
    },
    {
      label: "Commercial approval",
      detail: `Commercial plan v${campaign.commercialPlanVersion} retained`,
      state: campaign.status === "draft" ? "active" : "complete",
      status: campaign.status === "draft" ? "REQUIRED" : "COMPLETE",
      tone: campaign.status === "draft" ? "action" : "verified",
    },
    {
      label: "Creator acceptance",
      detail: "Offer acceptance evidence is not yet recorded",
      state: "missing",
      status: "NO EVIDENCE",
    },
    deliverablePhase,
    {
      label: "Tracking",
      detail: trackingDetail,
      state: trackingComplete
        ? "complete"
        : campaign.status === "approved"
          ? "active"
          : "missing",
      status: trackingComplete
        ? "COMPLETE"
        : tracking.expired > 0
          ? "REPLACE"
          : tracking.destinationDisabled > 0
            ? "HOST INACTIVE"
            : tracking.unavailable > 0
              ? "KEY REQUIRED"
              : campaign.status === "approved"
                ? "REQUIRED"
                : "NO EVIDENCE",
      tone: trackingComplete
        ? "verified"
        : campaign.status === "approved"
          ? "action"
          : "default",
    },
    finalizationPhase,
  ];
}

function PrimaryAction({ action }: { action: WorkspaceAction }) {
  if (action.href?.startsWith("#")) {
    return (
      <a className="action-link campaign-primary-action" href={action.href}>
        {action.label}
      </a>
    );
  }

  if (action.href) {
    return (
      <Link className="action-link campaign-primary-action" href={action.href}>
        {action.label}
      </Link>
    );
  }

  return (
    <ActionButton
      className="campaign-primary-action"
      disabled={action.disabled}
      type="button"
    >
      {action.label}
    </ActionButton>
  );
}

function assetCreator(campaign: CampaignRecord, asset: ContentAssetRecord) {
  return (
    campaign.roster.find(({ id }) => id === asset.campaignCreatorId)
      ?.creatorName ?? "Creator unavailable"
  );
}

export function CampaignWorkspace({
  campaign,
  canManage,
  signedLinkUrls = {},
  signingReady = false,
  trackingSnapshotAt = new Date().toISOString(),
  section = "all",
  trackingRestricted = false,
  theme = "dark",
  setupFirst = false,
  projectSlug = project.id,
  submissionSnapshot = false,
}: {
  campaign: CampaignRecord;
  canManage: boolean;
  signedLinkUrls?: Record<string, string>;
  signingReady?: boolean;
  trackingSnapshotAt?: string;
  section?: "all" | "brief" | "roster" | "content" | "tracking" | "history";
  trackingRestricted?: boolean;
  theme?: "light" | "dark";
  setupFirst?: boolean;
  projectSlug?: string;
  submissionSnapshot?: boolean;
}) {
  const decision = getWorkspaceDecision(
    campaign,
    trackingSnapshotAt,
    signedLinkUrls,
  );
  const phases = getWorkspacePhases(
    campaign,
    trackingSnapshotAt,
    signedLinkUrls,
  );
  const assetInputStates = campaign.contentAssets.map((asset) => ({
    asset,
    state: getAssetInputState(asset, trackingSnapshotAt, signedLinkUrls),
  }));
  const trackingReadyCount = assetInputStates.filter(
    ({ state }) => state.trackingReady,
  ).length;
  const deliverableReadyCount = assetInputStates.filter(
    ({ state }) => state.deliverableReady,
  ).length;
  const actionNeededCount = assetInputStates.filter(
    ({ state }) => state.needsInput,
  ).length;
  const firstActionAsset =
    assetInputStates.find(({ state }) => state.kind === "tracking") ??
    assetInputStates.find(({ state }) => state.needsInput);
  function inputLink(
    state: ReturnType<typeof getAssetInputState>,
    label: string,
  ) {
    const targetView = state.kind === "tracking" ? "tracking" : "content";
    if (section === "all" || section === targetView) {
      return <a href={`#${state.controlId}`}>{label}</a>;
    }
    return (
      <CampaignAssetInputLink
        campaignPath={`/projects/${projectSlug}/campaigns/${campaign.id}`}
        view={targetView === "content" ? "delivery" : targetView}
        controlId={state.controlId}
      >
        {label}
      </CampaignAssetInputLink>
    );
  }

  return (
    <>
      {section === "all" && (
        <>
          <header className="page-header campaign-workspace__header">
            <div>
              <Eyebrow>04 / {project.name}</Eyebrow>
              <h1>CAMPAIGN WORKSPACE</h1>
              <p>
                One operational decision at a time, with the approved commercial
                plan and every state change retained as evidence.
              </p>
            </div>
            <div className="campaign-workspace__header-meta">
              <Status tone={statusTone(campaign.status)}>
                {campaign.status.toUpperCase()}
              </Status>
              <span>UPDATED {formatDate(campaign.updatedAt)}</span>
            </div>
          </header>

          <section
            aria-label="Campaign decision"
            className="campaign-workspace__deck"
          >
            <article className="panel campaign-decision-tile">
              <div>
                <Eyebrow>CAMPAIGN DECISION / {campaign.status}</Eyebrow>
                <h2>{decision.statement}</h2>
                <p>{campaign.objective}</p>
              </div>
              <dl>
                <div>
                  <dt>CAMPAIGN</dt>
                  <dd>{campaign.name}</dd>
                </div>
                <div>
                  <dt>OUTCOME TARGET</dt>
                  <dd>{outcomeTargetLabel(campaign)}</dd>
                </div>
                <div>
                  <dt>ROSTER</dt>
                  <dd>{campaign.roster.length} creators</dd>
                </div>
                <div className="campaign-decision-tile__warning">
                  <dt>SCHEDULE</dt>
                  <dd>NOT DEFINED</dd>
                </div>
              </dl>
            </article>

            <aside className="panel campaign-next-decision">
              <Eyebrow>OUTSTANDING DECISION / 01</Eyebrow>
              <h2>{decision.title}</h2>
              <dl>
                <div>
                  <dt>OWNER</dt>
                  <dd>{decision.owner}</dd>
                </div>
                <div>
                  <dt>IMPACT</dt>
                  <dd>{decision.impact}</dd>
                </div>
                <div>
                  <dt>DEADLINE</dt>
                  <dd>NOT SET</dd>
                </div>
              </dl>
              <div className="campaign-next-decision__action">
                <PrimaryAction action={decision.action} />
                <small>{decision.action.note}</small>
              </div>
            </aside>
          </section>

          <div className="content-grid content-grid--campaign-operations">
            <section className="panel campaign-path">
              <header className="panel__header">
                <div>
                  <Eyebrow>OPERATIONAL TIMELINE</Eyebrow>
                  <h2>What has happened—and what is missing</h2>
                </div>
                <Status>{phases.length} PHASES</Status>
              </header>
              <ol className="phase-list">
                {phases.map((phase, index) => (
                  <li
                    className={`phase phase--${phase.state}`}
                    key={phase.label}
                  >
                    <span className="phase__index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{phase.label}</strong>
                      <span>{phase.detail}</span>
                    </div>
                    <Status tone={phase.tone}>{phase.status}</Status>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel campaign-outcome-card">
              <header className="panel__header">
                <div>
                  <Eyebrow>OUTCOME / DEFINED</Eyebrow>
                  <h2>{outcomeLabel(campaign)}</h2>
                </div>
              </header>
              <div className="campaign-outcome-card__value">
                <span>{outcomeMetricLabel(campaign)}</span>
                <strong>{outcomeTargetLabel(campaign)}</strong>
              </div>
              <div className="campaign-outcome-card__evidence">
                <Status tone="verified">COMMERCIAL PLAN BOUND</Status>
                <p>
                  Frozen from Basket approval version{" "}
                  {campaign.commercialPlanVersion}
                </p>
                <code>{campaign.commercialPlanVersionId}</code>
                <Link
                  className="campaign-outcome-card__source-link"
                  href={`/projects/${projectSlug}/baskets/${campaign.basketId}`}
                >
                  OPEN SOURCE BASKET
                </Link>
                <small>Created {formatDate(campaign.createdAt)}</small>
              </div>
            </section>
          </div>
        </>
      )}

      {(section === "all" || section === "brief") && (
        <CampaignBriefWorkflow
          canManage={canManage}
          campaignId={campaign.id}
          projectId={projectSlug}
          versions={campaign.briefVersions}
          theme={theme}
        />
      )}

      {(section === "all" || section === "roster") && (
        <section className="panel campaign-roster-panel" id="campaign-roster">
          <header className="panel__header">
            <div>
              <Eyebrow>ROSTER / COMMERCIAL TERMS</Eyebrow>
              <h2>Creator commitments</h2>
            </div>
            <Status>{campaign.roster.length} RECORDS</Status>
          </header>
          <div className="campaign-roster-list">
            {campaign.roster.map((entry) => {
              const assets = campaign.contentAssets.filter(
                ({ campaignCreatorId }) => campaignCreatorId === entry.id,
              );
              const readyAssets = assets.filter(({ status }) =>
                readyAssetStates.has(status),
              ).length;

              return (
                <article className="campaign-roster-row" key={entry.id}>
                  <span className="campaign-roster-row__index">
                    {String(entry.rosterPosition).padStart(2, "0")}
                  </span>
                  <div className="campaign-roster-row__creator">
                    <strong>
                      {entry.commercialTerms.commercialDetail
                        ?.creatorDisplayName ?? entry.creatorName}
                    </strong>
                    <span>
                      {entry.commercialTerms.commercialDetail
                        ? entry.commercialTerms.commercialDetail.channels
                            .map((channel) => channel.handle)
                            .join(", ") || "CHANNEL NOT SPECIFIED"
                        : (entry.creatorHandle ?? "NO PRIMARY HANDLE")}
                    </span>
                  </div>
                  <div>
                    <small>PACKAGE</small>
                    <strong>{entry.packageLabel}</strong>
                    <span>{entry.deliverableSummary}</span>
                    {entry.commercialTerms.commercialDetail && (
                      <details>
                        <summary>Approved delivery & usage</summary>
                        <p>
                          Channels:{" "}
                          {entry.commercialTerms.commercialDetail.channels
                            .map(
                              (c) =>
                                `${c.channelType.toUpperCase()} · ${c.handle}`,
                            )
                            .join(", ") || "Not specified"}
                        </p>
                        <p>
                          Deadline (UTC):{" "}
                          {entry.commercialTerms.commercialDetail
                            .deliveryDeadline ?? "Not specified"}
                        </p>
                        <p>
                          Usage:{" "}
                          {entry.commercialTerms.commercialDetail.usageRights ??
                            "Not specified"}
                        </p>
                        <p>
                          Exclusivity:{" "}
                          {entry.commercialTerms.commercialDetail.exclusivity ??
                            "Not specified"}
                        </p>
                      </details>
                    )}
                  </div>
                  <div>
                    <small>COMPENSATION</small>
                    {entry.commercialTerms.compensationLines.map((line) => (
                      <span className="campaign-roster-row__term" key={line.id}>
                        <strong>{compensationLabel(line)}</strong>
                        <code>{compensationEvidence(line)}</code>
                      </span>
                    ))}
                  </div>
                  <div className="campaign-roster-row__evidence">
                    <Status tone="verified">TERMS LOCKED</Status>
                    <span>
                      {readyAssets} / {assets.length} DELIVERABLES READY
                    </span>
                    <span>OFFER STATE / NO EVIDENCE</span>
                    <code>{entry.termsHash.slice(0, 12)}…</code>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {section === "tracking" && (
        <section
          className={deliveryStyles.panel}
          data-theme={theme}
          aria-label="Tracking links"
        >
          <header className="panel__header">
            <h2>Tracking links</h2>
            <span>
              {trackingReadyCount} / {campaign.contentAssets.length} ready
            </span>
          </header>
          <p>
            One link per deliverable. Creating a link does not activate the
            campaign.
          </p>
          <p>Readiness as of {formatEvidenceDate(trackingSnapshotAt)}</p>
          <aside
            className={deliveryStyles.readiness}
            aria-label="Project measurement setup"
          >
            <span>
              Links track visits. Outcome measurement needs separate project
              setup.
            </span>
            {!submissionSnapshot && (
              <Link href={`/projects/${projectSlug}/settings/integrations`}>
                Review website &amp; measurement
              </Link>
            )}
          </aside>
          {trackingRestricted && (
            <p role="note">
              Live tracking is not enabled for this retained plan. Commercial
              approval does not activate distribution. Existing evidence remains
              available.
            </p>
          )}
          {campaign.contentAssets.length ? (
            campaign.contentAssets.map((asset) => (
              <TrackedLinkWorkflow
                syntheticEvidence={submissionSnapshot}
                key={asset.id}
                secondaryAction={setupFirst}
                asset={asset}
                creatorName={assetCreator(campaign, asset)}
                presentation="card"
                theme={theme}
                canManage={canManage && !trackingRestricted}
                restricted={trackingRestricted}
                campaignId={campaign.id}
                campaignStatus={campaign.status}
                projectId={projectSlug}
                signedUrl={
                  asset.trackedLinks
                    .filter(({ revocation }) => revocation === null)
                    .map(({ id }) => signedLinkUrls[id] ?? null)[0] ?? null
                }
                signingReady={signingReady}
                snapshotAt={trackingSnapshotAt}
              />
            ))
          ) : (
            <p>
              No deliverables are planned. Return to the approved plan before
              setting up tracking.
            </p>
          )}
        </section>
      )}
      {(section === "all" || section === "content") && (
        <section
          className={
            section === "content"
              ? deliveryStyles.panel
              : "panel campaign-assets-panel"
          }
          data-theme={theme}
          id="content-assets"
        >
          <header className="panel__header">
            <div>
              {section !== "content" && (
                <Eyebrow>CONTENT ASSETS / TRACKING READINESS</Eyebrow>
              )}
              <h2>Deliverables and distribution evidence</h2>
            </div>
            <Status>{campaign.contentAssets.length} ASSETS</Status>
          </header>
          {campaign.contentAssets.length > 0 ? (
            <>
              {!trackingRestricted && section === "content" && (
                <aside
                  className={deliveryStyles.readiness}
                  aria-label="Content asset readiness"
                >
                  <span>
                    Delivery ready: {deliverableReadyCount} /{" "}
                    {campaign.contentAssets.length} · Tracking ready:{" "}
                    {trackingReadyCount} / {campaign.contentAssets.length}
                  </span>
                  {firstActionAsset ? (
                    inputLink(firstActionAsset.state, "RESOLVE FIRST ASSET")
                  ) : (
                    <span>Distribution ready</span>
                  )}
                </aside>
              )}
              {!trackingRestricted && section !== "content" && (
                <aside
                  aria-label="Content asset readiness"
                  className={`campaign-assets-readiness${actionNeededCount > 0 ? " campaign-assets-readiness--action" : ""}`}
                >
                  <div>
                    <Eyebrow>OPERATING CHECKPOINT</Eyebrow>
                    <h3>
                      {actionNeededCount > 0
                        ? `${actionNeededCount} ${plural(actionNeededCount, "ASSET", "ASSETS")} ${actionNeededCount === 1 ? "NEEDS" : "NEED"} INPUT`
                        : "DISTRIBUTION READY"}
                    </h3>
                    <p>
                      {actionNeededCount > 0
                        ? "Complete the highlighted input before moving to the next campaign decision."
                        : "Every asset has verifiable tracking and retained delivery evidence."}
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>TRACKING READY</dt>
                      <dd>
                        {trackingReadyCount} / {campaign.contentAssets.length}
                      </dd>
                    </div>
                    <div>
                      <dt>DELIVERABLES READY</dt>
                      <dd>
                        {deliverableReadyCount} /{" "}
                        {campaign.contentAssets.length}
                      </dd>
                    </div>
                  </dl>
                  {firstActionAsset
                    ? inputLink(firstActionAsset.state, "RESOLVE FIRST ASSET")
                    : null}
                </aside>
              )}
              {trackingRestricted && (
                <p role="note">
                  Live tracking is not enabled for this retained plan.
                  Commercial approval does not activate distribution. Existing
                  evidence remains available below.
                </p>
              )}
              <div className="campaign-assets-list">
                {assetInputStates.map(({ asset, state }, displayIndex) => (
                  <article
                    className={
                      section === "content"
                        ? deliveryStyles.asset
                        : `campaign-asset-row campaign-asset-row--${state.needsInput ? "action" : "ready"}${firstActionAsset?.asset.id === asset.id ? " campaign-asset-row--priority" : ""}`
                    }
                    id={`content-asset-${asset.id}`}
                    key={asset.id}
                  >
                    {section !== "content" && (
                      <span className="campaign-asset-row__index">
                        {String(displayIndex + 1).padStart(2, "0")}
                      </span>
                    )}
                    <div>
                      <small>ASSET</small>
                      <strong>{asset.label}</strong>
                      <span>{assetCreator(campaign, asset)}</span>
                    </div>
                    <div>
                      <small>DELIVERABLE</small>
                      <Status
                        tone={
                          readyAssetStates.has(asset.status)
                            ? "verified"
                            : asset.status === "planned"
                              ? "default"
                              : "action"
                        }
                      >
                        {asset.status.replaceAll("_", " ")}
                      </Status>
                      {asset.publishedUrl ? (
                        <a
                          href={asset.publishedUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          OPEN PUBLISHED URL
                        </a>
                      ) : (
                        <span>
                          {asset.submissionUrl
                            ? "SUBMISSION URL RETAINED"
                            : "NO CONTENT URL"}
                        </span>
                      )}
                    </div>
                    {section === "content" && (
                      <DeliverableWorkflow
                        asset={asset}
                        canManage={canManage}
                        campaignId={campaign.id}
                        campaignStatus={campaign.status}
                        projectId={projectSlug}
                        presentation="dialog"
                        theme={theme}
                      />
                    )}
                    <div
                      className={
                        section === "content"
                          ? deliveryStyles.evidence
                          : undefined
                      }
                    >
                      <small>FIRST EVIDENCE</small>
                      <strong>
                        {qualifiedClickCount(asset) > 0
                          ? `${qualifiedClickCount(asset)} QUALIFIED ${plural(qualifiedClickCount(asset), "CLICK")}`
                          : assessedClickCount(asset) > 0
                            ? "0 QUALIFIED CLICKS"
                            : observedAttemptCount(asset) > 0
                              ? `${observedAttemptCount(asset)} OBSERVED ${plural(observedAttemptCount(asset), "ATTEMPT", "ATTEMPTS")}`
                              : "NO OBSERVED REDIRECTS"}
                      </strong>
                      <span>
                        {assessedClickCount(asset) > 0
                          ? `${assessedClickCount(asset)} assessed / ${pendingClickAssessmentCount(asset)} pending / ${observedAttemptCount(asset)} raw attempts retained`
                          : firstObservedRedirectAt(asset)
                            ? `First ${formatEvidenceDate(firstObservedRedirectAt(asset)!)} / quality assessment pending`
                            : "No traffic observed; qualified clicks remain unknown"}
                      </span>
                      <span>
                        {anonymousSessionCount(asset) > 0
                          ? `${anonymousSessionCount(asset)} ANONYMOUS ${plural(anonymousSessionCount(asset), "SESSION")} / ${sessionBoundClickCount(asset)} SESSION-LINKED ${plural(sessionBoundClickCount(asset), "VISIT")} / LAST ${formatEvidenceDate(lastAnonymousSessionSeenAt(asset)!)}`
                          : "0 ANONYMOUS SESSIONS / WALLET IDENTITY NOT ATTACHED"}
                      </span>
                    </div>
                    {!trackingRestricted && section !== "content" && (
                      <div className="campaign-asset-row__next-input">
                        <div>
                          <small>
                            {state.needsInput ? "NEXT INPUT" : "READINESS"}
                          </small>
                          <strong>{state.input.label}</strong>
                          <span>{state.input.detail}</span>
                        </div>
                        {state.needsInput ? (
                          inputLink(state, "OPEN INPUT")
                        ) : (
                          <Status tone="verified">READY</Status>
                        )}
                      </div>
                    )}
                    {section === "all" && (
                      <TrackedLinkWorkflow
                        asset={asset}
                        canManage={canManage && !trackingRestricted}
                        restricted={trackingRestricted}
                        campaignId={campaign.id}
                        campaignStatus={campaign.status}
                        defaultOpen={
                          firstActionAsset?.asset.id === asset.id &&
                          state.kind === "tracking"
                        }
                        projectId={projectSlug}
                        signedUrl={
                          asset.trackedLinks
                            .filter(({ revocation }) => revocation === null)
                            .map(({ id }) => signedLinkUrls[id] ?? null)[0] ??
                          null
                        }
                        signingReady={signingReady}
                        snapshotAt={trackingSnapshotAt}
                      />
                    )}
                    {section === "all" && (
                      <DeliverableWorkflow
                        asset={asset}
                        canManage={canManage}
                        campaignId={campaign.id}
                        campaignStatus={campaign.status}
                        defaultOpen={
                          firstActionAsset?.asset.id === asset.id &&
                          state.kind === "deliverable"
                        }
                        projectId={projectSlug}
                      />
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="campaign-inline-empty">
              <strong>No content assets are planned.</strong>
              <p>
                Return to the approved plan before activating this campaign.
              </p>
            </div>
          )}
        </section>
      )}

      {(section === "all" || section === "history") && (
        <section
          className="panel campaign-activity-panel"
          id="campaign-activity"
        >
          <header className="panel__header">
            <div>
              <Eyebrow>ACTIVITY / AUDIT TRAIL</Eyebrow>
              <h2>State changes retain their reason</h2>
            </div>
            <Status>{campaign.activity.length} EVENTS</Status>
          </header>
          {campaign.activity.length > 0 ? (
            <ol className="campaign-activity-list">
              {campaign.activity.map((entry, index) => (
                <li key={entry.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>
                      {entry.fromStatus.toUpperCase()} →{" "}
                      {entry.toStatus.toUpperCase()}
                    </strong>
                    <p>{entry.reason}</p>
                  </div>
                  <div>
                    <time dateTime={entry.createdAt}>
                      {formatDate(entry.createdAt)}
                    </time>
                    <code>REQUEST {entry.transitionRequestId}</code>
                    <small>ACTOR {entry.actorUserId}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="campaign-inline-empty">
              <strong>No state transition has been recorded yet.</strong>
              <p>
                The initial commercial-plan creation remains in the audit log.
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function CampaignWorkspacePermission() {
  return (
    <section className="directory-state">
      <Eyebrow>CAMPAIGN ACCESS</Eyebrow>
      <h2>This campaign is outside your project access.</h2>
      <p>Ask a workspace administrator to add you to the project.</p>
      <Status>PERMISSION REQUIRED</Status>
    </section>
  );
}
