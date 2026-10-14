"use client";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { ReviewDeadline, type ReviewTiming } from "./review-deadline";
import type { TimedWorkflowResult } from "@/lib/reports/timed-report-workflow.server";
import { clarityMoney, clarityDate, clarityRate } from "@/lib/reports/clarity";
import { project } from "@/lib/demo-data";
import { AppShell } from "./app-shell";
import { reportCampaignLabel } from "@/lib/reports/overview-presentation";
import reviewStyles from "./timed-report-review.module.css";

const styles = {
  panel: reviewStyles.panel,
  primary: "application-button application-button--hero",
  heading: reviewStyles.heading,
  eyebrow: reviewStyles.eyebrow,
};
const reportConfirmation =
  "I approve these exact results and contracted costs. I understand the evidence limits.";

type Sources = Extract<TimedWorkflowResult, { kind: "sources" }>;
type Draft = Extract<TimedWorkflowResult, { kind: "draft" }>;
type Receipt = Extract<TimedWorkflowResult, { kind: "receipt" }>;

/** Golden screens04→05: explicit human review, no change to Clarity report. */
export function TimedReportReview({
  signedIn,
  parameters,
  reviewTiming,
}: {
  signedIn: boolean;
  parameters: Record<string, string>;
  reviewTiming?: ReviewTiming;
}) {
  const interactive = useHydrated();
  const [data, setData] = useState<Sources | Draft | Receipt | null>(null);
  const [pending, setPending] = useState(Boolean(signedIn));
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [excludedCosts, setExcludedCosts] = useState<Record<string, boolean>>(
    {},
  );
  const [confirmationUncertain, setConfirmationUncertain] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const [draftId, setDraftId] = useState(parameters.draftId ?? "");
  const [theme, setTheme] = useState<"light" | "dark">(
    parameters.theme === "dark" ? "dark" : "light",
  );
  const scope = {
    workspaceId: parameters.workspaceId,
    projectId: parameters.projectId,
    campaignId: parameters.campaignId,
  };
  function request(input: Record<string, unknown>, write = false) {
    setPending(true);
    setMessage("");
    return fetchReview(input, write);
  }
  async function fetchReview(input: Record<string, unknown>, write = false) {
    try {
      const response = await fetch(
        write
          ? "/api/isolated-timed-reports"
          : `/api/isolated-timed-reports?${new URLSearchParams(input as Record<string, string>)}`,
        write
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            }
          : { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Review unavailable.");
      setData(result);
      setDirty(false);
      if (input.action === "read" || ("receipt" in result && result.receipt))
        setConfirmationUncertain(false);
      if (result.kind === "draft") {
        setDraftId(result.draftId);
        const url = new URL(window.location.href);
        url.searchParams.set("draftId", result.draftId);
        window.history.replaceState(null, "", url);
      }
    } catch (error) {
      if (input.action === "confirm") setConfirmationUncertain(true);
      setMessage(
        input.action === "confirm"
          ? "Confirmation could not be verified. Check issuance status below before trying again."
          : error instanceof TypeError
            ? "Unable to connect. Your review has been kept; please try again."
            : error instanceof Error
              ? error.message
              : "Review unavailable.",
      );
    } finally {
      setPending(false);
    }
  }
  // No implicit writes on mount. A reload recovers only the retained draft.
  useEffect(() => {
    if (signedIn && parameters.draftId)
      void fetchReview({
        action: "read",
        ...scope,
        draftId: parameters.draftId,
      });
    else if (signedIn)
      void fetchReview({
        action: "sources",
        ...scope,
        executionId: parameters.executionId,
      });
    // Initial parameters deliberately define the one mounted review identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (message) statusRef.current?.focus();
  }, [message]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const receipt = data && "receipt" in data ? data.receipt : null;
  const reportHref = receipt
    ? parameters.projectId === project.databaseId &&
      parameters.workspaceId === project.workspaceId
      ? `/projects/${project.id}/overview?${new URLSearchParams({ report: receipt.reportId, version: String(receipt.version), theme })}`
      : `/visual-tests/reporting-studio/authenticated?${new URLSearchParams({ workspaceId: parameters.workspaceId, projectId: parameters.projectId, reportId: receipt.reportId, reportVersionId: receipt.reportVersionId, theme })}`
    : "";
  return (
    <AppShell
      activeSection="campaigns"
      projectId={project.id}
      theme={theme}
      showGuidedDemo={false}
      contentAppearance="application"
      dataLabel="Test evidence"
    >
      <div id="report-review" tabIndex={-1} className={reviewStyles.workspace}>
        <a
          className={reviewStyles.back}
          href={`/projects/${project.id}/campaigns/${parameters.campaignId}?view=results&theme=${theme}`}
        >
          ← Back to campaign results
        </a>
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Campaign results</p>
            <h1>
              {receipt ? "Your report is ready" : "Review and issue report"}
            </h1>
            <p>
              {receipt
                ? "Open your saved results. No further approval is needed."
                : "Check costs, then approve the report. No payment is made."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label="Dark mode"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              const url = new URL(window.location.href);
              url.searchParams.set("theme", next);
              window.history.replaceState(null, "", url);
            }}
          >
            {theme === "dark" ? "Dark" : "Light"} mode
          </button>
        </header>
        {signedIn && reviewTiming && !receipt && (
          <ReviewDeadline
            report
            timing={reviewTiming}
            expiresAt={data?.kind === "draft" ? data.expiresAt : undefined}
          />
        )}
        {!signedIn ? (
          <section className={styles.panel}>
            <h2>Reporting access is required</h2>
            <p>Sign in with reporting access to review this campaign.</p>
            <a className={styles.primary} href={`/login?next=${encodeURIComponent(`/projects/${project.id}/campaigns/${parameters.campaignId}/results/review?${new URLSearchParams(parameters)}`)}`}>Sign in</a>
          </section>
        ) : (
          <>
            <div ref={statusRef} tabIndex={-1} aria-live="polite" role="status">
              {pending ? "Checking retained evidence…" : message}
            </div>
            {receipt ? (
              <section className={styles.panel}>
                <h2>Report issued</h2>
                <p>
                  Report version {receipt.version} is saved. Your review is
                  complete.
                </p>
                <a className={styles.primary} href={reportHref}>
                  Open issued report
                </a>
              </section>
            ) : (
              <>
                {!data && (
                  <section className={styles.panel}>
                    <h2>Start with the costs and evidence</h2>
                    <p>
                      Choose which agreed costs to include. You’ll see the final
                      figures before approving.
                    </p>
                    {message && (
                      <button
                        className={styles.primary}
                        disabled={pending || !interactive}
                        onClick={() =>
                          request({
                            action: "sources",
                            ...scope,
                            executionId: parameters.executionId,
                          })
                        }
                      >
                        Try loading again
                      </button>
                    )}
                  </section>
                )}
                {data?.kind === "sources" && (
                  <>
                    {data.handoff && (
                      <section
                        className={styles.panel}
                        aria-labelledby="retained-campaign-heading"
                      >
                        <h2 id="retained-campaign-heading">
                          {reportCampaignLabel(data.handoff.campaignName)}
                        </h2>
                        <p>{data.handoff.objective}</p>
                        <details>
                          <summary>About this test evidence</summary>
                          <p>
                            {data.handoff.upstreamProof ===
                            "retained_devnet_execution" ? (
                              "A completed devnet execution is retained for this exact campaign. This handoff alone does not certify live provider delivery or how upstream approvals were entered. Review the exact sources before issuing a report."
                            ) : data.handoff.browserCommercialApproval ? (
                              "The plan was approved and the campaign evidence calculated through the local application. Source events, wallet signatures and consent are historical simulations, not live proof. This step reads the retained decision; it does not activate the campaign."
                            ) : (
                              <>
                                The plan, campaign and execution below were
                                prepared by an isolated synthetic database
                                rehearsal, not by browser approval or live
                                ingestion. This step reads retained records; it
                                does not approve or run the campaign.
                              </>
                            )}
                          </p>
                        </details>
                        <details>
                          <summary>
                            Inspect approved plan and recorded execution
                          </summary>
                          <p>
                            Scenario {data.handoff.scenario.code}:{" "}
                            {data.handoff.scenario.name}
                          </p>
                          <p>
                            Campaign activity:{" "}
                            {clarityDate(data.handoff.flight.startedAt)} to{" "}
                            {clarityDate(data.handoff.flight.endedAt)}.
                          </p>
                          <p>
                            Measurement:{" "}
                            {clarityDate(
                              data.handoff.measurementWindow.startedAt,
                            )}{" "}
                            to{" "}
                            {clarityDate(
                              data.handoff.measurementWindow.endedAt,
                            )}
                            . A longer measurement period does not extend
                            creator obligations.
                          </p>
                          {data.handoff.packages.map((p) => (
                            <div key={p.id}>
                              <h3>{p.packageLabel}</h3>
                              <p>{p.deliverableSummary}</p>
                              {p.compensationLines.map((line) => (
                                <p key={line.id}>
                                  {line.assetType === "cash"
                                    ? `${clarityMoney(line.amountMinor, line.currencyCode)} · ${line.model}`
                                    : `${line.assetType} · ${line.model} · valuation required`}
                                </p>
                              ))}
                            </div>
                          ))}
                          <p>
                            {data.handoff.execution.processedCount} retained
                            execution results. This receipt does not prove
                            provider completeness, live delivery or campaign
                            success.
                          </p>
                          <details>
                            <summary>
                              Exact campaign and approval identities
                            </summary>
                            <p>Campaign: {data.handoff.scope.campaignId}</p>
                            <p>Basket: {data.handoff.basketId}</p>
                            <p>
                              Commercial plan:{" "}
                              {data.handoff.commercialPlanVersionId}
                            </p>
                            <p>
                              Plan fingerprint:{" "}
                              {data.handoff.commercialPlanSnapshotHash}
                            </p>
                            <p>Definition: {data.handoff.ruleVersionId}</p>
                            <p>
                              Execution approval:{" "}
                              {data.handoff.execution.approvalId}
                            </p>
                            <p>
                              Execution fingerprint:{" "}
                              {data.handoff.execution.reviewHash}
                            </p>
                          </details>
                        </details>
                      </section>
                    )}
                    <form
                      id="campaign-cost-review"
                      tabIndex={-1}
                      aria-busy={pending}
                      onChange={() => setDirty(true)}
                      className={`${styles.panel} ${reviewStyles.form}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!event.currentTarget.reportValidity() || pending)
                          return;
                        const form = new FormData(event.currentTarget);
                        void request(
                          {
                            action: "prepare",
                            ...scope,
                            executionId: parameters.executionId,
                            sourceHash: data.sourceHash,
                            currencyCode: form.get("currency"),
                            additionalCosts: form.get("additionalCosts"),
                            decisions: data.lines.map((line) => ({
                              compensationLineId: line.id,
                              inclusion: form.get(`include-${line.id}`),
                              reason:
                                String(
                                  form.get(`reason-${line.id}`) ?? "",
                                ).trim() ||
                                (form.get(`include-${line.id}`) === "included"
                                  ? "Included as an agreed campaign cost."
                                  : ""),
                            })),
                          },
                          true,
                        );
                      }}
                    >
                      <h2>1. Review campaign costs</h2>
                      <p>
                        Measurement:{" "}
                        {clarityDate(data.measurementWindow.startedAt)} to{" "}
                        {clarityDate(data.measurementWindow.endedAt)}. These are
                        contracted commitments, not payments.
                      </p>
                      {data.lines.length === 0 && (
                        <p>
                          No approved cost lines are available. Missing costs
                          will not be treated as confirmed spend.
                        </p>
                      )}
                      {data.lines.map((line, index) => (
                        <fieldset key={line.id}>
                          <legend>
                            {line.packageLabel || `Package ${index + 1}`}
                          </legend>
                          <p>
                            {line.terms.assetType === "cash"
                              ? `${clarityMoney(line.terms.amountMinor, line.terms.currencyCode)} · ${line.terms.model}`
                              : "Non-cash terms require a supported valuation; inclusion may remain unavailable."}
                          </p>
                          <label>
                            <span>
                              Cost treatment
                              <span
                                className="required-field-marker"
                                aria-hidden="true"
                                title="Required"
                              />
                            </span>
                            <select
                              name={`include-${line.id}`}
                              onChange={(event) =>
                                setExcludedCosts((current) => ({
                                  ...current,
                                  [line.id]: event.target.value === "excluded",
                                }))
                              }
                              required
                              defaultValue=""
                            >
                              <option value="" disabled>
                                Choose treatment
                              </option>
                              <option value="included">
                                Include — agreed campaign cost
                              </option>
                              <option value="excluded">
                                Exclude from report
                              </option>
                            </select>
                          </label>
                          <label>
                            <span>
                              Note (required only if excluding this cost)
                              {excludedCosts[line.id] && (
                                <span
                                  className="required-field-marker"
                                  aria-hidden="true"
                                  title="Required"
                                />
                              )}
                            </span>
                            <input
                              name={`reason-${line.id}`}
                              required={excludedCosts[line.id] === true}
                              maxLength={500}
                              autoComplete="off"
                            />
                          </label>
                          {!excludedCosts[line.id] && (
                            <p className={reviewStyles.hint}>
                              When included, the audit record says “Included as
                              an agreed campaign cost.”
                            </p>
                          )}
                        </fieldset>
                      ))}
                      <label>
                        Report currency
                        <select name="currency" defaultValue="GBP">
                          <option>GBP</option>
                          <option>USD</option>
                          <option>EUR</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          Other campaign costs
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <select name="additionalCosts" required defaultValue="">
                          <option value="" disabled>
                            Confirm cost coverage
                          </option>
                          <option value="none_declared">
                            No additional costs to include
                          </option>
                          <option value="unknown">
                            Other costs are not yet known
                          </option>
                        </select>
                      </label>
                      <button className={styles.primary} disabled={pending}>
                        Continue to final review
                      </button>
                    </form>
                  </>
                )}
                {data?.kind === "draft" && (
                  <form
                    aria-busy={pending}
                    onChange={() => setDirty(true)}
                    className={`${styles.panel} ${reviewStyles.form}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !event.currentTarget.reportValidity() ||
                        pending ||
                        confirmationUncertain
                      )
                        return;
                      const form = new FormData(event.currentTarget);
                      void request(
                        {
                          action: "confirm",
                          ...scope,
                          draftId: data.draftId,
                          reason:
                            String(form.get("reason") ?? "").trim() ||
                            reportConfirmation,
                          confirmed: form.get("confirmed") === "on",
                        },
                        true,
                      );
                    }}
                  >
                    <h2>2. Confirm the reviewed result</h2>
                    <details>
                      <summary>Campaign reference</summary>
                      <p>{data.scope.campaignId}</p>
                    </details>
                    <p>
                      Measurement:{" "}
                      {clarityDate(data.measurementWindow.startedAt)} to{" "}
                      {clarityDate(data.measurementWindow.endedAt)}.
                    </p>
                    <p>
                      Contracted spend:{" "}
                      {data.costs.total.status === "available"
                        ? clarityMoney(
                            data.costs.total.amountMinor,
                            data.costs.currencyCode,
                          )
                        : "Not available"}
                      . Qualified wallets:{" "}
                      {data.qualifiedWallets ?? "Not available"}.
                    </p>
                    <p>
                      Cost per qualified wallet:{" "}
                      {clarityRate(
                        data.costPerQualifiedWallet,
                        data.costs.currencyCode,
                      )}
                      .
                    </p>
                    <p>Evidence checked: {clarityDate(data.checkedAt)}.</p>
                    {!reviewTiming && (
                      <ReviewDeadline report expiresAt={data.expiresAt} />
                    )}
                    <p>
                      Only consenting wallets in the reviewed period are
                      included. The data source may not cover every event.
                      Revenue, activation and impressions are not measured here.
                    </p>
                    <details>
                      <summary>Reviewed cost decisions</summary>
                      {data.costs.lines.map((line) => (
                        <p key={line.compensationLineId}>
                          Approved package {line.packageId}, cost line{" "}
                          {line.compensationLineId}:{" "}
                          {line.terms.assetType === "cash"
                            ? `${clarityMoney(line.terms.amountMinor, line.terms.currencyCode)} · ${line.terms.model}`
                            : `${line.terms.assetType} · ${line.terms.model} · valuation required`}
                          . {line.inclusion}: {line.reason}
                        </p>
                      ))}
                    </details>
                    {data.expired ? (
                      <p role="alert">
                        This review expired. Load a new review before issuing.
                      </p>
                    ) : (
                      <>
                        <label>
                          <span>Approval note (optional)</span>
                          <input
                            name="reason"
                            minLength={8}
                            maxLength={500}
                            autoComplete="off"
                          />
                        </label>
                        <label className={reviewStyles.confirmation}>
                          <input name="confirmed" type="checkbox" required />
                          <span>
                            {reportConfirmation}
                            <span
                              className="required-field-marker"
                              aria-hidden="true"
                              title="Required"
                            />
                          </span>
                        </label>
                        <p className={reviewStyles.hint}>
                          Your confirmation is recorded with the report. Add a
                          note only if needed.
                        </p>
                        <button
                          className={styles.primary}
                          disabled={pending || confirmationUncertain}
                        >
                          Approve and issue report
                        </button>
                      </>
                    )}
                  </form>
                )}
              </>
            )}
            {draftId &&
              !receipt &&
              (confirmationUncertain ||
                Boolean(message) ||
                data?.kind === "receipt" ||
                (data?.kind === "draft" && data.expired)) && (
                <section className={styles.panel}>
                  <button
                    disabled={pending || confirmationUncertain}
                    onClick={() =>
                      request({
                        action: "sources",
                        ...scope,
                        executionId: parameters.executionId,
                      })
                    }
                  >
                    Start a fresh cost review
                  </button>
                  <h2>Interrupted confirmation?</h2>
                  <p>
                    Check the original request before trying again. A status
                    check never approves or issues a report.
                  </p>
                  <button
                    disabled={pending}
                    onClick={() =>
                      request({ action: "recover", ...scope, draftId })
                    }
                  >
                    Check issuance status
                  </button>
                  {data?.kind === "receipt" && !receipt && (
                    <p>No issued result is recorded for this request.</p>
                  )}
                  <button
                    disabled={pending}
                    onClick={() =>
                      request({ action: "read", ...scope, draftId })
                    }
                  >
                    Reload retained review
                  </button>
                </section>
              )}
          </>
        )}
      </div>
    </AppShell>
  );
}
