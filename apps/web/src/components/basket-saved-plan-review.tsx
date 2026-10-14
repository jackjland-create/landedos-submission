"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActionButton } from "@landed/ui";
import {
  baseUnitsToDecimal,
  timedStrategyCommercialPlanSnapshotSchema,
  type CampaignTimingProposal,
} from "@landed/contracts";
import { z } from "zod";
import { project } from "@/lib/demo-data";
import { CampaignTimingSummary } from "./campaign-timing-fields";
import styles from "./campaign-timing-fields.module.css";
import reviewStyles from "./basket-saved-plan-review.module.css";
import { PlanReviewVisibleContext } from "./basket-workspace";
import {
  BrowserCommercialApproval,
  LocalDevnetCommercialApproval,
  type LocalCommercialMode,
} from "./browser-commercial-review";

export type SavedPlanReviewContext = {
  expectedOwnerId: string;
  expectedRevision: number;
  expectedTiming: CampaignTimingProposal;
  scenarioId: string;
  basketId: string;
};
const responseSchema = z.strictObject({
  snapshot: timedStrategyCommercialPlanSnapshotSchema,
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  ownerId: z.uuid(),
  approvalAvailable: z.literal(false),
});
type Review = z.infer<typeof responseSchema>;
class ReviewError extends Error {}
function instant(value: string) {
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}
export async function loadSavedPlanReview(
  context: SavedPlanReviewContext,
  request: typeof fetch = fetch,
): Promise<Review> {
  const { basketId, ...body } = context;
  const response = await request(
    `/api/projects/${project.id}/baskets/${basketId}/timing/review`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new ReviewError(
      response.status === 403 || response.status === 401
        ? "Campaign manager access is required. Sign in again or ask your workspace administrator."
        : response.status === 409
          ? "The saved plan is not ready. Check its strategy, selected packages and conversion definition, then reload saved dates."
          : "The saved plan could not be loaded. Try again. No approval was made.",
    );
  const result = responseSchema.parse(await response.json());
  const s = result.snapshot;
  if (
    result.ownerId !== context.expectedOwnerId ||
    s.workspaceId !== project.workspaceId ||
    s.projectId !== project.databaseId ||
    s.basket.id !== basketId ||
    s.scenario.id !== context.scenarioId ||
    s.strategyBinding.revision !== context.expectedRevision
  )
    throw new ReviewError(
      "The saved plan changed. Reload saved dates before reviewing again.",
    );
  for (const period of ["flight", "measurement"] as const)
    for (const boundary of ["startedAt", "endedAt"] as const)
      if (
        instant(s.strategyBinding.timing[period][boundary]) !==
        instant(context.expectedTiming[period][boundary])
      )
        throw new ReviewError(
          "The saved dates changed. Reload them before reviewing again.",
        );
  return result;
}

/** Remount using the complete local plan/context key; never retain an old response. */
type ReviewProps = {
  context: SavedPlanReviewContext | null;
  canManage: boolean;
  load?: typeof loadSavedPlanReview;
  blockedReason?: string;
  blockedTarget?: "#basket-strategy" | "#basket-timing";
  localCommercialEnabled?: boolean;
  localCommercialMode?: LocalCommercialMode;
};
export function BasketSavedPlanReview(props: ReviewProps) {
  return (
    <SavedPlanReviewSession
      key={JSON.stringify([props.context, props.canManage])}
      {...props}
    />
  );
}
function SavedPlanReviewSession({
  context,
  canManage,
  load = loadSavedPlanReview,
  blockedReason,
  blockedTarget = "#basket-timing",
  localCommercialEnabled = false,
  localCommercialMode = "browser",
}: ReviewProps) {
  const active = useContext(PlanReviewVisibleContext);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const autoOpened = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const requests = generation;
    const invalidate = () => {
      requests.current++;
      setReview(null);
      setBusy(false);
      setMessage("The plan may have changed. Load a fresh saved-plan review.");
    };
    const onEdit = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) invalidate();
    };
    document.addEventListener("input", onEdit, true);
    document.addEventListener("submit", onEdit, true);
    // Losing window focus is not a plan edit. Keep the mounted commercial
    // decision's pending/uncertain request intact; its own expiry and the
    // server's current-snapshot checks still govern approval freshness.
    return () => {
      requests.current++;
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("submit", onEdit, true);
    };
  }, []);
  const open = useCallback(
    async (automatic = false) => {
      if (!context || !canManage || busy) return;
      const current = ++generation.current;
      setReview(null);
      setBusy(true);
      setMessage("Loading the saved plan…");
      try {
        const result = await load(context);
        if (current !== generation.current) return;
        setReview(result);
        setMessage("Saved plan loaded. This is not an approval.");
        requestAnimationFrame(() => {
          if (
            current === generation.current &&
            (!automatic || activeRef.current)
          )
            heading.current?.focus();
        });
      } catch (error) {
        if (current !== generation.current) return;
        setMessage(
          error instanceof ReviewError
            ? error.message
            : "The saved plan could not be confirmed. Reload saved dates and try again.",
        );
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [context, canManage, busy, load],
  );
  useEffect(() => {
    if (
      !active ||
      !context ||
      !canManage ||
      autoOpened.current ||
      review ||
      busy
    )
      return;
    const timer = window.setTimeout(() => {
      autoOpened.current = true;
      void open(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, context, canManage, review, busy, open]);
  const s = review?.snapshot;
  const includedCreatorCount = s
    ? new Set(s.packages.map((p) => p.creatorId)).size
    : 0;
  return (
    <section
      ref={root}
      id="basket-plan-review"
      tabIndex={-1}
      className={`${styles.root} ${reviewStyles.root}`}
      aria-label="Saved plan review"
      aria-busy={busy}
    >
      {!localCommercialEnabled ? (
        <div className={reviewStyles.notice}>
          <h3>Approval is unavailable in this preview</h3>
          <p>
            Your saved plan is safe. Test approval needs to be enabled before
            you can create a campaign. You don’t need to save it again.
          </p>
        </div>
      ) : (
        <p>
          Check your saved details below. Approval is a separate confirmation;
          it does not launch the campaign or pay creators.
        </p>
      )}
      {!canManage ? (
        <p>Campaign manager access is required to review this plan.</p>
      ) : !context ? (
        <div>
          <p>
            {blockedReason ??
              "Save complete dates and resolve any date conflicts before reviewing."}
          </p>
          <a className="package-terms__text-action" href={blockedTarget}>
            {blockedTarget === "#basket-strategy"
              ? "Return to purpose and measurement"
              : "Return to saved dates"}
          </a>
        </div>
      ) : null}
      {!s && (!active || message) ? (
        <ActionButton
          type="button"
          disabled={!canManage || !context || busy}
          onClick={() => void open()}
        >
          {busy
            ? "Loading saved plan…"
            : active
              ? "Try loading the plan again"
              : "Review saved plan"}
        </ActionButton>
      ) : null}
      <p role="status" aria-live="polite" className={reviewStyles.status}>
        {message}
      </p>
      {canManage && message && !busy && !s ? (
        <nav aria-label="Resolve saved-plan review">
          <a className="package-terms__text-action" href="#basket-strategy">
            Check purpose and measurement
          </a>{" "}
          <a className="package-terms__text-action" href="#basket-roster">
            Check creator terms
          </a>{" "}
          <a className="package-terms__text-action" href="#basket-timing">
            Check saved dates
          </a>
        </nav>
      ) : null}
      {s ? (
        <div className={reviewStyles.snapshot}>
          <header className={reviewStyles.heading}>
            <h3 ref={heading} tabIndex={-1}>
              Scenario {s.scenario.code}: {s.scenario.name}
            </h3>
            <p>{s.basket.name}</p>
          </header>
          <dl className={styles.summary}>
            <div>
              <dt>Goal</dt>
              <dd>{s.strategyBinding.strategy.goal}</dd>
            </div>
            <div>
              <dt>Audience</dt>
              <dd>{s.strategyBinding.strategy.audience}</dd>
            </div>
          </dl>
          <CampaignTimingSummary
            timing={s.strategyBinding.timing}
            title="Dates in this saved plan"
            label="Dates in the saved plan review"
          />
          <section className={reviewStyles.terms}>
            <h3>Included creator terms</h3>
            <p>
              This scenario includes {s.packages.length}{" "}
              {s.packages.length === 1 ? "package" : "packages"} for{" "}
              {includedCreatorCount}{" "}
              {includedCreatorCount === 1 ? "creator" : "creators"}. The full
              shortlist contains {s.strategyBinding.selectedCreatorIds.length}{" "}
              creators; excluded packages are not included here. These are
              proposed commitments, not payments.
            </p>
            {s.packages.map((p) => (
              <details key={p.id} className={styles.reviewPackage}>
                <summary>{p.packageLabel}</summary>
                <p>{p.deliverableSummary}</p>
                {p.commercialDetail?.schemaVersion === 2 &&
                p.commercialDetail.commercialBasis ===
                  "unpaid_internal_test" ? (
                  <p>
                    Unpaid internal test. No creator payment commitment. Reason:{" "}
                    {p.commercialDetail.unpaidReason}
                  </p>
                ) : null}
                {p.compensationLines.length > 0 ? (
                  <ul>
                    {p.compensationLines.map((line) => (
                      <li key={line.id}>
                        {line.assetType === "cash"
                          ? `${line.currencyCode} ${baseUnitsToDecimal(line.amountMinor, 2)}`
                          : `${line.assetType.toUpperCase()} ${baseUnitsToDecimal(line.tokenAmountRaw, line.tokenDecimals)}`}
                        {line.model === "fixed"
                          ? " fixed"
                          : ` per ${line.variableUnit} (variable)`}
                        {line.assetType !== "cash" ? (
                          <p>
                            Mint {line.tokenMint}. Unit price USD{" "}
                            {line.unitPriceUsd}; source {line.priceSource};
                            valued {line.valuedAt}.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ))}
          </section>
          <details className={styles.reviewPackage}>
            <summary>Measurement and strategy details</summary>
            <p>{s.strategyBinding.strategy.rationale}</p>
            <p>
              Qualifying action:{" "}
              {s.strategyBinding.strategy.measurement?.qualifyingAction}
            </p>
            <p>
              Attribution window:{" "}
              {s.strategyBinding.strategy.measurement?.attributionWindowDays}{" "}
              days. Longer measurement does not extend this window, consent,
              rights or creator obligations.
            </p>
            <h4>Distribution plan</h4>
            {s.strategyBinding.strategy.distributionMode ===
            "unpaid_private_link" ? (
              <p>
                One unpaid private test link. No planned channel spend or public
                post.
              </p>
            ) : (
              <ul>
                {s.strategyBinding.strategy.allocations.map((value, i) => (
                  <li key={i}>
                    {value.channel.replaceAll("_", " ")}: {value.format};{" "}
                    {value.plannedSpendBps / 100}% of planned spend.{" "}
                    {value.rationale}
                  </li>
                ))}
              </ul>
            )}
            <h4>Assumptions</h4>
            <ul>
              {s.strategyBinding.strategy.assumptions.map((value, i) => (
                <li key={i}>{value}</li>
              ))}
            </ul>
            <h4>Missing evidence</h4>
            <ul>
              {s.strategyBinding.strategy.missingEvidence.map((value, i) => (
                <li key={i}>{value}</li>
              ))}
            </ul>
            <h4>Excluded claims</h4>
            <ul>
              {s.strategyBinding.strategy.exclusions.map((value, i) => (
                <li key={i}>{value}</li>
              ))}
            </ul>
            <p>
              Saved strategy revision {s.strategyBinding.revision}. Reload this
              review after changes; it does not reserve terms.
            </p>
          </details>
          {localCommercialEnabled && review && context ? (
            localCommercialMode === "devnet" ? (
              <LocalDevnetCommercialApproval
                key={review.snapshotHash}
                basketId={s.basket.id}
                scenarioId={s.scenario.id}
                revision={s.strategyBinding.revision}
                snapshotHash={review.snapshotHash}
                ownerId={context.expectedOwnerId}
              />
            ) : (
              <BrowserCommercialApproval
                key={review.snapshotHash}
                basketId={s.basket.id}
                scenarioId={s.scenario.id}
                revision={s.strategyBinding.revision}
                snapshotHash={review.snapshotHash}
                ownerId={context.expectedOwnerId}
              />
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
