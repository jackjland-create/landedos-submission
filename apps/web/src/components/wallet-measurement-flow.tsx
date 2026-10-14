"use client";

import {
  walletMeasurementConsentStatement,
  walletMeasurementConsentVersion,
  walletNonceChallengeResponseSchema,
  walletSignatureProofResponseSchema,
  walletMeasurementConsentResponseSchema,
  walletMappingUnlinkResponseSchema,
  type WalletMeasurementConsentResponse,
} from "@landed/contracts";
import { getWallets } from "@wallet-standard/app";
import {
  StandardConnect,
  type StandardConnectFeature,
} from "@wallet-standard/features";
import {
  SolanaSignIn,
  type SolanaSignInFeature,
} from "@solana/wallet-standard-features";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import clarity from "./clarity-reporting.module.css";
import styles from "./wallet-consent-review.module.css";
import continuationStyles from "./hosted-continuation.module.css";

type WalletRegistry = ReturnType<typeof getWallets>;
type RegisteredWallet = ReturnType<WalletRegistry["get"]>[number];
type SupportedWallet = RegisteredWallet;
type Phase = "wallet" | "proof" | "consent" | "handoff" | "unlinked";

type WalletMeasurementFlowProps = {
  available: boolean;
  receiverAddress?: string;
  initialTheme?: "light" | "dark";
  continuationHostname?: string;
};

function supportsDevnetSignIn(
  wallet: RegisteredWallet,
): wallet is SupportedWallet {
  return (
    StandardConnect in wallet.features &&
    SolanaSignIn in wallet.features &&
    wallet.chains.includes("solana:devnet")
  );
}

function connectFeature(wallet: SupportedWallet) {
  return wallet.features[
    StandardConnect
  ] as StandardConnectFeature[typeof StandardConnect];
}

function signInFeature(wallet: SupportedWallet) {
  return wallet.features[
    SolanaSignIn
  ] as SolanaSignInFeature[typeof SolanaSignIn];
}

function bytesToBase64(bytes: Iterable<number>) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

async function parseJsonResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.message ?? "This step could not be completed.");
  }
  return body;
}

