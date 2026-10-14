"use client";

import { Status } from "@landed/ui";
import { type FormEvent, useState } from "react";

import {
  TrackingDestinationSettings,
  type TrackingDestinationApprovalDraft,
  type TrackingDestinationHost,
} from "./tracking-destination-settings";

export type HeliusOperationalStatus = {
  integrationId: string;
  configuredEnvironment: "demo" | "devnet" | "mainnet";
  controlRequired: boolean;
  decision: "enabled" | "disabled";
  version: number | null;
  operationallyEnabled: boolean;
  validUntil: string | null;
  healthState:
    | "not_required"
    | "disabled"
    | "unobserved"
    | "healthy"
    | "degraded"
    | "stale"
    | "expired";
  healthObservedAt: string | null;
  retainedDeliveryCount: number;
  deliveryLimit: number;
  retainedRawBytes: number;
  rawByteLimit: number;
  canManage: boolean;
};

type PendingDecision = {
  integrationId: string;
  requestId: string;
  decision: "enabled" | "disabled";
  reason: string;
  controls: Record<string, unknown>;
};

type DataQualityCheckpoint = {
  affected: string;
  action: string;
  heading: string;
  integrationId: string | null;
  linkLabel: string | null;
  observedAt: string | null;
  status: string;
  summary: string;
  tone: "default" | "verified" | "danger";
  variant: "clear" | "attention" | "neutral";
};

const stateCopy = {
  not_required: "DEMO / CONTROL NOT REQUIRED",
  disabled: "STOPPED",
  unobserved: "APPROVED / AWAITING HEALTH",
  healthy: "HEALTHY / ACCEPTING TRAFFIC",
  degraded: "DEGRADED / FAIL CLOSED",
  stale: "HEALTH UNKNOWN / STALE",
  expired: "READINESS EXPIRED / RECOVERY REQUIRED",
} as const;

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
  timeZoneName: "short",
});

const numberFormatter = new Intl.NumberFormat("en-GB");

function toneFor(state: HeliusOperationalStatus["healthState"]) {
  if (state === "healthy") return "verified" as const;
  if (state === "disabled" || state === "degraded" || state === "expired")
    return "danger" as const;
  return "default" as const;
}

const healthPriority: Record<HeliusOperationalStatus["healthState"], number> = {
  degraded: 0,
  stale: 1,
  unobserved: 2,
  expired: 3,
  disabled: 4,
  healthy: 5,
  not_required: 6,
};

