"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CreatorEconomicsResult } from "@landed/analytics";
import type { ProjectReport, ProjectReportEvidencePath } from "@landed/db";
import { ApplicationButton, ApplicationStatus } from "@landed/ui";
import {
  clarityCsv,
  clarityDate,
  clarityMetrics,
  clarityMoney,
  clarityRate,
  type ClarityReportVersion,
  type EvidenceProvenance,
} from "@/lib/reports/clarity";
import {
  overviewDelta,
  overviewComparable,
  overviewPoints,
  retainedDisplayName,
  reportCampaignLabel,
  hasRetainedDisplayName,
  roundedOverviewMoney,
} from "@/lib/reports/overview-presentation";
import { AppShell } from "./app-shell";
import { ApplicationState } from "./application-ui";
import { ShellIcon } from "./shell-icon";
import { ShellDisclosure } from "./shell-mobile-menu";
import { ReportSnapshotChart } from "./report-snapshot-chart";
import { ReportFunnelChart } from "./report-funnel-chart";
import styles from "./overview-cockpit.module.css";

export type OverviewFixture = {
  submissionContext?: { consentingWallets: number; targetCpqw: string };
  report: Omit<ProjectReport, "versions"> & {
    versions: ClarityReportVersion[];
  };
  selectedVersion: ClarityReportVersion;
  rankingEvidencePaths: ProjectReportEvidencePath[];
};
export type OverviewCockpitProps = {
  fixture?: OverviewFixture | null;
  economics?: Record<string, CreatorEconomicsResult | null>;
  evidenceProvenance?: EvidenceProvenance;
  state: "ready" | "loading" | "empty" | "error" | "permission";
  accountName?: string;
  projectSlug?: string;
  canManage?: boolean;
  submissionSnapshot?: boolean;
  initialTheme?: "light" | "dark";
  initialView?: string;
  compareVersion?: number | null;
  retryHref?: string;
};
type Metric = "qualified" | "spend" | "cpqw" | "revenue";
const metricLabels: Record<Metric, string> = {
  qualified: "Qualified wallets",
  spend: "Spend",
  cpqw: "Cost per wallet",
  revenue: "Verified revenue",
};
const views = ["performance", "funnel", "creators", "economics"] as const;
const viewLabels = ["Performance", "Funnel", "Creators & content", "Economics"];
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));

function contentGroups(paths: ProjectReportEvidencePath[]) {
  const unique = [
    ...new Map(paths.map((p) => [p.attributionFactId, p])).values(),
  ];
  return [...new Set(unique.map((p) => p.contentAssetId))].map((id) => ({
    id,
    label: retainedDisplayName(
      unique.find((p) => p.contentAssetId === id)!.contentAssetLabel,
      id,
    ),
    paths: unique.filter((p) => p.contentAssetId === id),
  }));
}

function Drawer({
  title,
  close,
  children,
  footer,
  theme,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  footer: ReactNode;
  theme: "light" | "dark";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      data-theme={theme}
      aria-labelledby="overview-evidence-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], summary, [tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id="overview-evidence-title">{title}</h2>
        </div>
        <button type="button" aria-label="Close evidence" onClick={close}>
          ×
        </button>
      </header>
      <div className={styles.drawerBody}>{children}</div>
      <footer>{footer}</footer>
    </dialog>
  );
}

