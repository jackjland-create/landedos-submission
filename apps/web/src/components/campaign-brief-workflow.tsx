"use client";

import type {
  CampaignBriefStatus,
  CampaignBriefVersionRecord,
} from "@landed/contracts";
import { ApplicationButton, ApplicationStatus } from "@landed/ui";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { campaignEditSavedEvent } from "./campaign-edit-guard";
import styles from "./campaign-brief-workflow.module.css";
import { briefHasRequiredDetails } from "@/lib/campaign-brief-presentation";

type Props = {
  canManage: boolean;
  campaignId: string;
  projectId: string;
  versions: CampaignBriefVersionRecord[];
  theme?: "light" | "dark";
};

const transitionOptions: Record<
  CampaignBriefStatus,
  Array<{ label: string; status: CampaignBriefStatus }>
> = {
  draft: [{ label: "Submit for review", status: "submitted" }],
  submitted: [
    { label: "Request revision", status: "revision_requested" },
    { label: "Approve brief", status: "approved" },
  ],
  revision_requested: [],
  approved: [],
};

function formatDate(value: string) {
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

export function CampaignBriefWorkflow({
  canManage,
  campaignId,
  projectId,
  versions,
  theme = "light",
}: Props) {
  const router = useRouter();
  const restoreFocus = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialogTitle = useId();
  const dialogDescription = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const latest = versions[0];
  const [isPending, startTransition] = useTransition();
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const retryRequest = useRef<{ key: string; requestId: string } | null>(null);
  const [objective, setObjective] = useState(latest.objective);
  const [audience, setAudience] = useState(latest.audience ?? "");
  const [keyMessage, setKeyMessage] = useState(latest.keyMessage ?? "");
  const [creatorDirection, setCreatorDirection] = useState(
    latest.creatorDirection ?? "",
  );
  const [complianceNotes, setComplianceNotes] = useState(
    latest.complianceNotes ?? "",
  );
  const [reason, setReason] = useState(
    latest.status === "revision_requested"
      ? "Address requested brief revisions"
      : "Complete campaign brief details",
  );

  const busy = isRequesting || isPending;
  const editable =
    canManage && ["draft", "revision_requested"].includes(latest.status);
  const complete = briefHasRequiredDetails(latest);
  const editLabel =
    latest.status === "revision_requested"
      ? "Update brief"
      : complete
        ? "Edit brief"
        : "Complete brief";
  const editIsPrimary =
    editable && (!complete || latest.status === "revision_requested");

  useEffect(() => {
    if (!busy && !isOpen && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [busy, isOpen]);

  function openEditor() {
    setMessage(null);
    dialog.current?.showModal();
    setIsOpen(true);
    heading.current?.focus();
  }

  function closeEditor() {
    restoreFocus.current = true;
    dialog.current?.close();
    setIsOpen(false);
  }

  async function mutateBrief(body: Record<string, unknown>) {
    if (!canManage || requestInFlight.current) return;

    const requestKey = JSON.stringify(body);
    const requestId =
      retryRequest.current?.key === requestKey
        ? retryRequest.current.requestId
        : crypto.randomUUID();

    retryRequest.current = { key: requestKey, requestId };
    requestInFlight.current = true;
    setIsRequesting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/campaigns/${campaignId}/brief`,
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
        setError(result?.message ?? "Campaign brief could not be changed.");
        return;
      }

      retryRequest.current = null;
      if (body.action === "save") {
        document.dispatchEvent(new Event(campaignEditSavedEvent));
        closeEditor();
        setMessage("Brief saved as a new version.");
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Campaign brief could not be changed. Try again.");
    } finally {
      requestInFlight.current = false;
      setIsRequesting(false);
    }
  }

  async function saveBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutateBrief({
      action: "save",
      objective,
      audience,
      keyMessage,
      creatorDirection,
      complianceNotes: complianceNotes.trim() || null,
      reason,
    });
  }

  async function transitionBrief(targetStatus: CampaignBriefStatus) {
    await mutateBrief({
      action: "transition",
      targetStatus,
      reason:
        targetStatus === "submitted"
          ? "Brief submitted for human review"
          : targetStatus === "revision_requested"
            ? "Brief revision requested by campaign manager"
            : "Brief approved by campaign manager",
    });
  }

  return (
    <section
      aria-busy={busy}
      className={styles.panel}
      data-theme={theme}
      id="campaign-brief"
    >
      <header className={styles.header}>
        <div>
          <h2>Campaign brief</h2>
          <p>Version {latest.version} · Direction and compliance</p>
        </div>
        <div className={styles.actions}>
          <ApplicationStatus
            state={latest.status === "approved" ? "confirmed" : "pending"}
            tone={latest.status === "approved" ? "progress" : "neutral"}
          >
            {latest.status.replaceAll("_", " ")}
          </ApplicationStatus>
          {editable && (
            <button
              className={`application-button${editIsPrimary ? " application-button--hero" : ""}`}
              ref={trigger}
              type="button"
              disabled={busy}
              onClick={openEditor}
            >
              {editLabel}
            </button>
          )}
          {canManage
            ? transitionOptions[latest.status]
                .filter((option) => option.status !== "submitted" || complete)
                .map((option) => (
                  <ApplicationButton
                    disabled={busy}
                    key={option.status}
                    onClick={() => void transitionBrief(option.status)}
                    type="button"
                    variant={
                      option.status === "submitted" ||
                      option.status === "approved"
                        ? "hero"
                        : "neutral"
                    }
                  >
                    {isRequesting ? "Updating…" : option.label}
                  </ApplicationButton>
                ))
            : null}
        </div>
      </header>

      <p className={styles.hint}>
        {!canManage
          ? "A campaign manager completes, submits and approves the brief. You can review the saved details below."
          : latest.status === "submitted"
            ? "Review the saved details, then approve the brief or request changes. Approval does not launch the campaign."
            : latest.status === "approved"
              ? "This brief is approved. Tracking and campaign launch are separate steps."
              : latest.status === "revision_requested"
                ? "Update the requested details and save the brief before submitting it again."
                : complete
                  ? "Your brief is saved. Submit it for review; this does not approve it or launch the campaign."
                  : "Complete the audience, key message and creator instructions, then save your brief."}
      </p>

      <dl className={styles.summary}>
        <div>
          <dt>Objective</dt>
          <dd>{latest.objective}</dd>
        </div>
        <div>
          <dt>Audience</dt>
          <dd>{latest.audience?.trim() || "Not defined"}</dd>
        </div>
        <div>
          <dt>Key message</dt>
          <dd>{latest.keyMessage?.trim() || "Not defined"}</dd>
        </div>
        <div>
          <dt>Creator direction</dt>
          <dd>{latest.creatorDirection?.trim() || "Not defined"}</dd>
        </div>
        <div>
          <dt>Compliance notes</dt>
          <dd>{latest.complianceNotes?.trim() || "No additional notes"}</dd>
        </div>
      </dl>

      {editable ? (
        <dialog
          className={styles.dialog}
          ref={dialog}
          aria-labelledby={dialogTitle}
          aria-describedby={dialogDescription}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeEditor();
          }}
        >
          <form className={styles.form} onSubmit={saveBrief} aria-busy={busy}>
            <header className={styles.dialogHeader}>
              <div>
                <h2 id={dialogTitle} ref={heading} tabIndex={-1}>
                  {editLabel === "Complete brief"
                    ? "Complete campaign brief"
                    : editLabel === "Update brief"
                      ? "Update campaign brief"
                      : "Edit campaign brief"}
                </h2>
                <p id={dialogDescription}>
                  Saving creates a new brief version. It does not submit or
                  approve the brief.
                </p>
              </div>
              <button
                className={`application-button ${styles.close}`}
                type="button"
                aria-label="Close brief editor"
                disabled={busy}
                onClick={closeEditor}
              >
                ×
              </button>
            </header>
            <div className={styles.editorBody}>
              <p className={styles.hint}>
                Required fields are marked until complete. Closing keeps unsaved
                text here until you leave the page.
              </p>
              {latest.status === "revision_requested" && (
                <p className={styles.hint}>
                  Complete the requested revision before saving a new version.
                </p>
              )}
              <div className={styles.fields}>
                <label>
                  <span>
                    Objective
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    disabled={busy}
                    maxLength={240}
                    name="objective"
                    required
                    value={objective}
                    onChange={(event) => setObjective(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Audience
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    disabled={busy}
                    maxLength={500}
                    name="audience"
                    required
                    value={audience}
                    onChange={(event) => setAudience(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Key message
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    disabled={busy}
                    maxLength={500}
                    name="keyMessage"
                    required
                    value={keyMessage}
                    onChange={(event) => setKeyMessage(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Creator direction
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    disabled={busy}
                    maxLength={1000}
                    name="creatorDirection"
                    required
                    value={creatorDirection}
                    onChange={(event) =>
                      setCreatorDirection(event.target.value)
                    }
                  />
                </label>
                <label>
                  Compliance notes
                  <textarea
                    autoComplete="off"
                    disabled={busy}
                    maxLength={1000}
                    name="complianceNotes"
                    value={complianceNotes}
                    onChange={(event) => setComplianceNotes(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Change reason
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <input
                    autoComplete="off"
                    disabled={busy}
                    maxLength={240}
                    minLength={8}
                    name="reason"
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className={styles.footer}>
              <ApplicationButton
                disabled={busy}
                type="button"
                onClick={closeEditor}
              >
                Back to brief
              </ApplicationButton>
              <ApplicationButton disabled={busy} type="submit" variant="hero">
                {busy ? "Saving…" : "Save new version"}
              </ApplicationButton>
              {busy && <span role="status">Saving brief…</span>}
            </footer>
          </form>
        </dialog>
      ) : null}

      <div className={styles.actions}>
        {!canManage ? (
          <p className="campaign-workflow-permission">
            Campaign manager access is required to change the brief. Immutable
            versions remain available below.
          </p>
        ) : null}
        {error && !isOpen ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {message && <p role="status">{message}</p>}

      <details className={styles.history}>
        <summary>
          View {versions.length} retained brief{" "}
          {versions.length === 1 ? "version" : "versions"}
        </summary>
        <ol>
          {versions.map((version) => (
            <li key={version.id}>
              <strong>
                V{version.version} / {version.status.replaceAll("_", " ")}
              </strong>
              <span>{version.reason}</span>
              <time dateTime={version.createdAt}>
                {formatDate(version.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
