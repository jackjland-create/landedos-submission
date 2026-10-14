"use client";

import { useState } from "react";
import Link from "next/link";

import clarity from "./clarity-reporting.module.css";
import styles from "./wallet-consent-review.module.css";

export const walletConsentReviewStates = [
  "ready",
  "loading",
  "expired",
  "error",
  "permission",
] as const;

export type WalletConsentReviewState =
  (typeof walletConsentReviewStates)[number];

type ReviewPhase = "proof" | "consent" | "handoff";

type WalletConsentReviewProps = {
  challengeStatement: string;
  consentStatement: string;
  historicalLookbackDays: number;
  initialPhase?: ReviewPhase;
  initialTheme?: "light" | "dark";
  state?: WalletConsentReviewState;
};

const sourceFacts = [
  ["Creator touch", "Helios launch guide"],
  ["Measurement window", "7 days from this qualified visit"],
  ["Network", "Devnet proposal, not active"],
] as const;

function StateView({
  state,
}: {
  state: Exclude<WalletConsentReviewState, "ready">;
}) {
  const copy = {
    loading: {
      eyebrow: "MEASUREMENT REVIEW",
      title: "Checking this campaign link…",
      detail:
        "The wallet request stays unavailable until the qualified visit is confirmed.",
    },
    expired: {
      eyebrow: "MEASUREMENT REVIEW / EXPIRED",
      title: "Open the creator link again",
      detail:
        "This campaign session is no longer eligible. No wallet request was opened and no consent was recorded.",
    },
    error: {
      eyebrow: "MEASUREMENT REVIEW / UNAVAILABLE",
      title: "Wallet verification could not start",
      detail:
        "Nothing was signed or stored. Return to the creator link and try again when the service is available.",
    },
    permission: {
      eyebrow: "MEASUREMENT REVIEW / NOT ELIGIBLE",
      title: "This link cannot request measurement",
      detail:
        "The campaign visit was not accepted for wallet measurement. No protected wallet information is shown.",
    },
  }[state];

  return (
    <main className={styles.state} aria-busy={state === "loading"}>
      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p>{copy.detail}</p>
      {state !== "loading" ? (
        <Link
          className={styles.secondaryAction}
          href="/visual-tests/wallet-consent/ready"
        >
          Return to review
        </Link>
      ) : (
        <div className={styles.loadingBar} aria-hidden="true" />
      )}
    </main>
  );
}

