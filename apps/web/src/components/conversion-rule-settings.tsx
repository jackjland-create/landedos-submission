"use client";

import {
  approveConversionReplayInputSchema,
  approveConversionReplayResponseSchema,
  configureConversionRuleInputSchema,
  type ApproveConversionReplayInput,
  type ConfigureConversionRuleInput,
  type ConversionReplayJobRecord,
  type ConversionRuleRecord,
  type ConversionRuleTemplate,
} from "@landed/contracts";
import { useRouter } from "next/navigation";
import styles from "./success-rules.module.css";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

const templates: Array<{
  code: ConversionRuleTemplate;
  label: string;
  summary: string;
  readiness: string;
}> = [
  {
    code: "wallet_connected",
    label: "Wallet connected",
    summary: "Count a consenting wallet once its signed session proof exists.",
    readiness: "Ready for evaluation",
  },
  {
    code: "first_qualifying_transaction",
    label: "First qualifying transaction",
    summary:
      "Count the first finalized one-lamport devnet response to an approved receiver.",
    readiness: "Ready for evaluation",
  },
  {
    code: "programme_action",
    label: "Customer programme action",
    summary:
      "Define a programme and action now; matching waits for decoded evidence.",
    readiness: "Needs a programme decoder before it can count",
  },
];

function defaultDescription(template: ConversionRuleTemplate) {
  if (template === "wallet_connected") {
    return "Count a wallet after signed proof and explicit measurement consent.";
  }
  if (template === "programme_action") {
    return "Count a finalized customer programme action after wallet consent.";
  }
  return "Count the first finalized one-lamport devnet campaign response to the approved receiver after wallet consent.";
}

function templateLabel(template: ConversionRuleTemplate) {
  return templates.find(({ code }) => code === template)?.label ?? template;
}

const replayStatusLabels = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Stopped",
} as const;

function replayFailureMessage(code: string | null) {
  if (code === "job_retries_exhausted") {
    return "The worker could not complete after safe retries.";
  }
  return "The retained replay stopped before a comparable report was issued.";
}

function formatLocalDateTime(value: Date) {
  const offsetMilliseconds = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMilliseconds)
    .toISOString()
    .slice(0, 16);
}

