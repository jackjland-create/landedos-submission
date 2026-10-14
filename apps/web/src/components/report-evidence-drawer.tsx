"use client";

import type {
  ProjectReportEvidencePath,
  ReportEvidenceMetric,
} from "@landed/db";
import { projectReportEvidencePathSchema } from "@landed/db";
import { Eyebrow, Status } from "@landed/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CopyEvidenceButton } from "./copy-evidence-button";

const metricLabels: Record<ReportEvidenceMetric, string> = {
  qualified_wallets: "Qualified wallets",
  activated_wallets: "Activated wallets / CPA denominator",
};

type DrawerState =
  | { kind: "loading" }
  | { kind: "ready"; paths: ProjectReportEvidencePath[] }
  | { kind: "permission" }
  | { kind: "error" };

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

function compactIdentity(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function formatValue(path: ProjectReportEvidencePath) {
  const amount = BigInt(path.rawAmount);
  const scale = 10n ** BigInt(path.decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(path.decimals, "0")
    .replace(/0+$/, "")
    .slice(0, 6);
  const value = fraction ? `${whole}.${fraction}` : whole.toString();
  return path.valueKind === "native_lamports"
    ? `${value} SOL`
    : `${value} tokens`;
}

function DrawerLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="report-evidence-loading"
    >
      <Status tone="forecast">PREPARING EVIDENCE</Status>
      <div className="loading-panel" />
      <div className="loading-panel" />
      <span className="sr-only">Loading the retained evidence path.</span>
    </div>
  );
}

