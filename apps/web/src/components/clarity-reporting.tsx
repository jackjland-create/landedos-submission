"use client";

import { AppShell } from "./app-shell";
import Link from "next/link";

import type { CreatorEconomicsResult } from "@landed/analytics";
import type { ProjectReport, ProjectReportEvidencePath } from "@landed/db";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  clarityCsv,
  clarityDate,
  clarityMetrics,
  clarityMoney,
  clarityRate,
  clarityViews,
  headlineMetrics,
  parseHeadlineMetrics,
  parseClarityQuery,
  type ClarityQuery,
  type ClarityReportVersion,
  type EvidenceProvenance,
} from "@/lib/reports/clarity";
import type { ReportVisualState } from "@/lib/reports/visual-fixtures";
import type { TimedReportPresentation } from "@/lib/reports/timed-report-presentation";
import type { TimedReportDetails } from "@/lib/reports/timed-report-details";
import {
  ReportSnapshotChart,
  type ReportSnapshotChartPoint,
} from "./report-snapshot-chart";
import { ReportFunnelChart } from "./report-funnel-chart";
import styles from "./clarity-reporting.module.css";
import { ClarityMetricPicker } from "./clarity-metric-picker";
import {
  ClarityCreatorCanvas,
  ClarityCreatorTerms,
} from "./clarity-creator-canvas";

type Fixture = {
  report: Omit<ProjectReport, "versions"> & {
    versions: ClarityReportVersion[];
  };
  selectedVersion: ClarityReportVersion;
  rankingEvidencePaths: ProjectReportEvidencePath[];
};
type Props = {
  initialQuery?: ClarityQuery;
  state: ReportVisualState;
  fixture?: Fixture | null;
  economics?: Record<string, CreatorEconomicsResult | null>;
  sourceMode?: "reference" | "isolated-issued" | "issued";
  timedContext?: TimedReportPresentation;
  timedDetail?: TimedReportDetails;
  issuedContextStatus?: "timed" | "measurement" | "metric_snapshot_only";
  evidenceProvenance?: EvidenceProvenance;
  syntheticDemoContext?: boolean;
  projectSlug?: string;
  unavailableVersionHref?: string;
  unavailableVersionLabel?: string;
  showGuidedDemo?: boolean;
  retryControl?: ReactNode;
};
const labels = {
  performance: "Performance",
  funnel: "Funnel",
  creators: "Creators & content",
  economics: "Economics",
  evidence: "Evidence & history",
};
const count = (value: number | null) =>
  value === null
    ? "Not available"
    : new Intl.NumberFormat("en-GB").format(value);