export function ConversionRuleSettings({
  affectedCampaignCount,
  canManage,
  projectId,
  replayJobs = [],
  rule,
  planContext,
  theme = "light",
}: {
  theme?: "light" | "dark";
  affectedCampaignCount: number;
  canManage: boolean;
  projectId: string;
  replayJobs?: ConversionReplayJobRecord[];
  rule: ConversionRuleRecord | null;
  /**
   * UI-03: the plan the person came from. The route (GPT-owned) validates it
   * against the current project and an accessible plan before passing it; this
   * component never reads a return URL itself.
   */
  planContext?: { name: string; href: string; versionId?: string | null };
}) {
  const router = useRouter();
  const current = rule?.versions[0] ?? null;
  const [selectedTemplate, setSelectedTemplate] =
    useState<ConversionRuleTemplate>(
      current?.templateCode ?? "first_qualifying_transaction",
    );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [saveIsUncertain, setSaveIsUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const pendingPayload = useRef<ConfigureConversionRuleInput | null>(null);
  const requestInFlight = useRef(false);
  const createForm = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const createHeading = useRef<HTMLHeadingElement>(null);
  const saveMessage = useRef<HTMLDivElement>(null);
  const [formDirty, setFormDirty] = useState(false);

  useEffect(() => {
    if (message && dialog.current?.open && (status === "error" || status === "saved")) {
      saveMessage.current?.focus();
    }
  }, [message, status]);

  useEffect(() => {
    function followHash() {
      if (window.location.hash === "#create-rule" && canManage) {
        if (!dialog.current?.open) dialog.current?.showModal();
        createHeading.current?.focus();
      } else if (dialog.current?.open) {
        dialog.current.close();
        createTrigger.current?.focus();
      }
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    window.addEventListener("popstate", followHash);
    return () => {
      window.removeEventListener("hashchange", followHash);
      window.removeEventListener("popstate", followHash);
    };
  }, [canManage]);

  useEffect(() => {
    if (!formDirty && status !== "saving" && !saveIsUncertain) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [formDirty, status, saveIsUncertain]);

  function openCreator() {
    window.history.pushState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + "#create-rule",
    );
    dialog.current?.showModal();
    createHeading.current?.focus();
  }

  function closeCreator() {
    dialog.current?.close();
    if (window.location.hash === "#create-rule") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
    createTrigger.current?.focus();
  }
  const nextVersion = (current?.version ?? 0) + 1;
  const selected = useMemo(
    () => templates.find(({ code }) => code === selectedTemplate)!,
    [selectedTemplate],
  );

  async function submit(formData: FormData) {
    if (!canManage || requestInFlight.current || saveIsUncertain) return;
    requestInFlight.current = true;
    setStatus("saving");
    setSaveIsUncertain(false);
    setMessage("");
    const isProgramme = selectedTemplate === "programme_action";
    const isDestinationBound =
      selectedTemplate === "first_qualifying_transaction";
    const effectiveFromValue = String(formData.get("effectiveFrom") ?? "");
    const effectiveFrom = new Date(effectiveFromValue);
    const payload = {
      ruleId: rule?.id ?? crypto.randomUUID(),
      ruleVersionId: crypto.randomUUID(),
      changeRequestId: crypto.randomUUID(),
      templateCode: selectedTemplate,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      effectiveFrom: Number.isFinite(effectiveFrom.getTime())
        ? effectiveFrom.toISOString()
        : effectiveFromValue,
      effectiveUntil: null,
      programId: isProgramme
        ? String(formData.get("programId") ?? "") || null
        : null,
      eventDiscriminator: isProgramme
        ? String(formData.get("eventDiscriminator") ?? "") || null
        : null,
      configuredEnvironment: isDestinationBound ? "devnet" : null,
      destinationAddress: isDestinationBound
        ? String(formData.get("destinationAddress") ?? "") || null
        : null,
      nativeAmountLamports: isDestinationBound ? "1" : null,
      changeReason: String(formData.get("changeReason") ?? ""),
    };
    const parsed = configureConversionRuleInputSchema.safeParse(payload);
    if (!parsed.success) {
      requestInFlight.current = false;
      setStatus("error");
      setMessage(parsed.error.issues[0]?.message ?? "Review the definition.");
      return;
    }

    pendingPayload.current = parsed.data;
    await sendPayload(parsed.data);
  }

  async function sendPayload(payload: ConfigureConversionRuleInput) {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/conversion-rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        message?: string;
        rule?: {
          version: number;
          affectedCampaignCount: number;
          replayAvailable: boolean;
        };
      } | null;
      if (!response.ok) {
        pendingPayload.current = null;
        setSaveIsUncertain(false);
        setStatus("error");
        setMessage(result?.message ?? "The rule version wasn’t saved.");
        return;
      }
      setStatus("saved");
      setFormDirty(false);
      createForm.current?.reset();
      const affected = result?.rule?.affectedCampaignCount ?? 0;
      setMessage(
        result?.rule?.replayAvailable === false
          ? `Version ${result?.rule?.version ?? nextVersion} is retained. Historical replay stays unavailable until the exact destination-bound writer is approved.`
          : `Version ${result?.rule?.version ?? nextVersion} is retained. ` +
              `${affected} campaign${affected === 1 ? "" : "s"} have a pending replay request.`,
      );
      pendingPayload.current = null;
      setSaveIsUncertain(false);
      router.refresh();
    } catch {
      setStatus("error");
      setSaveIsUncertain(true);
      setMessage(
        "Connection lost. The save outcome is not yet known; retry to reconcile the same request safely.",
      );
    } finally {
      requestInFlight.current = false;
    }
  }

  async function retryPendingPayload() {
    if (!canManage || !pendingPayload.current || requestInFlight.current)
      return;
    requestInFlight.current = true;
    setStatus("saving");
    setMessage("");
    await sendPayload(pendingPayload.current);
  }

  const dateUtc = (value: string) =>
    new Date(value).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  const dateOnly = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className={styles.root} data-theme={theme}>
      {planContext ? (
        <section className={styles.contextBar} aria-label="Where you came from">
          <a className={styles.button} href={planContext.href}>
            <span aria-hidden="true">←</span> Back to plan
          </a>
          <p>
            You came from <strong>{planContext.name}</strong>. Nothing here
            changes that plan. To use a new version, pick it in the plan’s What
            counts as a result.
          </p>
        </section>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <header className={styles.top}>
            <p className={styles.kind}>Settings</p>
            <h1 className={styles.title}>Success rules</h1>
            <p className={styles.purpose}>
              Define what counts as a result. Choose a saved version inside each
              campaign plan.
            </p>
            {canManage ? (
              <button
                ref={createTrigger}
                className={`${styles.button} ${styles.hero}`}
                type="button"
                onClick={openCreator}
              >
                Create a new success rule version
              </button>
            ) : (
              <p className={styles.notice}>
                <strong>Read only.</strong> A campaign manager can create new
                versions.
              </p>
            )}
          </header>

          <section
            className={`${styles.card} ${styles.facts}`}
            aria-label="How rules work"
          >
            <p>
              <strong>
                Creating a version doesn’t apply it to a campaign.
              </strong>{" "}
              Plans keep their saved choice. Previous versions and issued
              reports stay unchanged.
            </p>
          </section>

          <section
            className={styles.card}
            id="revenue-boundary"
            aria-labelledby="latest-rule-title"
          >
            <div className={styles.cardHead}>
              <p className={styles.small}>
                Latest saved version · not automatically applied
              </p>
              <span
                className={
                  current?.evidenceCapability === "ready"
                    ? styles.pillGo
                    : styles.pillMuted
                }
              >
                {current?.evidenceCapability === "requires_programme_decoder"
                  ? "Programme decoder required"
                  : current
                    ? "Ready for evaluation"
                    : "No rule yet"}
              </span>
            </div>
            <h2 className={styles.cardTitle} id="latest-rule-title">
              {current
                ? `${current.name} · version ${current.version}`
                : "No success rule yet"}
            </h2>
            <p>
              {current
                ? current.description
                : "Create the first version so plans can choose what counts as a result."}
            </p>
            {current ? (
              <>
                <a
                  className={styles.button}
                  href={planContext?.href ?? `/projects/${projectId}/baskets`}
                >
                  {planContext
                    ? "Choose a rule in this plan"
                    : "Choose a rule in a campaign plan"}
                </a>
                <p className={styles.small}>
                  Effective from {dateUtc(current.effectiveFrom)} · credit to
                  the last eligible creator touch within seven days · revenue
                  isn’t counted
                </p>
                <details className={styles.details}>
                  <summary>Match details</summary>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Credit</dt>
                      <dd>Last eligible creator touch</dd>
                    </div>
                    <div>
                      <dt>Window</dt>
                      <dd>Seven days</dd>
                    </div>
                    <div>
                      <dt>Revenue</dt>
                      <dd>Not counted by this rule</dd>
                    </div>
                    <div>
                      <dt>Effective from</dt>
                      <dd>{dateUtc(current.effectiveFrom)}</dd>
                    </div>
                    {current.configuredEnvironment ? (
                      <>
                        <div>
                          <dt>Network</dt>
                          <dd>{current.configuredEnvironment}</dd>
                        </div>
                        <div>
                          <dt>Response</dt>
                          <dd>{current.nativeAmountLamports} lamport</dd>
                        </div>
                        <div>
                          <dt>Receiver</dt>
                          <dd className={styles.mono}>
                            {current.destinationAddress}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </details>
              </>
            ) : null}
          </section>

          <details className={styles.card}>
            <summary className={styles.cardTitle}>
              Version history ({rule?.versions.length ?? 0})
            </summary>
            {rule?.versions.length ? (
              <ol className={styles.versions}>
                {rule.versions.map((version, index) => (
                  <li key={version.id}>
                    <span className={styles.versionPill}>
                      v{version.version}
                    </span>
                    <div className={styles.versionText}>
                      <p>
                        <strong>{version.name}</strong> · from{" "}
                        {dateOnly(version.effectiveFrom)}
                      </p>
                      <p className={styles.small}>{version.changeReason}</p>
                    </div>
                    <span className={styles.versionStatus}>
                      {planContext?.versionId === version.id ? (
                        <span className={styles.pillInfo}>
                          {planContext.name} uses this
                        </span>
                      ) : version.evidenceCapability !== "ready" ? (
                        "Not supported for plans"
                      ) : index === 0 ? (
                        "Latest"
                      ) : (
                        "Earlier version"
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.small}>
                The first version will appear here. Nothing is treated as zero.
              </p>
            )}
          </details>
          <details className={`${styles.card} ${styles.details}`}>
            <summary>Advanced: recalculate past results</summary>
            <p className={styles.small}>
              Only use this to compare historical results under a different
              rule. It isn’t needed to set up a new campaign. Existing reports
              are preserved.
            </p>
            <ConversionReplayPanel
              canManage={canManage}
              projectId={projectId}
              replayJobs={replayJobs}
              rule={rule}
            />
          </details>
        </div>

        <dialog
          ref={dialog}
          className={styles.create}
          id="create-rule"
          aria-labelledby="create-rule-title"
          aria-describedby="create-rule-help"
          onCancel={(event) => {
            event.preventDefault();
            closeCreator();
          }}
        >
          <header className={styles.cardHead}>
            <h2
              ref={createHeading}
              tabIndex={-1}
              className={styles.cardTitle}
              id="create-rule-title"
            >
              Create a new success rule version
            </h2>
            <button
              className={styles.button}
              type="button"
              onClick={closeCreator}
              aria-label="Close rule editor"
            >
              ×
            </button>
          </header>
          <div className={styles.editorBody}>
            <p className={styles.small} id="create-rule-help">
              Version {nextVersion} · available across this project. It doesn’t
              change any plan’s saved choice. Choose and save it in a campaign
              plan when you’re ready to use it.
            </p>
            <fieldset
              className={styles.templates}
              disabled={!canManage || status === "saving" || saveIsUncertain}
            >
              <legend>What qualifies</legend>
              {templates.map((template) => (
                <button
                  aria-pressed={template.code === selectedTemplate}
                  className={`${styles.template} ${
                    template.code === selectedTemplate ? styles.templateOn : ""
                  }`}
                  key={template.code}
                  onClick={() => {
                    setSelectedTemplate(template.code);
                    setStatus("idle");
                  }}
                  type="button"
                >
                  <span className={styles.radio} aria-hidden="true" />
                  <span className={styles.templateText}>
                    <strong>{template.label}</strong>
                    <span className={styles.small}>{template.summary}</span>
                    <span className={styles.small}>{template.readiness}</span>
                  </span>
                </button>
              ))}
            </fieldset>

            {!canManage ? (
              <div className={styles.notice} role="status">
                Campaign manager access is required. You can inspect versions
                but can’t create one.
              </div>
            ) : (
              <form
                id="success-rule-create-form"
                ref={createForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(new FormData(event.currentTarget));
                }}
                className={styles.form}
                onChange={() => setFormDirty(true)}
              >
                <p className={styles.small}>
                  Start with the template wording below. Replace it with your
                  rule’s name and description; previous version text isn’t
                  copied.
                </p>
                <fieldset
                  className={styles.editFields}
                  disabled={status === "saving" || saveIsUncertain}
                >
                  <div className={styles.row}>
                    <label>
                      <span>
                        Name
                        <span
                          className="required-field-marker"
                          aria-hidden="true"
                          title="Required"
                        />
                      </span>
                      <input
                        defaultValue={selected.label}
                        onFocus={(event) => event.currentTarget.select()}
                        key={`name-${selectedTemplate}`}
                        name="name"
                        required
                      />
                    </label>
                    <label>
                      <span>
                        Effective from (your local time)
                        <span
                          className="required-field-marker"
                          aria-hidden="true"
                          title="Required"
                        />
                      </span>
                      <input
                        defaultValue={formatLocalDateTime(new Date())}
                        name="effectiveFrom"
                        required
                        type="datetime-local"
                      />
                    </label>
                  </div>
                  <label>
                    <span>
                      What it counts, in plain words
                      <span
                        className="required-field-marker"
                        aria-hidden="true"
                        title="Required"
                      />
                    </span>
                    <textarea
                      defaultValue={defaultDescription(selectedTemplate)}
                      onFocus={(event) => event.currentTarget.select()}
                      key={`description-${selectedTemplate}`}
                      name="description"
                      required
                    />
                  </label>
                  {selectedTemplate === "programme_action" ? (
                    <div className={styles.advanced}>
                      <label>
                        <span>
                          Programme address
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          autoComplete="off"
                          name="programId"
                          placeholder="Solana programme address"
                          required
                        />
                      </label>
                      <label>
                        <span>
                          Action label
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          name="eventDiscriminator"
                          placeholder="e.g. deposit_completed"
                          required
                        />
                      </label>
                      <p className={styles.small}>
                        This version can be saved, but matching remains
                        unavailable until programme instruction evidence is
                        decoded.
                      </p>
                    </div>
                  ) : null}
                  {selectedTemplate === "first_qualifying_transaction" ? (
                    <div className={styles.advanced}>
                      <label>
                        <span>
                          Approved devnet receiver
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          autoComplete="off"
                          defaultValue={
                            current?.templateCode === selectedTemplate
                              ? (current.destinationAddress ?? "")
                              : ""
                          }
                          name="destinationAddress"
                          placeholder="Public Solana devnet address"
                          required
                        />
                      </label>
                      <p className={styles.small}>
                        The retained rule matches only a finalized transfer of
                        exactly one lamport on devnet to this receiver. It is a
                        campaign-response proof, not a payment, sale, activation
                        or revenue event.
                      </p>
                    </div>
                  ) : null}
                  <label>
                    <span>
                      Why this change
                      <span
                        className="required-field-marker"
                        aria-hidden="true"
                        title="Required"
                      />
                    </span>
                    <textarea
                      name="changeReason"
                      placeholder="Why should this become the next version?"
                      required
                    />
                  </label>

                  <aside
                    className={styles.impact}
                    aria-label="What this changes"
                  >
                    <strong>What this changes</strong>
                    <p className={styles.small}>
                      {templateLabel(selectedTemplate)} · version {nextVersion}
                    </p>
                    <ul>
                      <li>
                        {affectedCampaignCount} existing campaign
                        {affectedCampaignCount === 1 ? "" : "s"} in project
                        scope.
                      </li>
                      <li>New evaluation runs may use this version.</li>
                      <li>Issued reports remain unchanged.</li>
                      <li>
                        Plans keep their current version until someone picks
                        this one.
                      </li>
                      {selectedTemplate === "first_qualifying_transaction" ? (
                        <li>
                          Historical replay remains unavailable until the exact
                          destination-bound writer is approved.
                        </li>
                      ) : (
                        <li>
                          A pending replay request records future recalculation
                          work.
                        </li>
                      )}
                      <li>Revenue stays separate and unmapped.</li>
                      {selectedTemplate === "first_qualifying_transaction" ? (
                        <li>
                          Network, receiver and one-lamport amount are immutable
                          match conditions.
                        </li>
                      ) : null}
                    </ul>
                  </aside>
                </fieldset>

                {message ? (
                  <div className={styles.messageRow} ref={saveMessage} tabIndex={-1}>
                    <p
                      className={
                        status === "error" ? styles.noticeBad : styles.noticeGo
                      }
                      role={status === "error" ? "alert" : "status"}
                    >
                      {message}
                    </p>
                    {saveIsUncertain && pendingPayload.current ? (
                      <button
                        className={styles.button}
                        onClick={retryPendingPayload}
                        type="button"
                      >
                        Retry the same request
                      </button>
                    ) : null}
                    {status === "saved" && planContext ? (
                      <a className={styles.button} href={planContext.href}>
                        Return to plan and choose a rule
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </form>
            )}
          </div>
          <footer className={styles.editorFooter}>
            <p className={styles.small}>
              Closing keeps your entries here until you leave this page. It
              doesn’t save them.
            </p>
            <button
              className={styles.button}
              type="button"
              onClick={closeCreator}
            >
              Back to success rules
            </button>
            {canManage ? (
              <button
                className={`${styles.button} ${styles.hero}`}
                disabled={status === "saving" || saveIsUncertain}
                type="submit"
                form="success-rule-create-form"
              >
                {status === "saving"
                  ? "Saving version…"
                  : `Create version ${nextVersion}`}
              </button>
            ) : null}
          </footer>
        </dialog>
      </div>
    </div>
  );
}

function ConversionReplayPanel({
  canManage,
  projectId,
  replayJobs,
  rule,
}: {
  canManage: boolean;
  projectId: string;
  replayJobs: ConversionReplayJobRecord[];
  rule: ConversionRuleRecord | null;
}) {
  const router = useRouter();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [pendingPayload, setPendingPayload] =
    useState<ApproveConversionReplayInput | null>(null);

  async function sendApproval(payload: ApproveConversionReplayInput) {
    setActiveJobId(payload.replayJobId);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/conversion-replays`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const rawResult = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status !== 500) setPendingPayload(null);
        setOutcomeUncertain(response.status === 500);
        setStatus("error");
        setMessage(
          rawResult &&
            typeof rawResult === "object" &&
            "message" in rawResult &&
            typeof rawResult.message === "string"
            ? rawResult.message
            : "Replay approval could not be saved.",
        );
        return;
      }

      const parsedResult =
        approveConversionReplayResponseSchema.safeParse(rawResult);
      if (!parsedResult.success) {
        setPendingPayload(null);
        setOutcomeUncertain(false);
        setStatus("error");
        setMessage(
          "Replay was accepted, but its retained status could not be verified. Refresh before continuing.",
        );
        return;
      }

      const result = parsedResult.data;
      setPendingPayload(null);
      setOutcomeUncertain(false);
      setStatus("saved");
      setMessage(
        `Replay queued for ${result.replay.campaignCount} campaign${
          result.replay.campaignCount === 1 ? "" : "s"
        }. Existing reports remain unchanged.`,
      );
      router.refresh();
    } catch {
      setOutcomeUncertain(true);
      setStatus("error");
      setMessage(
        "Connection lost. The approval outcome is not known; retry the same request safely.",
      );
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>, jobId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = approveConversionReplayInputSchema.safeParse({
      replayJobId: jobId,
      replayRunId: crypto.randomUUID(),
      approvalRequestId: crypto.randomUUID(),
      approvalReason: String(form.get("approvalReason") ?? ""),
    });
    if (!parsed.success) {
      setActiveJobId(jobId);
      setStatus("error");
      setMessage(parsed.error.issues[0]?.message ?? "Review the approval.");
      return;
    }
    setPendingPayload(parsed.data);
    setOutcomeUncertain(false);
    setStatus("saving");
    setMessage("");
    await sendApproval(parsed.data);
  }

  const versionById = new Map(
    (rule?.versions ?? []).map((version) => [version.id, version]),
  );
  const approvalBusy = status === "saving" || outcomeUncertain;

  return (
    <section className={styles.replay} aria-labelledby="replay-title">
      <h3 className={styles.subTitle} id="replay-title">
        Create a comparable report
      </h3>
      <p className={styles.small}>
        Approve a retained rule request before historical evidence is evaluated.
        Prior reports never change.
      </p>

      {replayJobs.length ? (
        <ol className={styles.replayList}>
          {replayJobs.map((job) => {
            const version = versionById.get(job.ruleVersionId);
            const execution = job.execution;
            const evidenceExecutable =
              version?.templateCode === "first_qualifying_transaction" &&
              version.evidenceCapability === "ready";
            const executable =
              evidenceExecutable && job.eligibleCampaignCount > 0;
            const isActive = activeJobId === job.id;
            const stateLabel = execution
              ? replayStatusLabels[execution.status]
              : executable
                ? "Approval required"
                : evidenceExecutable
                  ? "Baseline required"
                  : "Execution deferred";
            const tone =
              execution?.status === "completed"
                ? styles.pillGo
                : execution?.status === "failed"
                  ? styles.pillBad
                  : executable
                    ? styles.pillWarn
                    : styles.pillMuted;

            return (
              <li key={job.id}>
                <div className={styles.replayHead}>
                  <span className={styles.versionPill}>
                    {version ? `v${version.version}` : "Unknown version"}
                  </span>
                  <div className={styles.versionText}>
                    <p>
                      <strong>
                        {version?.name ?? "Retained rule version"}
                      </strong>
                    </p>
                    <p className={styles.small}>
                      {job.affectedCampaignCount} affected campaign
                      {job.affectedCampaignCount === 1 ? "" : "s"} ·{" "}
                      {job.eligibleCampaignCount} with a baseline report to
                      compare · requested{" "}
                      {new Date(job.requestedAt).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <span className={tone}>{stateLabel}</span>
                </div>

                {execution ? (
                  <div className={styles.replayBody}>
                    <dl className={styles.facts}>
                      <div>
                        <dt>Candidates</dt>
                        <dd>
                          {execution.status === "completed"
                            ? execution.candidateCount
                            : "Not measured yet"}
                        </dd>
                      </div>
                      <div>
                        <dt>Matched paths</dt>
                        <dd>
                          {execution.status === "completed"
                            ? execution.matchedCount
                            : "Not measured yet"}
                        </dd>
                      </div>
                      <div>
                        <dt>Reports</dt>
                        <dd>
                          {execution.status === "completed"
                            ? execution.reportCount
                            : "Not issued yet"}
                        </dd>
                      </div>
                    </dl>
                    {execution.status === "completed" ? (
                      <div className={styles.links}>
                        {execution.comparisons.some(
                          (comparison) => comparison.replayVersion,
                        ) ? (
                          execution.comparisons.map((comparison) =>
                            comparison.replayVersion ? (
                              <a
                                className={styles.button}
                                href={`/projects/${projectId}/reports/${comparison.reportId}?version=${comparison.replayVersion}`}
                                key={comparison.campaignId}
                              >
                                {comparison.campaignName} · compare version{" "}
                                {comparison.baselineVersion} with{" "}
                                {comparison.replayVersion}
                              </a>
                            ) : null,
                          )
                        ) : (
                          <p className={styles.noticeBad} role="alert">
                            The completed run has no verified comparison link.
                            Refresh before continuing.
                          </p>
                        )}
                      </div>
                    ) : execution.status === "failed" ? (
                      <div className={styles.noticeBad} role="alert">
                        <strong>Replay stopped. </strong>
                        <span>
                          {replayFailureMessage(execution.failureCode)} Review
                          the retained rule and evidence, then create a new rule
                          version before retrying.
                        </span>
                        <code className={styles.mono}>
                          {execution.failureCode ?? "failure_not_retained"}
                        </code>
                      </div>
                    ) : (
                      <p className={styles.small} role="status">
                        Evidence totals remain unknown until this run completes.
                        Refresh to see the retained status.
                      </p>
                    )}
                  </div>
                ) : executable && canManage ? (
                  <form
                    className={styles.form}
                    onSubmit={(event) => approve(event, job.id)}
                  >
                    <label>
                      <span>
                        Approval reason
                        <span
                          className="required-field-marker"
                          aria-hidden="true"
                          title="Required"
                        />
                      </span>
                      <textarea
                        disabled={approvalBusy}
                        name="approvalReason"
                        placeholder="Why should project history be recalculated now?"
                        required
                      />
                    </label>
                    <aside className={styles.impact}>
                      <strong>What approving does</strong>
                      <p className={styles.small}>
                        The run evaluates retained finalized evidence, creates a
                        new calculation run, and issues a new report version.
                      </p>
                    </aside>
                    {isActive && message ? (
                      <p
                        className={
                          status === "error"
                            ? styles.noticeBad
                            : styles.noticeGo
                        }
                        role={status === "error" ? "alert" : "status"}
                      >
                        {message}
                      </p>
                    ) : null}
                    {isActive && outcomeUncertain && pendingPayload ? (
                      <button
                        className={styles.button}
                        onClick={() => {
                          setStatus("saving");
                          setMessage("");
                          void sendApproval(pendingPayload);
                        }}
                        type="button"
                      >
                        Retry the same approval
                      </button>
                    ) : (
                      <button
                        className={`${styles.button} ${styles.hero}`}
                        disabled={approvalBusy}
                        type="submit"
                      >
                        {status === "saving" && isActive
                          ? "Queuing replay…"
                          : "Approve and queue replay"}
                      </button>
                    )}
                  </form>
                ) : (
                  <p className={styles.small}>
                    {canManage
                      ? evidenceExecutable
                        ? "Issue a baseline report first. Historical replay stays unavailable until at least one campaign has an immutable report to compare."
                        : "This rule requires a separately reviewed evidence decoder before historical execution."
                      : "Campaign manager access is required to approve historical execution."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.replayEmpty}>
          <span className={styles.pillMuted}>No replay requests</span>
          <p className={styles.small}>
            Create a rule version first. Its retained impact request will appear
            here; no campaign count is inferred as zero.
          </p>
        </div>
      )}
    </section>
  );
}

export function ConversionRuleSettingsPermission({
  theme = "light",
}: { theme?: "light" | "dark" } = {}) {
  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.top} role="status">
        <p className={styles.kind}>Settings</p>
        <h1 className={styles.title}>Success rules aren’t available</h1>
        <p className={styles.purpose}>
          You don’t have access to this project’s rules. Ask a workspace
          administrator to grant project access.
        </p>
      </header>
    </div>
  );
}
