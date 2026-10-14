"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  ReportingStudioCreator,
  ReportingStudioViewModel,
} from "@/lib/reports/studio-view-model";
import { ReportSnapshotChart } from "./report-snapshot-chart";
import styles from "./reporting-studio-reference.module.css";

type StudioTheme = "system" | "light" | "dark";
export type StudioView = "overview" | "creators" | "economics" | "evidence";
type StudioState =
  "ready" | "partial" | "stale" | "loading" | "empty" | "error" | "permission";

const viewLabels: Array<{ id: StudioView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "creators", label: "Creators" },
  { id: "economics", label: "Economics" },
  { id: "evidence", label: "Evidence" },
];

function useResolvedTheme(initialTheme: StudioTheme) {
  const [theme, setTheme] = useState<StudioTheme>(initialTheme);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function updateTheme(nextTheme: StudioTheme) {
    setTheme(nextTheme);
    window.localStorage.setItem("landed_studio_theme", nextTheme);
    const url = new URL(window.location.href);
    url.searchParams.set("theme", nextTheme);
    window.history.replaceState(null, "", url);
  }

  return {
    resolvedTheme: theme === "system" ? systemTheme : theme,
    setTheme: updateTheme,
    theme,
  };
}

function Icon({ name }: { name: "arrow" | "chart" | "close" | "spark" }) {
  if (name === "close") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  if (name === "spark") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z" />
      </svg>
    );
  }
  if (name === "chart") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}

function ThemeControl({
  onChange,
  value,
}: {
  onChange: (theme: StudioTheme) => void;
  value: StudioTheme;
}) {
  return (
    <fieldset className={styles.themeControl}>
      <legend className={styles.visuallyHidden}>Colour theme</legend>
      {(["system", "light", "dark"] as const).map((theme) => (
        <button
          aria-pressed={value === theme}
          className={value === theme ? styles.isActive : undefined}
          key={theme}
          onClick={() => onChange(theme)}
          type="button"
        >
          {theme[0]!.toUpperCase() + theme.slice(1)}
        </button>
      ))}
    </fieldset>
  );
}

function Rail() {
  return (
    <aside className={styles.rail}>
      <Link
        className={styles.wordmark}
        href="/visual-tests/reporting-studio/ready"
      >
        LANDED<span>/</span>OS
      </Link>
      <div className={styles.projectIdentity}>
        <span>Active project</span>
        <strong>Helios</strong>
        <small>Solana consumer</small>
      </div>
      <nav aria-label="Product sections" className={styles.primaryNav}>
        {[
          ["01", "Overview"],
          ["02", "Creators"],
          ["03", "Baskets"],
          ["04", "Campaigns"],
          ["05", "Reports"],
        ].map(([index, label]) => (
          <span
            className={label === "Reports" ? styles.isCurrent : undefined}
            key={label}
          >
            <small>{index}</small>
            {label}
          </span>
        ))}
      </nav>
      <div className={styles.railMeta}>
        <span className={styles.healthDot}>Evidence healthy</span>
        <small>Updated 5 min ago</small>
      </div>
    </aside>
  );
}

