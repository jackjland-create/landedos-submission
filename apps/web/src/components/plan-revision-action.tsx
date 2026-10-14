"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";
import styles from "./campaign-plan.module.css";

const responseSchema = z.object({
  basketId: z.uuid(),
  sourcePlanId: z.uuid(),
  requestId: z.uuid(),
});

type PlanRevisionActionProps = {
  projectId: string;
  basketId: string;
  sourcePlanId: string;
  theme: "light" | "dark";
  /** Explicit campaign setup creates a strategy-capable draft, never a rebind. */
  measurementCampaignId?: string;
};

/** BSK-08/09: creates a separate draft, never unlocks an approved plan. */
export function PlanRevisionAction(props: PlanRevisionActionProps) {
  // Next.js may preserve client components when navigating between records.
  // Receipts, confirmation and in-flight work belong to one exact source only.
  return (
    <ScopedPlanRevisionAction
      key={JSON.stringify([
        props.projectId,
        props.basketId,
        props.sourcePlanId,
        props.measurementCampaignId ?? null,
      ])}
      {...props}
    />
  );
}

function ScopedPlanRevisionAction({
  projectId,
  basketId,
  sourcePlanId,
  theme,
  measurementCampaignId,
}: PlanRevisionActionProps) {
  const router = useRouter();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const draftLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (confirming && !draftId) confirmButton.current?.focus();
    if (draftId) draftLink.current?.focus();
  }, [confirming, draftId]);
  async function createDraft() {
    if (inFlight.current || draftId) return;
    inFlight.current = true;
    setPending(true);
    setMessage("");
    try {
      // Same exact request survives closing/reopening and uncertain retries.
      if (!requestId.current) {
        const storageKey = measurementCampaignId
          ? `measurement-draft:${projectId}:${measurementCampaignId}:${sourcePlanId}`
          : `plan-revision:${projectId}:${basketId}:${sourcePlanId}`;
        const retained = sessionStorage.getItem(storageKey);
        requestId.current = z.uuid().safeParse(retained).success
          ? retained
          : crypto.randomUUID();
        sessionStorage.setItem(storageKey, requestId.current!);
      }
      const response = await fetch(
        measurementCampaignId
          ? `/api/projects/${projectId}/campaigns/${measurementCampaignId}/measurement-draft`
          : `/api/projects/${projectId}/baskets/${basketId}/revision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePlanId, requestId: requestId.current }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ message: z.string() }).safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.message
            : "Draft creation was not confirmed. Retry this same request.",
        );
      }
      const result = responseSchema.parse(body);
      if (
        (measurementCampaignId &&
          z
            .object({ campaignId: z.literal(measurementCampaignId) })
            .safeParse(body).success === false) ||
        result.sourcePlanId !== sourcePlanId ||
        result.requestId !== requestId.current ||
        result.basketId === basketId
      )
        throw new Error(
          "Draft creation was not confirmed. Retry this same request.",
        );
      if (!live.current) return;
      setDraftId(result.basketId);
      setMessage(
        "New draft created. The approved plan and its campaign are unchanged.",
      );
      if (measurementCampaignId) {
        router.push(
          `/projects/${encodeURIComponent(projectId)}/baskets/${result.basketId}?theme=${theme}&step=measurement`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error && !(error instanceof z.ZodError)
          ? error.message
          : "Draft creation was not confirmed. Retry this same request.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  if (measurementCampaignId)
    return (
      <section className={styles.revisionAction} aria-label="Set up results">
        <p>
          Choose what counts as a result in a new draft plan. Your current
          campaign stays unchanged.
        </p>
        <p className={styles.small}>
          You’ll review and approve the draft before creating a new campaign.
        </p>
        {draftId ? (
          <a
            ref={draftLink}
            className="application-button application-button--hero"
            href={`/projects/${encodeURIComponent(projectId)}/baskets/${draftId}?theme=${theme}&step=measurement`}
          >
            Continue setup
          </a>
        ) : (
          <button
            type="button"
            className="application-button application-button--hero"
            disabled={pending}
            aria-busy={pending}
            onClick={createDraft}
          >
            {pending
              ? "Opening draft…"
              : message
                ? "Try again"
                : "Set up results"}
          </button>
        )}
        {message && (
          <p className={styles.small} role="status">
            {message}
          </p>
        )}
      </section>
    );
  return (
    <section
      className={styles.revisionAction}
      aria-label="Revise approved plan"
    >
      {!confirming ? (
        <button
          type="button"
          className={styles.button}
          onClick={() => setConfirming(true)}
        >
          {measurementCampaignId
            ? "Set up campaign measurement"
            : "Edit as new draft"}
        </button>
      ) : (
        <>
          <p className={styles.small}>
            {measurementCampaignId
              ? "Create a separate draft to choose what counts as a result and when to measure it. No rule is chosen automatically. The current campaign and links stay unchanged. Fresh approval and a new campaign are required. "
              : ""}
            Copy the approved target and selected creator terms into a new,
            unapproved plan. Retained strategy and dates are copied unchanged;
            review them before fresh approval. Other scenarios, campaigns and
            tracking links are not copied.
          </p>
          {draftId ? (
            <a
              ref={draftLink}
              className={styles.button}
              href={`/projects/${projectId}/baskets/${draftId}?theme=${theme}&step=${measurementCampaignId ? "measurement" : "target"}`}
            >
              {measurementCampaignId
                ? "Choose the success rule"
                : "Open editable draft"}
            </a>
          ) : (
            <button
              ref={confirmButton}
              type="button"
              className={styles.button}
              disabled={pending}
              onClick={createDraft}
            >
              {pending ? "Creating draft…" : "Create editable draft"}
            </button>
          )}
        </>
      )}
      <p className={styles.small} role="status">
        {message}
      </p>
    </section>
  );
}
