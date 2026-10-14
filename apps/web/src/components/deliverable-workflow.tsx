"use client";

import type {
  CampaignStatus,
  ContentAssetRecord,
  ContentAssetStatus,
} from "@landed/contracts";
import { ActionButton, ApplicationButton } from "@landed/ui";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import styles from "./campaign-delivery.module.css";

type Props = {
  asset: ContentAssetRecord;
  canManage: boolean;
  campaignId: string;
  campaignStatus: CampaignStatus;
  defaultOpen?: boolean;
  projectId: string;
  presentation?: "inline" | "dialog";
  theme?: "light" | "dark";
};

const nextStates: Record<ContentAssetStatus, ContentAssetStatus[]> = {
  planned: ["draft"],
  draft: ["submitted"],
  submitted: ["revision_requested", "approved"],
  revision_requested: ["draft"],
  approved: ["published"],
  published: [],
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function DeliverableWorkflow({
  asset,
  canManage,
  campaignId,
  campaignStatus,
  defaultOpen = false,
  projectId,
  presentation = "inline",
  theme = "light",
}: Props) {
  const router = useRouter();
  const options = nextStates[asset.status];
  const [isRequesting, setIsRequesting] = useState(false);
  const [targetStatus, setTargetStatus] = useState<ContentAssetStatus | "">(
    options[0] ?? "",
  );
  const [evidenceUrl, setEvidenceUrl] = useState(
    asset.publishedUrl ?? asset.submissionUrl ?? "",
  );
  const [note, setNote] = useState("Update deliverable review state");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [isPending, startTransition] = useTransition();
  const requestInFlight = useRef(false);
  const retryRequest = useRef<{ key: string; requestId: string } | null>(null);
  const campaignIsOpen = ["approved", "live"].includes(campaignStatus);
  const selectedStatus = options.includes(targetStatus as ContentAssetStatus)
    ? targetStatus
    : (options[0] ?? "");
  const urlRequired = ["submitted", "published"].includes(selectedStatus);
  const canUpdate = canManage && options.length > 0 && campaignIsOpen;
  const busy = isRequesting || isPending;

  useEffect(() => {
    if (!busy && !isOpen && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [busy, isOpen]);

  function closeEditor() {
    restoreFocus.current = true;
    dialog.current?.close();
    setIsOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpdate || !selectedStatus || requestInFlight.current) return;

    const body = {
      targetStatus: selectedStatus,
      evidenceUrl: evidenceUrl.trim() || null,
      note,
    };
    const requestKey = JSON.stringify(body);
    const requestId =
      retryRequest.current?.key === requestKey
        ? retryRequest.current.requestId
        : crypto.randomUUID();

    retryRequest.current = { key: requestKey, requestId };
    requestInFlight.current = true;
    setIsRequesting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/campaigns/${campaignId}/content-assets/${asset.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, requestId }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        setError(result?.message ?? "Deliverable state could not be changed.");
        return;
      }

      retryRequest.current = null;
      if (presentation === "dialog") {
        closeEditor();
        setMessage("Delivery updated.");
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Deliverable state could not be changed. Try again.");
    } finally {
      requestInFlight.current = false;
      setIsRequesting(false);
    }
  }

  const history = (
    <ol
      className={
        presentation === "dialog"
          ? styles.history
          : "campaign-deliverable-history"
      }
    >
      {asset.activity.map((activity) => (
        <li key={activity.id}>
          <strong>
            {(activity.fromStatus ?? "created").replaceAll("_", " ")} →{" "}
            {activity.toStatus.replaceAll("_", " ")}
          </strong>
          <span>{activity.note}</span>
          <time dateTime={activity.createdAt}>
            {formatDate(activity.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );

  const fields = (
    <>
      <label>
        <span>
          Next state
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </span>
        <select
          name="deliveryState"
          disabled={busy}
          required
          value={selectedStatus}
          onChange={(event) =>
            setTargetStatus(event.target.value as ContentAssetStatus)
          }
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>
          Content URL {urlRequired ? "(required)" : "(optional)"}
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </span>
        <input
          name="contentUrl"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder="https://…"
          required={urlRequired}
          type="url"
          value={evidenceUrl}
          onChange={(event) => setEvidenceUrl(event.target.value)}
        />
      </label>
      <label>
        <span>
          Review note
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </span>
        <input
          name="reviewNote"
          autoComplete="off"
          disabled={busy}
          maxLength={240}
          minLength={8}
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </>
  );

  if (presentation === "dialog")
    return (
      <div
        className={styles.control}
        data-theme={theme}
        id={`deliverable-${asset.id}`}
        aria-busy={busy}
      >
        <button
          className="application-button application-button--hero"
          type="button"
          ref={trigger}
          disabled={busy}
          aria-haspopup="dialog"
          onClick={() => {
            setMessage(null);
            dialog.current?.showModal();
            setIsOpen(true);
            heading.current?.focus();
          }}
        >
          {canUpdate ? "Update delivery" : "View delivery"}
        </button>
        {message && <p role="status">{message}</p>}
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeEditor();
          }}
        >
          <form className={styles.form} onSubmit={submit}>
            <header className={styles.dialogHeader}>
              <div>
                <h2 id={titleId} ref={heading} tabIndex={-1}>
                  {canUpdate ? "Update delivery" : "Delivery history"}
                </h2>
                <p id={descriptionId}>
                  {asset.label} · Current state:{" "}
                  {asset.status.replaceAll("_", " ")}
                </p>
              </div>
              <ApplicationButton
                className={styles.close}
                disabled={busy}
                aria-label="Close delivery"
                onClick={closeEditor}
              >
                ×
              </ApplicationButton>
            </header>
            <div className={styles.editorBody}>
              {canUpdate ? (
                <>
                  <p>
                    Record the next delivery state and its supporting URL.
                    Closing keeps unsaved input here until you leave this view.
                  </p>
                  <div className={styles.fields}>{fields}</div>
                </>
              ) : (
                <p>
                  {!canManage
                    ? "Campaign manager access is required to change deliverable state."
                    : asset.status === "published"
                      ? "This deliverable is published. Its recorded history is read-only."
                      : "Delivery updates are unavailable in the current campaign state."}
                </p>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <details className={styles.audit}>
                <summary>Delivery history ({asset.activity.length})</summary>
                {asset.activity.length ? (
                  history
                ) : (
                  <p>No delivery changes recorded yet.</p>
                )}
              </details>
            </div>
            <footer className={styles.footer}>
              {busy && <span role="status">Recording delivery…</span>}
              <ApplicationButton disabled={busy} onClick={closeEditor}>
                Back to delivery
              </ApplicationButton>
              {canUpdate && (
                <ApplicationButton variant="hero" disabled={busy} type="submit">
                  {busy ? "Recording…" : "Save delivery"}
                </ApplicationButton>
              )}
            </footer>
          </form>
        </dialog>
      </div>
    );

  return (
    <div
      aria-busy={busy}
      className="campaign-deliverable-control"
      id={`deliverable-${asset.id}`}
    >
      {!canManage ? (
        <p className="campaign-workflow-permission">
          Campaign manager access is required to change deliverable state.
        </p>
      ) : null}
      <details
        className="campaign-deliverable-foldout"
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
        open={isOpen}
      >
        <summary>
          {canUpdate ? "UPDATE DELIVERABLE" : "VIEW AUDIT HISTORY"}
        </summary>
        {canUpdate ? (
          <form className="campaign-deliverable-form" onSubmit={submit}>
            <label>
              <span>
                Next state
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </span>
              <select
                disabled={busy}
                required
                value={targetStatus}
                onChange={(event) =>
                  setTargetStatus(event.target.value as ContentAssetStatus)
                }
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option.replaceAll("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Content URL {urlRequired ? "(required)" : "(optional)"}
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </span>
              <input
                disabled={busy}
                placeholder="https://"
                required={urlRequired}
                type="url"
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
              />
            </label>
            <label>
              <span>
                Review note
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </span>
              <input
                disabled={busy}
                maxLength={240}
                minLength={8}
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <ActionButton disabled={busy} type="submit">
              {isRequesting ? "RECORDING…" : "RECORD STATE CHANGE"}
            </ActionButton>
            {error ? (
              <p className="campaign-workflow-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
        <ol className="campaign-deliverable-history">
          {asset.activity.map((activity) => (
            <li key={activity.id}>
              <strong>
                {(activity.fromStatus ?? "created").replaceAll("_", " ")} →{" "}
                {activity.toStatus.replaceAll("_", " ")}
              </strong>
              <span>{activity.note}</span>
              <time dateTime={activity.createdAt}>
                {formatDate(activity.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
