"use client";

import {
  creatorEvidenceRecordSchema,
  type CreatorDirectoryRecord,
  type CreatorEvidenceRecord,
  type CreatorRateQuoteRecord,
} from "@landed/contracts";
import { ActionButton, Eyebrow, Status } from "@landed/ui";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const evidenceResponseSchema = z.object({
  creator: creatorEvidenceRecordSchema,
});

type DrawerState =
  | { kind: "loading" }
  | { kind: "ready"; creator: CreatorEvidenceRecord }
  | { kind: "permission" }
  | { kind: "error"; reference: string | null };

const channelLabels: Record<
  CreatorDirectoryRecord["channels"][number]["type"],
  string
> = {
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  podcast: "Podcast",
  telegram: "Telegram",
  discord: "Discord",
  other: "Other",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatAudience(value: number | null) {
  if (value === null) {
    return "NOT RECORDED";
  }

  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatQuote(quote: CreatorRateQuoteRecord) {
  const symbols = {
    GBP: "£",
    USD: "$",
    EUR: "€",
  } as const;
  const amountMinor = BigInt(quote.amountMinor);
  const major = amountMinor / 100n;
  const minor = amountMinor % 100n;
  const majorDisplay = new Intl.NumberFormat("en-GB").format(major);

  return `${symbols[quote.currencyCode]}${majorDisplay}${
    minor === 0n ? "" : `.${minor.toString().padStart(2, "0")}`
  } ${quote.currencyCode}`;
}

function DrawerLoading({ creator }: { creator: CreatorDirectoryRecord }) {
  return (
    <div className="creator-evidence-drawer__state" role="status">
      <Eyebrow>CREATOR EVIDENCE</Eyebrow>
      <h2 id="creator-evidence-title">{creator.displayName}</h2>
      <div className="loading-line" />
      <div className="loading-panel" />
      <span>Preparing project-scoped evidence…</span>
    </div>
  );
}

function EvidenceEmpty({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="creator-evidence-empty">
      <span>{label}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function CreatorEvidenceContent({
  creator,
  isSelected,
  onToggleSelection,
  selectionAvailable = true,
}: {
  creator: CreatorEvidenceRecord;
  isSelected: boolean;
  onToggleSelection: () => void;
  selectionAvailable?: boolean;
}) {
  const primaryChannel =
    creator.channels.find((channel) => channel.isPrimary) ??
    creator.channels[0];
  const [currentRate, ...previousRates] = creator.rateQuotes;

  return (
    <>
      <header className="creator-evidence-drawer__identity">
        <div className="creator-evidence-drawer__avatar" aria-hidden="true">
          {creator.displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase()}
        </div>
        <div>
          <Eyebrow>CREATOR EVIDENCE</Eyebrow>
          <h2 id="creator-evidence-title">{creator.displayName}</h2>
          <p>{primaryChannel?.handle ?? "NO HANDLE RECORDED"}</p>
          <div className="creator-evidence-drawer__tags">
            <Status>{creator.relationshipStatus.toUpperCase()}</Status>
            {creator.tags.map((tag) => (
              <span key={tag.id}>{tag.name}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="creator-evidence-drawer__action">
        <ActionButton
          disabled={!selectionAvailable}
          onClick={onToggleSelection}
          type="button"
        >
          {!selectionAvailable
            ? "Planning unavailable in this demo"
            : isSelected
              ? "REMOVE FROM SELECTION"
              : "SELECT FOR BASKET"}
        </ActionButton>
        <span>Selection alone does not create or approve a campaign plan.</span>
      </div>

      <section className="creator-evidence-section">
        <Eyebrow>01 / PROFILE</Eyebrow>
        <h3>About</h3>
        {creator.profileSummary ? (
          <>
            <p className="creator-evidence-section__body">
              {creator.profileSummary}
            </p>
            <small className="creator-evidence-section__source">
              {creator.profileSourceLabel ?? "SOURCE NOT LABELLED"} /{" "}
              {creator.profileObservedAt
                ? formatDate(creator.profileObservedAt)
                : "NO OBSERVATION DATE"}
            </small>
          </>
        ) : (
          <EvidenceEmpty label="PROFILE" title="NO SUMMARY RECORDED">
            Add a sourced creator note before using profile narrative in a
            commercial decision.
          </EvidenceEmpty>
        )}
      </section>

      <section className="creator-evidence-section">
        <Eyebrow>02 / DISTRIBUTION</Eyebrow>
        <h3>Platforms and audience</h3>
        {creator.channels.length > 0 ? (
          <div className="creator-evidence-list">
            {creator.channels.map((channel) => (
              <div className="creator-evidence-list__row" key={channel.id}>
                <div>
                  <strong>{channelLabels[channel.type]}</strong>
                  {channel.profileUrl ? (
                    <a
                      href={channel.profileUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {channel.handle}
                    </a>
                  ) : (
                    <span>{channel.handle}</span>
                  )}
                </div>
                <div>
                  <strong>{formatAudience(channel.audienceSize)}</strong>
                  <span>
                    {channel.observedAt
                      ? `${formatDate(channel.observedAt)} / ${
                          channel.sourceLabel ?? "SOURCE NOT LABELLED"
                        }`
                      : "NO DATED AUDIENCE EVIDENCE"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EvidenceEmpty label="PLATFORMS" title="NO CHANNELS RECORDED">
            Add a channel before comparing audience or distribution fit.
          </EvidenceEmpty>
        )}
      </section>

      <section className="creator-evidence-section">
        <Eyebrow>03 / COMMERCIAL</Eyebrow>
        <h3>Rate and quote history</h3>
        {currentRate ? (
          <>
            <div className="creator-current-rate">
              <span>LATEST INDICATIVE PACKAGE</span>
              <strong>{formatQuote(currentRate)}</strong>
              <p>{currentRate.packageLabel}</p>
              <p>{currentRate.deliverableSummary}</p>
              <small>
                Quoted {formatDate(currentRate.quotedAt)}
                {currentRate.validUntil
                  ? ` / valid until ${formatDate(currentRate.validUntil)}`
                  : " / no expiry recorded"}
              </small>
              <small>{currentRate.sourceLabel}</small>
            </div>
            <div className="creator-rate-history">
              <span>PREVIOUS QUOTES</span>
              {previousRates.length > 0 ? (
                previousRates.map((quote) => (
                  <div key={quote.id}>
                    <strong>{formatQuote(quote)}</strong>
                    <span>{formatDate(quote.quotedAt)}</span>
                    <p>{quote.packageLabel}</p>
                    <small>
                      {quote.deliverableSummary} / {quote.sourceLabel}
                    </small>
                  </div>
                ))
              ) : (
                <p>No earlier comparable quote evidence.</p>
              )}
            </div>
          </>
        ) : (
          <EvidenceEmpty label="COMMERCIAL" title="NO RATE EVIDENCE">
            Unknown pricing remains unavailable rather than being estimated or
            converted to zero.
          </EvidenceEmpty>
        )}
      </section>

      <section className="creator-evidence-section">
        <Eyebrow>04 / OWNERSHIP</Eyebrow>
        <h3>Contact</h3>
        {creator.contactAccess === "available" && creator.contact ? (
          <div className="creator-contact">
            <strong>{creator.contact.contactName}</strong>
            <span>{creator.contact.contactRole ?? "ROLE NOT RECORDED"}</span>
            <a href={`mailto:${creator.contact.email}`}>
              {creator.contact.email}
            </a>
            <small>
              Observed {formatDate(creator.contact.observedAt)} /{" "}
              {creator.contact.sourceLabel}
            </small>
          </div>
        ) : creator.contactAccess === "restricted" ? (
          <EvidenceEmpty label="PROTECTED CONTACT" title="MANAGER ACCESS ONLY">
            Creator contact details are separated from general analytics and
            hidden for this role.
          </EvidenceEmpty>
        ) : (
          <EvidenceEmpty label="CONTACT" title="NO CONTACT RECORDED">
            No protected owner or commercial contact has been added.
          </EvidenceEmpty>
        )}
      </section>

      <section className="creator-evidence-section">
        <Eyebrow>05 / OUTCOMES</Eyebrow>
        <h3>Campaign performance</h3>
        <EvidenceEmpty label="HISTORIC PERFORMANCE" title="NO ISSUED EVIDENCE">
          Qualified wallets, CPA and revenue appear here only after an issued
          report references eligible attribution evidence.
        </EvidenceEmpty>
      </section>

      <section className="creator-evidence-section">
        <Eyebrow>06 / INTELLIGENCE</Eyebrow>
        <h3>Landed Score</h3>
        <EvidenceEmpty label="PROJECT-SPECIFIC FORECAST" title="NOT SCORED">
          No black-box score is shown. A future score must expose its evidence,
          time window, sample size, confidence and model version.
        </EvidenceEmpty>
      </section>
    </>
  );
}

export function CreatorEvidenceDrawer({
  creator,
  isSelected,
  onClose,
  onToggleSelection,
  selectionAvailable = true,
  projectId,
}: {
  creator: CreatorDirectoryRecord;
  isSelected: boolean;
  onClose: () => void;
  onToggleSelection: () => void;
  selectionAvailable?: boolean;
  projectId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DrawerState>({ kind: "loading" });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/projects/${projectId}/creators/${creator.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 403) {
          setState({ kind: "permission" });
          return;
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            reference?: unknown;
          } | null;
          setState({
            kind: "error",
            reference:
              typeof body?.reference === "string" ? body.reference : null,
          });
          return;
        }

        const parsed = evidenceResponseSchema.parse(await response.json());
        setState({ kind: "ready", creator: parsed.creator });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({ kind: "error", reference: null });
      });

    return () => controller.abort();
  }, [attempt, creator.id, projectId]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable.at(-1)!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="creator-evidence-layer">
      <button
        aria-label="Close creator evidence backdrop"
        className="creator-evidence-scrim"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-describedby="creator-evidence-description"
        aria-labelledby="creator-evidence-title"
        aria-modal="true"
        className="creator-evidence-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <p className="sr-only" id="creator-evidence-description">
          Project-scoped creator, commercial and evidence details.
        </p>
        <button
          aria-label="Close creator evidence"
          className="creator-evidence-drawer__close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          CLOSE
        </button>

        {state.kind === "loading" ? <DrawerLoading creator={creator} /> : null}

        {state.kind === "permission" ? (
          <div className="creator-evidence-drawer__state">
            <Eyebrow>PROJECT ACCESS REQUIRED</Eyebrow>
            <h2 id="creator-evidence-title">Evidence is not available.</h2>
            <p>No creator, contact or commercial evidence has been exposed.</p>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="creator-evidence-drawer__state">
            <Eyebrow>DATA INTERRUPTED</Eyebrow>
            <h2 id="creator-evidence-title">
              Creator evidence could not be prepared.
            </h2>
            <p>
              Retry the project-scoped request.
              {state.reference ? ` Reference ${state.reference}.` : ""}
            </p>
            <ActionButton
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((current) => current + 1);
              }}
              type="button"
            >
              RETRY
            </ActionButton>
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <CreatorEvidenceContent
            creator={state.creator}
            isSelected={isSelected}
            onToggleSelection={onToggleSelection}
            selectionAvailable={selectionAvailable}
          />
        ) : null}
      </aside>
    </div>
  );
}