function EvidenceRow({
  path,
  synthetic,
  provenance,
}: {
  path: ProjectReportEvidencePath;
  synthetic: boolean;
  provenance: EvidenceProvenance;
}) {
  const explorer =
    path.environment === "demo"
      ? null
      : `https://explorer.solana.com/tx/${encodeURIComponent(path.transactionSignature)}${path.environment === "devnet" ? "?cluster=devnet" : ""}`;
  return (
    <details className={styles.path}>
      <summary>
        <span>
          {date(path.touchTime)} → {date(path.conversionTime)}
        </span>
        <ApplicationStatus
          state={path.confidence === "indicative" ? "pending" : "confirmed"}
        >
          {path.confidence}
        </ApplicationStatus>
      </summary>
      <p>
        Click →{" "}
        {synthetic
          ? "Simulated signature + consent"
          : provenance === "unknown"
            ? "Proof status not available"
            : "Signed nonce + consent"}{" "}
        → {path.finality} transaction
      </p>
      <p>
        {path.conversionRuleName} · definition v{path.conversionRuleVersion}
      </p>
      <p>
        {path.primaryRoasEligible
          ? "Eligible confidence for primary ROAS"
          : "Excluded from primary ROAS"}
        . Transfer value is not revenue.
      </p>
      {explorer ? (
        <a href={explorer} target="_blank" rel="noopener noreferrer">
          Transaction ↗
        </a>
      ) : (
        <span>Transaction simulated in demo</span>
      )}
      <details>
        <summary>Technical evidence</summary>
        <dl>
          <dt>Touch</dt>
          <dd>{clarityDate(path.touchTime)}</dd>
          <dt>Conversion</dt>
          <dd>{clarityDate(path.conversionTime)}</dd>
          <dt>Signature</dt>
          <dd className={styles.identity}>{path.transactionSignature}</dd>
          <dt>Attribution fact</dt>
          <dd className={styles.identity}>{path.attributionFactId}</dd>
          <dt>Environment</dt>
          <dd>{path.environment}</dd>
        </dl>
      </details>
    </details>
  );
}