export function ReportEvidenceDrawer({
  closeHref,
  initialPaths,
  metric,
  projectSlug,
  reportVersionId,
}: {
  closeHref: string;
  initialPaths?: ProjectReportEvidencePath[];
  metric: ReportEvidenceMetric;
  projectSlug: string;
  reportVersionId: string;
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DrawerState>(
    initialPaths ? { kind: "ready", paths: initialPaths } : { kind: "loading" },
  );

  const close = useCallback(
    () => router.replace(closeHref),
    [closeHref, router],
  );

  useEffect(() => {
    if (initialPaths) return;
    const controller = new AbortController();

    fetch(
      `/api/projects/${projectSlug}/reports/${reportVersionId}/evidence?metric=${metric}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          setState({ kind: "permission" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }
        const body = (await response.json()) as { paths?: unknown };
        const parsedPaths = projectReportEvidencePathSchema
          .array()
          .safeParse(body.paths);
        if (!parsedPaths.success) {
          setState({ kind: "error" });
          return;
        }
        setState({
          kind: "ready",
          paths: parsedPaths.data,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({ kind: "error" });
      });

    return () => controller.abort();
  }, [attempt, initialPaths, metric, projectSlug, reportVersionId]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const reportRoot = document.querySelector<HTMLElement>(
      ".performance-report",
    );
    const background = Array.from(reportRoot?.children ?? []).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        !child.classList.contains("report-evidence-layer"),
    );
    for (const element of background) element.setAttribute("inert", "");
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      for (const element of background) element.removeAttribute("inert");
      previouslyFocused?.focus();
    };
  }, [close]);

  const paths = state.kind === "ready" ? state.paths : [];

  return (
    <div className="report-evidence-layer">
      <button
        aria-label="Close report evidence backdrop"
        className="report-evidence-scrim"
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-describedby="report-evidence-description"
        aria-labelledby="report-evidence-title"
        aria-modal="true"
        className="report-evidence-drawer"
        id="evidence"
        ref={drawerRef}
        role="dialog"
      >
        <p className="sr-only" id="report-evidence-description">
          Immutable creator touch, wallet proof, conversion and Solana
          transaction evidence.
        </p>
        <header className="report-evidence-drawer__header">
          <div>
            <Eyebrow>
              EVIDENCE PATH / {metricLabels[metric].toUpperCase()}
            </Eyebrow>
            <h2 id="report-evidence-title">From result to transaction.</h2>
          </div>
          <button
            aria-label="Close evidence"
            className="evidence-close"
            onClick={close}
            ref={closeButtonRef}
            type="button"
          >
            CLOSE
          </button>
        </header>

        {state.kind === "loading" ? <DrawerLoading /> : null}

        {state.kind === "permission" ? (
          <section className="report-evidence-empty">
            <Status>ACCESS RESTRICTED</Status>
            <h3>This evidence path is not available to your account.</h3>
            <p>
              No creator, wallet-proof or transaction evidence has been
              returned.
            </p>
          </section>
        ) : null}

        {state.kind === "error" ? (
          <section className="report-evidence-empty">
            <Status tone="forecast">EVIDENCE INTERRUPTED</Status>
            <h3>The retained evidence path could not be prepared.</h3>
            <p>
              The issued report remains unchanged. Retry the scoped evidence
              request.
            </p>
            <button
              className="action-button action-button--secondary"
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((current) => current + 1);
              }}
              type="button"
            >
              RETRY EVIDENCE
            </button>
          </section>
        ) : null}

        {state.kind === "ready" && paths.length === 0 ? (
          <section className="report-evidence-empty">
            <Status tone="forecast">PATH NOT RETAINED</Status>
            <h3>No auditable transaction path is attached to this metric.</h3>
            <p>
              The issued value remains unchanged. Landed will not infer a
              creator, wallet action or transaction when the immutable
              references are not present in this report version.
            </p>
          </section>
        ) : null}

        {state.kind === "ready" && paths.length > 0 ? (
          <div className="report-evidence-paths">
            {paths.map((path, index) => (
              <article
                className="report-evidence-path"
                key={path.attributionFactId}
              >
                <header>
                  <span>PATH {String(index + 1).padStart(2, "0")}</span>
                  <Status
                    tone={path.primaryRoasEligible ? "verified" : "forecast"}
                  >
                    {path.confidence.toUpperCase()} /{" "}
                    {path.primaryRoasEligible ? "PRIMARY ELIGIBLE" : "EXCLUDED"}
                  </Status>
                </header>
                <ol>
                  <li>
                    <span>01</span>
                    <div>
                      <Eyebrow>ELIGIBLE CREATOR TOUCH</Eyebrow>
                      <h3>{path.creatorName}</h3>
                      <p>{path.contentAssetLabel}</p>
                      <dl>
                        <div>
                          <dt>Touch</dt>
                          <dd>{formatDate(path.touchTime)}</dd>
                        </div>
                        <div>
                          <dt>Click quality</dt>
                          <dd>{path.clickQuality}</dd>
                        </div>
                        <div>
                          <dt>Window</dt>
                          <dd>Last eligible touch / 7 days</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <Eyebrow>WALLET PROOF</Eyebrow>
                      <h3>Controller verified. Consent retained.</h3>
                      <p>
                        A signed nonce and explicit campaign measurement consent
                        bind the action. The protected wallet address is
                        withheld.
                      </p>
                      <Status tone="verified">SIGNED NONCE + CONSENT</Status>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <Eyebrow>CONVERSION DEFINITION</Eyebrow>
                      <h3>{path.conversionRuleName}</h3>
                      <dl>
                        <div>
                          <dt>Rule version</dt>
                          <dd>
                            V
                            {String(path.conversionRuleVersion).padStart(
                              2,
                              "0",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Evaluator</dt>
                          <dd>V{path.conversionEvaluatorVersion}</dd>
                        </div>
                        <div>
                          <dt>Matched</dt>
                          <dd>{formatDate(path.conversionTime)}</dd>
                        </div>
                        <div>
                          <dt>Observed value</dt>
                          <dd>{formatValue(path)}</dd>
                        </div>
                        <div>
                          <dt>Revenue mapping</dt>
                          <dd>Not mapped from transfer value</dd>
                        </div>
                        {path.tokenMint ? (
                          <div>
                            <dt>Token mint</dt>
                            <dd>{compactIdentity(path.tokenMint)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </li>
                  <li>
                    <span>04</span>
                    <div>
                      <Eyebrow>SOLANA TRANSACTION EVIDENCE</Eyebrow>
                      <h3>Finalized on {path.environment}.</h3>
                      <dl>
                        <div>
                          <dt>Action</dt>
                          <dd>
                            {path.eventName
                              .replace("solana.", "")
                              .replace("_", " ")}
                          </dd>
                        </div>
                        <div>
                          <dt>Finality</dt>
                          <dd>{path.finality}</dd>
                        </div>
                        <div>
                          <dt>Slot</dt>
                          <dd>{path.transactionSlot}</dd>
                        </div>
                        <div>
                          <dt>Instruction</dt>
                          <dd>
                            {path.instructionIndex ?? "NO INDEX RETAINED"}
                          </dd>
                        </div>
                      </dl>
                      <div className="report-signature">
                        <code>
                          {compactIdentity(path.transactionSignature)}
                        </code>
                        <CopyEvidenceButton value={path.transactionSignature} />
                      </div>
                    </div>
                  </li>
                </ol>
              </article>
            ))}
          </div>
        ) : null}

        <footer>
          <span>Attribution fact and conversion fact retained immutably</span>
          <span>Protected wallet addresses are never returned</span>
        </footer>
      </aside>
    </div>
  );
}