export function WalletMeasurementFlow({
  available,
  receiverAddress,
  initialTheme = "light",
  continuationHostname,
}: WalletMeasurementFlowProps) {
  const [theme, setTheme] = useState(initialTheme);
  const [wallets, setWallets] = useState<readonly SupportedWallet[]>([]);
  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<Phase>("wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consent, setConsent] =
    useState<WalletMeasurementConsentResponse | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const measurementActive = consent !== null && phase !== "unlinked";

  useEffect(() => {
    if (!available) return;
    const registry = getWallets();
    const refresh = () =>
      setWallets(registry.get().filter(supportsDevnetSignIn));
    refresh();
    const stopRegister = registry.on("register", refresh);
    const stopUnregister = registry.on("unregister", refresh);
    return () => {
      stopRegister();
      stopUnregister();
    };
  }, [available]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/wallet/consents", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (response.status === 204) return;
        const recovered = walletMeasurementConsentResponseSchema.parse(
          await parseJsonResponse(response),
        );
        if (!active) return;
        setConsent(recovered);
        setPhase("handoff");
      } catch {
        if (active) setRecoveryError(true);
      } finally {
        if (active) setRecoveryComplete(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [recoveryAttempt]);

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.name === selectedWalletName) ?? null,
    [selectedWalletName, wallets],
  );

  const step =
    phase === "wallet"
      ? 1
      : phase === "proof"
        ? 2
        : phase === "consent"
          ? 3
          : 4;

  async function proveWalletControl() {
    if (!selectedWallet) return;
    setBusy(true);
    setError(null);
    try {
      const connected = await connectFeature(selectedWallet).connect();
      const account = connected.accounts.find((candidate) =>
        candidate.chains.includes("solana:devnet"),
      );
      if (!account) {
        throw new Error("This wallet did not provide a Solana devnet account.");
      }

      const challengeResponse = await fetch("/api/wallet/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account.address }),
      });
      const challenge = walletNonceChallengeResponseSchema.parse(
        await parseJsonResponse(challengeResponse),
      );
      if (
        challenge.signInInput.chainId !== "solana:devnet" ||
        challenge.signInInput.address !== account.address ||
        challenge.signInInput.domain !== window.location.host ||
        new URL(challenge.signInInput.uri).origin !== window.location.origin ||
        challenge.signInInput.requestId !== challenge.challengeId ||
        challenge.signInInput.expirationTime !== challenge.expiresAt
      ) {
        throw new Error(
          "The wallet proof request did not match this devnet session.",
        );
      }
      const [signed] = await signInFeature(selectedWallet).signIn(
        challenge.signInInput,
      );
      if (!signed) throw new Error("The wallet did not return a signature.");

      const proofResponse = await fetch("/api/wallet/proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          signInInput: challenge.signInInput,
          signInOutput: {
            accountAddress: signed.account.address,
            accountPublicKey: bytesToBase64(signed.account.publicKey),
            signedMessage: bytesToBase64(signed.signedMessage),
            signature: bytesToBase64(signed.signature),
            ...(signed.signatureType
              ? { signatureType: signed.signatureType }
              : {}),
          },
        }),
      });
      const proof = walletSignatureProofResponseSchema.parse(
        await parseJsonResponse(proofResponse),
      );
      setProofId(proof.proofId);
      setPhase("consent");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Wallet control could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function acceptMeasurementConsent() {
    if (!proofId || !consentAccepted) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/wallet/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proofId,
          accepted: true,
          consentVersion: walletMeasurementConsentVersion,
        }),
      });
      const accepted = walletMeasurementConsentResponseSchema.parse(
        await parseJsonResponse(response),
      );
      setConsent(accepted);
      setPhase("handoff");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Measurement consent could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlinkWallet() {
    if (!consent) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/wallet/mappings/${consent.mappingId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unlinkRequestId: crypto.randomUUID() }),
        },
      );
      walletMappingUnlinkResponseSchema.parse(
        await parseJsonResponse(response),
      );
      setConfirmingUnlink(false);
      setPhase("unlinked");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The wallet relationship could not be unlinked.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${clarity.app} ${styles.page}`} data-theme={theme}>
      <a className={styles.skip} href="#wallet-measurement">
        Skip to wallet measurement
      </a>
      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/" translate="no">
          LANDED/OS
        </Link>
        <button
          aria-checked={theme === "dark"}
          aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
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

      <main className={styles.workspace} id="wallet-measurement" tabIndex={-1}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>HELIOS / CAMPAIGN MEASUREMENT</p>
            <h1>Connect with clear boundaries</h1>
          </div>
          <p>
            Prove wallet control, choose whether measurement starts, then review
            the exact devnet response. Each decision remains separate.
          </p>
        </div>

        {!recoveryComplete ? (
          <section className={styles.state} role="status">
            <p className={styles.eyebrow}>MEASUREMENT / CHECKING</p>
            <h2>Checking this campaign session</h2>
            <p>
              Looking for an existing consent decision before any wallet request
              is offered.
            </p>
          </section>
        ) : recoveryError ? (
          <section className={styles.state} role="alert">
            <p className={styles.eyebrow}>MEASUREMENT / RECOVERY</p>
            <h2>We could not confirm the current consent state</h2>
            <p>
              No new wallet request is available until this session check
              succeeds. Retry to restore any active unlink control.
            </p>
            <button
              className={styles.primaryAction}
              onClick={() => {
                setRecoveryComplete(false);
                setRecoveryError(false);
                setRecoveryAttempt((attempt) => attempt + 1);
              }}
              type="button"
            >
              Retry session check
            </button>
          </section>
        ) : (!available || !receiverAddress) && !consent ? (
          <section className={styles.state}>
            <p className={styles.eyebrow}>MEASUREMENT / UNAVAILABLE</p>
            <h2>The supervised devnet path is not configured</h2>
            <p>
              No wallet request is available. Open the campaign link again after
              the approved public receiver and devnet environment are
              configured.
            </p>
          </section>
        ) : (
          <div className={styles.layout}>
            <aside className={styles.context}>
              <div>
                <p className={styles.eyebrow}>QUALIFIED CAMPAIGN VISIT</p>
                <h2>Your measurement choices</h2>
              </div>
              <dl>
                <div>
                  <dt>Network</dt>
                  <dd>Solana devnet</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>Exactly 1 lamport</dd>
                </div>
                <div>
                  <dt>Revenue</dt>
                  <dd>Not mapped</dd>
                </div>
              </dl>
              <p className={styles.boundary}>
                Proof does not move funds. Consent can be withdrawn. The
                response transaction is not available in this build.
              </p>
            </aside>

            <section aria-live="polite" className={styles.card}>
              <div className={styles.progress}>
                <span>0{step} / 04</span>
                <strong>
                  {phase === "wallet"
                    ? "Choose a compatible wallet"
                    : phase === "proof"
                      ? "Verify wallet control"
                      : phase === "consent"
                        ? "Choose measurement consent"
                        : phase === "handoff"
                          ? "Review the campaign response"
                          : "Measurement stopped"}
                </strong>
              </div>

              <div className={styles.phase}>
                {phase === "wallet" || phase === "proof" ? (
                  <>
                    <div>
                      <p className={styles.eyebrow}>WALLET CONTROL</p>
                      <h2>A message signature, never a transaction</h2>
                      <p>
                        Choose a wallet that supports Solana devnet sign-in. The
                        proof is single-use and expires after five minutes.
                      </p>
                    </div>
                    {wallets.length === 0 ? (
                      <p className={styles.emptyWallets}>
                        No compatible Solana devnet wallet is available in this
                        browser. Nothing has been requested.
                      </p>
                    ) : (
                      <div className={styles.walletList}>
                        {wallets.map((wallet) => (
                          <button
                            aria-pressed={selectedWalletName === wallet.name}
                            className={styles.walletChoice}
                            key={wallet.name}
                            onClick={() => {
                              setSelectedWalletName(wallet.name);
                              setPhase("proof");
                              setError(null);
                            }}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className={styles.walletIcon}
                            >
                              {wallet.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span>{wallet.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={styles.safetyGrid}>
                      <span>No transaction</span>
                      <span>No seed phrase</span>
                      <span>Devnet only</span>
                    </div>
                    <button
                      className={styles.primaryAction}
                      disabled={!selectedWallet || busy}
                      onClick={proveWalletControl}
                      type="button"
                    >
                      {busy ? "Waiting for wallet…" : "Verify wallet control"}
                    </button>
                  </>
                ) : phase === "consent" ? (
                  <>
                    <div>
                      <p className={styles.eyebrow}>MEASUREMENT CONSENT</p>
                      <h2>
                        Proof succeeded. Measurement is still your choice.
                      </h2>
                      <p>
                        Accepting links this protected wallet to this qualified
                        campaign session. It does not authorize a transaction.
                      </p>
                    </div>
                    <label className={styles.consentChoice}>
                      <input
                        autoComplete="off"
                        checked={consentAccepted}
                        name="wallet-measurement-consent"
                        onChange={(event) =>
                          setConsentAccepted(event.target.checked)
                        }
                        type="checkbox"
                        aria-required="true"
                        data-required-missing={!consentAccepted}
                      />
                      <span>
                        {walletMeasurementConsentStatement}
                        <span
                          className="required-field-marker"
                          aria-hidden="true"
                          title="Required"
                        />
                      </span>
                    </label>
                    <div className={styles.actions}>
                      <button
                        className={styles.secondaryAction}
                        onClick={() => setPhase("proof")}
                        type="button"
                      >
                        Review wallet proof
                      </button>
                      <button
                        className={styles.primaryAction}
                        disabled={!consentAccepted || busy}
                        onClick={acceptMeasurementConsent}
                        type="button"
                      >
                        {busy ? "Recording consent…" : "Start measurement"}
                      </button>
                    </div>
                  </>
                ) : phase === "handoff" ? (
                  <>
                    <div>
                      <p className={styles.eyebrow}>CAMPAIGN RESPONSE</p>
                      <h2>Consent is active for this session</h2>
                      <p>
                        The planned destination-bound rule must be approved for
                        this session before a transaction can be requested. It
                        would match only the first finalized one-lamport devnet
                        transfer from this wallet to the exact receiver below.
                      </p>
                    </div>
                    {consent?.reconciliationState === "attention_required" ? (
                      <div className={styles.decision} role="status">
                        <span aria-hidden="true" />
                        <div>
                          <strong>Consent was recorded</strong>
                          <p>
                            Historical measurement setup needs operator
                            attention. No transaction is available, and you can
                            unlink below.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <dl className={styles.actionReview}>
                      <div>
                        <dt>Network</dt>
                        <dd>Solana devnet</dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>1 lamport</dd>
                      </div>
                      <div>
                        <dt>Configured rehearsal receiver</dt>
                        <dd>
                          {receiverAddress ??
                            "Not configured — transaction unavailable"}
                        </dd>
                      </div>
                    </dl>
                    <p className={styles.microcopy}>
                      This response is not a payment, sale, activation or
                      revenue event. Transaction submission remains disabled
                      until a separate supervised-run approval.
                    </p>
                    {confirmingUnlink ? (
                      <div
                        className={styles.unlinkConfirm}
                        role="group"
                        aria-label="Confirm wallet unlink"
                      >
                        <p>
                          Unlinking stops future association for this campaign
                          session. Retained audit evidence remains unchanged.
                        </p>
                        <div className={styles.actions}>
                          <button
                            className={styles.secondaryAction}
                            disabled={busy}
                            onClick={() => setConfirmingUnlink(false)}
                            type="button"
                          >
                            Keep measurement active
                          </button>
                          <button
                            className={styles.primaryAction}
                            disabled={busy}
                            onClick={unlinkWallet}
                            type="button"
                          >
                            {busy ? "Stopping measurement…" : "Confirm unlink"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className={styles.secondaryAction}
                        onClick={() => setConfirmingUnlink(true)}
                        type="button"
                      >
                        Unlink wallet
                      </button>
                    )}
                  </>
                ) : (
                  <div className={styles.decision} role="status">
                    <span aria-hidden="true" />
                    <div>
                      <strong>Wallet unlinked</strong>
                      <p>
                        Future association has stopped. Retained audit evidence
                        is not rewritten.
                      </p>
                    </div>
                  </div>
                )}
                {error ? (
                  <p className={styles.errorMessage} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        )}
        {continuationHostname &&
          recoveryComplete &&
          !recoveryError &&
          !busy && (
            <section
              className={continuationStyles.panel}
              data-theme={theme}
              aria-labelledby="continue-to-brand-heading"
            >
              <h2 id="continue-to-brand-heading">
                Continue to the campaign website
              </h2>
              <p>
                You’re going to{" "}
                <strong translate="no">{continuationHostname}</strong>. The
                destination is checked again when you continue.
              </p>
              <p>
                {measurementActive
                  ? "Measurement consent is active. Continuing does not complete a qualifying action, submit a transaction or make a payment."
                  : "You can continue without wallet measurement. Continuing does not give consent or connect your wallet."}
              </p>
              <a
                className="application-button"
                href="/measure/continue"
                rel="noreferrer"
              >
                {measurementActive
                  ? "Continue to website"
                  : "Continue without wallet measurement"}
              </a>
              {measurementActive && (
                <p>
                  You can unlink your wallet above before leaving. Unlinking
                  stops future association; it does not erase retained audit
                  evidence.
                </p>
              )}
            </section>
          )}
      </main>
    </section>
  );
}