export function buildDataQualityCheckpoint(
  statuses: HeliusOperationalStatus[],
): DataQualityCheckpoint {
  if (statuses.length === 0) {
    return {
      affected: "No provider integration",
      action:
        "Configure an approved provider integration before expecting campaign evidence.",
      heading: "No provider evidence source is configured.",
      integrationId: null,
      linkLabel: null,
      observedAt: null,
      status: "SETUP REQUIRED",
      summary:
        "Landed cannot assess missing or delayed campaign evidence until a provider source exists.",
      tone: "default",
      variant: "neutral",
    };
  }

  const selected = [...statuses].sort(
    (left, right) =>
      healthPriority[left.healthState] - healthPriority[right.healthState],
  )[0]!;
  const affected = `Helius / ${selected.configuredEnvironment.toUpperCase()}`;
  const shared = {
    affected,
    integrationId: selected.integrationId,
    observedAt: selected.healthObservedAt,
  };
  const controlLabel = selected.canManage
    ? "OPEN PROVIDER CONTROL"
    : "VIEW PROVIDER STATUS";

  if (selected.healthState === "degraded") {
    return {
      ...shared,
      action:
        "Keep traffic stopped. Review the failed threshold, then record recovery only after a healthy monitor result.",
      heading: "Provider evidence is outside its approved limits.",
      linkLabel: controlLabel,
      status: "ACTION REQUIRED",
      summary:
        "New campaign evidence is blocked because the latest monitor reading breached an operating threshold.",
      tone: "danger",
      variant: "attention",
    };
  }
  if (selected.healthState === "stale") {
    return {
      ...shared,
      action:
        "Run the trusted health monitor and confirm a current result before recovering provider traffic.",
      heading: "Provider evidence is delayed.",
      linkLabel: controlLabel,
      status: "ACTION REQUIRED",
      summary:
        "The latest health observation is outside the approved freshness window, so current data quality is unknown.",
      tone: "danger",
      variant: "attention",
    };
  }
  if (selected.healthState === "unobserved") {
    return {
      ...shared,
      action:
        "Run the trusted health monitor. Provider traffic stays blocked until a current observation passes every threshold.",
      heading: "Provider evidence has not arrived.",
      linkLabel: controlLabel,
      status: "ACTION REQUIRED",
      summary:
        "Approval exists, but there is no current monitor observation for this exact integration version.",
      tone: "danger",
      variant: "attention",
    };
  }
  if (selected.healthState === "expired") {
    return {
      ...shared,
      action:
        "Review and retain a new same-scope readiness pack, then confirm current health before recovery.",
      heading: "Provider readiness evidence has expired.",
      linkLabel: controlLabel,
      status: "ACTION REQUIRED",
      summary:
        "The integration remains fail closed because its approved operating evidence is no longer current.",
      tone: "danger",
      variant: "attention",
    };
  }
  if (selected.healthState === "disabled") {
    return {
      ...shared,
      action:
        "Leave the integration stopped, or begin a human-approved recovery with current readiness and health evidence.",
      heading: "Provider traffic is intentionally stopped.",
      linkLabel: controlLabel,
      status: "STOPPED",
      summary:
        "No new provider evidence is expected while this integration remains disabled.",
      tone: "default",
      variant: "neutral",
    };
  }
  if (selected.healthState === "healthy") {
    return {
      ...shared,
      action:
        "Continue monitoring freshness and capacity. No data-quality action is currently required.",
      heading: "Provider evidence is current.",
      linkLabel: "VIEW PROVIDER STATUS",
      status: "NO OPEN INCIDENT",
      summary:
        "The latest monitor observation is inside the approved operating limits for this integration.",
      tone: "verified",
      variant: "clear",
    };
  }
  return {
    ...shared,
    action:
      "Use this isolated fixture for demonstration only. It is not customer or mainnet readiness evidence.",
    heading: "Demo evidence is isolated.",
    linkLabel: "VIEW PROVIDER STATUS",
    status: "DEMO DATA",
    summary:
      "This integration is outside the live customer control boundary, so operational monitoring is not required.",
    tone: "default",
    variant: "neutral",
  };
}

