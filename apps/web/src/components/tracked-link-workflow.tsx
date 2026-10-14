"use client";

import type {
  CampaignStatus,
  ContentAssetRecord,
  TrackedLinkRecord,
} from "@landed/contracts";
import { ActionButton, Status } from "@landed/ui";
import { useRouter } from "next/navigation";
import { FormEvent, useId, useRef, useState, useTransition } from "react";
import { TrackingLinkCard } from "./tracking-link-card";

type Props = {
  asset: ContentAssetRecord;
  canManage: boolean;
  campaignId: string;
  campaignStatus: CampaignStatus;
  defaultOpen?: boolean;
  projectId: string;
  signedUrl: string | null;
  signingReady: boolean;
  snapshotAt: string;
  restricted?: boolean;
  presentation?: "inline" | "card";
  creatorName?: string;
  theme?: "light" | "dark";
  secondaryAction?: boolean;
  syntheticEvidence?: boolean;
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

function countLabel(count: number, label: string) {
  const suffix = label === label.toUpperCase() ? "S" : "s";
  return `${count} ${label}${count === 1 ? "" : suffix}`;
}

function defaultExpiry() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  date.setUTCSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function unrevokedLink(links: TrackedLinkRecord[]) {
  return links.find(({ revocation }) => revocation === null) ?? null;
}

export function TrackedLinkWorkflow({
  asset,
  canManage,
  campaignId,
  campaignStatus,
  defaultOpen = false,
  projectId,
  signedUrl,
  signingReady,
  snapshotAt,
  restricted = false,
  presentation = "inline",
  creatorName = "",
  theme = "light",
  secondaryAction = false,
  syntheticEvidence = false,
}: Props) {
  const router = useRouter();
  const currentLink = unrevokedLink(asset.trackedLinks);
  const isExpired = currentLink
    ? new Date(currentLink.expiresAt).getTime() <=
      new Date(snapshotAt).getTime()
    : false;
  const isVerifiable = Boolean(
    !restricted &&
    currentLink &&
    currentLink.destinationPolicyActive &&
    !isExpired &&
    signedUrl,
  );
  const [destinationUrl, setDestinationUrl] = useState(
    presentation === "card"
      ? ""
      : (asset.publishedUrl ?? asset.submissionUrl ?? ""),
  );
  const destinationHelpId = useId();
  const expiryDetails = useRef<HTMLDetailsElement>(null);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [revocationReason, setRevocationReason] = useState(
    "Campaign destination has changed",
  );
  const [savedRevision, setSavedRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const requestInFlight = useRef(false);
  const retryRequest = useRef<{ key: string; requestId: string } | null>(null);
  const campaignIsOpen = ["approved", "live"].includes(campaignStatus);
  const canIssue =
    !restricted &&
    canManage &&
    campaignIsOpen &&
    signingReady &&
    currentLink === null;
  const canRevoke =
    !restricted && canManage && campaignIsOpen && currentLink !== null;
  const busy = isRequesting || isPending;

  async function mutate(
    method: "PATCH" | "POST",
    body: Record<string, unknown>,
    fallbackMessage: string,
  ) {
    if (requestInFlight.current) return;

    const requestKey = `${method}:${JSON.stringify(body)}`;
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
        `/api/projects/${projectId}/campaigns/${campaignId}/content-assets/${asset.id}/tracked-links`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, requestId }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        setError(result?.message ?? fallbackMessage);
        return;
      }

      retryRequest.current = null;
      setSavedRevision((revision) => revision + 1);
      startTransition(() => router.refresh());
    } catch {
      setError(`${fallbackMessage} Try again.`);
    } finally {
      requestInFlight.current = false;
      setIsRequesting(false);
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canIssue) return;

    await mutate(
      "POST",
      {
        action: "issue",
        destinationUrl: destinationUrl.trim(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
      "Tracked link could not be issued.",
    );
  }

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRevoke || !currentLink) return;

    await mutate(
      "PATCH",
      {
        action: "revoke",
        trackedLinkId: currentLink.id,
        reason: revocationReason,
      },
      "Tracked link could not be revoked.",
    );
  }

  const expiryField = (
    <label>
      <span>
        Link expiry
        <span
          className="required-field-marker"
          aria-hidden="true"
          title="Required"
        />
      </span>
      <input
        disabled={busy}
        required
        name="linkExpiry"
        autoComplete="off"
        type="datetime-local"
        value={expiresAt}
        onChange={(event) => setExpiresAt(event.target.value)}
        onInvalid={() => {
          if (expiryDetails.current) expiryDetails.current.open = true;
        }}
      />
      {presentation === "card" && (
        <small>
          Enter the time in your device’s local time zone. This does not change
          the campaign dates.
        </small>
      )}
    </label>
  );
  const expiryTime = new Date(expiresAt).getTime();
  const issueForm = (
    <form className="campaign-tracking-form" onSubmit={issue}>
      <label>
        <span>
          {presentation === "card"
            ? "Where should people go?"
            : "HTTPS destination"}
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </span>
        <input
          disabled={busy}
          placeholder="https://example.com/campaign…"
          required
          name="destinationUrl"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={
            presentation === "card" ? destinationHelpId : undefined
          }
          type="url"
          value={destinationUrl}
          onChange={(event) => setDestinationUrl(event.target.value)}
        />
      </label>
      {presentation === "card" && (
        <p id={destinationHelpId}>
          Paste your campaign landing page, sign-up page or app page, including
          https://. Use the page visitors should reach, not the creator’s social
          post or a wallet address. New websites need workspace-admin approval
          before a link can be created.
        </p>
      )}
      {presentation === "card" ? (
        <>
          <p>
            Link stops working:{" "}
            {Number.isFinite(expiryTime)
              ? formatDate(new Date(expiryTime).toISOString())
              : "Choose a valid expiry in Advanced."}
          </p>
          <details ref={expiryDetails}>
            <summary>Advanced · link expiry</summary>
            {expiryField}
          </details>
        </>
      ) : (
        expiryField
      )}
      <ActionButton disabled={busy} type="submit">
        {isRequesting
          ? "ISSUING…"
          : presentation === "card"
            ? "Create tracking link"
            : "ISSUE SIGNED LINK"}
      </ActionButton>
    </form>
  );
  const revokeForm = (
    <form className="campaign-tracking-revoke" onSubmit={revoke}>
      <label>
        <span>
          Revocation reason
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
          name="revocationReason"
          autoComplete="off"
          value={revocationReason}
          onChange={(event) => setRevocationReason(event.target.value)}
        />
      </label>
      <ActionButton
        className="campaign-tracking-revoke-button"
        disabled={busy}
        type="submit"
      >
        {isRequesting
          ? "REVOKING…"
          : presentation === "card"
            ? "Revoke link"
            : "REVOKE LINK"}
      </ActionButton>
    </form>
  );
  const history = (
    <ol className="campaign-tracking-history">
      {asset.trackedLinks.map((link) => (
        <li key={link.id}>
          <strong>
            KEY V{link.keyVersion} / {link.revocation ? "REVOKED" : "ISSUED"}
          </strong>
          <span>{link.destinationUrl}</span>
          <time dateTime={link.revocation?.revokedAt ?? link.issuedAt}>
            {link.revocation
              ? `REVOKED ${formatDate(link.revocation.revokedAt)}`
              : `ISSUED ${formatDate(link.issuedAt)}`}
          </time>
          <small>
            {countLabel(
              link.clickEvidence.eligibleRedirects,
              "SIGNATURE-VALID REDIRECT",
            )}
            {" / "}
            {countLabel(
              link.clickEvidence.ineligibleAttempts,
              "REJECTED ATTEMPT",
            )}
          </small>
          <small>
            {countLabel(
              link.clickQuality.pendingAssessment,
              "PENDING ASSESSMENT",
            )}
          </small>
          <small>
            {countLabel(link.clickQuality.qualifiedClicks, "QUALIFIED CLICK")}
            {" / "}
            {countLabel(link.clickQuality.duplicateClicks, "DUPLICATE")}
            {" / "}
            {countLabel(link.clickQuality.rejectedClicks, "QUALITY REJECTION")}
          </small>
          {link.revocation ? (
            <small>
              ACTOR {link.revocation.actorUserId} / {link.revocation.reason}
            </small>
          ) : null}
        </li>
      ))}
    </ol>
  );

  if (presentation === "card") {
    const unavailable = restricted
      ? "Live tracking is not enabled for this retained plan. Existing evidence remains available."
      : !canManage
        ? "Campaign manager access is required to issue or revoke tracking links. Retained evidence remains visible."
        : !campaignIsOpen
          ? "Links can be issued only while the campaign is approved or live."
          : !signingReady && !currentLink
            ? "Tracked-link signing must be configured before issuance."
            : null;
    return (
      <TrackingLinkCard
        secondaryAction={secondaryAction}
        asset={asset}
        creatorName={creatorName}
        theme={theme}
        snapshotAt={snapshotAt}
        currentLink={currentLink}
        isExpired={isExpired}
        isVerifiable={isVerifiable}
        restricted={restricted}
        canIssue={canIssue}
        canRevoke={canRevoke}
        signedUrl={isVerifiable ? signedUrl : null}
        unavailable={unavailable}
        busy={busy}
        error={error}
        savedRevision={savedRevision}
        editor={
          currentLink
            ? canRevoke
              ? revokeForm
              : null
            : canIssue
              ? issueForm
              : null
        }
        evidence={
          <>
            {syntheticEvidence && (
              <p role="note">
                <strong>Synthetic evidence.</strong> These visit counts,
                signatures, issuance records and sessions are simulated. No live
                tracking link or real signature is claimed.
              </p>
            )}
            {currentLink ? (
              <div className="campaign-tracking-current">
                <dl>
                  <div>
                    <dt>DESTINATION</dt>
                    <dd>{currentLink.destinationUrl}</dd>
                  </div>
                  <div>
                    <dt>ISSUED</dt>
                    <dd>{formatDate(currentLink.issuedAt)}</dd>
                  </div>
                  <div>
                    <dt>EXPIRY</dt>
                    <dd>{formatDate(currentLink.expiresAt)}</dd>
                  </div>
                  <div>
                    <dt>KEY VERSION</dt>
                    <dd>V{currentLink.keyVersion}</dd>
                  </div>
                  <div>
                    <dt>SIGNATURE-VALID REDIRECTS</dt>
                    <dd>{currentLink.clickEvidence.eligibleRedirects}</dd>
                    {currentLink.clickEvidence.firstObservedAt &&
                    currentLink.clickEvidence.lastObservedAt ? (
                      <small>
                        FIRST{" "}
                        {formatDate(currentLink.clickEvidence.firstObservedAt)}
                        {" / "}
                        LAST{" "}
                        {formatDate(currentLink.clickEvidence.lastObservedAt)}
                      </small>
                    ) : null}
                  </div>
                </dl>
                <section
                  aria-label="Click-quality decision"
                  className="campaign-click-quality"
                >
                  <div className="campaign-click-quality__heading">
                    <div>
                      <small>CLICK QUALITY</small>
                      <strong>
                        {currentLink.clickQuality.totalAssessed > 0
                          ? `RULE V${currentLink.clickQuality.ruleVersion}`
                          : currentLink.clickEvidence.totalAttempts === 0
                            ? "NO TRAFFIC"
                            : "ASSESSMENT PENDING"}
                      </strong>
                    </div>
                    <span>
                      {currentLink.clickQuality.duplicateWindowSeconds
                        ? `${Math.round(currentLink.clickQuality.duplicateWindowSeconds / 60)} MIN DEDUPLICATION WINDOW`
                        : "RAW EVIDENCE RETAINED"}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>QUALIFIED</dt>
                      <dd>{currentLink.clickQuality.qualifiedClicks}</dd>
                    </div>
                    <div>
                      <dt>DUPLICATE</dt>
                      <dd>{currentLink.clickQuality.duplicateClicks}</dd>
                    </div>
                    <div>
                      <dt>REJECTED</dt>
                      <dd>{currentLink.clickQuality.rejectedClicks}</dd>
                    </div>
                    <div>
                      <dt>PENDING</dt>
                      <dd>{currentLink.clickQuality.pendingAssessment}</dd>
                    </div>
                  </dl>
                  {currentLink.clickQuality.firstAssessedAt &&
                  currentLink.clickQuality.lastAssessedAt ? (
                    <small className="campaign-click-quality__freshness">
                      QUALITY FIRST{" "}
                      {formatDate(currentLink.clickQuality.firstAssessedAt)}
                      {" / "}
                      LAST {formatDate(currentLink.clickQuality.lastAssessedAt)}
                    </small>
                  ) : null}
                  <p>
                    Random, server-controlled deduplication only. No IP address
                    or device fingerprint is retained. Declared automated agents
                    are rejected, and every decision remains tied to its rule
                    version.
                  </p>
                </section>

                <p>
                  Raw redirects are not qualified results. Unassessed clicks
                  remain unknown.
                </p>
              </div>
            ) : (
              <p>No current tracking link. Retained history appears below.</p>
            )}
            {asset.trackedLinks.length > 0 ? (
              history
            ) : (
              <p>No tracking history recorded yet.</p>
            )}
          </>
        }
      />
    );
  }

  return (
    <div
      aria-busy={busy}
      className="campaign-tracking-control"
      id={`tracking-${asset.id}`}
    >
      <div className="campaign-tracking-summary">
        <div>
          <small>TRACKING LINK</small>
          <strong>
            {restricted
              ? "LIVE TRACKING GATED"
              : !currentLink
                ? "NOT ISSUED"
                : isExpired
                  ? "EXPIRED"
                  : !currentLink.destinationPolicyActive
                    ? "DESTINATION DISABLED"
                    : signedUrl
                      ? "SIGNED / CURRENT"
                      : "KEY UNAVAILABLE"}
          </strong>
          <span>
            {!currentLink
              ? "No attribution link is bound"
              : !currentLink.destinationPolicyActive
                ? "Project destination policy is inactive"
                : `KEY V${currentLink.keyVersion} / EXPIRES ${formatDate(currentLink.expiresAt)}`}
          </span>
        </div>
        <Status tone={isVerifiable ? "verified" : "action"}>
          {restricted
            ? "RETAINED EVIDENCE ONLY"
            : isVerifiable
              ? "READY"
              : "ACTION REQUIRED"}
        </Status>
      </div>

      {!canManage && !restricted ? (
        <p className="campaign-workflow-permission">
          Campaign manager access is required to issue or revoke tracking links.
          Retained evidence remains visible.
        </p>
      ) : null}

      <details
        className="campaign-tracking-foldout"
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
        open={isOpen}
      >
        <summary>
          {restricted
            ? "VIEW TRACKING EVIDENCE"
            : currentLink
              ? "MANAGE TRACKED LINK"
              : "ISSUE TRACKED LINK"}
        </summary>

        {currentLink ? (
          <div className="campaign-tracking-current">
            <dl>
              <div>
                <dt>DESTINATION</dt>
                <dd>{currentLink.destinationUrl}</dd>
              </div>
              <div>
                <dt>ISSUED</dt>
                <dd>{formatDate(currentLink.issuedAt)}</dd>
              </div>
              <div>
                <dt>EXPIRY</dt>
                <dd>{formatDate(currentLink.expiresAt)}</dd>
              </div>
              <div>
                <dt>KEY VERSION</dt>
                <dd>V{currentLink.keyVersion}</dd>
              </div>
              <div>
                <dt>SIGNATURE-VALID REDIRECTS</dt>
                <dd>{currentLink.clickEvidence.eligibleRedirects}</dd>
                {currentLink.clickEvidence.firstObservedAt &&
                currentLink.clickEvidence.lastObservedAt ? (
                  <small>
                    FIRST{" "}
                    {formatDate(currentLink.clickEvidence.firstObservedAt)}
                    {" / "}
                    LAST {formatDate(currentLink.clickEvidence.lastObservedAt)}
                  </small>
                ) : null}
              </div>
            </dl>
            <section
              aria-label="Click-quality decision"
              className="campaign-click-quality"
            >
              <div className="campaign-click-quality__heading">
                <div>
                  <small>CLICK QUALITY</small>
                  <strong>
                    {currentLink.clickQuality.totalAssessed > 0
                      ? `RULE V${currentLink.clickQuality.ruleVersion}`
                      : currentLink.clickEvidence.totalAttempts === 0
                        ? "NO TRAFFIC"
                        : "ASSESSMENT PENDING"}
                  </strong>
                </div>
                <span>
                  {currentLink.clickQuality.duplicateWindowSeconds
                    ? `${Math.round(currentLink.clickQuality.duplicateWindowSeconds / 60)} MIN DEDUPLICATION WINDOW`
                    : "RAW EVIDENCE RETAINED"}
                </span>
              </div>
              <dl>
                <div>
                  <dt>QUALIFIED</dt>
                  <dd>{currentLink.clickQuality.qualifiedClicks}</dd>
                </div>
                <div>
                  <dt>DUPLICATE</dt>
                  <dd>{currentLink.clickQuality.duplicateClicks}</dd>
                </div>
                <div>
                  <dt>REJECTED</dt>
                  <dd>{currentLink.clickQuality.rejectedClicks}</dd>
                </div>
                <div>
                  <dt>PENDING</dt>
                  <dd>{currentLink.clickQuality.pendingAssessment}</dd>
                </div>
              </dl>
              {currentLink.clickQuality.firstAssessedAt &&
              currentLink.clickQuality.lastAssessedAt ? (
                <small className="campaign-click-quality__freshness">
                  QUALITY FIRST{" "}
                  {formatDate(currentLink.clickQuality.firstAssessedAt)}
                  {" / "}
                  LAST {formatDate(currentLink.clickQuality.lastAssessedAt)}
                </small>
              ) : null}
              <p>
                Random, server-controlled deduplication only. No IP address or
                device fingerprint is retained. Declared automated agents are
                rejected, and every decision remains tied to its rule version.
              </p>
            </section>
            {!restricted &&
            !isExpired &&
            currentLink.destinationPolicyActive &&
            signedUrl ? (
              <>
                <label>
                  Signed public URL
                  <input readOnly value={signedUrl} />
                </label>
                <small className="campaign-tracking-scope">
                  {currentLink.clickEvidence.totalAttempts === 0
                    ? "Redirect active. No observed traffic yet. Qualified clicks remain unknown."
                    : currentLink.clickQuality.totalAssessed === 0
                      ? `${countLabel(currentLink.clickEvidence.totalAttempts, "raw attempt")} retained / quality assessment pending.`
                      : `${countLabel(currentLink.clickQuality.qualifiedClicks, "qualified click")} / ${countLabel(currentLink.clickQuality.duplicateClicks, "duplicate")} / ${countLabel(currentLink.clickQuality.rejectedClicks, "quality rejection")} under rule v${currentLink.clickQuality.ruleVersion}.`}
                </small>
              </>
            ) : null}
            {!restricted &&
            !isExpired &&
            currentLink.destinationPolicyActive &&
            !signedUrl ? (
              <p className="campaign-workflow-error" role="alert">
                Signing evidence is retained, but this key version is not
                available to render the public URL.
              </p>
            ) : null}
            {isExpired ? (
              <p className="campaign-workflow-permission">
                Revoke this expired record before issuing its replacement.
              </p>
            ) : null}
            {!isExpired && !currentLink.destinationPolicyActive ? (
              <p className="campaign-workflow-error" role="alert">
                This destination host was deactivated by a workspace admin.
                Revoke this link before issuing a replacement to an active host.
              </p>
            ) : null}
            {canRevoke ? revokeForm : null}
          </div>
        ) : canIssue ? (
          issueForm
        ) : canManage ? (
          <p className="campaign-workflow-permission">
            {!signingReady
              ? "Tracked-link signing must be configured before issuance."
              : !campaignIsOpen
                ? "Links can be issued only while the campaign is approved or live."
                : "Campaign manager access is required to issue this link."}
          </p>
        ) : null}

        {error ? (
          <p className="campaign-workflow-error" role="alert">
            {error}
          </p>
        ) : null}

        {asset.trackedLinks.length > 0 ? history : null}
      </details>
    </div>
  );
}
