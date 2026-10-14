"use client";
import { useState } from "react";
import { ReviewDeadline, type ReviewTiming } from "./review-deadline";
import { reviewTime } from "@/lib/review-time";
import { useHydrated } from "@/lib/use-hydrated";
import { useSearchParams } from "next/navigation";
import { ApplicationButton as ActionButton } from "@landed/ui";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import styles from "./campaign-timing-fields.module.css";
const previewSchema = z.strictObject({
  reviewId: z.uuid(),
  campaignId: z.uuid(),
  candidateCount: z.number().int().min(1).max(2),
  reviewHash: z.string(),
  measurementWindow: z.strictObject({
    startedAt: z.string(),
    endedAt: z.string(),
  }),
  expiresAt: z.string(),
  simulation: z.literal(true),
});
const resultSchema = z.strictObject({
  reviewId: z.uuid(),
  campaignId: z.uuid(),
  status: z.enum(["not_recorded", "completed"]),
  processedCount: z.number().nullable(),
  simulation: z.literal(true),
});
// The real devnet boundary has no synthetic-proof marker. Project only its
// checked scalar review fields; never render protected wallet mappings here.
const devnetPreviewSchema = z.object({
  simulation: z.never().optional(),
  reviewId: z.uuid(),
  campaignId: z.uuid(),
  candidateCount: z.literal(1),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  reconciliation: z.object({
    jobId: z.uuid(),
    rangeStartedAt: z.iso.datetime({ offset: true }),
    rangeEndedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    normalizationIssueCount: z.literal(0),
    providerCoverage: z.literal("helius_history_exhausted_for_exact_range"),
    completeness: z.literal("provider_observed_only"),
  }),
});
const devnetResultSchema = z.object({
  simulation: z.never().optional(),
  reviewId: z.uuid(),
  campaignId: z.uuid(),
  status: z.enum(["not_recorded", "completed"]),
  processedCount: z.number().int().min(0).nullable(),
  reconciliationJobId: z.uuid(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  providerCoverage: z.literal("helius_history_exhausted_for_exact_range"),
  completeness: z.literal("provider_observed_only"),
});
type Preview = Omit<z.infer<typeof previewSchema>, "simulation"> & {
  manifestHash?: string;
};
type Result = Omit<z.infer<typeof resultSchema>, "simulation">;
export function BrowserCampaignExecution({
  campaignId,
  canManage,
  devnetBoundary,
}: {
  campaignId: string;
  canManage: boolean;
  devnetBoundary?: { reconciliationJobId: string; timing?: ReviewTiming };
}) {
  const interactive = useHydrated();
  const params = useSearchParams();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const devnet = Boolean(devnetBoundary);
  const acknowledgement = devnet
    ? "I reviewed this exact devnet evidence and its provider-coverage limits and approve this calculation."
    : "I understand this is simulated evidence and approve this exact calculation.";
  const endpoint = devnet
    ? "/api/isolated-devnet-rehearsal"
    : "/api/isolated-campaign-execution";
  const savedReview = preview?.reviewId ?? params.get("executionReview");
  async function act(action: "prepare" | "recover" | "confirm") {
    setBusy(true);
    setMessage("");
    try {
      if (action === "confirm") {
        if (!preview || !agreed) throw new Error("Review required");
        setUncertain(true);
        const url = new URL(window.location.href);
        url.searchParams.set("executionReview", preview.reviewId);
        window.history.replaceState(null, "", url);
      }
      const input = {
        action,
        campaignId,
        ...(action === "prepare" && devnetBoundary
          ? { reconciliationJobId: devnetBoundary.reconciliationJobId }
          : {}),
        ...(action === "prepare" ? {} : { reviewId: savedReview }),
        ...(action === "confirm"
          ? { reason: reason.trim() || acknowledgement, acknowledged: true }
          : {}),
      };
      const read = action === "recover";
      const response = await fetch(
        endpoint +
          (read
            ? `?${new URLSearchParams({ action, campaignId, reviewId: savedReview ?? "" })}`
            : ""),
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
      if (!response.ok) throw new Error("Unavailable");
      if (action === "prepare") {
        const raw: unknown = await response.json();
        let value: Preview;
        if (devnetBoundary) {
          const checked = devnetPreviewSchema.parse(raw);
          if (
            checked.reconciliation.jobId !==
              devnetBoundary.reconciliationJobId ||
            Date.parse(checked.expiresAt) <= Date.now() ||
            Date.parse(checked.reconciliation.rangeStartedAt) >=
              Date.parse(checked.reconciliation.rangeEndedAt) ||
            Date.parse(checked.reconciliation.rangeEndedAt) >
              Date.parse(checked.reconciliation.completedAt) ||
            Date.parse(checked.reconciliation.completedAt) > Date.now()
          )
            throw new Error("Devnet review boundary mismatch");
          value = {
            reviewId: checked.reviewId,
            campaignId: checked.campaignId,
            candidateCount: checked.candidateCount,
            reviewHash: checked.reviewHash,
            manifestHash: checked.manifestHash,
            expiresAt: checked.expiresAt,
            measurementWindow: {
              startedAt: checked.reconciliation.rangeStartedAt,
              endedAt: checked.reconciliation.rangeEndedAt,
            },
          };
        } else value = previewSchema.parse(raw);
        if (value.campaignId !== campaignId) throw new Error("Scope mismatch");
        setPreview(value);
        setAgreed(false);
        setResult(null);
        setUncertain(false);
      } else {
        const raw: unknown = await response.json();
        const value = devnetBoundary
          ? devnetResultSchema.parse(raw)
          : resultSchema.parse(raw);
        if (
          devnetBoundary &&
          (!("reconciliationJobId" in value) ||
            value.reconciliationJobId !== devnetBoundary.reconciliationJobId ||
            (preview?.manifestHash &&
              value.manifestHash !== preview.manifestHash) ||
            (value.status === "completed" && value.processedCount !== 1))
        )
          throw new Error("Devnet result boundary mismatch");
        if (value.campaignId !== campaignId || value.reviewId !== savedReview)
          throw new Error("Scope mismatch");
        setResult(value);
        if (value.status === "not_recorded") {
          setPreview(null);
          setAgreed(false);
          setUncertain(false);
        }
        setMessage(
          value.status === "completed"
            ? devnet
              ? "The reviewed devnet evidence has been calculated. Provider observations are not ledger-wide completeness. Cost review and report approval remain separate decisions."
              : "The reviewed synthetic evidence has been calculated. Cost review and report approval are separate next steps."
            : "No execution receipt is recorded. Reload the evidence review before deciding whether to retry.",
        );
      }
    } catch {
      setMessage(
        "Unable to confirm this step. Test evidence may not be ready, or the review changed or expired. If you confirmed execution, check its status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.root}
      aria-label="Review campaign evidence"
      aria-busy={busy}
    >
      <h2>Review campaign evidence</h2>
      {devnetBoundary?.timing && result?.status !== "completed" && (
        <ReviewDeadline
          timing={devnetBoundary.timing}
          expiresAt={preview?.expiresAt}
        />
      )}
      <p>
        {devnet
          ? "Check the saved test activity, then review costs and approve your report. No new test or payment is needed."
          : "Historical simulated evidence only. No real wallet signature, human consent or live transaction is verified. This does not launch the campaign or move funds."}
      </p>
      {devnet && (
        <details>
          <summary>Evidence limits</summary>
          <p>
            Only events observed by the data provider in the reviewed period are
            included. This is not a complete network history. Calculating
            results does not approve a report.
          </p>
        </details>
      )}
      {!canManage ? (
        <p>A campaign manager must review and approve execution.</p>
      ) : (
        <>
          {!preview && result?.status !== "completed" && (
            <ActionButton
              variant="hero"
              type="button"
              disabled={busy || !interactive || uncertain}
              onClick={() => void act("prepare")}
            >
              {devnet ? "Review devnet evidence" : "Review simulated evidence"}
            </ActionButton>
          )}
          {preview && !uncertain && result?.status !== "completed" && (
            <form
              className={styles.decisionForm}
              onSubmit={(event) => {
                event.preventDefault();
                void act("confirm");
              }}
            >
              <p>
                {preview.candidateCount}{" "}
                {devnet ? "observed devnet action is" : "simulated actions are"}{" "}
                ready for review, for the{" "}
                {devnet
                  ? "reviewed reconciliation range"
                  : "measurement period"}{" "}
                {reviewTime(preview.measurementWindow.startedAt)} to{" "}
                {reviewTime(preview.measurementWindow.endedAt)}.
              </p>
              {!devnetBoundary?.timing && (
                <ReviewDeadline expiresAt={preview.expiresAt} />
              )}
              <p>
                Calculation does not establish source completeness or approve a
                report.
              </p>
              <label htmlFor="execution-reason">
                Calculation note (optional)
              </label>
              <input
                id="execution-reason"
                name="reason"
                autoComplete="off"
                minLength={8}
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
              />
              <label className={styles.acknowledgement}>
                <input
                  type="checkbox"
                  name="execution-acknowledgement"
                  aria-required="true"
                  data-required-missing={!agreed}
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  {acknowledgement}
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
              </label>
              <ActionButton
                variant="hero"
                type="submit"
                disabled={
                  busy ||
                  !agreed ||
                  (reason.trim().length > 0 && reason.trim().length < 8)
                }
              >
                Approve and calculate evidence
              </ActionButton>
            </form>
          )}
          {savedReview &&
            result?.status !== "completed" &&
            (!preview || uncertain) && (
              <ActionButton
                type="button"
                disabled={busy}
                onClick={() => void act("recover")}
              >
                Check execution status
              </ActionButton>
            )}
        </>
      )}
      <p role="status">{message}</p>
      {result?.status === "completed" && (
        <a
          className="application-button application-button--hero"
          href={`/projects/${project.id}/campaigns/${campaignId}/results/review?${new URLSearchParams({ executionId: result.reviewId, theme: params.get("theme") === "dark" ? "dark" : "light" })}`}
        >
          Review costs and prepare report
        </a>
      )}
    </section>
  );
}
