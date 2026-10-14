"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { useHydrated } from "@/lib/use-hydrated";
import styles from "./local-devnet-activation-handoff.module.css";

const handoffSchema = z.strictObject({
  status: z.enum(["blocked", "ready", "live"]),
  campaignId: z.uuid(),
  campaignStatus: z.string(),
  commercialPlanVersionId: z.uuid(),
  commercialSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  rule: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    configuredEnvironment: z.literal("devnet"),
    destinationAddress: z.string(),
    nativeAmountLamports: z.literal("1"),
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveUntil: z.iso.datetime({ offset: true }).nullable(),
  }),
  measurement: z.strictObject({
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
  }),
  brief: z
    .strictObject({ version: z.number().int().positive(), status: z.string() })
    .nullable(),
  destination: z.strictObject({
    url: z.string().url(),
    capabilityExpiresAt: z.iso.datetime({ offset: true }),
  }),
  assets: z.array(
    z.strictObject({
      contentAssetId: z.uuid(),
      creatorId: z.uuid(),
      label: z.string(),
      trackedLinkId: z.uuid().nullable(),
      linkExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
  blockers: z.array(z.string()),
});
type Handoff = z.infer<typeof handoffSchema>;
type Transport = (
  input: Record<string, unknown>,
  read?: boolean,
) => Promise<unknown>;

async function request(input: Record<string, unknown>, read = false) {
  const endpoint = "/api/isolated-devnet-rehearsal";
  const response = await fetch(
    endpoint +
      (read ? `?${new URLSearchParams(input as Record<string, string>)}` : ""),
    {
      method: read ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(read
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
    },
  );
  if (!response.ok)
    throw new Error(
      "The retained activation state could not be confirmed. Check status before retrying.",
    );
  return response.json() as Promise<unknown>;
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

// Called only by the async user-action handler, never during render.
function hasExpired(expiresAtMs: number) {
  return expiresAtMs <= Date.now();
}

export function LocalDevnetActivationHandoff({
  campaignId,
  canManage,
  transport = request,
}: {
  campaignId: string;
  canManage: boolean;
  transport?: Transport;
}) {
  const [transportScope, setTransportScope] = useState({
    transport,
    revision: 0,
  });
  if (transportScope.transport !== transport) {
    setTransportScope({ transport, revision: transportScope.revision + 1 });
  }
  // A context change starts with fresh state; private URLs and pending status
  // from the previous campaign or permission scope must not survive it.
  return (
    <ActivationHandoff
      key={`${campaignId}:${canManage}:${transportScope.revision}`}
      campaignId={campaignId}
      canManage={canManage}
      transport={transport}
    />
  );
}

function ActivationHandoff({
  campaignId,
  canManage,
  transport: request,
}: {
  campaignId: string;
  canManage: boolean;
  transport: Transport;
}) {
  const hydrated = useHydrated();
  const requestIds = useRef(new Map<string, string>());
  const transitionRequestId = useRef<string | undefined>(undefined);
  const copyGeneration = useRef(0);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Loading retained activation state…");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [manualLink, setManualLink] = useState<{
    campaignId: string;
    assetId: string;
    url: string;
    expiresAt: string;
  } | null>(null);

  useLayoutEffect(() => {
    copyGeneration.current += 1;
    return () => {
      copyGeneration.current += 1;
    };
  }, [campaignId, canManage, request]);

  async function load() {
    setManualLink(null);
    setBusy(true);
    try {
      const value = handoffSchema.parse(
        await request({ action: "readActivation", campaignId }, true),
      );
      setHandoff(value);
      setMessage(
        value.status === "live"
          ? "Campaign activation is recorded. No wallet action has occurred."
          : value.status === "ready"
            ? "Exact rule, timing, brief and participant links are ready for your activation decision."
            : "Resolve the visible blockers before activation.",
      );
    } catch (error) {
      setHandoff(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Activation state is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let current = true;
    request({ action: "readActivation", campaignId }, true)
      .then((response) => handoffSchema.parse(response))
      .then((value) => {
        if (!current) return;
        setHandoff(value);
        setMessage(
          value.status === "live"
            ? "Campaign activation is recorded. No wallet action has occurred."
            : value.status === "ready"
              ? "Exact rule, timing, brief and participant links are ready for your activation decision."
              : "Resolve the visible blockers before activation.",
        );
      })
      .catch((error: unknown) => {
        if (!current) return;
        setHandoff(null);
        setMessage(
          error instanceof Error
            ? error.message
            : "Activation state is unavailable.",
        );
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [campaignId, canManage, request]);

  useEffect(() => {
    if (!manualLink) return;
    const timeout = setTimeout(
      () => {
        setManualLink(null);
        setMessage(
          "This participant handoff has expired. Check retained status before requesting a new link.",
        );
      },
      Math.max(
        0,
        Math.min(2_147_483_647, Date.parse(manualLink.expiresAt) - Date.now()),
      ),
    );
    return () => clearTimeout(timeout);
  }, [manualLink]);

  async function issueLink(contentAssetId: string) {
    if (busy || !canManage) return;
    const generationRequestId =
      requestIds.current.get(contentAssetId) ?? crypto.randomUUID();
    requestIds.current.set(contentAssetId, generationRequestId);
    setBusy(true);
    setMessage("Issuing the exact participant link…");
    try {
      await request({
        action: "issueLink",
        campaignId,
        contentAssetId,
        generationRequestId,
      });
      requestIds.current.delete(contentAssetId);
      await load();
    } catch {
      setMessage(
        "Link status is uncertain. Check retained status before attempting another issue request.",
      );
      setBusy(false);
    }
  }

  async function copyLink(contentAssetId: string) {
    if (busy || !canManage) return;
    const generation = copyGeneration.current;
    const current = () => copyGeneration.current === generation;
    setBusy(true);
    setManualLink(null);
    setMessage("Checking the retained link before copying…");
    try {
      const signed = z
        .strictObject({
          url: z.string().url(),
          expiresAt: z.iso.datetime({ offset: true }),
        })
        .parse(
          await request(
            { action: "readSignedLink", campaignId, contentAssetId },
            true,
          ),
        );
      if (!current()) return;
      const expiresAtMs = Math.min(
        Date.parse(signed.expiresAt),
        Date.parse(handoff!.destination.capabilityExpiresAt),
        Date.parse(handoff!.measurement.endedAt),
      );
      if (hasExpired(expiresAtMs)) throw new Error("Expired handoff");
      // The browser clipboard may report success without transferring to the
      // founder's wallet-enabled browser. Always retain the manual handoff.
      setManualLink({
        campaignId,
        assetId: contentAssetId,
        url: signed.url,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(signed.url);
        if (!current()) return;
        if (hasExpired(expiresAtMs)) throw new Error("Expired handoff");
        setMessage(
          `Private test link copied. Paste it into your wallet-enabled browser. Copying does not open the participant page.`,
        );
      } catch {
        if (!current()) return;
        if (hasExpired(expiresAtMs)) throw new Error("Expired handoff");
        setMessage(
          "Clipboard unavailable. Select the private test link below to copy it manually.",
        );
      }
    } catch {
      if (!current()) return;
      setManualLink(null);
      setMessage(
        "The signed link could not be confirmed. Check retained status before trying again.",
      );
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function activate() {
    if (
      busy ||
      !canManage ||
      handoff?.status !== "ready" ||
      !acknowledged ||
      reason.trim().length < 8
    )
      return;
    transitionRequestId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage("Recording your activation decision…");
    try {
      await request({
        action: "activate",
        campaignId,
        transitionRequestId: transitionRequestId.current,
        reason: reason.trim(),
        acknowledged: true,
      });
      transitionRequestId.current = undefined;
      await load();
    } catch {
      setMessage(
        "Activation status is uncertain. Check retained status before submitting another decision.",
      );
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.root}
      aria-labelledby="devnet-activation-title"
      aria-busy={busy}
    >
      <header className={styles.header}>
        <div>
          <small>Local devnet · Human decision</small>
          <h2 id="devnet-activation-title">Campaign Activation Handoff</h2>
          <p>
            Confirm the exact campaign path before any public callback or wallet
            action. Commercial approval is not activation.
          </p>
        </div>
        <span
          className={`${styles.status} ${handoff?.status === "ready" || handoff?.status === "live" ? styles.ready : ""}`}
        >
          {handoff?.status ?? "Unavailable"}
        </span>
      </header>

      {!canManage ? (
        <p role="status">
          Read-only access. A campaign manager must issue participant links and
          record activation.
        </p>
      ) : null}

      {handoff ? (
        <>
          <dl className={styles.steps}>
            <div>
              <dt>1 · Commercial plan</dt>
              <dd>Approved and immutable</dd>
            </div>
            <div>
              <dt>2 · Brief</dt>
              <dd>
                {handoff.brief
                  ? `Version ${handoff.brief.version} · ${handoff.brief.status}`
                  : "Not prepared"}
              </dd>
            </div>
            <div>
              <dt>3 · Measurement</dt>
              <dd>Ends {date(handoff.measurement.endedAt)} UTC</dd>
            </div>
          </dl>

          {handoff.blockers.length > 0 ? (
            <ul className={styles.blockers} aria-label="Activation blockers">
              {handoff.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}

          <section aria-labelledby="participant-links-title">
            <h3 id="participant-links-title">Participant Links</h3>
            <p>
              One signed attribution path per included deliverable. Issuing a
              link does not contact a provider or wallet.
            </p>
            <div className={styles.assets}>
              {handoff.assets.length === 0 ? (
                <p>
                  No participant deliverables are available. Prepare the
                  campaign content before issuing a link.
                </p>
              ) : null}
              {handoff.assets.map((asset) => (
                <article className={styles.asset} key={asset.contentAssetId}>
                  <div>
                    <strong>{asset.label}</strong>
                    <p>
                      {asset.trackedLinkId
                        ? `Ready · expires ${date(asset.linkExpiresAt!)} UTC`
                        : "No participant link issued"}
                    </p>
                  </div>
                  <div className={styles.assetActions}>
                    {asset.trackedLinkId ? (
                      <button
                        type="button"
                        aria-label={`Copy signed link for ${asset.label}`}
                        disabled={
                          !hydrated ||
                          busy ||
                          !canManage ||
                          handoff.status === "blocked" ||
                          handoff.blockers.length > 0
                        }
                        onClick={() => void copyLink(asset.contentAssetId)}
                      >
                        Copy Link
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Issue link for ${asset.label}`}
                        disabled={
                          !hydrated ||
                          busy ||
                          !canManage ||
                          handoff.brief?.status !== "approved"
                        }
                        onClick={() => void issueLink(asset.contentAssetId)}
                      >
                        Issue Link
                      </button>
                    )}
                  </div>
                  {canManage &&
                  manualLink?.campaignId === campaignId &&
                  manualLink.assetId === asset.contentAssetId ? (
                    <div className={styles.manualLink}>
                      <label
                        htmlFor={`participant-link-${asset.contentAssetId}`}
                      >
                        Signed participant link · private test only
                      </label>
                      <input
                        id={`participant-link-${asset.contentAssetId}`}
                        type="url"
                        name="signedParticipantLink"
                        autoComplete="off"
                        spellCheck={false}
                        readOnly
                        value={manualLink.url}
                        aria-describedby={`participant-hint-${asset.contentAssetId}`}
                        translate="no"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <p id={`participant-hint-${asset.contentAssetId}`}>
                        Select and copy this entire link, then paste it into the
                        browser with your wallet. Do not use the campaign admin
                        URL or the callback below. Handoff expires no later than{" "}
                        {date(manualLink.expiresAt)} UTC; the public session may
                        close earlier. Wallet proof and consent remain separate.
                      </p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          {handoff.status !== "live" ? (
            <section
              className={styles.activation}
              aria-label="Activation decision"
            >
              <label htmlFor="activation-reason">
                Activation reason
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </label>
              <textarea
                id="activation-reason"
                name="activationReason"
                aria-required="true"
                data-required-missing={reason.trim().length < 8}
                autoComplete="off"
                aria-describedby="activation-reason-hint"
                maxLength={240}
                value={reason}
                disabled={busy || !canManage}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example: approved brief, dates & links checked…"
              />
              <small id="activation-reason-hint">
                Enter 8–240 characters. This reason is retained in the audit
                trail.
              </small>
              <label className={styles.acknowledgement}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  aria-required="true"
                  data-required-missing={!acknowledged}
                  disabled={busy || !canManage}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I reviewed the selected terms, exact receiver, one-lamport
                  rule, dates, approved brief and participant links. This is a
                  campaign activation only—not a payment, provider change or
                  wallet transaction.
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.retry}
                  disabled={!hydrated || busy}
                  onClick={() => void load()}
                >
                  Check Retained Status
                </button>
                <button
                  type="button"
                  disabled={
                    !hydrated ||
                    busy ||
                    !canManage ||
                    handoff.status !== "ready" ||
                    !acknowledged ||
                    reason.trim().length < 8
                  }
                  onClick={() => void activate()}
                >
                  Activate Campaign
                </button>
              </div>
            </section>
          ) : null}

          <details className={styles.evidence}>
            <summary>Exact Retained Evidence</summary>
            <p>
              Rule: {handoff.rule.name} · devnet · finalized native transfer · 1
              lamport
            </p>
            <p>
              Receiver:{" "}
              <code translate="no">{handoff.rule.destinationAddress}</code>
            </p>
            <p>
              Receiver callback (not a participant link):{" "}
              <code translate="no">{handoff.destination.url}</code>
            </p>
            <p>
              Commercial snapshot:{" "}
              <code translate="no">{handoff.commercialSnapshotHash}</code>
            </p>
          </details>
        </>
      ) : (
        <button
          type="button"
          className={styles.retry}
          disabled={!hydrated || busy}
          onClick={() => void load()}
        >
          Retry retained status
        </button>
      )}
      <p className={styles.message} role={handoff ? "status" : "alert"}>
        {message}
      </p>
    </section>
  );
}
