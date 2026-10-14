"use client";

import {
  useCallback,
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { PlanDrawer } from "./plan-drawer";
import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / BSK-09 / UI-03 · campaign plan page frame (journey board 02a).
 * One page with a page top, one primary action and setup dialogs. Every overlay
 * panel stays mounted, so moving between steps never saves, discards or
 * approves anything. Hash links from existing editors open the matching step.
 */

export type BasketNextAction = {
  status: string;
  title: string;
  detail: string;
  label: string;
  href: string;
};

export type PlanPanelId =
  | "purpose"
  | "measurement"
  | "target"
  | "dates"
  | "terms"
  | "review"
  | "compare";

/** Portalled review content stays mounted but only loads when opened. */
export const PlanReviewVisibleContext = createContext(false);

export type OpenPlanPanel = (panel: PlanPanelId, hash?: string) => void;

export type PlanSaveConfirmation = {
  id: number;
  panel: PlanPanelId;
  message: string;
};

export type PlanPanel = {
  id: PlanPanelId;
  eyebrow: string;
  title: string;
  description?: string;
  content: ReactNode;
  footerAction?: ReactNode;
  /** Also shown for these steps (one mounted editor serving two steps). */
  alsoFor?: PlanPanelId[];
};

const panelIds: PlanPanelId[] = [
  "purpose",
  "measurement",
  "target",
  "dates",
  "terms",
  "review",
  "compare",
];

/** Maps an in-page hash used by existing editors to the step that shows it. */
export function planPanelForHash(hash: string): PlanPanelId | null {
  if (hash === "#basket-strategy") return "purpose";
  if (hash === "#basket-measurement") return "measurement";
  if (hash === "#basket-outcome") return "target";
  if (hash === "#basket-timing") return "dates";
  if (hash.startsWith("#basket-package-") || hash.startsWith("#package-terms-"))
    return "terms";
  if (hash === "#basket-plan-review" || hash === "#commercial-approval")
    return "review";
  if (hash === "#basket-compare") return "compare";
  return null;
}

export function planPanelFromUrl(url: URL): PlanPanelId | null {
  return (
    planPanelForHash(url.hash) ??
    panelIds.find((id) => id === url.searchParams.get("step")) ??
    null
  );
}

export function BasketWorkspace({
  name,
  statusLabel = "Draft · not approved",
  statusTone = "draft",
  purpose,
  backHref,
  heroLabel,
  heroHref,
  heroDisabled = false,
  onHero,
  heroNote,
  panels = [],
  onOpenPanel,
  nextAction,
  children,
  theme = "light",
  readOnly = false,
  footerAction,
  saveConfirmation,
}: {
  /** Kept for existing callers; the page frame no longer depends on it. */
  enabled?: boolean;
  localCommercialEnabled?: boolean;
  scenario?: string;
  commitment?: string;
  count?: number;
  onNextAction?: () => void;
  name: string;
  statusLabel?: string;
  statusTone?: "draft" | "approved" | "historical";
  purpose?: string;
  backHref?: string;
  heroLabel?: string;
  /** A navigation hero (e.g. continue to an approved plan's campaign). */
  heroHref?: string;
  heroDisabled?: boolean;
  onHero?: (open: OpenPlanPanel) => void;
  heroNote?: ReactNode | ((open: OpenPlanPanel) => ReactNode);
  panels?: PlanPanel[];
  onOpenPanel?: (panel: PlanPanelId, hash: string) => void;
  nextAction?: BasketNextAction;
  /** The shell theme; the plan reads correctly in light and dark. */
  theme?: "light" | "dark";
  readOnly?: boolean;
  footerAction?: ReactNode;
  saveConfirmation?: PlanSaveConfirmation;
  children:
    | ReactNode
    | ((open: OpenPlanPanel, openPanel: PlanPanelId | null) => ReactNode);
}) {
  // One state record drives the drawer; URL, focus and callbacks follow it in
  // effects, so render never reads refs.
  const [view, setView] = useState<{
    panel: PlanPanelId | null;
    hash: string;
    opener: HTMLElement | null;
    source: "user" | "history";
    seq: number;
  }>({ panel: null, hash: "", opener: null, source: "history", seq: 0 });
  const openPanel = view.panel;
  const root = useRef<HTMLDivElement>(null);
  const submittedView = useRef<{ panel: PlanPanelId; seq: number } | null>(
    null,
  );
  const handledSave = useRef<number | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const knownKey = panels
    .flatMap(({ id, alsoFor = [] }) => [id, ...alsoFor])
    .join(",");
  const known = useMemo(
    () => new Set(knownKey.split(",").filter(Boolean) as PlanPanelId[]),
    [knownKey],
  );
  const notify = useRef(onOpenPanel);
  useEffect(() => {
    notify.current = onOpenPanel;
  }, [onOpenPanel]);

  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      const panel = planPanelFromUrl(url);
      setView((current) => ({
        panel: panel && known.has(panel) ? panel : null,
        hash: panel && known.has(panel) ? url.hash : "",
        opener: current.opener,
        source: "history",
        seq: current.seq + 1,
      }));
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [known]);

  useEffect(() => {
    if (view.seq === 0) return;
    if (view.panel) notify.current?.(view.panel, view.hash);
    if (view.source === "user") {
      const url = new URL(window.location.href);
      if (view.panel) url.searchParams.set("step", view.panel);
      else url.searchParams.delete("step");
      url.hash = view.panel ? view.hash : "";
      if (url.href !== window.location.href)
        window.history.pushState(null, "", url);
    }
    const frame = requestAnimationFrame(() => {
      const id = view.hash.replace(/^#/, "");
      if (view.panel) {
        const target = id ? document.getElementById(id) : null;
        if (
          target &&
          root.current?.contains(target) &&
          target.offsetParent !== null
        ) {
          target.focus({ preventScroll: true });
          target.scrollIntoView?.({ block: "nearest" });
        }
      } else if (id) {
        document.getElementById(id)?.focus();
      } else if (view.source === "user" || view.opener) {
        if (view.opener?.isConnected) view.opener.focus();
        else document.getElementById("plan-steps")?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  const open = useCallback<OpenPlanPanel>(
    (panel, hash = "") => {
      if (!known.has(panel)) return;
      const focused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setView((current) => ({
        panel,
        hash,
        // Keep the original opener when moving between steps in the drawer.
        opener: current.panel ? current.opener : focused,
        source: "user",
        seq: current.seq + 1,
      }));
    },
    [known],
  );

  const close = useCallback(() => {
    setView((current) => ({
      panel: null,
      hash: "",
      opener: current.opener,
      source: "user",
      seq: current.seq + 1,
    }));
  }, []);

  useEffect(() => {
    if (!saveConfirmation || handledSave.current === saveConfirmation.id)
      return;
    handledSave.current = saveConfirmation.id;
    const submitted = submittedView.current;
    submittedView.current = null;
    setSavedMessage(saveConfirmation.message);
    // A confirmed save must not close a different/reopened window.
    if (submitted?.panel !== saveConfirmation.panel) return;
    setView((current) =>
      current.panel === submitted.panel && current.seq === submitted.seq
        ? {
            ...current,
            panel: null,
            hash: "",
            source: "user",
            seq: current.seq + 1,
          }
        : current,
    );
  }, [saveConfirmation]);

  function capture(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as HTMLElement).closest("a");
    const hash = anchor?.getAttribute("href") ?? "";
    if (!hash.startsWith("#")) return;
    const panel = planPanelForHash(hash);
    if (panel && known.has(panel)) {
      event.preventDefault();
      open(panel, hash);
    } else if (hash === "#basket-roster" || hash === "#plan-steps") {
      event.preventDefault();
      setView((current) => ({
        panel: null,
        hash,
        opener: null,
        source: "user",
        seq: current.seq + 1,
      }));
    }
  }

  const active = panels.find(({ id }) => id === openPanel) ?? null;

  return (
    <div
      ref={root}
      className={styles.root}
      data-theme={theme}
      data-plan-panel={openPanel ?? "none"}
      onClick={capture}
      onSubmitCapture={(event) => {
        if (
          view.panel &&
          event.target instanceof HTMLFormElement &&
          event.target.dataset.planSave === "true"
        ) {
          submittedView.current = { panel: view.panel, seq: view.seq };
          setSavedMessage("");
        }
      }}
    >
      <div className={styles.page} inert={openPanel !== null}>
        <header className={styles.top}>
          <div className={styles.topText}>
            {backHref ? (
              <a className={styles.backLink} href={backHref}>
                <span aria-hidden="true">← </span>All campaign plans
              </a>
            ) : null}
            <p className={styles.kind}>Campaign plan</p>
            <h1 className={styles.title} id="workspace-heading" tabIndex={-1}>
              <span>
                {name.replace(/( — revised draft){2,}$/, " — revised draft")}
              </span>
              <span
                className={`${styles.status} ${
                  statusTone === "approved"
                    ? styles.statusApproved
                    : statusTone === "historical"
                      ? styles.statusHistorical
                      : ""
                }`}
              >
                <span className={styles.statusDot} aria-hidden="true" />
                {statusLabel}
              </span>
            </h1>
            {purpose ? <p className={styles.purpose}>{purpose}</p> : null}
          </div>
          <div className={styles.topAction}>
            {heroLabel && heroHref ? (
              <a
                className={`${styles.button} ${styles.buttonHero}`}
                href={heroHref}
                aria-describedby={heroNote ? "plan-hero-note" : undefined}
              >
                {heroLabel}
                <span aria-hidden="true"> →</span>
              </a>
            ) : heroLabel && onHero ? (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonHero}`}
                onClick={() => onHero(open)}
                disabled={heroDisabled}
                aria-describedby={heroNote ? "plan-hero-note" : undefined}
              >
                {heroLabel}
                <span aria-hidden="true"> →</span>
              </button>
            ) : nextAction ? (
              <a
                className={`${styles.button} ${styles.buttonHero}`}
                href={nextAction.href}
              >
                {nextAction.label}
              </a>
            ) : null}
            {heroNote ? (
              <div id="plan-hero-note" className={styles.heroNote}>
                {typeof heroNote === "function" ? heroNote(open) : heroNote}
              </div>
            ) : nextAction ? (
              <p className={styles.heroNote}>{nextAction.title}</p>
            ) : null}
          </div>
        </header>
        <p role="status" className={styles.small}>
          {savedMessage}
        </p>
        {typeof children === "function" ? children(open, openPanel) : children}
      </div>
      <PlanDrawer
        open={active !== null}
        eyebrow={active?.eyebrow ?? ""}
        title={active?.title ?? ""}
        description={active?.description}
        readOnly={readOnly || openPanel === "review"}
        footerAction={active?.footerAction ?? footerAction}
        hasSaveAction={!!active?.footerAction}
        presentation={openPanel === "compare" ? "drawer" : "dialog"}
        onClose={close}
      >
        <PlanReviewVisibleContext.Provider value={openPanel === "review"}>
          {panels.map((panel) => (
            <div
              key={panel.id}
              className={styles.panel}
              data-panel={panel.id}
              hidden={
                panel.id !== openPanel &&
                !(openPanel && panel.alsoFor?.includes(openPanel))
              }
            >
              {panel.content}
            </div>
          ))}
        </PlanReviewVisibleContext.Provider>
      </PlanDrawer>
    </div>
  );
}
