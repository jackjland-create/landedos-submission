"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / UI-03 · shared plan overlay (journey boards 02b, 04a, 04c).
 * Setup uses centred dialogs; supporting comparison uses a side drawer.
 * Children stay mounted while closed so editors keep drafts, pending saves and
 * uncertain results. Closing never saves, discards or approves anything.
 */

const focusable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function PlanDrawer({
  open,
  eyebrow,
  title,
  description,
  readOnly = false,
  footerAction,
  hasSaveAction = false,
  presentation = "drawer",
  onClose,
  children,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  description?: string;
  readOnly?: boolean;
  footerAction?: ReactNode;
  hasSaveAction?: boolean;
  presentation?: "drawer" | "dialog";
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, title]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // A nested native dialog handles its own Escape first.
      if ((event.target as HTMLElement).closest("dialog[open]")) return;
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = Array.from(
      panel.current.querySelectorAll<HTMLElement>(focusable),
    ).filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === heading.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.drawerLayer} hidden={!open}>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-drawer-title"
        aria-describedby={description ? "plan-drawer-description" : undefined}
        className={`${styles.drawer} ${presentation === "dialog" ? styles.planDialog : ""}`}
        data-presentation={presentation}
        onKeyDown={onKeyDown}
      >
        <header className={styles.drawerHead}>
          <div>
            <p className={styles.small}>{eyebrow}</p>
            <h2
              id="plan-drawer-title"
              ref={heading}
              tabIndex={-1}
              className={styles.drawerTitle}
            >
              {title}
            </h2>
            {description ? (
              <p id="plan-drawer-description" className={styles.drawerIntro}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close and return to the plan"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className={styles.drawerBody}>{children}</div>
        <footer className={styles.drawerFoot}>
          {!hasSaveAction && footerAction}
          <button type="button" className={styles.button} onClick={onClose}>
            Back to plan
          </button>
          {hasSaveAction && footerAction}
          {!hasSaveAction && !(readOnly && presentation === "dialog") && (
            <p className={styles.small}>
              {readOnly
                ? "Read only. Closing leaves the saved plan unchanged."
                : "Closing doesn’t save. Unsaved changes stay here until you save or leave the page."}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}