export function WalletConsentReview({
  challengeStatement,
  consentStatement,
  historicalLookbackDays,
  initialPhase = "proof",
  initialTheme = "light",
  state = "ready",
}: WalletConsentReviewProps) {
  const [theme, setTheme] = useState(initialTheme);
  const [phase, setPhase] = useState<ReviewPhase>(initialPhase);
  const [accepted, setAccepted] = useState(false);

  const step = phase === "proof" ? 1 : phase === "consent" ? 2 : 3;
  const progressLabel =
    phase === "proof"
      ? "Verify wallet control"
      : phase === "consent"
        ? "Choose measurement consent"
        : "Review the proposed action";

  function moveToPhase(nextPhase: ReviewPhase) {
    setPhase(nextPhase);
    const url = new URL(window.location.href);
    url.searchParams.set("phase", nextPhase);
    window.history.replaceState(null, "", url);
  }

  return (
    <section className={`${clarity.app} ${styles.page}`} data-theme={theme}>
      <a className={styles.skip} href="#wallet-review">
        Skip to wallet review
      </a>
      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/" translate="no">
          LANDED/OS
        </Link>
        <button
          aria-checked={theme === "dark"}
          aria-label="Dark mode"
          className={styles.themeToggle}
          onClick={() => {
            const nextTheme = theme === "dark" ? "light" : "dark";
            setTheme(nextTheme);
            const url = new URL(window.location.href);
            url.searchParams.set("theme", nextTheme);
            window.history.replaceState(null, "", url);
          }}
          role="switch"
          type="button"
        >
          <span aria-hidden="true" />
          {theme === "dark" ? "Dark" : "Light"}
        </button>
      </header>

      {state !== "ready" ? (
        <StateView state={state} />
      ) : (
        <main className={styles.workspace} id="wallet-review" tabIndex={-1}>
          <div className={styles.intro}>
            <div>
              <p className={styles.eyebrow}>HELIOS / MEASUREMENT REVIEW</p>
              <h1>Review wallet measurement</h1>
            </div>
            <p>
              Check each decision before continuing. This local preview will not
              open a wallet, request a signature, submit a transaction or store
              consent.
            </p>
          </div>

          <div className={styles.layout}>
            <aside
              aria-label="Campaign measurement context"
              className={styles.context}
            >
              <div>
                <p className={styles.eyebrow}>QUALIFIED VISIT</p>
                <h2>Your creator link is ready for review</h2>
              </div>
              <dl>
                {sourceFacts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.boundary}>
                Wallet addresses remain protected. They are not treated as
                unique people and are not shown in campaign analytics.
              </p>
            </aside>

            <section aria-labelledby="review-heading" className={styles.card}>
              <div className={styles.progress}>
                <span>0{step} / 03</span>
                <strong>{progressLabel}</strong>
              </div>

              {phase === "proof" ? (
                <div className={styles.phase}>
                  <div>
                    <p className={styles.eyebrow}>WALLET CONTROL</p>
                    <h2 id="review-heading">
                      A message signature, never a transaction
                    </h2>
                    <p>
                      Your wallet would sign the message below for this site. It
                      cannot move tokens, approve spending or reveal a seed
                      phrase.
                    </p>
                  </div>
                  <blockquote>{challengeStatement}</blockquote>
                  <div className={styles.safetyGrid}>
                    <span>No transaction</span>
                    <span>Five-minute request</span>
                    <span>Single use</span>
                  </div>
                  <button
                    className={styles.primaryAction}
                    onClick={() => moveToPhase("consent")}
                    type="button"
                  >
                    Continue to consent preview
                  </button>
                </div>
              ) : phase === "consent" ? (
                <div className={styles.phase}>
                  <div>
                    <p className={styles.eyebrow}>MEASUREMENT CONSENT</p>
                    <h2 id="review-heading">
                      You decide whether measurement starts
                    </h2>
                    <p>
                      Proof of wallet control and consent are separate. The
                      proposed scope includes up to {historicalLookbackDays}{" "}
                      days of relevant earlier activity and ends with this
                      campaign session.
                    </p>
                  </div>
                  <label className={styles.consentChoice}>
                    <input
                      checked={accepted}
                      autoComplete="off"
                      name="wallet-measurement-consent-preview"
                      onChange={(event) => setAccepted(event.target.checked)}
                      type="checkbox"
                    />
                    <span>{consentStatement}</span>
                  </label>
                  <p className={styles.microcopy}>
                    This checkbox changes only the local preview. It records no
                    consent and starts no monitoring.
                  </p>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryAction}
                      onClick={() => moveToPhase("proof")}
                      type="button"
                    >
                      Back
                    </button>
                    <button
                      className={styles.primaryAction}
                      disabled={!accepted}
                      onClick={() => moveToPhase("handoff")}
                      type="button"
                    >
                      Continue to action handoff
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.phase}>
                  <div>
                    <p className={styles.eyebrow}>ACTION HANDOFF</p>
                    <h2 id="review-heading">
                      The genuine devnet action is still gated
                    </h2>
                    <p>
                      The interface is ready for review. Live signing stays off
                      until the devnet chain binding, exact qualifying action
                      and provider source are approved.
                    </p>
                  </div>
                  <div className={styles.decision} role="status">
                    <span aria-hidden="true" />
                    <div>
                      <strong>No wallet action occurred</strong>
                      <p>
                        Nothing was signed, stored, submitted or attributed in
                        this preview.
                      </p>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryAction}
                      onClick={() => moveToPhase("consent")}
                      type="button"
                    >
                      Review consent again
                    </button>
                    <button
                      className={styles.primaryAction}
                      onClick={() => {
                        setAccepted(false);
                        moveToPhase("proof");
                      }}
                      type="button"
                    >
                      Restart local review
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      )}
    </section>
  );
}