function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else
        document
          .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="clarity-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="clarity-dialog-title">{title}</h2>
        <button onClick={onClose} type="button">
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function ClarityReporting({
  initialQuery = parseClarityQuery(new URLSearchParams()),
  state,
  fixture = null,
  economics = {},
  sourceMode = "reference",
  timedContext,
  timedDetail,
  issuedContextStatus,
  evidenceProvenance = "unknown",
  syntheticDemoContext = false,
  projectSlug = "helios",
  unavailableVersionHref,
  unavailableVersionLabel = "Open latest issued version",
  showGuidedDemo = false,
  retryControl,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [dialog, setDialog] = useState<
    "evidence" | "basket" | "metrics" | null
  >(initialQuery.evidence ? "evidence" : null);
  const [notice, setNotice] = useState("");
  const [selectedCreators, setSelectedCreators] = useState<string[]>([]);
  const reportControlsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    document.getElementById("clarity-panel")?.scrollTo({ top: 0, left: 0 });
  }, [query.view, query.version, query.group]);
  useEffect(() => {
    const onPop = () => {
      const next = parseClarityQuery(
        new URLSearchParams(window.location.search),
      );
      setQuery(next);
      setDialog(next.evidence ? "evidence" : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const previous = document.documentElement.style.colorScheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousColor = meta?.getAttribute("content");
    document.documentElement.style.colorScheme = query.theme;
    meta?.setAttribute(
      "content",
      query.theme === "dark" ? "#161616" : "#f5f5f2",
    );
    return () => {
      document.documentElement.style.colorScheme = previous;
      if (previousColor) meta?.setAttribute("content", previousColor);
    };
  }, [query.theme]);
  function update(patch: Partial<ClarityQuery>) {
    if (patch.view && reportControlsRef.current)
      reportControlsRef.current.open = false;
    const next = { ...query, ...patch };
    setQuery(next);
    const url = new URL(window.location.href);
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    });
    if (
      sourceMode === "issued" &&
      patch.version !== undefined &&
      patch.version !== query.version
    ) {
      window.location.assign(url);
      return;
    }
    window.history.pushState(null, "", url);
    setNotice("");
  }
  const themeControl = (
    <button
      className={styles.themeToggle}
      type="button"
      role="switch"
      aria-label="Dark mode"
      aria-checked={query.theme === "dark"}
      onClick={() =>
        update({ theme: query.theme === "dark" ? "light" : "dark" })
      }
    >
      <span aria-hidden="true">Light</span>
      <span className={styles.toggleTrack} aria-hidden="true">
        <span />
      </span>
      <span aria-hidden="true">Dark</span>
    </button>
  );
  const previewBar = (
    <div className={styles.preview}>
      <span>
        <b>
          {sourceMode === "reference"
            ? "Design reference"
            : sourceMode === "isolated-issued"
              ? "Isolated issued report"
              : "Issued report"}
        </b>{" "}
        {sourceMode === "issued"
          ? "· Fixed snapshot · Not live monitoring"
          : "· Sanitized data · Not a live campaign"}
        {sourceMode === "isolated-issued" &&
          " · Wallet signatures and consent are simulated"}
        {sourceMode === "issued" &&
          syntheticDemoContext &&
          " · Synthetic demo walkthrough"}
        {sourceMode === "issued" &&
          evidenceProvenance === "synthetic" &&
          " · Synthetic demo evidence · Wallet signatures and consent are simulated"}
        {sourceMode === "issued" &&
          evidenceProvenance === "non_mainnet" &&
          " · Non-mainnet retained evidence"}
        {sourceMode === "issued" &&
          evidenceProvenance === "retained" &&
          " · Retained issued evidence"}
        {sourceMode === "issued" &&
          evidenceProvenance === "unknown" &&
          " · Exact outcome provenance unavailable"}
      </span>
      {themeControl}
      {sourceMode === "reference" && (
        <details>
          <summary>Review states</summary>
          <nav aria-label="Fixture states">
            {[
              "ready",
              "partial",
              "stale",
              "loading",
              "empty",
              "error",
              "permission",
            ].map((item) => (
              <a
                key={item}
                href={`/visual-tests/reporting-studio/clarity/${item}?theme=${query.theme}&view=${query.view}`}
              >
                {item}
              </a>
            ))}
          </nav>
        </details>
      )}
    </div>
  );
  const missingTimedContext =
    sourceMode === "isolated-issued" && Boolean(fixture) && !timedContext;
  if (!fixture || missingTimedContext) {
    const text = {
      loading: [
        "Preparing your report…",
        "Loading retained results. Values are not inferred while evidence loads.",
      ],
      empty: [
        "Your first report starts with a campaign",
        "No issued report is available. A campaign must be planned and measured first.",
      ],
      error: unavailableVersionHref
        ? [
            "That report version is unavailable",
            "The requested immutable version does not belong to this report. No other version was substituted.",
          ]
        : [
            "This report could not be loaded",
            "No issued result has changed. The report and its approved context must both be available.",
          ],
      permission: [
        "Reporting access is required",
        "Ask your workspace owner for reporting access. No campaign data is loaded.",
      ],
    }[
      (missingTimedContext ? "error" : state) as
        "loading" | "empty" | "error" | "permission"
    ];
    return (
      <div className={styles.app} data-theme={query.theme}>
        <AppShell
          activeSection="reports"
          projectId={projectSlug}
          theme={query.theme}
          showGuidedDemo={showGuidedDemo}
          proposalOnly={sourceMode === "reference"}
        >
          {previewBar}
          <section className={styles.boundary} aria-busy={state === "loading"}>
            <p className={styles.eyebrow}>LANDED / REPORTING</p>
            <h1>{text[0]}</h1>
            <p>{text[1]}</p>
            {state === "loading" && (
              <div className={styles.skeleton} aria-hidden="true" />
            )}
            {sourceMode === "reference" &&
              (state === "error" ? (
                <a
                  className={styles.primary}
                  href={`/visual-tests/reporting-studio/clarity/ready?theme=${query.theme}`}
                >
                  Retry demo report
                </a>
              ) : (
                <a
                  href={`/visual-tests/reporting-studio/clarity/ready?theme=${query.theme}`}
                >
                  Return to populated demo
                </a>
              ))}
            {unavailableVersionHref && (
              <Link className={styles.primary} href={unavailableVersionHref}>
                {unavailableVersionLabel}
              </Link>
            )}
            {retryControl}
            <p className={styles.small}>
              {sourceMode === "reference"
                ? "This reference does not create campaigns or send access requests."
                : "This screen never changes an issued report or its evidence."}
            </p>
          </section>
        </AppShell>
      </div>
    );
  }
  const version =
    fixture.report.versions.find((item) => item.version === query.version) ??
    fixture.selectedVersion;
  const previous =
    query.compare === null
      ? undefined
      : fixture.report.versions.find(
          (item) =>
            item.version === query.compare && item.version !== version.version,
        );
  const metrics = clarityMetrics(version);
  const chosenMetrics = parseHeadlineMetrics(query.metrics);
  const headlineValues = {
    ...metrics,
    clicks: count(metrics.clicks),
    qualified: count(metrics.qualified),
    activated: count(metrics.activated),
  };
  const oldMetrics = previous ? clarityMetrics(previous) : null;
  const raw = version.metricSnapshot.metrics;
  const currency = raw.cpc.currencyCode;
  const rows = economics[version.version]?.creators ?? [];
  const creatorId = rows.some((row) => row.creatorId === query.creator)
    ? query.creator
    : "all";
  const shownRows = rows.filter(
    (row) => creatorId === "all" || row.creatorId === creatorId,
  );
  const detailRow = rows.find((row) => row.creatorId === query.detail);
  const paths = fixture.rankingEvidencePaths.filter(
    (path) =>
      path.reportVersionId === version.id &&
      (!query.evidence ||
        query.evidence === "all" ||
        path.metric === query.evidence) &&
      (creatorId === "all" || path.creatorId === creatorId),
  );
  const context = version.measurementContext;
  const target = context?.benchmarks.find(
    (item) =>
      item.kind === "approved_target" &&
      item.metric === "qualified_wallets" &&
      item.status === "available",
  );
  const rankedRows = rows.every((row) => row.qualifiedWallets !== null)
    ? [...rows].sort((a, b) => b.qualifiedWallets! - a.qualifiedWallets!)
    : [];
  const leadingRow =
    rankedRows.length > 0 &&
    (rankedRows.length === 1 ||
      rankedRows[0]!.qualifiedWallets! > rankedRows[1]!.qualifiedWallets!)
      ? rankedRows[0]
      : null;
  const dailyPoints: ReportSnapshotChartPoint[] = [
    ...new Set(context?.observations.map((item) => item.periodStartedAt) ?? []),
  ].map((date) => {
    const observations = context!.observations.filter(
      (item) => item.periodStartedAt === date,
    );
    const qualified = observations.find(
      (item) => item.metric === "qualified_wallets",
    );
    const activated = observations.find(
      (item) => item.metric === "activated_wallets",
    );
    const exactQ =
      qualified?.status === "available" ? qualified.valueDecimal : null;
    const exactA =
      activated?.status === "available" ? activated.valueDecimal : null;
    const safe = (value: string | null | undefined) =>
      value != null && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : null;
    return {
      date: qualified?.observedThrough ?? date,
      label: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(date)),
      qualifiedWallets: safe(exactQ),
      activatedWallets: safe(exactA),
      qualifiedWalletsExact: exactQ,
      activatedWalletsExact: exactA,
      qualifiedPeriodState: qualified?.periodState,
      activatedPeriodState: activated?.periodState,
    };
  });
  const points = context
    ? dailyPoints
    : fixture.report.versions.map((item) => ({
        version: item.version,
        date: item.issuedAt,
        qualifiedWallets: clarityMetrics(item).qualified,
        activatedWallets: clarityMetrics(item).activated,
      }));
  const incomplete =
    metrics.qualified === null ||
    metrics.activated === null ||
    metrics.clicks === null ||
    metrics.spend === "Not available" ||
    metrics.revenue === "Not available";
  const staleAtIssue =
    !timedContext &&
    [raw.cpc, raw.cpqw, raw.cpa, raw.revenueRoas].some(
      (metric) =>
        Date.parse(version.issuedAt) -
          Date.parse(metric.dataFreshness.dataThrough) >
        86400000,
    );
  function download() {
    const exportScope = timedContext
      ? undefined
      : issuedContextStatus === "measurement"
        ? "issued campaign snapshot; observation context retained; contracted-cost detail unavailable"
        : issuedContextStatus === "metric_snapshot_only"
          ? "issued campaign metric snapshot; schedule and contracted-cost detail unavailable"
          : undefined;
    const blob = new Blob(
      [
        clarityCsv(
          version,
          timedContext,
          syntheticDemoContext
            ? `synthetic demo walkthrough; ${exportScope ?? "complete issued campaign snapshot"}`
            : exportScope,
          evidenceProvenance,
        ),
      ],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `landed-${sourceMode === "reference" ? "demo-" : ""}report-v${version.version}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      `Exported issued snapshot V${version.version}${timedContext ? " with contracted-cost and bounded-coverage disclosures" : issuedContextStatus ? " with unavailable retained context disclosed" : ""}. Creator-detail filters do not change this export.`,
    );
  }
  function toggleCreator(id: string) {
    setSelectedCreators((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }
  function openEvidence(
    metric: ClarityQuery["evidence"] = "all",
    patch: Partial<ClarityQuery> = {},
  ) {
    update({ ...patch, evidence: metric });
    setDialog("evidence");
  }
  function closeEvidence() {
    update({ evidence: "" });
    setDialog(null);
  }
  return (
    <div className={styles.app} data-theme={query.theme}>
      <AppShell
        activeSection="reports"
        projectId={projectSlug}
        theme={query.theme}
        showGuidedDemo={showGuidedDemo}
        proposalOnly={sourceMode === "reference"}
        contentClassName={`${styles.main} ${styles.sharedMain}`}
      >
        {previewBar}
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>ISSUED REPORT · V{version.version}</p>
            <h1>{version.campaignName}</h1>
            <p>
              {clarityDate(raw.cpc.sourceTimeRange.startedAt)} –{" "}
              {clarityDate(raw.cpc.sourceTimeRange.endedAt)}
            </p>
          </div>
          <div className={styles.actions}>
            <details
              ref={reportControlsRef}
              className={styles.reportControls}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary>Version & comparison</summary>
              <div className={styles.reportControlsBody}>
                <p>
                  Issued {clarityDate(version.issuedAt)} · fixed snapshot, not
                  live monitoring.
                </p>
                <label>
                  Report version
                  <select
                    aria-label="Report version"
                    value={version.version}
                    onChange={(event) =>
                      update({
                        version: Number(event.target.value),
                        compare: null,
                      })
                    }
                  >
                    {fixture.report.versions.map((item) => (
                      <option key={item.id} value={item.version}>
                        V{item.version} ·{" "}
                        {new Date(item.issuedAt).toISOString().slice(0, 10)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Comparison version
                  <select
                    aria-label="Comparison version"
                    value={previous?.version ?? ""}
                    onChange={(event) =>
                      update({
                        compare: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">No comparison</option>
                    {fixture.report.versions
                      .filter((item) => item.version !== version.version)
                      .map((item) => (
                        <option key={item.id} value={item.version}>
                          V{item.version} ·{" "}
                          {new Date(item.issuedAt).toISOString().slice(0, 10)}
                        </option>
                      ))}
                  </select>
                </label>
                {query.compare !== null && !previous && (
                  <p role="status">
                    Requested comparison V{query.compare} is unavailable for
                    this report. No other version was substituted.
                  </p>
                )}
              </div>
            </details>
            <button onClick={() => setDialog("metrics")} type="button">
              Customize metrics
            </button>
            <button onClick={download} type="button">
              Export CSV
            </button>
            {sourceMode === "issued" ? (
              <Link href={`/projects/${projectSlug}/baskets`}>
                Open baskets
              </Link>
            ) : (
              <button onClick={() => setDialog("basket")} type="button">
                Review next basket
              </button>
            )}
          </div>
        </header>
        <div className={styles.trust}>
          <span>
            {timedContext ? "Measurement ended" : "Data through"}{" "}
            {clarityDate(raw.cpc.dataFreshness.dataThrough)}
          </span>
          <span>Primary ROAS: verified + strong only</span>
          <span>Last eligible touch · 7 days</span>
          {timedContext && (
            <span>Reviewed contracted costs · not payments made</span>
          )}
          {sourceMode === "issued" &&
            issuedContextStatus === "metric_snapshot_only" && (
              <span>
                Retained schedule and contracted-cost detail unavailable
              </span>
            )}
          {timedContext && (
            <span>Bounded consented evidence · review coverage limits</span>
          )}
          <button onClick={() => update({ view: "evidence" })} type="button">
            Definitions & sources
          </button>
        </div>
        {(incomplete || staleAtIssue) && (
          <div role="status" className={styles.warning}>
            <strong>
              {incomplete
                ? "Some results are unavailable"
                : "Source data was delayed at issue"}
            </strong>
            <span>
              {incomplete
                ? "Missing sources remain unknown, not zero. Review the evidence gaps."
                : "This snapshot was issued more than 24 hours after its latest source data. It is not a live status."}
            </span>
            <button type="button" onClick={() => update({ view: "evidence" })}>
              Review evidence
            </button>
          </div>
        )}
        <section
          className={styles.kpis}
          aria-label="Campaign totals — creator filters affect detail only"
          style={{ "--metric-count": chosenMetrics.length } as CSSProperties}
        >
          {chosenMetrics.map((key) => (
            <Metric
              key={key}
              label={headlineMetrics[key]}
              value={headlineValues[key]}
              detail={
                key === "revenue" || key === "roas"
                  ? "Verified + strong attribution"
                  : undefined
              }
            />
          ))}
        </section>
        {creatorId !== "all" && (
          <p className={styles.filterScope}>
            Creator detail filter:{" "}
            {rows.find((row) => row.creatorId === creatorId)?.creatorName}.
            Headline totals, performance, funnel, economics and CSV remain
            campaign-wide.
          </p>
        )}
        <div className={styles.tabs} role="tablist" aria-label="Report views">
          {clarityViews.map((view, index) => (
            <button
              key={view}
              id={`tab-${view}`}
              role="tab"
              aria-selected={view === query.view}
              aria-controls="clarity-panel"
              tabIndex={view === query.view ? 0 : -1}
              onClick={() => update({ view })}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % clarityViews.length
                    : event.key === "ArrowLeft"
                      ? (index + clarityViews.length - 1) % clarityViews.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? clarityViews.length - 1
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  update({ view: clarityViews[next]! });
                  document.getElementById(`tab-${clarityViews[next]}`)?.focus();
                }
              }}
              type="button"
            >
              {labels[view]}
            </button>
          ))}
        </div>
        <div
          id="clarity-panel"
          role="tabpanel"
          aria-labelledby={`tab-${query.view}`}
          tabIndex={0}
          className={`${styles.workspace} ${query.view === "performance" ? styles.performanceWorkspace : ""}`}
        >
          {query.view === "performance" && (
            <>
              <section
                className={styles.primaryChart}
                aria-label="Performance chart"
              >
                <Panel
                  title="Wallet outcomes over time"
                  aside={
                    <div className={styles.chartControls}>
                      <select
                        aria-label="Chart measures"
                        value={query.chart}
                        onChange={(event) =>
                          update({
                            chart: event.target.value as
                              "both" | "qualified" | "activated",
                          })
                        }
                      >
                        <option value="both">Both wallet outcomes</option>
                        <option value="qualified">Qualified wallets</option>
                        <option value="activated">Activated wallets</option>
                        <option disabled>Impressions — source missing</option>
                        <option disabled>CPA / ROAS — history missing</option>
                      </select>
                      <span className={styles.badge}>
                        {context
                          ? "Daily cumulative · final day partial"
                          : "Issued versions · not daily activity"}
                      </span>
                    </div>
                  }
                >
                  <ReportSnapshotChart
                    compact
                    visibleSeries={query.chart}
                    points={points}
                    revealSignature={`${version.id}-${query.chart}`}
                  />
                </Panel>
              </section>
              <div className={styles.performance}>
                <Panel
                  title="Creator performance"
                  aside={
                    <button
                      type="button"
                      onClick={() => update({ view: "creators" })}
                    >
                      View creators & content
                    </button>
                  }
                >
                  <div className={styles.tableWrap}>
                    <table>
                      <caption className={styles.srOnly}>
                        Creator results from the selected issued snapshot
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Creator</th>
                          <th scope="col">Allocated spend</th>
                          <th scope="col">Qualified</th>
                          <th scope="col">Activated</th>
                          <th scope="col">Cost / qualified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceMode !== "reference" && rows.length === 0 && (
                          <tr>
                            <td colSpan={5}>
                              {sourceMode === "issued"
                                ? "Creator-level commercial detail was not retained for this version."
                                : "Creator breakdowns are not connected in this rehearsal."}
                            </td>
                          </tr>
                        )}
                        {rows.map((row) => (
                          <tr key={row.creatorId}>
                            <th scope="row">
                              <button
                                type="button"
                                onClick={() =>
                                  update({
                                    view: "creators",
                                    creator: row.creatorId,
                                  })
                                }
                              >
                                {row.creatorName}
                              </button>
                            </th>
                            <td>
                              {row.allocation.status === "available"
                                ? clarityMoney(
                                    row.allocation.valueMinor,
                                    currency,
                                  )
                                : "Not available"}
                            </td>
                            <td>{count(row.qualifiedWallets)}</td>
                            <td>{count(row.activatedWallets)}</td>
                            <td>
                              {clarityRate(row.cpqwMinorDecimal, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.small}>
                    {sourceMode !== "reference" && rows.length === 0
                      ? "Campaign totals above are issued results; no current creator profiles, fees or allocations are substituted."
                      : "Retained creator outcomes, not forecasts or automatic renewal recommendations."}
                  </p>
                </Panel>
                <Panel title="What the evidence says">
                  <p>
                    {leadingRow
                      ? `${leadingRow.creatorName} contributed ${count(leadingRow.qualifiedWallets)} qualified wallets in this snapshot. Review the creator's evidence and cost efficiency before selecting the next basket.`
                      : "No single leading creator can be established from the retained results. Review the creator evidence before selecting the next basket."}
                  </p>
                  <p className={styles.targetContext}>
                    {target?.valueDecimal != null
                      ? `${count(metrics.qualified)} qualified wallets / ${new Intl.NumberFormat("en-GB").format(BigInt(target.valueDecimal))} approved target. ${target.sourceLabel}.`
                      : "Approved target: not available in this issued version."}
                  </p>
                  <details className={styles.journeyDetails}>
                    <summary>Journey & benchmark detail</summary>
                    <div
                      className={styles.journeyLinks}
                      aria-label="Campaign journey detail"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          update({ view: "creators", creator: "all" })
                        }
                      >
                        <strong>{count(rows.length)} creators</strong>
                        <span>Roster & content</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ view: "economics" })}
                      >
                        <strong>{metrics.spend}</strong>
                        <span>Spend & efficiency</span>
                      </button>
                    </div>
                    <div className={styles.twoMetrics}>
                      <Metric
                        label="Qualified clicks"
                        value={count(metrics.clicks)}
                      />
                      <Metric
                        label="Activated wallets"
                        value={count(metrics.activated)}
                      />
                    </div>
                    <p>
                      {metrics.qualified === null
                        ? "Eligible wallet results are not available for this snapshot."
                        : `${count(metrics.qualified)} wallets qualified; ${count(metrics.activated)} completed the activation definition.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => update({ view: "funnel" })}
                    >
                      Explore the funnel →
                    </button>
                    <h3>Benchmarks</h3>
                    {context?.benchmarks.map((item) => (
                      <div className={styles.benchmark} key={item.id}>
                        <span>{item.label}</span>
                        <strong>
                          {item.status === "available" &&
                          item.valueDecimal !== null
                            ? new Intl.NumberFormat("en-GB").format(
                                BigInt(item.valueDecimal),
                              )
                            : "Not available"}
                        </strong>
                        <small>
                          {item.metric.replaceAll("_", " ")} ·{" "}
                          {item.sourceLabel}
                          {item.cohortSampleSize
                            ? ` · ${item.cohortSampleSize} campaigns`
                            : ""}
                        </small>
                      </div>
                    )) ?? (
                      <p>
                        No target or cohort reference was retained in this
                        version.
                      </p>
                    )}
                    <details>
                      <summary>Other benchmark coverage</summary>
                      <p>
                        Pre-campaign baseline, external benchmarks and mindshare
                        lift have no retained source in this report. No uplift
                        is inferred.
                      </p>
                    </details>
                  </details>
                </Panel>
              </div>
            </>
          )}
          {query.view === "funnel" && (
            <Panel
              title="From attention to action"
              aside={
                <button type="button" onClick={() => openEvidence()}>
                  Inspect outcome evidence
                </button>
              }
            >
              <p>
                The measured stages are shown below. Missing connected-wallet
                and retention sources stay visible as gaps.
              </p>
              <ReportFunnelChart
                qualifiedClicks={metrics.clicks}
                qualifiedWallets={metrics.qualified}
                activatedWallets={metrics.activated}
              />
              <div className={styles.gap}>
                <strong>Connected wallets · Not available</strong>
                <p>
                  A separate count of all signed, consenting wallet connections
                  was not retained. Qualified wallets are not a substitute for
                  this stage.
                </p>
              </div>
              <p className={styles.small}>
                Activation: {raw.cpa.definition}. Retention requires its own
                D7/D30 evidence; it is never inferred from activation.
              </p>
            </Panel>
          )}
          {(query.view === "creators" || query.view === "evidence") && (
            <div className={styles.filter}>
              <label>
                Creator detail
                <select
                  aria-label="Creator detail"
                  value={creatorId}
                  onChange={(event) => update({ creator: event.target.value })}
                >
                  <option value="all">All creators</option>
                  {rows.map((row) => (
                    <option key={row.creatorId} value={row.creatorId}>
                      {row.creatorName}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Filters creator/content and evidence detail only. Campaign
                totals, funnel, chart and CSV remain the complete issued
                snapshot.
              </p>
            </div>
          )}
          {query.view === "creators" && (
            <Panel
              title="Creators & their content"
              aside={
                sourceMode === "issued" ? (
                  <Link
                    className={styles.primary}
                    href={`/projects/${projectSlug}/baskets`}
                  >
                    Open Baskets
                  </Link>
                ) : (
                  <button
                    className={styles.primary}
                    type="button"
                    onClick={() => setDialog("basket")}
                  >
                    Review Selection ({selectedCreators.length})
                  </button>
                )
              }
            >
              {timedDetail && (
                <p>
                  Historical approved packages and issued creator outcomes.
                  Names, handles, imagery and publication history were not
                  retained; creator IDs identify these rows. Package labels are
                  not asset-level performance.
                </p>
              )}
              {sourceMode !== "reference" && rows.length === 0 && (
                <p>
                  {sourceMode === "issued"
                    ? "Retained creator commercial detail is unavailable for this version. Campaign totals and exact retained outcome paths remain available; no current creator profiles are substituted."
                    : "Creator breakdowns are not connected in this rehearsal. Campaign totals remain available; no demo profiles are substituted."}
                </p>
              )}
              <ClarityCreatorCanvas
                rows={shownRows}
                currency={currency}
                group={query.group}
                selected={selectedCreators}
                onGroup={(group) => update({ group })}
                onDetail={(detail) => update({ detail })}
                onSelect={toggleCreator}
                allowSelection={sourceMode !== "issued"}
              />
              <p className={styles.small}>
                {sourceMode === "issued"
                  ? "No renewal or budget change happens automatically. Open Baskets to begin a separately approved plan."
                  : "No renewal or budget change happens automatically. Select creators for a local planning review."}
              </p>
            </Panel>
          )}
          {query.view === "economics" && (
            <div className={styles.detailWorkspace}>
              <Panel title="Campaign economics">
                {timedContext && (
                  <p>
                    Reviewed contracted costs, not payments made.
                    {timedDetail
                      ? " Allocations use only the exact approved fee lines included in this issued report."
                      : " Creator-level allocations are not connected in this rehearsal."}
                  </p>
                )}
                {sourceMode === "issued" && !timedContext && (
                  <p>
                    Campaign totals use the issued metric snapshot.
                    Creator-level contracted-cost allocation is unavailable for
                    this version; no current roster or fee is substituted.
                  </p>
                )}
                <div className={styles.economics}>
                  <Metric
                    label="Revenue ROAS"
                    value={metrics.roas}
                    detail="Eligible revenue / eligible spend"
                  />
                  <Metric label="Cost per click" value={metrics.cpc} />
                  <Metric
                    label="Cost per qualified wallet"
                    value={metrics.cpqw}
                  />
                  <Metric label="Cost per activation" value={metrics.cpa} />
                </div>
                <div className={styles.economics}>
                  <Metric
                    label="Creator-allocated spend"
                    value={clarityMoney(
                      economics[version.version]?.allocatedSpendMinor ?? null,
                      currency,
                    )}
                  />
                  <Metric
                    label="Unallocated spend"
                    value={clarityMoney(
                      economics[version.version]?.unallocatedSpendMinor ?? null,
                      currency,
                    )}
                  />
                  <Metric
                    label="Indicative revenue / excluded"
                    value={clarityMoney(
                      raw.revenueRoas.excludedAttributionRevenue
                        ?.indicativeMinor ?? null,
                      currency,
                    )}
                  />
                  <Metric
                    label="Unattributed revenue / excluded"
                    value={clarityMoney(
                      raw.revenueRoas.excludedAttributionRevenue
                        ?.unattributedMinor ?? null,
                      currency,
                    )}
                  />
                </div>
              </Panel>
              <div className={styles.twoPanels}>
                <Panel title="Influenced volume">
                  <strong>Not available</strong>
                  <p>
                    A separate volume source is required. Trading activity and
                    token movements are never revenue.
                  </p>
                </Panel>
                <Panel title="Contribution & social impact">
                  <strong>Not available</strong>
                  <p>
                    No gross-profit mapping or social baseline is retained here.
                    Contribution ROAS and mindshare lift cannot be calculated.
                  </p>
                </Panel>
              </div>
            </div>
          )}
          {query.view === "evidence" && (
            <div className={styles.detailWorkspace}>
              <Panel
                title="Definitions & evidence"
                aside={
                  <button type="button" onClick={() => openEvidence()}>
                    Open evidence paths ({paths.length})
                  </button>
                }
              >
                {timedContext && (
                  <section aria-label="Approved periods and coverage">
                    <p>
                      <strong>Approved flight:</strong>{" "}
                      {clarityDate(timedContext.approvedFlight.startedAt)} to{" "}
                      {clarityDate(timedContext.approvedFlight.endedAt)}.
                    </p>
                    <p>
                      <strong>Measurement:</strong>{" "}
                      {clarityDate(timedContext.measurementWindow.startedAt)} to{" "}
                      {clarityDate(timedContext.measurementWindow.endedAt)}.
                      Evidence checked{" "}
                      {clarityDate(timedContext.coverage.checkedAt)}.
                    </p>
                    <p>
                      <strong>Cost basis:</strong> Reviewed contracted costs (
                      {timedContext.costPolicy.currencyCode}), not payments
                      made. No currency conversion or non-cash valuation.
                    </p>
                    <p>
                      <strong>Coverage:</strong> Retained consented history
                      only. Provider exhaustion has not been independently
                      verified.
                    </p>
                    <p>
                      <strong>Not available:</strong> Activation, protocol
                      revenue and impressions. Missing values are not zero.
                    </p>
                    <p>
                      {timedDetail
                        ? "Creator costs and transaction paths are bound to this issued report. Creator IDs and approved package labels are shown; historical profiles and asset publication details were not retained."
                        : "Creator and transaction breakdowns are not connected in this rehearsal. No demo roster or allocation is substituted."}
                    </p>
                    {timedDetail && (
                      <details>
                        <summary>Reviewed cost decisions</summary>
                        <p>
                          Additional costs:{" "}
                          {timedDetail.additionalCosts === "unknown"
                            ? "Unknown; total cost remains unavailable."
                            : "None declared in this review."}
                        </p>
                        <ul>
                          {timedDetail.costLines.map((line) => (
                            <li key={line.compensationLineId}>
                              {
                                timedDetail.packages.find(
                                  (pkg) => pkg.id === line.packageId,
                                )?.packageLabel
                              }{" "}
                              · {line.inclusion} — {line.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                )}
                {sourceMode === "issued" && !timedContext && (
                  <section aria-label="Retained report context availability">
                    <p>
                      <strong>Issued metric snapshot:</strong> Available and
                      fixed to V{version.version}.
                    </p>
                    <p>
                      <strong>Observation context:</strong>{" "}
                      {issuedContextStatus === "measurement"
                        ? "Retained in this issued version."
                        : "Not retained for this issued version."}
                    </p>
                    <p>
                      <strong>Schedule and contracted-cost detail:</strong> Not
                      retained for this issued version. Missing values are not
                      zero, and current campaign records are not substituted.
                    </p>
                  </section>
                )}
                <p>
                  <strong>Can I trust these numbers?</strong> This view explains
                  what was measured, what is missing and which fixed report
                  version you are viewing. It is not a live connection-health
                  monitor.
                </p>
                <p>
                  {timedContext ? "Approved measurement ended" : "Data through"}{" "}
                  {clarityDate(raw.cpc.dataFreshness.dataThrough)}. Primary ROAS
                  includes verified and strong attribution only. Missing inputs
                  remain unavailable rather than becoming zero.
                </p>
                <p>
                  Connected-wallet coverage, retention, influenced volume and
                  contribution data are only shown where their own sources were
                  retained. Detailed paths below explain observed outcomes;
                  report history shows changes between issued snapshots.
                </p>
                <div className={styles.definitionGrid}>
                  {[raw.cpc, raw.cpqw, raw.cpa, raw.revenueRoas].map(
                    (metric) => (
                      <article key={metric.metric}>
                        <h3>{metric.metric.toUpperCase()}</h3>
                        <p>{metric.definition}</p>
                        <small>
                          {metric.status === "not_available"
                            ? metric.reason.replaceAll("_", " ")
                            : "Retained calculation available"}
                        </small>
                      </article>
                    ),
                  )}
                </div>
                <details>
                  <summary>Exact calculation sources & identifiers</summary>
                  <p>
                    {version.metricSnapshotSha256
                      ? `Snapshot ${version.metricSnapshotSha256} · `
                      : ""}
                    Calculation V{version.metricSnapshot.calculationVersion}.
                    Protected wallet mappings are not included.
                  </p>
                  <pre>{JSON.stringify(version.metricSnapshot, null, 2)}</pre>
                </details>
              </Panel>
              <Panel title="Issued history">
                <p>
                  These are versions of this campaign’s report, not different
                  campaigns or forecast scenarios.
                </p>
                <div className={styles.tableWrap}>
                  <table>
                    <caption className={styles.srOnly}>
                      Issued report history
                    </caption>
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Issued</th>
                        <th>Qualified</th>
                        <th>Activated</th>
                        <th>Primary revenue</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fixture.report.versions.map((item) => {
                        const m = clarityMetrics(item);
                        return (
                          <tr key={item.id}>
                            <th>V{item.version}</th>
                            <td>{clarityDate(item.issuedAt)}</td>
                            <td>{count(m.qualified)}</td>
                            <td>{count(m.activated)}</td>
                            <td>{m.revenue}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() =>
                                  update({ version: item.version })
                                }
                                disabled={version.version === item.version}
                              >
                                {version.version === item.version
                                  ? "Selected"
                                  : `Open V${item.version}`}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
          {query.compare !== null && previous && oldMetrics && (
            <Panel
              title={`Same-campaign comparison: V${version.version} and V${previous.version}`}
            >
              <p>
                Source windows and issued evidence differ. This is snapshot
                movement, not a causal lift claim or like-for-like campaign
                benchmark.
              </p>
              <div className={styles.tableWrap}>
                <table>
                  <caption className={styles.srOnly}>
                    Selected and comparison versions
                  </caption>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th>Selected V{version.version}</th>
                      <th>Comparison V{previous.version}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Spend", metrics.spend, oldMetrics.spend],
                      [
                        "Qualified wallets",
                        count(metrics.qualified),
                        count(oldMetrics.qualified),
                      ],
                      [
                        "Activated wallets",
                        count(metrics.activated),
                        count(oldMetrics.activated),
                      ],
                      ["Primary revenue", metrics.revenue, oldMetrics.revenue],
                    ].map(([label, current, old]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{current}</td>
                        <td>{old}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small>
                Comparison issued {clarityDate(previous.issuedAt)}. Data through{" "}
                {clarityDate(
                  previous.metricSnapshot.metrics.cpc.dataFreshness.dataThrough,
                )}
                .
              </small>
            </Panel>
          )}
        </div>
        <p role="status" className={styles.notice}>
          {notice}
        </p>
        <footer className={styles.footer}>
          {sourceMode === "reference"
            ? "BRD-02 · Clarity reference"
            : sourceMode === "isolated-issued"
              ? "Isolated retained report · no runtime approval or live-chain claim"
              : "Issued immutable report · read-only"}{" "}
          · Newake/Ade font files pending; system type fallback
        </footer>
      </AppShell>
      {dialog === "metrics" && (
        <Modal title="Customize report metrics" onClose={() => setDialog(null)}>
          <ClarityMetricPicker
            value={query.metrics}
            onChange={(metrics) => update({ metrics })}
          />
        </Modal>
      )}
      {query.view === "creators" && detailRow && !dialog && (
        <Modal
          title={`${detailRow.creatorName} — retained detail`}
          onClose={() => update({ detail: "" })}
        >
          <ClarityCreatorTerms
            row={detailRow}
            currency={currency}
            onEvidence={() => {
              openEvidence("", {
                creator: detailRow.creatorId,
                detail: "",
              });
            }}
          />
        </Modal>
      )}
      {dialog === "evidence" && (
        <Modal title={`Evidence / V${version.version}`} onClose={closeEvidence}>
          <p>
            {creatorId === "all"
              ? "All creators"
              : rows.find((row) => row.creatorId === creatorId)
                  ?.creatorName}{" "}
            · {paths.length} metric paths. An attribution fact may appear under
            more than one metric; this is not a unique-wallet count.
          </p>
          <p>
            Evidence provenance: {evidenceProvenance.replace("_", " ")}.
            {evidenceProvenance === "synthetic" &&
              " Wallet signatures and consent are simulated."}
            {evidenceProvenance === "unknown" &&
              " Exact outcome provenance is unavailable; no mainnet claim is made."}
          </p>
          {paths.length === 0 ? (
            <p role="status">
              {sourceMode === "isolated-issued"
                ? "Transaction breakdowns are not connected in this rehearsal."
                : "No exact outcome paths are retained for this version and filter."}{" "}
              No path is borrowed from another version.
            </p>
          ) : (
            paths.map((path) => (
              <EvidencePath
                key={`${path.metric}-${path.attributionFactId}`}
                path={path}
              />
            ))
          )}
        </Modal>
      )}
      {dialog === "basket" && (
        <Modal title="Review your next basket" onClose={() => setDialog(null)}>
          <p>
            This is a local selection preview. It does not create a basket,
            change spend or send offers.
          </p>
          {selectedCreators.length === 0 ? (
            <p>
              Select creators in Creators & content to review a proposed roster.
            </p>
          ) : (
            <ul>
              {rows
                .filter((row) => selectedCreators.includes(row.creatorId))
                .map((row) => (
                  <li key={row.creatorId}>
                    {row.creatorName} · {row.package.packageLabel}
                  </li>
                ))}
            </ul>
          )}
          <div className={styles.gap}>
            <strong>Commercial review still required</strong>
            <p>
              New deliverables, dates, rights and compensation must be agreed
              and approved in the basket workflow. Historical spend is not a new
              quote.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setDialog(null);
              update({ view: "creators" });
            }}
          >
            Choose creators
          </button>
        </Modal>
      )}
    </div>
  );
}

function EvidencePath({ path }: { path: ProjectReportEvidencePath }) {
  const [copied, setCopied] = useState("");
  return (
    <details className={styles.path}>
      <summary>
        {path.creatorName} · {path.metric.replaceAll("_", " ")} ·{" "}
        {path.confidence}
      </summary>
      <p>{path.contentAssetLabel}</p>
      <dl>
        <dt>Revenue eligibility</dt>
        <dd>
          {path.primaryRoasEligible
            ? "Primary eligible"
            : "Excluded from primary ROAS"}
        </dd>
        <dt>Touch</dt>
        <dd>
          {clarityDate(path.touchTime)} · {path.clickQuality}
        </dd>
        <dt>Wallet proof</dt>
        <dd>{path.walletProofState.replaceAll("_", " ")}</dd>
        <dt>Conversion</dt>
        <dd>
          {path.conversionRuleName} · rule V{path.conversionRuleVersion}
        </dd>
        <dt>Source environment</dt>
        <dd>
          {path.environment} · {path.finality}
        </dd>
        <dt>Revenue mapping</dt>
        <dd>Not retained in this path. Token transfer value is not revenue.</dd>
      </dl>
      <details>
        <summary>Technical evidence</summary>
        <pre>{JSON.stringify(path, null, 2)}</pre>
      </details>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(path.transactionSignature);
            setCopied("Signature copied");
          } catch {
            setCopied(
              "Copy unavailable. Select the signature in technical evidence.",
            );
          }
        }}
      >
        Copy transaction signature
      </button>
      <p role="status">{copied}</p>
    </details>
  );
}