function StateBoundary({
  state,
  themeControl,
}: {
  state: Extract<StudioState, "loading" | "empty" | "error" | "permission">;
  themeControl: ReactNode;
}) {
  const content = {
    loading: {
      eyebrow: "Preparing the latest evidence",
      title: "Building your campaign view…",
      body: "We are assembling issued metrics, creator evidence and approved commercial terms. Nothing is inferred while sources load.",
    },
    empty: {
      eyebrow: "No campaign report yet",
      title: "Your live dashboard starts with a campaign.",
      body: "Create the first campaign to connect objectives, creators, budgets and measurement into one operating view.",
    },
    error: {
      eyebrow: "Report temporarily unavailable",
      title: "We could not refresh this view.",
      body: "The last issued report remains unchanged. Retry the protected read; no evidence or commercial decision has been altered.",
    },
    permission: {
      eyebrow: "Access required",
      title: "This report is outside your current role.",
      body: "Ask a workspace owner for reporting access. Campaign evidence and creator terms remain protected.",
    },
  }[state];

  return (
    <div className={styles.stateShell}>
      <Rail />
      <main className={styles.stateMain} id="main-content">
        <div className={styles.stateTopbar}>{themeControl}</div>
        <section
          aria-busy={state === "loading"}
          aria-live="polite"
          className={styles.stateCard}
        >
          <span className={styles.stateMark}>
            <Icon name={state === "loading" ? "spark" : "chart"} />
          </span>
          <p>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <span>{content.body}</span>
          {state === "loading" ? (
            <div aria-hidden="true" className={styles.loadingBars}>
              <i />
              <i />
              <i />
            </div>
          ) : state === "error" ? (
            <Link
              className={styles.primaryButton}
              href="/visual-tests/reporting-studio/ready"
            >
              Retry report <Icon name="arrow" />
            </Link>
          ) : state === "empty" ? (
            <button className={styles.primaryButton} type="button">
              Start first campaign <Icon name="arrow" />
            </button>
          ) : (
            <button className={styles.secondaryButton} type="button">
              Request access
            </button>
          )}
        </section>
      </main>
    </div>
  );
}

