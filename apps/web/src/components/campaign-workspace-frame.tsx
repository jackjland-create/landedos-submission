import type { ReactNode } from "react";
import Link from "next/link";
import { ApplicationProcess, ApplicationStatus } from "@landed/ui";
import type { CampaignProgressStep } from "@/lib/campaign-workspace-progress";
import styles from "./campaign-workspace-frame.module.css";

/*
 * CMP-03 / BRD-06 / UI-03 / DEM-01 · golden screen 04.
 * Presentation only: every value arrives already derived by the owning
 * workspace. This file adds no data reads, decisions or state transitions.
 */

type Tone = "attention" | "progress" | "blocked" | "neutral";
type DotState = "confirmed" | "pending" | "unavailable";

function Icon({
  name,
}: {
  name: "lock" | "arrow" | "brief" | "clock" | "alert" | "check" | "eye";
}) {
  const paths: Record<typeof name, ReactNode> = {
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    brief: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2 21h20z" />
        <path d="M12 10v4M12 17.5v.5" />
      </>
    ),
    check: <path d="m5 12 4 4 10-10" />,
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

/** A word plus a filled, hollow or dashed dot — never colour alone. */
export function FrameDot({
  state,
  tone = "neutral",
  children,
}: {
  state: DotState;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className={styles.dotWord} data-state={state} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

/** One segment per deliverable; decorative, the tile text carries the counts. */
export function FrameSegments({
  items,
}: {
  items: { id: string; status: string }[];
}) {
  return (
    <div className={styles.segments} aria-hidden="true">
      {items.map((item) => (
        <span data-status={item.status} key={item.id} />
      ))}
    </div>
  );
}

export type FrameTile = {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  /** Optional visual summary; it must repeat information already in text. */
  visual?: ReactNode;
};

const progressWord: Record<CampaignProgressStep["state"], string> = {
  complete: "Done",
  pending: "Not yet",
  unavailable: "Unavailable",
};

/**
 * Six supplied, display-only steps. The order is the campaign's order, not a
 * judgement of the current step: no step is highlighted as "you are here".
 */
export function CampaignProgress({
  progress,
}: {
  progress: { snapshotAt: string; steps: CampaignProgressStep[] };
}) {
  const asOf = Number.isFinite(Date.parse(progress.snapshotAt))
    ? new Date(progress.snapshotAt).toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC"
    : "time unavailable";
  return (
    <section className={styles.progress} aria-label="Campaign progress">
      <ol className={styles.steps}>
        {progress.steps.map((step) => (
          <li className={styles.step} data-state={step.state} key={step.id}>
            <details className={styles.stepDisclosure}>
              <summary>
                <span className={styles.stepMark} aria-hidden="true">
                  {step.state === "complete" && <Icon name="check" />}
                </span>
                <span className={styles.stepText}>
                  <strong>
                    {step.label}
                    <span className={styles.chevron} aria-hidden="true">
                      ⌄
                    </span>
                  </strong>
                  <span className={styles.stepState}>
                    {progressWord[step.state]}
                  </span>
                </span>
              </summary>
              <p className={styles.stepDetail}>{step.detail}</p>
            </details>
          </li>
        ))}
      </ol>
      <p className={styles.asOf}>Progress as of {asOf}</p>
    </section>
  );
}

export type FrameNavigationItem = {
  key: string;
  label: string;
  href: string;
  current: boolean;
};

export function CampaignWorkspaceFrame({
  theme,
  canManage,
  breadcrumb,
  meta,
  title,
  objective,
  status,
  brief,
  approvalRecordHref,
  themeHref,
  themeLabel,
  tiles,
  progress,
  navigation,
  detailScroll = "panel",
  nextAction,
  children,
}: {
  theme: "light" | "dark";
  canManage: boolean;
  breadcrumb: { href: string; label: string };
  meta: string;
  title: string;
  objective: string;
  status: { label: string; state: DotState; tone: Tone };
  brief: { label: string; state: DotState; tone: Tone };
  approvalRecordHref: string;
  themeHref: string;
  themeLabel: string;
  tiles: FrameTile[];
  /** Supplied by the campaign route; absent progress shows no stepper. */
  progress?: { snapshotAt: string; steps: CampaignProgressStep[] };
  navigation: FrameNavigationItem[];
  /** Short task views grow with their content; dense views retain a scroll panel. */
  detailScroll?: "panel" | "page";
  /** Lead with the status-view action before supporting progress and summaries. */
  nextAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.frame}
      data-theme={theme}
      data-detail-scroll={detailScroll}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <p className={styles.meta}>
            <Link href={breadcrumb.href}>{breadcrumb.label}</Link>
            <span aria-hidden="true"> · </span>
            {meta}
          </p>
          <div className={styles.titleRow}>
            <h1>{title}</h1>
            <span className={styles.pills}>
              <ApplicationStatus
                state={status.state}
                tone={toStatusTone(status.tone)}
              >
                {status.label}
              </ApplicationStatus>
              <ApplicationStatus
                state={brief.state}
                tone={toStatusTone(brief.tone)}
              >
                {brief.label}
              </ApplicationStatus>
            </span>
          </div>
          <p className={styles.objective}>{objective}</p>
          {!canManage && (
            <p className={styles.notice} role="note">
              Read-only access. A campaign manager makes operational decisions.
            </p>
          )}
        </div>
        <div className={styles.actions}>
          {!canManage && (
            <span className={styles.viewOnly}>
              <Icon name="eye" />
              View only
            </span>
          )}
          <Link className="application-button" href={approvalRecordHref}>
            <Icon name="lock" />
            Approval record
          </Link>
          <Link className={styles.textLink} href={themeHref}>
            {themeLabel}
          </Link>
        </div>
      </header>
      {nextAction && <div className={styles.nextAction}>{nextAction}</div>}
      {progress?.steps.length ? <CampaignProgress progress={progress} /> : null}
      <dl className={styles.tiles}>
        {tiles.map((tile) => (
          <div className={styles.tile} key={tile.label}>
            <dt>{tile.label}</dt>
            <dd className={styles.tileValue}>{tile.value}</dd>
            {tile.visual}
            <dd className={styles.tileDetail}>{tile.detail}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.card}>
        <nav aria-label="Campaign views" className={styles.navigation}>
          {navigation.map((item) => (
            <Link
              aria-current={item.current ? "page" : undefined}
              href={item.href}
              key={item.key}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div
          className={styles.body}
          role="region"
          aria-label="Campaign details"
          tabIndex={detailScroll === "panel" ? 0 : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function toStatusTone(tone: Tone) {
  return tone === "neutral" ? ("neutral" as const) : tone;
}

/**
 * The single next-action row. Managers see the action; view-only users see
 * who owns it. `ownerAction` false keeps a shared review (an issued result or
 * an unavailable plan) visible to everyone without implying a decision.
 */
export function CampaignNextStep({
  canManage,
  ownerAction,
  tone,
  title,
  detail,
  href,
  label,
  primary = false,
}: {
  canManage: boolean;
  ownerAction: boolean;
  tone: Tone;
  title: string;
  detail: string;
  href: string;
  label: string;
  primary?: boolean;
}) {
  const waiting = ownerAction && !canManage;
  const appliedTone: Tone = waiting ? "neutral" : tone;
  const icon =
    tone === "blocked"
      ? "alert"
      : waiting
        ? "clock"
        : tone === "progress"
          ? "check"
          : "brief";
  const button =
    primary && !waiting
      ? "application-button application-button--hero"
      : appliedTone === "attention"
        ? "application-button application-button--attention"
        : appliedTone === "progress"
          ? "application-button application-button--progress"
          : "application-button";
  return (
    <section
      aria-label="Next campaign action"
      className={styles.next}
      data-tone={appliedTone}
    >
      <span className={styles.nextIcon} data-tone={appliedTone}>
        <Icon name={icon} />
      </span>
      <div className={styles.nextCopy}>
        <p className={styles.eyebrow}>
          {waiting ? "Waiting on the campaign manager" : "Next step"}
        </p>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <a className={button} href={href}>
        {label}
        <Icon name="arrow" />
      </a>
    </section>
  );
}

/** Frame-shaped loading state for a real route load; static under reduced motion. */
export function CampaignWorkspaceFrameState({
  theme = "light",
  state,
  title,
  detail,
  children,
}: {
  theme?: "light" | "dark";
  state: "loading" | "error" | "permission" | "empty";
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.frame} data-theme={theme}>
      <section
        aria-label={title}
        className={`${styles.card} ${styles.stateCard}`}
        aria-busy={state === "loading" || undefined}
      >
        <div
          role={
            state === "loading"
              ? undefined
              : state === "error"
                ? "alert"
                : "status"
          }
        >
          {state === "loading" ? (
            <ApplicationProcess label={title} />
          ) : (
            <h1>{title}</h1>
          )}
          <p>{detail}</p>
        </div>
        {children}
      </section>
    </div>
  );
}