export function HeliusOperationSettings({
  canApproveDestinationHosts = false,
  destinationApprovalDraft = null,
  destinationHosts = [],
  hasActiveDestinationPolicy = false,
  projectId,
  statuses,
}: {
  canApproveDestinationHosts?: boolean;
  destinationApprovalDraft?: TrackingDestinationApprovalDraft | null;
  destinationHosts?: TrackingDestinationHost[];
  hasActiveDestinationPolicy?: boolean;
  projectId: string;
  statuses: HeliusOperationalStatus[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requiredInput, setRequiredInput] = useState<
    Record<
      string,
      { enabled: boolean; packMissing: boolean; stopMissing: boolean }
    >
  >({});
  const [pendingPayload, setPendingPayload] = useState<PendingDecision | null>(
    null,
  );
  const checkpoint = buildDataQualityCheckpoint(statuses);
  const checkpointTarget = checkpoint.integrationId
    ? `#provider-control-${checkpoint.integrationId}`
    : null;

  async function sendDecision(payload: PendingDecision) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/integrations/helius-operation`,
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
        setPendingPayload(null);
        setUncertain(false);
        setMessage(body?.message ?? "The decision was rejected.");
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

  function submit(
    event: FormEvent<HTMLFormElement>,
    status: HeliusOperationalStatus,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const decision = String(form.get("decision")) as "enabled" | "disabled";
    if (decision === "disabled" && form.get("confirmStop") !== "confirmed") {
      setMessage(
        "Confirm the fail-closed stop before recording this decision.",
      );
      return;
    }
    let controls: Record<string, unknown> = {};
    if (decision === "enabled") {
      try {
        const parsed = JSON.parse(String(form.get("controls")));
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error("invalid");
        }
        controls = parsed as Record<string, unknown>;
      } catch {
        setMessage("The approved readiness pack must be a valid JSON object.");
        return;
      }
    }
    const payload = {
      integrationId: status.integrationId,
      requestId: crypto.randomUUID(),
      decision,
      reason: String(form.get("reason")),
      controls,
    };
    setPendingPayload(payload);
    void sendDecision(payload);
  }

  return (
    <section className="operation-settings">
      <header className="operation-settings__header">
        <div>
          <span className="eyebrow">PILOT OPERATIONS / HELIUS</span>
          <h2>Provider control room.</h2>
          <p>
            Observe, stop and recover one exact integration. Approval alone
            never opens traffic; current monitor evidence is also required.
          </p>
        </div>
        <Status tone="default">HUMAN-CONTROLLED</Status>
      </header>

      {message ? (
        <div aria-live="polite" className="operation-settings__message">
          <strong>{uncertain ? "OUTCOME UNKNOWN" : "ACTION REQUIRED"}</strong>
          <span>{message}</span>
          {uncertain && pendingPayload ? (
            <button
              className="action-button action-button--secondary"
              disabled={saving}
              onClick={() => void sendDecision(pendingPayload)}
              type="button"
            >
              RETRY SAME REQUEST
            </button>
          ) : null}
        </div>
      ) : null}

      <TrackingDestinationSettings
        canApprove={canApproveDestinationHosts}
        draft={destinationApprovalDraft}
        hasActivePolicy={hasActiveDestinationPolicy}
        hosts={destinationHosts}
        projectId={projectId}
      />

      <section
        aria-labelledby="data-quality-heading"
        className={`data-quality-checkpoint data-quality-checkpoint--${checkpoint.variant}`}
      >
        <div className="data-quality-checkpoint__decision">
          <div className="data-quality-checkpoint__status">
            <span className="eyebrow">DATA QUALITY CHECKPOINT</span>
            <Status tone={checkpoint.tone}>{checkpoint.status}</Status>
          </div>
          <h2 id="data-quality-heading" tabIndex={-1}>
            {checkpoint.heading}
          </h2>
          <p>{checkpoint.summary}</p>
        </div>
        <div className="data-quality-checkpoint__context">
          <dl>
            <div>
              <dt>AFFECTED SOURCE</dt>
              <dd>{checkpoint.affected}</dd>
            </div>
            <div>
              <dt>LAST OBSERVATION</dt>
              <dd>
                {checkpoint.observedAt
                  ? timestampFormatter.format(new Date(checkpoint.observedAt))
                  : "NOT AVAILABLE"}
              </dd>
            </div>
          </dl>
          <div className="data-quality-checkpoint__action">
            <strong>NEXT ACTION</strong>
            <p>{checkpoint.action}</p>
            {checkpointTarget && checkpoint.linkLabel ? (
              <a className="action-button" href={checkpointTarget}>
                {checkpoint.linkLabel}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {statuses.length === 0 ? (
        <div className="operation-settings__empty">
          <strong>NO HELIUS INTEGRATION CONFIGURED</strong>
          <p>No provider control can be changed for this project.</p>
        </div>
      ) : (
        statuses.map((status) => (
          <article
            className="operation-card"
            id={`provider-control-${status.integrationId}`}
            key={status.integrationId}
          >
            <div className="operation-card__summary">
              <div>
                <span className="eyebrow">
                  {status.configuredEnvironment.toUpperCase()} / VERSION{" "}
                  {status.version ?? "NOT ISSUED"}
                </span>
                <h2>{stateCopy[status.healthState]}</h2>
              </div>
              <Status tone={toneFor(status.healthState)}>
                {status.operationallyEnabled ? "ENABLED" : "FAIL CLOSED"}
              </Status>
            </div>

            <dl className="operation-card__metrics">
              <div>
                <dt>HEALTH OBSERVED</dt>
                <dd>
                  {status.healthObservedAt
                    ? timestampFormatter.format(
                        new Date(status.healthObservedAt),
                      )
                    : "NOT AVAILABLE"}
                </dd>
              </div>
              <div>
                <dt>READINESS EXPIRES</dt>
                <dd>
                  {status.validUntil
                    ? timestampFormatter.format(new Date(status.validUntil))
                    : "NOT AVAILABLE"}
                </dd>
              </div>
              <div>
                <dt>DELIVERIES</dt>
                <dd>
                  {numberFormatter.format(status.retainedDeliveryCount)} /{" "}
                  {numberFormatter.format(status.deliveryLimit)}
                </dd>
              </div>
              <div>
                <dt>RAW EVIDENCE</dt>
                <dd>
                  {numberFormatter.format(status.retainedRawBytes)} /{" "}
                  {numberFormatter.format(status.rawByteLimit)} BYTES
                </dd>
              </div>
            </dl>

            {status.controlRequired && status.canManage ? (
              <form
                className="operation-card__form"
                onSubmit={(event) => submit(event, status)}
                onChange={(event) => {
                  const form = new FormData(event.currentTarget);
                  setRequiredInput((previous) => ({
                    ...previous,
                    [status.integrationId]: {
                      enabled: form.get("decision") === "enabled",
                      packMissing: !String(form.get("controls") ?? "").trim(),
                      stopMissing: form.get("confirmStop") !== "confirmed",
                    },
                  }));
                }}
              >
                <label>
                  DECISION
                  <select
                    defaultValue={
                      status.operationallyEnabled ? "disabled" : "enabled"
                    }
                    name="decision"
                  >
                    <option value="disabled">Stop integration</option>
                    <option value="enabled">
                      Enable / recover from approved pack
                    </option>
                  </select>
                </label>
                <label>
                  <span>
                    OPERATOR REASON
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    minLength={8}
                    name="reason"
                    required
                    rows={2}
                  />
                </label>
                <label>
                  <span>
                    APPROVED READINESS PACK (JSON; REQUIRED FOR ENABLE /
                    RECOVER)
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    autoComplete="off"
                    name="controls"
                    aria-required={
                      requiredInput[status.integrationId]?.enabled ??
                      !status.operationallyEnabled
                    }
                    data-required-missing={
                      requiredInput[status.integrationId]?.packMissing ?? true
                    }
                    rows={6}
                    spellCheck={false}
                  />
                </label>
                <label className="operation-card__confirmation">
                  <input
                    name="confirmStop"
                    type="checkbox"
                    value="confirmed"
                    aria-required={
                      !(
                        requiredInput[status.integrationId]?.enabled ??
                        !status.operationallyEnabled
                      )
                    }
                    data-required-missing={
                      requiredInput[status.integrationId]?.stopMissing ?? true
                    }
                  />
                  <span>
                    I confirm that a stop decision immediately fails closed for
                    new callback and canonical persistence.
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                </label>
                {status.healthState === "expired" ? (
                  <p className="operation-card__notice">
                    Readiness or credential approval has expired. Review and
                    retain a new same-scope pack before recovery.
                  </p>
                ) : null}
                <p>
                  The pack must reference the exact private PIL-01 decision and
                  its same-scope approvals. Never paste credentials, customer
                  data or wallet identifiers here.
                </p>
                <button
                  className="action-button"
                  disabled={saving || uncertain}
                  type="submit"
                >
                  {saving ? "RETAINING…" : "REVIEW AND RECORD DECISION"}
                </button>
              </form>
            ) : (
              <p className="operation-card__notice">
                {status.controlRequired
                  ? "Manager access is required to change this boundary."
                  : "This sanitized demo integration is outside the customer/mainnet control boundary."}
              </p>
            )}
          </article>
        ))
      )}
    </section>
  );
}