function CreatorRow({
  creator,
  onOpen,
}: {
  creator: ReportingStudioCreator;
  onOpen: (creator: ReportingStudioCreator) => void;
}) {
  return (
    <button
      className={styles.creatorRow}
      onClick={() => onOpen(creator)}
      type="button"
    >
      <span className={styles.avatar}>
        {creator.thumbnailUrl ? (
          <Image
            alt=""
            fill
            sizes="48px"
            src={creator.thumbnailUrl}
            unoptimized
          />
        ) : (
          creator.name
            .split(/\s|\//)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
        )}
      </span>
      <span className={styles.creatorIdentity}>
        <strong>{creator.name}</strong>
        <small>{creator.handle ?? "Handle unavailable"}</small>
      </span>
      <span>
        <small>Spend</small>
        <strong>{creator.spend}</strong>
      </span>
      <span>
        <small>Qualified</small>
        <strong>{creator.qualifiedWallets ?? "—"}</strong>
      </span>
      <span>
        <small>Activated</small>
        <strong>{creator.activatedWallets ?? "—"}</strong>
      </span>
      <span
        className={styles.creatorAction}
        data-action={creator.action.toLowerCase()}
      >
        {creator.action}
      </span>
      <Icon name="arrow" />
    </button>
  );
}

function DetailDrawer({
  creator,
  mode,
  onClose,
}: {
  creator: ReportingStudioCreator | null;
  mode: "creator" | "evidence" | "basket";
  onClose: () => void;
}) {
  const title =
    mode === "creator"
      ? (creator?.name ?? "Creator detail")
      : mode === "basket"
        ? "Next basket preview"
        : "Why this result is trusted";

  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <aside
        aria-label={title}
        aria-modal="true"
        className={styles.drawer}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>
              {mode === "creator"
                ? "Creator decision"
                : mode === "basket"
                  ? "Planning preview"
                  : "Evidence path"}
            </span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close panel" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        {mode === "creator" && creator ? (
          <div className={styles.drawerContent}>
            <p className={styles.drawerLead}>
              {creator.activatedWallets ?? "No"} activations from{" "}
              {creator.qualifiedWallets ?? "unavailable"} qualified wallets. The
              current recommendation is to {creator.action.toLowerCase()} this
              partnership.
            </p>
            <dl className={styles.drawerFacts}>
              <div>
                <dt>Approved terms</dt>
                <dd>{creator.spend}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{creator.confidence}</dd>
              </div>
              <div>
                <dt>Package</dt>
                <dd>{creator.packageLabel}</dd>
              </div>
              <div>
                <dt>Deliverable</dt>
                <dd>{creator.deliverable}</dd>
              </div>
            </dl>
            <section className={styles.callout}>
              <Icon name="spark" />
              <div>
                <strong>Landed recommendation</strong>
                <p>
                  Keep the winning message, refresh the opening creative and
                  test a second creator with similar audience intent.
                </p>
              </div>
            </section>
            <button className={styles.primaryButton} type="button">
              Add to next basket <Icon name="arrow" />
            </button>
          </div>
        ) : mode === "basket" ? (
          <div className={styles.drawerContent}>
            <p className={styles.drawerLead}>
              A proposed follow-on roster built from observed outcomes. This
              reference does not save or approve commercial terms.
            </p>
            {[
              ["DeFi After Dark", "Retain + extend usage", "£3,200"],
              ["Maya / Chain Mode", "Retain + new creative", "£2,000"],
              ["New creator slot", "Audience-match shortlist", "£1,500 cap"],
            ].map(([name, action, value]) => (
              <div className={styles.basketRow} key={name}>
                <div>
                  <strong>{name}</strong>
                  <span>{action}</span>
                </div>
                <b>{value}</b>
              </div>
            ))}
            <section className={styles.prototypeNotice}>
              <strong>Reference preview only</strong>
              <p>
                No basket, contract or spend is created from this visual
                fixture. Production keeps human approval at the commercial
                boundary.
              </p>
            </section>
          </div>
        ) : (
          <div className={styles.drawerContent}>
            <p className={styles.drawerLead}>
              Every headline result links back to retained attribution,
              conversion and transaction evidence.
            </p>
            {[
              ["1", "Eligible creator touch", "Last eligible touch / 7 days"],
              ["2", "Wallet proof", "Signed nonce + explicit consent"],
              ["3", "Conversion rule", "First qualifying transaction / V01"],
              ["4", "Solana evidence", "Finalized demo transaction"],
            ].map(([number, label, detail]) => (
              <div className={styles.evidenceStep} key={number}>
                <span>{number}</span>
                <div>
                  <strong>{label}</strong>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
            <section className={styles.prototypeNotice}>
              <strong>Immutable report V06</strong>
              <p>
                Unknown evidence remains unknown. Indicative and unattributed
                revenue is excluded from the primary result.
              </p>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function OverviewPanel({
  model,
  onCreatorOpen,
}: {
  model: ReportingStudioViewModel;
  onCreatorOpen: (creator: ReportingStudioCreator) => void;
}) {
  return (
    <div className={styles.dashboardGrid}>
      <section className={styles.chartPanel}>
        <header className={styles.panelHeader}>
          <div>
            <span>Performance movement</span>
            <h2>
              {model.chartPoints.length > 1
                ? "Qualified attention is converting."
                : "Movement awaits eligible evidence."}
            </h2>
          </div>
          <div className={styles.legend}>
            <span>Qualified</span>
            <span>Activated</span>
          </div>
        </header>
        {model.chartPoints.length > 1 ? (
          <ReportSnapshotChart
            points={model.chartPoints}
            revealSignature={`studio-${model.version}`}
          />
        ) : (
          <div className={styles.chartEmpty}>
            A second observation is needed before movement can be shown.
          </div>
        )}
      </section>
      <section className={styles.creatorPanel}>
        <header className={styles.panelHeader}>
          <div>
            <span>Creator decisions</span>
            <h2>Where to invest next.</h2>
          </div>
          <button type="button">View all</button>
        </header>
        <div className={styles.creatorList}>
          {model.creators.map((creator) => (
            <CreatorRow
              creator={creator}
              key={creator.creatorId}
              onOpen={onCreatorOpen}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AlternatePanel({
  model,
  view,
  onCreatorOpen,
  onEvidenceOpen,
}: {
  model: ReportingStudioViewModel;
  view: Exclude<StudioView, "overview">;
  onCreatorOpen: (creator: ReportingStudioCreator) => void;
  onEvidenceOpen: () => void;
}) {
  if (view === "creators") {
    return (
      <section className={styles.fullPanel}>
        <header className={styles.panelHeader}>
          <div>
            <span>Creator comparison</span>
            <h2>Outcome, cost and confidence together.</h2>
          </div>
        </header>
        <div className={styles.creatorList}>
          {model.creators.map((creator) => (
            <CreatorRow
              creator={creator}
              key={creator.creatorId}
              onOpen={onCreatorOpen}
            />
          ))}
        </div>
      </section>
    );
  }
  if (view === "economics") {
    return (
      <section className={styles.economicsPanel}>
        <div>
          <span>Campaign economics</span>
          <strong>{model.primaryMetrics[2]!.value}</strong>
          <p>Eligible revenue</p>
        </div>
        <div>
          <span>Approved investment</span>
          <strong>{model.supportingMetrics[0]!.value}</strong>
          <p>Creator compensation</p>
        </div>
        <div className={styles.economicsOutcome}>
          <span>Primary return</span>
          <strong>{model.primaryMetrics[3]!.value}</strong>
          <p>Verified + strong attribution only</p>
        </div>
        <aside>
          <Icon name="spark" />
          <div>
            <strong>Next decision</strong>
            <p>
              Extend the top partnership and reserve a controlled test budget
              for one audience-matched creator.
            </p>
          </div>
        </aside>
      </section>
    );
  }
  return (
    <section className={styles.fullPanel}>
      <header className={styles.panelHeader}>
        <div>
          <span>Evidence and versions</span>
          <h2>Technical depth, available on demand.</h2>
        </div>
        <button onClick={onEvidenceOpen} type="button">
          Open evidence path
        </button>
      </header>
      <div className={styles.evidenceOverview}>
        <div>
          <span>Issued report</span>
          <strong>V{String(model.version).padStart(2, "0")}</strong>
          <p>{model.issuedAt}</p>
        </div>
        <div>
          <span>Attribution</span>
          <strong>Last eligible touch</strong>
          <p>Seven-day window</p>
        </div>
        <div>
          <span>Confidence</span>
          <strong>Verified + strong</strong>
          <p>Primary ROAS inclusion</p>
        </div>
        <div>
          <span>Data through</span>
          <strong>{model.dataThrough}</strong>
          <p>Freshness is always visible</p>
        </div>
      </div>
    </section>
  );
}

export function ReportingStudioReference({
  initialView,
  initialTheme,
  model,
  state,
}: {
  initialView: StudioView;
  initialTheme: StudioTheme;
  model: ReportingStudioViewModel | null;
  state: StudioState;
}) {
  const { resolvedTheme, setTheme, theme } = useResolvedTheme(initialTheme);
  const [view, setView] = useState<StudioView>(initialView);
  const [drawer, setDrawer] = useState<
    "creator" | "evidence" | "basket" | null
  >(null);
  const [selectedCreator, setSelectedCreator] =
    useState<ReportingStudioCreator | null>(null);
  const themeControl = <ThemeControl onChange={setTheme} value={theme} />;
  const isBoundary =
    state === "loading" ||
    state === "empty" ||
    state === "error" ||
    state === "permission";

  const stateLabel = useMemo(() => {
    if (state === "partial") return "Evidence incomplete";
    if (state === "stale") return "Update delayed";
    return "Evidence verified";
  }, [state]);

  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute(
      "content",
      resolvedTheme === "dark" ? "#111315" : "#f2f3f5",
    );
  }, [resolvedTheme]);

  useEffect(() => {
    if (!drawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawer]);

  if (isBoundary) {
    return (
      <div className={styles.studioRoot} data-theme={resolvedTheme}>
        <a className={styles.skipLink} href="#main-content">
          Skip to report
        </a>
        <StateBoundary state={state} themeControl={themeControl} />
      </div>
    );
  }
  if (!model) return null;

  function openCreator(creator: ReportingStudioCreator) {
    setSelectedCreator(creator);
    setDrawer("creator");
    const url = new URL(window.location.href);
    url.searchParams.set("panel", "creator");
    window.history.replaceState(null, "", url);
  }

  function updateView(nextView: StudioView) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.replaceState(null, "", url);
  }

  function openDrawer(nextDrawer: "evidence" | "basket") {
    setDrawer(nextDrawer);
    const url = new URL(window.location.href);
    url.searchParams.set("panel", nextDrawer);
    window.history.replaceState(null, "", url);
  }

  function closeDrawer() {
    setDrawer(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("panel");
    window.history.replaceState(null, "", url);
  }

  return (
    <div className={styles.studioRoot} data-theme={resolvedTheme}>
      <a className={styles.skipLink} href="#main-content">
        Skip to report
      </a>
      <div className={styles.shell} inert={drawer ? true : undefined}>
        <Rail />
        <main className={styles.workspace} id="main-content">
          <header className={styles.topbar}>
            <div>
              <span>Reports</span>
              <i>/</i>
              <strong>{model.campaignName}</strong>
            </div>
            <div className={styles.topbarTools}>
              <button className={styles.filterButton} type="button">
                All creators
              </button>
              <button className={styles.filterButton} type="button">
                {model.sourceWindow}
              </button>
              {themeControl}
            </div>
          </header>

          <div className={styles.content}>
            <section className={styles.decisionBand}>
              <div>
                <div className={styles.statusLine}>
                  <span
                    className={
                      state === "ready" ? styles.isVerified : styles.isWarning
                    }
                  >
                    {stateLabel}
                  </span>
                  <span>
                    Report V{String(model.version).padStart(2, "0")} · issued{" "}
                    {model.issuedAt}
                  </span>
                </div>
                <h1>{model.decision}</h1>
                <p>{model.evidenceSummary}</p>
              </div>
              <div className={styles.decisionActions}>
                <button
                  className={styles.primaryButton}
                  onClick={() => openDrawer("basket")}
                  type="button"
                >
                  Preview next basket <Icon name="arrow" />
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => openDrawer("evidence")}
                  type="button"
                >
                  Explain this result
                </button>
              </div>
            </section>

            {state === "partial" || state === "stale" ? (
              <section className={styles.notice} role="status">
                <Icon name="spark" />
                <div>
                  <strong>
                    {state === "partial"
                      ? "One or more sources are not connected."
                      : "The latest provider update is delayed."}
                  </strong>
                  <p>
                    {state === "partial"
                      ? "Unavailable metrics remain unavailable; Landed has not substituted zero."
                      : "The issued result is still immutable. Freshness is shown so the operator can judge the decision safely."}
                  </p>
                </div>
                <button type="button">Review source</button>
              </section>
            ) : null}

            <section
              aria-label="Campaign outcomes"
              className={styles.metricsArea}
            >
              <div className={styles.primaryMetrics}>
                {model.primaryMetrics.map((metric) => (
                  <button
                    className={styles.metric}
                    data-status={metric.status}
                    key={metric.label}
                    onClick={() => openDrawer("evidence")}
                    type="button"
                  >
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.delta}</small>
                  </button>
                ))}
              </div>
              <div className={styles.supportingMetrics}>
                {model.supportingMetrics.map((metric) => (
                  <div key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </div>
                ))}
              </div>
            </section>

            <nav aria-label="Report views" className={styles.viewTabs}>
              {viewLabels.map((item) => (
                <button
                  aria-current={view === item.id ? "page" : undefined}
                  key={item.id}
                  onClick={() => updateView(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className={styles.viewContent}>
              {view === "overview" ? (
                <OverviewPanel model={model} onCreatorOpen={openCreator} />
              ) : (
                <AlternatePanel
                  model={model}
                  onCreatorOpen={openCreator}
                  onEvidenceOpen={() => openDrawer("evidence")}
                  view={view}
                />
              )}
            </div>
          </div>
        </main>
      </div>
      {drawer ? (
        <DetailDrawer
          creator={selectedCreator}
          mode={drawer}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}