export function OverviewCockpit({
  fixture,
  economics = {},
  evidenceProvenance = "unknown",
  state,
  accountName = "Signed-in user",
  projectSlug = "helios",
  canManage = false,
  submissionSnapshot = false,
  initialTheme = "light",
  initialView,
  compareVersion,
  retryHref,
}: OverviewCockpitProps) {
  const [theme, setTheme] = useState(initialTheme);
  const [view, setView] = useState<(typeof views)[number]>(
    views.find((item) => item === initialView) ?? "performance",
  );
  const [drawer, setDrawer] = useState<Metric | "counts" | null>(null);
  const [table, setTable] = useState(false);
  const base = `/projects/${projectSlug}`;
  const changeTheme = (next: "light" | "dark") => {
    setTheme(next);
    const url = new URL(location.href);
    url.searchParams.set("theme", next);
    history.replaceState(null, "", url);
  };
  const changeView = (next: (typeof views)[number]) => {
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set("view", next);
    history.replaceState(null, "", url);
  };
  const version = fixture?.selectedVersion;
  const metrics = version ? clarityMetrics(version) : null;
  const raw = version?.metricSnapshot.metrics;
  const previous = fixture?.report.versions.find(
    (v) =>
      v.version ===
        (compareVersion ?? (version ? version.version - 1 : null)) &&
      v.version !== version?.version,
  );
  const paths =
    fixture?.rankingEvidencePaths.filter(
      (p) =>
        p.reportVersionId === version?.id &&
        p.metricSnapshotId === version?.metricSnapshot.id &&
        p.metric === "qualified_wallets",
    ) ?? [];
  const rows = version ? (economics[version.version]?.creators ?? []) : [];
  const creatorRows = rows.length
    ? rows.map((r) => ({
        id: r.creatorId,
        name: retainedDisplayName(r.creatorName, r.creatorId),
        nameRetained: hasRetainedDisplayName(r.creatorName, r.creatorId),
        count: r.qualifiedWallets,
        cost: clarityRate(r.cpqwMinorDecimal, raw!.cpc.currencyCode),
      }))
    : [...new Set(paths.map((p) => p.creatorId))].map((id) => ({
        id,
        nameRetained: hasRetainedDisplayName(
          paths.find((p) => p.creatorId === id)!.creatorName,
          id,
        ),
        name: retainedDisplayName(
          paths.find((p) => p.creatorId === id)!.creatorName,
          id,
        ),
        count: new Set(
          paths
            .filter((p) => p.creatorId === id)
            .map((p) => p.attributionFactId),
        ).size,
        cost: "Not available",
      }));
  creatorRows.sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  const points = version ? overviewPoints(version) : [];
  const partialCoverage = points.some(
    (p) =>
      p.qualifiedPeriodState === "partial" ||
      p.activatedPeriodState === "partial",
  );
  const target = version?.measurementContext?.benchmarks.find(
    (b) =>
      b.kind === "approved_target" &&
      b.metric === "qualified_wallets" &&
      b.status === "available",
  );
  const strong = new Set(
    paths
      .filter((p) => p.confidence === "strong" || p.confidence === "verified")
      .map((p) => p.attributionFactId),
  ).size;
  const indicative = new Set(
    paths
      .filter((p) => p.confidence === "indicative")
      .map((p) => p.attributionFactId),
  ).size;
  const synthetic = evidenceProvenance === "synthetic";
  const reportHref =
    version && fixture
      ? `${base}/reports/${fixture.report.id}?version=${version.version}`
      : "";
  const campaignHref = fixture
    ? `${base}/campaigns/${fixture.report.campaignId}`
    : `${base}/campaigns`;
  const versionHref = (n: number, compare?: number) =>
    `${base}/overview?report=${fixture!.report.id}&version=${n}&theme=${theme}&view=${view}${compare ? `&compare=${compare}` : ""}`;
  const download = () => {
    if (!version) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          submissionSnapshot
            ? [
                "Synthetic prototype snapshot; not an issued report",
                "Metric,Value",
                ...Object.entries({
                  Spend: metrics?.spend,
                  "Qualified visits": metrics?.clicks,
                  "Consenting wallets":
                    fixture?.submissionContext?.consentingWallets,
                  "Qualified wallets": metrics?.qualified,
                  "Cost per qualified wallet": metrics?.cpqw,
                  "Target cost per qualified wallet GBP":
                    fixture?.submissionContext?.targetCpqw,
                  Activation: "Not measured",
                  Revenue: "Not measured",
                }).map(
                  ([key, value]) =>
                    `${key},"${String(value ?? "Not available").replaceAll('"', '""')}"`,
                ),
              ].join("\n")
            : clarityCsv(version, undefined, undefined, evidenceProvenance),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = submissionSnapshot
      ? "landedos-synthetic-campaign.csv"
      : `campaign-report-v${version.version}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const boundary = state !== "ready" || !version || !metrics || !raw;
  const footer = (
    <>
      <ApplicationButton onClick={download}>Export CSV</ApplicationButton>
      {previous && version && (
        <a
          className="application-button"
          href={versionHref(version.version, previous.version)}
        >
          Compare with v{previous.version}
        </a>
      )}
    </>
  );
  return (
    <AppShell
      activeSection="overview"
      projectId={projectSlug}
      theme={theme}
      accountName={accountName}
      onThemeChange={changeTheme}
      dataLabel={
        synthetic
          ? "Synthetic data"
          : evidenceProvenance === "non_mainnet"
            ? "Devnet evidence"
            : null
      }
      showGuidedDemo={false}
      contentAppearance="application"
      contentClassName={styles.main}
    >
      <div className={styles.cockpit}>
        <header className={styles.header}>
          <h1>
            <ShellIcon name="overview" />
            Overview
          </h1>
          <div>
            {version && (
              <span className={styles.range}>
                {date(raw!.cpqw.sourceTimeRange.startedAt)} –{" "}
                {date(raw!.cpqw.sourceTimeRange.endedAt)}
              </span>
            )}
            {version && (
              <ApplicationButton
                onClick={download}
                aria-label={
                  submissionSnapshot
                    ? "Export synthetic campaign values"
                    : "Export exact report values"
                }
              >
                Export
              </ApplicationButton>
            )}
            <a
              className={`application-button ${canManage ? "application-button--hero" : ""}`}
              href={`${base}/${canManage ? "kols" : "campaigns"}`}
            >
              {canManage ? "+ New campaign" : "View campaigns"}
            </a>
          </div>
        </header>
        {boundary ? (
          <ApplicationState
            state={state === "ready" ? "empty" : state}
            title={
              {
                loading: "Loading your overview…",
                empty: "No issued results yet",
                error: "The overview could not be loaded",
                permission: "Workspace access is required",
                ready: "No issued results yet",
              }[state]
            }
            detail={
              state === "permission"
                ? "No report or evidence has been returned. Ask the workspace owner for access."
                : state === "error"
                  ? "The retained report is unchanged. Try loading the overview again."
                  : "Campaign work remains available. Results appear here after a report is reviewed and issued."
            }
          >
            {state === "error" && (
              <a
                className="application-button"
                href={retryHref ?? `${base}/overview`}
              >
                Retry overview
              </a>
            )}
          </ApplicationState>
        ) : (
          <>
            <section className={styles.needs} aria-label="Your next steps">
              <div>
                <span className={styles.infoTile}>
                  <ShellIcon name="campaigns" />
                </span>
                <p>
                  <strong>Campaign</strong>
                  <span title={version.campaignName}>
                    {reportCampaignLabel(version.campaignName)}
                  </span>
                </p>
                <a className="application-button" href={campaignHref}>
                  Open campaign →
                </a>
              </div>
              <div>
                <span className={styles.infoTile}>✓</span>
                <p>
                  <strong>
                    {submissionSnapshot
                      ? "Synthetic campaign"
                      : "Issued result"}
                  </strong>
                  <span>
                    {submissionSnapshot
                      ? "14 days · 3 creators · Read-only"
                      : `Report v${version.version} · fixed snapshot`}
                  </span>
                </p>
                <ApplicationButton onClick={() => setDrawer("counts")}>
                  How it counts
                </ApplicationButton>
              </div>
              <div>
                <span className={styles.infoTile}>
                  <ShellIcon name="baskets" />
                </span>
                <p>
                  <strong>Build on results</strong>
                  <span>Review your next allocation</span>
                </p>
                <a
                  className={`application-button ${canManage ? "application-button--progress" : ""}`}
                  href={`${base}/${canManage ? "kols" : "baskets"}`}
                >
                  {canManage ? "Plan next campaign →" : "View campaign plans"}
                </a>
              </div>
            </section>
            <section
              className={styles.performanceLine}
              aria-label="Campaign context"
            >
              <div>
                <h2>Performance</h2>
                <span className={styles.range} title={version.campaignName}>
                  {reportCampaignLabel(version.campaignName)}
                </span>
              </div>
              <div>
                <span className={styles.freshness}>
                  Data through {clarityDate(raw.cpqw.dataFreshness.dataThrough)}
                </span>
                <ApplicationButton
                  aria-label="How these numbers count"
                  onClick={() => setDrawer("counts")}
                >
                  ⓘ
                </ApplicationButton>
                <a
                  className={`application-button ${canManage ? "application-button--progress" : ""}`}
                  href={`${campaignHref}?view=content`}
                >
                  {canManage ? "Review next brief →" : "View brief"}
                </a>
              </div>
            </section>
            <div className={styles.kpis}>
              {(["qualified", "spend", "cpqw", "revenue"] as Metric[]).map(
                (key) => {
                  const exact =
                    metrics[key] === null
                      ? "Not available"
                      : String(metrics[key]);
                  const delta =
                    key === "spend"
                      ? null
                      : overviewDelta(version, previous, key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`${styles.kpi} ${drawer === key ? styles.selected : ""}`}
                      onClick={() => setDrawer(key)}
                      aria-haspopup="dialog"
                      aria-label={`${metricLabels[key]}: ${exact}. Open evidence`}
                    >
                      <span>{metricLabels[key]}</span>
                      <div>
                        <strong title={`Exact value: ${exact}`}>
                          {key === "cpqw" ? exact : roundedOverviewMoney(exact)}
                        </strong>
                        {key === "qualified" && target?.valueDecimal && (
                          <span>/ {target.valueDecimal} goal</span>
                        )}
                      </div>
                      <small
                        className={
                          delta?.positive === true
                            ? styles.positive
                            : delta?.positive === false
                              ? styles.negative
                              : undefined
                        }
                      >
                        {exact === "Not available"
                          ? "Not available · review missing evidence"
                          : delta
                            ? `${delta.text} · vs ${roundedOverviewMoney(delta.before)} in v${previous!.version}`
                            : key === "spend"
                              ? "Cost basis · not payments"
                              : submissionSnapshot
                                ? "Synthetic result · view definition"
                                : "Exact issued value · see evidence"}
                      </small>
                    </button>
                  );
                },
              )}
            </div>
            <section
              className={styles.dataCard}
              aria-label="Campaign data views"
            >
              <header>
                <div
                  role="tablist"
                  aria-label="Overview data views"
                  className={styles.tabs}
                >
                  {views.map((item, index) => (
                    <button
                      type="button"
                      role="tab"
                      id={`overview-tab-${item}`}
                      aria-controls="overview-data-panel"
                      aria-selected={view === item}
                      tabIndex={view === item ? 0 : -1}
                      key={item}
                      onClick={() => changeView(item)}
                      onKeyDown={(event) => {
                        const delta =
                          event.key === "ArrowRight"
                            ? 1
                            : event.key === "ArrowLeft"
                              ? -1
                              : 0;
                        if (
                          delta ||
                          event.key === "Home" ||
                          event.key === "End"
                        ) {
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? views.length - 1
                                : (index + delta + views.length) % views.length;
                          changeView(views[next]!);
                          event.currentTarget.parentElement
                            ?.querySelectorAll<HTMLButtonElement>("button")
                            [next]?.focus();
                        }
                      }}
                    >
                      {viewLabels[index]}
                    </button>
                  ))}
                </div>
                {submissionSnapshot ? (
                  <span className={styles.versions}>
                    Synthetic snapshot · 28 Sep–11 Oct
                  </span>
                ) : (
                  <ShellDisclosure
                    className={styles.versions}
                    label="Choose issued report version"
                    summary={
                      <>
                        {submissionSnapshot
                          ? "Synthetic snapshot · 28 Sep–11 Oct"
                          : `Report v${version.version} · ${date(version.issuedAt)} ⌄`}
                      </>
                    }
                  >
                    <nav aria-label="Issued report versions">
                      {fixture!.report.versions.map((v) => (
                        <a
                          key={v.id}
                          href={versionHref(v.version)}
                          aria-current={
                            v.id === version.id ? "page" : undefined
                          }
                        >
                          v{v.version} · {date(v.issuedAt)} · fixed
                        </a>
                      ))}
                      <a href={reportHref}>Exact report & review history →</a>
                    </nav>
                  </ShellDisclosure>
                )}
              </header>
              <div
                role="tabpanel"
                id="overview-data-panel"
                aria-labelledby={`overview-tab-${view}`}
                className={styles.dataBody}
              >
                {view === "performance" && (
                  <div className={styles.chartGrid}>
                    <div className={styles.chart}>
                      {partialCoverage && (
                        <p className={styles.coverage} role="status">
                          Partial coverage · some daily periods are incomplete.
                        </p>
                      )}
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => setTable(!table)}
                      >
                        {table ? "View chart" : "View as table"}
                      </button>
                      {table ? (
                        <table>
                          <caption>Retained daily observations</caption>
                          <thead>
                            <tr>
                              <th scope="col">Day</th>
                              <th scope="col">Qualified</th>
                              <th scope="col">Activated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {points.map((p) => (
                              <tr key={p.date}>
                                <th scope="row">
                                  {p.label}
                                  {p.qualifiedPeriodState === "partial" ||
                                  p.activatedPeriodState === "partial"
                                    ? " · partial"
                                    : ""}
                                </th>
                                <td>
                                  {p.qualifiedWalletsExact ?? "Not available"}
                                </td>
                                <td>
                                  {p.activatedWalletsExact ?? "Not available"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <ReportSnapshotChart
                          animate={false}
                          edgeLabelInset={32}
                          points={points}
                          compact
                          revealSignature={version.id}
                          benchmarks={
                            target?.valueDecimal
                              ? [
                                  {
                                    kind: "approved_target",
                                    label: "Approved goal",
                                    metric: "qualified_wallets",
                                    sourceLabel: target.sourceLabel,
                                    value:
                                      BigInt(target.valueDecimal) <=
                                      BigInt(Number.MAX_SAFE_INTEGER)
                                        ? Number(target.valueDecimal)
                                        : null,
                                    valueDecimal: target.valueDecimal,
                                  },
                                ]
                              : []
                          }
                        />
                      )}
                    </div>
                    <aside className={styles.ranking}>
                      <h3>
                        Top creators <span>Qualified wallets</span>
                      </h3>
                      {creatorRows.length ? (
                        creatorRows.slice(0, 3).map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => setDrawer("qualified")}
                            aria-haspopup="dialog"
                          >
                            <span className={styles.avatar} aria-hidden="true">
                              {!row.nameRetained
                                ? "—"
                                : row.name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .slice(0, 2)
                                    .join("")}
                            </span>
                            <div>
                              <strong
                                className={
                                  !row.nameRetained
                                    ? styles.missingName
                                    : undefined
                                }
                                title={row.name}
                              >
                                {row.name}
                              </strong>
                              {row.count !== null && (
                                <meter
                                  min={0}
                                  max={Math.max(
                                    ...creatorRows.map((r) => r.count ?? 0),
                                    1,
                                  )}
                                  value={row.count ?? 0}
                                  aria-label={`${row.name} qualified wallets`}
                                />
                              )}
                            </div>
                            <div>
                              <strong>{row.count ?? "Not available"}</strong>
                              <span>{row.cost}/wallet</span>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p>Creator results not available in this version.</p>
                      )}
                      <section className={styles.confidence}>
                        <h3>
                          {submissionSnapshot
                            ? "Next budget decision"
                            : "Attribution confidence"}
                        </h3>
                        <p>
                          {submissionSnapshot
                            ? "Prioritise Maya; retain DeFi After Dark; renegotiate Mint Condition."
                            : paths.length
                              ? `${strong} verified / strong · ${indicative} indicative`
                              : "Confidence not available"}
                        </p>
                        <p>
                          {submissionSnapshot
                            ? "£17.50 overall against a £20 target. All outcomes and proof paths are simulated."
                            : synthetic
                              ? "Simulated signature + consent."
                              : paths.length
                                ? "Retained proof paths for this issued version."
                                : "Evidence paths not available."}
                        </p>
                        <div
                          className={styles.confidenceBar}
                          aria-hidden="true"
                        >
                          <span
                            style={{
                              width: `${strong + indicative ? (strong / (strong + indicative)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </section>
                    </aside>
                  </div>
                )}
                {view === "funnel" && (
                  <div className={styles.funnel}>
                    <ReportFunnelChart
                      stages={
                        submissionSnapshot && fixture?.submissionContext
                          ? [
                              {
                                label: "Qualified visits",
                                value: metrics.clicks ?? 0,
                              },
                              {
                                label: "Consenting wallets",
                                value:
                                  fixture.submissionContext.consentingWallets,
                              },
                              {
                                label: "Qualified wallets",
                                value: metrics.qualified ?? 0,
                              },
                            ]
                          : undefined
                      }
                      qualifiedClicks={metrics.clicks}
                      qualifiedWallets={metrics.qualified}
                      activatedWallets={metrics.activated}
                    />
                    <p>
                      {submissionSnapshot
                        ? "1,800 visits did not become consenting wallets. Of 800 consenting wallets, 400 completed the qualifying action. Retention and revenue are not measured."
                        : "Connected wallets and D7/D30 retention: Not available in this issued source."}
                    </p>
                  </div>
                )}
                {view === "creators" && (
                  <>
                    <table className={styles.creatorTable}>
                      <caption>
                        {submissionSnapshot
                          ? "Synthetic creator results · £20 target cost per qualified wallet"
                          : "Retained creator results · this issued version"}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Creator</th>
                          <th scope="col">Qualified wallets</th>
                          <th scope="col">Cost per wallet</th>
                          <th scope="col">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creatorRows.map((row) => (
                          <tr key={row.id}>
                            <th scope="row">{row.name}</th>
                            <td>{row.count ?? "Not available"}</td>
                            <td>{row.cost}</td>
                            <td>
                              <ApplicationButton
                                onClick={() => setDrawer("qualified")}
                              >
                                All qualifying evidence
                              </ApplicationButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className={styles.creatorCards}>
                      {creatorRows.map((row) => (
                        <section key={row.id}>
                          <h3>{row.name}</h3>
                          <dl>
                            <div>
                              <dt>Qualified wallets</dt>
                              <dd>{row.count ?? "Not available"}</dd>
                            </div>
                            <div>
                              <dt>Cost per wallet</dt>
                              <dd>{row.cost}</dd>
                            </div>
                          </dl>
                          <ApplicationButton
                            onClick={() => setDrawer("qualified")}
                          >
                            All qualifying evidence
                          </ApplicationButton>
                        </section>
                      ))}
                    </div>
                    {!creatorRows.length && (
                      <p>
                        Creator allocations are not retained in this version.
                      </p>
                    )}
                    <p>
                      Nothing renews or changes budget automatically. Plan
                      changes go through a new basket.
                    </p>
                  </>
                )}
                {view === "economics" && (
                  <>
                    <div className={styles.economicTiles}>
                      {(["roas", "cpc", "cpqw", "cpa"] as const).map(
                        (key, i) => (
                          <div key={key}>
                            <span>
                              {
                                [
                                  "Revenue ROAS",
                                  "Cost per click",
                                  "Cost per wallet",
                                  "Cost per activation",
                                ][i]
                              }
                            </span>
                            <strong>{metrics[key]}</strong>
                          </div>
                        ),
                      )}
                    </div>
                    <h3>Spend against verified revenue</h3>
                    <p>
                      {metrics.spend} reviewed spend · {metrics.revenue}{" "}
                      eligible revenue
                    </p>
                    <p>
                      Revenue, trading volume and token movement remain
                      separate. Exact values: click a tile above.
                    </p>
                    <ApplicationButton onClick={() => setDrawer("revenue")}>
                      Review revenue evidence
                    </ApplicationButton>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
      {drawer && version && metrics && raw && (
        <Drawer
          theme={theme}
          title={
            drawer === "counts"
              ? "How these numbers count"
              : metricLabels[drawer]
          }
          close={() => setDrawer(null)}
          footer={footer}
        >
          <p className={styles.muted}>
            {submissionSnapshot
              ? "Synthetic prototype snapshot · not an issued database report"
              : `Report v${version.version} · issued ${date(version.issuedAt)} · fixed`}
          </p>
          {previous &&
            drawer !== "counts" &&
            drawer !== "spend" &&
            !overviewComparable(version, previous, drawer) && (
              <p>
                Definition or measurement basis changed from v{previous.version}
                . These versions are not shown as like-for-like growth.
              </p>
            )}
          {drawer !== "counts" && (
            <div className={styles.exact}>
              <strong>{metrics[drawer] ?? "Not available"}</strong>
              <span>
                exactly
                {drawer === "qualified" && target?.valueDecimal
                  ? ` · goal ${target.valueDecimal}`
                  : ""}
              </span>
            </div>
          )}
          <p className={styles.rule}>
            Counts ·{" "}
            {paths[0]?.conversionRuleName ?? "See retained metric definition"}
          </p>
          <p className={styles.rule}>
            Credit · Last eligible creator touch ≤ 7 days
          </p>
          {target && (
            <p>
              Approved goal: {target.valueDecimal} · {target.sourceLabel}
            </p>
          )}
          {(drawer === "qualified" || drawer === "counts") && (
            <>
              <p>
                Results follow the{" "}
                {submissionSnapshot ? "illustrative" : "issued"} definition.
                Wallet proof and explicit consent are separate from a qualifying
                result.
              </p>
              <div className={styles.confidenceBar}>
                <span
                  style={{
                    width: `${strong + indicative ? (strong / (strong + indicative)) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>
                {paths.length ? (
                  <>
                    <strong>
                      {strong}{" "}
                      {submissionSnapshot
                        ? "simulated strong attribution"
                        : "verified / strong"}
                    </strong>{" "}
                    · {indicative} indicative
                  </>
                ) : (
                  "Confidence not available"
                )}
              </p>
              <p>
                Click →{" "}
                {synthetic
                  ? "Simulated signature + consent"
                  : evidenceProvenance === "unknown"
                    ? "Proof status not available"
                    : "Signed nonce + consent"}{" "}
                → Transaction
              </p>
              {creatorRows.map((row) => (
                <section className={styles.pathGroup} key={row.id}>
                  <h3>{row.name}</h3>
                  {!row.nameRetained && (
                    <p>
                      This issued version did not retain the creator’s display
                      name. A current profile name has not been substituted.
                    </p>
                  )}
                  {contentGroups(
                    paths.filter((p) => p.creatorId === row.id),
                  ).map((group) => (
                    <div key={group.id}>
                      <p>{group.label}</p>
                      {group.paths.map((p) => (
                        <EvidenceRow
                          key={p.attributionFactId}
                          path={p}
                          provenance={evidenceProvenance}
                          synthetic={synthetic || p.environment === "demo"}
                        />
                      ))}
                    </div>
                  ))}
                </section>
              ))}
              {!paths.length && (
                <p>Wallet-level evidence not available in this version.</p>
              )}
            </>
          )}
          {drawer === "spend" && (
            <>
              <p>Reviewed eligible costs, not evidence of payments.</p>
              {rows.map((r) => (
                <p key={r.creatorId}>
                  {retainedDisplayName(r.creatorName, r.creatorId)}{" "}
                  <strong>
                    {clarityMoney(
                      r.allocation.status === "available"
                        ? r.allocation.valueMinor
                        : null,
                      raw.cpc.currencyCode,
                    )}
                  </strong>
                </p>
              ))}
              {!rows.length && (
                <p>
                  Creator fee allocation is not retained here. The exact issued
                  total remains {metrics.spend}.
                </p>
              )}
            </>
          )}
          {drawer === "cpqw" && (
            <>
              <h3>Cost per qualified wallet</h3>
              <p className={styles.rule}>
                {metrics.spend} reviewed spend ÷{" "}
                {metrics.qualified ?? "Not available"} qualified wallets ={" "}
                {metrics.cpqw}
              </p>
              <p>
                Exact rate in minor units:{" "}
                {raw.cpqw.status === "available"
                  ? raw.cpqw.rateMinorDecimal
                  : "Not available"}
                . Displayed currency rounded to the nearest minor unit.
              </p>
              {previous && (
                <p>
                  Compared with v{previous.version}:{" "}
                  {clarityMetrics(previous).spend} ÷{" "}
                  {clarityMetrics(previous).qualified ?? "Not available"} ={" "}
                  {clarityMetrics(previous).cpqw}
                </p>
              )}
            </>
          )}
          {drawer === "revenue" && (
            <>
              <h3>Eligible protocol revenue</h3>
              <p>
                {metrics.revenue === "Not available"
                  ? "Revenue is unavailable in this issued metric. Unknown is not zero."
                  : "Primary revenue includes verified and strong attribution only."}
              </p>
              <p>
                Not revenue, kept separate: test transfers, trading volume and
                token movement.
              </p>
              <p>
                Revenue ROAS: {metrics.revenue} ÷ {metrics.spend} ={" "}
                {metrics.roas}
              </p>
              {metrics.revenue === "Not available" && (
                <a
                  className="application-button"
                  href={`${base}/settings/integrations`}
                >
                  View source settings
                </a>
              )}
            </>
          )}
          <div className={styles.trust}>
            <h3>Can I trust this?</h3>
            <p>
              Definitions fixed · freshness:{" "}
              {clarityDate(raw.cpqw.dataFreshness.dataThrough)}
            </p>
            <p>
              {partialCoverage
                ? "Partial last day explicitly labelled."
                : "No daily coverage inferred."}
            </p>
            <p>
              {synthetic
                ? "Wallet signatures and consent are simulated in this demo."
                : evidenceProvenance === "unknown"
                  ? "Wallet proof provenance not available."
                  : "Retained proof and consent paths; inspect each transaction."}
            </p>
            <p>Unconnected sources are unknown, not zero.</p>
            <p>
              {submissionSnapshot
                ? "This illustrative snapshot is stored with the prototype source. It has not been issued by the live reporting pipeline."
                : "Issued reports never change. New data makes a new version."}
            </p>
          </div>
        </Drawer>
      )}
    </AppShell>
  );
}
