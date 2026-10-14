"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "@landed/ui";
import {
  assessBasketStrategy,
  basketStrategyChannelSchema,
  basketArchetypeSchema,
  saveBasketStrategyInputSchema,
  type BasketStrategyDefinition,
} from "@landed/contracts";
import {
  basketStrategyClient,
  type BasketStrategyClient,
} from "@/lib/baskets/strategy-client";
import {
  useBasketStrategy,
  type StrategyEdits,
} from "@/lib/baskets/use-basket-strategy";
import {
  recoverStrategyDraft,
  retainStrategyDraft,
  type StrategyRecovery,
} from "@/lib/baskets/strategy-recovery";
import { createClient } from "@/lib/supabase/client";
import styles from "./basket-strategy-editor.module.css";
import type { BasketMeasurementChoices } from "@/lib/baskets/measurement-choices";
import { BasketPurposeField } from "./basket-purpose-field";
import { PlanMeasurementPanel } from "./plan-measurement-panel";
import { ChannelShareField } from "./channel-share-field";

export type StrategyReviewState = {
  canSave?: boolean;
  saving?: boolean;
  blocked: boolean;
  revision: number;
  key: string;
  savedGoal?: string | null;
  identityConfirmed?: boolean;
  /**
   * UI-03: read-only summary of the SAVED strategy for plan step statuses.
   * Derived from existing state; never a second persistence path.
   */
  /** Whether the saved strategy has loaded, is loading or failed to load. */
  load?: "loading" | "failed" | "ready";
  summary?: {
    goal: string | null;
    audience: string | null;
    rationale: string | null;
    measurementVersionId: string | null;
    measurementName: string | null;
    primaryOutcome?: "qualified_wallets" | "verified_revenue" | null;
    /** Saved Goal and audience fields still missing, from the contract's
     * completeness check (assessBasketStrategy), in plain words. */
    purposeGaps: string[];
    /** True when the saved draft has no rule choice. */
    measurementMissing: boolean;
    dirty: boolean;
    needsReview: boolean;
    hasError: boolean;
    recovering: boolean;
  };
};
export type StrategySection = "all" | "purpose" | "measurement";

const purposeGapWords: Record<string, string> = {
  "strategy.goal": "goal",
  "strategy.audience": "audience",
  "strategy.rationale": "reason for this mix",
  "strategy.allocations": "channel mix that totals 100%",
  selectedCreatorIds: "chosen creators",
};

function strategyGaps(draft: Parameters<typeof assessBasketStrategy>[0]): {
  purposeGaps: string[];
  measurementMissing: boolean;
} {
  const { blockers } = assessBasketStrategy(draft);
  return {
    purposeGaps: blockers
      .map(({ field }) => purposeGapWords[field])
      .filter((word): word is string => !!word),
    measurementMissing: blockers.some(({ field }) =>
      field.startsWith("strategy.measurement"),
    ),
  };
}
type Props = {
  theme?: "light" | "dark";
  projectId: string;
  basketId: string;
  ownerId: string;
  canManage: boolean;
  allowPrivateLinkTest?: boolean;
  onReviewState: (state: StrategyReviewState) => void;
  client?: BasketStrategyClient;
  measurementChoices?: BasketMeasurementChoices;
  /** UI-03: which part of the one strategy form a plan drawer shows. */
  section?: StrategySection;
  footerSave?: boolean;
  onSaved?: (section: StrategySection) => void;
};

