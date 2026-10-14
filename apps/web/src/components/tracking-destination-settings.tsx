"use client";

import { Status } from "@landed/ui";
import { type FormEvent, useState } from "react";

export type TrackingDestinationHost = {
  id: string;
  hostname: string;
  reason: string;
  addedAt: string;
  revokedAt: string | null;
};

export type TrackingDestinationApprovalDraft = {
  hostname: string;
  requestId: string;
  reason: string;
};

type ApprovalPayload = TrackingDestinationApprovalDraft;

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
  timeZoneName: "short",
});

export function TrackingDestinationSettings({
  canApprove,
  draft,
  hasActivePolicy = false,
  hosts,
  projectId,
}: {
  canApprove: boolean;
  draft?: TrackingDestinationApprovalDraft | null;
  hasActivePolicy?: boolean;
  hosts: TrackingDestinationHost[];
  projectId: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<ApprovalPayload | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  async function sendApproval(payload: ApprovalPayload) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tracking-destination-hosts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok) {
        if (response.status >= 500 || !body) {
          setPendingPayload(payload);
          setUncertain(true);
          setMessage(
            body?.message ??
              "The result could not be verified. Retry the same request before taking another action.",
          );
        } else {
          setPendingPayload(null);
          setUncertain(false);
          setMessage(body.message ?? "The destination approval was rejected.");
        }
        return;
      }
      setPendingPayload(null);
      setUncertain(false);
      window.location.reload();
    } catch {
      setPendingPayload(payload);
      setUncertain(true);
      setMessage(
        "The result is not yet known. Retry the same request before taking another action.",
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("confirmApproval") !== "confirmed") {
      setMessage(
        "Confirm that the exact hostname belongs to the supervised run before approving it.",
      );
      return;
    }
    const payload = {
      hostname: String(form.get("hostname") ?? "")
        .trim()
        .toLowerCase(),
      requestId: String(form.get("requestId") ?? "").trim(),
      reason: String(form.get("reason") ?? "").trim(),
    };
    setPendingPayload(payload);
    void sendApproval(payload);
  }

  return (
    <article
      className="operation-card operation-card--destination"
      id="tracking-destination-control"
      tabIndex={-1}
    >
      <div className="operation-card__summary">
        <div>
          <span className="eyebrow">TRACKING DESTINATION CONTROL</span>
          <h2>Approve one exact campaign destination.</h2>
        </div>
        <Status tone={hasActivePolicy ? "verified" : "default"}>
          {hasActivePolicy ? "ACTIVE POLICY" : "NO ACTIVE HOST"}
        </Status>
      </div>

      <p className="operation-card__notice">
        A signed tracked link can only point to a hostname approved here by a
        workspace admin. This approval does not enable provider traffic or issue
        a campaign link.
      </p>

      {hosts.length > 0 ? (
        <section aria-labelledby="recent-destinations-heading">
          <div className="destination-hosts__heading">
            <h3 id="recent-destinations-heading">Recent destination history</h3>
            <p>Showing the 20 most recent retained approvals.</p>
          </div>
          <div className="destination-hosts">
            {hosts.map((host) => (
              <dl className="destination-hosts__row" key={host.id}>
                <div>
                  <dt>HOSTNAME</dt>
                  <dd translate="no">{host.hostname}</dd>
                </div>
                <div>
                  <dt>APPROVED</dt>
                  <dd>{timestampFormatter.format(new Date(host.addedAt))}</dd>
                </div>
                <div>
                  <dt>STATE</dt>
                  <dd>{host.revokedAt ? "REVOKED" : "ACTIVE"}</dd>
                </div>
                <div>
                  <dt>REASON</dt>
                  <dd>{host.reason}</dd>
                </div>
              </dl>
            ))}
          </div>
        </section>
      ) : (
        <div className="operation-settings__empty">
          <strong>NO DESTINATION HOST APPROVED</strong>
          <p>
            Tracked-link issuance remains blocked until an admin approves one.
          </p>
        </div>
      )}

      {message ? (
        <div aria-live="polite" className="operation-settings__message">
          <strong>{uncertain ? "OUTCOME UNKNOWN" : "ACTION REQUIRED"}</strong>
          <span>{message}</span>
          {uncertain && pendingPayload ? (
            <button
              className="action-button action-button--secondary"
              disabled={saving}
              onClick={() => void sendApproval(pendingPayload)}
              type="button"
            >
              RETRY SAME REQUEST
            </button>
          ) : null}
        </div>
      ) : null}

      {canApprove ? (
        <form className="operation-card__form" onSubmit={submit}>
          <label htmlFor="destination-hostname">
            <span>
              EXACT HOSTNAME
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <input
              autoComplete="off"
              defaultValue={draft?.hostname ?? ""}
              id="destination-hostname"
              inputMode="url"
              maxLength={253}
              name="hostname"
              pattern="[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?"
              required
              spellCheck={false}
              type="text"
            />
          </label>
          <p className="operation-card__field-help">
            Enter the hostname only. Do not include https://, a path or a token.
          </p>
          <label htmlFor="destination-request-id">
            <span>
              RUN REQUEST ID
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <input
              autoComplete="off"
              defaultValue={draft?.requestId ?? ""}
              id="destination-request-id"
              maxLength={36}
              name="requestId"
              readOnly={Boolean(draft?.requestId)}
              required
              spellCheck={false}
              type="text"
            />
          </label>
          <p className="operation-card__field-help">
            Use the exact request ID shown by the supervised run.
          </p>
          <label htmlFor="destination-reason">
            <span>
              APPROVAL REASON
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <textarea
              autoComplete="off"
              defaultValue={draft?.reason ?? ""}
              id="destination-reason"
              maxLength={240}
              minLength={8}
              name="reason"
              required
              rows={2}
            />
          </label>
          <label className="operation-card__confirmation">
            <input
              name="confirmApproval"
              required
              type="checkbox"
              value="confirmed"
            />
            <span>
              I confirm this exact HTTPS hostname belongs to the supervised run.
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
          </label>
          <button
            className="action-button"
            disabled={saving || uncertain}
            type="submit"
          >
            {saving ? "APPROVING…" : "APPROVE DESTINATION HOST"}
          </button>
        </form>
      ) : (
        <p className="operation-card__notice">
          Signed-in workspace admin access is required to approve a destination.
        </p>
      )}
    </article>
  );
}
