"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ActionButton } from "@landed/ui";
import {
  CampaignTimingFields,
  CampaignTimingSummary,
} from "./campaign-timing-fields";
import { basketTimingClient } from "@/lib/baskets/timing-client";
import {
  createTimingSession,
  type TimingSessionClient,
  type TimingSessionState,
  type TimingRecoveryDraft,
} from "@/lib/baskets/timing-session";
import { timingToFields } from "@/lib/baskets/timing-fields";
import { BasketSavedPlanReview } from "./basket-saved-plan-review";
import type { LocalCommercialMode } from "./browser-commercial-review";
import {
  findTimingDraft,
  forgetTimingDraft,
  rememberTimingDraft,
} from "@/lib/baskets/timing-recovery";

export type TimingPanelStatus = {
  phase: "loading" | "ready" | "saving" | "unconfirmed" | "missing" | "other";
  hasSavedTiming: boolean;
  dirty: boolean;
  needsReview: boolean;
  recovering: boolean;
  errorCount: number;
  editable: boolean;
};

export function BasketTimingPanel({
  projectId,
  basketId,
  canManage,
  client: suppliedClient,
  scenarioId,
  reviewKey = "",
  reviewBlocked = false,
  minimumReviewRevision = 0,
  localCommercialEnabled = false,
  localCommercialMode = "browser",
  onStatusChange,
  reviewTarget = null,
}: {
  projectId: string;
  basketId: string;
  canManage: boolean;
  client?: TimingSessionClient;
  scenarioId?: string;
  reviewKey?: string;
  reviewBlocked?: boolean;
  minimumReviewRevision?: number;
  localCommercialEnabled?: boolean;
  localCommercialMode?: LocalCommercialMode;
  /** UI-03: read-only date status for the plan's step list. */
  onStatusChange?: (status: TimingPanelStatus) => void;
  /** UI-03: where the saved-plan review renders (the plan's review step). */
  reviewTarget?: HTMLElement | null;
}) {
  const client = useMemo(
    () => suppliedClient ?? basketTimingClient(projectId, basketId),
    [suppliedClient, projectId, basketId],
  );
  const session = useRef<ReturnType<typeof createTimingSession> | null>(null);
  const revisionRefresh = useRef(0);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const [recovery, setRecovery] = useState<TimingRecoveryDraft | null>(null);
  const [owned, setOwned] = useState<{
    client: TimingSessionClient;
    state: TimingSessionState;
  } | null>(null);
  const state = owned?.client === client ? owned.state : null;
  const form = useRef<HTMLFormElement>(null);
  function focusDates() {
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLInputElement>("input:not(:disabled)")
        ?.focus(),
    );
  }
  useEffect(
    () =>
      client.onIdentityChange?.(() => {
        session.current?.dispose();
        session.current = null;
        revisionRefresh.current = 0;
        setOwned(null);
        setRecovery(null);
        setIdentityEpoch((value) => value + 1);
      }),
    [client],
  );
  useEffect(() => {
    const current = createTimingSession(client);
    session.current = current;
    let mounted = true;
    const timer = window.setTimeout(() => {
      void current.loadSaved().then(() => {
        if (!mounted || session.current !== current) return;
        const fresh = current.read();
        setOwned({ client, state: fresh });
        setRecovery(
          canManage &&
            fresh.saved?.canManage !== false &&
            fresh.phase === "ready" &&
            fresh.saved?.ownerId
            ? findTimingDraft(fresh.saved.ownerId, projectId, basketId)
            : null,
        );
      });
    }, 0);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      current.dispose();
      if (session.current === current) session.current = null;
    };
  }, [client, identityEpoch, canManage, projectId, basketId]);

  const publish = useCallback(
    (current: ReturnType<typeof createTimingSession>) => {
      const next = current.read();
      if (canManage && next.saved?.canManage !== false)
        rememberTimingDraft(projectId, basketId, next);
      setOwned({ client, state: next });
    },
    [basketId, canManage, client, projectId],
  );

  const dirty =
    !!state?.saved &&
    JSON.stringify(state.fields) !==
      JSON.stringify(timingToFields(state.saved.timing));
  const busy = !state || state.phase === "loading" || state.phase === "saving";
  useEffect(() => {
    const current = session.current;
    if (
      !current ||
      !state?.saved ||
      state.phase !== "ready" ||
      state.saved.revision >= minimumReviewRevision ||
      revisionRefresh.current >= minimumReviewRevision ||
      recovery
    )
      return;
    revisionRefresh.current = minimumReviewRevision;
    const datesWereUnchanged = !dirty;
    const refresh = async () => {
      const pending = current.loadSaved();
      publish(current);
      await pending;
      if (session.current !== current) return;
      if (datesWereUnchanged)
        current.adoptLatestIfUnchanged(minimumReviewRevision);
      publish(current);
    };
    void refresh();
  }, [
    dirty,
    minimumReviewRevision,
    publish,
    recovery,
    state?.phase,
    state?.saved,
  ]);
  useEffect(() => {
    if (!dirty && state?.phase !== "saving") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const destination = new URL(link.href);
      if (
        destination.pathname === location.pathname &&
        destination.search === location.search &&
        destination.origin === location.origin
      )
        return;
      if (
        !window.confirm("Leave this basket without saving your date changes?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onLink, true);
    };
  }, [dirty, state?.phase]);

  async function run(action: "save" | "loadSaved") {
    const current = session.current;
    if (!current || (action === "save" && !canManage)) return;
    const pending = current[action]();
    publish(current);
    await pending;
    if (session.current !== current) return;
    publish(current);
    // Wait for React to commit field errors before moving keyboard focus.
    if (action === "save" && Object.keys(current.read().errors).length)
      requestAnimationFrame(() => {
        if (session.current === current)
          form.current
            ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
            ?.focus();
      });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run("save");
  }
  const saved = state?.saved;
  const editable = canManage && saved?.canManage !== false;
  const statusPhase: TimingPanelStatus["phase"] =
    !state || state.phase === "loading"
      ? "loading"
      : state.phase === "saving"
        ? "saving"
        : state.phase === "ready" ||
            state.phase === "unconfirmed" ||
            state.phase === "missing"
          ? state.phase
          : "other";
  const errorCount = Object.keys(state?.errors ?? {}).length;
  useEffect(() => {
    onStatusChange?.({
      phase: statusPhase,
      hasSavedTiming: !!saved?.timing,
      dirty,
      needsReview: !!state?.needsReview,
      recovering: !!recovery,
      errorCount,
      editable,
    });
  }, [
    onStatusChange,
    statusPhase,
    saved?.timing,
    dirty,
    state?.needsReview,
    recovery,
    errorCount,
    editable,
  ]);
  const withReviewTarget = (node: ReactNode) =>
    reviewTarget ? createPortal(node, reviewTarget) : node;
  return (
    <section
      id="basket-timing"
      tabIndex={-1}
      className="commercial-approval__confirm basket-timing-panel"
      aria-label="Campaign date planning"
      style={{ scrollMarginTop: 80 }}
    >
      {!editable ? (
        <p>Campaign manager access is required to change dates.</p>
      ) : null}
      {recovery &&
      editable &&
      state?.saved?.ownerId === recovery.saved.ownerId ? (
        <section aria-label="Recover unsaved dates">
          <h2>You have unsaved dates from this visit</h2>
          <p>
            Restore them to review, or discard them and use the saved dates.
            Nothing will be saved automatically.
          </p>
          <div className="basket-timing-actions">
            <ActionButton
              type="button"
              disabled={busy}
              onClick={() => {
                const current = session.current;
                if (current?.restoreDraft(recovery)) {
                  setRecovery(null);
                  publish(current);
                  focusDates();
                }
              }}
            >
              Restore unsaved dates
            </ActionButton>
            <button
              type="button"
              className="package-terms__text-action"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm("Discard your unsaved dates from this visit?")
                )
                  return;
                forgetTimingDraft(recovery.saved.ownerId!, projectId, basketId);
                setRecovery(null);
                focusDates();
              }}
            >
              Discard unsaved dates
            </button>
          </div>
        </section>
      ) : null}
      <form ref={form} onSubmit={submit} noValidate>
        <CampaignTimingFields
          value={state?.fields ?? timingToFields(null)}
          errors={state?.errors}
          disabled={!editable || busy || !saved || !!recovery}
          onChange={(field, value) => {
            const current = session.current;
            if (!current || !editable) return;
            current.edit(field, value);
            publish(current);
          }}
        />
        <p role="status" aria-live="polite">
          {recovery && editable
            ? "Unsaved dates are available. Choose Restore unsaved dates or Discard unsaved dates."
            : state?.message || "Loading saved dates…"}
        </p>
        <div className="basket-timing-actions">
          <ActionButton
            type="submit"
            disabled={
              !editable || busy || !saved || !!state?.needsReview || !!recovery
            }
          >
            {state?.phase === "saving" ? "Saving dates…" : "Save dates"}
          </ActionButton>
          <button
            type="button"
            className="package-terms__text-action"
            disabled={busy || !!recovery}
            onClick={() => void run("loadSaved")}
          >
            Load saved dates
          </button>
        </div>
      </form>
      <p>
        {localCommercialEnabled
          ? "Saving dates doesn’t approve anything. When every step is done, use Review and approve. Live launch remains unavailable."
          : "Preview only: you can save dates here, but approval and campaign launch are not available in this date-planning preview."}
      </p>
      {state?.latest ? (
        <section aria-label="Saved dates to review">
          {state.latest.timing ? (
            <CampaignTimingSummary
              timing={state.latest.timing}
              title="Saved dates to compare"
              label="Saved campaign dates to compare"
            />
          ) : (
            <p>No dates are saved in this version.</p>
          )}
          <button
            type="button"
            className="package-terms__text-action"
            onClick={() => {
              const current = session.current;
              if (!current) return;
              if (
                !window.confirm(
                  "Replace your local date edits with this saved version?",
                )
              )
                return;
              current.adoptLatest();
              publish(current);
            }}
          >
            Replace local edits with these saved dates
          </button>
        </section>
      ) : null}
      {saved?.timing && !state?.needsReview ? (
        <section aria-label="Last confirmed saved dates">
          <CampaignTimingSummary
            timing={saved.timing}
            title="Saved dates"
            label="Last saved campaign dates"
          />
          {dirty ? (
            <p>These saved dates do not include your unsaved changes.</p>
          ) : null}
        </section>
      ) : null}
      {scenarioId
        ? withReviewTarget(
            <BasketSavedPlanReview
              localCommercialEnabled={localCommercialEnabled}
              localCommercialMode={localCommercialMode}
              key={JSON.stringify([
                reviewKey,
                reviewBlocked,
                minimumReviewRevision,
                scenarioId,
                saved,
                state?.fields,
                state?.phase,
                state?.needsReview,
                !!recovery,
                identityEpoch,
              ])}
              canManage={editable}
              blockedTarget={
                reviewBlocked ? "#basket-strategy" : "#basket-timing"
              }
              blockedReason={
                reviewBlocked
                  ? "Save or resolve your strategy changes before reviewing the saved plan."
                  : saved && saved.revision < minimumReviewRevision
                    ? "The strategy changed. Reload saved dates to review the latest plan together."
                    : undefined
              }
              context={
                !reviewBlocked &&
                saved &&
                saved.revision >= minimumReviewRevision &&
                editable &&
                !busy &&
                !dirty &&
                !recovery &&
                !state?.needsReview &&
                saved?.ownerId &&
                saved.timing
                  ? {
                      expectedOwnerId: saved.ownerId,
                      expectedRevision: saved.revision,
                      expectedTiming: saved.timing,
                      scenarioId,
                      basketId,
                    }
                  : null
              }
            />,
          )
        : null}
    </section>
  );
}