/** Identity is checked before tab-memory drafts can be displayed. */
export function BasketStrategyEditor(props: Props) {
  const { ownerId, onReviewState } = props;
  const [identity, setIdentity] = useState<string | null>(null);
  const [verification, setVerification] = useState<
    "checking" | "unavailable" | "signed_out" | "confirmed"
  >("checking");
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  useEffect(() => {
    const client = createClient();
    let active = true;
    let identityEpoch = 0;
    const timers: number[] = [];
    const verify = () => {
      const lookupEpoch = ++identityEpoch;
      setIdentity(null);
      setVerification("checking");
      void client.auth
        .getUser()
        .then((result) => {
          const { data, error } = result;
          if (!active || identityEpoch !== lookupEpoch) return;
          setIdentity(error ? null : (data.user?.id ?? null));
          setVerification(
            error ? "unavailable" : data.user ? "confirmed" : "signed_out",
          );
        })
        .catch(() => {
          if (!active || identityEpoch !== lookupEpoch) return;
          setIdentity(null);
          setVerification("unavailable");
        });
    };
    const initialEpoch = identityEpoch;
    timers.push(
      window.setTimeout(() => {
        if (active && identityEpoch === initialEpoch) verify();
      }, 0),
    );
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        identityEpoch += 1;
        setIdentity(null);
        setVerification("signed_out");
        return;
      }
      if (!session?.user) return;
      const eventEpoch = ++identityEpoch;
      setIdentity(null);
      setVerification("checking");
      // Do not call Supabase Auth from inside its state-change callback.
      timers.push(
        window.setTimeout(() => {
          if (active && identityEpoch === eventEpoch) verify();
        }, 0),
      );
    });
    return () => {
      active = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      data.subscription.unsubscribe();
    };
  }, [verificationAttempt]);
  useEffect(() => {
    if (identity !== ownerId)
      onReviewState({
        blocked: true,
        revision: 0,
        key: "identity-unconfirmed",
        identityConfirmed: false,
      });
  }, [identity, ownerId, onReviewState]);
  return verification === "confirmed" && identity === props.ownerId ? (
    <StrategyEditorSession
      key={`${props.ownerId}:${props.basketId}`}
      {...props}
    />
  ) : (
    <section
      id="basket-strategy"
      tabIndex={-1}
      className={styles.root}
      aria-label="Plan strategy"
    >
      <p role="status">
        {verification === "checking"
          ? "Confirming your session before showing this plan’s details."
          : verification === "unavailable"
            ? "We couldn’t confirm your session. Nothing on this plan was changed."
            : verification === "signed_out"
              ? "Your session has ended. Sign in to continue this plan."
              : "This plan belongs to another account. Sign in with the correct account."}
      </p>
      <div className="basket-package-actions">
        {verification === "unavailable" ? (
          <ActionButton
            type="button"
            onClick={() => setVerificationAttempt((value) => value + 1)}
          >
            Check session again
          </ActionButton>
        ) : null}
        {verification === "unavailable" ||
        verification === "signed_out" ||
        (verification === "confirmed" && identity !== props.ownerId) ? (
          <a
            className="package-terms__text-action"
            href={`/login?next=${encodeURIComponent(`/projects/${props.projectId}/baskets/${props.basketId}`)}`}
          >
            Sign in again
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function StrategyEditorSession({
  theme = "light",
  projectId,
  basketId,
  ownerId,
  canManage,
  allowPrivateLinkTest = false,
  onReviewState,
  client: suppliedClient,
  measurementChoices,
  section = "all",
  footerSave = false,
  onSaved,
}: Props) {
  const client = useMemo(
    () =>
      suppliedClient ??
      basketStrategyClient(projectId, basketId, fetch, ownerId),
    [suppliedClient, projectId, basketId, ownerId],
  );
  const editor = useBasketStrategy(client);
  const { state, dirty } = editor;
  const [recovery, setRecovery] = useState<StrategyRecovery | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [validation, setValidation] = useState<string[]>([]);
  const live = useRef(true);
  const initializedRef = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.saved && !initializedRef.current) {
      initializedRef.current = true;
      setRecovery(
        canManage ? recoverStrategyDraft(ownerId, projectId, basketId) : null,
      );
      setInitialized(true);
    }
  }, [state.saved, canManage, ownerId, projectId, basketId]);
  const blocked =
    !initialized ||
    !!recovery ||
    !!state.busy ||
    dirty ||
    state.needsReview ||
    !!state.error;
  const reviewKey = JSON.stringify([
    state.saved?.revision,
    state.edits,
    state.busy,
    state.needsReview,
    !!recovery,
    initialized,
  ]);
  useEffect(
    () =>
      onReviewState({
        canSave:
          canManage &&
          initialized &&
          !recovery &&
          !state.busy &&
          !state.needsReview &&
          dirty,
        saving: state.busy === "saving",
        blocked,
        revision: state.saved?.revision ?? 0,
        key: reviewKey,
        savedGoal: blocked ? null : state.saved?.draft.strategy.goal,
        identityConfirmed: true,
        load: state.saved
          ? "ready"
          : state.error && state.busy !== "loading"
            ? "failed"
            : "loading",
        summary: state.saved
          ? {
              goal: state.saved.draft.strategy.goal,
              audience: state.saved.draft.strategy.audience,
              rationale: state.saved.draft.strategy.rationale,
              measurementVersionId:
                state.saved.draft.strategy.measurement
                  ?.conversionRuleVersionId ?? null,
              measurementName:
                state.saved.draft.strategy.measurement?.qualifyingAction ??
                null,
              primaryOutcome:
                state.saved.draft.strategy.measurement?.primaryOutcome ?? null,
              ...strategyGaps(state.saved.draft),
              dirty,
              needsReview: state.needsReview,
              hasError: !!state.error,
              recovering: !!recovery,
            }
          : undefined,
      }),
    [
      blocked,
      state.saved,
      state.saved?.revision,
      state.saved?.draft.strategy.goal,
      reviewKey,
      onReviewState,
      dirty,
      state.needsReview,
      state.error,
      state.busy,
      recovery,
      canManage,
      initialized,
    ],
  );
  useEffect(() => {
    if (!dirty && state.busy !== "saving") return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
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
      const url = new URL(link.href);
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      if (
        !window.confirm(
          "Leave with unsaved strategy changes? You can recover edits when returning in this tab. A save already sent may still complete.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, state.busy]);
  const retain = (value: StrategyRecovery | null) =>
    retainStrategyDraft(ownerId, projectId, basketId, value);
  function change(edits: StrategyEdits) {
    if (!canManage || state.busy || recovery || !state.saved) return;
    setSavedNotice(false);
    setValidation([]);
    editor.edit(edits);
    retain({
      revision: state.saved.revision,
      edits,
      uncertain: state.needsReview,
    });
  }
  function strategy(patch: Partial<BasketStrategyDefinition>) {
    if (state.edits)
      change({
        ...state.edits,
        strategy: { ...state.edits.strategy, ...patch },
      });
  }
  async function save() {
    if (!canManage || recovery || !state.saved || !state.edits) return;
    const checked = saveBasketStrategyInputSchema.safeParse({
      ...state.edits,
      expectedRevision: state.saved.revision,
    });
    if (!checked.success) {
      setValidation(
        checked.error.issues.map(
          (issue) =>
            `${issue.path[1] === "allocations" ? `Channel ${Number(issue.path[2] ?? 0) + 1}` : String(issue.path.at(-1) ?? "Strategy")}: ${issue.message}`,
        ),
      );
      requestAnimationFrame(() => {
        form.current?.querySelectorAll("details").forEach((node) => {
          node.open = true;
        });
        form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
      });
      return;
    }
    retain({
      revision: state.saved.revision,
      edits: state.edits,
      uncertain: true,
    });
    const success = await editor.save();
    if (!live.current) return;
    if (success) {
      retain(null);
      setSavedNotice(true);
      onSaved?.(section);
    } else
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus(),
      );
  }
  const disabled = !canManage || !!state.busy || !!recovery || !initialized;
  const edits = state.edits;
  const mix = edits?.strategy.allocations ?? [];
  const privateLinkTest =
    edits?.strategy.distributionMode === "unpaid_private_link";
  const canChoosePrivateLink =
    allowPrivateLinkTest && state.saved?.draft.origin.kind === "custom";
  const choices =
    measurementChoices?.kind === "ready" ? measurementChoices.options : [];
  const words = (value: string) =>
    value === "x" ? "X" : value.replaceAll("_", " ");
  return (
    <section
      id="basket-strategy"
      tabIndex={-1}
      className={styles.root}
      aria-label="Plan strategy"
    >
      <h2 hidden={section === "measurement"}>Who are we reaching, and why?</h2>
      <p hidden={section === "measurement"}>
        Start with a goal and audience, then refine only what needs changing.
        Suggestions reuse Landed’s prepared wording; they do not select
        creators, change fees or set measurement automatically.
      </p>
      <p role="status">
        {state.busy === "loading"
          ? section === "measurement"
            ? "Loading saved choice…"
            : "Loading saved strategy…"
          : state.busy === "saving"
            ? section === "measurement"
              ? "Saving changes…"
              : "Saving strategy…"
            : dirty
              ? section === "measurement"
                ? "Unsaved changes"
                : "Unsaved strategy changes"
              : savedNotice
                ? section === "measurement"
                  ? "Changes saved"
                  : "Strategy saved"
                : state.saved
                  ? section === "measurement"
                    ? "Saved draft"
                    : "Saved strategy"
                  : section === "measurement"
                    ? "We couldn’t load the saved choice"
                    : "Strategy is unavailable"}
      </p>
      {!canManage && (
        <p role="alert">
          Campaign manager access is required to edit this strategy.
        </p>
      )}
      {recovery && (
        <section aria-label="Recover unsaved strategy">
          <h3>Unsaved strategy from this visit</h3>
          <p>
            Restore it to review, or discard it. Nothing is saved automatically.
            Recovery lasts up to 30 minutes in this tab; it does not survive a
            full reload.
          </p>
          <ActionButton
            type="button"
            disabled={!!state.busy}
            onClick={() => {
              editor.restore(
                recovery.edits,
                recovery.revision,
                recovery.uncertain,
              );
              setRecovery(null);
            }}
          >
            Restore unsaved strategy
          </ActionButton>
          <button
            type="button"
            className="package-terms__text-action"
            onClick={() => {
              if (
                window.confirm("Discard the unsaved strategy from this visit?")
              ) {
                retain(null);
                setRecovery(null);
              }
            }}
          >
            Discard unsaved strategy
          </button>
        </section>
      )}
      <form
        id={`basket-strategy-form-${basketId}`}
        data-plan-save={footerSave ? "true" : undefined}
        onFocusCapture={(event) => {
          const field = event.target;
          if (
            field instanceof HTMLTextAreaElement ||
            (field instanceof HTMLInputElement &&
              ["text", "number"].includes(field.type))
          )
            field.select();
        }}
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {!!validation.length && (
          <div role="alert" tabIndex={-1}>
            <p>Check these strategy details:</p>
            <ul>
              {validation.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        {state.error && (
          <p role="alert" tabIndex={-1}>
            {state.error.message}
          </p>
        )}
        {state.needsReview && (
          <p role="alert">
            The saved plan may have changed. Your edits are kept here. Check the
            saved version before saving again.
          </p>
        )}
        {(state.error || state.needsReview) && (
          <ActionButton
            type="button"
            disabled={!!state.busy}
            onClick={() => void editor.reviewSaved()}
          >
            Check saved strategy
          </ActionButton>
        )}
        {state.latest && (
          <section aria-label="Compare saved strategy">
            <h3>Saved strategy for comparison</h3>
            <p>{state.latest.draft.name}</p>
            <p>Goal: {state.latest.draft.strategy.goal ?? "Not set"}</p>
            <p>Audience: {state.latest.draft.strategy.audience ?? "Not set"}</p>
            <details>
              <summary>All saved strategy details</summary>
              <pre className={styles.comparison}>
                {JSON.stringify(state.latest.draft.strategy, null, 2)}
              </pre>
            </details>
            <p>
              Your local edits remain in the form below. Using the saved version
              discards them.
            </p>
            <ActionButton
              type="button"
              disabled={!!state.busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Discard your local edits and use this saved strategy?",
                  )
                ) {
                  editor.useSavedVersion();
                  retain(null);
                  setSavedNotice(false);
                  setValidation([]);
                }
              }}
            >
              Discard my edits and use saved strategy
            </ActionButton>
          </section>
        )}
        {edits && (
          <>
            <div hidden={section === "measurement"}>
              <fieldset disabled={disabled} className={styles.fields}>
                <legend>Plan name</legend>
                <label>
                  <span>
                    Plan name
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <input
                    name="basket-name"
                    autoComplete="off"
                    required
                    maxLength={120}
                    value={edits.name}
                    onChange={(e) => change({ ...edits, name: e.target.value })}
                  />
                </label>
              </fieldset>
              <fieldset disabled={disabled} className={styles.fields}>
                <legend>Choose your direction</legend>
                {(["goal", "audience"] as const).map((field) => (
                  <BasketPurposeField
                    key={field}
                    field={field}
                    value={edits.strategy[field]}
                    onChange={(value) => strategy({ [field]: value })}
                  />
                ))}
              </fieldset>
              <fieldset disabled={disabled} className={styles.fields}>
                <legend>Reason for this strategy</legend>
                <label>
                  <span>
                    {privateLinkTest
                      ? "Why this private test?"
                      : "Why this mix?"}{" "}
                    (required before approval)
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <textarea
                    name="strategy-rationale"
                    aria-required="true"
                    data-required-missing={!edits.strategy.rationale?.trim()}
                    autoComplete="off"
                    aria-describedby="strategy-rationale-help"
                    maxLength={1000}
                    rows={2}
                    value={edits.strategy.rationale ?? ""}
                    onChange={(e) =>
                      strategy({ rationale: e.target.value || null })
                    }
                  />
                </label>
                <p id="strategy-rationale-help">
                  {privateLinkTest
                    ? "Explain why this unpaid private-link test is needed."
                    : "Explain why this creator and channel mix fits your goal."}{" "}
                  You can save an unfinished draft, but add this reason before
                  reviewing the plan for approval.
                </p>
              </fieldset>
              <details className={styles.detail}>
                <summary>Additional context (optional)</summary>
                <fieldset disabled={disabled} className={styles.fields}>
                  {([["sector", "Sector (optional)", 120]] as const).map(
                    ([field, label, max]) => (
                      <label key={field}>
                        {label}
                        <textarea
                          aria-label={label}
                          name={`strategy-${field}`}
                          autoComplete="off"
                          maxLength={max}
                          rows={2}
                          value={edits.strategy[field] ?? ""}
                          onChange={(e) =>
                            strategy({ [field]: e.target.value || null })
                          }
                        />
                      </label>
                    ),
                  )}
                </fieldset>
              </details>
              {(canChoosePrivateLink || privateLinkTest) && (
                <fieldset
                  disabled={disabled || !canChoosePrivateLink}
                  className={styles.fields}
                >
                  <legend>Distribution plan</legend>
                  <label>
                    How will this test be shared?
                    <select
                      name="distribution-mode"
                      autoComplete="off"
                      value={
                        privateLinkTest
                          ? "unpaid_private_link"
                          : "allocated_spend"
                      }
                      onChange={(event) => {
                        if (event.target.value === "unpaid_private_link") {
                          if (
                            mix.length &&
                            !window.confirm(
                              "Switch to one unpaid private link? This removes the unsaved planned channel mix. The saved strategy changes only when you save.",
                            )
                          )
                            return;
                          strategy({
                            distributionMode: "unpaid_private_link",
                            allocations: [],
                          });
                        } else strategy({ distributionMode: undefined });
                      }}
                    >
                      <option value="allocated_spend">
                        Planned channel spend
                      </option>
                      <option value="unpaid_private_link">
                        One unpaid private test link
                      </option>
                    </select>
                  </label>
                  {privateLinkTest && (
                    <p>
                      Internal devnet test only. No public post, planned channel
                      spend or creator payment. The approved plan must contain
                      one unpaid creator and a private tracked link.
                    </p>
                  )}
                </fieldset>
              )}
              {!privateLinkTest && (
                <details className={styles.detail}>
                  <summary>
                    Planned channel mix ·{" "}
                    {mix.reduce((sum, row) => sum + row.plannedSpendBps, 0) /
                      100}
                    % allocated
                  </summary>
                  <p>
                    Shares describe planned spend, not reach or return. A draft
                    can be saved before allocation totals 100%.
                  </p>
                  {!mix.length && (
                    <p>No channel mix yet. Add a channel to start planning.</p>
                  )}
                  {mix.map((row, index) => {
                    const update = (patch: Partial<typeof row>) =>
                      strategy({
                        allocations: mix.map((item, i) =>
                          i === index ? { ...item, ...patch } : item,
                        ),
                      });
                    return (
                      <fieldset
                        key={index}
                        disabled={disabled}
                        className={`${styles.fields} ${styles.channelFields}`}
                      >
                        <legend>Channel {index + 1}</legend>
                        <label>
                          Channel
                          <select
                            value={row.channel}
                            name={`channel-${index}`}
                            onChange={(e) =>
                              update({
                                channel: basketStrategyChannelSchema.parse(
                                  e.target.value,
                                ),
                              })
                            }
                          >
                            {basketStrategyChannelSchema.options.map(
                              (value) => (
                                <option key={value} value={value}>
                                  {words(value)}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Creator role
                          <select
                            value={row.archetype}
                            name={`role-${index}`}
                            onChange={(e) =>
                              update({
                                archetype: basketArchetypeSchema.parse(
                                  e.target.value,
                                ),
                              })
                            }
                          >
                            {basketArchetypeSchema.options.map((value) => (
                              <option key={value} value={value}>
                                {words(value)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>
                            Format
                            <span
                              className="required-field-marker"
                              aria-hidden="true"
                              title="Required"
                            />
                          </span>
                          <input
                            name={`format-${index}`}
                            placeholder="e.g. Thread"
                            autoComplete="off"
                            required
                            maxLength={120}
                            value={row.format}
                            onChange={(e) => update({ format: e.target.value })}
                          />
                        </label>
                        <ChannelShareField
                          name={`share-${index}`}
                          value={row.plannedSpendBps}
                          onChange={(plannedSpendBps) =>
                            update({ plannedSpendBps })
                          }
                        />
                        <label className={styles.channelReason}>
                          <span>
                            Reason for this channel
                            <span
                              className="required-field-marker"
                              aria-hidden="true"
                              title="Required"
                            />
                          </span>
                          <textarea
                            name={`reason-${index}`}
                            autoComplete="off"
                            required
                            maxLength={1000}
                            value={row.rationale}
                            onChange={(e) =>
                              update({ rationale: e.target.value })
                            }
                          />
                        </label>
                        <div className={styles.channelActions}>
                          <button
                            type="button"
                            className="package-terms__text-action"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Remove this planned channel? The saved strategy changes only when you save.",
                                )
                              )
                                strategy({
                                  allocations: mix.filter(
                                    (_, i) => i !== index,
                                  ),
                                });
                            }}
                          >
                            Remove channel {index + 1}
                          </button>
                        </div>
                      </fieldset>
                    );
                  })}
                  <div className={styles.addChannel}>
                    <ActionButton
                      type="button"
                      disabled={disabled || mix.length >= 20}
                      onClick={() =>
                        strategy({
                          allocations: [
                            ...mix,
                            {
                              channel: "x",
                              archetype: "analyst",
                              format: "",
                              plannedSpendBps: 0,
                              rationale: "",
                            },
                          ],
                        })
                      }
                    >
                      Add a channel
                    </ActionButton>
                  </div>
                </details>
              )}
            </div>
            {(measurementChoices || section === "measurement") && (
              <div hidden={section === "purpose"}>
                <PlanMeasurementPanel
                  kind={measurementChoices?.kind ?? "unavailable"}
                  choices={choices}
                  selectedId={
                    edits.strategy.measurement?.conversionRuleVersionId ?? null
                  }
                  savedId={
                    state.saved?.draft.strategy.measurement
                      ?.conversionRuleVersionId ?? null
                  }
                  disabled={
                    disabled ||
                    measurementChoices?.kind !== "ready" ||
                    !choices.some((choice) => choice.supported)
                  }
                  canManage={canManage}
                  settingsHref={`/projects/${projectId}/settings/conversions?plan=${encodeURIComponent(basketId)}&theme=${theme}`}
                  onChoose={(chosen) => {
                    if (chosen && !chosen.supported) return;
                    if (
                      edits.strategy.measurement &&
                      !window.confirm(
                        chosen
                          ? "Replace this plan's rule choice with qualified-wallet measurement (not revenue)? Save strategy to keep the change. Existing rules, reports and approved campaigns will not change."
                          : "Remove this plan's rule choice? Save strategy to keep the change. Existing rules, reports and approved campaigns will not change.",
                      )
                    )
                      return;
                    strategy({
                      measurement: chosen
                        ? {
                            primaryOutcome: "qualified_wallets",
                            qualifyingAction: chosen.name,
                            conversionRuleVersionId: chosen.id,
                            attributionModel: "last_eligible_touch",
                            attributionWindowDays: 7,
                            leadingIndicators:
                              edits.strategy.measurement?.leadingIndicators ??
                              [],
                            retentionWindowDays:
                              edits.strategy.measurement?.retentionWindowDays ??
                              null,
                            revenueTreatment: "verified_protocol_revenue_only",
                          }
                        : null,
                    });
                  }}
                />
              </div>
            )}
            <details className={styles.detail} hidden={section === "purpose"}>
              <summary>Measurement and evidence assumptions</summary>
              <p>
                Rule on this draft:{" "}
                {edits.strategy.measurement?.qualifyingAction ??
                  "none chosen yet"}
                . Approval is a separate step.
              </p>
              {(["assumptions", "missingEvidence", "exclusions"] as const).map(
                (field) => (
                  <div key={field}>
                    <h3>
                      {field === "missingEvidence"
                        ? "Missing evidence"
                        : words(field)}
                    </h3>
                    {edits.strategy[field].length ? (
                      <ul>
                        {edits.strategy[field].map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>None recorded.</p>
                    )}
                  </div>
                ),
              )}
            </details>
            {!footerSave && (
              <ActionButton
                type="submit"
                disabled={disabled || state.needsReview || !dirty}
                aria-busy={state.busy === "saving"}
              >
                Save strategy
              </ActionButton>
            )}
            {!footerSave && (
              <p>
                Save strategy saves Goal and audience and What counts as a
                result together. Saving updates this draft only. It does not
                approve a campaign or change package prices, participation or
                dates.
              </p>
            )}
          </>
        )}
      </form>
    </section>
  );
}
