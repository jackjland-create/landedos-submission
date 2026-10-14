"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import {
  calculateCommercialPlanSnapshotSpend,
  timedStrategyCommercialPlanSnapshotSchema,
} from "@landed/contracts";
import plan from "./campaign-plan.module.css";
import clarity from "./clarity-reporting.module.css";
import modal from "./browser-commercial-dialog.module.css";
import {
  ApprovalDates,
  ApprovalTermsTable,
  ApprovalTotals,
} from "./browser-approval-terms";

const draftSchema = z.strictObject({
  id: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  snapshot: timedStrategyCommercialPlanSnapshotSchema,
  snapshotHash: z.string(),
  ownerId: z.uuid(),
});
const selectedDraftSchema = draftSchema.extend({
  selection: z.strictObject({
    version: z.literal(1),
    sourceReviewId: z.uuid(),
    sourceSnapshotHash: z.string(),
    packageIds: z.array(z.uuid()).min(1),
  }),
});
// JSON key ordering is not an approval difference. Array ordering and every
// retained value are: compare the complete local projection, not just its ID.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** "22:30 today" in the viewer's time once hydrated; exact UTC otherwise. */
function expiryLabel(iso: string, local: boolean) {
  const at = new Date(iso);
  const utc = `${iso.slice(0, 16).replace("T", " ")} UTC`;
  if (!local) return utc;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay
    ? `${time} today`
    : `${time}, ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(at)}`;
}
const resultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_recorded"), reviewId: z.uuid() }),
  z.strictObject({
    status: z.literal("approved"),
    reviewId: z.uuid(),
    commercialPlanVersionId: z.uuid(),
    snapshotHash: z.string(),
    campaignId: z.uuid().nullable(),
  }),
]);
export function BrowserCommitmentSummary({
  snapshot,
}: {
  snapshot: z.infer<typeof timedStrategyCommercialPlanSnapshotSchema>;
}) {
  return (
    <section aria-label="Exact creator commitments">
      <ApprovalTermsTable snapshot={snapshot} />
      <ApprovalTotals snapshot={snapshot} />
      <p>Contracted terms being approved, not a payment.</p>
    </section>
  );
}
export type LocalCommercialMode = "browser" | "devnet";
function commercialConfig(mode: LocalCommercialMode) {
  return mode === "devnet"
    ? {
        endpoint: "/api/isolated-devnet-rehearsal",
        action: {
          prepare: "prepareCommercial",
          select: "selectCommercial",
          confirm: "confirmCommercial",
          recover: "recoverCommercial",
          create: "createCampaign",
        },
        label: "Local devnet rehearsal",
      }
    : {
        endpoint: "/api/isolated-campaign-commercial",
        action: {
          prepare: "prepare",
          select: "select",
          confirm: "confirmSelected",
          recover: "recover",
          create: "create",
        },
        label: "Synthetic rehearsal",
      };
}
async function request(
  mode: LocalCommercialMode,
  input: Record<string, unknown>,
  read = false,
) {
  const config = commercialConfig(mode);
  const url =
    config.endpoint +
    (read ? `?${new URLSearchParams(input as Record<string, string>)}` : "");
  const response = await fetch(url, {
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
  });
  if (!response.ok)
    throw new Error(
      "The decision could not be confirmed. Check status before retrying; changed or expired plans need a fresh review.",
    );
  return response.json() as Promise<unknown>;
}
export function BrowserCommercialApproval({
  basketId,
  scenarioId,
  revision,
  snapshotHash,
  ownerId,
  theme = "light",
}: {
  basketId: string;
  scenarioId: string;
  revision: number;
  snapshotHash: string;
  ownerId: string;
  theme?: "light" | "dark";
}) {
  // A changed saved-plan identity remounts the review, never reuses stale terms.
  return (
    <CommercialApprovalDialog
      key={`${basketId}:${scenarioId}:${revision}:${snapshotHash}:${ownerId}`}
      {...{ basketId, scenarioId, revision, snapshotHash, ownerId, theme }}
      mode="browser"
    />
  );
}
export function LocalDevnetCommercialApproval({
  basketId,
  scenarioId,
  revision,
  snapshotHash,
  ownerId,
  theme = "light",
}: Parameters<typeof BrowserCommercialApproval>[0]) {
  return (
    <CommercialApprovalDialog
      key={`${basketId}:${scenarioId}:${revision}:${snapshotHash}:${ownerId}`}
      {...{ basketId, scenarioId, revision, snapshotHash, ownerId, theme }}
      mode="devnet"
    />
  );
}
function CommercialApprovalDialog({
  basketId,
  scenarioId,
  revision,
  snapshotHash,
  ownerId,
  theme,
  mode,
}: {
  basketId: string;
  scenarioId: string;
  revision: number;
  snapshotHash: string;
  ownerId: string;
  theme: "light" | "dark";
  mode: LocalCommercialMode;
}) {
  const config = commercialConfig(mode);
  const interactive = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const [draft, setDraft] = useState<z.infer<typeof draftSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [expired, setExpired] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<z.infer<
    typeof selectedDraftSchema
  > | null>(null);
  const selectedSnapshot = draft
    ? {
        ...draft.snapshot,
        packages: draft.snapshot.packages.filter((entry) =>
          selectedIds.includes(entry.id),
        ),
      }
    : null;
  const selectedSpend = selectedSnapshot?.packages.length
    ? calculateCommercialPlanSnapshotSpend(selectedSnapshot)
    : null;
  const selectedIsApprovable =
    selectedSpend?.status === "unpaid" ||
    selectedSpend?.status === "single_currency";
  function changeSelection(ids: string[]) {
    if (inFlight.current || uncertain) return;
    setSelectedIds(ids);
    setSelectedDraft(null);
    setAgreed(false);
    setMessage("");
  }
  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(draft.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [draft]);
  function close(edit = false) {
    if (edit && !inFlight.current && !uncertain) {
      setDraft(null);
      setAgreed(false);
      setReason("");
      setExpired(false);
      setMessage("");
    }
    dialog.current?.close();
    trigger.current?.focus();
  }
  function open() {
    dialog.current?.showModal();
    if (!draft && !inFlight.current && !uncertain) void prepare();
  }
  async function prepare() {
    if (inFlight.current || uncertain) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setDraft(null);
    setAgreed(false);
    setExpired(false);
    try {
      const value = draftSchema.parse(
        await request(mode, {
          action: config.action.prepare,
          basketId,
          scenarioId,
          revision,
        }),
      );
      if (
        value.snapshotHash !== snapshotHash ||
        value.ownerId !== ownerId ||
        value.snapshot.basket.id !== basketId ||
        value.snapshot.scenario.id !== scenarioId ||
        value.snapshot.strategyBinding.revision !== revision
      )
        throw new Error(
          "The plan changed. Reload the saved plan before approving.",
        );
      setDraft(value);
    } catch (error) {
      setMessage(
        error instanceof z.ZodError
          ? "The saved review is incomplete or unavailable. Back to edit, check the plan and try again."
          : error instanceof Error
            ? error.message
            : "Review unavailable.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !draft ||
      !selectedSnapshot?.packages.length ||
      !selectedIsApprovable ||
      !agreed ||
      inFlight.current ||
      uncertain
    )
      return;
    if (Date.parse(draft.expiresAt) <= Date.now()) {
      setExpired(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    let submitted = false;
    try {
      const chosen = selectedDraftSchema.parse(
        await request(mode, {
          action: config.action.select,
          basketId,
          sourceReviewId: draft.id,
          packageIds: selectedSnapshot.packages.map((entry) => entry.id),
        }),
      );
      if (
        chosen.ownerId !== ownerId ||
        chosen.selection.sourceReviewId !== draft.id ||
        chosen.selection.sourceSnapshotHash !== draft.snapshotHash ||
        canonical(chosen.selection.packageIds) !==
          canonical(selectedSnapshot.packages.map((entry) => entry.id)) ||
        canonical(chosen.snapshot) !== canonical(selectedSnapshot) ||
        Date.parse(chosen.expiresAt) > Date.parse(draft.expiresAt) ||
        Date.parse(chosen.expiresAt) <= Date.now()
      )
        throw new Error("Selected review did not match the displayed terms.");
      setSelectedDraft(chosen);
      const url = new URL(window.location.href);
      url.searchParams.set("commercialReview", chosen.id);
      window.history.replaceState(null, "", url);
      setUncertain(true);
      submitted = true;
      const value = resultSchema.parse(
        await request(mode, {
          action: config.action.confirm,
          basketId,
          reviewId: chosen.id,
          note: reason.trim() || undefined,
          acknowledged: true,
        }),
      );
      if (
        value.status !== "approved" ||
        value.reviewId !== chosen.id ||
        value.snapshotHash !== chosen.snapshotHash
      )
        throw new Error("Approval response unavailable.");
      window.location.assign(url.toString());
    } catch {
      setMessage(
        submitted
          ? "Approval status is uncertain. Approve stays off here until the status is known."
          : "The selected terms could not be prepared. No approval was submitted. Back to edit and review the saved plan.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Commercial decision" className={modal.entry}>
      <button
        ref={trigger}
        type="button"
        className={modal.entryButton}
        disabled={!interactive}
        onClick={open}
      >
        {uncertain ? "Check approval status" : "Review and approve"}
      </button>
      <p>Opens the saved terms. You approve only the creators you select.</p>
      <dialog
        ref={dialog}
        className={`${clarity.app} ${modal.dialog}`}
        data-theme={theme}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (!first) {
            event.preventDefault();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <form
          className={modal.form}
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <header className={modal.header}>
            <div>
              <p>
                {draft
                  ? `${draft.snapshot.basket.name} · Scenario ${draft.snapshot.scenario.code} · ${draft.snapshot.scenario.name}`
                  : "Your saved plan"}
              </p>
              <h2 id={titleId}>Review and approve</h2>
            </div>
            <button
              type="button"
              className={modal.close}
              onClick={() => close()}
              aria-label="Close approval review"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className={modal.content} aria-busy={busy}>
            <p id={descriptionId} className={modal.effect}>
              Approving locks the selected terms into the plan. It doesn’t send
              offers, pay creators or go live.
            </p>
            <p className={modal.scope}>
              <span className={modal.tag}>{config.label}</span> Approve only the
              creators you select; the others stay in planning. This does not
              call a provider or wallet.
            </p>
            <details className={modal.exactTimes}>
              <summary>What approval doesn’t do</summary>
              <p>
                It doesn’t record creator acceptance, approve content, pay or
                launch. Changing terms later needs a new approval. Not specified
                is not permission.
              </p>
            </details>
            {busy && !draft && (
              <div role="status" className={modal.checking}>
                <span className={modal.spinner} aria-hidden="true" />
                <div>
                  <strong>Checking the saved plan…</strong>
                  <p>
                    Loading your exact saved terms. Unsaved edits aren’t
                    included.
                  </p>
                </div>
                <span className={modal.skeleton} aria-hidden="true" />
                <span className={modal.skeleton} aria-hidden="true" />
                <span className={modal.skeleton} aria-hidden="true" />
              </div>
            )}
            {draft && (
              <>
                <ApprovalDates snapshot={draft.snapshot} />
                <ApprovalTermsTable
                  snapshot={draft.snapshot}
                  selection={{
                    ids: selectedIds,
                    disabled: busy || expired || uncertain,
                    onChange: changeSelection,
                  }}
                />
              </>
            )}
            {message && !uncertain && (
              <p role="alert" className={modal.notice}>
                {message}
              </p>
            )}
            {!busy && !draft && !uncertain && (
              <button
                type="button"
                className={modal.secondary}
                onClick={() => void prepare()}
              >
                Try loading the review again
              </button>
            )}
          </div>
          <footer className={modal.footer}>
            {selectedSnapshot && (
              <div>
                <p role="status">
                  {selectedSnapshot.packages.length} of{" "}
                  {draft?.snapshot.packages.length} creators selected
                </p>
                {selectedSnapshot.packages.length > 0 ? (
                  <ApprovalTotals snapshot={selectedSnapshot} />
                ) : (
                  <p className={modal.hint}>
                    Select the creators to approve. Their total shows here.
                  </p>
                )}
                {selectedSnapshot.packages.length > 0 &&
                  !selectedIsApprovable && (
                    <p role="status">
                      {selectedSpend?.status === "mixed_currency"
                        ? "The selected creators use more than one currency. Select creators paid in one currency to approve."
                        : "Compensated selections need a fixed commitment. An explicitly unpaid internal test can be approved with no compensation."}
                    </p>
                  )}
              </div>
            )}
            {draft && !uncertain && !expired && (
              <div className={modal.decision}>
                <label htmlFor={reasonId}>Note (optional)</label>
                <input
                  id={reasonId}
                  name="reason"
                  autoComplete="off"
                  maxLength={240}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy || expired}
                />
                <label className={modal.acknowledgement}>
                  <input
                    type="checkbox"
                    name="commercial-acknowledgement"
                    aria-required="true"
                    data-required-missing={!agreed}
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                    disabled={busy || expired}
                  />
                  <span>
                    I have reviewed the selected terms, prices, dates and
                    anything not specified.
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                </label>
              </div>
            )}
            {expired && !uncertain && draft && (
              <p role="alert" className={`${modal.notice} ${modal.noticeWarn}`}>
                <strong>
                  This review has expired
                  {` at ${expiryLabel(draft.expiresAt, interactive)}`}.
                </strong>{" "}
                Terms, prices or dates may have changed since. Start a fresh
                review to approve. No approval was submitted from this view.
              </p>
            )}
            {uncertain && (
              <div
                role={busy ? "status" : "alert"}
                className={`${modal.notice} ${busy ? "" : modal.noticeBad}`}
              >
                {busy ? (
                  <p>
                    Confirming your decision… Closing this view will not cancel
                    the request.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>
                        We couldn’t confirm whether the approval was saved.
                      </strong>{" "}
                      Don’t approve again. Check the status first; we’ll show
                      the saved decision.
                    </p>
                    <p>{message}</p>
                  </>
                )}
              </div>
            )}
            <div className={modal.actions}>
              {draft && !uncertain && !expired ? (
                <small
                  className={modal.expiry}
                  title={`${draft.expiresAt.replace("T", " ").replace("Z", "")} UTC`}
                >
                  Review valid until {expiryLabel(draft.expiresAt, interactive)}
                </small>
              ) : null}
              <button
                type="button"
                className={modal.secondary}
                disabled={busy || uncertain}
                onClick={() => close(true)}
              >
                Back to edit
              </button>
              {uncertain ? (
                <a
                  className={modal.primary}
                  href={`?commercialReview=${selectedDraft?.id}`}
                >
                  Check approval status
                </a>
              ) : expired ? (
                <button
                  type="button"
                  className={modal.primary}
                  disabled={busy}
                  onClick={() => void prepare()}
                >
                  Start a fresh review
                </button>
              ) : (
                <button
                  type="submit"
                  className={modal.primary}
                  disabled={
                    !draft ||
                    busy ||
                    uncertain ||
                    expired ||
                    !agreed ||
                    !selectedSnapshot?.packages.length ||
                    !selectedIsApprovable
                  }
                >
                  {busy && draft
                    ? "Confirming approval…"
                    : "Approve selected terms"}
                </button>
              )}
            </div>
          </footer>
        </form>
      </dialog>
    </section>
  );
}

export function BrowserCommercialRecovery({
  basketId,
  projectId,
  theme = "light",
}: {
  basketId: string;
  projectId: string;
  theme?: "light" | "dark";
}) {
  return (
    <CommercialRecovery
      basketId={basketId}
      projectId={projectId}
      mode="browser"
      theme={theme}
    />
  );
}
export function LocalDevnetCommercialRecovery({
  basketId,
  projectId,
  theme = "light",
}: {
  basketId: string;
  projectId: string;
  theme?: "light" | "dark";
}) {
  return (
    <CommercialRecovery
      basketId={basketId}
      projectId={projectId}
      mode="devnet"
      theme={theme}
    />
  );
}
function CommercialRecovery({
  basketId,
  projectId,
  mode,
  theme,
}: {
  basketId: string;
  projectId: string;
  mode: LocalCommercialMode;
  theme: "light" | "dark";
}) {
  const params = useSearchParams();
  const reviewId = params.get("commercialReview");
  if (!reviewId || !z.uuid().safeParse(reviewId).success) return null;
  return (
    <CommercialRecoverySession
      key={`${projectId}:${basketId}:${reviewId}:${mode}`}
      basketId={basketId}
      projectId={projectId}
      reviewId={reviewId}
      mode={mode}
      theme={theme}
    />
  );
}
function CommercialRecoverySession({
  basketId,
  projectId,
  reviewId,
  mode,
  theme,
}: {
  basketId: string;
  projectId: string;
  reviewId: string;
  mode: LocalCommercialMode;
  theme: "light" | "dark";
}) {
  const config = commercialConfig(mode);
  const interactive = useHydrated();
  const [result, setResult] = useState<z.infer<typeof resultSchema> | null>(
    null,
  );
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(create: boolean) {
    if (
      !interactive ||
      inFlight.current ||
      (create && (result?.status !== "approved" || !!result.campaignId))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const value = resultSchema.parse(
        await request(
          mode,
          {
            action: create ? config.action.create : config.action.recover,
            basketId,
            reviewId,
            ...(create ? { acknowledged: true } : {}),
          },
          !create,
        ),
      );
      if (value.reviewId !== reviewId) throw new Error("Decision mismatch");
      setResult(value);
      setMessage(
        value.status === "approved"
          ? value.campaignId
            ? create
              ? "Campaign created from the approved plan."
              : "A campaign already exists for this approval."
            : "Approval confirmed."
          : "",
      );
    } catch {
      if (create) setResult(null);
      setMessage(
        create
          ? "We couldn’t confirm whether the campaign was created. Check approval status before trying again."
          : "We couldn’t check the saved decision. Check your access, then try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const approved = result?.status === "approved";
  return (
    <section
      className={`${plan.root} ${plan.decision} ${approved ? plan.decisionApproved : ""}`}
      data-theme={theme}
      aria-label="Saved commercial decision"
      aria-busy={busy}
    >
      <div className={plan.decisionMain}>
        <h2 className={plan.cardTitle}>
          {approved
            ? "Plan approved"
            : result?.status === "not_recorded"
              ? "No approval recorded"
              : "Check your approval"}
        </h2>
        <p>
          {approved
            ? "The selected terms are locked as this plan’s approved version."
            : result?.status === "not_recorded"
              ? "Nothing was approved. Return to the saved plan and review it again."
              : "Check the saved decision to see your approval and continue."}
        </p>
        <p role="status" className={plan.small}>
          {message}
        </p>
        {!approved ? (
          <button
            type="button"
            className={`${plan.button} ${result ? "" : plan.buttonHero}`}
            disabled={busy || !interactive}
            onClick={() => void act(false)}
          >
            {busy ? "Checking…" : "Check approval status"}
          </button>
        ) : null}
      </div>
      {approved ? (
        <>
          <div className={plan.decisionMain}>
            <h3 className={plan.stepTitle}>What approving didn’t do</h3>
            <ul className={plan.dashList}>
              <li>It didn’t send offers to creators.</li>
              <li>It didn’t pay anyone.</li>
              <li>
                It didn’t put anything live. Going live is a later step in the
                campaign.
              </li>
            </ul>
          </div>
          <div className={plan.decisionNext}>
            {result.campaignId ? (
              <>
                <h3 className={plan.stepTitle}>Campaign ready</h3>
                <p className={plan.small}>
                  Brief creators, set up tracking links and follow results in
                  its workspace.
                </p>
                <a
                  className={`${plan.button} ${plan.buttonHero}`}
                  href={`/projects/${encodeURIComponent(projectId)}/campaigns/${result.campaignId}`}
                >
                  Open campaign workspace <span aria-hidden="true">→</span>
                </a>
              </>
            ) : (
              <>
                <h3 className={plan.stepTitle}>Next: create the campaign</h3>
                <p className={plan.small}>
                  It opens the campaign workspace with these exact terms.
                  Creating the campaign doesn’t contact creators or start
                  anything live.
                </p>
                <button
                  type="button"
                  className={`${plan.button} ${plan.buttonHero}`}
                  disabled={busy}
                  onClick={() => void act(true)}
                >
                  {busy ? "Creating campaign…" : "Create campaign"}
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
