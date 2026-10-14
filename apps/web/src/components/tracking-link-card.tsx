"use client";

import type { ContentAssetRecord, TrackedLinkRecord } from "@landed/contracts";
import { ApplicationButton, ApplicationStatus } from "@landed/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import dialogStyles from "./campaign-delivery.module.css";
import styles from "./tracking-link-card.module.css";

/** CMP-03 / TRK-01 / UI-03: presentation only. The owning workflow supplies
 * every permission, validity decision and mutation form. */
export function TrackingLinkCard({
  asset,
  creatorName,
  theme,
  snapshotAt,
  currentLink,
  isExpired,
  isVerifiable,
  restricted,
  canIssue,
  canRevoke,
  signedUrl,
  unavailable,
  busy,
  error,
  savedRevision,
  editor,
  evidence,
  secondaryAction = false,
}: {
  asset: ContentAssetRecord;
  creatorName: string;
  theme: "light" | "dark";
  snapshotAt: string;
  currentLink: TrackedLinkRecord | null;
  isExpired: boolean;
  isVerifiable: boolean;
  restricted: boolean;
  canIssue: boolean;
  canRevoke: boolean;
  signedUrl: string | null;
  unavailable: string | null;
  busy: boolean;
  error: string | null;
  savedRevision: number;
  editor: ReactNode;
  evidence: ReactNode;
  secondaryAction?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const previousRevision = useRef(savedRevision);
  const titleId = useId();
  const descriptionId = useId();
  const [mode, setMode] = useState<"setup" | "evidence">("setup");
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(value));
  const state = restricted
    ? "Tracking unavailable"
    : !currentLink
      ? "Not created"
      : isExpired
        ? "Expired"
        : !currentLink.destinationPolicyActive
          ? "Destination disabled"
          : isVerifiable
            ? "Link ready"
            : "Link unavailable";
  const action = canIssue
    ? "Create tracking link"
    : canRevoke
      ? "Manage link"
      : "View link";
  const issueBlocked = !currentLink && !canIssue;

  useEffect(() => {
    if (previousRevision.current !== savedRevision) {
      previousRevision.current = savedRevision;
      // The server refresh updates the card; retain the dialog until pending clears.
      restoreFocus.current = true;
    }
    if (!busy && restoreFocus.current) {
      dialog.current?.close();
      (lastTrigger.current?.isConnected
        ? lastTrigger.current
        : evidenceTrigger.current
      )?.focus();
      restoreFocus.current = false;
    }
  }, [busy, savedRevision]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    (lastTrigger.current?.isConnected
      ? lastTrigger.current
      : evidenceTrigger.current
    )?.focus();
  }
  function show(nextMode: "setup" | "evidence", trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setMode(nextMode);
    setOpen(true);
  }
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      heading.current?.focus();
    }
  }, [open, mode]);

  async function copy() {
    if (!signedUrl || !isVerifiable || restricted) return;
    try {
      await navigator.clipboard.writeText(signedUrl);
      setCopiedUrl(signedUrl);
      setCopyMessage("Link copied.");
    } catch {
      setCopiedUrl(null);
      setCopyMessage(
        "Could not copy. Open the link details to select the URL manually.",
      );
    }
  }

  return (
    <article
      className={`${dialogStyles.control} ${styles.card}`}
      data-theme={theme}
      id={`tracking-${asset.id}`}
    >
      <header className={styles.row}>
        <div className={styles.identity}>
          <h3>{creatorName || "Creator"}</h3>
          <p>{asset.label}</p>
        </div>
        <ApplicationStatus
          state={isVerifiable ? "confirmed" : "pending"}
          tone={isVerifiable ? "progress" : "neutral"}
        >
          {state}
        </ApplicationStatus>
        <div className={styles.actions}>
          {!restricted && (canIssue || canRevoke || currentLink) && (
            <button
              type="button"
              className={`application-button${canIssue && !secondaryAction ? " application-button--hero" : ""}`}
              disabled={busy}
              aria-haspopup="dialog"
              onClick={(event) => show("setup", event.currentTarget)}
            >
              {action}
            </button>
          )}
          {signedUrl && (
            <ApplicationButton disabled={busy} onClick={copy}>
              Copy link
            </ApplicationButton>
          )}
          <button
            type="button"
            className="application-button"
            disabled={busy}
            aria-haspopup="dialog"
            ref={evidenceTrigger}
            onClick={(event) => show("evidence", event.currentTarget)}
          >
            View evidence
          </button>
        </div>
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>Destination</dt>
          <dd>{currentLink?.destinationUrl ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>
            {currentLink
              ? date(currentLink.expiresAt)
              : "Set when creating the link"}
          </dd>
        </div>
      </dl>
      {unavailable && (
        <p className={styles.notice} role="note">
          {unavailable}
        </p>
      )}
      {currentLink && !restricted && !isVerifiable && (
        <p className={styles.notice}>
          {isExpired
            ? "This link has expired. Revoke it before creating a replacement."
            : !currentLink.destinationPolicyActive
              ? "An administrator disabled this destination. Revoke the link before replacing it."
              : "The signing key is unavailable; the public URL cannot be displayed."}
        </p>
      )}
      {copyMessage && (!copiedUrl || copiedUrl === signedUrl) && (
        <p role="status">{copyMessage}</p>
      )}
      {savedRevision > 0 && <p role="status">Tracking link updated.</p>}
      <dialog
        ref={dialog}
        className={dialogStyles.dialog}
        data-mode={mode}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) close();
        }}
      >
        <div className={dialogStyles.form} aria-busy={busy}>
          <header className={dialogStyles.dialogHeader}>
            <div>
              <h2 ref={heading} tabIndex={-1} id={titleId}>
                {mode === "evidence"
                  ? "Tracking evidence"
                  : currentLink
                    ? "Manage tracking link"
                    : "Create tracking link"}
              </h2>
              <p id={descriptionId}>
                {creatorName} · {asset.label}
              </p>
            </div>
            <ApplicationButton
              className={dialogStyles.close}
              aria-label="Close tracking"
              disabled={busy}
              onClick={close}
            >
              ×
            </ApplicationButton>
          </header>
          <div className={`${dialogStyles.editorBody} ${styles.detail}`}>
            {open &&
              (mode === "evidence" ? (
                <>
                  <p>
                    Evidence as of {date(snapshotAt)}. Visits alone do not prove
                    wallet identity or a qualified result.
                  </p>
                  {evidence}
                  {asset.trackedLinks.map((link) => (
                    <section
                      key={link.id}
                      aria-label={`Session evidence for key version ${link.keyVersion}`}
                    >
                      <h3>Anonymous sessions · key v{link.keyVersion}</h3>
                      <p>
                        {link.anonymousSessions.sessions} sessions ·{" "}
                        {link.anonymousSessions.boundClicks} session-linked
                        visits. Wallet identity is not attached.
                      </p>
                      {link.anonymousSessions.firstCreatedAt && (
                        <p>
                          First session:{" "}
                          {date(link.anonymousSessions.firstCreatedAt)}
                        </p>
                      )}
                      {link.anonymousSessions.lastSeenAt && (
                        <p>
                          Last session:{" "}
                          {date(link.anonymousSessions.lastSeenAt)}
                        </p>
                      )}
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <p>
                    {currentLink
                      ? "Give this tracking link to the creator to use in their content."
                      : "Choose where visitors should land. Landed will generate a tracking link for this creator and deliverable."}
                  </p>
                  {unavailable && <p role="note">{unavailable}</p>}
                  {currentLink && (
                    <dl className={styles.facts}>
                      <div>
                        <dt>Destination</dt>
                        <dd>{currentLink.destinationUrl}</dd>
                      </div>
                      <div>
                        <dt>Expiry</dt>
                        <dd>{date(currentLink.expiresAt)}</dd>
                      </div>
                    </dl>
                  )}
                  {signedUrl && (
                    <label>
                      Public tracking URL
                      <input
                        name="publicTrackingUrl"
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        readOnly
                        value={signedUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </label>
                  )}
                  {canRevoke && (
                    <p>
                      Revoking disables this link for future eligible visits.
                      Its history is retained. You can create a replacement
                      afterwards.
                    </p>
                  )}
                  <section
                    className={styles.notice}
                    aria-label="What this link measures"
                  >
                    <h3>What this link measures</h3>
                    <p>
                      Records visits through the link and checks click quality.
                      A visit alone is not a qualified outcome.
                    </p>
                    <p>
                      Wallet outcomes and revenue need separate measurement
                      setup, visitor proof and consent, and an approved success
                      rule. Creating a link does not verify that setup.
                    </p>
                  </section>
                  {!currentLink && (
                    <p>
                      After creation, copy the link from Tracking and include it
                      in the creator’s brief. Nothing is sent or activated
                      automatically.
                    </p>
                  )}
                  {!issueBlocked && (
                    <div
                      onSubmitCapture={(event) => {
                        if (
                          currentLink &&
                          canRevoke &&
                          !window.confirm(
                            "Revoke this tracking link? Future visits will no longer be eligible through it. Retained evidence will not be deleted.",
                          )
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                    >
                      {editor}
                    </div>
                  )}
                  {error && (
                    <p role="alert" className={dialogStyles.error}>
                      {error}
                    </p>
                  )}
                </>
              ))}
          </div>
          <footer className={dialogStyles.footer}>
            {mode === "setup" && !currentLink && !busy && (
              <span>
                Closing keeps your entries here but does not create a link.
              </span>
            )}
            {busy && <span role="status">Saving tracking change…</span>}
            <ApplicationButton disabled={busy} onClick={close}>
              Back to tracking
            </ApplicationButton>
          </footer>
        </div>
      </dialog>
    </article>
  );
}
